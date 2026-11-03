"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), out = path.join(root, "output/host-lifecycle-20261019-01");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const baseline = read("F:/AgentVN/Checkpoints/Host-Lifecycle-20261019-01/manifest.json");
const receipt = { at: new Date().toISOString(), status: "RUNNING",
  scope: "G08/HOST-02 native owned process cleanup fix, source/Dev + isolated no-bundle Release",
  modelSubmissions: 0, evidence: {}, notProven: [
    "New NSIS/MSI installation or upgrade", "Default user profile/db path acceptance",
    "Physical close-button/Alt+F4 Computer Use", "Save-confirmation user UI or auxiliary window native E2E",
    "uv-first launcher path: actual Dev run used Python fallback",
    "Whole G08 group", "Windows/Android exports and final project acceptance",
  ] };
for (const name of ["red-03", "red-04", "reuse-before", "green-release-01",
  "green-release-02", "reuse-after", "dev-workspace"]) {
  const file = path.join(out, name, "report.json"), result = read(file), red = name.startsWith("red-");
  assert.equal(result.status, red ? "FAILED" : "PASS", name);
  assert.equal(result.nativeCloseResult, "True");
  assert.equal(result.physicalInputVerified, false);
  assert.equal(result.cleanupSurvivors.length, 0);
  assert(!result.cleanupError && !result.error);
  assert(result.assertions.length >= 4, "Non-empty complete lifecycle assertions");
  if (red) {
    assert.equal(result.survivors.length, 1);
    assert(result.survivors[0].ExecutablePath.endsWith("creator-backend.exe"));
    assert.equal(result.backendAfterClose.status, "ok");
    assert.equal(result.assertions.filter(row => row.status === "FAILED").length, 2);
  } else {
    assert(result.assertions.every(row => row.status === "PASS"));
    if (name !== "reuse-before") {
      assert.equal(sha(result.screenshot.path), result.screenshot.sha256);
      assert.deepEqual(result.screenshot.pixels, result.page.viewport.map(v => Math.round(v * result.page.dpr)));
      assert(result.runtime.toLowerCase().startsWith("f:\\agentvn\\qa\\host-lifecycle-20261019-01\\"));
    }
  }
  receipt.evidence[name] = { ...describe(file), assertions: result.assertions.length };
}
for (const [name, count] of [["gates-01", 10], ["native-build-01", 1], ["dev-build-01", 1]]) {
  const file = path.join(out, name, "report.json"), result = read(file);
  assert.equal(result.status, "PASS"); assert.equal(result.commands.length, count);
  assert(result.commands.every(row => row.status === "PASS" && row.exitCode === 0));
  for (const row of result.commands) assert(fs.statSync(row.logFile).size > 0);
  receipt.evidence[name] = describe(file);
}
const unitLog = fs.readFileSync(path.join(out, "gates-01/01.log"), "utf8");
assert(unitLog.includes("4 passed; 0 failed"));
receipt.rustProcessRegression = { passed: 4 };
for (const name of ["red-cancel", "green-cancel"]) {
  const file = path.join(out, name, "report.json"), result = read(file), red = name === "red-cancel";
  assert.equal(result.status, red ? "FAILED" : "PASS");
  assert.equal(result.scenario, "cancel");
  assert(result.controlledBoundary.includes("Test-only"));
  assert.equal(result.cleanupSurvivors.length, 0);
  assert(!result.error && !result.cleanupError);
  assert.equal(result.assertions.find(row =>
    row.name === "cancelled close preserves entire backend ownership chain").status, red ? "FAILED" : "PASS");
  assert(result.afterCancelledClose.survivingOwned.some(row => row.ProcessId === result.hostPid));
  receipt.evidence[name] = { ...describe(file), assertions: result.assertions.length };
}
// Match creation time as well as PID: a reused PID is not a leaked process.
const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command",
  "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId," +
  "@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})"],
{ encoding: "utf8", windowsHide: true, timeout: 20000 });
assert.equal(ps.status, 0, ps.stderr);
const running = JSON.parse(ps.stdout.replace(/^\uFEFF/, ""));
for (const name of ["red-03", "red-04", "reuse-before", "green-release-01",
  "green-release-02", "reuse-after", "dev-workspace", "red-cancel", "green-cancel"]) {
  const result = read(path.join(out, name, "report.json"));
  for (const row of [...result.beforeTree, ...result.externalTree || []]) {
    assert(!running.some(now => now.ProcessId === row.ProcessId && now.Created === row.Created),
      `${name}: recorded process remains ${row.ProcessId}`);
  }
}
const dev = path.join(root, "AgentVN Dev.exe"), debug = path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe");
assert.equal(sha(dev), sha(debug), "Root Dev not actually overwritten");
assert.notEqual(sha(dev), baseline.originalDevSha256);
receipt.dev = describe(dev);
const fixed = "F:/AgentVN/QA/Host-Lifecycle-20261019-01/fixed-release/agentvn-editor.exe";
receipt.nativeRelease = describe(fixed);
assert.equal(read(path.join(out, "green-release-01/report.json")).exeSha256, sha(fixed));
assert.equal(read(path.join(out, "green-release-02/report.json")).exeSha256, sha(fixed));
assert.equal(read(path.join(out, "reuse-after/report.json")).exeSha256, sha(fixed));
assert.equal(read(path.join(out, "dev-workspace/report.json")).exeSha256, sha(dev));
const frozen = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-editor.exe";
assert.equal(sha(frozen), baseline.frozenExeSha256);
receipt.frozenUnchanged = describe(frozen);
const frozenBackend = path.join(path.dirname(frozen), "creator-backend.exe");
assert.equal(sha(frozenBackend), sha("F:/AgentVN/QA/Host-Lifecycle-20261019-01/candidate/creator-backend.exe"));
assert.equal(sha(frozenBackend), sha("F:/AgentVN/QA/Host-Lifecycle-20261019-01/fixed-release/creator-backend.exe"));
receipt.backendUnchanged = describe(frozenBackend);
receipt.sources = ["editor/src-tauri/src/main.rs", "editor/src-tauri/src/owned_process.rs",
  "editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock"].map(file => describe(path.join(root, file)));
