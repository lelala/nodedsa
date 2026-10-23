# Changelog

## 3.0.0 - 待發布

- PKI 逐段解碼後含 / 也以 pki_error 拒絕，補齊編碼分隔符防護（含 ..%2F..%2Fadmin）；適用完整 URL、DSNS-relative 與回傳 doorway，query/fragment 與 legacy 路由維持原契約。
- 登入 catch 安全處理 DSNS/token getter 拋 null、undefined 或不可讀 metadata/message 的物件，正常終止登入與排隊/後續 send，不因 catch 自身失敗留下 unhandledRejection；未標記的非傳輸例外不重試，ready 可於之後有效成功完成。
- 明確說明 OnLoginError 的相容性例外：重連失敗不派送當時既有 handler，但失敗後新註冊 handler 仍立即同步收到目前 loginError。此行為與可修改 Error 原物件沿用決策不變。

- fetch/text 的非 Error 或不可修改拒絕值不再被 retryable 賦值 TypeError 蓋掉；可修改 Error 沿用（含 AbortError），其他值用 cause 保存原值，凍結 Error 保留 name/message/stack/type。服務取消不重送，登入傳輸錯誤仍最多四次。
- PKI 在正規化或 DSNS 查詢前拒絕點路徑段（含編碼）、反斜線、原始路徑內部 tab/CR/LF 與無效百分比/UTF-8 編碼，回報 pki_error；共用原始 doorway/contract 切分。query/fragment 與一般名稱的點不誤判，legacy 路由不變。
- 同步 send 失敗通知為 OnError→result→reject，與非同步 callback 順序一致；同步例外仍停止後續通知並收尾未回傳 Promise。舊版已失敗登入後 send 僅 result 且 Promise pending，其餘既有失敗路徑原本多為 OnError→result。
- 產物驗收改用 Node 執行 npm_execpath 的 npm-cli.js，直接 node 執行時檢查已存在的標準 Node 相對位置，缺入口明確報錯；不啟動 npm.cmd、不經 shell。移除官方確認不適用的 Windows .cmd 呼叫方式，但尚未完成 Windows 實機驗收。

- XML 名稱完整採 XML 1.0 Fifth Edition NameStartChar/NameChar：修正合法全形括號、組合字元、連接符號等被誤拒絕，以及 x² 被誤接受；同時適用物件 Body 元素/屬性與 PKI 解密回應，不改寫名稱。
- **錯誤 type 修正（legacy/PKI 共用）**：非字串 accessPoint、無效位址/DSNS 結果由 pki_error 改為 access_point_error；PKI 缺 contract 仍為 pki_error，空 accessPoint 同步拒絕不變。
- 維持初次登入被 reConnect 取代時的世代隔離：不通知既有 OnLoginError，由重連 Promise 與排隊 send 回報失敗；ready 仍 pending 並可於之後有效成功完成，文件提醒不要重複輪詢建立等待者。
- PKI 重用 hasCipher，明文錯誤只驗一次 XML；加密外層/內層各驗一次。拆出不產生跳脫字串的字元驗證，不放寬非法 XML/密文/明文成功的拒絕規則；未宣稱特定效能提升數據。

- reConnect 終止失敗只 reject 自己的 Promise，不重播既有 OnLoginError，避免錯誤 callback 直接重連形成連鎖；初次登入仍通知，排隊/後續 send 仍失敗。晚註冊 OnLoginError 的同步通知保留。使用端重連清理應放在 reConnect catch。
- 恢復 legacy 回應的 nodexml 容忍度：不做嚴格 XML 字元檢查，2xx 缺 envelope/status 維持舊版 DSA 失敗欄位，登入保留 data/response/textStatus。兩模式有 Status 但無 Message 時恢復 undefined。
- **Breaking（legacy/PKI 共用）**：非 2xx 先保留合法非零 DSA 錯誤；HTML、空內容、缺 status 或 Code 0 改為 http_error。舊版忽略 HTTP 狀態，可能給空欄位 dsaError 或視為成功。PKI 的損壞 Cipher 仍為 pki_error，公鑰非 2xx 不接受 RSA key 為成功。
- **Breaking（legacy/PKI 共用）**：物件 Body 的非法 XML 字元/名稱在送 HTTP 前以 xml_error 拒絕，不改值；舊版會送出，伺服器是否接受未實測。PKI 嚴格驗證外層/解密內容，包含 U+001A、非法字元參照及未知 entity，可能拒絕 legacy 可讀取的資料。
- **Breaking**：open 舊版忽略第三參數，新版對 null/未知欄位拒絕；同步 send 失敗採 OnError→result 通知。真正解析例外改用 xml_error（服務 networkError／登入 loginError）。
- 登入重試只處理 fetch/text 失敗，不因解析或 callback 例外重試；每次初次登入與重連各自有最多初次加三次重試。舊版 catch 較廣，且重試計數不歸零。

