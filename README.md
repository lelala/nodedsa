# nodedsa

供 Node.js 專案安裝的 CommonJS DSA 客戶端。目標版本 **3.0.0（待發布）**，runtime 支援 Node.js 18+；OpenSpec 開發工具需 Node.js 20.19+。保留 MIT 授權。

## 安裝與使用

正式版本發布後可安裝 `npm install nodedsa@3.0.0`。發布前先安裝本機打包產物：

```sh
# 在 nodedsa 專案打包，尚不發布
npm pack
# 在你的使用專案執行，請換成實際檔案路徑
npm install --save-exact /absolute/path/nodedsa-3.0.0.tgz
```

```js
const nodedsa = require('nodedsa');

// 既有兩參數呼叫：預設 legacy，不進行 PKI 公鑰握手。
const legacy = nodedsa.open('school/Any.Contract', accessToken);

// PKI 沿用同一種路徑格式；沒有獨立 contract 選項。
const secure = nodedsa.open('school/Any.Contract', accessToken, { transport: 'pki' });
// 完整 URL 亦可：https://example.test/dsa/doorway/Any.Contract

secure.OnLoginError(error => {
    // 在此處理登入失敗，例如由使用端刪除失效的連線快取。
});
secure.OnError((request, errorInfo) => {
    // errorInfo 維持 loginError / dsaError / networkError 結構。
});

// service 與 body 依所用 contract 定義，不限定 SQL 或特定服務。
const response = await secure.send({
    service: 'Your.ReadService',
    body: { Request: { Description: '第一行\n第二行' } },
    result(body, errorInfo, httpResponse, parsedEnvelope) {
        // callback 與 Promise 同時支援；成功時 errorInfo === null。
    }
});
```

`open` 同步回傳連線物件並開始非同步登入。token 可以是字串（轉為 PassportAccessToken）或既有 securityToken 物件，例如 `{ '@': ['Type'], Type: 'Passport', DSAPassport: {...} }`；登入成功後使用 Session，原本傳入 Session token 則沿用。

## Transport 與路由

- 省略選項或 `{ transport: 'legacy' }`：維持既有未包裝的 envelope，HTTP 目標為包含 contract 的 accessPoint。
- `{ transport: 'pki' }`：先向 doorway 取得公鑰，再加密 DS.Base.Connect 與所有服務 envelope。HTTP 目標不包含 contract；contract 同時放在內外層 Header。
- PKI 原始路徑在 URL 正規化／DSNS 查詢前檢查：拒絕 .／.. 路徑段（含混合百分比編碼）、解碼後含斜線或反斜線的段、會被 URL 移除的內部 tab/CR/LF 及無效百分比/UTF-8 編碼，type 為 pki_error。query/fragment 不作為路徑檢查，一般名稱中的點維持允許，legacy 路由不變。
- PKI 公鑰、加密、解密或協定失敗都回報錯誤，不改送明文或自動切換 legacy/shiftSql。
- PKI 必須提供 `DSNS/contract` 或完整 `doorway/contract` 路徑；最後一個非空路徑段為 contract，保留前方 doorway 路徑及 query，fragment 不送出。尾斜線可省略。只提供 `open('school', token, { transport: 'pki' })` 會在取公鑰/送 token 前失敗，legacy 只提供 DSNS 的既有用法保留。
- `getAccessPoint()` 仍回傳邏輯連線 URL；`getUserInfo()` 回傳登入 UserInfo。
- server key 隨連線保存；`await conn.reConnect(newToken)` 保留模式及已解析 URL/contract，不因 DSNS 快取過期重查 DSNS；PKI server key 仍重取後登入。尚未成功解析位址時才重試解析；若要重新查服務位置，請另建連線物件。每請求使用獨立 UUID/AES key，client RSA 公鑰在同一 Node.js 執行環境中跨套件副本重用；不同 worker 各有獨立的執行環境。

PKI 使用 DSA 既有 UUID/MD5/AES-128-ECB/PKCS7/RSA-PKCS1 協定，不能取代 HTTPS 或公鑰來源的可信性。客戶端不以 4.8.3.19 阻擋 PKI；舊版伺服器可用的依據為原作者說明，**低於此版本尚未獨立實測**。mock 或單一較新版本通過不代表所有版本相容。

