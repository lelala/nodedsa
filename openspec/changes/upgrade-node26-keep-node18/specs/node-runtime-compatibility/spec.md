## ADDED Requirements

### Requirement: 開發版本與使用端最低版本分離

專案 SHALL 提供固定 Node.js 26.12.1 的開發版本設定，並保持發布套件 engines.node 為 >=18 與 CommonJS 入口；開發版本切換 MUST NOT 修改使用端或使用者全域 Node 設定。

#### Scenario: 選用開發版本
- **WHEN** 開發者依 README 使用專案版本檔切換 Node
- **THEN** node --version 為 v26.12.1，且未要求引用專案一併升級至26

#### Scenario: Node18 使用安裝產物
- **WHEN** Node18.20.7 的乾淨 consumer 安裝受測 tarball，僅有正式依賴且無 NODE_PATH 或開發連結
- **THEN** require('nodedsa') 成功且不發網路請求，legacy／PKI 的 callback 與 Promise 契約通過既有驗收，不依賴Node26專屬API

### Requirement: 跨版本證據與失敗門檻

專案 SHALL 在18.20.7、20.20.0、22.23.4、24.22.1與26.12.1執行原始碼測試及相同SHA-256之tarball安裝驗收，記錄精確Node/npm、平台與結果；任一必要測試失敗或未執行 MUST 保持該項未完成，不得以調高engines或只測26代替。

#### Scenario: 全部指定版本通過
- **WHEN** 五個版本均完成原始碼與產物驗收
- **THEN** 驗證紀錄列出各版本通過數、失敗數、測試log與相同產物hash，legacy及PKI均涵蓋

#### Scenario: 某版本不可用或測試失敗
- **WHEN** 指定版本無法安裝、測試失敗或產物hash不一致
- **THEN** 驗證紀錄明列阻礙及未完成項目，不能宣稱本次相容性驗收全部完成

### Requirement: 相容性與安全維護分開說明

README及驗證紀錄 SHALL 區分開發版本、最低執行版本、實際受測patch及官方安全維護狀態，MUST NOT 將Node18／20相容性測試說成安全修補，亦不得把本機mock結果當作真實DSA或Windows實機驗收。

#### Scenario: 使用者查閱版本指引
- **WHEN** 使用者閱讀升級與相容性說明
- **THEN** 能辨識Node26開發設定不強迫使用端升級，並看到Node18／20已EOL及既有真實DSA／Windows驗收的獨立狀態
