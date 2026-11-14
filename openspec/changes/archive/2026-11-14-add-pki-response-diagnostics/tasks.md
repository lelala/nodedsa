## 1. 實作回應診斷

- [x] 1.1 從原始回應統一擷取四個欄位，套用在 PKI 交換、信封解析與共用 HTTP 錯誤。
- [x] 1.2 將四欄帶到公開 API 的服務和登入錯誤，保留相容性與重試語意。

## 2. 驗證與版本

- [x] 2.1 以 mock 測試攔截頁、5xx DSA 信封、非法 XML、解密失敗、HTTP 錯誤及無回應，檢查欄位、樣本上限及相容性。
- [x] 2.2 說明 README 的欄位契約，更新 CHANGELOG、package.json 與 lockfile 至 3.1.0。
- [x] 2.3 執行 npm test 與 openspec validate --all --strict。

## 3. 防止取樣回顯請求資料

- [x] 3.1 比對已知請求值，清空含回顯的樣本並保留其他欄位。
- [x] 3.2 加入回顯與截斷邊界測試，更新 README 與 CHANGELOG。
- [x] 3.3 在 Node.js 18 與開發基準跑完整測試，執行 OpenSpec 嚴格驗證。
