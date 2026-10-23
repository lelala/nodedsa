## Context

`app.js` 的 `open()` 會立即解析 DSNS 並登入，現有 URL 通常是 `doorway/contract`。登入與 `send()` 各自組 XML 並呼叫 fetch，因此只包裝 send 無法保護初次 AccessToken。回應皆由 nodexml 解析，登入成功後將非 Session token 換成 Session。

參考來源為本機 `~/.ai/skills/dsa-sql-lite/lib/dsutil/secure_tunnel.ts`，協定已由使用者提供實測紀錄。本次不重新把公開網路資訊當協定依據。

`1campus.dsa.sync.core/server/src/dsaCryptoSql.ts` 負責版本判斷、shiftSql、Seed、三小時連線快取與回應轉換；`syncCore.ts` 另有 UDM 連線。該專案僅供唯讀參考。字串 PassportAccessToken 經 PKI 尚待非正式環境實測。

## Goals / Non-Goals

**Goals:** 建立登入前通道，提供明確傳輸模式，保護所有後續服務，保留資料與錯誤契約，支援不辨識業務欄位的物件 body 文字 entity 序列化及可驗證的套件封裝。

**Non-Goals:** 不搬移 shiftSql 與版本策略、不辨識 SQL 欄位或服務、不自動轉換 SQL 或移除 Seed、不自動降級、不修改使用端專案或執行正式系統操作。不新增初始化/登入逾時或連線級 Fetch options，不改 ready() 失敗保持 pending 的契約，也不修正獨立 dsnsLookup 的既有 spec 差異。

## Decisions

### 1. 連線層選模式，SQL 策略由使用端選擇

新增第三參數 `open(accessPoint, token, options?)`，`transport` 僅接受 `legacy`、`pki`，省略時為 legacy。未知模式或無效選項同步拋 TypeError，且不得發出 HTTP。採用 legacy 預設以保留兩參數呼叫；不採預設 PKI，避免套件升級後未經選擇就改變所有登入。

沿用現有 `DSNS/contract` 或完整 `doorway/contract` 輸入，不新增公開 `contract` 選項。PKI 在內部以最後一個非空路徑段取得 contract，前面路徑保留為 doorway；先去除尾斜線，以 URL 結構處理 query 與 fragment，不以字串拼接猜測路由。完整 URL 保留 doorway 的 query，fragment 不送出。DSNS-relative 以第一個斜線前的名稱查詢 doorway，後續路徑按相同尾段規則組合與拆分。

完整 URL 如 `https://example.test/dsa/doorway/Any.Contract/`，內部得到 doorway `https://example.test/dsa/doorway` 與 contract `Any.Contract`。僅有 DSNS 名稱的既有兩參數 legacy 呼叫照原邏輯處理；PKI 未提供 contract 路徑則回報初始化失敗，不猜測預設 contract。含糊的自訂路由須由呼叫者使用標準 doorway/contract 格式，而非為單一使用端新增旁路 API。

```js
// 既有使用端：呼叫方式與預設模式保持不變。
const existing = nodedsa.open('school/Any.Contract', token);
const legacy = nodedsa.open('school/Any.Contract', token, { transport: 'legacy' });

// PKI：相同 accessPoint 格式，只指定傳輸模式。
const pki = nodedsa.open('school/Any.Contract', token, { transport: 'pki' });
const fullUrl = nodedsa.open('https://example.test/dsa/doorway/Any.Contract', token, {
  transport: 'pki'
});
```

兩種模式都接受一般服務與任意合法 contract，不將 SQL、SystemMaintenance 或同步專案當作前置條件。
nodedsa 不提供名為 shiftSql 的 transport，因為 SQL 內容編碼與完整 envelope 傳輸屬不同層次；它照原值送出使用端的 Seed 與 SQL，PKI 不會自動刪除 Seed。文件以「PKI＋原文 SQL」和「legacy＋使用端 shiftSql」說明實際選擇。

DSNS-relative 在 lookup 前先取 query/fragment 之前的路徑，以與解析後共用的函式去掉尾斜線、取最後一段、decodeURIComponent 後 trim 判空；school/、school///、school/%20 及編碼空白尾斜線均以 PKI requires a contract path 終止，不查 DSNS、不取公鑰、不送 token。無效百分比編碼同樣在 lookup 前失敗。完整 URL 既有末段推定與 legacy 路由不改。

### 2. 共用傳輸入口，初始化先於登入

狀態流程：解析與驗證 doorway → PKI 取公鑰（legacy 略過）→ DS.Base.Connect → ready → queued/send。`getAccessPoint()` 保留解析後的邏輯連線 URL（doorway/contract）；只有內部 PKI fetch 使用 doorway。兩種模式對外均維持相同 accessPoint 表示。

取公鑰是唯一預期的明文 PKI 請求，不含 token：Header 為 `TargetContract=info`、`TargetService=Public.GetPublicKey`；Body 為 `Content/Contract` 與 `Content/Format=pkcs8`。雖然 Format 稱 pkcs8，回應依協定以 RSAKeyValue/Modulus/Exponent 解析，轉 JWK 後建立 crypto KeyObject；驗證 HTTP、DSA 錯誤、缺欄位、無效 base64 與無法使用的公鑰。Contract 等 XML 文字亦須跳脫。

