# 3.0.0 實作與本機驗證紀錄

本紀錄僅表示本機實作與打包驗收通過。**真實 DSA 驗收尚未完成，不表示整個 3.0.0 已可發布。** 未執行 npm publish、registry metadata 寫入、正式 DSA 操作、部署、sync、archive、commit 或 push。

## 實作與證據

- app.js：保留獨立 dsnsLookup 實作，新增可選 transport 與內部 doorway/contract 路由、登入前 PKI、重連世代隔離，修正終止失敗與回呼/Promise 漏結束。
- lib/secure-tunnel.js：RSAKeyValue、RSA-PKCS1/UUID/MD5/AES-128-ECB/PKCS7、每請求金鑰、跨套件副本公鑰重用、不降級及 HTTP/XML/PKI 錯誤分類。
- lib/xml.js：通用物件 body entity、純空白數值參照、raw XML/屬性慣例保留及回應結構檢查；回應仍由 nodexml 1.0.2 解析。
- test/helpers/mock-dsa.js：獨立伺服器 fixture，使用 RSA raw operation 檢查 PKCS1 v1.5 padding block 並獨立 AES 解密，未引用客戶端 crypto/XML helpers；僅供測試，不在產物。
- scripts/npm-runner.js：以目前 Node 執行已確認存在的 npm JS 入口，使用 npm_execpath 或標準相對位置，不經 shell/npm.cmd。
- scripts/test-package.js：實際 tarball 安裝至乾淨專案，僅安裝正式依賴、清除 NODE_PATH，再以安裝後套件執行測試。
- scripts/verify-live.js：opt-in 非正式工具；已確認缺設定時退出且不發請求，尚未連線真實目標。只輸出去識別化摘要，服務需事先由環境擁有人核可。

## 支援環境與產物測試

先在本專案建立 2.1.0 基準（11 項通過），再安裝精確 nodexml 1.0.2 與僅開發用 saxes 6.0.0。最後以 Node 20.20.0 對最終 lockfile 完成乾淨離線 npm ci --ignore-scripts。

| Node | npm | 原始碼測試 | 安裝後 tarball 測試 |
| --- | --- | --- | --- |
| v18.20.7 | 10.8.2 | 154 通過，0 失敗 | 154 通過，0 失敗 |
| v20.20.0 | 10.8.2 | 154 通過，0 失敗 | 154 通過，0 失敗 |
| v22.12.0 | 10.9.0 | 154 通過，0 失敗 | 154 通過，0 失敗 |
| v24.17.0 | 11.13.0 | 154 通過，0 失敗 | 154 通過，0 失敗 |

兩類測試涵蓋 legacy 預設/明確模式與 PKI。測試 harness 的 saxes 屬外部開發工具；安裝後 runtime 只需要正式 nodexml 1.0.2，不需要 OpenSpec/saxes/TypeScript，require 本身不發網路請求。

主要觀察：

- legacy 不取公鑰，目標 URL 含 contract；PKI 先取公鑰，登入與服務目標為 doorway，外層沒有 token/服務內容。
- 獨立解密比對內層 contract/service/PassportAccessToken/Passport XML/Session/body；UUID 各異、公鑰重用、亂序回應正確。
- 公鑰、密文或解密後 XML 無效及明文成功均失敗、不改送明文；非零明文 DSA 錯誤保留分類。
- queued/later send、網路四次失敗通知、reConnect 成敗/競態、舊 retry/在途回應、多個成功/錯誤回呼及 ready 限制。
- Fetch headers 各形態、trace/signal/method/body 保護、輸入不變，內部請求不繼承服務 options。
- 任意 key、巢狀、陣列、@text、中文/CR/LF/tab/頭尾空白/純空白/]]>/entity-like 文字以標準 parser 還原；屬性/其他型別/raw XML 對照。
- 同一回應以 nodexml 比對單欄 JSON、多欄/多筆、空 body、中文及 entity 的物件形狀。

## 本機使用專案安裝產物