## Fetch options 與生命週期

```js
const result = await secure.send({ service: 'Your.ReadService', body: {} }, {
    headers: { traceparent: '00-<trace-id>-<span-id>-01' },
    signal: abortController.signal,
    redirect: 'manual'
});
```

fetch 或讀取 body 拒絕字串、null 或凍結 Error 時也會正常回報原始原因，不因設定 retryable 蓋成 TypeError。預設 AbortController.abort() 的 networkError.name 維持 AbortError；可修改 Error 沿用，其他值以 cause 保留在內部包裝錯誤，凍結 Error 保留 name/message。公開 networkError 欄位不增加 cause；服務取消不自動重送，內部登入仍只做有界傳輸重試。

headers 接受 Headers、鍵值陣列或物件，大小寫不敏感地覆寫預設 Content-Type。其他 Fetch options 轉交服務請求，但 POST method 與 XML body 由套件決定，輸入物件不被修改。

**options 僅作用於該次服務 HTTP 請求**，不套用至 DSNS、公鑰、初次登入或 reConnect 登入；取消服務 signal 不會取消共同初始化。此版本沒有新增初始化/登入 timeout，登入重試只在 fetch 或讀取 body 已失敗後發生（每次初次登入或重連各自最多初次加三次重試），不能處理永不完成的 fetch。

`ready(fn)`/`ready()` 每次註冊只在下一次目前世代登入成功時完成一次，完成後即移除；已登入時立即完成，不於後續重連重播。重連期間新增的等待者於該次成功完成。初次登入失敗的等待者保持 pending，之後 reConnect 成功時也會完成；這是對舊版遺留等待者與重播問題的行為修正。**登入失敗時 ready() 不會 reject，可能一直 pending**。請註冊 OnLoginError，不能只以 `await conn.ready()` 等待一定會結束的登入結果。請保留單次 ready 等待，不要以 timer 等方式重複輪詢建立新等待者；登入失敗期間這些等待者都會累積，並在後續有效成功時完成，新註冊仍會被接受。send 與 reConnect 的終止失敗會拒絕 Promise；服務失敗不自動重送。

初次登入的終止失敗會通知 OnLoginError；**reConnect 失敗會 reject 自己的 Promise，不自動派送當時已註冊的 OnLoginError**，排隊及後續 send 仍正常失敗。呼叫端應處理重連 rejection，例如在 catch 中刪除快取。初次登入未完成就被 reConnect 取代時，也採此規則：舊結果忽略，新重連失敗透過 Promise 和排隊 send 回報，即使另一段程式事先註冊的 OnLoginError 從未收到通知，也不會代收重連結果。不要只靠 OnLoginError 判斷重連結果。**相容性例外：失敗後才新註冊 OnLoginError，仍會立即同步取得目前 loginError，包括重連錯誤。**因此「不通知既有 handler」不代表「晚註冊也不能讀取錯誤」。

```js
try {
  await conn.reConnect(newToken);
} catch (error) {
  // 在此清除呼叫端的連線快取並處理重連錯誤。
}
```

錯誤格式保留：登入失敗透過 `loginError`；DSA 服務錯誤透過 `dsaError: { header, status, message }`；網路、XML、加解密錯誤透過 `networkError: { name, message, stack, type }`。PKI 協定錯誤 type 為 `pki_error`。非字串 accessPoint、無效直接位址或 DSNS 結果，登入錯誤的 `XMLHttpRequest.type` 為 `access_point_error`（原先誤標 `pki_error`）；PKI 缺 contract 仍是 `pki_error`。既有空 accessPoint 的同步拒絕不變。result 與 OnError 收到同一請求的錯誤。伺服器錯誤欄位維持原值，使用端記錄日誌時需依自己的資料規則處理。

兩模式都先讀取 HTTP body，再依下列規則分類；HTTP/解析錯誤在登入階段仍由 loginError 回報：