登入與業務請求使用相同 encode/post/decode 流程。PKI 公鑰、外層與解密後 envelope 在 nodexml 前做嚴格 XML 檢查，拒絕不平衡標籤、無效字元/參照、重複屬性與 DTD，不解析外部 entity；legacy 回應不經此檢查，保留 nodexml 的控制字元/未知 entity 容忍度。不增加正式 XML parser 依賴。PKI 內層 Header 包含 TargetContract、TargetService、SecurityToken；Body 保持現有結構。登入成功後仍改用 Session（原本已是 Session token 時沿用）。物件 token 不改形狀，字串 token 正規化為 PassportAccessToken。`send(request, fetchOptions)` 的 headers、signal 等規則保持原樣，呼叫者不能用 method/body 覆寫加密 envelope。

### 3. 精確遵守混合加密格式

每次 HTTP 加密請求各自建立 `randomUUID()`，對 UUID UTF-8 bytes 取 MD5 得到 16-byte AES key。整個內層 envelope 使用 AES-128-ECB＋PKCS7；UUID 以 server public key＋RSA_PKCS1_PADDING 加密。外層為 Envelope/Header/TargetContract 與 CryptoToken Type="Static"，其 SecretKey 為 RSA 密文，PublicKey 為 AES 加密的 client RSAKeyValue XML，Cipher 為 AES 加密的 envelope，Body 為空。所有密文 base64 編碼。

請求的 AES key 只留在該次請求 context，避免並行或回應亂序時混用。回應若有 Cipher 必須以對應 key 解密，再以 nodexml.xml2obj 解析。缺 Cipher 僅接受有效的非零 DSA status 明文錯誤；明文 status=0 或缺 status 的回應視為協定失敗，不接受為成功。Cipher 存在但為空、非法 base64、padding 錯誤或解密後非有效 envelope 都失敗，不當作「沒有 Cipher」。

不改用 OAEP、GCM 或其他演算法，因為需相容既有 DSA wire protocol。

### 4. 金鑰生命週期及重連

client RSA-1024 key pair 延遲產生，同一 Node.js 執行環境透過 global Symbol 保存公鑰 XML，跨套件副本至多一次；worker 各自隔離，私鑰不持久化。與每請求同步產生相比可消除大量阻塞；保留 PublicKey 欄位以相容協定。

server public key 與 initialization Promise 屬連線，不使用全域跨校快取。初始化與登入中的 send 只排隊，不重複取公鑰。`reConnect()` 保留模式及已驗證路由的 url、contract、logical，不因五分鐘 DSNS 快取到期重新解析；只清除 server key、登入重試計數及終止錯誤，再初始化 PKI 並登入。尚未取得有效路由時才重新解析原始 accessPoint。此決策保留 2.1.0 沿用已解析 _accessPoint 的行為，避免 DSNS 短暫故障阻止連到正常 DSA；要重新解析服務位置須建立新的連線物件。使用連線世代或等效機制，防止舊登入/重試回應覆寫重連後狀態；已發送請求仍以自己的 AES key 處理回應。

### 5. 失敗不降級，對齊既有錯誤契約

初始化/登入階段失敗走既有 loginError 欄位（data、textStatus、XMLHttpRequest、statusCode、message），初次登入觸發 OnLoginError，重連失敗只拒絕 reConnect Promise、不重播既有處理器；排隊及之後的 send 以 `{ loginError, dsaError: null, networkError: null, ajaxException: null }` 結束 callback、Promise 與 OnError；同步 callback 拋出時依決策 8.2 停止後續通知並收尾內部 Promise。重連 Promise 也必須拒絕並恢復生命週期回呼，不可永遠 pending。

HTTP 與回應解析依決策 5.1 分類。業務階段非零 DSA status 維持 `{ loginError: null, dsaError: { header, status, message }, networkError: null }`。HTTP、XML、通道加解密失敗走既有 networkError，type 可標示 `pki_error`；不新增頂層錯誤型別。客戶端自行產生的錯誤訊息不得額外附加 token、SQL、原始加密金鑰；伺服器回傳的 DSA header/status/message 維持既有值，不宣稱伺服器本身一定不回傳敏感內容。回呼迴圈不得共用索引，確保多筆排隊請求各結束一次。非同步 callback 自行拋出的例外在 transport 流程之外重新拋出，不把它當登入/網路錯誤重試，也不阻止其他排隊請求完成；同步 API 通知則恢復原樣往外拋出，具體順序見決策 8.2。

保留既有登入暫時性網路失敗的有界重試（初次加最多三次重試），但每次登入都須經所選通道；公鑰解析與密文格式等確定性錯誤直接終止。業務請求不自動重送，避免 SQL 寫入重複執行。通道不可用絕不改送明文，也不可自行重走 shiftSql。

### 5.1 HTTP、legacy 容忍度與本機序列化錯誤

post 僅負責 fetch 與讀取 body，不在讀取前因 HTTP 狀態丟棄內容。legacy 使用 nodexml，不檢查 XML 字元/標籤平衡；2xx 時以舊版內容分支判定：Code=0 成功，否則走 dsaError/loginError，即使缺 Envelope/Header/Status。登入失敗保留原始 data、response、textStatus=unknow；缺 Status 時 status/message 為空字串，有 Status 但無 Message 時維持 undefined，不以 || 改值。真正解析例外服務走 xml_error、登入走終止 loginError，不重試；只有 fetch/text rejection 可重試，每次登入重新計數最多初次加三次。

