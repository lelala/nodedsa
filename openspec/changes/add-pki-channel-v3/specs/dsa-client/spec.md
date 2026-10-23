## MODIFIED Requirements

### Requirement: Open a DSA connection

函式庫 SHALL 提供 `open(accessPoint, token, options?)` 並拒絕空 access point。客戶端 SHALL 在登入或取公鑰之前，驗證解析後與直接指定的 access point 為含 hostname 的 HTTP(S) URL，並將無效解析結果回報為登入失敗；此驗證 SHALL 同時適用 legacy 與 PKI。PKI 模式下，getAccessPoint SHALL 提供解析後的邏輯 doorway/contract URL，而 HTTP 請求使用 doorway。

#### Scenario: 提供完整 URL
- **WHEN** 呼叫者開啟有效 http 或 https access point
- **THEN** 客戶端以所選 transport 嘗試 DS.Base.Connect，legacy 使用該 URL，PKI 使用其 doorway

#### Scenario: 提供 DSNS-relative access point
- **WHEN** access point 不含 URL scheme
- **THEN** 客戶端解析 DSNS 名稱並驗證結果，之後才初始化 transport 並嘗試登入

#### Scenario: 解析回傳無效結果
- **WHEN** DSNS lookup 回傳學校代碼、[object Object]、不支援的 scheme 或無效 HTTP(S) URL
- **THEN** 客戶端回報登入失敗，不使用該值作為 fetch 目標，且排隊請求透過既有 loginError 契約拒絕

## ADDED Requirements

### Requirement: 各傳輸模式保持解析後回應形狀

兩種 transport SHALL 使用 nodexml.xml2obj 解析成功回應 XML，send SHALL resolve Envelope.Body 或既有空物件 fallback。result callback SHALL 接收該 body、null error、HTTP response 與解析後的完整 envelope。客戶端 SHALL 保留 nodexml 的純量、陣列、屬性與文字表示，不額外解碼 entity 或重塑資料。

#### Scenario: 單欄 JSON 回應
- **WHEN** 任一 transport 收到相同的單 metadata column、單 record 成功 XML
- **THEN** Response.Metadata.Column、Response.Record 與 Column["@text"] 符合既有 nodexml 解析結果

#### Scenario: 多筆多欄回應
- **WHEN** 任一 transport 收到含多欄或多筆 record 的成功 XML
- **THEN** callback 與 Promise 保留既有陣列與值，包含中文及 entity 內容

### Requirement: 透過既有錯誤通道結束失敗操作

初次初始化與登入失敗 SHALL 通知 OnLoginError；reConnect 失敗 SHALL 僅拒絕自身 Promise，不重播既有 OnLoginError；當 callback 正常返回時，每個排隊或後續 send SHALL 透過既有 loginError 欄位通知 result callback、OnError 與拒絕 Promise，各一次。同步 callback 拋出時 SHALL 依同步例外契約停止後續通知並收尾 Promise，非同步 callback 拋出時 SHALL 依隔離契約繼續其他通知。服務 DSA 錯誤 SHALL 保留 dsaError.header、status、message。服務傳輸、XML 與密碼學錯誤 SHALL 保留既有 networkError 結構。reConnect SHALL 在初始化或登入終止失敗時拒絕並恢復生命週期 callbacks。客戶端自行產生的錯誤訊息 SHALL NOT 額外附加 token、SQL 或加密秘密；伺服器提供的 DSA 錯誤欄位 SHALL 保持既有值。

#### Scenario: 初始化失敗且有多筆排隊請求
- **WHEN** 初始化失敗，連線有多筆排隊請求與已註冊錯誤處理器
- **THEN** 每筆排隊請求的 callback、Promise、OnError 各收到對應 loginError 一次，OnLoginError 回報終止失敗

#### Scenario: 登入終止失敗後呼叫服務
- **WHEN** 呼叫者在登入終止失敗之後呼叫 send
- **THEN** callback 與 OnError 收到通知，Promise 拒絕，不持續 pending

#### Scenario: 重新連線失敗
- **WHEN** reConnect 遇到終止網路錯誤或 PKI 初始化失敗
- **THEN** 其 Promise 拒絕、不通知既有 OnLoginError，排隊及後續 send 正常失敗，且處理器保留；之後註冊 OnLoginError 若已有錯誤仍立即同步通知

