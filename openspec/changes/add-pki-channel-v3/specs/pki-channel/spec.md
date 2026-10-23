## ADDED Requirements

### Requirement: 明確選擇傳輸模式

客戶端 SHALL 接受 `open(accessPoint, token, options?)`，其中 `options.transport` 僅接受 `legacy` 或 `pki`，省略時 SHALL 使用 legacy。無效選項或未知模式 SHALL 在任何 HTTP 請求之前同步拋出 TypeError。所選模式 SHALL 在 reConnect 後保持不變。客戶端 SHALL 沿用 accessPoint 路徑中的 contract，SHALL NOT 新增獨立 contract 選項；第三參數含 contract 欄位 SHALL 視為無效設定。

#### Scenario: 既有呼叫省略選項
- **WHEN** 呼叫者以兩個參數建立連線
- **THEN** 客戶端使用既有未包裝的 DSA 傳輸，不取得 PKI 公鑰

#### Scenario: 呼叫者選擇 PKI
- **WHEN** 呼叫者將 transport 設為 pki
- **THEN** 客戶端在加密 DS.Base.Connect 之前取得公鑰，並以 PKI 傳送全部服務呼叫

#### Scenario: 設定無效
- **WHEN** options 無效、transport 未受支援或第三參數含 contract 欄位
- **THEN** open 拋出 TypeError，且不傳送 HTTP 請求

### Requirement: Doorway 路由與公鑰初始化

PKI HTTP 請求 SHALL 傳送至不含 contract 路徑的 doorway URL。客戶端 SHALL 沿用 DSNS/contract 或完整 doorway/contract 格式，從最後一個非空路徑段取得 contract，保留前面的 doorway 路徑，不要求獨立 contract 選項或固定服務名稱。取公鑰請求 SHALL 包含 TargetContract info、TargetService Public.GetPublicKey、Body/Content/Contract 指定目標 contract，以及 Format pkcs8，且不含 security token。客戶端 SHALL 解析回傳的 RSAKeyValue 公鑰，且 SHALL NOT 以 DSA 版本限制 PKI。

#### Scenario: DSNS-relative contract
- **WHEN** 呼叫者以 PKI 開啟 school/SystemMaintenance
- **THEN** 客戶端解析 school，將公鑰請求及後續加密請求傳送至解析後的 doorway，contract 使用 SystemMaintenance

#### Scenario: 多層 doorway 與任意 contract
- **WHEN** 呼叫者提供 https://example.test/dsa/doorway/Any.Contract/，可包含 query 與 fragment
- **THEN** 客戶端將尾段 Any.Contract 作為 contract，保留前面的 doorway 路徑及 query、排除 fragment，且 HTTP 目標不附加 contract

#### Scenario: 無法決定 contract
- **WHEN** PKI 初始化無法取得明確非空的 contract 與有效 doorway
- **THEN** 客戶端在傳送任何認證 token 之前失敗

#### Scenario: DSNS-relative 缺少有效尾段

- **WHEN** PKI accessPoint 為 school/、school///、school/%20 或含編碼空白的尾斜線路徑
- **THEN** 客戶端 SHALL 在 DSNS lookup 前以 loginError 回報 PKI requires a contract path，不取公鑰、不送 token；查詢前後 SHALL 共用去掉尾斜線、取最後一段、decodeURIComponent 後 trim 判空的規則，query/fragment 不作為 contract，legacy 與完整 URL 既有路由不改

#### Scenario: 客戶端不以舊版版本號阻擋初始化
- **WHEN** 測試提供低於 4.8.3.19 的版本資訊，且模擬端點提供有效 PKI 公鑰
- **THEN** 客戶端不查詢或檢查版本門檻，繼續依 PKI 協定嘗試登入；此結果僅證明客戶端沒有 gating，不宣稱真實舊版伺服器已接受登入

#### Scenario: PKI 只提供 DSNS 名稱
- **WHEN** 呼叫者執行 open('school', token, { transport: 'pki' }) 而沒有 contract 路徑
- **THEN** 客戶端在取公鑰與送出認證 token 之前透過 loginError 回報，legacy 同型呼叫的既有允許行為不改變

### Requirement: 加密每個完整內層 envelope

