## 1. 實作前審閱

- [x] 1.1 完整審閱 proposal、design、三份 delta specs 與 tasks，確認預設 legacy、PKI API、contract 路由、兩模式影響範圍、通用文字 entity、錯誤分類、options/timeout/ready 邊界及實測門檻一致，且使用者已明確要求實作。
- [x] 1.2 在本專案乾淨安裝依賴後建立 npm test 基準，確認 Node.js 18+ 與 nodexml SQL/回應特性；不得以 NODE_PATH 借用其他專案依賴作為新驗收證據。
- [x] 1.3 盤點所有既有公開 API、入口、參數、預設值、回應、錯誤與生命週期契約，確認新增僅為可選 transport，逐項列出相容新增、缺陷修正與 breaking changes。

## 2. PKI 協定與金鑰

- [x] 2.1 新增 CommonJS 通道模組：實作無 token 公鑰請求、HTTP/DSA 錯誤辨識、RSAKeyValue/base64 驗證與 JWK 轉換，不加 DSA 版本限制；mock 僅驗客戶端無 gating，不宣稱舊版伺服器相容。
- [x] 2.2 實作 UUID/MD5/AES-128-ECB/PKCS7、RSA PKCS1、完整 CryptoToken 格式與回應解密，拒絕損壞 Cipher、無效 envelope 和明文成功回應。
- [x] 2.3 實作 Node.js 執行環境級延遲 client RSA 公鑰重用（跨套件副本、worker 隔離）、每請求獨立金鑰與連線級 server key/初始化 Promise；reConnect 清除 server key，以世代隔離舊初始化/登入/重試。
- [x] 2.4 用獨立協定 fixture 或本機模擬伺服器驗證實際 wire 格式、RSA padding、PublicKey 可解密為 RSAKeyValue、中文內層 envelope、亂序並行回應與金鑰重用，不能只做共用函式的自我往返測試。

## 3. 連線整合與錯誤契約

- [x] 3.1 新增 open 第三參數驗證與模式固定，沿用完整 doorway/contract URL 與 DSNS-relative 路徑，在內部拆分而不新增獨立 contract 選項；測試任意 contract、尾斜線、多層 doorway、query、fragment、PKI 只給 DSNS 時在取公鑰/送 token 前失敗、legacy 只給 DSNS 仍允許，以及 getAccessPoint。
- [x] 3.2 將 public-key 初始化置於 login 前，讓 login/send/reConnect 經共用傳輸入口；保留 string/object token、Session、ready、getUserInfo 與既有 send fetch options 行為。
- [x] 3.3 在 open 接收 DSNS 結果及直接 URL 時驗證 HTTP(S)/hostname；錯誤走登入流程，不改獨立 dsnsLookup callback/complite/fallback API。
- [x] 3.4 修正登入錯誤佇列迴圈索引、登入失敗後 send Promise 未結束、終止網路錯誤缺 OnLoginError 與 reConnect 未拒絕/回呼未恢復等問題；callback、Promise、OnError 各結束一次。
- [x] 3.5 保留暫時性登入網路錯誤初次加最多三次重試，確定性 PKI 錯誤直接終止，業務失敗不重送；所有階段禁止明文降級，客戶端自行產生的錯誤訊息不額外附 token、SQL 或金鑰，伺服器 DSA 錯誤欄位保持既有值。
- [x] 3.6 加入回歸測試：初始化/登入前後失敗、多筆排隊請求、多個錯誤回呼、後續 send、reConnect 成敗及重連競態、plain DSA error、解密失敗，逐欄驗證既有錯誤格式；分別驗證 app.js:205、291、298–299、365 迴圈索引隔離/區域宣告，並保留 ready() 失敗 pending 的相容性對照。

## 4. 通用物件 body 文字與回應相容性

