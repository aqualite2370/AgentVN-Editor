"use strict";
// Native file chooser supplement only. Computer Use supplies actual input;
// no setInputFiles, chooser interception, model requests or product changes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor, assetBytes } = require("./lib/installed-acceptance.cjs");
const { until, rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
function receipt(value, request) {
  assert.equal(value.status, "INPUT_COMPLETED");
  for (const key of ["requestId", "ownerPid", "kind", "selectedPath"]) assert.equal(value[key], request[key]);
  assert.equal(value.interaction, "COMPUTER_USE_SKY_NATIVE_DIALOG");
  assert(Number.isInteger(value.window?.id) && value.window.id > 0);
  assert.match(value.window.app, /agentvn-editor\.exe|msedgewebview2\.exe/i);
  assert.equal(typeof value.window.title, "string");
  assert(value.completedAt && Number.isFinite(Date.parse(value.completedAt)));
  assert(Date.parse(value.completedAt) <= Date.now(), "Do not accept unverified future input times");
  if (request.startedAt) assert(Date.parse(value.completedAt) >= Date.parse(request.startedAt));
  return value;
}
if (process.argv[2] === "--self-test") {
  const request = { requestId: "native-test", ownerPid: 1234, kind: "SELECT", selectedPath: "F:\\QA\\中文.png" };
  const good = { ...request, status: "INPUT_COMPLETED", interaction: "COMPUTER_USE_SKY_NATIVE_DIALOG",
    window: { id: 3456, app: "process:F:\\QA\\agentvn-editor.exe", title: "打开" },
    completedAt: new Date().toISOString() };
  receipt(good, request);
  const bad = [{ status: "PASS" }, { requestId: "stale" }, { ownerPid: 5678 }, { kind: "CANCEL" },
    { selectedPath: "C:\\user.png" }, { interaction: "SET_INPUT_FILES" }, { window: { id: 0 } },
    { window: { id: 1, app: "unrelated.exe", title: "打开" } }, { completedAt: "invalid" },
    { completedAt: "2100-01-01T00:00:00Z" }];
  for (const patch of bad) assert.throws(() => receipt({ ...good, ...patch }, request));
  console.log(JSON.stringify({ status: "PASS", invalidReceiptsRejected: bad.length,
    scope: "NATIVE_RECEIPT_VALIDATION_ONLY", productLaunches: 0 }));
  return;
}
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const args = process.argv.slice(2), configArgs = args.filter(a => a.startsWith("--candidate-config="));
assert(configArgs.length <= 1);
const config = configArgs.length ? validateCandidateConfig(read(configArgs[0].slice(19))) : null;
const attempt = config ? args[0] : "08", sourceAttempt = config ? args[1] : "06";
assert.match(attempt, /^\d{2}$/); assert.match(sourceAttempt, /^\d{2}$/);
assert.deepEqual(args, config ? [attempt, sourceAttempt, configArgs[0]] : ["08"]);
const root = path.resolve(__dirname, ".."), out = `F:/AgentVN/QA/Installed-Assets-20261021-01/editor-${attempt}`;
const installationFile = config ? path.join(config.qa, `assets-preparation-${sourceAttempt}/derived-installed.json`) :
  "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const sourceFile = `F:/AgentVN/QA/Installed-Assets-20261021-01/editor-${sourceAttempt}/report.json`;
const source = read(sourceFile), installation = read(installationFile);
assert.equal(source.status, "PASS"); assert.equal(installation.status, "PASS");
if (config) {
  const actual = deriveActual(config.actual, config.version);
  assert.deepEqual(installation.actualInstallation, config.actual);
  assert.deepEqual(installation.executable, actual.executable);
  assert.deepEqual(source.installation.path, installationFile);
  assert.equal(source.version, config.version);
  for (const f of installation.protectedAbsent) assert(!fs.existsSync(f), f);
} else assert.equal(installation.executable.version, "1.9.24");
assert.equal(source.executable.sha256, installation.executable.sha256);
assert.equal(sha(source.fixture.path), source.fixture.sha256);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const checkpoint = config ? `F:/AgentVN/Checkpoints/Installed-Assets-Native-${config.version}-${attempt}` :
  "F:/AgentVN/Checkpoints/Installed-Assets-1924-Native-20261025-02";
assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);
const snapshots = [];
for (const name of ["scripts/candidate-1924-assets-native.cjs", "scripts/lib/installed-release-session.cjs",
  "scripts/installed-layout-cache-session.ps1", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
  const from = path.join(root, name), to = path.join(checkpoint, path.basename(name));
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); assert.equal(sha(from), sha(to));
  snapshots.push({ source: desc(from), copy: desc(to) });
}
const project = read(source.fixture.path);
project.project_id = `installed-assets-native-${config?.version ?? "1924"}-${attempt}`;
project.title = "原生选择素材替换隔离工程";
const input = path.join(out, "原生选择素材替换.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const original = source.fixtureMedia.find(a => a.type === "background");
assert.equal(original.mime, "image/svg+xml");
assert.equal(path.extname(original.files.new.path), ".svg");
const selectedPath = path.join(out, "中文 替换背景.svg");
assert.equal(sha(original.files.new.path), original.files.new.sha256);
fs.copyFileSync(original.files.new.path, selectedPath, fs.constants.COPYFILE_EXCL);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: `ACTUAL_INSTALLED_${config?.version ?? "1924"}_NATIVE_ASSET_PICKER_CANCEL_SELECT_CONFIRM_NOT_DISPLAY_MATRIX`,
  source: desc(sourceFile), installation: desc(installationFile), input: desc(input),
  selectedFile: desc(selectedPath), snapshots, cases: [], launches: [], cleanups: [], screenshots: [],
  errors: [], requests: [], modelRequests: 0, builds: 0, productChanges: 0,
  limitations: ["1080p DPR1 normal supplement, not a new display matrix",
    "Public import API setup, not native project picker", "Attributed termination, not normal close",
    "Export and Player results belong to separate editor06/player06 evidence"] };
