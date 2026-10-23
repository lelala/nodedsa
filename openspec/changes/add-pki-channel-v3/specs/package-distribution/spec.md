## ADDED Requirements

### Requirement: 通用套件與公開入口

nodedsa SHALL 作為獨立 npm 套件供任意使用專案安裝，以 CommonJS `require('nodedsa')` 提供既有 dsnsLookup/open 匯出。Runtime SHALL NOT 依賴使用端 repository、config 檔、環境憑證、同步流程、特定 contract 或學校。安裝及 require SHALL NOT 觸發登入、取公鑰或服務網路請求。本版本 SHALL NOT 新增 ESM 雙入口或宣告尚未提供的 TypeScript 型別。

#### Scenario: 任意使用專案載入

- **WHEN** 無參考專案檔案、設定或憑證的乾淨專案安裝並 require nodedsa
- **THEN** 既有匯出可使用，且載入本身不發出網路請求

#### Scenario: 一般非 SQL 服務

- **WHEN** 呼叫者以任意合法 contract 路徑在任一 transport 呼叫非 SQL DSA 服務
- **THEN** 套件依公開 API 處理，不要求 SystemMaintenance、Seed 或同步專案設定

### Requirement: 明確版本與相容性資訊

正式目標版本 SHALL 為 3.0.0，package.json、package-lock.json 的根及套件根版本、README 與 CHANGELOG SHALL 一致。升級指引 SHALL 區分相容新增、既有缺陷修正及不相容行為，列出 legacy 預設、沿用路徑格式、無效 URL/DSNS 提前失敗、所有物件 body 字串文字（含 legacy UDM）的 entity 表示變更、失敗通知修正、ready() 一次性通知、不重播、失敗 pending 後可於重連恢復，以及內部初始化/登入沒有新增 timeout。文件 SHALL 明列 access_point_error 的 type 變更、初次登入被重連取代的通知邊界、不要重複輪詢 ready 的提醒，且 SHALL 另列重連不重播 OnLoginError、非 2xx 混合分類、legacy 回應容忍度與 PKI 嚴格限制、非法物件 Body 本機拒絕、缺 Message 保留 undefined、第三參數驗證、同步通知新舊順序及登入重試範圍/計數差異。套件 SHALL 宣告 Node.js >=18，保留 CommonJS 入口。

#### Scenario: 既有使用者評估升級

- **WHEN** 使用者閱讀 3.0.0 升級說明
- **THEN** 能識別兩參數呼叫維持 legacy、PKI 需明確選用，以及哪些失敗或 XML wire 行為會改變

#### Scenario: 支援環境驗收

- **WHEN** 準備完成 3.0.0 發布驗收
- **THEN** Node 18、20、22、24 測試矩陣記錄各實際 Node/npm 版本及結果，缺乏執行證據的項目保持未完成，不以單一版本通過宣稱全部通過

### Requirement: 可控的正式依賴

正式依賴 nodexml SHALL 以精確版本 1.0.2 宣告，不使用 `*`，以維持已核對的 XML 解析契約。正式執行必要依賴 SHALL 位於 dependencies，OpenSpec 與測試專用工具 SHALL 位於 devDependencies。PKI SHALL 使用內建 crypto/fetch，不新增正式加密依賴。使用端依賴正確性 SHALL 透過實際安裝驗證，不以本專案 lockfile 作為外部安裝依賴的保證。

#### Scenario: 使用者只安裝正式依賴

- **WHEN** 乾淨使用專案只安裝打包產物的正式依賴
- **THEN** nodexml 實際版本為 1.0.2，載入與兩模式功能不需要 OpenSpec、TypeScript 編譯器或參考專案套件

### Requirement: 發布產物完整且不含本機秘密

npm 打包清單 SHALL 包含 app.js、所有必要 runtime 模組、package.json、README、CHANGELOG 及既有 MIT 授權資訊。產物 SHALL NOT 包含憑證、私鑰、本機設定或非必要測試檔。發布驗收 SHALL 檢查 npm pack --dry-run 與實際 .tgz，保留既有作者、repository 與授權資訊，不杜撰權利人。

#### Scenario: 加入 PKI 模組後打包

- **WHEN** 建立候選發布 tarball
- **THEN** 該產物包含入口引用的所有模組，且檔案清單符合公開套件範圍

### Requirement: 獨立使用端安裝驗收

發布驗收 MUST 將實際 .tgz 安裝至 repository 外的乾淨專案，清除 NODE_PATH 與開發路徑連結，以套件名稱載入並驗證兩參數 legacy、PKI 登入/Session、一般非 SQL 服務、任意 contract 路由、錯誤與回應契約。驗收 SHALL NOT 借用參考專案 node_modules 或只直接 require 本專案 app.js 作為發布證據。

#### Scenario: Repository 測試通過但漏包 runtime 檔案

- **WHEN** 原始碼測試通過，而 tarball 缺少被入口引用的模組
- **THEN** 獨立安裝驗收失敗，發布驗收不得標示完成

#### Scenario: 產物驗收成功

- **WHEN** 乾淨專案完成上述測試
- **THEN** 記錄受測 tarball、實際安裝的依賴、Node/npm 版本及結果，並與本機原始碼測試證據分開

### Requirement: 通用文件與發布回退交接

