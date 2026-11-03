"use strict";
// Consume the exact new-workflow UI export in its installed native Player.
// Preview mode does not prove standalone saves, setup or Android behavior.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const { spawn } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const [inputAttempt, attempt] = process.argv.slice(2);
assert.match(inputAttempt, /^\d{2}$/); assert.match(attempt, /^\d{2}$/);
const qa = "F:/AgentVN/QA/Installed-GUI-Library-1922-20261022-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => A.sha256(fs.readFileSync(file));
const sourceFile = path.join(qa, `editor-${inputAttempt}/report.json`), source = read(sourceFile);
assert.equal(source.status, "EDITOR_PASS_NATIVE_PLAYER_NOT_RUN");
assert.equal(source.steps.length, 8); assert(source.steps.every(row => row.status === "PASS"));
assert.equal(source.matrix.length, 12); assert.equal(source.nativeCacheRestoration, "PASS");
assert.equal(sha(source.cartridge.path), source.cartridge.sha256); assert.equal(source.modelRequests, 0);
const installation = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json");
assert.equal(installation.status, "PASS");
const exe = path.join(installation.installRoot, "agentvn-player.exe");
const out = path.resolve(qa, `player-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], screenshots: [],
  errors: [], modelRequests: 0, source: { path: sourceFile, sha256: sha(sourceFile) },
  executable: { path: exe, sha256: sha(exe) }, scope: "INSTALLED_NATIVE_PREVIEW_OFFICIAL_GUI_EXACT_UI_EXPORT_12_DISPLAYS",
  boundaries: { standaloneGame: false, savesBesideExe: false, android: false,
    fullTransitionAudit: false, physical4K: false, normalWindowClose: false } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const known = new Map(), identity = row => `${row.ProcessId}:${row.Created}`;
let player, current, browser, page, cdp;
function remember() {
  if (player) for (const row of ownedProcessTree(rows(), player.pid, current.created)) {
    if (row.ProcessId === player.pid) current.created = row.Created;
    known.set(identity(row), row);
  }
  report.knownProcesses = [...known.values()]; save();
}
async function ready(screen) {
  await page.waitForFunction(screen => {
    const root = document.querySelector("[data-runtime-screen-transition]");
    return root?.getAttribute("data-runtime-presented-screen") === screen
      && root?.getAttribute("data-runtime-screen-transition") === "idle";
  }, screen);
  await A.settleRuntime(page);
}
async function image(locator, relative) {
  const expected = source.cartridge.assets.find(a => a.source === "官方模板 中文/game/" + relative); assert(expected, relative);
  const result = await locator.evaluate(async node => {
    const style = getComputedStyle(node), url = (style.backgroundImage + " " + style.borderImageSource).match(/url\(["']?(.*?)["']?\)/)?.[1];
    if (!url) throw Error("Actual resource missing from rendered style");
    const image = new Image(); image.src = url; await image.decode();
    const response = await fetch(url); if (!response.ok) throw Error("Resource fetch failed");
    return { width: image.naturalWidth, height: image.naturalHeight, rect: node.getBoundingClientRect().toJSON(),
      display: style.display, visibility: style.visibility, opacity: style.opacity,
      bytes: [...new Uint8Array(await response.arrayBuffer())] };
  });
  assert.equal(A.sha256(Buffer.from(result.bytes)), expected.sha256);
  assert(result.width > 0 && result.height > 0 && result.rect.width > 0 && result.rect.height > 0
    && result.visibility === "visible" && result.display !== "none" && result.opacity !== "0");
  const { bytes, ...geometry } = result;
  return { relative, sha256: expected.sha256, ...geometry };
}
async function hit(locator, m) {
  await locator.click({ trial: true });
  const value = await locator.evaluate(node => {
    const r = node.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rect: r.toJSON(), hit: node === top || node.contains(top), overflow: document.documentElement.scrollWidth - innerWidth };
  });
  const r = value.rect;
  assert(value.hit && value.overflow <= 1 && r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1
    && r.right <= m.width + 1 && r.bottom <= m.height + 1, JSON.stringify(value));
  return value;
}
async function fonts(selector) {
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector }); assert(nodeId);
  return (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
}
(async () => {
  save();
  const zip = await JSZip.loadAsync(fs.readFileSync(source.cartridge.path), { checkCRC32: true });
  assert.equal(A.sha256(await zip.file("ui/layout.json").async("nodebuffer")), source.cartridge.layoutSha256);
  for (const asset of source.cartridge.assets)
    assert.equal(A.sha256(await zip.file(asset.path).async("nodebuffer")), asset.sha256);
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(e => e ? reject(e) : resolve(p)); });
  });
  assert.equal(listeners([port]).length, 0);
  assert(!rows().some(row => /^(agentvn-player|agentvn-editor|creator-backend)\.exe$/i.test(row.Name)));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(key)) delete env[key];
  const temp = path.join(out, "temporary"); fs.mkdirSync(temp);
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, TEMP: temp, TMP: temp,
    AGENTVN_TEST_PROJECT: source.environment.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: out });
  player = spawn(exe, ["--mode", "preview", "--cartridge", source.cartridge.path],
    { cwd: installation.installRoot, env, windowsHide: true, stdio: "ignore" });
  current = { pid: player.pid, port, at: new Date().toISOString() }; report.launch = current; remember();
  await until(async () => {
    assert.equal(player.exitCode, null); remember();
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, "owned installed native Player", 60000);
  const owner = rows().find(row => row.ProcessId === player.pid); assert(owner);
  assert.equal(path.resolve(owner.ExecutablePath), path.resolve(exe));
  assert(listeners([port]).every(listener => [...known.values()].some(row => row.ProcessId === listener.OwningProcess)));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(context => context.pages()).find(page => /tauri\.localhost|^tauri:/.test(page.url())), "native Player page");
  page.setDefaultTimeout(30000); page.on("pageerror", error => { report.errors.push(String(error)); save(); });
  cdp = await page.context().newCDPSession(page);
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    const m = { width, height: width * 9 / 16, dpr, reduced };
    const row = { ...m, status: "RUNNING", checks: [] }; report.cases.push(row); save();
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: m.height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await readInstalledViewport(page, m);
    await page.reload(); await page.getByTestId("game-state-title").waitFor(); await ready("title_menu");
    row.title = await image(page.locator(".main-menu-title-hero-background:visible"), "gui/main_menu.png");
    const start = page.getByTestId("start-new-game");
    await page.mouse.move(width - 10, 10);
    row.start = await hit(start, m);
    row.normal = await image(start, "gui/button/quick_idle_background.png");
    await start.hover(); row.hover = await image(start, "gui/button/quick_hover_background.png");
    row.checks.push("title-background-button-normal-and-hover");
    // This control has a scoped imported hover image; it must not alter Start.
    const load = page.getByTestId("open-save-load"); await load.hover();
    row.scopedHover = await image(load, "gui/main_menu.png");
    row.checks.push("single-control-hover-overrides-shared-without-affecting-start");
    await start.click(); await ready("playing");
    const dialog = page.locator(".dialog-box:visible"); await dialog.waitFor();
    row.dialog = await image(dialog, "gui/textbox.png");
    if (await page.getByTestId("game-state-playing").getAttribute("data-is-typing") === "true") await dialog.click();
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true"
      && document.querySelector(".dialog-text")?.textContent.includes("中文字体回退"));
    await page.evaluate(() => document.fonts.ready);
    row.fonts = await fonts(".dialog-text");
    assert(row.fonts.some(font => font.isCustomFont && /DejaVu/i.test(font.familyName) && font.glyphCount > 0), JSON.stringify(row.fonts));
    assert(row.fonts.some(font => !font.isCustomFont && /YaHei|SimSun|DengXian|CJK|Source Han/i.test(font.familyName) && font.glyphCount > 0),
      JSON.stringify(row.fonts));
    row.checks.push("actual-dialog-resource-and-visible-Chinese-system-font-fallback");
    assert.equal(await page.locator(".renpy-quick-bar button").count(), 9);
    await page.getByTestId("renpy-quick-settings").click(); await ready("settings");
    await page.getByTestId("settings-finish").click(); await ready("playing");
    await dialog.click();
    const choice = page.getByRole("button", { name: "选择：再次检查 GUI_REPEAT", exact: true });
    await choice.waitFor(); await A.settleRuntime(page); row.choice = await image(choice, "gui/button/choice_idle_background.png");
    row.choiceHit = await hit(choice, m); await choice.focus(); await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector(".choice-panel") && document.querySelector(".dialog-text")?.textContent.includes("GUI_CONSUMPTION"));
    row.checks.push("nine-actions-menu-return-and-actual-choice-loop");
    if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)
      report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `native-official-${width}-${dpr}-${reduced}.png`), m));
    assert.equal(row.checks.length, 4); row.status = "PASS"; save();
    console.log(`PASS native official GUI ${width}/${dpr}/${reduced}`);
  }
  assert.equal(report.cases.length, 12); assert(report.cases.every(row => row.status === "PASS" && row.checks.length === 4));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) report.failureDOM = await page.locator("body").innerText().catch(String);
}).finally(async () => {
  try {
    remember(); await browser?.close();
    for (const row of [...known.values()].reverse()) if (rows().some(value => identity(value) === identity(row))) stopOwnedProcess(row, ps);
    if (current) await until(() => !rows().some(row => known.has(identity(row))) && listeners([current.port]).length === 0,
      "owned Player cleanup", 15000);
    assert.equal(sha(exe), report.executable.sha256); assert.equal(sha(source.cartridge.path), source.cartridge.sha256);
    report.cleanupStatus = "PASS";
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