兩模式非 2xx 若得到有效非空字串非零 Code 的 DSA 錯誤，保留既有錯誤欄位及 response；其餘（HTML、空內容、缺 status、Status=0）回報 http_error，登入仍透過 loginError 包裝。此採混合分類，與舊版忽略 HTTP 狀態不同，須在 breaking 清單明列。取公鑰階段同樣保留合法明文非零 DSA 錯誤；非 2xx 的 RSA key 不能當成功。PKI 依然驗證外層 XML、Cipher 與解密後 XML；已辨識 Cipher 的毀損維持 pki_error，即使 HTTP 非 2xx；沒有 Cipher 的非 2xx 非 DSA 錯誤則 http_error，2xx 的明文成功/無效回應則 pki_error。不降級、不重送。

以 state 明確記錄 initial/reconnect，而不是從 waiter 是否存在猜來源。只有 initial 失敗通知既有 OnLoginError；重連失敗拒絕對應 Promise、結束排隊/後續 send，callback 陣列不置換或刪除。晚註冊 OnLoginError 在已有錯誤時仍立即同步通知。這是撤回前版 spec 明列的重連通知，避免 OnLoginError(()=>reConnect()) 形成無延遲連鎖。同步專案目前 server 原始碼未找到 reConnect 呼叫，dsaCryptoSql 同時在 OnLoginError 與查詢 catch 刪快取；不將歷史網路錯誤與排程停頓寫成已驗證因果。

兩模式物件 body 在 HTTP 前序列化，非法字元/名稱仍拒絕，但分類為 xml_error 而非 fetch_error，不清洗、刪字或改為 raw XML。此為明列的 legacy breaking change；舊版送出這些內容的伺服器接受度未實測。raw XML fragment 契約維持原樣。第三參數拒絕舊版忽略的 null/未知欄位、同步失敗通知統一 OnError→result，與非同步 callback 順序一致；舊版已失敗登入後的 send 僅 result 且 Promise pending，不誤稱所有舊路徑皆同序。

### 5.2 XML 名稱、位址分類與驗證工作量

名稱依 XML 1.0 Fifth Edition productions [4]/[4a]/[5] 的完整 code point 範圍，不使用 Unicode L/N 類別近似；例如成績（期中）、a+U+0301、x+U+203F、U+3001+x 合法，x+U+00B2 不合法。與開發用 saxes 差異測試涵蓋每個範圍邊界、補充平面、合法/非法首字與後續字元，並涵蓋物件 Body 元素/屬性與 PKI 解密後的回應。名稱驗證與送出不正規化、不改字，保留原 code points；回應仍採 nodexml 既有解析（它本身可能對 U+1680/U+FEFF 等 JS 空白名稱改變物件 key），不另外修正或重塑 parser 結果。標籤/屬性名稱解析的分隔空白僅使用 XML S（U+0020/U+0009/U+000A/U+000D），不用 JavaScript 的廣義 \s；另測 U+1680、U+FEFF 等可作名稱但被 JS 視為空白的字元，以及 U+2000 等不可誤當分隔符的字元。

非字串 accessPoint 與無效 HTTP(S)/DSNS 結果回報 loginError.XMLHttpRequest.type=access_point_error，兩模式共用；原先 pki_error 是誤分類。既有空 accessPoint 同步拒絕不變，PKI 缺 contract 仍 pki_error。文件列出 type 值改變。

嚴格字元檢查拆為不回傳跳脫字串的私有函式，escapeText 驗完才跳脫；validateXml 的文字/CDATA 只做驗證。解析後 Envelope 結構檢查與 validateXml 分開：公鑰明文 DSA 錯誤、通道明文錯誤對原 XML 只驗一次並重用已解析物件；密文外層和解密內層是兩份 XML，各驗一次。parseEnvelope 的入口本身仍嚴格驗證，不提供公開 skip-validation 參數；hasCipher 重用單次 regex 結果。此為避免重複工作，不宣稱已證實 7 MB/350 ms 或任何效能數字。

初次登入尚未完成即 reConnect 時，新世代仍為 reconnect，不沿用 initial；被取代者的結果一律忽略，新重連失敗只 reject Promise 並結束排隊請求，即使 OnLoginError 從未通知。由不同程式段落註冊的 OnLoginError 也不會代收重連結果。ready 保持 pending，未完成者仍在下一次有效成功完成；不丟棄或拒收新等待者。文件提醒使用者保留單次 ready 等待，不以 timer 等方式持續建立等待者。

### 5.3 傳輸拒絕值、原始 PKI 路徑與 npm CLI

fetch/text 可拒絕任何 JS 值。若原值是可修改 Error，沿用並標記 retryable，維持 DOMException AbortError 的 name/message；若設定失敗或非 Error，建立帶 cause 的 Error。primitive 的 message 用 String(reason)，轉字串失敗才用通用訊息；凍結 Error 沿用 name/message/stack/type。不要讓 metadata 設定掩蓋原始錯誤。cause 僅保留內部原值，公開 networkError 仍維持既有欄位；可辨識的 name/message 必須保留。服務 signal 取消不重送，內部登入 fetch/text 失敗仍受原有最多四次規則限制。

