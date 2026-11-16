# 节点保存加固与指定工程布局复核

日期：2026-11-16。用户明确原节点丢失无法复现，要求增加保护；本轮忽略其它历史现场资料追查。未复现不计根因修复，既有失败记录保留。

2026-11-16续接：新增保护已进入唯一1.9.83 Editor-only Dev/NSIS，并完成实际安装九阶段、同默认QA profile重启及精确清理。详见[1.9.83原生交付](Editor-Save-Guard-Release-1983-20261116-RESULTS.md)。下方SOURCE_ONLY与远端核查是本报告原源码阶段快照，保留而不改写；D日常未替换，原自然丢失仍未复现。

## 已实施

`useEditorProjectAutosave.ts` 保留原800ms空闲保存，同时增加从首次修改开始计时的5000ms保存期限。持续输入不会无限重置期限；若已有请求在途，标记待提交并经原共享队列串行保存最新内容。这里限定的是触发时间，不保证网络或磁盘在5秒内完成。

增加网页未保存离页确认：图尚未保存、元数据与已确认保存内容不同、写入在途或仍有待提交内容时，由浏览器提示刷新/关闭确认。数据库保存和时间线恢复点分别记账，仅恢复点失败不会误报工程未保存。切换工程、卸载时清理计时器和监听，保留既有工程/载入代次、失败重试及恢复前备份。

这些措施减少连续编辑和误关页面的风险，不证明原自然丢失事件的根因，也不保证强杀、断电或浏览器绕过离页提示时尚未落盘的内容不丢失。

## 实际执行

证据根：`F:\testavn\Editor-Save-Guard-20261116-01`，修改前文件在`checkpoint`。新增用例先失败后修复，`before`与修正测试清理后的`before-02`均保留。

| 命令/组 | 结果 | 范围 |
| --- | --- | --- |
| `node scripts/editor-autosave-boundaries-test.cjs F:/testavn/Editor-Save-Guard-20261116-01/after` | 21 PASS | 连续编辑、在途串行、工程切换、失败离页、备份及卸载 |
| `node scripts/editor-autosave-boundaries-playwright.cjs F:/testavn/Editor-Save-Guard-20261116-01/browser` | 8 PASS | 真实完整Editor与隔离后端；受控恢复点IPC及注入保存503 |
| `node scripts/editor-project-persistence-test.cjs F:/testavn/Editor-Save-Guard-20261116-01/persistence` | 22 PASS | 队列、归属、素材物化及恢复保护 |
| `node scripts/hidden-growth-layout-source-playwright.cjs F:/testavn/Editor-Save-Guard-20261116-01/project-layout` | 18 PASS | 原件实际布局、受控正文及安全区；12桌面加6横屏比例组合 |
| `npm --prefix editor run typecheck` | exit 0 | 当前源码 |
| `npm --prefix editor run build` | exit 0 | 含Runtime预览和知识索引；chunk大小/动态导入警告保留 |

浏览器连续实际输入11793ms，首次修改后5017ms、10024ms、12461ms发起保存，最终标题落盘。注入保存拒绝后真实`page.reload()`产生`beforeunload`确认；取消刷新保留内容，恢复服务后保存成功，随后实际刷新无离页对话框，重开节点、连线及标题正确。源码浏览器通过不冒称原生安装版关闭验收。

额外尝试`node scripts/editor-project-write-ordering-test.cjs F:/testavn/Editor-Save-Guard-20261116-01/write-ordering`被旧脚本固定证据目录守卫在测试前拒绝，0用例，不计PASS；未放宽守卫或重复该已过组。

## 指定工程

只读检查`C:\Users\1\Downloads\隐忍的成长_20261109_003641.vnproj`，939954877字节，40节点/49边。原件SHA-256前后一致：

`35a33a8b074d8aff682d14c634205450c069a307c34f25ac4d4c4ca5016656f3`

Ren’Py快捷栏旧rect为`top_right`，但未显式启用自定义位置；当前兼容行为按默认贴底，不擅自启用旧rect。使用原布局验证九项单行、实际指针命中、对白可读、画面比例、历史往返及隐藏恢复。未加载940MB全部素材和完整剧情，移动安全区为受控值，不称物理手机或完整工程APK验收。

## 交付与清理

本批源码已推`6fed7a66caaeac5e141119f47178bba371b71b84`，分支`codex/editor-autosave-recovery-20261116`，仅4份产品/QA文件。真实HEAD/index前后保持。首次推送与随后远端ref核对成功，之后HTTP核验网络失败保留于`source-delivery.json`；独立只读补核`remote-audit.cjs`在Git远端查询20秒超时，回执`remote-audit.json`为FAILED，0重推。远端逐文件HTTP字节核验仍BLOCKED，不能称已补齐。

**SOURCE_ONLY。** 本批没有原生Dev构建、版本推进或新NSIS；已交付1.9.82、工作区原生Dev及D日常均不能声称包含新增保护。下一次必要Editor集中交付须包含本补丁并补原生保存/正常关闭/重启验收，不重建冻结1.9.82，不重复Android或旧升级矩阵。

本轮浏览器/服务/端口全部退出，没有新账户、模型调用或用户数据库写入。`cleanup.ps1`核查本轮3个精确目录无链接后实际删除，`cleanup.json`为PASS：669文件、28962719逻辑字节；不称精确物理释放量。仅删除浏览器profile及两个temp，无法恢复这些临时缓存；报告、隔离数据库、检查点、失败现场、用户原件及历史拒绝清理范围保留。