#### Scenario: 重連錯誤的晚註冊通知例外

- **WHEN** 重連失敗前已有 handler，失敗後再註冊新 OnLoginError handler
- **THEN** 原 handler SHALL 不因重連失敗收到通知，新 handler SHALL 立即同步收到目前 loginError 一次；此為既有相容性例外，README SHALL 明列，不將「只由 Promise 回報」誤解為禁止晚註冊讀取

#### Scenario: 服務錯誤分類
- **WHEN** 加密或被允許的明文錯誤回應含非零 DSA status
- **THEN** send 以 dsaError 拒絕，而非 networkError，且 callback 與 OnError 收到相同錯誤

#### Scenario: 服務傳輸失敗
- **WHEN** HTTP 處理、解密或解密後 XML 解析失敗
- **THEN** send 以 networkError 拒絕，而非 dsaError 或 loginError，且 callback 與 OnError 收到相同錯誤

#### Scenario: 登入重試有上限
- **WHEN** 暫時性網路失敗中斷登入
- **THEN** 客戶端在初次嘗試之後至多重試三次，全部使用所選 transport，且終止失敗完成錯誤通知

#### Scenario: 協定資料無效或 SQL 呼叫失敗
- **WHEN** 公鑰或 Cipher 資料確定無效，或已送出的服務呼叫失敗
- **THEN** 客戶端不自動重送該操作

### Requirement: 所有物件 body 字串文字使用 XML entity

legacy 與 PKI 的物件 request body SHALL 遞迴將所有字串文字值以 XML entity 序列化，SHALL NOT 依欄位名稱、大小寫、路徑或服務判斷 SQL，且 SHALL NOT 為文字產生 CDATA。此規則 SHALL 涵蓋任意 key、巢狀物件、陣列中的字串與物件及 @text 文字，包含內部登入的物件 Body。既有 XML 屬性判定與屬性序列化、數字、布林、null 及物件/陣列形狀 SHALL 保持不變；本項 SHALL NOT 擴大修改 Header/token 序列化。符合 XML 標準的 parser SHALL 能還原完全相同的文字值，含 CR、頭尾空白、整個值只有 XML 空白及類似 entity 的字面值，客戶端 SHALL NOT 修改呼叫者輸入或增加業務轉換。回應端 SHALL 繼續維持既有 nodexml 解析行為。頂層字串 request body SHALL 保持 raw XML fragment，不自動改寫。

#### Scenario: 任意欄位與巢狀文字

- **WHEN** 任一模式的物件 body 在 SQL、sql、Script、Description、任意巢狀 key、陣列項目或 @text 提供中文、tab、頭尾空白、換行、CR、連續空白、引號、&、角括號、類似 entity 字面值或 ]]>
- **THEN** 每個字串文字值均以相同 entity 規則處理，不產生 CDATA，標準 XML parser 可逐字還原原文且沒有注入元素

#### Scenario: 非空且只有 XML 空白的字串

- **WHEN** 任一模式的任意物件 body 文字位置提供非空值，且全部字元均為 U+0020、U+0009、U+000A 或 U+000D，例如單一空格、兩個空格、單一換行、tab 或混合空白
- **THEN** 客戶端 SHALL 逐字以 `&#32;`、`&#9;`、`&#10;`、`&#13;` 輸出對應字元，不輸出 CDATA，不 trim、合併空白或替換為空字串；標準 parser 可還原完全相同的字元與長度

#### Scenario: 空字串與純空白不同

- **WHEN** 物件 body 分別包含空字串、null 與只有空白的非空字串
- **THEN** 空字串與 null 維持既有序列化慣例，非空純空白使用上述數值字元參照，不將三者合併成同一值

#### Scenario: Legacy UDM 與非 SQL 服務

- **WHEN** 呼叫者未選 PKI，向 UDM 或一般服務傳送多行物件 body 文字
- **THEN** 該文字也使用 entity 而非 CDATA，標準 XML parser 解析後保持原值，不要求 SQL key 或 Seed

#### Scenario: 屬性與其他型別

- **WHEN** 物件 body 混合既有屬性標記、@text、陣列、數字、布林與 null
- **THEN** 字串文字使用 entity，屬性及其他型別維持既有序列化慣例，呼叫者物件不變

#### Scenario: 呼叫者提供 raw XML fragment