共用 splitPkiRoute 從原始文字（排除 query/fragment）取得 path，逐段解碼並檢查，在 new URL 正規化前拒絕 literal/混合編碼 .、..，以及解碼後含 / 或反斜線（包含編碼形式）與無效百分比/UTF-8 編碼，皆 pki_error。原始 path 的 tab/CR/LF 會被 URL parser 移除，也拒絕以免點路徑繞過；只採 URL 定義的 C0/ASCII 空白頭尾處理，不 trim 一般 Unicode contract 字元。DSNS-relative 在 lookup 前先做相同檢查與缺 contract 檢查；DSNS 回傳 doorway 若不安全亦在取 key 前拒絕。helper 同時回傳 raw doorway path 與解碼 contract，不各自重做切分。正常尾斜線、任意合法 contract、encoded Unicode、query 保留、fragment 去除及 legacy 路由沿用原契約。僅含點的路徑段拒絕，名稱中的點及 query/fragment 的點不拒絕。直接無效 URL 仍為 access_point_error，PKI contract 缺失或編碼錯誤為 pki_error。

Windows 的 npm.cmd 不能在目前受支援 Node 的無 shell execFileSync 直接執行（Node CVE-2024-27980 官方行為），先前僅寫未實機驗證不夠精確。開發腳本用 process.execPath 執行絕對 npm-cli.js 路徑，優先 npm_execpath；無此變數時檢查 Node 同目錄 node_modules/npm/bin/npm-cli.js 或父層 lib/node_modules/npm/bin/npm-cli.js，找不到就明確報錯，不靠 PATH/猜測或 shell。npm_execpath 若提供但無效直接報錯；參數維持陣列並測含空白/符號的路徑。此變更只改維護工具，仍不能以 macOS 模擬取代 Windows 實機驗收。

### 5.4 編碼分隔符與非傳輸登入例外

每段僅 decodeURIComponent 一次，解碼結果若含 / 或反斜線就拒絕，不再當作單一 contract/doorway segment；例如 ..%2F..%2Fadmin 目前不改寫 HTTP doorway，但可把 ../../admin 夾入 TargetContract，因此補 pki_error 防護。完整 URL、DSNS-relative（lookup 前）、回傳 doorway（取 key 前）都適用；query/fragment 不在此範圍，不遞迴解碼或改值，legacy 不改。

runLogin catch 不假設例外非 null/undefined 或有 message；安全讀取 retryable，只保留原本已標記的傳輸 retry 規則，不因一般 DSNS/token getter 例外新增重試。message 無法取得或轉字串時用 Network error occurred，XMLHttpRequest 保留原例外值。避免 catch 自身再失敗造成 unhandledRejection；目前世代初次失敗通知 OnLoginError，所有排隊/後續 send 結束，reConnect 失敗拒絕自身 Promise；ready 仍 pending，之後有效成功可完成。舊世代例外不通知或覆寫目前狀態。

文件的「重連失敗只由 Promise 回報」限於自動派送既有處理器；晚註冊 OnLoginError 立即讀取目前錯誤是刻意保留的相容性例外，兩者不合併。新增 scenario/測試保留此差異，不記錄新的 loginError source 或禁止晚註冊重播。可修改 Error 仍沿用，無順帶錯誤物件或 require 位置整理。

### 6. 所有物件 body 文字使用 entity，回應維持既有解析

選擇通用 XML 序列化規則，不依任何欄位名稱、大小寫或服務判斷 SQL。兩種 transport 的物件 request body 都遞迴處理：任意 key 下的字串文字葉節點、巢狀物件、陣列中的字串與物件、`@text` 字串，都使用 XML entity，不使用 CDATA。包括內部登入的物件 Body；Header/token 不因本項擴大變更。依既有 `@` 或名稱慣例判定為 XML 屬性的值沿用既有屬性序列化，不轉成元素文字；數字、布林、null、物件/陣列形狀與屬性慣例不變。

這是 legacy 與 PKI 全部服務的共用變更，包含 UDM 與自訂非 SQL 服務；不是僅開 PKI 才改。替代方案「只辨識 SQL key」會引入大小寫、路徑與業務欄位判定，與通用套件邊界不合，因此不採用。相較現況，單行且無特殊空白的文字原本已使用 entity；變更主要在原本會產生 CDATA 的多行、tab 或連續空白文字。DSA 接受 entity 的依據包含現有序列化程式與使用者提供的既有正式使用紀錄，本輪未操作正式環境。

元素文字的 `&`、`<`、`>` 等按 XML 規則跳脫；CR 以字元參照避免換行正規化。以符合 XML 標準的 parser 驗證原文逐字相同，含中文、頭尾空白、tab、CR/LF、連續空白、`]]>` 及類似 entity 的字面值。不得經過會二次解碼/trim 的處理，也不修改呼叫者物件。實作可建立套件內部序列化層，不修改第三方 nodexml 原檔。

對非空且完全由 XML 空白字元組成的文字（僅 U+0020、U+0009、U+000A、U+000D），每個字元分別輸出 `&#32;`、`&#9;`、`&#10;`、`&#13;`；例如單一空格為 `&#32;`，空格加換行為 `&#32;&#10;`。這是文字序列化規則，同樣適用 legacy/PKI、巢狀/陣列/@text，不依服務或欄位。空字串不屬此分支，維持空元素文字的既有表示；不得把空字串、純空白與 null 混為一談。非空白文字中的一般空格/換行維持既定 entity 規則，CR 仍以字元參照輸出；不新增 xml:space 屬性或改寫 raw XML fragment。

採數值字元參照是降低純空白被 parser 當成格式空白移除的風險，不是已證明所有 DSA 都會保留。參照解析後仍是空白，後續服務也可能 trim；必須在真實 DSA 的應用層觀測收到的長度及各字元，不能只以本機 parser 還原或 HTTP/DSA status 成功作驗收。

