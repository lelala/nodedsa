## 1. 實作前確認

- [x] 1.1 完整審閱 proposal、design、delta spec與tasks，確認Node26開發、Node18使用端相容、既有PKI需求不變，且已取得實作授權。
- [x] 1.2 確認五個指定Node版本的取得方式與實際npm版本，核對官方安全版本；無法取得時記錄阻礙，不自行替換驗收目標。

## 2. 專案開發設定與相容性

- [x] 2.1 新增 `.nvmrc` 固定26.12.1，選用專案Node26環境；不修改全域nvm預設或使用端服務。
- [x] 2.2 檢查runtime語法、內建API及正式依賴仍兼容Node18，保留engines.node >=18、CommonJS、公開API、套件版本；檢查新版npm未造成非必要lockfile或發布清單變更。
- [x] 2.3 在26確認測試runner、npm runner與OpenSpec可運作；若實測失敗，先診斷並同步artifacts後作最小相容修正及必要回歸測試，不降低PKI驗證。

## 3. 原始碼與發布產物驗收

- [x] 3.1 在18.20.7、20.20.0、22.23.4、24.22.1及26.12.1執行完整npm test，記錄精確Node/npm、OS、架構、通過／失敗數與log。
- [x] 3.2 執行pack dry-run及實際tarball驗收；五版使用相同SHA-256產物，在repo外乾淨consumer僅裝正式依賴、清除NODE_PATH／開發連結，涵蓋require無網路副作用及既有legacy／PKI完整harness，不以原始碼測試代替。
- [x] 3.3 確認Node18安裝不要求26、無新增正式依賴或開發工具需求；任何未跑／失敗／hash不一致項目保留未完成，不調高engines迴避。

## 4. 文件與交付

- [x] 4.1 更新README與CHANGELOG：開發版本安裝／切換指引、使用端最低版本不變、Node18／20 EOL與相容性／安全維護區別；不宣稱26為LTS或替使用端升級。
- [x] 4.2 在本change新增verification.md，記錄矩陣、同一產物hash與log、平台限制；保留既有PKI真實DSA8.2及Windows未驗收邊界，不覆寫歷史證據。
- [x] 4.3 在Node26執行npm run spec:validate（openspec validate --all --strict），檢查diff與metadata，反向核對四份artifacts及完成證據；文件修改影響產物時以最終產物重做必要驗收，不自動commit、push、publish、sync或archive。
