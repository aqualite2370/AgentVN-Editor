"use strict";
// Consume untouched, actually UI-exported cartridges in the matching installed
// native Player. Read DOM/material only; all navigation uses actual controls.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { validateCandidateConfig, materialAssertion } = require("./candidate-layout-consumption.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, until, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const JSZip = require("../editor/node_modules/jszip");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const config = validateCandidateConfig(read(process.argv[2])), sourceFile = path.resolve(process.argv[3]);
assert.equal(path.dirname(path.dirname(sourceFile)), path.resolve("F:/AgentVN/QA/Installed-Layout-20261021-01"));
assert.match(path.basename(path.dirname(sourceFile)), /^editor-\d{2}$/);
assert.equal(path.basename(sourceFile), "report.json");
assert.match(process.argv[4] || "", /^\d{2}$/);
const source = read(sourceFile), installation = deriveActual(config.actual, config.version);
assert.equal(source.status, "PASS_LIMITED_NATIVE_PROJECT_ROUNDTRIP_AND_UI_CARTRIDGE_EXPORT");
assert.equal(source.version, config.version); assert.equal(source.nativeCacheRestoration, "PASS");
assert(source.finishedAt && !source.cleanupError); assert.deepEqual(source.errors, []);
assert.equal(source.modelRequests, 0); assert.equal(source.cartridges.length, 2);
assert.equal(path.dirname(path.resolve(source.portable.path)), path.dirname(sourceFile));
assert.equal(path.extname(source.portable.path), ".vnproj");
assert.equal(sha(source.portable.path), source.portable.sha256);
assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev|creator-backend)\.exe$/i.test(p.Name)));
const out = path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01",
  `authored-layout-${config.version}-${process.argv[4]}`);