送出文字的還原驗證不能使用 nodexml.xml2obj 作標準：本機 nodexml 1.0.2 會將 `&amp;lt;` 解成 `<`，且保留 `&#13;` 字串。測試區分「標準 XML 的送出文字還原」與「回應的既有 nodexml 相容性」，不更換回應解析器。

頂層字串型 req.body 仍是呼叫者提供的 raw XML fragment，不改寫其中任何欄位或 CDATA，呼叫者負責有效 XML。回應仍由同一 nodexml 版本解析，不增加 entities.decodeXML 或重塑；callback 的完整 resp 為解密後解析物件，resolve 為 Envelope.Body 或既有空物件 fallback。

### 7. DSNS 防護保持範圍

獨立 dsnsLookup 的 callback、complite 與失敗 fallback 保持原契約；open 在其結果接回時驗證 HTTP(S) URL，不允許 `[object Object]`、學校代碼、無 hostname 或其他 scheme 進入 login/取公鑰。直接 URL 同樣驗證。不修改 dsnsLookup 實作或 main dsns-resolution spec，因此不列 dsns-resolution Modified Capability。這不是宣稱程式已完全符合 main spec：main spec 要求失敗/缺有效 URL 時回傳原名稱，但含空 SecuredUrl 子元素/屬性的 DoorwayURL 物件現會變成 `[object Object]`；此既有差異保留，另行處理。兩種模式的 open 都攔截該值，不把它作為後續 HTTP 目標。

### 8. 公開契約與通用套件邊界

套件只接受呼叫者傳入的 accessPoint、token、request 與 options，不讀取應用程式 config、環境憑證或其他 repository，不依賴學校同步流程、快取實作及特定 contract。require/安裝套件不得觸發登入、取公鑰或其他網路連線；只有 open/send/reConnect 等明確操作才觸發服務請求。測試工具可讀取 opt-in 實測環境變數，但此設計不進入 runtime 自動取憑證行為。

| 公開契約 | 3.0.0 決策 |
| --- | --- |
| require('nodedsa') | 保留 CommonJS 與現有 dsnsLookup/open 匯出，不更換入口或新增限制深層路徑的 exports 設定。 |
| open(accessPoint, token) | 保留同步回傳連線物件、立即開始非同步登入及 legacy 預設；空 accessPoint 既有拒絕方式不順帶改寫。 |
| open 第三參數 | 僅新增可選 transport；不新增獨立 contract 選項。 |
| send(request, options?) | 保留 Promise、result callback、fetch options、排隊及輸入物件不變。 |
| ready/OnLoginError/OnError/reConnect/getUserInfo/getAccessPoint | 保留名稱與參數，修正明列的終止失敗及 ready 重播/保留問題；ready 每次註冊只完成一次，失敗仍 pending，後續有效重連可完成未完成者，不新增 rejection 契約。 |
| dsnsLookup/complite | 保留既有 callback、快取與 fallback；在 open 邊界拒絕無效結果。 |
| 回應與錯誤 | 保留 nodexml 的物件/陣列/@text 及既有錯誤欄位，不新增使用端專屬轉換。 |

### 8.1 ready 一次性等待與重連恢復

將永久 readyCallbacks 拆除，改為 readyWaiters 佇列，每次註冊只保存尚未完成的 callback/resolver 組合。已登入的 ready 呼叫在 Promise 建立之前透過 invoke 的同步模式通知 callback，再回傳已完成 Promise，不新增佇列項；callback 若拋出則不建立 Promise。callback 即使立即 reConnect，也不會把本次 ready 改掛到新登入。

目前世代登入成功時，先通過 state.id/generation 檢查，設定登入狀態，取得 readyWaiters.splice(0) 快照，之後才派送請求與通知快照。先清空避免 callback 重入時誤刪新等待者；若第一個 callback 發起重連，剩餘快照仍各完成一次，重連期間新增者留在新的等待佇列。callback 仍由 invoke 隔離例外。

登入失敗不清空未完成等待者，也不新增 ready rejection。後續 reConnect 的目前世代成功會完成它們；這比舊版暫換陣列而遺留等待者的行為明確，必須在 CHANGELOG/README 列為行為修正。不要照抄舊版切換陣列：迴圈執行中恢復陣列會重跑部分舊 callback。已完成者不保留，故重連不重播。每個 ready 註冊的一次性語意不等於整個連線只在首次登入通知。

### 8.2 同步與非同步 callback 例外邊界

invoke 與 rejectRequest 增加內部 sync 參數，錯誤格式仍只有一份。同步 invoke 直接呼叫 callback 並往外拋；非同步 invoke 捕捉後以 queueMicrotask 重新拋出，不吞錯或觸發重試。同步路徑只限已就緒 ready、已有錯誤的 OnLoginError 立即通知、send 的 options/header 正規化失敗與既有 loginError 的立即失敗；async dispatch 的失敗即使序列化在 await 前發生，仍屬非同步通知。

同步 rejectRequest 先設 req.settled，按 OnError 註冊順序 → result 通知，finally 拒絕內部 Promise。任一 callback 拋出即停止後續通知，catch 先為該未能回傳的 Promise 掛上 catch，再原樣往外拋，finally 仍完成 rejection。這個空 catch 僅收尾已無法交付的傳輸 Promise，不是吞掉使用者 callback 例外。沒有 callback 例外時不掛空 catch，呼叫端仍須處理 send rejection。

