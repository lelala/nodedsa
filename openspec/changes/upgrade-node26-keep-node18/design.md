## Context

目前套件為 CommonJS、engines.node >=18；本機預設 Node 18.20.7，既有 PKI change 已驗 Node 18.20.7／20.20.0／22.12.0／24.17.0，各 154 項原始碼與安裝產物測試。尚未驗證 Node 26；既有紀錄不應改寫為新版本通過。

Node 26.12.1 為 2026-10-21 安全更新，當日仍標示 Current，而非 LTS。Node 18／20 已 EOL，保留相容不代表安全維護。

來源：
- https://nodejs.org/en/blog/release/v26.12.1
- https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- https://nodejs.org/en/about/previous-releases

## Goals / Non-Goals

**Goals:** Node 26 開發基準與 Node 18 使用端相容；保留 Node 20／22／24 回歸；證據可追溯到同一套件產物。

**Non-Goals:** 不變更公開 API、協定、重試或控制字元政策；不更新正式服務或使用者全域設定；不在本次提高 engines、改版號、sync 或 archive 既有 PKI change。

## Decisions

### 1. 專案開發版本獨立於套件最低版本

新增 `.nvmrc` 固定 26.12.1，README 說明安裝及 nvm use；不執行 nvm alias default。package.json 保留 >=18，runtime 不使用 Node 26 專屬功能。相較提高 engines 到26，此方式符合使用端仍用18的要求；不設定 npm engine-strict 或安裝時切換使用端 Node。

### 2. 工具與正式依賴分離

OpenSpec 等開發工具無須在 Node18 執行；其驗證使用26，Node18執行 runtime 測試與外部乾淨 consumer 驗收。沿用既有測試 runner／npm runner，先確認可在26運作；如需修正必須兼容18。不以新版 npm 安裝後的無關 lockfile churn 作為升級成果，檢查 metadata、正式依賴與發布清單沒有意外變動。

### 3. 完整跨版本與同一產物驗收

測試矩陣固定 18.20.7、20.20.0、22.23.4、24.22.1、26.12.1，記錄實際npm／OS／架構。18／20作歷史相容性測試，不宣稱有本次安全修補。每版執行 npm test，沿用既有 tarball harness，核對各版產物 SHA-256 相同；若工具每次重新打包，需以 hash 證明位元組相同，不以各自成功替代。同一 SHA 的產物在 repository 外僅裝正式依賴、不帶 NODE_PATH／開發連結，驗 require、legacy／PKI wire、callback／Promise、錯誤、XML及生命週期。任何版本失敗就保留未完成，不能改 engines 躲避問題。

不以 mock 通過宣稱真實 TLS／DSA 安全與相容性全面驗證。既有 PKI change 的8.2、Windows實機驗收仍獨立待辦，不新增正式環境操作。

## Risks / Trade-offs

- Node18／20 EOL → README明示只保留套件相容，使用端安全更新責任仍在環境擁有人。
- Node26 crypto/OpenSSL/fetch改動 → 執行完整既有PKI及legacy測試，失敗先診斷，不降低加密驗證或改全域TLS設定。
- Node26/npm工具、指定版本或網路不可用 → 記錄阻礙，保留驗收未完成，不以其他patch替代並宣稱指定版本通過；需改目標時同步artifacts。
- macOS驗收不能涵蓋Windows → 精確記錄平台，不宣稱跨平台實機全通過。

## Migration Plan

實作獲授權後，先確認本機可用版本，安裝／選用專案Node26，新增版本檔與文件；再完整測試、打包及驗證OpenSpec，於本change新增verification.md。歷史測試紀錄保留。若開發環境有問題，可切回先前Node版本，使用端不受影響；不發布或修改服務。此change依賴目前已提交的3.0.0實作，不取代其發布門檻。

## Open Questions

無待決的產品取捨。版本安裝可用性及26的實際測試結果，留至實作查證。
