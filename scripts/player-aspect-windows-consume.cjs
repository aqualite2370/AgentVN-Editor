"use strict";
// Current installed-Editor Windows export, no cartridge override/preview mode.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { freePort, copyDirectory } = require("./lib/windows-portable-qa-utils.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), [sourceFile, output, ...options] = process.argv.slice(2);
assert(options.length === 0 || options.length === 1 && options[0].startsWith("--portable-report="));
const portableFile = options[0]?.slice("--portable-report=".length);
const out = path.resolve(output || ""), qa = "F:\\AgentVN\\QA\\Windows-Package-20261021-01";
assert.equal(path.resolve(sourceFile || ""), path.join(qa, "editor-20", "report.json"));
assert.equal(path.dirname(out), qa); assert.match(path.basename(out), /^runtime-\d{2}$/); assert(!fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const source = read(sourceFile); assert.equal(source.status, "PASS"); assert.equal(source.cleanup, "PASS");
const previous = portableFile && read(portableFile);
if (previous) {
  assert.equal(previous.status, "FAILED"); assert.equal(previous.cleanup, "PASS");
  assert(previous.error.includes('Get-FileHash'));
  assert.equal(previous.source.sha256, sha(sourceFile)); assert.equal(previous.matrix.length, 12);
  assert.equal(previous.launches.length, 3); assert.equal(previous.screenshots.length, 3);
  assert(previous.cases.slice(0, 2).every(c => c.status === "PASS"));
  assert(previous.cases.slice(0, 2).every(c => c.name.startsWith("portable-")));
  assert.equal(previous.cases[2].status, "FAILED");
  assert(!fs.existsSync(path.join(path.dirname(portableFile), "setup-protection.json")));
}
assert.equal(source.builds, 1);
for (const f of source.artifacts) assert.equal(sha(f.path), f.sha256);
assert.equal(read(source.embedded.manifest.path).game_id, "qa_player_aspect_windows_1936");
assert.equal(read(source.embedded.layout.path).gameViewport.aspectRatio, "4:3");
fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_INSTALLED_EDITOR_1_9_36_WINDOWS_PORTABLE_AND_NSIS_GAME_PLAYER_ASPECT",
  source: desc(sourceFile), builds: 0, productChanges: 0, modelRequests: 0,
  cases: [], matrix: [], launches: [], screenshots: [], errors: [], cleanup: "PENDING",
  limitations: ["WebView viewport simulation, not a physical 4K monitor", "Not game upgrade or Android",
    "QA fixture has one narration; not a complete story walkthrough",
    "Process-identity termination, not normal window exit; output picker controlled at build stage"] };
