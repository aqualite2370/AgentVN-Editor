"use strict";
// Regression for the historical same-executable/same-preview-root overbroad close.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { rows, listeners, until, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01";
const work = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-02";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(work, `ownership-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const sourceFile = path.join(work, "installed-01/report.json"), source = read(sourceFile); assert.equal(source.status, "PASS");
assert.equal(sha(source.input.path), source.input.sha256); const project = read(source.input.path);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), steps: [], launches: [], cleanups: [], screenshots: [],
  errors: [], modelRequests: 0, scope: "NSIS_INSTALLED_PREVIEW_CLOSE_MUST_PRESERVE_INDEPENDENT_IDENTICAL_PLAYER",
  source: desc(sourceFile), input: source.input, version: "1.9.14", protectedFiles: source.protectedFiles };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const identity = p => `${p.ProcessId}:${p.Created}`;
const freePort = () => new Promise(resolve => { const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
let host, page, sentinel, sentinelBrowser, ownBrowser, protectedProfile = false;
const known = new Map();
function remember() {
  const all = rows();
  if (host?.current) for (const p of ownedProcessTree(all, host.current.pid, host.current.created)) known.set(identity(p), p);
  if (sentinel) for (const p of ownedProcessTree(all, sentinel.pid, report.sentinel?.process?.Created)) known.set(identity(p), p);
  report.observedProcesses = [...known.values()]; save(); return all;
}
function profile(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), (r.stdout || "") + (r.stderr || ""), { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function step(label, fn) {
  const r = { label, status: "RUNNING" }; report.steps.push(r); save(); console.log(`START ${label}`);
  try { r.result = await fn(); r.status = "PASS"; console.log(`PASS ${label}`); }
  catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); throw e; } finally { save(); }
}
async function connect(port) {
  await until(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, "specific owned Player CDP", 45000);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())); assert(page);
  page.setDefaultTimeout(30000); page.on("pageerror", e => { report.errors.push(String(e)); save(); });
  await page.getByTestId("start-new-game").waitFor(); await settleRuntime(page); return { browser, page };
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  report.tools = ["scripts/lib/installed-release-session.cjs", "scripts/native-dev-preview-profile.ps1"].map(f => desc(path.join(root, f)));
  for (const f of source.protectedFiles) assert.equal(sha(f.path), f.sha256);
  const port = await freePort(), controlPort = await freePort(); assert.notEqual(port, controlPort); report.ports = [port, controlPort];
  assert.equal(listeners(report.ports).length, 0);
  protectedProfile = true; profile("Prepare");
  host = installedReleaseSession({ installationFile: path.join(qa, "installation.json"), out, report, save,
    input: source.input.path, previewPort: port });
  await step("Actual installed top preview creates one owned Player", async () => {
    page = await host.start();
    const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(source.input.path)) },
      body: fs.readFileSync(source.input.path) });
    const payload = await r.json(); assert(r.ok && payload.ok); await page.reload();
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }).click(); await settleEditor(page);
    await page.locator('[data-workspace-surface="preview"]:visible').click(); await settleEditor(page);
    await page.getByTestId("preview-window-status").filter({ hasText: "已关闭" }).waitFor();
    await page.locator('[data-help-key="preview.open"]:visible').click();
    await page.getByTestId("preview-window-status").filter({ hasText: "运行中" }).waitFor({ timeout: 60000 });
    const player = remember().find(p => p.Name === "agentvn-player.exe" && p.ParentProcessId === host.current.pid); assert(player);
    assert.equal(sha(player.ExecutablePath), source.player.sha256);
    const match = player.CommandLine.match(/--preview-root\s+(?:"([^"]+)"|(\S+))/); assert(match);
    report.owned = { process: player, previewRoot: match[1] || match[2], executable: desc(player.ExecutablePath) }; save();
    const own = await connect(port); ownBrowser = own.browser; remember();
    return report.owned;
  });
  let controlPage;
  await step("QA starts a distinct real Player with identical executable and preview root", async () => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
    Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "independent-player-webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${controlPort}`,
      AGENTVN_TEST_PROJECT: source.input.path, AGENTVN_WORKSPACE_OUTPUT: out });
    const fd = fs.openSync(path.join(out, "independent-player.log"), "wx");
    sentinel = spawn(report.owned.process.ExecutablePath, ["--mode", "preview", "--preview-root", report.owned.previewRoot],
      { cwd: path.dirname(report.owned.process.ExecutablePath), env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
    const control = await connect(controlPort); sentinelBrowser = control.browser; controlPage = control.page;
    const proc = remember().find(p => p.ProcessId === sentinel.pid); assert(proc);
    assert.notEqual(proc.ParentProcessId, host.current.pid);
    assert.equal(path.resolve(proc.ExecutablePath), path.resolve(report.owned.process.ExecutablePath));
    assert(proc.CommandLine.includes(report.owned.previewRoot));
    report.sentinel = { process: proc, previewRoot: report.owned.previewRoot, executable: desc(proc.ExecutablePath), port: controlPort };
    remember();
    assert.equal(rows().filter(p => p.Name === "agentvn-player.exe").length, 2);
    return report.sentinel;
  });
  await step("Real Editor close stops only its own Player; identical independent Player still plays", async () => {
    await page.locator('[data-help-key="preview.close"]:visible').click();
    await page.getByTestId("preview-window-status").filter({ hasText: "已关闭" }).waitFor();
    await ownBrowser.close().catch(() => {}); ownBrowser = undefined;
    await until(() => !rows().some(p => identity(p) === identity(report.owned.process)) && listeners([port]).length === 0,
      "owned Player closes", 15000);
    const all = remember(); assert(all.some(p => identity(p) === identity(report.sentinel.process))); assert.equal(sentinel.exitCode, null);
    await controlPage.getByTestId("start-new-game").click(); await settleRuntime(controlPage);
    await controlPage.locator(".dialog-text").filter({ hasText: "INSTALLED_PREVIEW_FIRST" }).waitFor();
    await controlPage.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
    await controlPage.locator(".dialog-box").click();
    await controlPage.locator(".dialog-text").filter({ hasText: "INSTALLED_PREVIEW_SECOND" }).waitFor();
    assert((await controlPage.locator(".dialog-text").innerText()).includes("INSTALLED_PREVIEW_SECOND"));
    assert(listeners([controlPort]).some(l => known.has(identity(all.find(p => p.ProcessId === l.OwningProcess) || {}))));
    await host.shot("owned-preview-closed-independent-player-alive");
    return { ownedClosed: identity(report.owned.process), independentAlive: identity(report.sentinel.process),
      sameExecutableAndRoot: true, actualIndependentStoryAdvance: true };
  });
  assert.equal(report.steps.length, 3); assert(report.steps.every(s => s.status === "PASS"));
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) report.failureDOM = await page.locator("body").innerText().catch(String);
}).finally(async () => {
  try {
    remember(); await sentinelBrowser?.close().catch(() => {}); await ownBrowser?.close().catch(() => {});
    // Identity-qualified cleanup of the independent QA process, not a normal close claim.
    const independent = sentinel ? ownedProcessTree(rows(), sentinel.pid, report.sentinel?.process?.Created) : [];
    for (const p of independent) known.set(identity(p), p);
    for (const p of independent.reverse()) ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
      `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
    await host?.stop("End installed ownership regression; QA termination not normal close");
    await until(() => !rows().some(p => known.has(identity(p))) && listeners(report.ports || []).length === 0, "all ownership QA cleanup", 15000);
    report.observedProcesses = [...known.values()];
    if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profile("Restore"); report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.profileRestoration.path).status, "PASS");
    }
    for (const f of source.protectedFiles) assert.equal(sha(f.path), f.sha256);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
