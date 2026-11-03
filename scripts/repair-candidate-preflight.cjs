"use strict";
// Read-only product inspection. Writes only a new, caller-selected evidence directory.
// A provenance PASS explicitly does NOT certify the repaired release or any live model flow.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { latestSourceMap, verifyLatestSource, latestQaSourceMap, checkHistoricalGroups } =
  require("./lib/repair-candidate-provenance.cjs");
const root = path.resolve(__dirname, "..");
const specs = [
  ["EDITOR-MASK", "editor-selection-mask-20261019-01/terminal-audit-02.json"],
  ["AI-PROTOCOL", "assistant-tool-protocol-20261019-01/receipt.json"],
  ["NOVEL-ENTRY", "novel-entry-20261019-01/receipt.json"],
  ["NOVEL-PREFLIGHT", "novel-preflight-20261019-01/receipt.json"],
  ["ASSISTANT-FOCUS", "assistant-focus-20261019-01/receipt.json"],
  ["GUI-SCOPE", "gui-scope-20261019-01/receipt.json"],
  ["HOST-LIFECYCLE", "host-lifecycle-20261019-01/receipt.json"],
  ["PROJECT-RELOAD", "project-reload-20261019-01/receipt.json"],
  ["EDITOR-MORPH", "editor-morph-bounds-20261019-01/receipt.json"],
  ["RUNTIME-INTERACTIONS", "runtime-interactions-20261019-01/receipt.json"],
  ["DIALOG-PORTRAIT", "dialog-portrait-source-20261020-01/receipt.json"],
  ["NVL-FLOW", "nvl-flow-source-20261020-01/receipt.json"],
  ["OPACITY-INHERITANCE", "layout-opacity-source-20261020-01/receipt.json"],
  ["LAYOUT-RESOURCES", "layout-resources-source-20261020-01/receipt.json"],
  ["THEME-ICON", "theme-icon-source-20261020-01/receipt.json"],
  ["ROLE-GEOMETRY", "role-geometry-source-20261020-01/receipt.json"],
  ["OFFICIAL-GUI-CONSUMPTION", "official-gui-consumption-20261020-01/receipt-01.json"],
  ["DIALOG-PORTRAIT-AUTHORING", "dialog-portrait-authoring-20261020-01/receipt-01.json"],
  ["DATAURL", "data-url-repair-20261020-01/receipt-02.json"],
  ["IMPORT-ATOMIC", "project-import-atomic-20261020-01/receipt-02.json"],
  ["PREVIEW-CLOSE-ARGS-01", "native-dev-preview-repair-20261020-01/receipt-01.json"],
];
const destination = path.resolve(process.argv[2] || "");
assert(process.argv[2] && destination.toLowerCase().startsWith("f:\\agentvn\\qa\\repair-candidate-preflight-"),
  "Use a fresh F:\\AgentVN\\QA\\Repair-Candidate-Preflight-* directory");