- 檔案：`/private/tmp/nodedsa-3.0.0.tgz`
- SHA-256：`3d0dd0c24bf047e945ac7253f4827e339de9124e8de171716bad9da18124b832`
- 四個 Node 環境打包 SHA-256 完全相同。
- 檔案白名單：`CHANGELOG.md`, `README.md`, `app.js`, `lib/secure-tunnel.js`, `lib/xml.js`, `package.json`。

```sh
# 在本機使用專案執行；不會發布套件
npm install --save-exact /private/tmp/nodedsa-3.0.0.tgz
```

原始紀錄（暫存檔，可能由 OS 清除）：

- v18.20.7：`/var/folders/s9/hpb12f6x425byx_pcb7ns4p80000gn/T/nodedsa-package-2qwtMg/tests.tap`，同目錄 `evidence.json`。
- v20.20.0：`/var/folders/s9/hpb12f6x425byx_pcb7ns4p80000gn/T/nodedsa-package-R3puBw/tests.tap`，同目錄 `evidence.json`。
- v22.12.0：`/var/folders/s9/hpb12f6x425byx_pcb7ns4p80000gn/T/nodedsa-package-4xoO3S/tests.tap`，同目錄 `evidence.json`。
- v24.17.0：`/var/folders/s9/hpb12f6x425byx_pcb7ns4p80000gn/T/nodedsa-package-X1CaqF/tests.tap`，同目錄 `evidence.json`。

## 依賴與工具限制

- npm audit 列出 4 項 high，均為既有 OpenSpec 開發鏈（@fission-ai/openspec → fast-glob → micromatch → braces），來源 advisory GHSA-vfj7-8cjw-p6xm。未列出正式依賴漏洞不等於保證無漏洞。本次不順帶升級 OpenSpec 或修改其依賴鏈。
- OpenSpec 開發工具要求 Node >=20.19，與 runtime Node >=18 是不同範圍；規格驗證使用 Node 20.20.0。
- tarball 不含開發測試腳本、憑證或本機設定。scripts 在 repository 供維護者使用；既有 MIT 宣告在 metadata/README 中保留。

## 未完成：真實服務驗收（tasks 8.2）

沒有經環境擁有人確認的非正式目標、短效字串 token 與可觀測輸入的唯讀非 SQL echo 服務，故以下仍未完成：

1. 真實 PassportAccessToken 的 PKI 登入、Session 中文 SELECT 與重連後呼叫。
2. legacy 至少一個非 SQL 服務的多行文字接受/保留。
3. 兩模式純空白字串的應用層字元/長度保留與空字串對照。

數值參照、mock 與標準 parser 不能替代上述證據。dev.sh_d 僅為待確認候選；低於 4.8.3.19 仍無獨立伺服器實測。ready 失敗 pending、內部初始化/登入無新增 timeout、獨立 dsnsLookup 與 main spec 的既有差異均依設計保留。

## 最終檢查

- npm run spec:validate（openspec validate --all --strict --no-interactive）：通過。
- 獨立 change strict validation、git diff --check 與新增文字檔行尾檢查：通過。
- 原始碼/產物/規格/真實服務證據分開記錄；main specs 未同步或封存。

## Review 修正：reConnect 不重新依賴 DSNS

- 修正前隔離重現：legacy 與 PKI 初次 DSNS 解析/登入成功，模擬六分鐘後快取過期且全部 DSNS 端點失聯，reConnect 各查詢七個 DSNS 端點、沒有送出 DSA 重連請求，最後以 Invalid DSA access point or DSNS result 拒絕。HEAD 的 2.1.0 reConnect 直接使用已解析 _accessPoint，不重新查 DSNS，因此確認為本次實作回歸。
- 先加入 legacy/PKI 的回歸測試：修正前兩項均失敗（`/private/tmp/nodedsa-reconnect-before.log`）。
- startLogin 新世代帶入上一狀態已驗證的 url/contract/logical，key 仍清空。無先前有效路由時仍 resolvePoint，讓初次解析失敗的連線可恢復。
- 修正後四個情境（兩模式的過期/失聯重連與初次解析失敗後恢復）全通過（`/private/tmp/nodedsa-reconnect-after.log`）。PKI 回歸亦確認有第二次取公鑰、相同 doorway/contract、使用新 token 與後續服務成功。
- DSNS 修正當輪 Node 18/20/22/24 的原始碼與乾淨安裝 tarball 各 52 項通過；目前產物已再套用下方 ready 修正。此為 mock/本機證據，真實 DSA tasks 8.2 狀態不變。