| 回應 | legacy | PKI |
| --- | --- | --- |
| 2xx、Code 0 | 成功 | 僅接受有效加密成功回應 |
| 合法非零 DSA Code，包含非 2xx | 保留 DSA 錯誤 | 驗證明文錯誤或解密後保留 DSA 錯誤 |
| 2xx、可解析但缺 envelope/status | 舊版 dsaError/loginError 分支 | pki_error |
| 非 2xx、HTML/空內容/缺 status/Code 0 | http_error | http_error |
| 損壞 Cipher 或解密後非法 XML | 不適用 | pki_error，即使 HTTP 非 2xx |

legacy 回應直接使用 nodexml，保留直接控制字元與未知 entity 等既有解析結果，不清洗資料。2xx 缺 envelope/status 的登入錯誤保留原始 data、response 與 textStatus=unknow；缺 Status 時 status/message 為空字串，有 Status 但缺 Message 時 message 維持 undefined。真正解析例外為 xml_error，不重試登入。

PKI 公鑰、外層及解密後 XML 仍嚴格檢查；含直接 U+001A、非法字元參照（如 `&#x1A;`）或未知 entity（如 `&nbsp;`）會整筆失敗，不能因 legacy 可讀取就推定 PKI 接受。物件 Body 元素/屬性與 PKI 回應的名稱依 XML 1.0 Fifth Edition 完整 NameStartChar/NameChar 範圍檢查，驗證與送出不改字或正規化（回應物件仍依 nodexml 既有解析）：`成績（期中）`、`a\u0301`、`x‿`、`、x` 合法，`x²` 不合法。物件 request body 在兩模式都拒絕非法 XML 字元或元素名稱，回報 xml_error，該服務 HTTP 尚未送出，不刪字或替換資料；頂層 raw XML fragment 仍由呼叫者負責。


DSNS lookup 或 token getter 拋出 null／undefined 等非 Error 值，也會安全結束登入並回報 loginError，不因 catch 存取 retryable/message 再產生 unhandledRejection。未標記 retryable 的一般登入例外不新增重試；無法取得訊息時使用 Network error occurred。ready 仍保持 pending，可於之後有效重連成功完成。

## Callback 例外與程序退出

以下「同步／非同步」指套件通知 callback 的時機。套件不會吞掉使用者 callback 直接拋出的例外：

- **同步路徑**：已登入的 ready(fn)、已有登入錯誤時的 OnLoginError(fn)，以及 send 遇既有登入失敗或 options/header 無效的立即通知。例外原樣傳回呼叫者，可用呼叫該 API 的外層 try/catch 捕捉。已就緒 ready(fn) 在建立 Promise 前執行 fn，fn 拋出時沒有 Promise 回傳，也不留下等待者。
- **同步 send 失敗**：先標記 settled，依序執行各 OnError、result，最後拒絕 Promise。任何 callback 拋出就停止後續 callback，收尾無法回傳給呼叫者的內部 Promise 後，把 callback 例外原樣往外拋。沒有 callback 例外時，呼叫者仍須處理回傳 Promise 的 rejection。
- **非同步路徑**：登入結果及已送出服務的回應通知。callback 直接 throw 時，例外會在通知流程外以 microtask 重新拋出，成為 uncaughtException；沒有自行處理時，**Node 預設會以非零狀態結束程序**。呼叫 API 的外層 try/catch 或 send Promise 的 catch 接不到這個 callback 例外。這種「隔離」只表示不觸發登入/服務重試，不代表程序能安全繼續。

這是相對於舊版部分非同步 ready/OnLoginError 例外被登入 catch 捕捉並重試的**不相容行為變更**；新版本不再吞掉並重試此類程式錯誤。請在 callback 自己的範圍內處理錯誤，例如：

```js
conn.ready(() => {
    try {
        initializeApplication();
    } catch (error) {
        handleApplicationError(error);
    }
});
```

若 callback 是 async 函式，也應在其內部 await/try/catch 處理錯誤；套件不 await callback 回傳的 Promise。不要把全域 uncaughtException 當作一般業務錯誤的恢復機制。

## 3.0.0 升級注意事項

以下共用變更也影響 legacy，包括 UDM 與自訂非 SQL 服務：

