# 1.9.83 保存保护安装版交付

日期：2026-11-16。范围为T01～T08已完成流程的证据核对，以及新增保存保护的实际安装交付；不重做已过Android、升级或模型生成。

## 用户可用的改进

连续编辑不再无限推迟自动保存：保留800ms空闲保存，同时从首次修改起最多5000ms触发保存。请求在途时排队补交最新内容，不并发覆盖。5000ms是触发期限，不是磁盘完成保证。

网页刷新或关闭时，图、元数据未保存或写入在途会产生浏览器离页确认。失败后保留内容并可重试；原生恢复点、时间线恢复前备份、具体撤销确认/取消及Ctrl+Y重做继续可用。强杀、断电及原始自然节点丢失不在本批根因结论内。

## 唯一候选与实际命令

实施前保存21文件可恢复检查点，核最高实际PE1.9.82后同步五版本文件至1.9.83。

证据根：`F:\testavn\Editor-Save-Guard-Release-1983-20261116-01`。

| 项目 | 结果 |
| --- | --- |
| `node scripts/editor-save-guard-release-1983.cjs --checkpoint` | PASS，检查点及原包哈希留存 |
| `node scripts/editor-save-guard-release-1983.cjs --build` | 四阶段PASS，实际子命令见下方 |
| `npm --prefix editor run typecheck` | exit 0 |
| `npm --prefix editor run build` | exit 0 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-dev-launcher.ps1 -SkipGameCliPlayer` | exit 0，工作区Dev实际覆盖 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-installers.ps1 -Target editor -Version 1.9.83 -ReleaseRoot releases/editor-save-guard-1983 -ExpectedRoot C:\Users\1\.codex\worktrees\editor-motion-diagnosis\AgentVN -SkipClean` | exit 0，仅Editor NSIS |
| `node scripts/editor-save-guard-release-1983.cjs --seal` | 原载荷检查PASS，后续QA脚本误要求进入bundle而FAILED；原件保留 |
| `node scripts/editor-save-guard-seal-followup-1983.cjs` | 只补封装元数据，PASS，0重建/重复提取 |

`build-stages.json`保存完整cwd、参数、PID、退出码、时刻与日志SHA。Runtime0.32及原生Player字节未变，因此未重建Player、GameCLI或Android；没有独立Player安装器、MSI或模型请求。

安装包：
`F:\testavn\Editor-Save-Guard-Release-1983-20261116-01\release\installers\editor\AgentVN_Editor_v1.9.83_20261116_172619.exe`

| 产物 | SHA-256 |
| --- | --- |
| NSIS EXE，85,039,437字节 | `a9e80a12357bad33cfd92ba6167e19c1ba6acf1b341a17c8a63431e97254385d` |
| 实际安装Editor EXE | `da1cf876d4d57cb4a53dbe545026f446d3580df4929d06d4b32812afe18c4d23` |
| 工作区Dev | `481bb29fa35a7d32f42cca43fe76fcf7ef7ca0a68689cffe71d13cd9b4a77275` |
| 沿用原生Player | `9a2eac11b0eb2c8f4cfc717441add478e55d77d100ef92248203d11dba9bfadc` |

## 实际安装与九阶段验收

01目录：`F:\testavn\Windows-Isolated-1983-20261116-01`。真实标准QA账户执行NSIS安装并核对版本/载荷成功。之后QA路由误将启动时纯图POST当作含元数据请求，runner中止，原report仍为RUNNING，job错误及自动退休FAILED保留。它不是功能验收PASS，也没有被覆盖为成功。

02目录：`F:\testavn\Windows-Isolated-1983-20261116-02`。修正QA路由后复用01实际安装，0重装/重建；使用另一新QA账户的默认数据库及默认WebView目录，无数据目录覆盖。

| 阶段 | 实际断言 |
| --- | --- |
| 1 | 实际安装EXE、后台、Runtime资源SHA符合唯一候选 |
| 2 | 公开接口准备隔离2节点/1边夹具，真实aside按钮归属 |
| 3 | 持续实际输入11,954ms，首次编辑后5021/10109/12656ms发起保存；实际数据库及原生元数据恢复点正确 |
| 4 | 明确注入HTTP503后真实刷新出现beforeunload确认；取消刷新保留内容 |
| 5 | 实际重试保存成功，原生备份正确；干净刷新无错误离页提示，重新打开 |
| 6 | 实际编辑事件，Ctrl+Z具体确认/取消/撤销与Ctrl+Y重做；从选项时间线恢复[400,200,300]，恢复前备份保留[500,200,300] |
| 7 | 第一次正常WM_CLOSE，产品及后台退出，0强杀 |
| 8 | 同02默认QA profile重启，标题、节点、事件与连线逐值读回 |
| 9 | 第二次正常WM_CLOSE，0强杀 |

结果为`resource-01/report.json`九阶段PASS、cleanupStatus PASS；四份真实原生工程备份及sidecar、四张截图、默认QA SQLite和期望图保留。正常关闭由WM_CLOSE发起，不称物理鼠标点击。HTTP503是受控注入，不称真实磁盘拒写；夹具准备经公开接口，不称原生文件选择器全链。

实际安装显示范围仅1920×1080、DPR1、普通动效，不能借源码矩阵声称安装版全矩阵。02内部保存与重启为同profile；01→02不是同profile连续升级。

## 完整范围核对与清理

`node scripts/editor-save-guard-audit-1983.cjs`五组PASS：源码21直接/8浏览器/22持久化/原工程布局18组、唯一候选、九安装阶段、两账户退休及保留库内容、T01～T08十二原始回执和1.9.82整理终态逐SHA。

指定Downloads原工程939,954,877字节，只读SHA保持`35a33a8b074d8aff682d14c634205450c069a307c34f25ac4d4c4ca5016656f3`。18布局组是12桌面和6受控横屏比例，不是完整素材剧情或物理手机验收。

01中止账户经`editor-save-guard-retire-aborted-1983.ps1`完成精确退休；02由既有控制器自动退休，没有并发再次发起。SID1139/1140及其profile均实际删除，必要默认库保留F。01原自动退休失败不改。

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/editor-save-guard-cleanup-1983.ps1`实际完成七精确临时树清理：29,965文件、769,563,641逻辑字节。两轮各271份冻结QA源及清单留F；正式安装器、恢复检查点、数据库、四备份/截图与原失败保持。删除的是测试安装树、harness、临时缓存及解包副本；需要时从保留安装器重建，不称临时缓存可恢复。不改历史拒绝范围，不称精确物理释放量。

首次终态审查因QA读取controller不存在profile字段FAILED，原`terminal-audit.json`保留。仅改为从实际退休回执读取并核SID，`node scripts/editor-save-guard-terminal-1983.cjs --followup`五组PASS，输出`terminal-audit-02.json`。未重复任何产品测试、安装或退休。记录的PID/创建代次及所属端口均退出。

D日常Dev、冻结1.9.82、用户数据库/已完成小说及真实HEAD/index保持。T01～T08对应的Windows/Android既有证据只作继承核对，不称本轮重新设备验证。

## 尚保留的限制

原自然节点丢失未复现；物理手机反馈来源、历史日志因果/恢复及旧1.7.1后台退出失败，本轮按用户要求忽略，不标PASS。纯动效精修延期。新的保护已实际交付，不等于所有历史失败均解决。

源码发布及远端核对由本根独立`source-delivery.json`记录；网络受阻时如实保留，不能据此降低安装或清理结论，也不能未经回执声称GitHub同步成功。