- **WHEN** request.body 是頂層 XML fragment 字串，其中可含呼叫者自行編寫的 CDATA
- **THEN** 保留既有 raw XML 行為，不改寫其文字或 CDATA，由呼叫者負責有效跳脫

### Requirement: 服務 Fetch options 不擴及內部請求

send 第二參數的 Fetch options SHALL 僅套用於該次服務 HTTP 請求，PKI 模式時即其加密外層 HTTP。DSNS、Public.GetPublicKey、初次 DS.Base.Connect 與 reConnect 登入 SHALL NOT 繼承任何 send 的 headers 或 signal，亦 SHALL NOT 因本 change 新增 timeout。open 第三參數 SHALL NOT 新增連線級 Fetch options。登入重試上限 SHALL 僅在請求已拒絕時生效，不保證永不完成的內部請求最終會失敗。

#### Scenario: 服務 trace 與 signal 範圍

- **WHEN** 呼叫者在登入進行中以 send 傳入 trace headers 與 AbortSignal
- **THEN** 初始化及登入請求不帶這些 options，該次服務實際 fetch 時才套用它們；取消此 signal 不會取消共同初始化或登入

#### Scenario: 重新連線的內部請求

- **WHEN** 呼叫者在先前帶有 send options 的連線上執行 reConnect
- **THEN** 重連取公鑰與登入使用函式庫預設 headers，不保留或套用先前 send options

### Requirement: 記錄 ready 的既有失敗限制

ready() SHALL 提供成功回呼與 Promise，一次性完成行為依本規格處理，SHALL NOT 因此次變更新增登入失敗 rejection。文件 SHALL 明示登入失敗時 ready() 仍可維持 pending，呼叫者須使用 OnLoginError 處理失敗，不能將 await ready() 當作一定會結束的登入結果。

#### Scenario: 登入終止失敗後等待 ready

- **WHEN** 任一模式登入終止失敗，呼叫者已等待 ready() 且註冊 OnLoginError
- **THEN** OnLoginError 依既有錯誤欄位收到通知，ready() 不因此次修改變成 reject，文件揭露其可能持續 pending

### Requirement: 重新連線沿用已解析的路由

legacy 與 PKI 的 reConnect SHALL 沿用同一連線先前已驗證的 HTTP URL、contract 及邏輯 accessPoint，SHALL NOT 僅因 DSNS 快取到期而重新解析。新的登入世代 SHALL 使用新 token，PKI server key SHALL 清除並重取，不沿用舊 key。若連線尚未取得有效路由，reConnect SHALL 可重新嘗試原始 accessPoint 的解析。舊世代的解析/登入結果 SHALL NOT 覆寫新世代狀態。

#### Scenario: DSNS 過期且失聯，DSA 仍正常

- **WHEN** 任一模式以 DSNS/contract 完成路由解析，超過五分鐘後 DSNS 不可用但原 DSA 仍可用，呼叫者執行 reConnect
- **THEN** 客戶端不查詢 DSNS，向原已解析位址登入；PKI 重新取 server key 並沿用原 contract，getAccessPoint 保持原邏輯 URL

#### Scenario: 初次解析失敗後重新連線

- **WHEN** 尚未取得有效路由，呼叫者在 DSNS 恢復後執行 reConnect
- **THEN** 客戶端重新解析原始 accessPoint，成功後使用新 token 登入

### Requirement: 每次 ready 註冊只完成一次

legacy 與 PKI 的每次 ready(fn) 或 ready() SHALL 只在下一次目前世代的有效登入成功時完成一次。已登入時 SHALL 立即完成該次註冊，不永久保留 callback 或 resolver。登入中或登入失敗後的等待者 SHALL 保持 pending，後續 reConnect 成功時 SHALL 一次完成尚未完成的等待者。已完成通知 SHALL NOT 在後續 reConnect 重播。只有通過目前世代檢查的成功結果 SHALL 取得等待者快照並先清空佇列，再透過既有 invoke 執行 callback 及完成 Promise；舊世代結果 SHALL NOT 消耗佇列。callback 中新增的等待者 SHALL 依呼叫當下連線狀態處理，不混入已取出的快照。非同步成功快照中的 callback 例外 SHALL 在通知流程之外重新拋出，不阻止其他等待者完成；已登入時立即呼叫 ready(fn) SHALL 使用下述同步例外契約。

