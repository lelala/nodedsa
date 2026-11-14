## Context

`validateXml()` 共用 `text()` 驗證元素文字和屬性值；禁止 `]]>` 的條件僅適用於一般元素文字。現有 `stack.push('attribute')` 只用來避免套用根元素外的文字檢查，不能可靠辨識情境，因為 XML 元素本身也能命名為 `attribute`。

## Goals / Non-Goals

**Goals:** 用最少修改區分兩種情境，合法屬性值可正常解析，一般文字仍受限制。

**Non-Goals:** 不更換 parser、不修正相鄰 CDATA、不改協定、認證、重試或公開 API。

## Proposed Decisions — 尚未採用

- 為內部 `text()` 加入預設為 false 的 `isAttribute` 參數，僅屬性呼叫傳 true；原 if 增加 `!isAttribute` 條件。共三行 runtime 修改，不增加新函式。
- 保留堆疊、其他字元與 entity 驗證。不可直接以 `stack.at(-1) === 'attribute'` 判斷，避免同名合法元素繞過檢查。
- 使用獨立標準 parser 對照合法／非法輸入，再以 mock 加密回應驗證 Promise、result 和 OnError。涵蓋元素名為 attribute、兩種屬性引號與 entity 表示。

## Risks / Trade-offs

- [放寬範圍過大] → 回歸涵蓋非法元素文字、非法 entity、非法控制字元與重複屬性，維持既有錯誤分類。
- [測試範圍] → 本機 mock 不代表真實 DSA 相容性已完成；不沿用舊 change 尚未完成的實測作本次完成證據。

## Implementation Finding — 待決定

2026-10-29 補回歸前直接核對 nodexml 1.0.2：`<Value label="]]>">ok</Value>` 被解析為 `{ "Value": "\">ok" }`，而 `<Value label="]]&gt;">ok</Value>` 正確保留 label 與文字。這是既有 parser 對屬性中原樣 `>` 的處理限制。

因此上述三行修改只能避免誤拒，無法達成規格的正常物件解析承諾，且可能把明確失敗改成靜默資料錯誤。尚未修改 runtime；需先確認是否擴大本 change，處理合法屬性值進入既有 parser 時的相容性。不能以斷言錯誤解析結果作為回歸通過。

## 使用者決定

2026-10-29：暫不修改程式碼，保留本 change 作為待討論 issue。停止實作，先保留調查結果。上述方案僅是候選，並非已選定或已實作的修正。相鄰 CDATA 的延伸問題不納入本次工作。
