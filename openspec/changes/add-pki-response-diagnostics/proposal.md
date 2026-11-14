## Why

2026-11-12 的 Imperva 攔截頁以 HTTP 200 和 `text/html` 回傳，現有 PKI 錯誤只顯示 `Invalid PKI response`，呼叫端得另外重放請求才能看到回應。XML 驗證、解密及 HTTP 錯誤也需要相同的診斷欄位。

## What Changes

- 回報已完整讀取的 HTTP 回應狀態、Content-Type、本文長度及前 4096 個字元，沿用既有分類與訊息。
- HTTP 非 2xx 若帶有效的 PKI DSA 錯誤信封，沿用 DSA 錯誤並提供相同欄位。
- 更新 README、CHANGELOG 與套件版本至 3.1.0，加入 mock 回歸測試。

## Goals

- 讓呼叫端直接辨識攔截頁、無效 XML、解密失敗與 HTTP 錯誤。
- 維持 Promise、callback、成功結果與重試行為的相容性。

## Non-goals

- 變更傳輸協定、登入重試策略或發佈套件。

## Capabilities

### New Capabilities

### Modified Capabilities

- `dsa-client` 的錯誤回報新增 HTTP 回應診斷欄位。

## Impact

影響 PKI 回應處理、共用 HTTP 錯誤、公開 API 的錯誤轉送及套件版本。欄位為向後相容新增，來源限於收到的 HTTP 回應。