#### Scenario: 單一與多個等待者完成後連續重連

- **WHEN** 單一或多個 ready callback/Promise 已完成，之後連續 reConnect 成功兩次
- **THEN** 各原 callback 與 resolver 只執行一次，完成的等待者不再保留或重播

#### Scenario: 初次登入失敗後重連恢復

- **WHEN** 初次登入失敗而 ready 等待者尚未完成，之後 reConnect 成功
- **THEN** 等待者先保持 pending，不因失敗 reject，於該次目前世代成功時各完成一次，再次重連不重播

#### Scenario: 重連期間新增等待者

- **WHEN** 原等待者已完成，重連期間又註冊新的 ready callback/Promise
- **THEN** 新等待者在本次目前世代成功時各完成一次，原等待者不再次執行

#### Scenario: 回呼內再次註冊或重連

- **WHEN** 一個 ready callback 內呼叫 ready 或 reConnect，且成功快照仍有其他等待者
- **THEN** 已取出快照的等待者各完成一次，重連期間新增者留待下一次有效成功，已登入時新增者立即完成，不被佇列清空誤刪

#### Scenario: 舊登入先回應成功

- **WHEN** 新世代尚未完成，而被取代的舊世代回應成功
- **THEN** 舊結果不呼叫 callback、不完成或清空等待佇列，僅目前世代成功可完成等待者

### Requirement: 同步公開通知傳回 callback 例外

兩種 transport 中，已登入的 ready(fn)、已有 loginError 時註冊 OnLoginError(fn)、send 遇既有登入失敗，以及 send 的 options/header 正規化立即失敗 SHALL 視為同步通知路徑。同步 callback 例外 SHALL 原樣傳回呼叫端的 try/catch，SHALL NOT 改為 microtask 例外或被誤判為傳輸錯誤。已登入的 ready(fn) SHALL 在建立 Promise 之前執行 fn，不加入等待佇列；fn 拋出時 SHALL NOT 留下未回傳的 Promise。

同步 send 失敗 SHALL 使用既有錯誤欄位，依序標記 settled、依註冊順序通知 OnError、通知 result，最後拒絕 Promise；Promise rejection 的處理者 SHALL 在通知結束後才有機會執行。任一同步 callback 拋出時 SHALL 停止後續 callback，先為無法回傳給呼叫端的內部 Promise 掛上 rejection 處理者，仍拒絕該 Promise 並原樣拋出 callback 例外，SHALL NOT 留下額外 unhandledRejection。同步與非同步路徑 SHALL 共用錯誤格式與通知入口，不另建立不同錯誤結構。

#### Scenario: 已登入的 ready callback 拋出

- **WHEN** 呼叫者以 try/catch 呼叫已登入連線的 ready(fn)，且 fn 拋出例外
- **THEN** 呼叫端同步捕捉同一例外，不取得 Promise，不留下等待者或未處理的 Promise

#### Scenario: 已有登入錯誤時立即通知

- **WHEN** 已有 loginError，呼叫者以 try/catch 註冊會拋例外的 OnLoginError
- **THEN** callback 立即收到既有錯誤，例外同步傳回呼叫者，不另排程 uncaughtException

#### Scenario: 同步 send 正常失敗通知順序

- **WHEN** send 因既有登入失敗或 options/header 無效而立即失敗，所有 callback 正常返回
- **THEN** 依序執行所有 OnError，再執行 result，最後回傳的 Promise 以同一錯誤拒絕；輸入的請求與 options 不變

#### Scenario: 同步 send result 拋出

- **WHEN** 同步 send 失敗的 result 拋出例外
- **THEN** 先前 OnError 已完成，外層 try/catch 收到該例外，內部 Promise 拒絕已被收尾，不產生額外 unhandledRejection

#### Scenario: 同步 send OnError 拋出

- **WHEN** 一個 OnError 在 result 前拋出例外
- **THEN** 後面的 OnError 與 result 停止，外層 try/catch 收到該例外，內部 Promise 拒絕不產生額外 unhandledRejection

### Requirement: 非同步 callback 例外不觸發傳輸重試

