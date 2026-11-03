"use strict";
// Consume the exact prior UI download in the installed Player, with real inputs.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process"), net = require("node:net");
const { chromium } = require("../editor/node_modules/playwright");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { waitNativeRuntimePage } = require("./lib/wait-native-runtime-page.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const sourceFile = path.join(base, "control-export-review-01/report.json"), source = read(sourceFile);
const installation = read(source.installation.path), exe = path.join(installation.installRoot, "agentvn-player.exe");
assert.equal(source.status, "PASS"); assert.equal(source.playerConsumption, "NOT_RUN");
assert.equal(sha(exe), "6e7f4ec17d8388a99937123f88ddf7cebbe161fac39a19cfe3a3bc849e642168");
assert.equal(sha(source.cartridge.path), source.cartridge.sha256);
assert.equal(installation.status, "PASS");
assert.equal(installation.metadataRestoration, "PASS");
assert.equal(installation.executable.version, "1.9.24");
assert.equal(process.argv[2], "01");
const out = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/control-code-installed-1924-01";
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), scope:
  "INSTALLED_PLAYER_PREVIEW_EXACT_UI_NATIVE_REIMPORTED_CONTROL_EXPORT_NOT_STANDALONE_OR_ANDROID",
  source: desc(sourceFile), installation: source.installation, executable: desc(exe), cartridge: source.cartridge,
  cells: [], screenshots: [], launches: [], cleanups: [], knownProcesses: [], pageErrors: [], commands: [],
  modelRequests: 0, productChanges: 0, builds: 0, normalCloseClaimed: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const identity = p => `${p.ProcessId}:${p.Created}`, known = new Map();