非同步 rejectRequest 保留 reject → OnError → result 的既定路徑，各 callback 透過 invoke 隔離，callback 的 microtask 例外不會被 runLogin/dispatch 的 catch 捕捉。無自訂處理器時 Node 程序預設會結束；相較舊版 ready/OnLoginError 非同步例外被登入 catch 吞掉並重試，是需要明列的不相容變更，而非僅文件補充。

用獨立子程序測試退出碼、uncaughtExceptionMonitor origin、unhandledRejection 與 callback/登入/服務次數。同步例外要由呼叫者捕捉且退出 0；非同步例外預設退出 1，callback 一次、登入不重試。這些測試不加防止退出的 uncaughtException listener。

### 9. 版本、環境與依賴策略

目標版號維持使用者指定的 3.0.0。第三參數本身是相容新增；major release 的行為差異要明列為無效 URL/DSNS 提前失敗、所有物件 body 字串文字（含 UDM）的 wire 表示由 CDATA 改為 entity，以及既有失敗路徑補齊通知/拒絕，不能把「新功能較大」當作唯一版本理由。package.json、lockfile 根及 packages 根的版本與文件必須一致；不因更新版本自行執行會建立 git tag/commit 的流程。

在 metadata 宣告 engines.node 為 >=18，保留 CommonJS app.js 入口；不承諾瀏覽器、獨立 ESM 產物或 TypeScript 型別。測試矩陣涵蓋 Node 18 的最低支援線及 Node 20/22/24 的可用最新修補版本；各實際 Node/npm 版本與結果須記錄，缺少可用環境的項目保持未完成，不以單一 Node 版本的結果代表全部。

將正式依賴 nodexml 固定在已核對的 1.0.2，以維持回應解析行為；不沿用 `*`，不升級解析器。未來放寬版本須有相容性證據。crypto/fetch 使用 Node 內建功能，不增加正式加密依賴。OpenSpec 與必要的標準 XML 測試 parser 僅屬開發依賴，記錄新增/變動及已知風險。package-lock 服務本專案可重現開發，不視為外部安裝者的依賴約束；使用端安裝測試須驗證實際解析到的正式依賴。

### 9.1 不依賴 shell 的測試入口

scripts/run-tests.js 明確枚舉 test/ 直屬的一般檔案 *.test.js，排序後以 process.execPath、--test、呼叫端參數、測試檔路徑啟動，不使用 shell。CLI 參數置於檔案前，讓 npm test -- --test-name-pattern=... 可用。沒有測試檔、spawn error 或 status=null 一律非零；一般退出碼原樣回傳。runner 位於 scripts 且名稱不符合 Node 預設測試規則，產物驗收共用此入口，以避免探索範圍分歧。測試用隔離檔案布局及子程序結果確認空集合、排序、參數、失敗/訊號處理；macOS 無 shell 模擬不等於 Windows 實機驗收，verification.md 明列後者未執行。

### 10. 發布產物與獨立使用端驗收

先在本專案乾淨安裝並測試，不能以 NODE_PATH 或參考專案 node_modules 代替。以 npm pack --dry-run 核對白名單，再產生真正 .tgz；清單必須含 app.js、新增通道模組、package.json、README、CHANGELOG 及 MIT 授權資訊，排除憑證、私鑰、本機設定與非必要測試檔。既有 MIT 宣告及作者/repository metadata 保留；若補 LICENSE，須沿用既有授權與權利人資訊，不杜撰。

把同一 .tgz 安裝進 repository 之外的暫存空白專案，移除 NODE_PATH 與開發路徑連結，以套件名稱 require；只安裝一般使用者需要的正式依賴。測試工具自外部以 mock fetch 驗證 legacy 兩參數呼叫、PKI 登入/Session/一般非 SQL 服務、錯誤、任意 contract、不同路徑與回應形狀，並確認 require 本身不發出網路請求。這份產物驗收不得要求安裝 OpenSpec 或參考專案，也不要求使用者安裝 TypeScript 編譯器。

### 11. 文件、發布與回退交接

README 先提供任意專案可複製的 CommonJS 安裝/使用範例、支援環境、兩種 transport、原格式路徑、一般服務及 SQL 範例、事件與錯誤契約。CHANGELOG 與升級指引列出相容及不相容項目、依賴固定、預設 legacy 與必要的使用端動作。同步專案的 isSupportCrypto/shiftSql/Seed/兩處連線/快取僅放在補充案例，不成為套件設定介面。補充其從 2.0.0 升至 3.0.0 亦帶入 2.1.0 的 send options 變更；即使 UDM 維持 legacy，仍受共用 entity、URL 驗證及失敗修正影響。網路失敗缺 OnLoginError 導致快取未刪與後續 send 卡住已有程式推論依據，但與「批次卡一小時」的因果未經驗證，不寫成已查明。README 同時明示 ready() 失敗 pending 與初始化無 timeout。

準備由使用者執行的發布清單：確認 registry、套件名稱、版本未占用、發布者權限與公開存取設定；使用候選版本如 3.0.0-rc.1 搭配 next，通過驗收後以正式 3.0.0 搭配 latest。每個待發布版本均須核對其 metadata、變更紀錄與實際 tarball，避免把 next 標籤誤認為版本號，或在沒有指定標籤時意外發布成 latest。同名同版本不能覆寫；修正需使用新版本。正式發布前的打包與測試不代表已授權 npm publish、變更 dist-tag 或 registry metadata。