receipt.status = "PASS";
fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
const gates = read(path.join(out, "gates-01/report.json"));
const commandRows = [...gates.commands,
  ...read(path.join(out, "native-build-01/report.json")).commands,
  ...read(path.join(out, "dev-build-01/report.json")).commands]
  .map(row => `| \`${row.command}\` | PASS，exit ${row.exitCode} | \`${path.relative(out, row.logFile)}\` |`).join("\n");
const nativeRows = ["red-03", "red-04", "reuse-before", "red-cancel",
  "green-release-01", "green-release-02", "reuse-after", "green-cancel", "dev-workspace"]
  .map(name => {
    const item = read(path.join(out, name, "report.json"));
    return `| ${name} | ${item.status} | ${item.mode}/${item.scenario || "normal"} | ${item.assertions.filter(row => row.status === "PASS").length}/${item.assertions.length} | \`${name}/report.json\` |`;
  }).join("\n");
const text = `# G08/HOST-02：宿主退出清理修复

生成时间：${receipt.at}。范围：Editor原生宿主后台/前端所有权；**不是全部G08、安装升级或全项目验收通过**。

## 结论

- 有效红基线两轮：正常Windows关闭请求后宿主exit 0，PyInstaller直接子进程退出，但后台孙进程与HTTP监听残留。
- 取消关闭对照：旧壳窗口留存，却提前杀死后台启动器；新壳取消关闭时整条后台链保留，随后正常退出时全清理。
- 新no-bundle Release隔离副本连续两轮正常退出通过；外部真实后台复用对照通过，不误杀外部服务。
- 实际根目录Dev启动真实Python fallback/uvicorn reloader＋npm/Vite后，正常关闭并释放后台/前端监听，通过；本机这次未走uv启动分支，不冒称该分支真实验证。
- 新增4个真实Windows进程回归通过：后代清理、启动器先退出后清理、重复清理、独立Job隔离、以及不存在可执行文件的失败路径（共4个test）。
- 所有已记录PID＋创建时间在收口复查均不存在；故障后的finally清理与产品自然退出分开记录，未用强杀后的结果冒充正常退出。

## 产品修改

仅\`editor/src-tauri/src/main.rs\`、新增\`owned_process.rs\`、\`Cargo.toml\`的Windows API feature。
本轮不修改Editor或Runtime的曲线、时长、遮罩、页面布局、AI策略或工程。
现有脏工作树和未跟踪实现保持，和本片检查点比较的是增量，不把全部Git差异算成本片。

后台/前端启动时先挂起，加入宿主独占的匿名、不可继承句柄Windows Job，再恢复主线程。
持有进程句柄而不是按进程名/PID猜归属，Job关闭时处理全部后代；复用服务由None表示，不加入Job。
退出清理由\`CloseRequested\`改为主窗口\`Destroyed\`／应用\`Exit\`，避免可取消关闭时先停服务。

## 直接原生行为结果

| 证据 | 结果 | 模式 | PASS/总断言 | 原始报告 |
|---|---|---|---|---|
${nativeRows}

驱动是Windows \`Process.CloseMainWindow\`（WM_CLOSE），**不是物理鼠标/Alt+F4或Computer Use**。
取消场景使用明确标注的测试专用原生close-request listener，不声称验证了保存确认UI。
全片DB和WebView均显式隔离，临时小工程仅登记，未打开工程、未改剧情或调用模型。
截图来自真实WebView，核对实际viewport/DPR和PNG尺寸及SHA；本片是进程生命周期回归，不冒称完成1080p/2K/4K动效矩阵。
Debug壳隔离副本指向开发前端的失败尝试保留，不计PASS；详见\`harness-notes.md\`。

## 实际执行命令与门槛

| 命令 | 结果 | 日志 |
|---|---|---|
${commandRows}

原生行为驱动：\`node scripts/host-lifecycle-native.cjs <EXE> <独立证据目录> <后台端口> <CDP端口> [owned/reuse/workspace] [normal/cancel]\`。
每轮实际EXE、端口、进程创建时间、模式与截图均在上表原始report内，未空矩阵/零用例销项。
上传回归为32通过／1原有ignored；不把ignored算通过。其他过滤出的0测试runner不计作覆盖。
首次Rust常量名错误、早期CDP/IPC工具失败和中断均另记，不改写历史失败。
Release验证后仅对新Rust模块做rustfmt格式化；根目录Dev是格式化后完整重编并实测的产物，两个EXE哈希分别记录。
构建保留既有dead_code和bundle大小/依赖审计告警，未自动升级依赖或据构建成功宣称告警已修复。

## 产物及追溯

- Dev：\`${receipt.dev.path}\`
  - SHA-256：\`${receipt.dev.sha256}\`
  - 文件生成时间：${receipt.dev.modifiedAt}，已与debug EXE核对一致，并不同于检查点旧Dev。
- 隔离no-bundle Release：\`${receipt.nativeRelease.path}\`
  - SHA-256：\`${receipt.nativeRelease.sha256}\`
  - 文件生成时间：${receipt.nativeRelease.modifiedAt}。
- 冻结安装EXE：\`${receipt.frozenUnchanged.path}\`
  - SHA-256：\`${receipt.frozenUnchanged.sha256}\`，保持原字节不变。
- 检查点：\`${baseline.checkpoint}\`；隔离运行资料：\`${baseline.qa}\`。
- 机器可读证据、源文件SHA和报告SHA：\`receipt.json\`。

## 不扩大的结论

新NSIS/MSI实际安装、默认用户profile、覆盖升级、辅助窗口原生关闭、保存UI取消、
完整G08、Windows/Android导出和最终工程均未由本片证明。
冻结安装版历史G08 FAILED及18组3PASS/9FAILED/6BLOCKED不改写。
其它源码修复、真实模型收费重试、旧包样本和独立环境条件继续按总账推进。
`;
fs.writeFileSync(path.join(out, "REPORT.md"), text, { flag: "wx" });
console.log(JSON.stringify(receipt, null, 2));
