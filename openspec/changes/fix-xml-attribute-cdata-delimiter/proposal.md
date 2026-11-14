## 狀態：待討論，暫不實作

2026-10-29：依使用者決定，保留此 change 作為本機 issue 紀錄，現階段不調整程式碼。調查確認驗證器誤擋與 nodexml 解析限制為兩個獨立問題；原先的三行方案不足以保證正確物件，尚未採用。詳細結果見 `verification.md`，後續須先討論範圍並更新設計／規格／任務，再開始實作。未建立外部 issue。

## Why

PKI XML 驗證把元素文字禁止原樣出現 `]]>` 的規則也套用到屬性值，導致合法回應被誤報為 `pki_error`。修正這個已本機重現的相容性問題。

## What Changes

- 屬性值允許原樣的 `]]>`，一般元素文字仍拒絕未跳脫的 `]]>`。
- 保留其他 XML 字元、entity、屬性與結構驗證，以及現有 callback／Promise 契約。
- 最小幅度修改內部條件並補回歸測試、變更紀錄。
- 非目標：不處理相鄰 CDATA 的既有 nodexml 行為，不更換 parser、不改協定、重試、公開 API 或依賴。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `dsa-client`: 補充 XML 回應驗證對屬性值與元素文字的區分。

## Impact

影響 `lib/xml.js` 的內部驗證與 PKI 回應接受範圍；合法屬性值由拒絕改為接受。既有合法回應、legacy 解析、送出序列化、錯誤通知與公開介面不變，無新增依賴。以 mock 驗證，不連真實 DSA。