- PKI DSNS-relative 缺少有效 contract（如 school/、school///、school/%20）在查詢 DSNS 前回報登入失敗；查詢前後共用尾段解碼/判空，不改 legacy 或完整 URL 既有路由。
- npm test 改用明確枚舉並排序測試檔的 Node runner，轉傳篩選參數、如實回傳失敗，避免 shell glob 與預設探索誤跑 helper/打包腳本；產物驗收共用入口。尚未完成 Windows 實機驗證。

- **Breaking（legacy/PKI 共用）**：非同步登入/服務通知中的 callback 直接拋例外，改在通知流程外重新拋出 uncaughtException，Node 預設以非零狀態結束；外層 API try/catch 不能捕捉，使用者應在 callback 內處理。舊版部分非同步 ready/OnLoginError 例外會被登入流程吞掉並重試，新版不再重試，這是行為變更而非僅文件補充。
- 同步 ready（已登入）、OnLoginError（已有登入錯誤）及 send 立即失敗通知保留同步拋出，可由外層 try/catch 捕捉。同步 send 依 settled → OnError → result → reject 排序，任一 callback 拋出即停止，並收尾未能回傳的內部 Promise，避免額外 unhandledRejection；一般 send rejection 仍由使用端處理。

- ready(fn)/ready() 改為每次註冊只完成一次，完成後移除，不於後續重連重播；登入失敗仍保持 pending，後續 reConnect 的目前世代成功時完成尚未完成的等待者。成功通知先清空快照再執行；已就緒的立即 callback 保留同步例外傳遞。

- 新增可選 PKI transport，在登入前取得公鑰，加密登入及後續完整 envelope；失敗不降級。預設仍為 legacy，contract 沿用 accessPoint 路徑。
- reConnect 沿用已驗證的 URL/contract，避免 DSNS 快取過期且失聯時阻止重連；尚無有效路由才重新解析。
- 每連線快取 server key，reConnect 重取；每請求獨立 UUID/AES key，client RSA 公鑰重用。
- **Breaking（legacy/PKI 共用）**：所有物件 body 字串文字改以 entity 序列化，包含 UDM/非 SQL 服務；純 XML 空白逐字採數值參照，不變更頂層 raw XML fragment、屬性或回應解析器。真實服務的空白保留仍待驗收。
- **Breaking（legacy/PKI 共用）**：open 在登入前拒絕無效 HTTP(S)/DSNS 結果；獨立 dsnsLookup 既有 fallback 缺陷保持不變。
- 修正登入失敗後 send Promise 不結束、網路重試耗盡未通知 OnLoginError、共用迴圈索引，以及 reConnect 的終止失敗/競態。ready() 失敗仍可能 pending，內部初始化/登入不新增 timeout 或繼承 send options。
- 固定正式 nodexml 1.0.2，宣告 Node.js >=18/CommonJS；新增開發用標準 XML 測試 parser、獨立協定測試、實際 tarball 乾淨安裝與 opt-in 非正式驗收工具。
- 低於 4.8.3.19 的 PKI 支援僅依原作者說明，尚無獨立實測；本版本尚未完成真實 DSA 發布驗收。

## 2.1.0 - 2026-08-03

- Add optional Fetch-compatible request options to `connection.send`.
- Support custom outbound headers, including distributed trace headers.
- Preserve DSA-controlled HTTP method and XML body while forwarding other
  supported Fetch options.
- Stop mutating caller-owned request, options, and headers values.
- Add automated regression and request-options tests.