每個加密請求 SHALL 使用全新 UUID，以其 MD5 digest 作為 AES-128-ECB 金鑰並採 PKCS7 padding，UUID 則以伺服器 RSA 公鑰與 PKCS1 padding 加密。外層 envelope SHALL 包含 Header/TargetContract、Type 為 Static 的 CryptoToken（SecretKey、AES 加密的 client PublicKey XML、Cipher），以及空 Body。內層 envelope SHALL 包含 TargetContract、TargetService、SecurityToken 與原 body。認證 token 與 SQL 原文 SHALL NOT 出現在密文外。

#### Scenario: 字串 token 初次登入
- **WHEN** PKI 連線收到字串 token
- **THEN** DS.Base.Connect 的 PassportAccessToken 與 AccessToken 僅存在於加密的內層 envelope

#### Scenario: Passport 物件或 Session token
- **WHEN** 呼叫者提供物件 token 或登入已取得 Session
- **THEN** 對應 security token 在加密內層 envelope 中維持既有 XML 形狀

#### Scenario: 並行請求
- **WHEN** 兩個加密請求以相反順序完成
- **THEN** 各回應以各自請求的金鑰解密並交付各自呼叫者

### Requirement: 解密回應且不降級

客戶端 MUST 使用對應請求金鑰解密回應 Cipher，並以 nodexml.xml2obj 解析解密後 XML。沒有 Cipher 的回應 SHALL 僅能被接受為有效的非零 DSA 錯誤 envelope。取得公鑰、解析金鑰、加密、解密或驗證 envelope 失敗時 MUST NOT 以明文重送，亦不得自動切換至 legacy 或 shiftSql。

#### Scenario: 加密服務成功
- **WHEN** 回應解密後為有效 envelope 且 DSA status 為 0
- **THEN** 呼叫者收到與相同 legacy 回應一致的解析後 Body

#### Scenario: 無 Cipher 的伺服器錯誤
- **WHEN** 伺服器回傳有效明文 envelope 且 DSA status 非零
- **THEN** 客戶端依目前階段透過既有 loginError 或 dsaError 回報，不重新送出請求

#### Scenario: Cipher 無效或收到非預期明文成功
- **WHEN** Cipher 為空或無效、解密失敗、解密後 XML 無效，或無 Cipher 回應聲稱成功或缺少 DSA status
- **THEN** 操作透過既有錯誤欄位失敗，且不發送明文請求

#### Scenario: 公鑰失敗
- **WHEN** 公鑰請求失敗或回傳金鑰無效
- **THEN** 登入失敗，且不傳送未加密 security token

### Requirement: 金鑰生命週期符合其範圍

客戶端 SHALL 在 PKI 首次需要時產生同一 Node.js 執行環境至多一組 client RSA-1024 key pair（跨套件副本共用、worker 各自隔離），重用其公鑰 XML，且不保留私鑰。Server key 與初始化工作 SHALL 限於各連線。reConnect SHALL 清除 server key 並在登入前重新初始化 PKI。舊初始化與登入完成事件 SHALL NOT 覆寫較新連線世代的狀態。

#### Scenario: 同一連線大量呼叫
- **WHEN** 多個服務請求在同一個已初始化連線中排隊或傳送
- **THEN** 各請求共用該連線的 server public key 與 該執行環境的 client public key，但使用不同 UUID 與 AES key

#### Scenario: 重新連線或不同連線
- **WHEN** 呼叫者重新連線或開啟另一連線
- **THEN** 該次初始化取得自己的 server public key，不借用其他連線的快取金鑰

#### Scenario: 重連期間舊登入完成
- **WHEN** 新 reConnect 開始之後，舊登入或重試才完成
- **THEN** 舊操作不能取代新 token、ready 狀態或 server key

### Requirement: 保留呼叫者選擇的 SQL 編碼

客戶端 SHALL 原樣傳送呼叫者提供的 SQL 與 Seed，不自行套用 shiftSql、增刪 Seed 或偵測 SQL 編碼。客戶端 SHALL 同時支援 legacy 請求的使用端 shiftSql 加 Seed，以及 PKI 請求的原文 SQL 不帶 Seed。

#### Scenario: 呼叫者選擇既有 shiftSql 策略
- **WHEN** legacy 連線傳送呼叫者產生的 shifted SQL 與 Seed
- **THEN** 解析後的送出 body 保留這些值，且不進行 PKI 公鑰握手

#### Scenario: 呼叫者選擇 PKI 原文 SQL
- **WHEN** PKI 連線傳送不含 Seed 的中文原文 SQL
- **THEN** 解密請求後 SQL 原文不變，且不新增 Seed

