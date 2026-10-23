## Why

nodedsa 目前在登入時將 AccessToken 放在未經 PKI 包裝的 envelope 中送出，後續服務請求亦沒有 PKI 通道。3.0.0 將提供可選的登入前 PKI 通道，保留公開 API 與回應、錯誤結構，且不變更使用端的 SQL 內容（含 shiftSql）或 Seed 策略。

## What Changes

### 僅影響明確選用 PKI 的連線

- 新增 `open(accessPoint, token, { transport: 'pki' })`；省略選項或指定 legacy 時仍使用既有未包裝傳輸。這是傳輸預設相容，不代表下列共用行為完全不變。
- 沿用 `DSNS/contract` 或完整 `doorway/contract`，內部拆分路由，不新增 contract 選項或固定服務名稱。`open('dsns', token, { transport: 'pki' })` 缺少 contract，須在取公鑰及送 token 前回報登入錯誤；legacy 的 `open('dsns', token)` 仍允許。
- 登入前取得公鑰，登入、Session 服務及 reConnect 均經通道；失敗不自動降級。不以 4.8.3.19 限制客戶端啟用 PKI；更舊伺服器的支援依據為原作者說明，尚無實測證據。
- 每連線快取 server public key，重連重取；兩模式重連沿用已解析路由，不因 DSNS 快取過期再查詢，只有尚無有效路由時才重試解析；client RSA 公鑰在 process 內重用，每請求仍使用獨立 UUID/AES key。

### 同時影響 legacy 與 PKI 的共用變更

- **BREAKING／XML 表示變更**：所有物件 request body 的字串文字值，一律以 XML entity 序列化，不使用 CDATA；遞迴涵蓋任意名稱、巢狀物件、陣列與 `@text`，不辨識 SQL 欄位或服務名稱。影響所有服務，包含維持 legacy 的 UDM；解析後文字須不變，非空且只有 XML 空白的值逐字使用數值字元參照，仍須真實服務驗證空白未被移除。屬性維持既有規則，頂層 raw XML fragment 字串不改寫。
- **BREAKING／提早失敗**：open 對直接與 DSNS 解析後的 URL 驗證 HTTP(S)/hostname；無效結果在登入/取公鑰前回報 loginError。獨立 dsnsLookup 不修改：包括部分無效 DoorwayURL 物件仍可能回傳 `[object Object]` 的既有缺陷，與 main spec 的差異記錄於 design，不在此 change 修復。
- **缺陷修正**：send 在連線已登入失敗時，除 result callback 外，也須拒絕 Promise 並通知 OnError（app.js:398–405）。
- **缺陷修正**：login 網路失敗在初次加三次重試耗盡後，須呼叫 OnLoginError 並結束排隊請求；reConnect 對應 Promise 亦須拒絕（app.js:210–223）。
- **缺陷修正**：登入錯誤通知、成功排隊派送、登入失敗佇列及服務錯誤通知迴圈（app.js:205、291、298–299、365）的 index 必須區域宣告且互不共用，確保多請求、多回呼不錯配或漏結束。
- **ready 生命週期修正**：每次註冊在下一次目前世代成功時完成一次，完成後移除，不於重連重播；初次登入失敗的等待者保持 pending，後續 reConnect 成功才完成。
- **callback 例外邊界**：恢復同步 ready／OnLoginError／send 立即失敗通知的例外傳遞；同步 send 按 OnError → result 通知，拋出即停止並收尾不可回傳的 Promise。**BREAKING**：非同步登入 callback 不再被吞掉並重試，改在流程外拋出，預設可能終止 Node 程序。
- 維持 nodexml.xml2obj、Envelope.Body、既有錯誤欄位及公開 API；ready() 登入失敗時仍不會自行 reject，文件須明示此限制。
- send 第二參數的 Fetch options 只作用於該次服務 HTTP 請求；不回溯套用至 DSNS、GetPublicKey、DS.Base.Connect 或 reConnect 登入，不新增初始化/登入逾時。

- **重連通知相容性**：初次登入失敗通知 OnLoginError；reConnect 失敗只拒絕自己的 Promise 並結束排隊請求，不重播既有 OnLoginError，避免 callback 直接重連形成連鎖請求。晚註冊 OnLoginError 的立即通知契約不變。
- **HTTP／回應相容性**：legacy 不做嚴格 XML 字元驗證，以 nodexml 原值解析；2xx 缺 envelope/status 維持舊版 DSA 失敗分類與登入 data/response。兩模式非 2xx 先保留有效非零 DSA 錯誤；其餘回報 http_error，包含 Status 0，此項相較舊版為 BREAKING。PKI 仍嚴格驗證公鑰、外層及解密內容，損壞 Cipher 保留 pki_error。
- **BREAKING／請求合法性**：兩模式物件 body 的非法 XML 字元或元素名稱在本機以 xml_error 拒絕，不送 HTTP、不改值；舊版會送出，伺服器是否接受未驗證。缺少 DSA Message 恢復 undefined；第三參數驗證、同步通知順序與登入重試範圍/計數差異須明列文件。

- XML 名稱檢查完整採 XML 1.0 Fifth Edition 的 NameStartChar/NameChar，送出物件 Body 與 PKI 回應皆適用，不以 Unicode 類別近似；合法名稱不可被本機檢查誤拒絕。
- 位址/DSNS 無效與非字串 accessPoint 的登入錯誤 type 改為中性的 access_point_error；PKI 缺 contract 仍 pki_error。PKI 重用 hasCipher、只對同份 XML 驗證一次，字元檢查不產生無用跳脫字串，不放寬驗證。
- 補明初次登入被重連取代時只有重連 Promise/排隊 send 回報失敗，既有 OnLoginError 不收到該重連結果；ready 等待與恢復規則不變，提醒不要重複輪詢新增等待者。

