"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Project-Reload-20261019-01";
const output = path.join(root, "output/project-reload-20261019-01");
const checkpoint = "F:/AgentVN/Checkpoints/Project-Reload-20261019-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const gates = read(path.join(output, "check-01/report.json"));
const dev = read(path.join(output, "dev-01/report.json"));
assert.equal(gates.status, "PASS"); assert.equal(dev.status, "PASS");
assert.equal(gates.commands.length, 10); assert.equal(dev.commands.length, 1);
assert([...gates.commands, ...dev.commands].every(row => row.exitCode === 0));
assert.deepEqual(gates.sources, dev.sources);
for (const row of gates.sources) assert.equal(sha(path.join(root, row.file)), row.sha256);
const core = read(path.join(qa, "green-03/report.json"));
const lifetime = read(path.join(qa, "lifetime-02/report.json"));
assert(core.cases.slice(0, 21).every(row => row.status === "PASS"));
assert.equal(lifetime.status, "PASS");
const manifest = read(path.join(checkpoint, "manifest.json"));
for (const relative of ["editor/src/app/projectHydration.ts", "editor/src/store/projectStore.ts",
  "editor/src/api/backendClient.ts"]) {
  assert.equal(sha(path.join(root, relative)), manifest.files.find(row => row.relative === relative).sha256);
}
const earlier = read(path.join(root, "output/host-lifecycle-20261019-01/receipt.json"));
for (const record of [earlier.frozenUnchanged, earlier.backendUnchanged, ...earlier.sources])
  assert.equal(sha(record.path), record.sha256, `Unrelated/frozen source changed: ${record.path}`);
const currentDev = path.join(root, "AgentVN Dev.exe");
assert.equal(sha(currentDev), sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command",
  "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId," +
  "@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})"],
{ encoding: "utf8", windowsHide: true, timeout: 20000 });
assert.equal(ps.status, 0, ps.stderr);
const running = JSON.parse(ps.stdout.replace(/^\uFEFF/, ""));
const runs = ["red-01", "red-02", "red-03", "green-01", "green-02", "green-03", "lifetime-01", "lifetime-02"]
  .map(name => {
    const file = path.join(qa, name, "report.json"), data = read(file);
    if (data.cleanupSurvivors) assert.deepEqual(data.cleanupSurvivors, []);
    for (const process of data.service?.processes || []) {
      assert(!running.some(now => now.ProcessId === process.ProcessId && now.Created === process.Created),
        `Recorded process survived: ${name}/${process.ProcessId}`);
    }
    return { name, ...describe(file), originalStatus: data.status,
      passed: data.cases.filter(row => row.status === "PASS").length,
      failed: data.cases.filter(row => row.status !== "PASS").length,
      sourceTestSha256: data.testSha256 };
  });
const pngs = core.cases.slice(0, 12).map(row => {
  assert.equal(sha(row.screenshot.path), row.screenshot.sha256);
  return { width: row.width, height: row.height, dpr: row.dpr, motion: row.motion, ...row.screenshot };
});
const receipt = { status: "SOURCE_REGRESSION_AND_DEV_PASS", at: new Date().toISOString(),
  scope: "HOST-03 current-project backend reload and request ownership, not installed acceptance",
  version: read(path.join(root, "editor/src-tauri/tauri.conf.json")).version,
  sourceBehavior: { latestPass: 23, matrix: 12, controlledHTTPAndSession: 9,
    componentLifetime: 2, originalFullRunStatus: core.status,
    originalHarnessFailuresPreserved: true },
  evidence: runs, screenshotEvidence: pngs,
  gates: describe(path.join(output, "check-01/report.json")),
  devBuild: describe(path.join(output, "dev-01/report.json")),
  sources: gates.sources.map(row => describe(path.join(root, row.file))),
  checkpoint, dev: describe(currentDev), previousDevSha256: manifest.originalDevSha256,
  frozenEditor: describe(earlier.frozenUnchanged.path), frozenBackend: describe(earlier.backendUnchanged.path),
  modelSubmissions: 0, notProven: [
    "New Dev native UI reload flow (this slice verified source Chromium and root executable build/overwrite)",
    "New NSIS/MSI install and current fix's installed WebView flow",
    "Complete G11 external/player workflow or G08 installation/upgrade group",
    "Physical Computer Use input, real-model tasks, Windows/Android exports and final project acceptance",
  ] };
fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
const commandRows = [...gates.commands, ...dev.commands]
  .map(row => `| \`${row.command}\` | PASS / exit ${row.exitCode} | \`${path.relative(output, row.logFile)}\` |`).join("\n");