- [x] 4.1 對兩種模式所有物件 body 字串文字遞迴使用 entity，不辨識 SQL/key 大小寫/路徑/服務，涵蓋任意 key、巢狀、陣列、@text 及內部登入 Body；屬性、非字串型別、Header/token 與頂層 raw XML fragment 維持原行為，非空 XML 純空白文字逐字輸出 &#32;/&#9;/&#10;/&#13;，空字串/null 保持區別，不新增 xml:space，不修改輸入。
- [x] 4.2 測試兩種 transport 下任意文字欄位（SQL/sql/Script/Description/巢狀/陣列/@text）中的純空白值（單一空格、兩個空格、LF、tab、CR/LF/空格混合，並對照空字串/null）、中文、tab、頭尾空白、換行、CR、連續空白、引號、&、<、>、]]> 及 entity-like 字面值：無 CDATA/注入，標準 XML parser 逐字還原；包含 legacy UDM XML payload、屬性/其他型別與 raw XML CDATA 不改寫的對照，不用 nodexml 當還原標準。
- [x] 4.3 測試 legacy＋使用端 shiftSql/Seed 與 PKI＋原文 SQL/no Seed；證明 nodedsa 不轉換 SQL、不增刪 Seed、不用版本門檻限制 PKI。
- [x] 4.4 以相同 XML fixtures 比對兩模式的單欄 JSON、多欄、多筆、空 Body、中文/entity、Metadata.Column、Record、Column["@text"]；確認 Promise、result callback 與完整 resp 參數一致。
- [x] 4.5 在兩種模式執行既有 send-options 契約回歸，驗證 headers 各形態、trace、signal、method/body 保護及 caller input 不變；以 mock 證明 DSNS/GetPublicKey/初次登入/reConnect 不繼承 send options，取消服務 signal 不取消初始化，不新增 timeout。

## 5. 通用文件、metadata 與依賴

- [x] 5.1 更新 README 與 CHANGELOG：通用安裝與 CommonJS 範例、兩參數 legacy、可選 transport、原路徑格式、任意 contract/非 SQL 服務、失敗不降級、HTTPS、raw XML 責任、所有物件文字 entity 對 legacy/UDM 的影響、純空白數值字元參照及伺服器保留行為待實測的限制、ready() 失敗 pending、內部請求 options/無新增 timeout、舊版 PKI 僅原作者說明未實測、公開契約、相容新增/修正/breaking changes、升級與回退步驟。
- [x] 5.2 將 1campus.dsa.sync.core 遷移說明定位為補充案例：PKI 略過 isSupportCrypto/shiftSql/Seed、legacy 保留 4.8.3.19 策略、按模式隔離連線快取，並列出 SQL 與 UDM 兩處 open、legacy 也受共用變更影響、2.0.0 升版一併帶入 2.1.0 send options；快取失效與批次停頓的因果未證實，不寫成結論，不修改該專案。
- [x] 5.3 將 package.json、package-lock.json 根/packages 根版本對齊 3.0.0，宣告 engines.node >=18 並維持 CommonJS app.js 入口；不引入 ESM 雙入口、未提供的型別宣告或限制舊路徑的 exports。
- [x] 5.4 將正式 nodexml 依賴從 * 固定為 1.0.2，檢查 dependencies/devDependencies 分類、實際依賴解析與變更風險，更新鎖檔；不新增正式加密依賴，標準 XML 測試工具僅作開發依賴。
- [x] 5.5 更新 files 納入全部 runtime 模組與發布文件/既有 MIT 授權資訊，保留作者/repository metadata；如補 LICENSE 先確認既有權利人，不杜撰。

## 6. 本機測試、環境矩陣與規格驗證

- [x] 6.1 執行 npm test，記錄通道 mock/fixture 測試、一般非 SQL 服務、任意 contract 與既有公開 API 回歸結果；確認安裝/require 本身不觸發服務網路請求，不讀取使用端 config/憑證/檔案。
- [x] 6.2 建立並執行 Node 18/20/22/24 測試矩陣，記錄實際 Node/npm 修補版本及結果；無可用環境的項目標記待驗證，不以單一版本代表全部。
- [x] 6.3 執行 npm run spec:validate（openspec validate --all --strict --no-interactive），反向核對 proposal/design/specs 每項承諾都有實作、測試或明確的實測待辦，規格驗證不替代程式測試。

## 7. 實際 tarball 與乾淨使用專案驗收

- [x] 7.1 執行 npm pack --dry-run 核對清單，再建立實際 .tgz，檢查入口、新增模組、metadata、README、CHANGELOG、MIT 資訊完整且排除秘密、本機設定與非必要測試檔。
- [x] 7.2 將同一 .tgz 安裝到 repository 外乾淨專案，移除 NODE_PATH/開發連結，只安裝正式依賴，以 require('nodedsa') 驗證匯出與無載入網路副作用，確認 nodexml 實際為 1.0.2 且不需要 OpenSpec/TypeScript/參考專案。
- [x] 7.3 在乾淨使用專案對受測產物執行 mock PKI 登入/Session、legacy 兩參數、一般非 SQL 服務、SQL、任意 contract、多層路徑、錯誤與回應契約驗收；不得以直接 require 本地 app.js 代替。
- [x] 7.4 在支援環境矩陣執行產物載入及核心呼叫驗證，記錄 tarball 識別、檔案清單、實際依賴、Node/npm 版本與結果；漏包或任何必要驗收失敗時不標示可發布。

