"use strict";
// Same installed Player consumes the unmodified actual Editor UI export.
// No Runtime state injection, source server, image-style override or paid model.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright"), JSZip = require("../editor/node_modules/jszip");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const qa = path.resolve(process.env.AGENTVN_INSTALLED_GUI_QA_ROOT
  || "F:/AgentVN/QA/Installed-GUI-20261021-01");
const installationFile = path.resolve(process.env.AGENTVN_INSTALLED_INSTALLATION_FILE
  || "F:/AgentVN/QA/Installed-Candidate-20261021-01/installation.json");
const playerOutputRoot = process.env.AGENTVN_INSTALLED_GUI_PLAYER_OUTPUT
  ? path.resolve(process.env.AGENTVN_INSTALLED_GUI_PLAYER_OUTPUT)
  : "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const inputAttempt = process.argv[2] || "02", attempt = process.argv[3] || "01";
assert.match(inputAttempt, /^\d{2}$/); assert.match(attempt, /^\d{2}$/);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const sourceFile = path.join(qa, `editor-${inputAttempt}/report.json`), source = read(sourceFile);
assert.equal(source.status, "EDITOR_PASS_PLAYER_NOT_RUN"); assert.equal(source.steps.length, 7);
assert(source.steps.every(s => s.status === "PASS")); assert.equal(source.matrix.length, 12);
assert.equal(source.modelRequests, 0); assert.deepEqual(source.errors, []);
const prep = read(path.join(qa, "preparation.json"));
const installation = read(installationFile);
assert.equal(installation.status, "PASS");
const exe = path.join(installation.installRoot, "agentvn-player.exe");
const playerResource = installation.resources?.find(resource =>
  path.basename(resource.path).toLowerCase() === "agentvn-player.exe");
