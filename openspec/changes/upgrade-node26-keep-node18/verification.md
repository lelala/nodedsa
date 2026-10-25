# Node26 開發與 Node18 使用端相容性驗證

日期：2026-10-23。平台：macOS（Darwin arm64）。基礎提交：f064a84。

## 最終變更

- `.nvmrc` 固定26.12.1；已實際載入nvm並執行nvm use，輸出Node v26.12.1／npm11.20.0。不修改全域alias default；後續shell依專案版本檔選用，不宣稱其他shell已全部切換。
- README新增開發安裝／切換、使用端版本與EOL說明；CHANGELOG記錄環境升級。
- runtime、測試runner、npm runner、package.json及package-lock.json與基礎提交無差異；版本3.0.0、engines >=18、CommonJS app.js、正式nodexml1.0.2不變。沒有引入Node26專屬API或新依賴。
- 四份規劃artifacts已審閱且使用者明確要求開始實作；五個指定Node版本原先皆已安裝，未另改使用者全域環境。

## 矩陣

每版先執行npm test，再以該版Node執行scripts/test-package.js；全部程序退出0。

| Node | npm | 原始碼 通過 / 失敗 | 安裝產物 通過 / 失敗 |
| --- | --- | --- | --- |
| 18.20.7 | 10.8.2 | 154 / 0 | 154 / 0 |
| 20.20.0 | 10.8.2 | 154 / 0 | 154 / 0 |
| 22.23.4 | 10.9.9 | 154 / 0 | 154 / 0 |
| 24.22.1 | 11.19.1 | 154 / 0 | 154 / 0 |
| 26.12.1 | 11.20.0 | 154 / 0 | 154 / 0 |

既有154項涵蓋legacy／PKI、加密wire、callback／Promise、錯誤通知、登入重試、ready／reConnect世代、XML序列化及解析等契約；沒有因版本升級改寫或減少測試。

## 產物與隔離

各版本工具均執行pack dry-run與實際pack，確認六檔白名單一致。雖由各版本npm分別打包，五份產物SHA-256完全相同，證明受測的是位元組相同的產物；不是以五份不同內容各自通過代替。

SHA-256：`7265a9a7e9867208b99d58dfb109e01de2daeeb9deceb952785bdd77b09a98dd`

保留副本：`/private/tmp/nodedsa-node26-compatible18-3.0.0.tgz`。

每次安裝至repository外獨立consumer，僅正式依賴，清除NODE_PATH，沒有開發連結。安裝後require('nodedsa')不發HTTP；公開exports正確，nodexml實際1.0.2，無saxes／OpenSpec可解析；完整harness指向已安裝套件。Node18安裝及所有測試成功，未要求Node26或開發工具。未執行npm ci造成依賴更新，lockfile保持不變。

原始碼log：`/private/tmp/nodedsa-node26-source-<精確版本>.log`。
各版產物JSON：`/private/tmp/nodedsa-node26-package-<精確版本>.json`（含archive、hash與安裝測試log）；同前綴.err皆空。

安裝測試log：
- Node 18.20.7：`/var/folders/s9/hpb12f6x425byx_pcb7ns4p80000gn/T/nodedsa-package-BKnbrG/tests.tap`；同目錄evidence.json。
- Node 20.20.0：`/var/folders/s9/hpb12f6x425byx_pcb7ns4p80000gn/T/nodedsa-package-89iFeu/tests.tap`；同目錄evidence.json。
- Node 22.23.4：`/var/folders/s9/hpb12f6x425byx_pcb7ns4p80000gn/T/nodedsa-package-d7gtL3/tests.tap`；同目錄evidence.json。
- Node 24.22.1：`/var/folders/s9/hpb12f6x425byx_pcb7ns4p80000gn/T/nodedsa-package-Z9W3Kw/tests.tap`；同目錄evidence.json。
- Node 26.12.1：`/var/folders/s9/hpb12f6x425byx_pcb7ns4p80000gn/T/nodedsa-package-maxM0a/tests.tap`；同目錄evidence.json。

## 工具與驗證

Node26.12.1執行OpenSpec status／apply instructions與npm run spec:validate成功；strict驗證四個items通過、0失敗。git diff --check通過。OpenSpec只驗證artifacts，不替代上述程序測試。nvm use、本機開發工具、npm runner及完整測試runner均已在26實際執行，無需程式修正。

## 證據邊界

- Node18／20已EOL，測試通過是套件相容證據，不是官方安全維護或漏洞修補。22.23.4／24.22.1／26.12.1為本次指定的安全更新基準；26.12.1發布時為Current。
- 所有網路行為測試採本機mock／fixture，未連真實DSA、未執行照片同步、寫DB或更新服務。不宣稱真實TLS／DSA驗收完成。
- 舊change add-pki-channel-v3 的真實DSA tasks8.2與Windows實機驗收仍獨立未完成；原有歷史verification未改寫。本次套件文件變更造成tarball hash更新，舊hash的外部實測不可自動視為此hash的實測。
- 未commit、push、publish、sync或archive；未升級任何使用端或生產服務。

## 官方參考

- https://nodejs.org/en/blog/release/v26.12.1
- https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- https://nodejs.org/en/about/previous-releases