- **全部物件 body 的字串文字改用 entity，不產生 CDATA**，遞迴涵蓋任意名稱、巢狀物件、陣列與 `@text`；不辨識 SQL。保留輸入文字，CR 使用數值字元參照。只有 XML 空白的非空字串逐字使用 `&#32;`、`&#9;`、`&#10;`、`&#13;`，不合併為空字串。屬性、其他型別及頂層 raw XML fragment 維持原規則。raw XML 仍由呼叫者負責合法跳脫。
- 數值參照是保護措施，DSA parser/服務是否 trim 純空白仍需真實服務驗證；本機標準 XML parser 成功不能替代此驗收。
- open 對直接及 DSNS 解析後的 URL 驗證 HTTP(S)/hostname，無效值在登入前以 loginError 失敗。獨立 dsnsLookup/complite 的既有 fallback 不改；無效 DoorwayURL 物件可能回傳 `[object Object]`，此既有缺陷未於本次修復。
- 修正登入失敗後 send Promise 不結束、初次登入網路重試耗盡缺 OnLoginError、錯誤迴圈索引共用，以及 reConnect Promise 未結束；重連失敗不重播既有 OnLoginError。
- **非 2xx 分類變更**：先保留有效非零 DSA 錯誤，其餘改為 http_error；舊版忽略 HTTP 狀態，HTML 可能為空欄位 dsaError、Code 0 可能被當成功。
- **物件 Body 合法性變更**：控制字元或非法 XML 名稱改在本機以 xml_error 拒絕，舊版會送出；DSA 是否接受舊內容未驗證。
- **第三參數與失敗通知**：舊版忽略 open 的第三參數，新版對 null/未知欄位拋 TypeError。同步 send 失敗依 OnError→result→reject，與非同步 callback 順序一致；同步 callback 拋出即停止後續通知。舊版 options/排隊登入/服務失敗原本採此 callback 順序，但已失敗登入後的 send 只有 result，未通知 OnError 且 Promise pending；新版補齊這條路徑。
- 登入僅對 fetch/text 失敗重試，每次登入重置次數；舊版也會因解析或 callback 例外重試，且已耗盡的計數延續到重連。真正解析例外改用 xml_error 分類，服務透過 networkError、登入透過 loginError。
- 正式 nodexml 固定 1.0.2，回應仍用 nodexml.xml2obj，Promise resolve Envelope.Body（或既有空物件 fallback），Metadata.Column、Record、Column['@text'] 的既有形狀保留。

套件不更動 SQL 或 Seed；使用端決定 legacy＋shiftSql/Seed，或 PKI＋原文 SQL/no Seed。例如：

```js
await secure.send({
    service: 'UDTService.DML.Query',
    body: { Request: { SQL: "SELECT '中文' AS value" } }
});
```

## 使用端案例：1campus.dsa.sync.core

此專案的 dsaCryptoSql.ts 與 syncCore.ts 各有 open 呼叫；遷移 PKI 時兩處都需評估。選 PKI 的 SQL 路徑應由使用端略過 isSupportCrypto/shiftSql/Seed，送原文 SQL；保留 legacy 則維持原來 4.8.3.19 的 shiftSql 門檻。依 transport 隔離或重建連線快取，避免混用。從鎖定的 2.0.0 升級也包含 2.1.0 的 send options 變更。即使 UDM 維持 legacy，也受上述共用 XML/錯誤變更影響。

OnLoginError 可用於初次登入失敗時刪除連線快取；重連失敗須在 reConnect 的 catch 處理；本次錯誤路徑修正不等於已證明或解決「排程批次卡一小時」的原因。

## 發布前驗證

開發依賴建議以 Node.js 20.19+ 安裝；runtime 另驗證 Node 18/20/22/24：

```sh
npm ci --ignore-scripts
npm test
npm run spec:validate
npm run test:package
```

npm test 透過 scripts/run-tests.js 明確枚舉並排序 test/ 直屬的 *.test.js，不依賴 shell 萬用字元或 Node 預設探索；helper 與打包腳本不會被收集。可用 `npm test -- --test-name-pattern="ready"` 篩選；找不到測試、啟動失敗或測試程序被訊號中止均非零結束，一般退出碼原樣回傳。此入口已在 macOS 進行跨版本驗證，尚未完成 Windows 實機驗收。