assert(!fs.existsSync(destination), "Never overwrite an audit");
fs.mkdirSync(destination, { recursive: true });
const report = { startedAt: new Date().toISOString(), provenanceStatus: "RUNNING",
  fullAcceptance: false, acceptanceStatus: "BLOCKED",
  scope: "CURRENT_REPAIR_SOURCE_AND_ARTIFACT_PROVENANCE_NOT_INSTALLED_ACCEPTANCE",
  receipts: [], sourceChecks: [], evidenceChecks: [], bundledChecks: [],
  artifactChecks: [], errors: [], modelRequests: 0, newProductBehaviorTests: 0,
  productChanges: 0, newBuilds: 0, deviceOperations: 0 };
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hashCache = new Map();
async function describe(file) {
  file = path.resolve(root, file);
  if (hashCache.has(file.toLowerCase())) return hashCache.get(file.toLowerCase());
  const stat = fs.statSync(file), h = crypto.createHash("sha256");
  assert(stat.isFile(), `Not a file: ${file}`);
  for await (const bytes of fs.createReadStream(file)) h.update(bytes);
  const row = { path: file, sha256: h.digest("hex"), bytes: stat.size,
    modifiedAt: stat.mtime.toISOString() };
  hashCache.set(file.toLowerCase(), row);
  return row;
}
async function checked(file, expected, label, collection) {
  try {
    const actual = await describe(file);
    assert.equal(actual.sha256, expected.toLowerCase(), `Hash mismatch: ${file}`);
    collection.push({ label, ...actual, status: "PASS" });
    return actual;
  } catch (error) {
    const item = { label, path: file, status: "FAILED", error: String(error.message) };
    collection.push(item); report.errors.push(item);
    return null;
  }
}
function descriptors(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if ((value.path || value.file) && /^[a-f0-9]{64}$/i.test(value.sha256 || ""))
    result.push(value);
  for (const child of Object.values(value)) if (child && typeof child === "object") descriptors(child, result);
  return result;
}
(async () => {
  const receipts = [];
  for (const [id, relative] of specs) {
    const file = path.join(root, "output", relative), data = read(file);
    assert.match(data.status, /PASS/);
    receipts.push({ id, data });
    report.receipts.push({ id, ...await describe(file), originalStatus: data.status,
      originalScope: data.scope || data.layer || "See original receipt limitations" });
    for (const entry of descriptors(data)) {
      const target = path.resolve(root, entry.path || entry.file);
      // Historical executables, screenshots and user/project files are intentionally not re-certified.
      // Only hash-bearing report/log references are audited, without interpreting their text as PASS.
      if (!/\.(json|log|md)$/i.test(target)) continue;
      if (!(target.toLowerCase().startsWith(path.join(root, "output").toLowerCase() + path.sep)
        || target.toLowerCase().startsWith("f:\\agentvn\\qa\\"))) continue;
      await checked(target, entry.sha256, id, report.evidenceChecks);
    }
  }
  const qaToolPath = path.join(root, "output/async-readiness-audit-20261020-01/receipt-02.json");
  const qaTool = read(qaToolPath);
  assert.equal(qaTool.status, "QA_TOOL_REPAIR_PASS");
  assert.equal(qaTool.checks.length, 6);
  assert(qaTool.checks.every(c => c.status === "PASS"));
  const qaSourceChecks = [];
  for (const source of latestQaSourceMap(root, qaTool.qaSources, receipts)) {
    const actual = await describe(source.path);
    qaSourceChecks.push(verifyLatestSource(source, actual.sha256));
    await checked(source.path, source.sha256, `current QA caller, latest declaration ${source.receiptId}`, report.evidenceChecks);
  }
  report.qaToolRepair = { ...await describe(qaToolPath), originalStatus: qaTool.status,
    qualifier: "Historical wait-seam evidence unchanged; later explicitly declared QA source identities replace old ones, not the historical test results",
    legacyClient: qaTool.historicalClient, notProven: qaTool.notProven, currentSources: qaSourceChecks,
    supersededSources: qaSourceChecks.filter(s => s.previous.some(p => p.sha256 !== s.sha256)) };
  const sources = latestSourceMap(root, receipts);
  for (const entry of sources) {
    try {
      const actual = await describe(entry.path);
      report.sourceChecks.push(verifyLatestSource(entry, actual.sha256));
      const relative = path.relative(root, entry.path);
      if (relative.startsWith(`GameCli_framework${path.sep}src${path.sep}`)
        || relative.startsWith(`shared${path.sep}`)) {
        const bundled = path.join(root, "editor/src-tauri/bundle-workspace", relative);
        await checked(bundled, actual.sha256, entry.receiptId, report.bundledChecks);
      }
    } catch (error) {
      const row = { ...entry, status: "FAILED", error: String(error.message) };
      report.sourceChecks.push(row); report.errors.push(row);
    }
  }
  const latest = receipts.at(-1).data, protocol = receipts[1].data;
  await checked(path.join(root, "AgentVN Dev.exe"), latest.dev.sha256, "latest root Dev", report.artifactChecks);
  await checked(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"),
    latest.dev.sha256, "actual debug counterpart", report.artifactChecks);
  assert(!fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")), "Undelivered pending Dev exists");
  for (const file of ["editor/src-tauri/binaries/agentvn-player.exe",
    "GameCli_framework/src-tauri/target/release/agentvn-player.exe"])
    await checked(path.join(root, file), latest.player.sha256, "current rebuilt Player", report.artifactChecks);
  if (process.argv[3] || process.argv[4]) {
    assert(process.argv[3] && process.argv[4], "Provide both current backend behavior and bytecode evidence");
    const behavior = read(process.argv[3]), payload = read(process.argv[4]);
    assert.equal(behavior.status, "PASS");
    assert.equal(behavior.cleanup.code, 0);
    assert.equal(behavior.cleanup.apiStopped, true);
    assert.equal(behavior.cleanup.sidecarTaskkill, 0);
    assert.equal(behavior.cleanup.modelRequestCount, 78);
    assert.equal(behavior.cases.length, 13);
    assert(behavior.cases.every(c => c.status === "PASS"));
    const matrix = behavior.cases.filter(c => c.case === "actual-six-tool-loop-with-local-parser-and-Runtime");
    const expected = [1, 2].flatMap(dpr => ["no-preference", "reduce"].flatMap(motion =>
      [[1920, 1080], [2560, 1440], [3840, 2160]].map(([width, height]) =>
        JSON.stringify([width, height, dpr, motion]))));
    assert.deepEqual(matrix.map(c => JSON.stringify([c.width, c.height, c.dpr, c.motion])).sort(), expected.sort());
    assert.equal(behavior.cases.filter(c =>
      c.case === "reload-resumes-original-local-validation-and-preview-without-model-replay").length, 1);
    assert.match(behavior.scope, /external model controlled; NOT installed Editor\/live-model/);
    assert.equal(new URL(behavior.service.apiUrl).hostname, "127.0.0.1");
    assert.equal(payload.status, "PASS");
    assert.equal(payload.applicationCodeExecuted, false);
    assert.equal(payload.appModules, 71);
    assert.equal(payload.launcherModules, 1);
    assert.equal(payload.modules.length, 72);
    assert(payload.modules.every(m => m.status === "PASS" && m.codeObjectEqual));
    assert.equal(payload.sha256, payload.afterSha256);
    assert.equal(behavior.sidecarSha256, payload.sha256);
    for (const module of payload.modules)
      await checked(module.source, module.sourceSha256, "current packaged module source", report.evidenceChecks);
    report.backendRevalidation = {
      behavior: await describe(process.argv[3]), payload: await describe(process.argv[4]),
      currentSha256: payload.sha256, formerTestedSha256: protocol.products.sidecar.sha256,
      currentControlledCases: 13, controlledLocalModelRequests: 78, paidModelRequests: 0,
      configuredDisplayCombinations: 12,
      screenshotQualification: "Cropped workbench images; no new full-viewport PNG/DPR certification",
      buildCommandOrigin: "NOT_PROVEN", unpackagedSourceModules: payload.unpackagedSourceModules,
      qualifier: "Current binary/source equality and controlled behavior only, not build origin/Release/live model",
    };
    const dataUrlReceipt = receipts.find(r => r.id === "DATAURL")?.data;
    if (dataUrlReceipt) {
      assert.equal(dataUrlReceipt.backend.sha256, payload.sha256);
      assert.equal(dataUrlReceipt.status, "SOURCE_AND_DEV_PASS");
      assert.equal(dataUrlReceipt.checks.length, 7);
      assert(dataUrlReceipt.checks.every(c => c.status === "PASS"));
      const builds = dataUrlReceipt.commands.filter(c =>
        c.command?.some(arg => /build-backend-sidecar\.ps1$/i.test(arg)));
      assert.equal(builds.length, 1); assert.equal(builds[0].exitCode, 0);
      assert.equal(builds[0].status, "PASS");
      assert(builds[0].command.includes("-KeepPyInstallerArtifacts"));
      const sidecarBehavior = read("F:/AgentVN/QA/Data-URL-Repair-20261020-01/sidecar-01/report.json");
      assert.equal(sidecarBehavior.status, "PASS");
      assert.equal(sidecarBehavior.executable.sha256, payload.sha256);
      assert(builds[0].finishedAt <= sidecarBehavior.at);
      report.backendRevalidation.buildCommandOrigin = "RECORDED_OFFICIAL_BUILD";
      report.backendRevalidation.build = { command: builds[0].command, log: builds[0].log };
      report.backendRevalidation.dataUrlSidecarBehavior = await describe(
        "F:/AgentVN/QA/Data-URL-Repair-20261020-01/sidecar-01/report.json");
      report.backendRevalidation.qualifier =
        "Current binary/source equality, separately rerun controlled protocol and recorded official build; not installed acceptance, live model or third-party dependency byte certification";
    }
    await checked(protocol.products.sidecar.path, payload.sha256,
      "current backend independently revalidated; old backend report not substituted", report.artifactChecks);
  } else {
    await checked(protocol.products.sidecar.path, protocol.products.sidecar.sha256,
      "controlled-tested packaged backend", report.artifactChecks);
  }
  const portrait = receipts.find(r => r.id === "DIALOG-PORTRAIT").data;
  for (const [label, entry] of [["frozen installed Editor", portrait.frozen],
    ["frozen installed Player", portrait.frozenPlayer]])
    await checked(entry.path, entry.sha256, label, report.artifactChecks);
  const frozenBackendPath = path.join(path.dirname(portrait.frozen.path), "creator-backend.exe");
  await checked(frozenBackendPath, "db44bd510997a73aee80ba5419d0c9c55e6f73f9a01ad65003915ea089eb5155",
    "frozen installed backend", report.artifactChecks);
  const latestCompiled = latest.compiled || latest.compiledResources || latest.compiledStyle;
  assert(Array.isArray(latestCompiled) && latestCompiled.length > 0, "Latest build receipt needs compiled artifact samples");
  for (const entry of latestCompiled)
    await checked(entry.path || entry.file, entry.sha256, "latest build sampled compiled resources", report.artifactChecks);
  report.compiledCoverage = "Latest product build receipt samples; not a certification of every dist file";
  const config = read(path.join(root, "editor/src-tauri/tauri.conf.json"));
  assert.equal(config.bundle.resources["bundle-workspace/build-versions.json"], "build-versions.json");
  const versions = read(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json"));
  assert.equal(versions.editorVersion, config.version);
  const helpers = read(path.join(root, "scripts/standalone-build-scripts.json")).scripts;
  assert(helpers.length > 0 && new Set(helpers).size === helpers.length);
  for (const name of helpers) await checked(
    path.join(root, "editor/src-tauri/bundle-workspace/scripts", name),
    (await describe(path.join(root, "scripts", name))).sha256,
    "bundled build helper", report.bundledChecks);
  report.versionResource = { version: config.version, mapping: "build-versions.json",
    actual: await describe(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json")) };
  const historicalFile = path.join(root, "output/full-regression-stage-summary-20261019-12/evidence-receipt.json");
  const historical = read(historicalFile);
  report.historical = { file: await describe(historicalFile),
    counts: checkHistoricalGroups(historical.groups), groups: historical.groups,
    extraRequirements: historical.extraRequirements };
  report.releaseStatus = "NOT_BUILT_OR_INSTALLED_WITH_ALL_REPAIRS";
  report.blockers = [
    { id: "NATIVE_INPUT_PIPE", status: "BLOCKED",
      detail: "Last read-only initialization and fresh-kernel retry both returned native pipe missing/os error 2; no desktop input." },
    { id: "LIVE_MODEL_RETRY", status: "BLOCKED",
      detail: "Protocol repair only controlled-tested. Two prior paid tasks failed; no extra paid retry without explicit approval. Novel live-model task NOT_RUN." },
    { id: "OLD_GAME_UPGRADE_SAMPLES", status: "BLOCKED",
      detail: "Traceable standalone Windows setup/portable and valid old signed APK chain missing; no fake-old rebuild." },
    { id: "INDEPENDENT_MACHINE", status: "BLOCKED",
      detail: "Host installation does not prove no development-directory dependence." },
    { id: "OPACITY-02", status: "BLOCKED",
      detail: "Explicit 0.5 double application observed. Background-only versus whole-area semantics await user decision; inherited-display fix does not fix this." },
    { id: "ANIMATION-ASSET-JSON", status: "BLOCKED",
      detail: "Dedicated JSON schema/Runtime consumption contract remains undecided; observed default animation does not prove asset decoding." },
  ];
  assert(report.sourceChecks.length && report.evidenceChecks.length && report.bundledChecks.length);
  report.provenanceStatus = report.errors.length ? "FAILED" : "PASS";
})().catch(error => {
  report.errors.push({ error: String(error.stack || error) }); report.provenanceStatus = "FAILED";
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(destination, "audit.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  const rows = report.receipts.map(r => `| ${r.id} | ${r.originalStatus} | NOT_RUN |`).join("\n");
  const groups = report.historical?.groups.map(g =>
    `| ${g.id} | ${g.requirement} | ${g.status} |`).join("\n") || "";
  const text = `# 修复候选整合前置核对\n\n日期：${report.finishedAt}。来源核对 **${report.provenanceStatus}**；整体回测 **BLOCKED**。\n\n`
    + `本核对程序只读检查当前文件和引用证据，不重跑历史矩阵。`
    + `本次关联既有对当前相同SHA后台的独立受控回归，没有重跑或收费调用；不是新安装版或真实模型通过。\n`
    + `核对${report.receipts.length}份修复/补证回执、${report.sourceChecks.length}份不同来源文件、`
    + `${report.evidenceChecks.length}个带哈希报告/日志引用、${report.bundledChecks.length}项bundled依赖、`
    + `${report.artifactChecks.length}项构建/冻结产物。另核QA异步等待修复回执，不计为产品功能通过。错误${report.errors.length}项，详见audit.json。\n\n`
    + `## 已修或已补源码证据，仍须新安装版验证\n\n| 修复/核验块 | 原限定回执 | 本轮新安装验证 |\n| --- | --- | --- |\n${rows}\n\n`
    + `重叠文件只使用**最后一份已声明回执**核对当前SHA；先前SHA及来源保留在sourceChecks.previous，`
    + `不将后续已声明修改误报为证据损坏，也不允许无回执的漂移。\n\n`
    + `本次提取同时覆盖显式顶层来源与resources中的bundled/frontendSources/backendSources，`
    + `同一回执的相同文件矛盾SHA必须失败；不会递归把历史报告或编译产物当产品源码。\n\n`
    + (report.backendRevalidation ? `## 当前后台差异与独立补验\n\n`
      + `当前后台SHA为${report.backendRevalidation.currentSha256}，不再是旧协议片测试的${report.backendRevalidation.formerTestedSha256}。`
      + `旧回执与第一次整合FAILED保持。当前二进制另经13项受控浏览器回归（12配置组合＋重载接续）通过，`
      + `78次本机模型请求、收费0；包内71个应用模块＋启动器与当前源码代码对象相等。`
      + `五个未打入包的源码模块另列，不宣称其已分发；第三方依赖字节未认证。后台构建来源：${report.backendRevalidation.buildCommandOrigin}。`
      + (report.backendRevalidation.buildCommandOrigin === "RECORDED_OFFICIAL_BUILD"
        ? `DATAURL修复另有官方重建命令、依赖安装日志和实际EXE导入/422/重启证据；本次78次受控请求只引用新后台独立补验。`
        : `未证明原重建命令来源。`)
      + `这不是安装版或真实DeepSeek通过，也不是完整视口PNG/DPR新认证。\n\n` : "")
    + `## 冻结安装候选完整账本（历史结论保持）\n\n| ID | 约定范围 | 冻结安装结论 |\n| --- | --- | --- |\n${groups}\n\n`
    + `完整18组仍3 PASS / 9 FAILED / 6 BLOCKED。这不是新候选通过率。`
    + `Dev、独立no-bundle宿主及源码浏览器证据不能替代新NSIS/MSI安装、默认数据库/覆盖升级、Windows/Android独立包验收。\n\n`
    + `## 未解除条件\n\n${(report.blockers || []).map(b => `- ${b.id}：${b.status}。${b.detail}`).join("\n")}\n\n`
    + `## 下一执行顺序\n\n`
    + `1. 继续核当前组合候选可独立执行的回归；发现错误保留现场，不放宽断言。\n`
    + `2. 角色几何、官方GUI消费及头像位置作者功能已有独立源码/Dev回执；未完成的完整作者/NVL/气泡、素材与工程包目录安装版流程等仍按原账本，不以本次来源核对销项。\n`
    + `3. 相关门槛通过后单独构建新正式候选，保留冻结1.9.9原包与历史失败；实际安装、双平台和升级另立证据。\n`
    + `4. 全部前置闭环后才使用“隐忍的成长”隔离副本做最终综合验收。\n\n`
    + `本核对程序产品修改0、编译0、模型请求0、设备操作0；关联本次后台回归为`
    + `${report.backendRevalidation?.controlledLocalModelRequests || 0}次本机受控模型请求，新增收费请求0。未新听辨，音频沿用用户确认；`
    + `旧手机与首开性能仍DEFERRED_BY_USER。本报告不触碰用户数据库、工程、旧profile或历史报告。\n`;
  fs.writeFileSync(path.join(destination, "REPORT.md"), text, { flag: "wx" });
  console.log(JSON.stringify({ provenanceStatus: report.provenanceStatus, acceptanceStatus: report.acceptanceStatus,
    receipts: report.receipts.length, sources: report.sourceChecks.length,
    references: report.evidenceChecks.length, bundled: report.bundledChecks.length,
    artifacts: report.artifactChecks.length, errors: report.errors.length,
    report: path.join(destination, "REPORT.md") }));
  process.exitCode = report.provenanceStatus === "PASS" ? 0 : 1;
});