文件 SHALL 提供通用安裝、CommonJS 使用、兩種 transport、路徑格式、一般服務與 SQL 範例、支援環境、錯誤、send options 僅作用於服務請求、內部請求無新增 timeout、ready() 失敗 pending、升級及回退說明，特定使用端案例僅作補充。發布交接 SHALL 說明 registry、版本唯一性、發布權限、存取設定、候選版搭配 next、正式版搭配 latest，以及發布後檢查。同名同版本 SHALL NOT 被視為可覆寫；修正 SHALL 採新版本。交接 SHALL 提供固定舊版、重建 lock/連線及由使用者調整 dist-tag 或 deprecated 的處理步驟，不預設 unpublish。此 change SHALL 僅交付發布指令與步驟，不執行 publish、registry metadata 寫入或正式環境變更。

#### Scenario: 候選版與正式版

- **WHEN** 維護者依交接步驟準備候選或正式發布
- **THEN** 每個版本的 metadata、變更紀錄與實際產物均先經核對，並清楚選擇 next 或 latest，且發布後有版本、標籤與安裝驗證步驟

#### Scenario: 發布後發現問題

- **WHEN** 已發布版本出現缺陷
- **THEN** 指引提供使用端明確回退與新版本修正方式，不覆寫原版本，也不觸發套件自動降級或正式環境操作

### Requirement: 協定相容性聲明反映證據範圍

文件及驗收報告 SHALL 區分客戶端不設版本門檻、原作者的支援說明、mock 測試及真實 DSA 測試。低於 4.8.3.19 的 PKI 支援 SHALL 註明尚無獨立實測，不得以模擬版本或單台較新伺服器的結果宣稱所有舊版相容。真實實測目標 SHALL 先由環境擁有人確認為非正式環境與適當測試範圍，名稱含 dev 或先前曾測試 SHALL NOT 單獨視為確認。

#### Scenario: 較新測試伺服器通過

- **WHEN** 非正式環境 4.8.7.x 通過字串 token 的 PKI 驗收
- **THEN** 報告只記錄該版本與受測功能，仍標示低於 4.8.3.19 未實測

### Requirement: 真實服務驗證文字與空白保留

3.0.0 真實驗收 SHALL 同時涵蓋 PKI 字串 token/Session 查詢，以及 legacy 至少一個非 SQL、無寫入副作用服務的多行物件文字呼叫。legacy 與 PKI SHALL 各透過可觀測輸入的唯讀或 echo 測試服務，驗證單一空格、兩個空格、LF、tab、CR/LF/空格混合與空字串的實際接收字元及長度。純空白數值字元參照 SHALL 僅視為保護措施，不作為伺服器已正確保留的證據。缺乏適當服務、可觀測性或任何必要證據時，相關驗收 SHALL 保持未完成，SHALL NOT 以標準 parser、成功 status 或僅 PKI SQL 成功替代。

#### Scenario: 本機還原成功但真實服務移除空白

- **WHEN** 標準 parser 可還原原始空白，但真實服務收到的值變短、變成空字串或無法觀測
- **THEN** 空白保留驗收不通過，保持項目未完成並重新審閱設計，不自動回復 CDATA、改值或切換 transport

#### Scenario: 非 SQL legacy 與兩模式空白驗收成功

- **WHEN** 經確認的非正式環境完成 legacy 非 SQL 多行文字及兩模式純空白測試
- **THEN** 記錄受測服務、DSA 版本、transport、輸入與應用層實際接收字元/長度，且不外推其他未測服務或版本

### Requirement: 明確且不依賴 shell 的測試入口

npm test SHALL 使用 scripts 中名稱不符合 Node 預設探索規則的 runner，明確枚舉 test/ 直屬的一般 *.test.js 檔案並排序，以無 shell 的 Node 子程序執行。runner SHALL 在測試檔之前傳遞 npm test 後的參數，SHALL NOT 收集 helper 或打包腳本。產物驗收 SHALL 共用相同入口。空集合、spawn error 或 status=null SHALL 非零結束，正常子程序退出碼 SHALL 原樣回傳。未執行 Windows 實機驗證 SHALL 在 verification.md 明列，不宣稱已驗收。

#### Scenario: 確定測試範圍與篩選

- **WHEN** repository 含 helper、scripts/test-package.js 及亂序命名的 *.test.js，使用者帶入 --test-name-pattern
- **THEN** runner 只傳入排序後的直屬測試檔與原參數，不執行 helper 或打包腳本

#### Scenario: 沒有測試或子程序失敗

- **WHEN** 找不到測試檔，或子程序啟動錯誤、被訊號中止或非零退出
- **THEN** runner 回報非零退出碼，正常數值退出碼保持不變，不將未執行完成視為通過

### Requirement: 維護工具透過 Node 執行 npm CLI

產物驗收 SHALL 以 process.execPath、絕對 npm-cli.js 路徑及參數陣列啟動 npm，SHALL NOT 直接執行 npm.cmd 或透過 shell。CLI 路徑 SHALL 優先使用有效 npm_execpath；直接 node 執行未提供時僅採存在的標準 Node 相對安裝路徑，找不到或提供無效路徑 SHALL 明確失敗，不靜默改用 PATH。Windows 原有 .cmd 限制 SHALL 記錄為官方行為確認的缺陷，修正後仍明示未完成 Windows 實機驗收。

#### Scenario: npm 執行與直接 node 執行

- **WHEN** npm_execpath 指向有效 npm-cli.js，或不存在此變數但標準位置存在 CLI
- **THEN** SHALL 透過 Node 無 shell 執行，含空白/符號的路徑和參數原樣傳遞

#### Scenario: 找不到 npm JS 入口

- **WHEN** npm_execpath 無效或所有標準候選都不存在
- **THEN** SHALL 以明確錯誤終止，說明需有效 npm JS 入口，不嘗試 npm.cmd
