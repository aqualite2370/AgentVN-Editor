"use strict";
// Actual installed Player consumes this block's two exact UI exports.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright"), JSZip = require("../editor/node_modules/jszip");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { captureInstalledWebview, validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { portraitObservation, verifyPortrait, verifyCustom } = require("./lib/portrait-installed-observation.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Portrait-20261021-01";
const editorAttempt = process.argv[2] || "01", attempt = process.argv[3] || "01";
assert.match(editorAttempt, /^\d{2}$/); assert.match(attempt, /^\d{2}$/);
const dialogRelease = process.argv[4] === "--dialog-release";
assert(process.argv.length <= (dialogRelease ? 5 : 4), "Unknown test argument");
const releaseQa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size, generatedAt: fs.statSync(f).mtime.toISOString() });
const sourceFile = path.join(qa, `editor-${editorAttempt}/report.json`), source = read(sourceFile);
if (dialogRelease) {
  const pointer = read(path.join(releaseQa, `installed-flow-${editorAttempt}.json`));
  assert.equal(pointer.status, "PASS"); assert.equal(path.resolve(pointer.report.path), path.resolve(sourceFile));
  assert.equal(sha(sourceFile), pointer.report.sha256);
  assert.equal(source.status, "PASS"); assert.equal(source.version, "1.9.14");
  assert.equal(source.steps.length, 5); assert.equal(source.cases.length, 4);
  assert(source.cases.every(c => c.status === "PASS" && c.samples.length === 30));
} else {
  assert(["EDITOR_PASS_PLAYER_NOT_RUN", "FAILED"].includes(source.status)); assert.equal(source.steps.length, 6);
  assert.equal(source.matrix.length, 12);
}
if (source.status === "FAILED") {
  assert(source.errors.length > 0 && source.errors.every(e => e.includes("Minified React error #185")));
  assert.match(source.error, /deep-equal/);
}
assert(source.steps.every(s => s.status === "PASS"));
assert.equal(source.cartridges.length, 2); assert.equal(source.cleanupError, undefined);
const prep = read(path.join(qa, "preparation.json"));
const installation = read(dialogRelease ? path.join(releaseQa, "installation.json")
  : "F:/AgentVN/QA/Installed-Candidate-20261021-01/installation.json");
assert.equal(installation.status, "PASS"); const exe = path.join(installation.installRoot, "agentvn-player.exe");
const protectedFiles = dialogRelease ? [
  ...read(path.join(releaseQa, "checkpoint-01/report.json")).frozen,
  ...installation.resources, installation.executable, desc(path.join(root, "AgentVN Dev.exe")),
] : prep.immutable;
if (dialogRelease) {
  assert.equal(installation.executable.version, source.version);
  assert.equal(sha(exe), installation.resources.find(f => path.resolve(f.path) === path.resolve(exe)).sha256);
} else assert.equal(sha(exe), prep.immutable.find(f => path.resolve(f.path) === path.resolve(exe)).sha256);
for (const f of protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/${dialogRelease
  ? "installed-dialog-release" : "installed-portrait-current"}-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(sourceFile),
  sourceAuthorStatus: source.status, sourceRenderErrorsStillOpen: source.errors,
  executable: desc(exe), cases: [], launches: [], screenshots: [], cleanups: [], errors: [], modelRequests: 0,
  scope: "NSIS_INSTALLED_EDITOR_REAL_PORTRAIT_UI_EXPORT_AND_SAME_INSTALLED_PLAYER_PREVIEW",
  notProven: ["Windows standalone/setup", "Android", "Upgrade", "Native picker or normal close", "Physical 4K", "Full motion audit"] };