發布後由使用者確認 registry 的版本、dist-tag、安裝產物與一般使用情境。若發生問題，使用端可明確固定已驗證舊版並重建 lock/連線；需要時由使用者調整 dist-tag 或標記問題版本 deprecated，不將 unpublish 當預設回退方法，也不自動改動正式環境。


### 12. Fetch options、逾時與內部請求邊界

open 第三參數僅 transport，不新增連線級 headers/signal/timeout。send(request, options) 僅將 options 套用到該次服務 HTTP 請求，PKI 時即該次加密外層 HTTP；不把不同 send 的 trace headers 或 signal 合併到共同初始化/登入。DSNS 查詢、GetPublicKey、初次 DS.Base.Connect 與 reConnect 登入均為內部請求，維持函式庫預設 headers，不繼承 send options，也不新增應用層逾時。參考 secure_tunnel.ts 的 5000 ms timeout 不視為本套件既有功能或此次承諾。

因此 send 傳入已取消的 signal 仍不代表初始化會停止；初始化未結束時 send 還在佇列，signal 只在真正服務 fetch 時作用。以 mock 驗證 headers/signal 的邊界與終止失敗契約，不新增「永不完成 fetch 最終一定報錯」的測試承諾。後續若要增加連線級 transport options/timeout，另行規劃 API 與取消共享初始化的語意。

## 發版項目與驗收對照

| 發版關鍵項目 | 設計與主要工作 |
| --- | --- |
| 公開 API 與相容性 | 決策 1、8、8.1、8.2；tasks 1.3、3.1–3.6、4.4–4.5、10–11。 |
| 語意版本與不相容項目 | 決策 9；tasks 5.1、5.3、8.3。 |
| 通用套件職責 | 決策 8；tasks 5.2、6.1、7.2–7.3。 |
| 執行環境與載入方式 | 決策 9；tasks 5.3、6.2、7.4。 |
| 依賴管理 | 決策 9；tasks 1.2、5.4、7.2。 |
| 實際發布內容 | 決策 10；tasks 5.5、7.1。 |
| 使用端安裝驗證 | 決策 10；tasks 7.2–7.4。 |
| 測試與驗收證據 | 決策 3–7、9–10；tasks 2.4、3.6、4、6–8。 |
| 文件與升級指引 | 決策 11；tasks 5.1–5.2、8.4。 |
| 發布與問題處理 | 決策 11；tasks 8.3–8.5。 |

## Risks / Trade-offs

- [純空白值可能被伺服器移除] → DSA 的實際 parser/空白設定及服務 trim 行為尚未確認；使用者提出的 .NET 類比屬風險推論，非本次對 DSA 的實測結論。非空 XML 純空白文字採逐字數值字元參照，tasks 8.2 仍須在 legacy/PKI 真實服務驗證精確字元；本機標準 parser 通過不能替代此證據。若伺服器仍移除空白，保持驗收未完成並重新審閱設計，不自動改回 CDATA、改值或降級。

- [舊版 DSA 伺服器未實測] → 低於 4.8.3.19 支援 PKI 的依據僅為原作者說明；已提供的實測為 4.8.7.2/4.8.7.4。本規格只保證客戶端不做版本 gating，mock 或一台較新 DSA 通過不代表舊版伺服器已驗證，文件與報告不得擴大宣稱。
- [初始化/登入可能無限等待] → 本 change 不新增 GetPublicKey 或 DS.Base.Connect 的 timeout，send.signal 不取消這些內部請求。登入 retry 只在 fetch 已拒絕後生效，不能處理永不完成的 fetch，不宣稱排程停頓已解決。
- [ready() 登入失敗仍 pending] → 保留既有 API 行為，在 README 明示不得單靠 await ready() 處理登入失敗，應註冊 OnLoginError；本次修正的是 send/reConnect 的終止失敗，不包含 ready 的 rejection 改版。

- [PassportAccessToken 未實測] → mock 驗證 token XML 不等於伺服器接受；在非正式 DSA 以短效測試 token 驗證初次登入、Session 查詢與 reConnect，沒有證據時保持該驗收項未完成。
- [歷史 wire protocol 的密碼學與公鑰可信來源限制] → 明確依既有協定相容；文件說明 PKI 不替代 HTTPS，不將通道支援宣告成額外的身分信任保證。
- [自訂路由與 contract 拆分] → 明確限定 PKI 沿用 doorway/contract 格式，測試多層 doorway、任意 contract、尾斜線、query 與 DSNS-relative，缺少必要路徑時在認證前失敗，不改 legacy 路由。
- [重連與並行回應互相干擾] → 每請求 key 與連線世代隔離，測試亂序回應及重連時仍有請求在途。
- [entity 影響 legacy/UDM 及任意服務] → 所有物件 body 字串文字共用規則，測試巢狀/陣列/@text、頭尾空白與 UDM XML payload；屬性/其他型別/raw XML 維持原規則。以標準 parser 驗證送出文字，以 nodexml 驗證回應相容性。
- [套件漏帶通道模組] → 更新 files 並檢查 npm pack --dry-run，封裝後離線 smoke test CommonJS require。

## Migration Plan

