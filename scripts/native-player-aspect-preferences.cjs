"use strict";
// Actual newly built native Player; isolated profiles, UI preference writes only.
// This is native preview acceptance, not an installer/setup/Android verdict.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const root = path.resolve(__dirname, ".."), [gatesFile, output, ...options] = process.argv.slice(2);
assert(options.every(v => v === "--smoke" || /^--(?:installation|inputs-report)=.+/.test(v)));
assert.equal(new Set(options.map(v => v.split("=")[0])).size, options.length);
const option = key => options.find(v => v.startsWith(`--${key}=`))?.slice(key.length + 3);
const installationFile = option("installation"), inputsFile = option("inputs-report");
const installedSmoke = options.includes("--smoke");
assert(options.length === 0 || installedSmoke && installationFile && inputsFile && options.length === 3,
  "Installed smoke requires an explicit receipt, UI export report and --smoke together");
const out = path.resolve(output || "");
assert(gatesFile && path.dirname(out) === "F:\\AgentVN\\QA\\Native-Runtime-State-20261020-01"
  && /^player-aspect-20261102-\d{2}$/.test(path.basename(out)) && !fs.existsSync(out));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ file: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const gates = read(gatesFile);
assert.equal(gates.status, "PASS"); assert.equal(gates.dev.status, "PASS");
const source = read(inputsFile || gates.browser.identity.file);
assert.equal(sha(gates.browser.identity.file), gates.browser.identity.sha256);
assert.equal(source.status, "PASS"); assert.equal(source.cleanup, "PASS");
const installation = installationFile && verifiedInstalledCandidate(installationFile);
const exe = installation ? path.join(installation.installRoot, "agentvn-player.exe") : gates.dev.player.file;
assert.equal(sha(exe), gates.dev.player.sha256);
if (installation) {
  assert.equal(installation.resources.find(r => path.resolve(r.path) === path.resolve(exe))?.sha256, sha(exe));
  assert.equal(source.installation.sha256, sha(installationFile));
  assert.equal(source.inputs.length, 2);
  assert.deepEqual(source.inputs.map(i => i.type).sort(), ["agentvn", "renpy"]);
  for (const input of source.inputs) {
    assert(input.secondIsControlledIdentityFixture);
    const exported = source.cartridges.find(c => c.type === input.type);
    assert.equal(path.resolve(exported.path), path.resolve(input.file));
    assert.equal(exported.sha256, input.sha256);
  }
}
fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: installedSmoke ? "ACTUAL_INSTALLED_EDITOR_EXPORT_AND_BUNDLED_PLAYER_SMOKE_NOT_STANDALONE_SETUP"
    : "CURRENT_BUILT_NATIVE_PLAYER_PREVIEW_NOT_INSTALLED_OR_STANDALONE",
  gates: desc(gatesFile), browser: gates.browser.identity, executable: desc(exe),
  ...(installation ? { installation: desc(installationFile), installedExports: desc(inputsFile),
    displayMatrixScope: "1080p DPR1 normal only; no repeat of the same-byte full native matrix" } : {}),
  cases: [], launches: [], screenshots: [], errors: [], cleanup: "PENDING", modelRequests: 0,
  limitations: [installedSmoke ? "Actual installed Editor exports and bundled Player preview, not standalone setup"
    : "Native preview mode, not Editor Release installation or standalone setup",
    "WebView viewport/DPR emulation, not physical4K", "Attributed termination, not normal native exit",
    "No Android, old Runtime rejection, new model request or new audio listening"] };
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
report.testIdentity = desc(path.join(out, "executed-test.cjs"));
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let child, browser, page, cdp, launch, protectedProfile = false;
let expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const known = new Map(), identity = p => `${p.ProcessId}:${p.Created}`;
function remember() {
  if (child) {
    const tree = ownedProcessTree(rows(), child.pid, launch.created);
    if (tree.length) launch.created = tree[0].Created;
    for (const p of tree) known.set(identity(p), p);
  }
  report.knownProcesses = [...known.values()]; save();
}
function profiles(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  assert.equal(result.status, 0, `Profile ${action}: ${result.stdout}\n${result.stderr}`);
}
async function metrics(value) {
  expected = value;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: value.width, height: value.height,
    deviceScaleFactor: value.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: value.reduced ? "reduce" : "no-preference" });
  return readInstalledViewport(page, value);
}
async function ready(screen) {
  await page.waitForFunction(screen => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") === screen
      && n?.getAttribute("data-runtime-screen-transition") === "idle"
      && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, screen);
  await settleRuntime(page);
}
async function frame(ratio) {
  await settleRuntime(page);
  const result = await page.locator(".runtime-layout-frame").evaluate(n => ({
    frame: n.getBoundingClientRect().toJSON(), scope: n.closest(".ui-skin-scope").getBoundingClientRect().toJSON(),
    ratio: n.closest(".ui-skin-scope").dataset.gameAspectRatio,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  assert.equal(result.ratio, ratio);
  const [a, b] = ratio.split(":").map(Number), r = result.frame, s = result.scope;
  assert(r.width > 0 && r.height > 0 && Math.abs(r.width / r.height - a / b) < .003);
  assert(r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1);
  assert(Math.abs(r.left + r.right - s.left - s.right) <= 2);
  assert(Math.abs(r.top + r.bottom - s.top - s.bottom) <= 2 && result.overflow <= 1);
  result.viewport = await readInstalledViewport(page, expected); return result;
}
async function ratio(value) {
  const button = page.getByTestId(`settings-aspect-${value}`);
  await button.click();
  assert.equal(await button.getAttribute("aria-pressed"), "true");
  assert(await button.evaluate(n => document.activeElement === n));
  const geometry = await page.getByRole("group", { name: "画面比例", exact: true }).evaluate(n =>
    [...n.querySelectorAll("button")].map(b => {
      const r = b.getBoundingClientRect(), p = b.closest(".settings-content").getBoundingClientRect();
      return { rect: r.toJSON(), panel: p.toJSON(),
        hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    }));
  assert.equal(geometry.length, 4);
  assert(geometry.every(g => g.hit && g.rect.left >= g.panel.left - 1 && g.rect.right <= g.panel.right + 1
    && g.rect.top >= g.panel.top - 1 && g.rect.bottom <= g.panel.bottom + 1));
  return { value, geometry, rendering: await frame(value === "default" ? "4:3" : value) };
}
async function settings() {
  await page.getByTestId("open-settings").click(); await ready("settings");
}
async function finish() {
  await page.getByTestId("settings-finish").click();
  await page.waitForFunction(() => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") !== "settings"
      && n?.getAttribute("data-runtime-screen-transition") === "idle";
  });
  await settleRuntime(page);
}
async function start(game, file, label) {
  assert(!child && !rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)),
    "Do not touch an active user Player or Editor");
  assert.equal(sha(exe), report.executable.sha256);
  const port = await new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
  assert.equal(listeners([port]).length, 0);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, `webview-${game.type}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_WORKSPACE_OUTPUT: out });
  const log = fs.openSync(path.join(out, `player-${game.type}-${label}.log`), "wx");
  child = spawn(exe, ["--mode", "preview", "--cartridge", file],
    { cwd: path.dirname(exe), env, windowsHide: true, stdio: ["ignore", log, log] });
  fs.closeSync(log);
  launch = { pid: child.pid, port, type: game.type, label, cartridge: desc(file), at: new Date().toISOString() };
  report.launches.push(launch); remember();
  await until(async () => {
    assert.equal(child.exitCode, null);
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) })).ok; }
    catch { return false; }
  }, "owned Player CDP", 60000);
  remember();
  assert(listeners([port]).every(l => known.has(identity(rows().find(p => p.ProcessId === l.OwningProcess)))));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())),
    "native Runtime document");
  page.setDefaultTimeout(25000);
  page.on("pageerror", e => { report.errors.push(String(e)); save(); });
  cdp = await page.context().newCDPSession(page);
  await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
  await page.getByTestId("start-new-game").waitFor(); await ready("title_menu");
}
async function stop() {
  if (!child) return;
  remember(); await browser?.close().catch(() => {}); browser = undefined;
  const stopped = [];
  for (const p of [...known.values()].reverse()) stopped.push({ identity: identity(p), result: stopOwnedProcess(p, ps) });
  await until(() => !rows().some(p => known.has(identity(p))) && listeners([launch.port]).length === 0,
    "owned Player cleanup", 20000);
  launch.cleanup = { status: "PASS", method: "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE", stopped };
  child = undefined; page = undefined; cdp = undefined; save();
}
async function persisted(gameId) {
  return page.evaluate(id => JSON.parse(localStorage.getItem(`vn.runtime.aspect-ratio.${encodeURIComponent(id)}`)), gameId);
}
(async () => {
  save(); protectedProfile = true; profiles("Prepare");
  for (const game of source.inputs) {
    assert.equal(sha(game.file), game.sha256); assert.equal(sha(game.second), game.secondSha256);
    const a = JSON.parse(await (await JSZip.loadAsync(fs.readFileSync(game.file))).file("manifest.json").async("string"));
    const b = JSON.parse(await (await JSZip.loadAsync(fs.readFileSync(game.second))).file("manifest.json").async("string"));
    assert.notEqual(a.game_id, b.game_id);
    await start(game, game.file, "A");
    await frame("4:3"); await settings();
    const matrix = installedSmoke ? [{ width: 1920, height: 1080, dpr: 1, reduced: false }]
      : [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr => [false, true]
        .map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
    for (const m of matrix) {
      const { width, dpr, reduced } = m;
      await metrics(m);
      const choices = [];
      for (const value of ["16:9", "16:10", "4:3", "default"]) choices.push(await ratio(value));
      report.cases.push({ name: "actual-native-player-ratio-choices", type: game.type, ...expected, choices, status: "PASS" });
      if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)
        report.screenshots.push(await captureInstalledWebview(page, cdp,
          path.join(out, `${game.type}-${width}-${dpr}-${reduced}.png`), expected));
      save();
    }
    await metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    await ratio("16:10"); assert.equal(await persisted(a.game_id), "16:10"); await finish();
    await page.getByTestId("start-new-game").click(); await ready("playing");
    await frame("16:10");
    const index = await page.getByTestId("game-state-playing").getAttribute("data-current-command-index");
    await page.keyboard.press("Escape"); await ready("main_menu"); await settings();
    await ratio("16:9"); await finish();
    const screen = await page.locator("[data-runtime-screen-transition]").getAttribute("data-runtime-presented-screen");
    if (screen === "main_menu") await page.getByTestId("continue-game").click();
    await ready("playing"); await frame("16:9");
    assert.equal(await page.getByTestId("game-state-playing").getAttribute("data-current-command-index"), index);
    await page.keyboard.press("Escape"); await ready("main_menu"); await settings(); await ratio("16:10"); await stop();
    await start(game, game.second, "B"); await frame("4:3"); await settings();
    assert.equal(await page.getByTestId("settings-aspect-default").getAttribute("aria-pressed"), "true");
    await ratio("16:9"); assert.equal(await persisted(b.game_id), "16:9"); await stop();
    await start(game, game.file, "A-restart"); await frame("16:10"); await settings();
    await ratio("default"); assert.equal(await persisted(a.game_id), "default"); await stop();
    await start(game, game.second, "B-restart"); await frame("16:9");
    assert.equal(await persisted(a.game_id), "default"); assert.equal(await persisted(b.game_id), "16:9");
    report.cases.push({ name: "actual-native-process-restart-A-B-A-and-independent-reset",
      type: game.type, gameIds: [a.game_id, b.game_id], browserProcessRestart: true,
      storyPositionUnchanged: true, status: "PASS" }); save(); await stop();
  }
  assert.equal(report.cases.length, installedSmoke ? 4 : 26);
  assert.equal(report.screenshots.length, installedSmoke ? 2 : 4);
  assert.equal(report.launches.length, 8); assert.deepEqual(report.errors, []);
  for (const game of source.inputs) {
    assert.equal(sha(game.file), game.sha256); assert.equal(sha(game.second), game.secondSha256);
  }
  assert.equal(sha(exe), report.executable.sha256); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) report.failureDOM = await page.locator("body").innerText().catch(String);
}).finally(async () => {
  try {
    await stop();
    if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profiles("Restore");
      report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.profileRestoration.file).status, "PASS");
    }
    report.cleanup = "PASS";
  } catch (error) {
    report.cleanup = "FAILED"; report.cleanupError = String(error.stack || error);
    report.status = "FAILED"; process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length,
    cleanup: report.cleanup, error: report.error, cleanupError: report.cleanupError }));
});