report.version = source.version ?? "1.9.13";
report.protectedFiles = protectedFiles;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const known = new Map(), identity = p => `${p.ProcessId}:${p.Created}`;
let player, current, browser, page, cdp, protectedProfile = false;
function profiles(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
function remember() {
  if (player) {
    const tree = ownedProcessTree(rows(), player.pid, current.created);
    if (tree.length) current.created = tree[0].Created;
    for (const p of tree) known.set(identity(p), p);
  }
  report.knownProcesses = [...known.values()]; save();
}
async function stop() {
  if (!player) return;
  remember(); await browser?.close().catch(() => {}); browser = undefined;
  const killed = [];
  for (const p of [...known.values()].reverse()) {
    if (!rows().some(r => identity(r) === identity(p))) continue;
    ps(`$owned=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
      `if($owned -and $owned.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
    killed.push(identity(p));
  }
  await until(() => !rows().some(p => known.has(identity(p))) && listeners([current.port]).length === 0,
    "owned installed portrait Player cleanup", 15000);
  report.cleanups.push({ status: "PASS", killed, port: current.port, normalCloseClaimed: false }); player = undefined; save();
}
async function ready(screen) {
  await page.waitForFunction(screen => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") === screen
      && n?.getAttribute("data-runtime-screen-transition") === "idle" && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, screen); await settleRuntime(page);
}
async function start(cartridge) {
  assert(!player && !rows().some(p => p.Name === "agentvn-player.exe"));
  const port = await new Promise(resolve => {
    const server = net.createServer(); server.listen(0, "127.0.0.1", () => {
      const p = server.address().port; server.close(() => resolve(p));
    });
  });
  assert.equal(listeners([port]).length, 0);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, `webview-${cartridge.type}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_TEST_PROJECT: source.portable.path, AGENTVN_WORKSPACE_OUTPUT: out });
  const fd = fs.openSync(path.join(out, `player-${cartridge.type}.log`), "wx");
  player = spawn(exe, ["--mode", "preview", "--cartridge", cartridge.path],
    { cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
  current = { pid: player.pid, port, at: new Date().toISOString(), executable: desc(exe),
    args: ["--mode", "preview", "--cartridge", cartridge.path],
    environment: { AGENTVN_TEST_PROJECT: source.portable.path, AGENTVN_WORKSPACE_OUTPUT: out } };
  report.launches.push(current); remember();
  await until(async () => {
    assert.equal(player.exitCode, null); remember();
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, "actual installed portrait Player WebView", 60000);
  const tree = ownedProcessTree(rows(), player.pid, current.created);
  assert(listeners([port]).every(l => tree.some(p => p.ProcessId === l.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())), "Player page");
  page.setDefaultTimeout(30000); page.on("pageerror", e => { report.errors.push(String(e)); save(); });
  cdp = await page.context().newCDPSession(page);
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
  protectedProfile = true; profiles("Prepare");
  for (const cartridge of source.cartridges) {
    assert.equal(sha(cartridge.path), cartridge.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path), { checkCRC32: true });
    assert.equal(hash(await zip.file(cartridge.assetPath).async("nodebuffer")), prep.portraitSha256);
    assert.equal(hash(await zip.file("ui/layout.json").async("nodebuffer")), cartridge.layoutSha256);
    await start(cartridge);
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const m = { width, height: width * 9 / 16, dpr, reduced };
      const item = { type: cartridge.type, ...m, status: "RUNNING", checks: [] }; report.cases.push(item); save();
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: m.height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await page.reload(); await page.getByTestId("game-state-title").waitFor(); await ready("title_menu");
      await page.getByTestId("start-new-game").click(); await ready("playing");
      await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent.includes("PORTRAIT_LAYOUT")
        && document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true"
        && document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-command-index") === "0");
      await until(async () => {
        const o = await portraitObservation(page); verifyPortrait(o, prep.portraitSha256); verifyCustom(o, prep.values[cartridge.type]);
        return o;
      }, "authored portrait rendered at exact expected anchor");
      const bound = await portraitObservation(page); verifyPortrait(bound, prep.portraitSha256); verifyCustom(bound, prep.values[cartridge.type]);
      validateNativeViewport(bound.viewport, m); item.bound = bound;
      item.checks.push("exact-author-layout-visible-image-bytes-geometry-and-body-safety");
      if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)
        report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${cartridge.type}-${width}-${dpr}-${reduced}.png`), m));
      await page.locator(".dialog-box").click();
      await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent.includes("PORTRAIT_CONTROL")
        && document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true"
        && document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-command-index") === "1");
      assert.equal(await page.locator(".dialog-portrait").count(), 0);
      const unbound = await page.locator(".dialog-text").evaluate(n => n.getBoundingClientRect().toJSON());
      assert.deepEqual(unbound, bound.body); item.unboundBody = unbound;
      item.checks.push("actual-advance-removes-unbound-portrait-without-body-reflow");
      item.status = "PASS"; save(); console.log(`PASS installed portrait ${cartridge.type}/${width}/${dpr}/${reduced}`);
    }
    await stop();
  }
  assert.equal(report.cases.length, 24); assert(report.cases.every(c => c.status === "PASS" && c.checks.length === 2));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (report.cases.at(-1)?.status === "RUNNING") report.cases.at(-1).status = "FAILED";
  if (page && !page.isClosed()) report.failureDOM = await page.locator("body").innerText().catch(String);
}).finally(async () => {
  try {
    await stop();
    if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profiles("Restore"); report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.profileRestoration.path).status, "PASS");
    }
    for (const f of protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
  } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
