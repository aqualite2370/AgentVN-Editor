"use strict";
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const crypto = require("node:crypto"), assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), [sourceFile, attempt = "01"] = process.argv.slice(2);
assert(sourceFile); assert.match(attempt, /^\d{2}$/);
const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/knowledge-draft-1937-20261102-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const source = read(sourceFile); assert.equal(source.status, "PASS"); assert.equal(source.cleanup, "PASS");
const installation = verifiedInstalledCandidate(source.installation.path);
assert.equal(sha(source.installation.path), source.installation.sha256);
const exe = path.join(installation.installRoot, "agentvn-player.exe");
assert.equal(sha(exe), installation.resources.find(r => path.resolve(r.path) === path.resolve(exe)).sha256);
const input = source.cartridges.at(-1); assert(input); assert.equal(sha(input.path), input.sha256);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_INSTALLED_BUNDLED_PLAYER_CONSUMES_INSTALLED_UI_EXPORT_NOT_STANDALONE_OR_ANDROID",
  source: desc(sourceFile), installation: source.installation, executable: desc(exe), input,
  cases: [], screenshots: [], errors: [], knownProcesses: [], modelRequests: 0,
  limits: ["Public preview launch protocol, not independent setup game or Android",
    "WebView size/DPR emulation, not physical4K", "Attributed process termination, not natural exit",
    "No audio hearing or full storyline verdict"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
let child, browser, page, cdp, port, protectedProfile = false, created;
const known = new Map(), identity = p => `${p.ProcessId}:${p.Created}`;
function remember() {
  if (child) {
    const tree = ownedProcessTree(rows(), child.pid, created);
    if (tree.length) created = tree[0].Created;
    for (const p of tree) known.set(identity(p), p);
    report.knownProcesses = [...known.values()]; save();
  }
}
function profiles(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, "profile-" + action + ".log"),
    (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  assert.equal(result.status, 0, `Profile ${action}: ${result.stdout} ${result.stderr}`);
}
(async () => {
  save();
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
  protectedProfile = true; profiles("Prepare");
  port = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(() => resolve(value)); });
  });
  assert.equal(listeners([port]).length, 0);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(key)) delete env[key];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, AGENTVN_WORKSPACE_OUTPUT: out });
  const fd = fs.openSync(path.join(out, "player.log"), "wx");
  child = spawn(exe, ["--mode", "preview", "--cartridge", input.path],
    { cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
  report.launch = { pid: child.pid, port, executable: desc(exe), input, at: new Date().toISOString() }; remember();
  await until(async () => {
    assert.equal(child.exitCode, null);
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, "actual installed Player", 60000);
  remember();
  const active = rows();
  assert(listeners([port]).every(row => known.has(identity(active.find(p => p.ProcessId === row.OwningProcess)))));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())),
    "actual installed Player document");
  page.setDefaultTimeout(30000); page.on("pageerror", error => report.errors.push(String(error)));
  cdp = await page.context().newCDPSession(page);
  await page.getByTestId("start-new-game").waitFor(); await settleRuntime(page);
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    const display = { width, height: width * 9 / 16, dpr, reduced };
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: display.height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await readInstalledViewport(page, display); await settleRuntime(page);
    const button = page.getByTestId("start-new-game"); await button.focus();
    const actual = await button.evaluate(el => {
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      return { color: style.backgroundColor, slots: el.getAttribute("data-control-slot-count"), focused: document.activeElement === el,
        hit: el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
        rect: rect.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth,
        invalidExecuted: window.__qaDraftExecuted === true };
    });
    assert.equal(actual.color, "rgb(49, 91, 114)"); assert.equal(actual.slots, "1");
    assert(actual.focused && actual.hit && actual.overflow <= 1 && !actual.invalidExecuted);
    assert(actual.rect.left >= 0 && actual.rect.right <= width + 1
      && actual.rect.top >= 0 && actual.rect.bottom <= display.height + 1);
    report.cases.push({ display, status: "PASS", actual });
    if (!reduced && dpr === 2) report.screenshots.push(await captureInstalledWebview(page, cdp,
      path.join(out, "title-" + width + "-dpr2.png"), display));
    save();
  }
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor(); await settleRuntime(page);
  report.nativeContentAction = { status: "PASS", originalStartActionPreserved: true };
  assert.equal(report.cases.length, 12); assert.deepEqual(report.errors, []);
  assert.equal(sha(input.path), input.sha256); assert.equal(sha(exe), report.executable.sha256);
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) report.failureDOM = (await page.locator("body").innerText().catch(String)).slice(-8000);
}).finally(async () => {
  const failures = [];
  try {
    remember(); await browser?.close().catch(() => {});
    for (const p of [...known.values()].reverse()) stopOwnedProcess(p, ps);
    if (child) await until(() => !rows().some(p => known.has(identity(p))) && listeners([port]).length === 0,
      "owned installed Player cleanup", 20000);
  } catch (error) { failures.push(String(error.stack || error)); }
  try {
    if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profiles("Restore"); const file = path.join(out, "profile-restoration.json");
      assert.equal(read(file).status, "PASS"); report.profileRestoration = desc(file);
    }
  } catch (error) { failures.push(String(error.stack || error)); }
  report.cleanup = failures.length ? "FAILED" : "PASS";
  if (failures.length) { report.cleanupErrors = failures; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, cleanup: report.cleanup, error: report.error }));
});