## 8. 真實通道驗收與發布交接

- [x] 8.1 準備 opt-in 非正式環境實測入口與步驟：測試憑證從執行環境讀入，禁止硬編碼或輸出；攔截檢查登入/查詢 HTTP body 不含 token/SQL，PKI SQL 查詢限定無資料寫入 SELECT；另外準備環境擁有人允許且無寫入/更新/部署副作用的非 SQL 讀取或 echo 測試服務，能觀測收到的多行/純空白文字長度與各字元，不以 UDM 更新測試。套件 runtime 不自動讀取測試環境憑證。
- [ ] 8.2 先由環境擁有人確認目標用途/資料/操作範圍；dev.sh_d 4.8.7.2 僅為待確認候選，不自行假定為非正式環境。於確認後的 DSA 以真實字串 PassportAccessToken 驗證受測產物的 PKI 初次登入、Session 後續原文中文 SELECT/no Seed 與 reConnect，保留去識別化結果和環境版本，標示低於 4.8.3.19 尚未實測，單台成功不外推舊版支援。亦須以 legacy 至少完成一個非 SQL 服務的多行物件文字呼叫，並在 legacy/PKI 兩模式各驗純空白單一空格、兩個空格、LF、tab、CR/LF/空格混合與空字串對照；觀測服務實際收到的字元/長度，不只看成功狀態或只用 SQL 結果推論其他服務。無此唯讀測試服務、環境、可觀測性或憑證時相關驗收保持未完成；正式環境僅提供使用者自行執行步驟，不由 AI 助手操作。
- [x] 8.3 提供由使用者執行的發布前清單與指令：registry、套件名稱、版本唯一性、權限、公開存取設定、dry-run、候選版如 3.0.0-rc.1/next 與正式 3.0.0/latest 的 metadata/變更紀錄/實際產物核對，說明發布同名同版本不能覆寫。
- [x] 8.4 提供由使用者執行的發布後版本/dist-tag/乾淨安裝確認，以及固定舊版、重建 lock/連線、新版修正與必要時 dist-tag/deprecated 的回退指引，不預設 unpublish，不自動降級。
- [x] 8.5 反向審閱 proposal/design/三份 specs/tasks，逐項區分原始碼測試、矩陣、產物安裝、規格與真實 token 證據；未完成 8.2 的 PKI token、legacy 非 SQL 多行文字及兩模式純空白服務驗收，不宣稱 3.0.0 相容性驗收完成。交付發布步驟，不自行 publish、修改 registry metadata、部署、sync、archive、commit 或 push。

## 9. 重連路由相容性修正

- [x] 9.1 核實 DSNS 快取過期/失聯下的 legacy 與 PKI 重連回歸，沿用先前已驗證 url/contract/logical，但仍重置 token、世代與 PKI key；未解析成功時保留重試解析能力。
- [x] 9.2 執行兩模式回歸、Node 18/20/22/24 原始碼與產物矩陣、OpenSpec strict validation，重新打包並更新 SHA-256、文件與驗證紀錄。

## 10. ready 一次性等待修正

- [x] 10.1 同步規格與設計，實作一次性等待佇列、先清空快照再通知、目前世代隔離、失敗保持 pending 後重連恢復，沿用 invoke 例外隔離。
- [x] 10.2 修正將 ready 重播視為預期的 assertion，補齊兩模式單一/多個註冊、連續重連、新等待者、回呼重入、resolver 一次完成與舊世代成功不消耗佇列的回歸測試。
- [x] 10.3 更新 README/CHANGELOG，執行原始碼與打包產物 Node 矩陣、OpenSpec strict validation，重新產生測試包與驗收證據，保留真實 DSA 待辦。

## 11. callback 同步例外相容性與非同步退出行為

- [x] 11.1 先同步 spec/design，讓 invoke/rejectRequest 共用 sync 參數，落實同步 send settled/result/OnError/reject 順序、拋出即停止與未回傳 Promise 收尾；ready/OnLoginError 立即通知恢復同步拋出。
- [x] 11.2 補兩模式子程序測試：同步外層可捕捉、退出 0、無額外 unhandledRejection；非同步預設退出 1、callback 一次且登入/服務不重試，另驗通知順序與停止後續回呼。
- [x] 11.3 README/CHANGELOG 明列非同步例外終止程序的不相容變更及 callback 自行處理責任，重跑 Node 原始碼/產物矩陣與 strict validation，更新 tarball 與證據。