1. 使用者明確要求實作後，先反向審閱四份 artifacts，再依 tasks 修改本專案，完成離線測試、規格檢查與封裝驗證。
2. 先提供任意 npm 使用專案的安裝/升級範例，再以參考專案補充兩條配置路徑。PKI 路徑須略過 isSupportCrypto 與 shiftSql，原文 SQL 不帶 Seed；legacy 路徑維持原有版本門檻與 SQL 組裝。不得因 PKI 失敗自動切換。
3. 提醒使用端依模式隔離/重建連線快取，並一併處理 dsaCryptoSql 與 syncCore 的 UDM 連線。這些修改另行授權與管理，不在本 change 實作。
4. 在非正式環境完成真實字串 token、legacy 非 SQL 多行文字及兩模式純空白字元保留驗收。不得用正式學校同步或 UDM 更新充當測試；若唯一可用目標為正式環境，僅提供由使用者自行執行的唯讀驗證步驟。
5. 通過獨立 tarball 安裝及支援環境矩陣驗收後，交付候選/正式版本發布與發布後檢查指令，由使用者自行執行；缺少真實 token、legacy 非 SQL 多行文字或純空白保留證據不能宣稱已可正式發布。
6. 回退由使用者明確選 legacy 或回退套件版本，重新建連線與快取；不由函式庫自動回退。不在本次工作發布、部署、sync 或 archive。

## Open Questions

- dev.sh_d（使用者提供版本 4.8.7.2）僅列為非正式實測候選；名稱或先前測試紀錄不足以確認環境性質，須由環境擁有人確認用途、資料及操作範圍，完整 doorway 亦待確認。本輪未連線或認定其已符合非正式條件。
- package-distribution 暫不拆分，保留先前要求的完整 npm 發版規劃；通道功能與套件發布證據分開記錄，缺發布矩陣不否定已通過的通道個別測試，但不標示整個 3.0.0 可發布。

- 需要可確認為非正式環境的 doorway、contract 與短效 PassportAccessToken 才能完成真實字串 token 驗收；不將憑證寫入 artifacts 或測試 fixtures。
- legacy 預設與沿用路徑格式為本次相容性決策；未來變更須另有明確需求及同步更新 artifacts。
- Node 測試矩陣與乾淨安裝仍須實作階段逐項取得證據；既有 NODE_PATH 測試結果不作為套件發布驗收。

## Verification Evidence（2026-10-20）

以下為本機原始碼核對與隔離測試，所有 fetch 均使用 mock，未連任何學校或正式服務。OpenSpec validation 通過僅證明 artifacts 符合格式與規則，不表示 PKI 已實作或伺服器相容性通過。

| 項目 | 核對結果與證據範圍 |
| --- | --- |
| 登入也要經通道 | app.js 的 login 直接 fetch DS.Base.Connect，SecurityToken 未經 PKI 包裝；已由程式碼確認。 |
| 禁止降級 | 既有程式沒有 PKI，故此為新增要求，不是既有行為驗證結果。 |
| 錯誤欄位與事件 | 已核對 loginError、dsaError、networkError；本機重現登入失敗後 send 的 callback 執行但 Promise 不結束且不呼叫 OnError，多請求/多 OnError 時共用 index 導致錯配與漏結束。 |
| 回應形狀 | app.js resolve Envelope.Body；使用端讀取 Metadata.Column、Record、Column["@text"]；已核對原始碼，跨 transport 比對仍待實作。 |
| 字串 PassportAccessToken | 已確認字串轉 token 的程式碼；尚未對真實 DSA 驗證 PKI 接受此 token。 |
| client RSA 重用 | 參考實作每建 tunnel 產生 RSA-1024，私鑰不保存，回應以 AES 解密；14–18 ms、三次重用成功是使用者提供紀錄，未由本次獨立重測。 |
| SQL entity | 本機重現換行/連續空白 SQL 產生 CDATA，包含 ]]> 時標準 XML parser 拒絕；當時的 entity 示範片段以標準 parser 測試可還原中文、CR/LF 與 XML 敏感字元；此為局部示範，不代表目前的通用字串序列化已完成實作或驗收。 |
| DSNS 無效值 | 七個 mock 端點全失敗時回傳原名稱。空 DoorwayURL 物件（空 SecuredUrl 子元素或屬性）回傳 [object Object]；單純 DoorwayURL 空元素則回傳原名稱，須區分 XML 形狀。 |
| server key 快取 | 參考 SecureTunnelService 有實例級公鑰欄位；nodedsa 尚未有此快取。reConnect 重取與世代隔離是本提案設計選擇。 |
| 兩種方式並存 | shiftSql/Seed/4.8.3.19 位於使用端 dsaCryptoSql.ts；nodedsa 本身不做 SQL 編碼。transport 名稱與 legacy 預設是新增 API 設計；contract 沿用既有路徑格式，沒有獨立選項。 |

補充：本機重現 reConnect 網路錯誤共嘗試四次後，既有 OnLoginError 未被通知且 reConnect Promise 持續 pending。既有測試在 Node v18.20.7 下 11/11 通過，透過 NODE_PATH 使用參考專案已安裝的 nodexml 1.0.2（與本專案 lockfile 版本相同）；這不等於本專案乾淨安裝或 PKI 測試已通過。未重跑使用者提供的 2026-10-16 學校實測，亦未獨立確認所有 DSA 版本皆接受 PKI。

純空白補充核對：本機既有 nodexml 1.0.2 對單一空格 `" "` 已直接輸出文字，對單一 LF、tab 與兩個空格則產生 CDATA，空字串輸出空文字元素。因此空白風險並非每個案例都由本次新增，但將原 CDATA 案例改為文字確實擴大需驗證的範圍。尚未確認 DSA 的 parser 或實測其純空白處理。
