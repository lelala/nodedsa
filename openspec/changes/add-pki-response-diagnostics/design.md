## Context

`exchange()` 在解密後用內層 XML 更新 `result.data`，服務錯誤也會在公開 API 重新組裝。診斷需跨過這兩個轉換，同時保留既有 DSA 錯誤優先順序。

## Goals / Non-Goals

- 診斷涵蓋已完整讀取本文的 PKI 交換及共用 HTTP 錯誤。
- 傳輸、登入重試與成功結果的契約沿用現況。

## Decisions

- 以 Fetch 讀得的原始回應文字計算 UTF-8 位元組數與前 4096 個 Unicode 字元。HTTP 診斷使用解密前的本文，避免將解密後的內容放進錯誤，也能直接辨識中間設備的回應。
- 使用同一處擷取診斷欄位。Content-Type 只讀取指定標頭，缺少時保留值為 `undefined` 的欄位。請求物件、本文與標頭均不參與診斷。
- 解密後的 XML 驗證例外仍在解析處建立 `xml_error`，交換層仍以原有 `pki_error` 回報。非 2xx 帶有效非零 DSA 錯誤信封時，服務在 `dsaError`、登入在 `loginError` 上附加診斷。服務傳輸錯誤透過 `networkError` 傳遞，登入傳輸錯誤沿用 `loginError.XMLHttpRequest`。
- 連線或讀取回應串流失敗時沿用 `post()` 既有的 retryable 錯誤，因為此時沒有完整本文可計算長度。

## Risks / Trade-offs

- UTF-8 位元組數依解碼成字串後的回應計算，壓縮與原始編碼可能使線上傳輸的位元組數不同。
- 診斷欄位只保留指定標頭及有長度上限的回應本文前綴。

## Migration Plan

作為 3.1.0 的附加欄位，既有呼叫端可繼續使用原本的錯誤欄位。
