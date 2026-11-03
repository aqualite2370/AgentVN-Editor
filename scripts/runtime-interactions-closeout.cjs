"use strict";
// Source/browser + build receipt, deliberately not an installed/device PASS.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { gunzipSync } = require("node:zlib");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Runtime-Interactions-20261019-01";
const checkpoint = "F:/AgentVN/Checkpoints/Runtime-Interactions-20261019-01";
const out = path.join(root, "output/runtime-interactions-20261019-01");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hashBytes = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const hash = file => hashBytes(fs.readFileSync(file));
const describe = file => ({ path: path.resolve(file), sha256: hash(file),
  bytes: fs.statSync(file).size, modifiedAt: fs.statSync(file).mtime.toISOString() });

(async () => {
  const greenFile = path.join(qa, "headed-full-01/report.json"), green = read(greenFile);
  const gates = read(path.join(out, "check-01/report.json")), dev = read(path.join(out, "dev-01/report.json"));
  assert.equal(green.status, "PASS"); assert.equal(green.cases.length, 24);
  assert.equal(green.cleanup.status, "PASS");
  assert.equal(green.modelRequests, 0);
  assert.equal(gates.status, "PASS"); assert.equal(gates.commands.length, 14);
  assert.equal(dev.status, "PASS"); assert.equal(dev.commands.length, 1);
  assert([...gates.commands, ...dev.commands].every(c => c.exitCode === 0));
  assert.deepEqual(gates.sources, dev.sources);
  assert.equal(hash(path.join(qa, "headed-full-01/executed-test.cjs")),
    hash(path.join(root, "scripts/runtime-interactions-playwright.cjs")));
  let episodes = 0, assertions = 0, frames = 0;
  const combinations = new Set(), pngs = [];
  for (const c of green.cases) {
    combinations.add(`${c.layout}/${c.width}/${c.height}/${c.dpr}/${c.reduced}`);
    assert.equal(c.status, "PASS"); assert.equal(c.episodes.length, c.layout === "agentvn" ? 5 : 4);
    assert.deepEqual(c.screenshot.before, c.screenshot.after);
    assert.deepEqual(c.screenshot.before, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
    const png = fs.readFileSync(c.screenshot.path);
    assert.equal(hashBytes(png), c.screenshot.sha256);
    assert.equal(png.readUInt32BE(16), c.width * c.dpr);
    assert.equal(png.readUInt32BE(20), c.height * c.dpr);
    pngs.push(c.screenshot);
    for (const e of c.episodes) {
      assert.equal(e.status, "PASS");
      assert(e.checks.length >= 3 && e.checks.every(check => check.status === "PASS"));
      const bytes = fs.readFileSync(e.trace.path);
      assert.equal(hashBytes(bytes), e.trace.sha256);
      const trace = JSON.parse(gunzipSync(bytes));
      assert(trace.frames.length >= 3 && !trace.limitReached);
      assert(trace.frames.every(f => !f.hidden && f.width === c.width && f.height === c.height
        && f.dpr === c.dpr && f.reduced === c.reduced && f.overflow <= 1
        && !f.unavailableFocus && f.modalCount <= 1 && f.playerCount <= 1));
      episodes++; assertions += e.checks.length; frames += trace.frames.length;
    }
  }
  assert.equal(combinations.size, 24); assert.equal(episodes, 108);
  const sources = gates.sources.map(s => {
    assert.equal(hash(path.join(root, s.file)), s.sha256);
    const bundled = path.join(root, "editor/src-tauri/bundle-workspace", s.file);
    assert.equal(hash(bundled), s.sha256, `Bundled source differs: ${s.file}`);
    return { ...describe(path.join(root, s.file)), bundled: describe(bundled) };
  });
  const original = read(path.join(checkpoint, "manifest.json"));
  for (const file of ["GameCli_framework/src/components/player/PlaybackControls.tsx",
    "GameCli_framework/src/styles/shell.css", "GameCli_framework/src/styles/variables.css", "AGENTS.md"]) {
    assert.equal(hash(path.join(root, file)), original.files.find(f => f.file === file).sha256);
  }
  const editorBaseline = read("F:/AgentVN/Checkpoints/Editor-Morph-Bounds-20261019-01/manifest.json");
  const editorUnchanged = editorBaseline.files
    .filter(f => !["AGENTS.md", "plans/ACTIVE_TASKS.md"].includes(f.relative));
  assert.equal(editorUnchanged.length, 8);
  editorUnchanged.forEach(f => assert.equal(hash(path.join(root, f.relative)), f.sha256));
  const rootDev = describe(path.join(root, "AgentVN Dev.exe"));
  const debug = describe(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
  assert.equal(rootDev.sha256, debug.sha256);
  assert.equal(dev.devReplacement.target, path.join(root, "AgentVN Dev.exe"));
  assert.equal(dev.devReplacement.afterSha256, rootDev.sha256);
  assert(dev.devReplacement.events.some(e => Date.parse(e.at) >= Date.parse(dev.commands[0].startedAt)
    && Date.parse(e.at) <= Date.parse(dev.commands[0].finishedAt)),
  "Root Dev write must actually be observed during this build, even if Copy-Item preserves the source timestamp");
  const player = describe(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
  assert.equal(player.sha256, hash(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
  const frozenRoot = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor";
  const frozen = describe(path.join(frozenRoot, "agentvn-editor.exe"));
  assert.equal(frozen.sha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
  const earlier = read(path.join(root, "output/project-reload-20261019-01/receipt.json"));
  const backend = describe(earlier.frozenBackend.path);
  assert.equal(backend.sha256, earlier.frozenBackend.sha256);
  const history = [];
  for (const name of ["red-smoke-01", "red-smoke-02", "green-smoke-01", "green-smoke-02",
    "green-full-01", "headed-probe-01", "headed-full-01"]) {
    const file = path.join(qa, name, "report.json"), r = read(file);
    assert.equal(r.cleanup.status, "PASS");
    let responding = false;
    try { responding = (await fetch(r.service.url, { signal: AbortSignal.timeout(1200) })).ok; } catch {}
    assert(!responding, `Old test service still responds: ${name}`);
    history.push({ name, ...describe(file), originalStatus: r.status,
      combinations: r.cases.length, passed: r.cases.filter(c => c.status === "PASS").length,
      service: r.service, respondsAtCloseout: responding });
  }
  const ancillary = ["exit-safety-01", "menu-rules-01"].map(name => {
    const file = path.join(qa, name, "report.json"), r = read(file);
    assert.equal(r.status, "PASS"); assert(r.cases.length > 0 && r.cases.every(c => c.status === "PASS"));
    return { name, ...describe(file), cases: r.cases.length };
  });
  assert.equal(ancillary[0].cases, 6); assert.equal(ancillary[1].cases, 27);
  const receipt = { status: "SOURCE_REGRESSION_AND_DEV_PASS", at: new Date().toISOString(),
    version: read(path.join(root, "editor/src-tauri/tauri.conf.json")).version,
    layer: "GameCLI Runtime", scope: "Source Chromium + controlled host IO/events + full Dev build",
    behavior: { combinations: 24, episodes, assertions, frames, headed: true,
      renderer: green.renderer, physical4K: false }, history, ancillary, sources, pngs,
    gates: describe(path.join(out, "check-01/report.json")),
    devBuild: describe(path.join(out, "dev-01/report.json")),
    devReplacement: dev.devReplacement, rootDev, debug, player,
    previousDevSha256: original.dev.sha256, checkpoint, frozen, backend,
    editorProductFilesUnchanged: editorUnchanged, modelRequests: 0,
    notProven: ["Headless high-resolution short-motion sampling/performance",
      "New native Dev UI interaction (build/overwrite only here)", "New installed Release/WebView",
      "Physical Android back/touch, exported Windows/Android runtime",
      "Other Runtime narrative/layout defects, complete G13 or complete18-group regression"] };
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  const commandRows = [...gates.commands, ...dev.commands].map(c =>
    `| \`${c.command}\` | PASS / exit0 | \`${path.relative(out, c.logFile)}\` |`).join("\n");
  const historyRows = history.map(h => `| ${h.name} | ${h.originalStatus} | ${h.passed}/${h.combinations} |`).join("\n");
  const report = `# G13 Runtime 弹窗、返回与快捷菜单交接修复

生成时间：${receipt.at}，Editor ${receipt.version}。**本修复块源码行为与Dev构建通过，不代表完整G13或安装版通过。**

## 修复与边界

- 原四组合复现：两布局退出弹窗开关硬切、遮幕中第二次Escape丢失、AgentVN减少动效快捷菜单硬切。
- 共用Modal增加可中断呈现层：沿用220ms／减少动效140ms及现有曲线；离场副本inert、aria-hidden且无功能角色。
  关闭时立即交还业务和焦点；重新打开承接当前呈现值，不叠加第二个功能弹窗。
- Escape及宿主返回按最新导航意图处理；取消尚未提交的菜单时平滑反向遮幕，保留同一剧情实例和位置。
- AgentVN减少动效快捷菜单局部80ms透明度不再被全局1ms覆盖；不改全局重置或正常模式形态。
- 全矩阵又发现加载态将旧页inert后焦点仍留其中，补可见加载状态接管与合理恢复。
- 未改Editor产品曲线、Runtime黑场token、共享菜单淡化规则、剧情格式或用户设置。

## 实际验收

有界面Chromium：两布局 × 1920×1080／2560×1440／3840×2160 × DPR1/2 × 普通／减少动效，
**24组合、108流程、${assertions}断言通过**。原帧${frames}条、24张PNG字节/实际viewport/DPR、7份产品与bundled SHA全部核对。
流程包含弹窗开关、关闭中重开、AgentVN快捷菜单、遮幕中第二次真实Escape及受控宿主返回。
可信鼠标/键盘输入、焦点、裁切/越界/横向溢出、唯一功能弹窗/剧情实例、中间帧和终态分别断言。
以公共live-preview协议加载隔离小剧情，不直接改store，不使用用户工程、不发模型请求。
系统返回明确是受控Event，**不是Android真实触摸**；退出安全测试使用受控原生IO，非真实磁盘失败。
主矩阵记录实际GPU/Direct3D信息；视口模拟不是物理4K显示器验收。

## 失败记录全部保留

| 轮次 | 原状态 | 通过组合/实际组合 |
|---|---|---|
${historyRows}

- red-smoke-01包含过严的静态几何采样数检查；修正后red-smoke-02仍完整复现三类产品缺陷。
- green-smoke-02的系统返回观察器注册较晚，被产品stopImmediatePropagation挡住；改为记录实际派发Event和defaultPrevented，
  未伪造trusted。原失败不改写。
- green-full-01无头24组合FAILED：高分辨率采样间隔漏掉短淡化/重开区间，另发现真实加载态焦点缺陷。
  仅修焦点；同断言有界面探针及完整24组合通过。**不声称无头性能或所有渲染路径已修复。**
- 历史冻结安装版G13 FAILED继续保留，不能用本报告追溯代证。

## 实际命令与结果

各轮均显式设置新目录 \`AGENTVN_RUNTIME_INTERACTIONS_OUTPUT=${qa}/<轮次>\`。
\`node scripts/runtime-interactions-playwright.cjs\`：各原状态如上；
最终设置 \`AGENTVN_RUNTIME_INTERACTIONS_HEADED=1\`，清除SMOKE/CASE过滤后24组合PASS。
\`AGENTVN_RUNTIME_INTERACTIONS_GREEN=${greenFile}\` 后依次执行
\`node scripts/runtime-interactions-gates.cjs check\`、\`node scripts/runtime-interactions-gates.cjs dev\`，均PASS。

| 子命令 | 结果 | 日志 |
|---|---|---|
${commandRows}

退出安全覆盖两布局三尺寸共${ancillary[0].cases}组；原菜单规则三尺寸共${ancillary[1].cases}项。
独立收口审计：\`node scripts/runtime-interactions-closeout.cjs\`，核对原帧、PNG、构建与资源字节，拒绝空矩阵。

## 交付与未完成项

- 根Dev确已覆盖：\`${rootDev.path}\`；SHA-256 \`${rootDev.sha256}\`，mtime ${rootDev.modifiedAt}。
  与debug产物一致；完整脚本重编的Player资源SHA \`${player.sha256}\`。
- 冻结安装EXE/后台、8份Editor基线产品文件及Runtime既有样式token保持，7份bundled修复源码一致。
- 所有本片主矩阵服务已退出且端口复核不响应；原失败/日志/截图保留在F盘统一根；模型请求0。
- 未做本片新Dev原生界面、NSIS/MSI、双平台导出运行、Android触摸或最终工程验收。
  旧18组3PASS／9FAILED／6BLOCKED不改写。下一块先处理已登记对白头像问题，其余NVL、继承、
  资源导出、图标、素材/工程目录、真实模型及安装升级仍逐项留账。
`;
  fs.writeFileSync(path.join(out, "REPORT.md"), report, { flag: "wx" });
  console.log(JSON.stringify({ status: receipt.status, episodes, assertions, rootDev, player, out }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