### Requirement: PKI 的 HTTP 錯誤不遮蔽 DSA 錯誤

公鑰、外層及解密後 XML SHALL 嚴格驗證；非法控制字元/參照及未知 entity SHALL 使該回應失敗，即使 legacy 可容忍。README SHALL 明列此限制。非 2xx SHALL 先讀取內容，但 SHALL NOT 接受成功回應或 RSA key 為成功。

#### Scenario: 非 2xx 的明文 DSA 錯誤

- **WHEN** 公鑰、登入或服務取得 HTTP 500 與合法明文 Code 501 envelope
- **THEN** SHALL 保留該 DSA 錯誤及 HTTP response，依階段使用 loginError/dsaError，不重試或降級

#### Scenario: 非 2xx 的加密 DSA 錯誤

- **WHEN** 登入或服務取得 HTTP 500，Cipher 驗證及解密成功且內層 Code 501
- **THEN** SHALL 保留解密後 DSA 錯誤與 response，依階段使用 loginError/dsaError

#### Scenario: 非 2xx 沒有有效 DSA 錯誤

- **WHEN** 無 Cipher 的非 2xx 為 HTML/空內容/Code 0，或有效加密回應的 Code 為 0，或公鑰回應是 RSA key
- **THEN** SHALL 回報 http_error；已辨識的損壞 Cipher SHALL 維持 pki_error，不因 HTTP 狀態放寬驗證

#### Scenario: 解密後文字含非法 XML 字元

- **WHEN** Cipher 可解密但內層含 U+001A、&#x1A; 或 &nbsp;
- **THEN** SHALL 以 pki_error 拒絕整筆回應，不改值、不重試、不切換 legacy

### Requirement: PKI 避免同份 XML 重複驗證

公鑰及通道的明文 DSA 錯誤 SHALL 對同份原文嚴格驗證一次並重用解析結果；加密回應 SHALL 對外層與解密內層各驗一次。字元檢查 SHALL 不以產生後丟棄的跳脫字串達成，重用 hasCipher 判定，SHALL NOT 放寬非法 XML、損壞 Cipher 或明文成功的拒絕規則。

#### Scenario: 明文錯誤與密文成功

- **WHEN** 公鑰/服務收到明文 DSA 錯誤，或服務收到加密成功回應
- **THEN** 明文原文 SHALL 僅驗一次，密文外層/解密內容各一次，且既有錯誤分類與不降級規則不變

### Requirement: 正規化前驗證 PKI 原始路徑

完整 URL 與 DSNS-relative SHALL 共用 doorway/contract 切分 helper，於 URL 正規化前檢查原始 path；DSNS-relative SHALL 在 lookup 前完成檢查。點路徑段 . / ..（含百分比與混合大小寫編碼）、解碼後含 / 或反斜線（含編碼形式）、原始 path 內部 tab/CR/LF、無效百分比/UTF-8 編碼 SHALL 以 pki_error 終止。無效 DSNS doorway 的原始 path SHALL 在取公鑰前拒絕。SHALL NOT 將 query/fragment 視為 path 或拒絕一般名稱中的點；legacy SHALL 維持既有路由。

#### Scenario: 點路徑、反斜線與格式錯誤

- **WHEN** PKI 路徑含 literal/編碼 . 或 ..、反斜線或無法解碼的 segment
- **THEN** SHALL 不查 DSNS、不送公鑰/登入請求，以 pki_error 回報，不把正規化後的其他段當成 contract

#### Scenario: 正常路由與點字元

- **WHEN** PKI 路徑為多層 doorway/Any.Contract，帶尾斜線、合法編碼中文、query 或 fragment
- **THEN** SHALL 沿用原路由與 contract，保留 query、移除 fragment，不將 query/fragment 的 .. 或反斜線誤判為 path

#### Scenario: 編碼斜線不能成為 contract 內的分隔符

- **WHEN** 任一 PKI 原始 path segment 解碼後含 /，例如 ..%2F..%2Fadmin、Any%2fContract，或 DSNS 回傳 doorway 含此編碼段
- **THEN** SHALL 以 pki_error 拒絕；DSNS-relative 輸入不 lookup，直接 URL/回傳 doorway 不送公鑰/登入，不將解碼分隔符視為 contract 名稱一部分；query/fragment 不受此規則影響