assert(playerResource, "Installation receipt must include the actual installed Player");
assert.equal(path.resolve(playerResource.path), path.resolve(exe));
assert.equal(sha(exe), playerResource.sha256);
const out = path.join(playerOutputRoot, `installed-gui-current-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(sourceFile),
  executable: desc(exe), cases: [], launches: [], screenshots: [], cleanups: [], errors: [], modelRequests: 0,
  scope: "ACTUAL_NSIS_INSTALLED_EDITOR_OFFICIAL_GUI_UI_EXPORT_AND_INSTALLED_PLAYER_PREVIEW",
  notProven: ["Windows portable/setup", "Android", "Upgrade", "Native picker or normal close",
    "Physical 4K monitor", "All GUI parameters or arbitrary screens.rpy", "Complete transition audit"] };
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
      `if($owned -and $owned.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){` +
      `Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
    killed.push(identity(p));
  }
  await until(() => !rows().some(p => known.has(identity(p))) && listeners([current.port]).length === 0,
    "owned installed Player cleanup", 15000);
  report.cleanups.push({ status: "PASS", killed, port: current.port, normalCloseClaimed: false });
  player = undefined; save();
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
async function image(locator, relative) {
  const expected = source.cartridge.assets.find(a => a.relative === relative); assert(expected);
  const result = await locator.evaluate(async n => {
    const css = getComputedStyle(n), url = css.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]
      || css.borderImageSource.match(/url\(["']?(.*?)["']?\)/)?.[1];
    if (!url) throw Error(`No actual rendered image ${css.backgroundImage}/${css.borderImageSource}`);
    const image = new Image(); image.src = url; await image.decode();
    const response = await fetch(url); if (!response.ok) throw Error(`Image HTTP ${response.status}`);
    return { width: image.naturalWidth, height: image.naturalHeight, rect: n.getBoundingClientRect().toJSON(),
      opacity: css.opacity, visibility: css.visibility, display: css.display,
      bytes: [...new Uint8Array(await response.arrayBuffer())] };
  });
  const { bytes, ...rest } = result;
  assert.equal(hash(Buffer.from(bytes)), expected.sha256);
  assert(result.width > 0 && result.height > 0 && result.rect.width > 0 && result.rect.height > 0
    && result.opacity !== "0" && result.visibility === "visible" && result.display !== "none");
  return { ...rest, sha256: expected.sha256, relative };
}
async function geometry(locator, m) {
  const g = await locator.evaluate(n => {
    const r = n.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(n);
    const css = getComputedStyle(n), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rect: r.toJSON(), hit: hit === n || n.contains(hit), fontSize: parseFloat(css.fontSize),
      overflow: document.documentElement.scrollWidth - innerWidth,
      text: [...range.getClientRects()].filter(r => r.width && r.height).map(r => r.toJSON()) };
  });
  const r = g.rect;
  assert(g.hit && g.overflow <= 1 && r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1
    && r.right <= m.width + 1 && r.bottom <= m.height + 1, JSON.stringify(g));
  for (const t of g.text) assert(t.left >= r.left - 1 && t.top >= r.top - 1 && t.right <= r.right + 1 && t.bottom <= r.bottom + 1,
    `Text Range outside button: ${JSON.stringify(g)}`);
  return g;
}
async function platformFonts(selector) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("DOM.enable"); await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector }); assert(nodeId);
    return (await session.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
  } finally { await session.detach(); }
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
  assert.equal(sha(source.cartridge.path), source.cartridge.sha256);
  const zip = await JSZip.loadAsync(fs.readFileSync(source.cartridge.path), { checkCRC32: true });
  assert.equal(hash(await zip.file("ui/layout.json").async("nodebuffer")), source.cartridge.layoutSha256);
  assert.deepEqual(JSON.parse(await zip.file("ui/layout.json").async("string")), source.cartridge.layout);
  assert.equal(source.cartridge.assets.length, 6);
  for (const a of source.cartridge.assets) assert.equal(hash(await zip.file(a.path).async("nodebuffer")), a.sha256);
  protectedProfile = true; profiles("Prepare");
  const port = await new Promise(resolve => {
    const server = net.createServer(); server.listen(0, "127.0.0.1", () => {
      const p = server.address().port; server.close(() => resolve(p));
    });
  });
  assert.equal(listeners([port]).length, 0); assert(!rows().some(p => p.Name === "agentvn-player.exe"));
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(k)) delete env[k];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    AGENTVN_TEST_PROJECT: source.portable.path, AGENTVN_WORKSPACE_OUTPUT: out });
  const fd = fs.openSync(path.join(out, "player.log"), "wx");
  player = spawn(exe, ["--mode", "preview", "--cartridge", source.cartridge.path],
    { cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
  current = { pid: player.pid, port, at: new Date().toISOString(), executable: desc(exe),
    args: ["--mode", "preview", "--cartridge", source.cartridge.path],
    environment: { AGENTVN_TEST_PROJECT: source.portable.path, AGENTVN_WORKSPACE_OUTPUT: out } };
  report.launches.push(current); remember();
  await until(async () => {
    assert.equal(player.exitCode, null); remember();
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, "actual installed Player WebView", 60000);
  const tree = ownedProcessTree(rows(), player.pid, current.created);
  assert(listeners([port]).every(l => tree.some(p => p.ProcessId === l.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())), "Player page");
  page.setDefaultTimeout(30000); page.on("pageerror", e => { report.errors.push(String(e)); save(); });
  cdp = await page.context().newCDPSession(page);
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    const m = { width, height: width * 9 / 16, dpr, reduced };
    const item = { ...m, status: "RUNNING", checks: [], samples: {} }; report.cases.push(item); save();
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: m.height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    // Real WebView reload prepares a clean Runtime page for each display.
    // All subsequent navigation/selection uses real DOM mouse/keyboard input.
    await page.reload(); await page.getByTestId("game-state-title").waitFor(); await ready("title_menu");
    item.samples.titleImage = await image(page.locator(".main-menu-title-hero-background:visible"), "gui/main_menu.png");
    const start = page.getByTestId("start-new-game"); await page.mouse.move(width - 10, 10);
    // Bootstrap may focus the first item; remove focus using the real keyboard
    // before measuring the non-hovered normal state.
    if (await start.evaluate(n => n === document.activeElement)) await page.keyboard.press("Tab");
    item.samples.titleNormal = await image(start, "gui/button/quick_idle_background.png");
    item.samples.titleGeometry = await geometry(start, m);
    const scale = Number(await page.getByTestId("renpy-title-view").getAttribute("data-renpy-scale"));
    assert(Math.abs(item.samples.titleGeometry.fontSize - 22 * scale) <= .1);
    const gap = await page.locator(".renpy-title-navigation").evaluate(n => parseFloat(getComputedStyle(n).gap));
    assert(Math.abs(gap - 4 * scale) <= .1);
    item.samples.titleScale = scale; item.samples.titleGap = gap;
    await start.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    assert(await start.evaluate(n => n === document.activeElement && n.matches(":focus-visible")));
    item.samples.titleFocus = await image(start, "gui/button/quick_hover_background.png");
    await start.hover(); item.samples.titleHover = await image(start, "gui/button/quick_hover_background.png");
    item.checks.push({ name: "title-official-image-normal-hover-focus-font22-spacing4", status: "PASS" }); save();
    await page.getByTestId("open-settings").click(); await ready("settings");
    const help = page.getByTestId("renpy-menu-help"); await page.mouse.move(width - 10, 10);
    item.samples.menuNormal = await image(help, "gui/button/quick_idle_background.png");
    await help.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    assert(await help.evaluate(n => n === document.activeElement && n.matches(":focus-visible")));
    item.samples.menuFocus = await image(help, "gui/button/quick_hover_background.png");
    item.samples.menuGeometry = await geometry(help, m); await page.keyboard.press("Enter"); await ready("help");
    assert.equal(await page.getByTestId("renpy-menu-title").textContent(), "帮助");
    await page.getByTestId("renpy-menu-save-load").click(); await ready("save_load");
    const grid = await page.getByTestId("save-slot-grid").evaluate(n => ({ columns: getComputedStyle(n).gridTemplateColumns,
      declared: n.dataset.renpySaveColumns, slots: [...n.children].map(c => c.getBoundingClientRect().toJSON()) }));
    assert.equal(grid.declared, "3"); assert.equal(grid.columns.trim().split(/\s+/).length, 3); assert.equal(grid.slots.length, 6);
    assert(Math.abs(grid.slots[0].top - grid.slots[1].top) <= 1 && Math.abs(grid.slots[0].top - grid.slots[2].top) <= 1
      && grid.slots[3].top > grid.slots[0].bottom - 1);
    item.samples.grid = grid;
    await page.getByTestId("save-page-next").click(); await page.getByTestId("save-slot-manual-7").waitFor();
    await page.getByTestId("save-page-previous").click(); await page.getByTestId("save-slot-manual-1").waitFor();
    item.checks.push({ name: "shared-images-keyboard-help-three-column-six-slot-pages", status: "PASS" }); save();
    await page.getByTestId("renpy-menu-return").click(); await ready("title_menu");
    await start.click(); await ready("playing");
    const dialog = page.locator(".dialog-box:visible"); await dialog.waitFor();
    item.samples.dialogImage = await image(dialog, "gui/textbox.png");
    if (await page.getByTestId("game-state-playing").getAttribute("data-is-typing") === "true") await dialog.click();
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true"
      && document.querySelector(".dialog-text")?.textContent.includes("中文字体回退"));
    await page.evaluate(() => document.fonts.ready);
    item.samples.fonts = await platformFonts(".dialog-text");
    assert(item.samples.fonts.some(f => f.isCustomFont && /DejaVu/i.test(f.familyName) && f.glyphCount > 0), JSON.stringify(item.samples.fonts));
    assert(item.samples.fonts.some(f => !f.isCustomFont && /YaHei|SimSun|DengXian|CJK|Source Han/i.test(f.familyName)
      && f.glyphCount > 0), JSON.stringify(item.samples.fonts));
    const font = await page.evaluate(async () => {
      const rules = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } });
      const rule = rules.find(r => r.cssText.includes("@font-face") && r.cssText.includes("AgentVNFont_"));
      if (!rule) throw Error("Missing real imported @font-face");
      const url = rule.cssText.match(/url\(["']?(.*?)["']?\)/)?.[1]; if (!url) throw Error("Missing font URL");
      const response = await fetch(url); if (!response.ok) throw Error(`Font HTTP ${response.status}`);
      return [...new Uint8Array(await response.arrayBuffer())];
    });
    item.samples.fontBytes = { bytes: font.length, sha256: hash(Buffer.from(font)) };
    assert.equal(item.samples.fontBytes.sha256, source.cartridge.assets.find(a => a.relative === "DejaVuSans.ttf").sha256);
    item.checks.push({ name: "real-textbox-Latin-custom-Chinese-system-font-bytes", status: "PASS" }); save();
    if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced) {
      report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `dialog-${width}-${dpr}-${reduced}.png`), m)); save();
    }
    await page.getByTestId("renpy-quick-settings").click(); await ready("settings");
    await page.getByTestId("settings-finish").click(); await ready("playing");
    await dialog.click();
    const choice = page.getByRole("button", { name: "选择：再次检查 GUI_REPEAT", exact: true });
    await choice.waitFor(); await settleRuntime(page); item.samples.choiceImage = await image(choice, "gui/button/choice_idle_background.png");
    item.samples.choiceGeometry = await geometry(choice, m);
    await choice.focus(); await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector(".choice-panel")
      && document.querySelector(".dialog-text")?.textContent.includes("GUI_CONSUMPTION"));
    item.checks.push({ name: "dedicated-choice-image-precedence-real-selection-loop", status: "PASS" });
    assert.equal(item.checks.length, 4); item.status = "PASS"; save();
    console.log(`PASS installed GUI Player ${width}/${dpr}/${reduced}: four business checks`);
  }
  assert.equal(report.cases.length, 12); assert(report.cases.every(c => c.status === "PASS" && c.checks.length === 4));
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
    for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256, f.path);
  } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