- 保留 fetch/text 原始錯誤：可修改 Error（含 AbortError）沿用並標 retryable；primitive/不可修改值包裝且保留 cause，凍結 Error 保留 name/message。服務 signal 取消不新增重送。
- PKI 使用共用原始路徑 helper，在 URL 正規化或 DSNS 查詢前拒絕點路徑段、反斜線與無效百分比編碼，回報 pki_error，完整 URL 與 DSNS-relative 的 doorway/contract 切分一致。
- 維護用產物驗收改以 Node 執行 npm_execpath 的 npm-cli.js，不直接啟動 npm.cmd；直接 node 執行時只使用經存在檢查的標準 npm 位置，否則明確報錯，不經 shell。

- 補齊 PKI 單一路徑段界線：逐段解碼後含 / 或反斜線皆 pki_error，拒絕 ..%2F..%2Fadmin 等把分隔符夾進 contract 的輸入；不誤稱這是 HTTP doorway 穿越。
- 登入 catch 安全讀取任意拋出值的 retryable/message，DSNS 或 token getter 拋 null/undefined 時仍結束登入與排隊請求，ready 按原契約保持 pending 待恢復。
- 文件明示通知例外：重連失敗不派送當時既有 OnLoginError，但失敗後新註冊者仍立即同步收到目前錯誤；此行為及可修改 Error 沿用決策不改。

### npm 套件交付與驗收

- 修正 PKI DSNS-relative 缺少有效 contract（含尾斜線及編碼空白）時，在 DSNS 查詢前拒絕；解析前後共用相同尾段解碼判定。
- npm test 改用 scripts 中明確枚舉、排序測試檔的 Node runner，傳遞測試參數且如實回報失敗；不依賴 shell glob 或預設探索，不宣稱未實測的 Windows 已驗收。

- 更新套件/鎖檔及文件至 3.0.0，列明共用行為與 PKI 專屬變更；維持 CommonJS/Node.js 18+，正式 nodexml 從 `*` 固定為 1.0.2。
- 檢查實際打包清單，將 .tgz 安裝到乾淨使用專案，以套件名稱驗證兩種模式及一般非 SQL 服務，不借用其他專案依賴。
- 補齊升級、回退、發布及發布後檢查步驟；package-distribution 保留在此 change，作為 3.0.0 發布門檻，但 tasks 區分通道功能證據與套件發布證據，不以後者取代前者。

## Goals

- PKI 模式從首次登入起保護認證與完整 envelope，失敗可觀測且不降級。
- 讓任意使用專案沿用既有 accessPoint 格式選擇 transport；`1campus.dsa.sync.core` 僅作既有使用端的相容性案例。
- 以本機協定測試、非正式環境 PassportAccessToken、legacy 非 SQL 多行文字與兩模式純空白值實測分別證明實作與相容性。

## Non-goals

- 不把使用端的 shiftSql、版本判斷或 SQL 業務邏輯搬入 nodedsa；不自動改寫 Seed 或猜測 SQL 是否已加密。
- 不修改或部署參考專案、不執行正式環境登入、同步、資料寫入、UDM 更新或發布套件。
- 不更換 XML 回應解析器、不全面重寫客戶端、不移除 legacy 模式。
- 不新增獨立 contract API、ESM 雙入口、TypeScript 型別或安裝時登入/取憑證/呼叫服務的行為；套件不讀取其他專案的設定或檔案。
- 不新增初始化/登入逾時、連線級 Fetch options 或 ready() 失敗 rejection，不宣稱本 change 已解決網路永不結束或排程停頓。
- 不修正獨立 dsnsLookup 的既有 fallback/spec 差異，不修改 main dsns-resolution spec。

## Capabilities

### New Capabilities

- `pki-channel`: 通道協定、初始化、模式選擇、金鑰生命週期與禁止降級。
- `package-distribution`: 通用 npm 套件邊界、入口與環境、依賴、發布產物、乾淨安裝、版本與遷移文件及發布/回退交接。

### Modified Capabilities

- `dsa-client`: 新增連線選項與 doorway/contract 路由，維持回應與錯誤格式，確保失敗請求結束，將所有物件 body 的字串文字值以 entity 序列化，不辨識業務欄位。

## Impact

- 修改範圍包含 `app.js`、新增的 CommonJS 通道模組、測試、README、CHANGELOG、package.json 與 package-lock.json；新增模組必須納入 npm files。
- 使用 Node.js 18+ 內建 crypto/fetch，不新增加密第三方依賴。
- 套件本身不依賴使用端 repository、設定、憑證、快取或服務名稱；測試產物不能透過 NODE_PATH 借用其他專案依賴。
- 參考專案目前鎖定 nodedsa 2.0.0，SQL 與 UDM 各自建立連線；其移轉注意事項僅作補充案例，通用文件與驗收不得只涵蓋此專案。該使用端從 2.0.0 升級亦會帶入 2.1.0 的 send options 變更，文件須提醒一併檢視。
- 字串 PassportAccessToken 尚無真實通道成功證據。3.0.0 驗收必須區分 mock 通過與非正式環境實測通過；沒有後者不能宣稱相容性已確認；legacy 非 SQL 多行文字及兩模式純空白處理也須有真實服務證據。