## Review 修正：ready 一次性等待

- 核實結果：目前 legacy/PKI 的單一 ready callback 在初次成功加兩次重連後均執行三次；舊版單一 callback 是一次，但兩個 callback 時會因迴圈中換回陣列而重跑第二個。兩版也都保留已完成 resolver，故不複製舊版暫換陣列方式。
- 先同步 proposal/design/dsa-client spec/tasks，再加入回歸。針對重播的四項選定測試在修正前全部失敗（`/private/tmp/nodedsa-ready-before.log`）；修正後新增 13 項 ready 測試全部通過（`/private/tmp/nodedsa-ready-after.log`）。測試開發時曾修正一項 legacy 的微任務等待斷言，該修正未更動 runtime。
- 以一次性 readyWaiters 取代永久 callback 陣列。目前世代成功時先 splice(0) 取得快照並清空，再派送請求/通知；舊世代結果無權消耗佇列。
- 每次註冊只完成一次。已登入即完成且不入佇列；初次登入失敗及失敗後新增者保持 pending，後續有效重連可完成。重連不重播已完成者；回呼內再 ready/reConnect 時，快照與新等待者分離。
- 新測試涵蓋兩模式 callback/Promise resolver 每次僅執行一次、連續重連、新等待者、初次失敗後恢復、舊成功先到的世代隔離、回呼重入，以及子程序中拋出 callback 例外仍完成其他等待者。以公開 Promise 建構/resolve 計數觀測重播，沒有新增 runtime 測試 API。
- 將先前錯誤期待 ready==2 的 assertion 修正為 1；README/CHANGELOG 明列新語意。
- ready 修正當輪 Node 18/20/22/24 的原始碼與安裝後 tarball 各 65 項通過（0 失敗），包含上輪四個 DSNS 回歸案例。目前產物已再套用下方 callback 例外邊界修正；tasks 8.2 的真實 DSA 驗收仍未完成，未發布。

## Review 修正：同步 callback 傳遞與非同步程序退出

- 修正前的隔離核實：舊版非同步 ready/OnLoginError 的 callback 例外會被 login catch 捕捉，四次登入/通知後退出 0；新版非同步例外在流程外成為 uncaughtException，退出 1。此不相容行為已明列 README/CHANGELOG，不再只稱為「隔離」。
- invoke/rejectRequest 共用內部 sync 參數，錯誤欄位不分叉。同步 ready（已登入）與 OnLoginError（已有錯誤）直接傳回 callback 例外。ready 在 Promise 建立前呼叫，拋出時不建立 Promise、不加入等待者。
- 同步 send 立即失敗：先 settled，result → 註冊順序 OnError，finally reject；任一 callback 拋出就停止，為無法回傳的內部 Promise 掛 catch 後原樣拋出 callback 例外，避免額外 unhandledRejection。一般無 callback 例外時不掛此處理，send rejection 仍須由使用者處理。
- 非同步失敗保留 reject → OnError → result，callback 直接 throw 透過 microtask 回報，不重試登入/服務，其他非同步通知完成；這不是程序可安全恢復的承諾。
- 新增 28 項隔離子程序案例（兩種 transport），沒有安裝會壓制退出的 uncaughtException/unhandledRejection handler，僅用 uncaughtExceptionMonitor 觀察。同步路徑外層捕捉同一例外，退出 0、無額外 unhandled rejection；非同步退出 1、origin=uncaughtException、callback 一次、登入/服務一次。
- 以公開 Promise 建構/reject 次數驗證：立即 ready 例外沒有建立 Promise；同步 send 回呼執行期間尚未 reject，最後只 reject 一次，OnError 看到 settled=true，回呼停止順序符合 spec。測試記錄：`/private/tmp/nodedsa-callback-errors.log`。
- 最終 Node 18/20/22/24 原始碼與安裝產物各 93 項通過（0 失敗），包含 ready 與 DSNS 修正；四個打包 SHA-256 一致，上方測試包已更新。tasks 8.2 真實 DSA 驗收仍未完成，未發布。