## 驗證證據

本機及產物驗證詳見 verification.md；8.2 的真實 DSA 驗收保持未完成，整個 change 尚未完成發布驗收。

## 12. DSNS contract 邊界與測試入口

- [x] 12.1 先同步四份 artifacts，PKI DSNS lookup 前後共用 contract 解碼/判空，補缺少尾段、尾斜線、編碼空白、無效編碼與有效路由/legacy 對照。
- [x] 12.2 實作 scripts/run-tests.js：排序明確枚舉、轉傳參數、空集合及 spawn error/status=null 非零、一般退出碼原樣回傳；產物驗收共用，補隔離測試。
- [x] 12.3 更新文件，跑 Node 18/20/22/24 原始碼及產物矩陣、篩選參數與 OpenSpec strict validation，更新 tarball/verification；明列 Windows 實機未驗證，真實 DSA 8.2 保持未完成。

## 13. Legacy 相容性與錯誤分類審查修正

- [x] 13.1 同步 proposal/design/specs，明訂 initial/reconnect 通知、混合 HTTP 分類、legacy 容忍度、PKI 嚴格驗證、本機 XML 錯誤與 Message 缺失值。
- [x] 13.2 實作登入來源隔離、回應先讀取再分類、legacy 舊版失敗欄位、PKI 明文/密文/公鑰非 2xx 分支、xml_error 與 Message 原值。
- [x] 13.3 補初次/重連/舊世代/排隊通知及有界子程序測試；補 HTTP/解析/非法資料兩模式回歸、回呼 response/parsed 欄位與重試次數，修正過期的預期。
- [x] 13.4 更新 README/CHANGELOG 的 A–I 決策及新舊差異，執行 Node 18/20/22/24 原始碼與產物矩陣、strict validation，更新測試包與 verification，真實 DSA/Windows 驗收仍未完成。

## 14. XML 名稱完整性、位址分類與驗證清理

- [x] 14.1 同步 artifacts，完整 XML 1.0 Fifth Edition 名稱規則、access_point_error、重連取代初次登入情境與 ready 提醒、明文僅驗一次/密文兩層各一次。
- [x] 14.2 實作完整名稱範圍、中性位址錯誤、hasCipher 重用、字元檢查與 envelope 結構檢查分離，不放寬 PKI 驗證。
- [x] 14.3 用標準 parser 對照合法/非法名稱及範圍邊界，涵蓋 Body/PKI 回應；補位址分類、被取代的初次登入失敗/後續恢復及驗證次數測試。
- [x] 14.4 更新 README/CHANGELOG/verification，跑 Node 18/20/22/24 原始碼與產物矩陣及 strict validation，更新測試包；真實 DSA/Windows 驗收仍待完成。

## 15. 傳輸拒絕值、原始路由及 Windows npm 入口

- [x] 15.1 同步 artifacts：保留 AbortError/拒絕原值、PKI 原始路徑共用切分與 pki_error、npm JS 入口、同步 OnError→result→reject；修正先前相反順序的規格。
- [x] 15.2 實作 retryable 正規化、原始路徑 dot/backslash/encoding 防護與共用 helper、npm_execpath/已存在標準位置 fallback，以及同步通知排序。
- [x] 15.3 補兩模式 fetch/text 任意拒絕值/abort/重試、PKI 全 URL/DSNS/編碼/反斜線路由、npm 入口/空白符號路徑/缺入口、通知順序與 callback 例外子程序回歸。
- [x] 15.4 更新 README/CHANGELOG/verification，完成 Node 18/20/22/24 原始碼與實際產物矩陣及 strict validation，更新測試包；記錄 Windows 官方限制已修但實機及真實 DSA 驗收仍待完成。

## 16. 編碼分隔符及非傳輸登入例外

- [x] 16.1 同步 artifacts，解碼後斜線拒絕、登入任意例外安全收尾，明列晚註冊 OnLoginError 例外且維持可修改 Error 沿用。
- [x] 16.2 修正 app.js，補兩模式 null/undefined DSNS/token getter、初次/重連/排隊/ready 恢復與無 unhandledRejection 子程序測試；補 URL/DSNS/回傳 doorway 的編碼斜線防護與 query 對照。
- [x] 16.3 更新 README/CHANGELOG，跑 Node 18/20/22/24 原始碼/實際產物矩陣與 strict validation，更新測試包/verification；真實 DSA/Windows 驗收保持未完成。
