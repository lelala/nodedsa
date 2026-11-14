## ADDED Requirements

### Requirement: 回應錯誤附有 HTTP 診斷

PKI 交換在讀完 HTTP 本文後拋出的錯誤、解析 PKI 信封時的 `xml_error` 與共用 `http_error` SHALL 附有四欄。數值 `httpStatus` 取自 HTTP 狀態，`contentType` 取自 Content-Type 標頭且缺少時為 `undefined`，數值 `bodyLength` 是完整 HTTP 回應文字的 UTF-8 位元組數，字串 `responseSample` 預設是原始 HTTP 回應文字的前 4096 個 Unicode 碼點。若已知的請求憑證、SecretKey、CryptoToken、X-Api-Key 或請求本文以原文或 XML 跳脫形式回顯，且與樣本範圍重疊，`responseSample` MUST 為空字串並保留其餘三欄。請求資料 MUST NOT 附加至錯誤物件。既有分類、訊息、成功結果與重試行為 SHALL 維持。

#### Scenario: 回應回顯請求資料

- **WHEN** 回應本文在前 4096 個 Unicode 碼點內開始回顯已知的請求憑證、加密請求欄位或請求本文
- **THEN** 即使回顯跨過樣本界線，`responseSample` SHALL 為空字串，HTTP 狀態、Content-Type 與完整長度 SHALL 照常回報

#### Scenario: HTTP 200 攔截頁

- **WHEN** PKI 交換收到 HTTP 200 的 text/html 攔截頁
- **THEN** SHALL 以原有 `pki_error` 回報，並在 Promise 及 callback 的服務 `networkError` 上帶有 HTTP 200、標頭、完整長度與本文前綴

#### Scenario: 非法 XML 或 Cipher 無法解密

- **WHEN** PKI 外層 XML 無效、Cipher 解密失敗，或解密後信封解析出現 `xml_error`
- **THEN** 解析處 SHALL 附加回應診斷，交換對外 SHALL 維持 `pki_error` 及原訊息，診斷 SHALL 使用解密前的 HTTP 本文

#### Scenario: 非 2xx 且無有效 DSA 錯誤

- **WHEN** 回應依既有規則判為 `http_error`
- **THEN** SHALL 保留原訊息並附四欄，本文為空時長度為零且樣本為空字串

#### Scenario: HTTP 5xx 的有效 DSA 錯誤

- **WHEN** PKI 交換收到 HTTP 5xx 且信封有效、DSA status 非零
- **THEN** SHALL 維持既有 DSA 分類與訊息，服務的 Promise 及 callback 在 `dsaError` 收到四欄，登入錯誤在 `loginError` 收到四欄

#### Scenario: 連線失敗或本文未讀完

- **WHEN** 請求沒有取得完整回應本文
- **THEN** SHALL 維持既有錯誤及重試語意，不新增診斷欄位