登入完成、登入失敗及已送出服務請求的非同步 callback 通知 SHALL 維持流程外重新拋出例外的策略，SHALL NOT 因 callback 例外重送登入或服務，也不吞掉例外。其餘通知與 Promise SHALL 依既定非同步順序完成。README 與 CHANGELOG SHALL 明列此為相對於舊版部分登入 callback 被捕捉並重試的行為改變：例外將成為 uncaughtException，Node 預設可能以非零狀態結束，呼叫該 API 的外層 try/catch 無法捕捉；使用者須在 callback 內處理自身錯誤。SHALL NOT 以「例外隔離」暗示程序可安全繼續。

#### Scenario: 登入期間 ready 或 OnLoginError 拋出

- **WHEN** 非同步登入完成或失敗時，對應 callback 拋出未自行處理的例外
- **THEN** callback 執行一次、登入只送出一次，例外在流程外拋出；無自訂例外處理器的隔離 Node 子程序以非零狀態結束

#### Scenario: 非同步服務 result 或 OnError 拋出

- **WHEN** 已送出的服務回應通知 callback 時拋出例外
- **THEN** 不重送服務，不將 callback 例外改分類為 networkError；例外依流程外策略回報

### Requirement: Legacy 回應容忍度及 HTTP 分類

legacy SHALL 直接以 nodexml 解析回應，不使用嚴格 XML 驗證，不清洗控制字元或未知 entity。2xx 的 Code=0 SHALL 成功；其餘可解析內容 SHALL 使用舊版 dsaError/loginError 分支，即使缺少 Envelope/Header/Status。缺 Status 的 status/message SHALL 為空字串，有 Status 而無 Message SHALL 保留 undefined，兩模式皆不得用空字串取代缺失 Message。登入 DSA 失敗 SHALL 保留原始 data、HTTP response 與 textStatus=unknow。真正解析例外 SHALL 不重試，服務以 xml_error、登入以終止 loginError 回報。

兩模式非 2xx SHALL 先讀取內容；有效非空字串非零 DSA Code SHALL 依階段回報 dsaError/loginError 並保留 HTTP response。其餘非 2xx SHALL 為 http_error，不將 Status=0 視為成功。PKI 另依通道驗證規定，SHALL NOT 降級或重送。

#### Scenario: Legacy 回傳非標準 XML 文字

- **WHEN** legacy 的 2xx 成功 envelope 包含直接 U+001A、&#x1A; 或 &nbsp;
- **THEN** SHALL 得到與 nodexml 1.0.2 相同的 Body 與完整解析回應，不改值或整筆拒絕

#### Scenario: 可解析但缺少 envelope 或 status

- **WHEN** legacy 取得 2xx HTML、空內容或缺少 Status 的可解析內容
- **THEN** 服務 SHALL 回報舊版 dsaError 欄位，登入 SHALL 保留原始回應與 textStatus=unknow，不誤分類為 XML 解析例外

#### Scenario: 非 2xx 的 DSA 錯誤及非錯誤內容

- **WHEN** legacy 取得 HTTP 500 與 DSA Code 501，或非 2xx 的 HTML/空內容/Code 0
- **THEN** 前者 SHALL 保留 DSA status/message/header 及 response；後者 SHALL 回報 http_error，文件明列相較舊版的不相容分類

#### Scenario: 重連不連鎖通知

- **WHEN** OnLoginError callback 呼叫 reConnect 並處理其 rejection，而重連再次登入失敗
- **THEN** SHALL 只通知初次登入一次，不連鎖執行 callback；重連 Promise 與排隊請求各失敗一次，舊世代失敗不通知目前世代

### Requirement: 本機物件 Body 序列化失敗可辨識

兩模式物件 body 的非法 XML 字元及元素名稱 SHALL 在服務 HTTP 送出前以 networkError.type=xml_error 回報；result、OnError、Promise SHALL 依非同步通知契約各結束一次，不清洗、替換或刪除資料，不重送。文件 SHALL 明列舊版會送出而新版本機拒絕，伺服器接受度未實測。

#### Scenario: 控制字元或非法名稱

- **WHEN** 已登入連線傳送含 U+001A 或 key=1st 的物件 body
- **THEN** SHALL 不發服務 HTTP，result/OnError/Promise 收到同一 xml_error，呼叫者物件不變

### Requirement: XML 名稱符合 Fifth Edition