## Review 修正：DSNS contract 與跨平台測試入口（2026-10-21）

- 修正前以 mock 獨立核實：school/、school/// 會把 school 當 contract，取公鑰目標錯成 https://fixture.test/cs4。現在 lookup 前後共用 contractFromPath：去尾斜線、取末段、decodeURIComponent 後 trim 判空；拒絕缺尾段、編碼空白及無效百分比編碼，不查 DSNS、不取公鑰、不送 token。query/fragment 不算 contract。正常編碼 contract、完整 URL 與 legacy 尾斜線有對照測試。
- 無 shell 隔離重現：Node 18.20.7/20.20.0 不展開 literal test/*.test.js，22.12.0 可展開。相同布局的無參數 node --test 在三個版本均誤收 scripts/test-package.js 與 test/helpers/mock-dsa.js，因此沒有採用預設探索。
- scripts/run-tests.js 明確枚舉 test/ 直屬的一般 *.test.js，排序、傳遞參數，空集合/啟動錯誤/status=null 非零，正常退出碼原樣回傳；產物驗收共用。隔離測試驗證範圍、排序、空集合、參數、真實測試失敗與模擬 spawn error/訊號結果。npm test -- --test-name-pattern='PKI rejects missing' 已驗證篩選成功。
- 新增 5 項測試，四個 Node 版本的原始碼及獨立安裝產物各 98 項通過、0 失敗，四份產物 SHA-256 相同；上方本機測試包與矩陣已更新。測試開發初輪在 Node 20/22/24 發現嵌套測試程序繼承 NODE_TEST_CONTEXT，修正隔離測試環境後重跑全部矩陣通過，沒有因此改動 runtime 或 runner 行為。
- **未執行 Windows 實機驗收**：上述均在 macOS 執行。無 shell 呼叫與隔離布局只能證明不依賴 shell glob 及明確的選檔/退出行為，不能宣稱 Windows 完整支援已驗證，亦未驗證 Windows 的 npm.cmd 產物安裝流程。
- 真實 DSA tasks 8.2 仍未完成；未連線真實 DSA、發布、sync、archive、commit 或 push。

## Review 修正：legacy 相容性 A–I（2026-10-21）

- 先核對舊版 HEAD:app.js、新版與 artifacts，再以隔離子程序實測：OnLoginError 直接重連在新版連續觸發到人為上限 6 次，舊版 2 次停止；HTTP 500/DSA 501 在新版原先未讀 body；控制字元/未知 entity 舊版可回傳、新版原先拒絕；非法物件 Body 舊版會送出、新版本機失敗卻標 fetch_error；2xx HTML 舊版的 DSA 失敗及登入原始回應被新版改分類。缺 Message、第三參數與同步通知順序差異也已核實。舊版網路初次登入 4 次後重連僅 1 次，新版每次各 4 次。此均為 mock/本機，沒有真實 DSA 寫入。
- 先同步 proposal/design/三份 specs/tasks：A 採明確 state.source，只有 initial 失敗通知既有 OnLoginError；reconnect 拒絕自身 Promise 並結束排隊/後續 send，不置換 callback 陣列。晚註冊立即通知與舊世代隔離保留。這取代原 spec 明列的重連通知，不宣稱那是未定義行為。
- 唯讀核對目前同步專案 server 原始碼：dsaCryptoSql 在 OnLoginError 和查詢 catch 均刪連線快取，未找到 reConnect 呼叫；歷史快取未刪與排程停頓仍只是程式推論，沒有事故因果驗證。未修改參考專案。
- B/E 採混合分類：post 先讀 body；legacy 2xx 直接 nodexml、缺 Envelope/Status 回到舊版 dsaError/loginError 欄位，登入保留 data/response/textStatus。兩模式非 2xx 的有效非零 DSA 錯誤保留 status/message/header/response；其餘（HTML/空內容/缺 status/Code 0）http_error。PKI 分別驗明文/加密 DSA 錯誤，損壞 Cipher 仍 pki_error，取公鑰非 2xx 的 RSA key 不接受為成功。
- C/D/F：legacy 回應不再 validateXml，直接 U+001A、非法數值參照與未知 entity 的結果逐欄比對 nodexml；PKI 仍拒絕這些內容。兩模式非法物件 Body 保留本機拒絕並改 xml_error，不送服務 HTTP、不改輸入、通知各一次。Message 缺失恢復 undefined，保留屬性存在；缺 Status 仍使用舊版空字串。
- G/H/I 文件明列：第三參數 null/未知欄位從忽略改拒絕；同步 options 失敗通知由 OnError→result 改 result→OnError；真正解析例外不重試且分類 xml_error，fetch/text 的 retry budget 每次登入重置。未把這些變更誤寫成全部相容。
- 新增 29 項回歸（共 127），涵蓋有界子程序、排隊/後續 send、晚註冊、舊世代、HTTP 錯誤兩模式/兩階段/公鑰/明文/密文、非法資料與 parser exception 注入、每次登入 text-read 重試預算。開發首輪修正兩項 assertion（reConnect 拒絕的是錯誤物件，不能用字串 regex 比對）；產物驗收再發現 parser exception 注入指向 repository nodexml，改用已安裝套件自己的依賴後重跑全部矩陣通過，這些皆為測試修正。
- 最終 Node 18.20.7/20.20.0/22.12.0/24.17.0 原始碼與獨立安裝 tarball 各 127 項通過、0 失敗，四個產物 SHA-256 一致，頂端矩陣及本機測試包已更新。OpenSpec strict validation 另行通過，不代替程式或伺服器證據。
- **Windows 實機及真實 DSA 8.2 仍未驗收**；沒有發布、sync、archive、commit 或 push。

## Review 修正：XML 名稱、位址分類與 PKI 驗證工作量（2026-10-21）

- 使用既有 add-pki-channel-v3，先更新 proposal/design/三份 specs/tasks，維持初次登入被重連取代時的 source/generation 契約，不改回通知既有 OnLoginError。README 補明不同程式段落的通知邊界、reConnect rejection 的責任，以及不要用 timer 等方式重複建立 ready 等待者；仍接受失敗後新等待者並於有效成功完成。
- 名稱改依 XML 1.0 Fifth Edition productions [4]/[4a]/[5]（https://www.w3.org/TR/xml/#NT-NameStartChar），不用 Unicode L/N 近似。完整範圍邊界、相鄰 code point、補充平面、合法/非法首字及後續字元，以 saxes 獨立判定，透過公開 send 驗物件 Body 元素/屬性，以及真正加密後的 PKI 回應。成績（期中）、a+U+0301、x+U+203F、U+3001+x 可通過，x+U+00B2 拒絕。
- 差異測試額外找出舊 validateXml 使用 JS 廣義空白作名稱分隔符的問題：會誤接受 U+2000 等非法名稱位置，也會誤拒 U+1680/U+FEFF 等合法名稱字元。標籤/屬性與 Cipher/Envelope 判別改用 XML S 的四種空白，測試補齊這些字元。此為同項名稱正確性修正，沒有放寬密文或明文成功驗證。
- 測試開發另確認：回應 fixture 先經 UTF-8，孤立 UTF-16 surrogate 會在編碼時變為 U+FFFD，故回應的標準 parser 比較使用實際 wire 字元；Body 本機檢查仍拒絕孤立 surrogate。nodexml 對 JS 空白名稱的既有 key 處理未重塑，回應逐欄比對同版本 nodexml，不聲稱修正第三方 parser。
- 非字串 accessPoint、無效直接位址與 DSNS 結果在兩模式皆為 loginError.XMLHttpRequest.type=access_point_error，不送登入/公鑰 HTTP。PKI 缺 contract 仍 pki_error，空 accessPoint 的同步拒絕不變。CHANGELOG 列明 type 值變更。
- 私有 checkedEnvelope 僅驗已解析結構，公開模組入口 parseEnvelope 仍驗原 XML；明文錯誤重用已驗證/已解析結果，hasCipher 使用單次判定。validateCharacters 與 escapeText 分離，validator 不產生用完丟棄的跳脫字串。隔離子程序計數：RSA key/登入外層/登入內層各一次；明文服務錯誤一次，密文服務錯誤或成功外層/內層各一次；明文成功仍拒絕且只驗一次，公鑰明文錯誤一次。不採用未重測的 7 MB/350 ms 數據或宣稱效能幅度。
- 新增 8 項測試；Node 18.20.7/20.20.0/22.12.0/24.17.0 原始碼與獨立安裝產物各 135 項通過、0 失敗，四份 tarball SHA-256 相同。上方矩陣、暫存 log 路徑及本機測試包已更新。OpenSpec strict validation 與變更空白檢查通過。
- 真實 DSA tasks 8.2 與 Windows 實機驗收仍未完成；未發布、sync、archive、commit 或 push。

## Review 修正：任意傳輸拒絕值、原始路徑與 npm 入口（2026-10-21）

- 先更新 proposal/design/三份 specs/tasks，將同步 send callback 順序改為 OnError→result，finally reject；保留 settled、同步例外原樣傳回、停止後續 callback 與無法回傳 Promise 的 rejection 收尾。非同步仍先 reject 再 OnError→result，callback 例外隔離不變。舊版已失敗登入後 send 只有 result，並無 OnError 或 Promise 結束；文件未再誤稱所有舊路徑同序。
- fetch/text 會拒絕任意 JS 值；重現字串、null、凍結 Error 被 retryable 賦值 TypeError 遮蔽。現在可修改 Error 沿用（DOMException AbortError 的 name 保留），其餘用 cause 包裝；primitive String(reason)、凍結 Error 的 name/message/stack/type 保留，無法轉字串物件用通用訊息。直接 post 與兩模式公開取消/登入路徑均測試，服務不重試，字串/null 的登入 fetch/text 各最多四次、終止通知一次。測試不連真實 DSA。
- 共用 splitPkiRoute 同時回傳原始 doorway path、解碼 contract 及 scheme 判定。正規化/DSNS lookup 前拒絕 .、..、混合百分比編碼、反斜線/編碼反斜線、內部 tab/CR/LF 與無效百分比/UTF-8 編碼，皆 pki_error。DSNS 回傳 unsafe doorway 在取 key 前拒絕；query/fragment 不作為路徑，query 可含 URL、點、反斜線或類百分比文字。Unicode contract 字元不以廣義 trim 改寫，legacy 沿用原路由。
- 開發中完整矩陣抓到合併 helper 時把 school/ 的學校名稱當成 contract 的回歸；已讓 helper 明確在 DSNS 名稱後取 path，原有 school/、school/// 與編碼空白零 lookup 案例重新通過。這是本輪實作錯誤的修正，非調整測試預期；之後重跑完整矩陣。
- scripts/npm-runner.js 優先有效 npm_execpath；直接 node 執行時檢查 Node 同目錄 node_modules/npm/bin/npm-cli.js 與父層 lib/node_modules/npm/bin/npm-cli.js，所有候選皆無效就明確失敗。以 process.execPath 執行 CLI、參數陣列、shell=false。測試含空白/符號檔案路徑、literal shell metacharacters、兩種 fallback、無效入口不改走 PATH/npm.cmd。
- Windows 原先直接執行 npm.cmd 的方式，依 Node 官方 CVE-2024-27980 行為確認不適用（https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2）；該呼叫方式已移除，不能再只描述為不知是否有問題。**修正後仍未做 Windows 實機驗收**；本輪只在 macOS 驗證 Node JS 入口流程，不將之當成 Windows 完整支援證據。
- 新增 14 項測試，並更新既有 16 項同步 send 例外子程序的順序斷言；它們仍驗退出 0、外層捕捉、callback 停止順序、reject 一次與無額外 unhandledRejection。非同步退出/不重試案例維持通過。Node 18.20.7/20.20.0/22.12.0/24.17.0 原始碼與獨立安裝 tarball 各 149 項通過、0 失敗，四份 SHA-256 相同，頂端矩陣與本機測試包已更新。
- 另以 Node 20.20.0 的 npm run --silent test:package 實際驗證 npm_execpath 分支：149 項通過，產物 SHA-256 與直接 node 流程相同；證據 `/var/folders/s9/hpb12f6x425byx_pcb7ns4p80000gn/T/nodedsa-package-hIPntY/tests.tap`，同目錄 evidence.json。
- OpenSpec strict validation 與變更空白檢查通過。真實 DSA tasks 8.2 及 Windows 實機驗收仍未完成；未發布、sync、archive、commit 或 push。

## Review 修正：編碼分隔符與非傳輸登入例外（2026-10-23）

- 使用既有 add-pki-channel-v3，先同步 proposal/design/dsa-client/pki-channel/tasks；不改晚註冊 OnLoginError 立即同步通知或可修改 Error 沿用的既定契約，也未順帶整理 require/錯誤建構/autoRetry/base64。
- 修正前隔離重現：..%2F..%2Fadmin 讓 TargetContract 成為 ../../admin，HTTP doorway 仍原位；這是 contract 段界線缺漏，未證明 HTTP URL 穿越。逐段一次解碼後含 / 或反斜線都 pki_error。完整 URL、DSNS-relative 在 lookup 前拒絕、回傳 doorway 在取 key 前拒絕；query 的 ..%2F..%2Fadmin 與 legacy 路由有對照，不遞迴解碼或改值。
- 修正前 DSNS lookup 與 token Type getter 拋 null，皆重現 catch 本身讀 retryable 失敗的 unhandledRejection，未通知且排隊 send pending。現在安全讀取 retryable/message，無訊息或不能轉字串時用 Network error occurred，XMLHttpRequest 保留原值；非傳輸例外不新增重試。初次通知/排隊/後續 send 正常結束，reConnect 仍只拒絕自身 Promise，ready 保持 pending 待恢復。
- 新增四個隔離子程序案例（legacy/PKI × DSNS/token getter），使用 --unhandled-rejections=strict，未安裝會吞掉 rejection 的 listener。各測 null、undefined、字串、無法轉字串物件、讀 retryable/message 會拋例外的物件，確認初次通知一次、排隊/後續/重連 send 拒絕、非傳輸嘗試一次，後續有效 reConnect 完成原 ready 等待者，子程序退出 0。
- 既有晚註冊案例加強為：重連失敗前 handler 0 次、失敗後新增者立即 1 次。spec scenario 與 README 明列這是相容性例外，「不派送既有 handler」不表示晚註冊不能讀目前錯誤；沒有改記錄來源或取消重播。
- 共新增 5 項測試。Node 18.20.7/20.20.0/22.12.0/24.17.0 原始碼與獨立安裝 tarball 各 154 項通過、0 失敗，四份產物 SHA-256 一致；頂端矩陣、暫存 log 路徑及本機測試包已更新。OpenSpec strict validation 與變更空白檢查另行通過。
- 真實 DSA tasks 8.2 及 Windows 實機驗收仍未完成；未連真實 DSA、發布、sync、archive、commit 或 push。