if (config) {
  report.currentCandidateBinding = { actualInstallation: config.actual, version: config.version };
  report.limitations[3] = `Export and Player results are separate editor-${sourceAttempt} evidence`;
}
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedReleaseSession({ installationFile, out, input, report, save });
let page, protectedCache = false;
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/installed-layout-cache-session.ps1", "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { cwd: root, windowsHide: true, encoding: "utf8", timeout: 45000 });
  (report.cache ??= []).push({ action, code: r.status, stdout: r.stdout, stderr: r.stderr }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function snapshot() {
  const state = await page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), g = window.__AGENTVN_EDITOR_STORE__.getState();
    return { id: p.projectId, assets: p.assetManifest, folders: p.settings.assetLibrary,
      nodes: g.nodes.map(({ selected, measured, dragging, ...n }) => n),
      edges: g.edges.map(({ selected, ...e }) => e) };
  });
  const bytes = [];
  for (const a of state.assets) bytes.push({ id: a.asset_id, sha256: hash(await assetBytes(host.current.ports[0], a)) });
  return { state, bytes };
}
async function step(name, fn) {
  const c = { name, status: "RUNNING" }; report.cases.push(c); save();
  try { c.detail = await fn(); c.status = "PASS"; console.log("PASS " + name); }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { c.finishedAt = new Date().toISOString(); save(); }
}
async function picker(kind) {
  const request = { requestId: crypto.randomUUID(), ownerPid: host.current.pid, kind, startedAt: new Date().toISOString(),
    selectedPath: kind === "SELECT" ? selectedPath : null,
    completion: path.join(out, `native-${kind.toLowerCase()}-completed.json`) };
  report.requests.push(request);
  fs.writeFileSync(path.join(out, `native-${kind.toLowerCase()}-request.json`), JSON.stringify(request, null, 2), { flag: "wx" });
  save();
  const card = page.locator('.asset-library-card[data-asset-id="qa_background"]');
  await card.scrollIntoViewIfNeeded(); await card.locator('[data-help-key="asset.card.menu"]').click();
  await card.getByRole("menuitem", { name: "替换文件", exact: true }).click();
  console.log(JSON.stringify({ stage: "ASSET_NATIVE_PICKER", request }));
  await until(() => fs.existsSync(request.completion), `Computer Use asset ${kind}`, 600000);
  const completed = receipt(read(request.completion), request);
  return { request, completed, receipt: desc(request.completion) };
}
(async () => {
  report.protectedFiles = installation.protectedFiles;
  for (const f of [installation.executable, ...installation.resources, ...report.protectedFiles])
    assert.equal(sha(f.path), f.sha256);
  cache("SelfTest"); protectedCache = true; cache("Prepare");
  page = await host.start();
  const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
    body: fs.readFileSync(input), signal: AbortSignal.timeout(30000) });
  assert(response.ok && (await response.json()).ok);
  await page.reload(); await page.locator(".recent-project-open").filter({ hasText: project.title }).click();
  await settleEditor(page); await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.library"]:visible').click(); await settleEditor(page);
  await page.getByRole("button", { name: /原文件夹/ }).first().click();
  await page.locator('.asset-library-card[data-asset-id="qa_background"]').waitFor();
  const before = await snapshot(); report.before = before; save();
  const dialog = page.getByRole("dialog", { name: "确认替换素材" });
  await step("Native chooser cancellation leaves all eleven assets and graph unchanged", async () => {
    const native = await picker("CANCEL");
    assert.equal(await dialog.count(), 0); assert.deepEqual(await snapshot(), before);
    await host.shot("native-cancel-return"); return native;
  });
  await step("Native Chinese path selection reaches confirmation without premature mutation", async () => {
    const native = await picker("SELECT"); await dialog.waitFor();
    await dialog.getByRole("button", { name: "确认替换", exact: true }).click({ trial: true });
    assert((await dialog.innerText()).includes(path.basename(selectedPath)));
    assert((await dialog.innerText()).includes("授权和生成来源说明不会沿用"));
    assert.deepEqual(await snapshot(), before); await host.shot("native-selection-confirmation");
    return native;
  });
  await step("Confirm updates real selected bytes, keeps identity references folders and other assets", async () => {
    await dialog.getByRole("button", { name: "确认替换", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); const after = await snapshot();
    const a = after.state.assets.find(a => a.asset_id === original.id);
    assert.equal(a.asset_type, "background"); assert.equal(a.metadata.display_name, "background保留名称");
    assert.equal(a.metadata.filename, path.basename(selectedPath));
    assert.deepEqual([a.metadata.width, a.metadata.height], [900, 600]);
    assert.equal(after.bytes.find(a => a.id === original.id).sha256, original.files.new.sha256);
    for (const key of ["id", "folders", "nodes", "edges"]) assert.deepEqual(after.state[key], before.state[key]);
    assert.deepEqual(after.state.assets.filter(a => a.asset_id !== original.id), before.state.assets.filter(a => a.asset_id !== original.id));
    assert.deepEqual(after.bytes.filter(a => a.id !== original.id), before.bytes.filter(a => a.id !== original.id));
    assert.notEqual(original.files.old.sha256, original.files.new.sha256);
    report.after = after; save(); await host.shot("native-replacement-complete");
    return { changedAsset: original.id, newBytes: desc(selectedPath), otherAssetsUnchanged: 10 };
  });
  assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureText = await page.locator("body").innerText().catch(String);
    await host.shot("failure").catch(e => { report.captureError = String(e); });
  }
}).finally(async () => {
  try {
    await host.stop("Native picker supplement complete, not normal close");
    if (protectedCache) cache("Restore");
    const restored = read(path.join(out, "native-cache-restoration.json"));
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    report.cacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
    for (const f of [report.source, report.installation, report.input, report.selectedFile,
      installation.executable, ...installation.resources, ...report.protectedFiles]) assert.equal(sha(f.path), f.sha256);
    for (const f of installation.protectedAbsent || []) assert(!fs.existsSync(f), f);
    const active = rows(), identity = p => `${p.ProcessId}:${p.Created}`;
    assert(!active.some(p => report.knownProcesses.some(k => identity(p) === identity(k))));
    report.cleanupPorts = [...new Set(report.launches.flatMap(l => l.ports))];
    assert.deepEqual(listeners(report.cleanupPorts), []);
    report.protectedUnchanged = true;
    if (report.status === "PASS") {
      assert.equal(report.cases.length, 3); assert(report.cases.every(c => c.status === "PASS"));
      assert.equal(report.screenshots.length, 3);
      for (const s of report.screenshots) {
        assert.equal(sha(s.path), s.sha256); validateNativeViewport(s.before, s.after);
        const png = fs.readFileSync(s.path);
        assert.equal(png.readUInt32BE(16), s.before.width * s.before.dpr);
        assert.equal(png.readUInt32BE(20), s.before.height * s.before.dpr);
      }
      const journal = read(path.join(out, "native-cache-protection.json"));
      if (journal.existed) {
        assert.equal(restored.originalDirectoryId, journal.directoryId); assert(!fs.existsSync(journal.held));
        assert(ps(`fsutil.exe file queryfileid '${journal.original.replace(/'/g, "''")}'`).toLowerCase().includes(journal.directoryId.toLowerCase()));
        for (const f of journal.files) assert.equal(sha(path.join(journal.original, f.relative)), f.sha256);
      }
    }
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
