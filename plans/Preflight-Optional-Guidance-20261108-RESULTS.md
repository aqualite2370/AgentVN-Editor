# 发布预检可选项建议修正

## 范围与结果

实际安装版最终工程检查中，背景、立绘、头像、音乐、语音、音效和演出可选项共用了“补充对应音频”的建议。源码已按资源类型分别给出设置位置和可选语义；检测规则、问题代码、严重程度与定位subject保持。

这是工作区源码补丁，尚未进入冻结1.9.54安装包、D盘Dev或公开提交。本轮最终工程双平台验收继续使用原冻结候选，不以源码结果冒称安装版已修复。

## 验证

- `node scripts/preflight-optional-guidance-test.cjs red-01`：原建议错误复现；音效/演出两个测试名称假设错误也保留。
- `red-02`：纠正用例名称后，七类原建议全部失败，形成有效回归基线。
- `green-01`：七类建议通过。
- `green-02`：七类建议通过，新增兼容性用例错误地假设普通缺图阻断；该QA失败保留。
- `green-03`：八项通过。核对普通缺图仍按既有placeholder发布语义报warning、已配置背景命令不再产生可选背景提示，以及缺失开屏视频仍阻断。
- `green-04`：同八项通过，报告新增预检源码、检测器及测试工具三份SHA-256绑定；不作为额外功能覆盖计数。
- `npm --prefix editor run typecheck`：退出0。
- `npm --prefix editor run build`：退出0，包含GameCLI构建。Editor仍有大chunk提示，不作为首开性能新结论。

原始结果：`F:\AgentVN\QA\Preflight-Optional-Guidance-20261108-01`。直接测试调用真实`runExportPreflight`入口，使用最小受控工程，零模型请求；不代表安装版或全部679项警告逐条审核通过。

## 源码浏览器消费

`preflight-optional-guidance-playwright.cjs`通过当前发布工作台和诊断弹窗真实点击，检查七类解决方案、实际视口/DPR/减少动效参数、边界、焦点、真实PNG尺寸以及关闭操作。

- `browser-01`误点已隐藏的旧工具栏按钮，零用例FAILED/清理PASS；原件保持。
- `browser-02`使用当前发布入口，11组合PASS，最后4K/DPR2/减少动效的立即采样几何/焦点联合断言FAILED；当时未保存失败probe，不能断言具体是几何还是焦点，也不判产品缺陷。
- 源码显示初始焦点在requestAnimationFrame交接。测试增加明确等待实际焦点进入及保存probe后，`browser-03 final-condition`仅补最后一个组合，PASS；无产品改动，没有重跑前11组合。
- `browser-coverage-01.json`独立核对同份预检源码哈希、11+1不重复组合、12张PNG真实尺寸，以及两轮所属PID/端口全零，PASS。原`browser-02`仍FAILED，不改为PASS。

范围为1080p/1440p/4K × DPR1/2 × 普通/减少动效共12组合；源码无头浏览器、隔离本机后端与受控小工程，不冒称物理4K或安装版。

## 后续

后续正式交付时纳入此补丁并补安装版提示消费核对；不为此文案修正中断或重跑正在进行的Android74构建。原始失败、最终工程及冻结候选保持。

## 1.9.55交付续接

上述“后续”和Android74在途说明是当时快照。Android74及最终工程设备功能、清理已终态，当前日志另有33条未结，见 `ACTIVE_TASKS.md` 顶部；没有因本补丁重新构建游戏或重启设备。

已保留检查点 `F:\AgentVN\Checkpoints\Preflight-Guidance-Release-1955-20261108-01`，并将五处正式版本元数据统一为1.9.55。发布采用Editor-only NSIS，不生成MSI或独立Player安装器。新发布证据目录为 `F:\AgentVN\QA\Preflight-Guidance-Release-1955-20261108-01`；是否通过以实际report为准，不以工具已适配或任务已启动为准。

安装消费使用新标准QA账户、默认数据库/WebView目录及独立后端端口。临时工程通过受支持项目导入API准备，随后实际安装版界面点击发布诊断，验证七类建议、焦点/几何、正常关闭和重启读回。此范围不是原生工程选择器新验收，也不重跑未受影响的Runtime矩阵。
