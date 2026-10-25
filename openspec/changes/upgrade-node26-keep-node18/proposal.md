## Why

開發與驗收環境需要採用已修補的 Node.js 26，同時讓使用 Node.js 18 的既有使用端繼續安裝並執行 nodedsa。開發工具的版本與發布套件的最低執行版本必須分開管理，避免升級工具時意外提高使用門檻。

## What Changes

- 以 Node.js 26.12.1 作為明確的開發基準，新增專案 `.nvmrc`，不修改使用者的全域 Node 預設。
- 保持 `engines.node >=18`、CommonJS 入口、正式依賴與公開 API；不得引入僅 Node 26 可用的 runtime API／語法。
- 執行 Node 18、20、22、24、26 的原始碼及同一 tarball 乾淨安裝驗收，記錄精確版本；22／24／26 至少採用本次安全更新版本。
- 更新開發指引與驗證紀錄，明確區分 Node 18／20 的相容性證據與官方安全維護狀態。

## Goals

- 用 Node 26 開發與執行工具，使用端仍能用 Node 18；以實際產物測試證明兩者相容。

## Non-goals

- 不提高最低 Node 要求、不變更 PKI／legacy 協定、控制字元策略或其他業務行為。
- 不升級使用端服務、部署、發布套件，亦不修改全域 shell／nvm 預設。
- 不宣稱 Node 18／20 因套件測試通過就取得官方安全修補；不取代既有 change 的真實 DSA 待驗收項目。

## Capabilities

### New Capabilities

- `node-runtime-compatibility`: 區分 Node 26 開發基準與 Node 18 使用端相容契約，定義原始碼及安裝產物的版本驗收。

### Modified Capabilities

無。既有 PKI change 的需求不變。

## Impact

預期新增 `.nvmrc`，更新 README、CHANGELOG 與本 change 的驗證紀錄；只有發現實際版本不相容時才作必要且經規格對齊的修正。package.json 的最低版本、套件版本與 lockfile 不因更換 Node 自動更新。主要風險是新版 npm 改寫 lockfile、測試工具不支援 Node 18，以及不同 Node/OpenSSL/fetch 行為影響 PKI；須以正式依賴隔離和跨版本測試控制。
