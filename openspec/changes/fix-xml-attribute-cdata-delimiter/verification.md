# 調查紀錄：待討論，暫不實作

日期：2026-10-29（Asia/Taipei）。

## 使用者決定與範圍

保留此 OpenSpec change 作為本機 issue 紀錄，之後深入討論；現階段不調整程式碼。未修改 runtime、測試或 CHANGELOG，未更換依賴版本，未 commit、push、publish、archive，亦未建立外部 issue。審查期間曾依現有 lockfile 執行 `npm ci --ignore-scripts --no-audit --no-fund` 補齊本機缺少的開發依賴；package.json 與 lockfile 無變更。

## 已確認的兩層問題

目前回應流程為：PKI 解密 → 自訂 XML 驗證 → nodexml 解析。不是先解析再驗證。

### 1. 新增驗證器誤拒合法屬性

`lib/xml.js` 第 143 行把屬性內容交給 `text()`，觸發第 102 行禁止 `]]>` 的規則。這條規則適用於一般元素文字，卻不適用於屬性值。

測試輸入：

```xml
<Envelope><Header><Status><Code>0</Code></Status></Header><Body><Value label="]]>">ok</Value></Body></Envelope>
```

- 獨立標準 parser（saxes）接受。
- 本機 mock 加密回應進入 PKI 呼叫後，Promise 拒絕，`networkError.type` 為 `pki_error`，訊息為 `Invalid PKI response`。
- 這是本次已審查的 PKI commit 所新增的驗證器問題。

### 2. 既有 nodexml 解析限制

直接呼叫 `nodexml.xml2obj()`，不經本專案驗證器：

```xml
<Value label="]]>">ok</Value>
```

得到錯誤物件：

```json
{ "Value": "\">ok" }
```

等價的 entity 寫法：

```xml
<Value label="]]&gt;">ok</Value>
```

得到正確物件：

```json
{ "Value": { "@text": "ok", "@": ["label"], "label": "]]>" } }
```

舊基準提交 `199b734` 的 lockfile 同樣使用 nodexml 1.0.2，回應也透過 `nodexml.xml2obj()` 解析；這層限制來自既有依賴，不是新呼叫方式造成。只放行驗證會使案例從明確錯誤變成錯誤資料，不能宣稱三行修正即可完成。

## 原候選方案及尚待討論事項

候選是增加內部 `isAttribute` 布林參數，在原 if 加上條件，共三行 runtime 修改；尚未套用。不能只比較堆疊頂端的字串 `attribute`，因為元素本身可以使用這個名稱。

後續需先討論解析相容性是否納入、如何維持修改簡單，以及回歸案例，再決定方案。現有 delta spec 是目標行為，並非已完成的能力。

## 測試與證據範圍

- Windows、Node 26.12.1／npm 11.20.0：既有原始碼測試 154 通過、0 失敗。
- 同一環境實際打包、獨立安裝後，既有測試 154 通過、0 失敗。
- 最初測試因本機缺少 saxes 無法完成，補齊依賴後上述基準均通過；該缺件不列為程式缺陷。
- 本 issue 使用單次 Node 指令與既有 mock fixture 手動重現，未新增持久化自動回歸測試。原有 154 項通過不代表本 issue 已解決。
- 原提交 diff 空白檢查通過。記錄完成後，OpenSpec `validate --all --strict --no-interactive` 共 5 項通過、0 失敗，包含本 change；目前 tracked diff 為空。規格檢查僅驗證文件格式，不代表修正完成。
- 未連真實 DSA；原 PKI change 的真實 token、多行文字與純空白驗收仍未完成，本次不代為完成。

## 延伸討論：CDATA 不納入本次工作

一般單段 CDATA 的多行文字可正常解析。另以手動案例確認同一元素相鄰兩段 CDATA 時 nodexml 只保留第一段；這是既有依賴的特定限制，不能外推為所有 CDATA 有問題，亦無證據表示使用者原有實際流程曾遇到。依使用者要求停止延伸調查，不修正此問題。

## 規範依據

- [XML attribute value grammar](https://www.w3.org/TR/REC-xml/#NT-AttValue)：屬性可包含原樣 `>` 與 `]]>`。
- [XML character data](https://www.w3.org/TR/REC-xml/#syntax)：一般元素文字不能原樣包含 `]]>`，可使用 `]]&gt;`。