const runRows = runs.map(row => `| ${row.name} | ${row.originalStatus} | ${row.passed} / ${row.failed} |`).join("\n");
const text = `# HOST-03：后端重载串旧图修复

生成时间：${receipt.at}。Editor ${receipt.version}；范围仅为源码浏览器回归与Dev构建交付，
**不代表新安装版、完整G11或总任务验收通过**。

## 修复结果

- 真实入口：导入隔离小工程 → 顶部“预览” → 展开“工程重载” → “从后端重载工程”。
- 两轮原始复现：当前专属详情是 \`reload-current-scene\`，共享旧图是 \`old-foreign-scene\`；
  点击后旧实现安装了旧图，却提示重载完成。这里只证明画布串图，不声称已发生落盘数据损失。
- 改用当前工程专属详情接口，不回退读取共享单例；写图前复用工程导入校验，核对工程ID及非空有效图。
- 本机临时载入代次覆盖同工程重开与A→B→A；同时核对图编辑历史与组件生命周期。
  旧成功/错误不能覆盖新图、全局提示或新面板的忙碌状态；原始错误仍交给诊断记录。
- 缺失、空图、错误工程、损坏连线及请求失败保持当前草稿；重试可恢复，重复点击不多发请求。
- 代次不写入 \`.vnproj\` 或玩家剧本；未改工程格式、后端接口、AI策略、Editor/Runtime动效。

## 实际行为证据及边界

当前有效结果为 **12个显示组合 + 9项受控HTTP/会话场景 + 2项组件生命周期 = 23项通过**。
矩阵：1920×1080、2560×1440、3840×2160 × DPR1/2 × 普通/减少动效。
实测viewport、DPR与motion；PNG头尺寸等于实际viewport×DPR；断言真实按钮滚动后可命中、无页面横向溢出、
画布节点/工程身份及请求目标。截图不是唯一判断依据。

正常主路径使用真实Python后台和独立数据库、真实Vite/Chromium及真实顶部按钮；
共享图/专属详情的分歧是隔离DB中受控设置的持久化夹具，不声称自然用户操作必然制造该分歧。
异常响应、A→B→A与同工程重开为明确的受控时序/状态注入；正常UI忙碌锁本来不允许这样切工程。
卸载场景使用真实React组件的受控替换夹具；为开启真实诊断写入器而使用带Tauri标记的测试UA，
**不是原生宿主或Computer Use验证**。旧面板响应完成后，新面板仍busy，只有新请求能释放。

主矩阵及9项场景见 \`${qa}/green-03/report.json\` 前21项；
两项卸载场景的有效重跑见 \`${qa}/lifetime-02/report.json\`。
原全量命令仍记录FAILED，未改成PASS；门槛工具逐项核对上述23项最新结果，拒绝漏项、空矩阵和未知失败。

## 不隐瞒工具失败

| 运行 | 原状态 | PASS / 非PASS条数 |
|---|---|---|
${runRows}

- red-01/02：相同真实入口串图失败，各一次，均为有效产品红。
- red-03：9项中6失败/3通过；错误工程/损坏图、重试后串图及两类迟到响应失败已保存。
- green-01：8项扩展行为通过；主路径走到成功后触发脚本自身 \`req.url()\` 取值错误。
- green-02：9项扩展行为通过；12矩阵几何检查放在可滚动维护按钮自动滚动之前，错误地判其不可命中。
  修正测试为先真实滚入可见区域再维持同样的边界/命中断言，没有放宽断言或修改产品布局。
- lifetime-01：夹具提前直接加载shared模块遇Vite允许列表时序，并且非Tauri环境不写诊断，导致等待失效。
- green-03：前21项全通过；其仍使用旧卸载夹具，两项等待诊断超时。原始FAILED保留。
- lifetime-02：仅重跑上述两项；修正夹具加载及日志环境后，两项均通过，实际store/回调/忙碌状态断言不变。

## 实际命令

浏览器各轮均显式设置：
\`AGENTVN_TEST_PROJECT=${manifest.input}\`，
\`AGENTVN_WORKSPACE_OUTPUT=${qa}/<独立轮次>\`。
命令 \`node scripts/project-reload-playwright.cjs\`：
red-01/02及green-01为原脚本/冒烟轮；red-03为9项冒烟；green-02为21项；
green-03为23项，其中前21通过、旧夹具两项超时。
\`AGENTVN_RELOAD_LIFETIME_ONLY=1 node scripts/project-reload-playwright.cjs\`：
lifetime-01失败，lifetime-02两项PASS/exit0。详细环境与错误见原JSON。

门槛汇总：\`node scripts/project-reload-gates.cjs check\`、\`node scripts/project-reload-gates.cjs dev\`，均PASS。

| 实际子命令 | 结果 | 日志 |
|---|---|---|
${commandRows}

## 产物与后续

- 根Dev：\`${receipt.dev.path}\`，已完整执行仓库Dev脚本并覆盖；与debug产物SHA-256一致：
  \`${receipt.dev.sha256}\`。mtime：${receipt.dev.modifiedAt}，${receipt.dev.bytes} bytes。
  本片没有重新启动Dev验证重载UI，不能把编译/覆盖当成原生或安装版流程通过。
- 源码及原始报告SHA、生成时间、12张PNG与检查点详见 \`receipt.json\`。
- 大型运行资料/隔离DB集中于 \`${qa}\`；可恢复切片检查点 \`${checkpoint}\`。
- 有记录创建时间的测试进程已再次复核退出；本片模型提交0，没有读取密钥，没有触碰用户工程/共享数据库。
- 冻结安装EXE及后台SHA与上一片一致；历史18组仍3PASS/9FAILED/6BLOCKED，不追溯改写。
- 下一焦点：Editor减少动效宽→窄morph越界；其它Runtime、素材替换/工程目录、真实模型、
  新安装升级、双平台及最终工程待办继续保留。
`;
fs.writeFileSync(path.join(output, "REPORT.md"), text, { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, latestBehaviorPass: 23, dev: receipt.dev, output }, null, 2));
