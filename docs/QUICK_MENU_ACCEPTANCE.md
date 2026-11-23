# 单列快捷菜单与 Android 证据

快捷菜单 C 保持七项操作和第八行收起按钮，禁止内部滚动。共享计算入口为
`shared/cartridge/quickMenuMetrics.ts`。基础宽高为 260×440（移动指标为 252×434）；
完整高度包含七行、收起行、七个间距和两侧内边距。边框位于外框之内，CSS 定位须扣除实际缩放后的边框宽度。

缩放为 `min(1, 可用宽度/基础宽度, 可用高度/基础高度)`，可用高度截止于对白上边缘，
扣除系统安全区及 8px 边距。系统菜单按钮默认位于对白框右上角的框外上方，
按钮右边缘对齐对白框右边缘，底边与对白框上边缘间隔 8px（编辑器缩略图同比缩放）。
展开与收起使用同一按钮位置，展开向上；仅在安全区空间不足时约束位置，不回写工程坐标。
字体、图标、圆角、模糊、间距、按钮及点击区域使用同一比例；无最小字体或触摸尺寸回退。
外框圆角以 10px 为视觉上限并随菜单同比缩放，避免工程中的极端圆角把面板变成胶囊；
编辑器另乘一次画布比例，不将实际预览像素回写工程。

Android 构建在 APK 旁输出 `.apk.acceptance.json`。它分别记录源 `.vncart`、打包前布局、
APK 内布局和 APK 内清单的哈希。ZIP 时间只表示归档条目时间，不能用于推断源文件生成时间。
源文件时间标明 filesystem-last-write；记录时刻单独保存。旧 APK 缺少此文件可以运行，但来源为 BLOCKED。

`scripts/start-android-acceptance.ps1 -RequestPath <UTF-8 JSON>` 从非管理员会话提权。
请求显式包含 apk、package、outputDir、sdk、serial、adbPort、cdpPort、runId；
可选 `coldBoot` 由同一个管理员 helper 启动 `AgentVN_API35`（no-snapshot、音频启用），
核对 boot ID 和进程创建身份，并在 `finally` 中只停止本轮拥有的模拟器。其字段为
`avd`、`avdHome`、`adbPort`、`grpcPort`、`discoveryRoot`。不提供时，可选 emulatorDiscovery
仅指向调用方已选定的模拟器发现文件以尝试输出音频捕获。
每轮使用唯一目录和独立端口，已安装同名包时保留现有数据并阻断。
执行器不关闭已有模拟器，不将服务事件当作可听音频；完整音频核验和日志归因完成前保持 BLOCKED。

主要回归入口：quick-menu-metrics-contract（构建后加 --check-bundle）、
quick-menu-compact-geometry-playwright、quick-menu-runtime-editor-parity-playwright、
quick-menu-collapse-playwright、quick-menu-navigation-playwright、quick-menu-size-parity-playwright、
android-gamecli-layout-playwright、android-acceptance-evidence-test、android-acceptance-runner-test。

补充执行器回归：`android-uiautomator-capture-test.cjs` 验证导出非零退出、缺失或旧 XML、
有限重试及原始错误；`android-menu-state-test.cjs` 验证已展开、延迟展开和丢失触摸；
`android-runtime-log-analysis-test.cjs` 验证应用 ANR、崩溃、Rust panic 和独立 WebView 渲染进程归属。
不能通过渲染进程名称是否包含游戏包名来筛选日志，需使用 ActivityManager 的服务所属包关联。

`android-audio-capture-test.py` 验证模拟器输出捕获、提前结束、静音、削波和捕获失败；
`android-audio-source-test.py` 验证音量变化、偏移、无关音频和静音不会混淆源音频判定。
捕获使用带令牌认证的 emulator gRPC `streamAudio`，不使用麦克风。
发现文件必须关联当前模拟器 PID，不得复用已退出模拟器的旧文件。
单独的输出捕获或源波形比对通过均不能代替听辨。
正式执行器通过 `android-audio-evidence.cjs` 自动选择已记录的 BGM 播放请求对应 assetId，
对照本轮 staging APK 与捕获 WAV，并核对两者哈希。比对结果写入 runtime report，
来源通过后仍保持 `LISTENING_REQUIRED`；其回归入口为 `android-audio-evidence-test.cjs`。

运行目录可提供 `cold-boot.json`：管理员状态、AVD、启动参数、设备状态、启动完成时间和 boot ID。
执行器将记录与设备当前 `/proc/sys/kernel/random/boot_id` 比对，且要求 `-no-snapshot`、音频启用。
缺失、时间逆序或 boot ID 不一致均保持 BLOCKED。

2026-09-21 实机证据在 `output/android-menu-20260921/`，原始报告不覆盖。
`runtime-final` 保留 WebView 初始化期间 ANR 的失败证据；
`runtime-cold/previous-anr-dropbox.txt` 保留线程栈，主线程当时处于
WebView `TouchDevice.availablePointerAndHoverTypes` 调用 InputManager 的路径。
后续 `runtime-cold-audio-3` 完成主流程和六次重启，捕获 8 秒非静音连续音频，
与 APK 内音源相关度 0.99665。听辨、完整发布矩阵和长期图层/内存检查尚未完成，不能据此宣布整体发布通过。