fs.mkdirSync(out, { recursive: false });
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const executable = installation.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
assert(executable);
const report = { status: "RUNNING", version: config.version, startedAt: new Date().toISOString(),
  source: desc(sourceFile), projectMarker: desc(source.portable.path),
  installation: desc(config.actual.path), executable, cases: [], matrix: [],
  screenshots: [], errors: [], launches: [], profileCommands: [], modelRequests: 0, productChanges: 0, builds: 0,
  scope: "INSTALLED_BUNDLED_PLAYER_UNMODIFIED_UI_CARTRIDGES_AUTHOR_MATERIAL_AND_NAVIGATION_MATRIX",
  boundaries: ["Native Player public preview mode; no setup/portable build or Android claim",
    "WebView viewport simulation; not physical 4K monitors",
    "Primary region material/navigation only; not every authored control or full story semantics",
    "Gallery absent in empty Renpy fixture; special NVL/bubble/confirmation author previews remain separate",
    "Owned forced process cleanup; no normal-window-close claim"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const matrix = [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
  [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
let child, browser, page, cdp, launch, expected, prepared = false;
let known = new Map();
function profiles(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.resolve(__dirname, "native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 120000 });
  report.profileCommands.push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }); save();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function remember() {
  if (!child) return;
  const tree = ownedProcessTree(rows(), child.pid, launch.identity?.Created);
  if (tree.length) {
    assert.equal(path.resolve(tree[0].ExecutablePath), path.resolve(executable.path));
    launch.identity ??= tree[0];
  }
  for (const process of tree) known.set(`${process.ProcessId}:${process.Created}`, process);
  launch.knownProcesses = [...known.values()]; save();
}
async function stop() {
  if (!child) return;
  remember(); await browser?.close().catch(() => {}); browser = undefined;
  const stopped = [];
  for (const process of [...known.values()].reverse()) {
    if (!rows().some(p => p.ProcessId === process.ProcessId && p.Created === process.Created)) continue;
    stopOwnedProcess(process, ps); stopped.push(`${process.ProcessId}:${process.Created}`);
  }
  await until(() => !rows().some(p => known.has(`${p.ProcessId}:${p.Created}`))
    && listeners([launch.port]).length === 0, "authored Player exact owned cleanup", 15000);
  launch.cleanup = { status: "PASS", stopped, normalCloseClaimed: false };
  child = page = cdp = undefined;
  assert.equal(sha(executable.path), executable.sha256); save();
}
async function start(cartridge) {
  assert.equal(sha(cartridge.path), cartridge.sha256);
  const port = await new Promise((resolve, reject) => {
    const socket = net.createServer(); socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => { const p = socket.address().port; socket.close(e => e ? reject(e) : resolve(p)); });
  });
  assert.equal(listeners([port]).length, 0);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/i.test(k)) delete env[k];
  const temp = path.join(out, `temporary-${cartridge.type}`); fs.mkdirSync(temp);
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, `webview-${cartridge.type}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_WORKSPACE_OUTPUT: out, AGENTVN_TEST_PROJECT: source.portable.path, TEMP: temp, TMP: temp });
  assert.equal(sha(env.AGENTVN_TEST_PROJECT), report.projectMarker.sha256);
  const args = ["--mode", "preview", "--cartridge", cartridge.path];
  const fd = fs.openSync(path.join(out, `${cartridge.type}-player.log`), "wx");
  try { child = spawn(executable.path, args,
    { cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] }); }
  finally { fs.closeSync(fd); }
  launch = { pid: child.pid, port, type: cartridge.type, cartridge, executable, mode: "preview",
    arguments: args, isolation: { AGENTVN_TEST_PROJECT: env.AGENTVN_TEST_PROJECT,
      AGENTVN_WORKSPACE_OUTPUT: env.AGENTVN_WORKSPACE_OUTPUT } };
  report.launches.push(launch); known = new Map(); remember();
  await until(async () => {
    assert.equal(child.exitCode, null);
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(700) })).ok; }
    catch { return false; }
  }, "actual installed authored Player CDP", 60000);
  remember(); assert.equal(listeners([port]).length, 1);
  assert(listeners([port]).every(p => [...known.values()].some(n => n.ProcessId === p.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())),
    "actual installed Player page");
  page.setDefaultTimeout(30000); page.on("pageerror", e => { report.errors.push(String(e)); save(); });
  cdp = await page.context().newCDPSession(page);
}
async function ready(screen) {
  await page.waitForFunction(screen => {
    const node = document.querySelector("[data-runtime-screen-transition]");
    return node?.getAttribute("data-runtime-presented-screen") === screen
      && node.getAttribute("data-runtime-screen-transition") === "idle";
  }, screen);
  await settleRuntime(page);
}
async function click(testId, screen) {
  const button = page.getByTestId(testId); await button.click({ trial: true }); await button.focus();
  assert(await button.evaluate(n => document.activeElement === n), "Navigation must receive focus");
  await button.click(); await ready(screen);
}
async function measure(type, id, selector, layout) {
  const probe = await page.evaluate(selector => {
    const nodes = [...document.querySelectorAll(selector)].filter(n => !n.closest("[inert]"));
    const n = nodes[0], layer = n?.querySelector(':scope > [data-ui-opacity-layer="background"]') ?? n;
    const css = layer && getComputedStyle(layer);
    return { present: !!n, count: nodes.length, rect: n?.getBoundingClientRect().toJSON(),
      background: css?.backgroundColor, opacity: css?.opacity, visible: !!css && css.display !== "none" && css.visibility !== "hidden",
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      layoutType: document.querySelector("[data-layout-type]")?.getAttribute("data-layout-type"),
      overflow: document.documentElement.scrollWidth - innerWidth,
      focusUnavailable: !!document.activeElement?.closest("[inert],[aria-hidden=true]"),
      sharedNavigations: document.querySelectorAll('[data-testid="renpy-menu-navigation"]').length };
  }, selector);
  assert.equal(probe.layoutType, type);
  const screen = layout.screens.find(s => s.screen_id === id);
  const components = { title: "title_hero", player: "dialog_panel", game_menu: "game_menu_nav",
    save_load: "save_grid", preferences: "settings_group", history: "history_list",
    about: "about_panel", help: "help_panel", gallery: "gallery_grid" };
  const component = screen.components.find(c => c.component_id === components[id]);
  materialAssertion(probe, component.style, id);
  if (type === "agentvn") assert.equal(probe.sharedNavigations, 0, "Existing default layout has no Renpy navigation");
  report.cases.push({ type, id, display: expected, probe, status: "PASS" }); save();
}
(async () => {
  save(); prepared = true; profiles("Prepare");
  for (const cartridge of source.cartridges) {
    const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path), { checkCRC32: true });
    const layout = JSON.parse(await zip.file("ui/layout.json").async("string")), type = cartridge.type;
    await start(cartridge);
    for (const display of matrix) {
      expected = display;
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: display.width, height: display.height, deviceScaleFactor: display.dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: display.reduced ? "reduce" : "no-preference" });
      await readInstalledViewport(page, display);
      await page.reload(); await page.getByTestId("start-new-game").waitFor(); await ready("title_menu");
      const before = report.cases.length;
      await measure(type, "title", ".main-menu-title-hero-background", layout);
      const menus = [["open-settings", "settings", "preferences", ".settings-renpy.ui-layouted"],
        ["open-save-load", "save_load", "save_load", ".save-grid.ui-layouted"],
        ["open-about", "about", "about", ".about-card.ui-layouted"],
        ...(type === "renpy" ? [["open-help", "help", "help", ".help-card.ui-layouted"]]
          : [["open-gallery", "gallery", "gallery", ".gallery-grid.ui-layouted"]])];
      for (const [entry, screen, id, selector] of menus) {
        await click(entry, screen); await measure(type, id, selector, layout);
        if (type === "renpy" && id === "preferences") await measure(type, "game_menu", ".renpy-menu-navigation", layout);
        await page.keyboard.press("Escape"); await ready("title_menu");
      }
      await click("start-new-game", "playing"); await measure(type, "player", ".dialog-box", layout);
      if (type === "renpy") await click("renpy-quick-history", "history");
      else {
        await page.getByTestId("quick-menu-toggle").click();
        await page.getByRole("button", { name: "打开历史记录", exact: true }).click(); await ready("history");
      }
      await measure(type, "history", ".history-list.ui-layouted", layout);
      await page.keyboard.press("Escape"); await ready("playing");
      report.screenshots.push(await captureInstalledWebview(page, cdp,
        path.join(out, `${type}-${display.width}-dpr${display.dpr}-${display.reduced}.png`), display));
      const count = report.cases.length - before;
      assert.equal(count, type === "renpy" ? 8 : 7);
      report.matrix.push({ type, ...display, cases: count, status: "PASS" }); save();
      console.log(`PASS actual installed Player ${type} ${display.width} DPR${display.dpr} reduced=${display.reduced}`);
    }
    assert.equal(sha(cartridge.path), cartridge.sha256); await stop();
  }
  assert.equal(report.cases.length, 180); assert.equal(report.matrix.length, 24);
  assert.equal(report.screenshots.length, 24); assert.deepEqual(report.errors, []);
  report.status = "PASS_LIMITED_INSTALLED_PLAYER_AUTHOR_MATERIAL_NAVIGATION_MATRIX";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) {
    report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-6000);
    try { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, "failure.png"), expected)); }
    catch (e) { report.captureError = String(e); }
  }
}).finally(async () => {
  const errors = [];
  for (const cleanup of [stop,
    () => { if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) profiles("Restore"); },
    () => { assert.equal(sha(sourceFile), report.source.sha256);
      assert.equal(sha(source.portable.path), report.projectMarker.sha256);
      for (const c of source.cartridges) assert.equal(sha(c.path), c.sha256); }]) {
    try { await cleanup(); } catch (e) { errors.push(String(e.stack || e)); }
  }
  if (errors.length) { report.status = "FAILED"; report.cleanupError = errors; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