test:package 用目前 Node 執行 npm 的 JS 入口，不直接啟動 npm.cmd 或經過 shell。優先使用 npm_execpath；直接以 node 執行且沒有此變數時，只檢查 Node 同目錄的 node_modules/npm/bin/npm-cli.js 或父層 lib/node_modules/npm/bin/npm-cli.js，找不到就明確報錯。Windows 原先的 .cmd 啟動方式依 Node 官方行為確認不適用，現已移除；修正後仍未完成 Windows 實機驗收。

test:package 檢查 dry-run 及實際 tarball 清單，將產物安裝至 repository 外的乾淨專案，僅安裝正式依賴、清除 NODE_PATH，再用同一套測試驗證已安裝套件。輸出產物路徑、SHA-256、Node/npm 版本與測試紀錄。測試 harness 使用 saxes 作標準 XML parser，runtime 不依賴 saxes 或 OpenSpec。此指令預設沿用 npm cache，必要時下載正式依賴；可用 NODEDSA_NPM_CACHE 指定 cache，已備妥完整 cache 時可設定 NODEDSA_OFFLINE=yes 進行離線安裝驗收。

目前自動化測試是受控端點與獨立伺服器解密 fixture，不能宣稱真實 DSA 相容性已完成。真實驗收需先確認非正式環境、短效字串 token，以及無寫入副作用的 echo 測試服務。服務輸入為 `Request.Value`，輸出需有 `Response.Length`（Unicode code point 數）與 `Response.CodePoints`（十進位 code points，以逗號分隔；空字串為空值），避免既有 nodexml trim 行為掩蓋結果。不可用 UDM 更新作測試。

由使用者在本機設定下列環境變數後執行 `npm run test:live`：

- NODEDSA_NONPROD_CONFIRMED=yes、NODEDSA_READONLY_CONFIRMED=yes。
- NODEDSA_ACCESS_POINT：包含 contract 的完整測試 URL。
- NODEDSA_ACCESS_TOKEN：短效測試 token；不要寫進版本控制或貼到聊天。
- NODEDSA_ECHO_SERVICE：經環境擁有人核可的唯讀服務名稱。
- NODEDSA_DSA_VERSION：實際受測版本。
- NODEDSA_TEST_PACKAGE（可選）：已安裝 tarball 的套件絕對路徑，以便驗證同一產物。

工具驗證兩種 transport 的多行/純空白 echo、PKI 原文中文 SELECT、Session/reConnect 及 HTTP 結構；僅輸出去識別化摘要。30 秒期限只屬測試工具，不是套件新增的 timeout。dev.sh_d 僅為待確認候選，不能以名稱假定為非正式環境。沒有上述服務、環境或證據時，真實驗收保持未完成。

## 發布、發布後檢查與回退

以下由維護者自行執行，本次工作不執行 npm publish 或正式環境變更：

1. 確認 `npm config get registry`、`npm whoami`、`npm view nodedsa versions --json`、發布權限與公開存取設定，目標版本不得已存在。
2. 若先出候選版，以 `npm version 3.0.0-rc.1 --no-git-tag-version` 更新 metadata，同步文件版本，再完整重做測試/打包驗收；由使用者 `npm publish /path/to/nodedsa-3.0.0-rc.1.tgz --tag next --access public`。
3. 正式 3.0.0 的 metadata、CHANGELOG 與產物要重新核對並驗證；由使用者 `npm publish /path/to/nodedsa-3.0.0.tgz --tag latest --access public`。next/latest 是標籤，不是版本號。程式或依賴一旦更動，重做產物驗收。
4. 發布後檢查 `npm view nodedsa@3.0.0 version dist.integrity`、`npm view nodedsa dist-tags --json`，再從 registry 安裝到乾淨專案驗證；保留發布產物對應證據。
5. 出錯時使用端明確固定已驗證舊版（例如 `npm install --save-exact nodedsa@2.1.0`，版號依實際驗證結果選擇），檢查 lockfile 並重建連線/快取。需要時由使用者調整 dist-tag 或 deprecated 問題版本；不預設 unpublish、不由套件自動降級。同名同版本不能覆寫，修正須發布新版本。

## OpenSpec

變更與驗收 tasks 位於 `openspec/changes/add-pki-channel-v3/`。OpenSpec validation 只驗 artifacts，不代表程式、打包產物或真實 DSA 已通過驗收。sync/archive 須另行明確要求。