物件 Body 元素/屬性及 PKI XML 驗證的名稱 SHALL 使用 XML 1.0 Fifth Edition 完整 NameStartChar、NameChar 範圍，SHALL NOT 以 Unicode 類別近似或改寫名稱。解析名稱的分隔空白 SHALL 僅為 XML S 的四種字元，不將 JavaScript 廣義空白當作分隔符。驗證與送出 SHALL 保留合法名稱原 code points；回應物件 SHALL 保留 nodexml 既有解析行為，不另重塑 key。非法名稱 SHALL 依本機 xml_error 或回應 pki_error 拒絕。

#### Scenario: 合法與非法名稱對照標準 parser

- **WHEN** 測試合法/非法首字、後續字元、每個範圍邊界與補充平面，包含成績（期中）、a+U+0301、x+U+203F、U+3001+x 與 x+U+00B2
- **THEN** 送出物件 Body 名稱與 PKI 解密回應的接受結果 SHALL 與標準 XML parser 一致，合法名稱原樣傳遞，不放寬其他 XML/密文防護

### Requirement: 位址錯誤使用中性分類

兩模式非字串 accessPoint 及無效 HTTP(S)/DSNS 結果 SHALL 透過 loginError 回報，XMLHttpRequest.type SHALL 為 access_point_error，SHALL NOT 標成 pki_error；既有空 accessPoint 同步拒絕維持。PKI 缺少 contract 的錯誤 SHALL 仍為 pki_error。

#### Scenario: 無效位址與 DSNS 結果

- **WHEN** 任一模式取得非字串非空 accessPoint，或 DSNS/直接位址無有效 HTTP(S) hostname
- **THEN** SHALL 不送出登入/公鑰請求，登入與排隊 send 以同一 access_point_error 結束

#### Scenario: 初次登入被失敗重連取代

- **WHEN** 初次登入仍進行中，呼叫者 reConnect 且新世代失敗，不同段落已註冊 OnLoginError 與 ready
- **THEN** SHALL 不呼叫既有 OnLoginError，重連 Promise 與排隊 send 各回報失敗；舊世代結果不通知，ready 保持 pending 並在下一次有效成功完成。README SHALL 明示此邊界及不要重複輪詢建立 ready 等待者，不改接受新等待者的契約

### Requirement: 保留傳輸拒絕原因

fetch 與讀取 body 的失敗 SHALL 保留可辨識的 name/message，不因設定 retryable 另拋 TypeError。可修改 Error SHALL 沿用；其他值 SHALL 包裝為帶原值 cause 的 Error，primitive message SHALL 為 String(reason)，凍結 Error SHALL 保留原 name/message。公開錯誤欄位 SHALL 不增加 cause，內部 cause 保留供登入錯誤/測試辨識；無法轉字串值 SHALL 以通用訊息終止而不再次失敗。既有登入 retry 上限與服務不重送 SHALL 不變。

#### Scenario: 取消原因與不可修改例外

- **WHEN** 服務以預設 abort 或字串/null reason 取消，或 fetch/text 拒絕凍結 Error/物件
- **THEN** 預設取消 SHALL 保持 AbortError；其他拒絕 SHALL 保留原因，不出現設定 retryable 的 TypeError，callback/OnError/Promise 正常結束

#### Scenario: 登入傳輸拒絕非 Error

- **WHEN** 內部登入 fetch/text 每次拒絕字串或 null
- **THEN** SHALL 依原規則最多四次後回報一次登入終止失敗，保留 cause 與原因，不提前因 metadata TypeError 失敗

### Requirement: 非傳輸登入例外也結束失敗操作

目前世代登入流程 catch SHALL 安全處理 null、undefined 與其他 JS 拋出值；retryable/message 的讀取或轉字串 SHALL NOT 造成第二個例外。未標 retryable 的 DSNS/token getter 例外 SHALL 不新增重試，XMLHttpRequest SHALL 保留原值，無可辨識訊息 SHALL 使用 Network error occurred。初次失敗、重連失敗、排隊/後續 send、ready 及舊世代 SHALL 各遵守既有通知/隔離契約。

#### Scenario: DSNS 或 token getter 拋 null

- **WHEN** 目前世代的 DSNS lookup 或 token getter 拋 null/undefined
- **THEN** SHALL 不產生額外 unhandledRejection，初次登入通知一次 OnLoginError 並結束排隊/後續 send；reConnect 時 SHALL 拒絕自身 Promise 而不通知既有 handler；ready SHALL pending 且於之後有效重連成功完成