let child, launch, browser, page, cdp, protectedProfiles = false;
let viewport = { width: 1920, height: 1080, dpr: 1, reduced: false };
function profiles(action) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/native-dev-preview-profile.ps1",
    "-Action", action, "-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"];
  const r = spawnSync("powershell.exe", args, { cwd: root, windowsHide: true, encoding: "utf8", timeout: 45000 });
  const log = path.join(out, `profile-${action}.log`);
  fs.writeFileSync(log, r.stdout + r.stderr, { flag: "wx" });
  report.commands.push({ command: ["powershell.exe", ...args], exitCode: r.status, log }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
function remember() {
  if (!child) return;
  for (const p of ownedProcessTree(rows(), child.pid, launch.created)) known.set(identity(p), p);
  report.knownProcesses = [...known.values()]; save();
}
async function ready(screen) {
  await page.waitForFunction(s => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") === s &&
      n.getAttribute("data-runtime-screen-transition") === "idle" &&
      !document.querySelector('[data-testid="game-launch-blackout"]');
  }, screen); await settleRuntime(page);
}
function unchanged() {
  for (const f of [source.installation, report.source, source.cartridge, ...installation.resources,
    installation.executable, ...installation.protectedFiles]) assert.equal(sha(f.path), f.sha256, f.path);
}
async function probe(id, expectedColor) {
  const locator = page.locator(`.renpy-title-view [data-ui-component-id="${id}"]`);
  assert.equal(await locator.count(), 1);
  const actual = await locator.evaluate(async n => {
    const r = n.getBoundingClientRect(), s = getComputedStyle(n), images = [];
    const url = /^url\(["']?(.*?)["']?\)$/.exec(s.backgroundImage)?.[1];
    if (url) {
      const b = await (await fetch(url)).arrayBuffer();
      images.push({ url, sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b)))
        .map(v => v.toString(16).padStart(2, "0")).join("") });
    }
    return { tag: n.tagName, color: s.backgroundColor, radius: s.borderRadius, slotCount: n.dataset.controlSlotCount,
      text: n.textContent, rect: r.toJSON(), images, disabled: n.disabled, inert: !!n.closest("[inert]"),
      hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert.equal(actual.tag, "BUTTON"); assert.equal(actual.slotCount, "1");
  assert.equal(actual.color, expectedColor); assert.equal(actual.radius, "6px");
  assert(actual.hit && !actual.disabled && !actual.inert && actual.text.trim() && actual.overflow <= 1);
  const r = actual.rect; assert(r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 &&
    r.right <= actual.width + 1 && r.bottom <= actual.height + 1);
  if (id === "title_start_button") {
    assert.equal(actual.images.length, 1); assert.equal(actual.images[0].sha256, source.cartridge.image.sha256);
  }
  return actual;
}
(async () => {
  unchanged(); save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  protectedProfiles = true; profiles("Prepare");
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => {
    const p = s.address().port; s.close(() => resolve(p)); }); });
  assert.equal(listeners([port]).length, 0);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_TEST_PROJECT: source.portable.path, AGENTVN_WORKSPACE_OUTPUT: out });
  const fd = fs.openSync(path.join(out, "player.log"), "wx");
  child = spawn(exe, ["--mode", "preview", "--cartridge", source.cartridge.path],
    { cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
  const p = rows().find(p => p.ProcessId === child.pid); assert(p);
  launch = { pid: child.pid, created: p.Created, port, executable: desc(exe),
    args: ["--mode", "preview", "--cartridge", source.cartridge.path], webview: env.WEBVIEW2_USER_DATA_FOLDER };
  report.launches.push(launch); remember();
  await until(async () => {
    assert.equal(child.exitCode, null); remember();
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, "installed control-code Player CDP", 45000);
  assert(listeners([port]).every(l => [...known.values()].some(p => p.ProcessId === l.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  report.readiness = [];
  page = await waitNativeRuntimePage(browser, { observe: e => { report.readiness.push(e); save(); } });
  page.setDefaultTimeout(30000); cdp = await page.context().newCDPSession(page);
  page.on("pageerror", e => { report.pageErrors.push(String(e)); save(); });
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    viewport = { width, height: width * 9 / 16, dpr, reduced };
    const row = { ...viewport, status: "RUNNING" }; report.cells.push(row); save();
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: viewport.height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await ready("title_menu"); await readInstalledViewport(page, viewport);
    row.start = await probe("title_start_button", "rgb(127, 54, 100)");
    row.about = await probe("title_about_button", "rgb(49, 91, 114)");
    assert(row.start.rect.bottom <= row.about.rect.top || row.about.rect.bottom <= row.start.rect.top ||
      row.start.rect.right <= row.about.rect.left || row.about.rect.right <= row.start.rect.left);
    report.screenshots.push(await captureInstalledWebview(page, cdp,
      path.join(out, `title-${width}-${dpr}-${reduced}.png`), viewport));
    await page.getByTestId("open-about").click(); await ready("about");
    assert.equal(await page.getByTestId("about-screen").count(), 1);
    const back = page.getByTestId("renpy-menu-return");
    assert(await back.isVisible() && await back.isEnabled()); await back.click(); await ready("title_menu");
    row.aboutAction = { actualAbout: true, returned: true };
    await probe("title_start_button", "rgb(127, 54, 100)");
    row.status = "PASS"; save(); console.log(`PASS installed code controls ${width}/${dpr}/${reduced}`);
  }
  await page.getByTestId("start-new-game").click(); await ready("playing");
  await page.locator(".dialog-text").filter({ hasText: "本轮独立 UI 验收，不影响用户工程。" }).waitFor();
  report.story = { actualStartAction: true, text: await page.locator(".dialog-text").innerText() };
  assert.equal(report.cells.length, 12); assert(report.cells.every(c => c.status === "PASS"));
  assert.deepEqual(report.pageErrors, []); unchanged(); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) {
    report.failureText = await page.locator("body").innerText().catch(String);
    try { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, "failure.png"), viewport)); }
    catch (error) { report.captureError = String(error); }
  }
}).finally(async () => {
  try {
    if (child) {
      remember(); await browser?.close().catch(() => {});
      for (const p of [...known.values()].reverse())
        if (rows().some(n => identity(n) === identity(p))) stopOwnedProcess(p, ps);
      await until(() => !rows().some(p => known.has(identity(p))) && listeners([launch.port]).length === 0,
        "owned control-code Player cleanup", 15000);
      report.cleanups.push({ status: "PASS", port: launch.port, normalCloseClaimed: false });
    }
    if (protectedProfiles && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profiles("Restore"); assert.equal(read(path.join(out, "profile-restoration.json")).status, "PASS");
      report.profileRestored = true;
    }
    unchanged();
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