if (previous) report.portableEvidence = { ...desc(portableFile),
  scope: "First two passing portable stages only; source remains FAILED at setup preflight; no matrix repeated" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
for (const file of [__filename, path.join(__dirname, "player-aspect-game-install.ps1"),
  path.join(__dirname, "windows-standalone-profile-session.ps1")])
  fs.copyFileSync(file, path.join(out, path.basename(file)), fs.constants.COPYFILE_EXCL);
report.testIdentity = desc(path.join(out, path.basename(__filename)));
let child, browser, page, cdp, launch, protectedProfile = false;
const known = new Map(), identity = p => `${p.ProcessId}:${p.Created}`;
let expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const profileTool = path.join(__dirname, "windows-standalone-profile-session.ps1");
function tool(file, action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file,
    "-Action", action, "-RunDirectory", out,
    ...(file === profileTool ? [] : ["-BuildReport", sourceFile])],
  { encoding: "utf8", windowsHide: true, timeout: 180000 });
  fs.writeFileSync(path.join(out, `${path.basename(file)}-${action}.log`), (r.stdout || "") + (r.stderr || ""), { flag: "wx" });
  assert.equal(r.status, 0, `${action}: ${r.stdout}\n${r.stderr}`);
}
const installTool = path.join(__dirname, "player-aspect-game-install.ps1");
function remember() {
  if (child) {
    const tree = ownedProcessTree(rows(), child.pid, launch.created);
    if (tree.length) launch.created = tree[0].Created;
    for (const p of tree) known.set(identity(p), p);
  }
  report.knownProcesses = [...known.values()]; save();
}
async function check(name, fn) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.cases.push(row); save();
  console.log("START", name);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { row.finishedAt = new Date().toISOString(); save(); console.log(row.status, name); }
}
async function metrics(v) {
  expected = v;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: v.reduced ? "reduce" : "no-preference" });
  return readInstalledViewport(page, v);
}
async function ready(screen) {
  await page.waitForFunction(s => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") === s
      && n.getAttribute("data-runtime-screen-transition") === "idle"
      && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, screen);
  await settleRuntime(page);
}
async function frame(ratio) {
  await settleRuntime(page);
  const r = await page.locator(".runtime-layout-frame").evaluate(n => ({
    frame: n.getBoundingClientRect().toJSON(), scope: n.closest(".ui-skin-scope").getBoundingClientRect().toJSON(),
    ratio: n.closest(".ui-skin-scope").dataset.gameAspectRatio, overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  assert.equal(r.ratio, ratio);
  const [w, h] = ratio.split(":").map(Number), f = r.frame, s = r.scope;
  assert(f.width > 0 && Math.abs(f.width / f.height - w / h) < .003);
  assert(f.left >= s.left - 1 && f.right <= s.right + 1 && f.top >= s.top - 1 && f.bottom <= s.bottom + 1);
  assert(Math.abs(f.left + f.right - s.left - s.right) <= 2 && Math.abs(f.top + f.bottom - s.top - s.bottom) <= 2);
  assert(r.overflow <= 1); r.viewport = await readInstalledViewport(page, expected); return r;
}
async function choose(value) {
  const button = page.getByTestId(`settings-aspect-${value}`);
  await button.click(); assert.equal(await button.getAttribute("aria-pressed"), "true");
  assert(await button.evaluate(n => n === document.activeElement));
  const buttons = await page.getByRole("group", { name: "画面比例", exact: true }).evaluate(n =>
    [...n.querySelectorAll("button")].map(b => {
      const r = b.getBoundingClientRect(), p = b.closest(".settings-content").getBoundingClientRect();
      return { rect: r.toJSON(), panel: p.toJSON(),
        hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    }));
  assert.equal(buttons.length, 4);
  assert(buttons.every(({ rect: r, panel: p, hit }) => hit && r.left >= p.left - 1 && r.right <= p.right + 1
    && r.top >= p.top - 1 && r.bottom <= p.bottom + 1));
  return { value, buttons, frame: await frame(value === "default" ? "4:3" : value) };
}
async function settings() { await page.getByTestId("open-settings").click(); await ready("settings"); }
async function start(exe, kind, label) {
  assert(!child);
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev|AgentVN Aspect QA1936)\.exe$/i.test(p.Name)),
    "Protect active user editor/player");
  const port = await freePort(); assert.equal(listeners([port]).length, 0);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_)/.test(key)) delete env[key];
  const temp = path.join(out, "temporary"), cwd = path.join(out, "unrelated-cwd");
  fs.mkdirSync(temp, { recursive: true }); fs.mkdirSync(cwd, { recursive: true });
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, `webview-${kind}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, TEMP: temp, TMP: temp });
  const fd = fs.openSync(path.join(out, `${kind}-${label}.log`), "wx");
  child = spawn(exe, [], { cwd, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
  launch = { pid: child.pid, port, kind, label, args: [], cwd, executable: desc(exe), at: new Date().toISOString() };
  report.launches.push(launch); remember();
  const actual = rows().find(p => p.ProcessId === child.pid);
  assert.equal(path.resolve(actual.ExecutablePath).toLowerCase(), exe.toLowerCase());
  await until(async () => {
    assert.equal(child.exitCode, null);
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; }
    catch { return false; }
  }, "owned standalone game CDP", 60000);
  remember();
  assert(listeners([port]).every(p => [...known.values()].some(k => k.ProcessId === p.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())), "standalone document");
  page.setDefaultTimeout(25000);
  page.on("pageerror", e => { report.errors.push(String(e)); save(); });
  cdp = await page.context().newCDPSession(page);
  await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false }); await ready("title_menu");
  launch.markers = await page.evaluate(async () => {
    const result = {};
    for (const name of ["runtime-mode.json", "fixed-only.json", "release-package.json"]) {
      const r = await fetch("/" + name); if (!r.ok) throw Error(`Missing embedded marker ${name}`);
      result[name] = await r.json();
    }
    return result;
  });
  assert.equal(launch.markers["runtime-mode.json"].mode, "fixed");
  assert.equal(launch.markers["fixed-only.json"].fixedOnly, true);
  assert.equal(launch.markers["release-package.json"].presentationMode, "release");
  await page.locator(".renpy-title-host").waitFor();
  assert((await page.getByTestId("renpy-title-view").innerText()).includes("AgentVN Aspect QA1936"));
  assert(!await page.getByRole("button", { name: "导入卡带", exact: true }).isVisible());
  launch.storage = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_save_storage_info", { installId: "preview_gamecli" }));
  assert.equal(launch.storage.portable, true);
  assert.equal(path.resolve(launch.storage.targetDirectory), path.join(path.dirname(exe), "saves", "qa_player_aspect_windows_1936", "preview_gamecli"));
  save();
}
async function stop() {
  if (!child) return;
  remember(); await browser?.close().catch(() => {}); browser = undefined;
  const stopped = [];
  for (const p of [...known.values()].reverse()) stopped.push({ identity: identity(p), result: stopOwnedProcess(p, ps) });
  await until(() => !rows().some(p => known.has(identity(p))) && !listeners([launch.port]).length, "owned game cleanup", 20000);
  launch.cleanup = { status: "PASS", method: "ATTRIBUTED_TERMINATION", stopped };
  child = page = cdp = undefined; save();
}
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected)); save();
}
async function testGame(exe, kind) {
  await check(`${kind}-embedded-default-and-player-choices-12-display-conditions`, async () => {
    await start(exe, kind, "initial"); await frame("4:3"); await settings();
    assert.equal(await page.getByTestId("settings-aspect-default").getAttribute("aria-pressed"), "true");
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const row = { kind, width, height: width * 9 / 16, dpr, reduced, status: "RUNNING", choices: [] };
      report.matrix.push(row); save(); await metrics(row);
      for (const value of ["16:9", "16:10", "4:3", "default"]) row.choices.push(await choose(value));
      row.status = "PASS"; save();
      if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced) await shot(`${kind}-${width}-${dpr}-${reduced}`);
    }
    await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    await choose("16:10"); await page.getByTestId("settings-finish").click(); await ready("title_menu");
    await page.getByTestId("start-new-game").click(); await ready("playing"); await frame("16:10");
    const index = await page.getByTestId("game-state-playing").getAttribute("data-current-command-index");
    await page.keyboard.press("Escape"); await ready("main_menu"); await settings(); await choose("16:9");
    await page.getByTestId("settings-finish").click(); await ready("main_menu");
    await page.getByTestId("continue-game").click(); await ready("playing"); await frame("16:9");
    assert.equal(await page.getByTestId("game-state-playing").getAttribute("data-current-command-index"), index);
    await page.keyboard.press("Escape"); await ready("main_menu"); await settings(); await choose("16:10");
    const key = "vn.runtime.aspect-ratio.qa_player_aspect_windows_1936";
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key), "16:10");
    await stop(); return { authorDefault: "4:3", savedPlayerOverride: "16:10", storyIndexUnchanged: index, matrixConditions: 12 };
  });
  await check(`${kind}-real-process-restart-and-restore-project-default`, async () => {
    await start(exe, kind, "restart"); await frame("16:10"); await settings();
    assert.equal(await page.getByTestId("settings-aspect-16:10").getAttribute("aria-pressed"), "true");
    await choose("default"); await stop();
    await start(exe, kind, "default-restart"); await frame("4:3"); await settings();
    assert.equal(await page.getByTestId("settings-aspect-default").getAttribute("aria-pressed"), "true");
    await shot(`${kind}-default-restored`); await stop();
    return { realLaunches: 2, restoredProjectDefault: "4:3" };
  });
}
(async () => {
  save();
  tool(profileTool, "SelfTest"); protectedProfile = true; tool(profileTool, "Prepare");
  if (previous) {
    report.portable = previous.portable;
    assert.equal(sha(report.portable.path), source.portable.sha256); save();
  } else {
    const client = path.join(out, "portable-client");
    copyDirectory(path.dirname(source.portable.path), client);
    const exe = path.join(client, path.basename(source.portable.path));
    assert.equal(sha(exe), source.portable.sha256); report.portable = desc(exe); save();
    await testGame(exe, "portable");
  }
  await check("actual-nsis-game-install-and-resource-verification", async () => {
    tool(installTool, "Install"); const receipt = path.join(out, "installation.json");
    assert.equal(read(receipt).status, "PASS"); report.installation = desc(receipt); return report.installation;
  });
  await testGame(read(report.installation.path).executable.path, "setup");
  assert.equal(report.matrix.length, previous ? 12 : 24); assert.equal(report.launches.length, previous ? 3 : 6);
  assert.equal(report.screenshots.length, previous ? 3 : 6); assert.deepEqual(report.errors, []);
  for (const f of source.artifacts) assert.equal(sha(f.path), f.sha256);
  assert.equal(sha(sourceFile), report.source.sha256);
  report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) report.failureDOM = await page.locator("body").innerText().catch(String);
}).finally(async () => {
  try {
    await stop();
    if (fs.existsSync(path.join(out, "setup-protection.json"))) {
      if (fs.existsSync(path.join(out, "installed-client", "uninstall.exe"))) tool(installTool, "Uninstall");
      tool(installTool, "Cleanup");
      report.uninstallation = desc(path.join(out, "uninstallation.json"));
      report.setupCleanup = desc(path.join(out, "setup-cleanup.json"));
      assert.equal(read(report.uninstallation.path).status, "PASS");
    }
    if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) {
      tool(profileTool, "Restore"); report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.profileRestoration.path).status, "PASS");
    }
    report.cleanup = "PASS";
  } catch (e) {
    report.cleanup = "FAILED"; report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, matrix: report.matrix.length,
    cases: report.cases.length, cleanup: report.cleanup, error: report.error, cleanupError: report.cleanupError }));
});
