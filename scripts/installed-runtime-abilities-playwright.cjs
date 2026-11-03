"use strict";
// Actual installed library Player; only library preparation uses a public native
// command. All progression/save/load/rollback actions below use trusted UI input.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net"), assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const { sha256, settleRuntime } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-runtime-abilities-20261018-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const businessIndex = process.argv.indexOf("--business-viewport");
const business = businessIndex >= 0;
const businessViewport = business ? (() => {
  const [width, height, dpr, reduced] = process.argv.slice(businessIndex + 1, businessIndex + 5);
  assert(["true", "false"].includes(reduced));
  const v = { width: Number(width), height: Number(height), dpr: Number(dpr), reduced: reduced === "true" };
  assert([[1920,1080],[2560,1440],[3840,2160]].some(([w,h]) => v.width === w && v.height === h));
  assert([1,2].includes(v.dpr)); return v;
})() : null;
const flag = name => {
  const index = process.argv.indexOf(name);
  assert(index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--"), name);
  return path.resolve(process.argv[index + 1]);
};
const currentNative = process.argv.includes("--current-native-preparation");
const nativePreparation = currentNative ? read(flag("--current-native-preparation")) : null;
const current1922 = currentNative && nativePreparation.current1922Library === true;
const { captureInstalledWebview, readInstalledViewport } = require(currentNative
  ? "./lib/current-native-capture.cjs" : "./lib/installed-webview-capture.cjs");
const out = process.argv[2]; assert(out && !fs.existsSync(out)); fs.mkdirSync(out);
const artifactRoot = business ? flag("--artifact-root") : out;
if (business) {
  assert(artifactRoot.toLowerCase().startsWith("f:\\agentvn\\qa\\"));
  assert(!fs.existsSync(artifactRoot)); fs.mkdirSync(artifactRoot);
}
const exportsFile = currentNative ? nativePreparation.originalExport.path : path.join(run, "export-03/report.json");
const exported = currentNative ? { status: "PASS", cartridges: nativePreparation.cartridges } : read(exportsFile);
const fixture = currentNative ? nativePreparation.fixture : read(path.join(run, "fixtures-02.json"));
const launch = currentNative ? null : read(path.join(run, "launch.json"));
const prepFile = currentNative ? flag("--current-native-preparation")
  : business ? flag("--profile-preparation") : path.join(run, "preparation.json");
const prep = read(prepFile);
assert.equal(exported.status, "PASS"); assert.equal(exported.cartridges.length, 2);
assert(prep.profiles.every(p => fs.existsSync(p.held)), "All original profiles must remain protected");
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT),
  path.resolve(currentNative ? prep.sessionRoot : business ? path.dirname(out) : run));
const installRoot = currentNative ? path.dirname(prep.executable.path) : business ? prep.installRoot : launch.installRoot;
const exe = currentNative ? prep.executable.path : path.join(installRoot, "agentvn-player.exe");
const installId = currentNative ? prep.installId : business
  ? `qa_business_${path.basename(path.dirname(out))}_${path.basename(out)}`.replace(/\W/g,"_")
  : "qa_runtime_abilities_20261018";
assert.equal(sha256(fs.readFileSync(exe)), currentNative ? prep.executable.sha256
  : "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
if (currentNative) {
  assert.equal(prep.status, "PASS");
  assert.equal(sha256(fs.readFileSync(exportsFile)), prep.originalExport.sha256);
  assert.equal(sha256(fs.readFileSync(fixture.input)), fixture.inputSha256);
  assert(path.resolve(out).startsWith(path.resolve(prep.sessionRoot) + path.sep));
}
if (current1922) {
  assert(["CODEX_EXPLICIT_PROFILE_JUNCTION_LIBRARY",
    "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION"].includes(prep.defaultStorage));
  assert.equal(prep.executable.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
  assert.equal(read(exportsFile).scope,
    "ACTUAL_1922_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE");
  assert.equal(read(exportsFile).status, "PASS");
}
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], launches: [], screenshots: [],
  matrix: [], source: { path: exportsFile, sha256: sha256(fs.readFileSync(exportsFile)) },
  exe: { path: exe, sha256: sha256(fs.readFileSync(exe)) }, installId,
  scope: current1922 ? "ACTUAL_1922_SHIPPED_PLAYER_LIBRARY_FRESH_CURRENT_UI_EXPORT_CONTROLLED_LIBRARY_IMPORT_NOT_STANDALONE"
    : currentNative ? "CURRENT_NATIVE_RELEASE_PLAYER_LIBRARY_WITH_HISTORICAL_UI_EXPORTED_FIXTURE_NOT_NEW_INSTALL_EXPORT_OR_ANDROID"
    : "ACTUAL_INSTALLED_PLAYER_LIBRARY_NATIVE_SAVES; NOT_STANDALONE_EXE_SETUP_ANDROID",
  controlledBoundary: "Synthetic project imported by actual backend; actual UI vncart exports; library insertion through public native import command, NOT OS file-picker acceptance",
  productChanges: 0, realModelRequests: 0, pageErrors: [], error: null,
  businessViewport, profilePreparation: {path: prepFile, sha256: sha256(fs.readFileSync(prepFile))},
  artifactRoot, nativeSaves: [] };
report.runnerAtInvocation = { path: __filename, sha256: sha256(fs.readFileSync(__filename)) };
const matrixSource = currentNative
  ? process.argv.includes("--native-matrix-source") ? flag("--native-matrix-source") : null
  : business ? null : process.argv[3];
const crossOnly = currentNative ? process.argv.includes("--cross-layout-only") : process.argv[4] === "--cross-layout-only";
report.crossLayoutOnly = crossOnly;
const renpyOnly = process.argv.includes("--renpy-only");
const quickOnly = process.argv.includes("--quick-only");
report.layoutSubset = renpyOnly ? ["renpy"] : ["agentvn", "renpy"];
report.quickOnly = quickOnly;
if (matrixSource) {
  const previous = read(matrixSource);
  if (currentNative) assert.equal(previous.exe.sha256, report.exe.sha256);
  assert.equal(previous.source.sha256, report.source.sha256);
  assert.equal(previous.matrix.length, 24); assert(previous.matrix.every(r => r.status === "PASS"));
  for (const s of previous.screenshots) assert.equal(sha256(fs.readFileSync(s.path)), s.sha256);
  report.matrix = previous.matrix;
  report.reusedMatrix = { path: matrixSource, sha256: sha256(fs.readFileSync(matrixSource)),
    priorOverallStatus: previous.status, matrixOnly: true, reason: currentNative
      ? "Explicit same-binary prior display matrix; current cross-layout save actions run again, not a fresh display matrix"
      : "Continue after correcting the test-only saved-status CSS oracle; retain original FAILED report" };
}
let browser, page, cdp, child, owned, current, expected = businessViewport || { width: 1920, height: 1080, dpr: 1, reduced: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const pause = ms => new Promise(r => setTimeout(r, ms));
function processInfo(pid) {
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"|Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate|ConvertTo-Json`],
  { encoding: "utf8", windowsHide: true });
  return raw.trim() ? JSON.parse(raw.replace(/^\uFEFF/, "")) : null;
}
async function step(name, fn) {
  const row = { name, layout: current, status: "RUNNING" }; report.checks.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { save(); console.log(`${row.status} ${current} ${name}`); }
}
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(artifactRoot, `${current}-${name}.png`), expected)); save();
}
async function screenReady(screen) {
  await page.waitForFunction(s => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") === s && n?.getAttribute("data-runtime-screen-transition") === "idle"
      && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, screen);
  await settleRuntime(page);
}
async function native(command, args = {}) {
  return page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
}
async function saves() { return native("list_saves", { installId }); }
async function snapshot() {
  return page.locator(".dialog-box").evaluate(el => {
    const text = el.querySelector(".dialog-text") || el.querySelector(".nvl-page");
    const r = el.getBoundingClientRect(), t = text?.getBoundingClientRect();
    const range = document.createRange(); if (text) range.selectNodeContents(text);
    const lines = text ? Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0)
      .map(r => ({ x: r.x, y: r.y, right: r.right, bottom: r.bottom })) : [];
    return { mode: el.dataset.dialogueLayoutMode, fontMode: el.dataset.dialogFontMode,
      scale: Number(el.dataset.dialogFontScale), font: Number.parseFloat(getComputedStyle(text || el).fontSize),
      pages: Number(el.dataset.dialogPages), page: Number(el.dataset.dialogPage), done: el.dataset.dialogPageDone,
      anchor: el.dataset.dialogBubbleAnchor, tail: el.dataset.dialogBubbleTail,
      text: text?.textContent, full: el.getAttribute("aria-label"), nvl: Array.from(el.querySelectorAll("[data-nvl-line]")).map(e => e.textContent),
      rect: { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      textRect: t && { x: t.x, y: t.y, right: t.right, bottom: t.bottom }, lines,
      scroll: text && { client: text.clientHeight, actual: text.scrollHeight, width: text.clientWidth, actualWidth: text.scrollWidth },
      overflow: document.documentElement.scrollWidth - innerWidth,
      scene: document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-scene-id"),
      command: Number(document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-command-index")) };
  });
}
async function reveal() {
  const dialog = page.locator(".dialog-box");
  // A new page may already inherit the engine's reveal request. Its local
  // done flag catches up on the following rendered frame. Reading that
  // transient false and later clicking a completed page skips a real page.
  // Observe the settled rendering boundary, never add a blind timeout.
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await dialog.evaluate(el => ({
    page: el.dataset.dialogPage, pages: el.dataset.dialogPages, done: el.dataset.dialogPageDone,
    length: el.getAttribute("aria-label")?.length || 0,
    scene: document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-scene-id"),
    command: document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-command-index"),
  }));
  // Short lines can finish naturally between a remote read and its click. A
  // late reveal-click would legitimately advance the story. Wait for their
  // actual completion instead; only long pages need the real reveal action.
  if (before.length > 400 && before.done !== "true") {
    await dialog.click();
    const after = await dialog.evaluate(el => ({
      page: el.dataset.dialogPage, pages: el.dataset.dialogPages, done: el.dataset.dialogPageDone,
      scene: document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-scene-id"),
      command: document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-command-index"),
    }));
    (report.revealActions ??= []).push({ layout: current, before, after }); save();
    assert.equal(after.page, before.page, "Reveal must not consume a completed page");
    assert.equal(after.command, before.command, "Reveal must not advance the story");
    assert.equal(after.scene, before.scene);
  }
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
}
async function command(index, scene = "ordinary_nvl") {
  await page.waitForFunction(({ index, scene }) => {
    const n = document.querySelector('[data-testid="game-state-playing"]');
    return Number(n?.getAttribute("data-current-command-index")) === index && n?.getAttribute("data-current-scene-id") === scene;
  }, { index, scene });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await reveal();
}
async function advance() { await reveal(); await page.locator(".dialog-box").click(); }
async function textPages(original, mustPaginate = false) {
  await reveal(); const first = await snapshot(), pages = [], geometry = [];
  assert(first.pages > 0 && first.pages < 100);
  if (mustPaginate) assert(first.pages > 1, "Extreme text must paginate at the readable lower bound");
  for (let i = 1; i <= first.pages; i++) {
    await reveal(); const s = await snapshot(); assert.equal(s.page, i);
    pages.push(s.text); geometry.push({ page: i, ...s });
    assert(s.rect.x >= -1 && s.rect.y >= -1 && s.rect.right <= expected.width + 1 && s.rect.bottom <= expected.height + 1);
    assert(s.overflow <= 1); assert(s.scroll.actualWidth <= s.scroll.width + 1, "Text must not horizontally overflow");
    assert(s.scroll.actual <= s.scroll.client + 2, "Each measured text page must fit its text region");
    if (i < first.pages) { await page.locator(".dialog-box").click(); await page.waitForFunction(i =>
      Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-page")) === i + 1, i); }
  }
  assert.equal(pages.join(""), original, "Pagination must preserve every original character exactly once");
  return { pages: first.pages, fontMode: first.fontMode, scale: first.scale, font: first.font, geometry };
}
async function saveUI(slot) {
  if (current === "renpy") await page.getByTestId("renpy-quick-save-load").click();
  else { await page.getByTestId("quick-menu-toggle").click(); await page.getByRole("button", { name: "打开存档读档", exact: true }).click(); }
  await screenReady("save_load");
  await page.getByRole("tab", { name: "手动", exact: true }).click();
  await page.getByTestId(`save-slot-manual-${slot}`).locator(".save-card-main").click();
  await page.waitForFunction(() => document.querySelector(".save-operation-status")?.classList.contains("is-saved"));
  const all = await saves(), stored = all.find(s => (s.save_kind || "manual") === "manual" && s.slot === slot); assert(stored);
  if (business) await retainSave(stored, `${current}-manual-${slot}`);
  await page.keyboard.press("Escape"); await screenReady("playing"); await reveal(); return stored;
}
async function retainSave(stored, label) {
  const info = await native("get_save_storage_info", { installId });
  assert.equal(info.portable, false);
  const matches = fs.readdirSync(info.targetDirectory).filter(f => f.endsWith(".json"))
    .map(name => ({ path: path.join(info.targetDirectory, name) }))
    .filter(f => read(f.path).save_id === stored.save_id);
  assert.equal(matches.length, 1);
  const source = matches[0].path, bytes = fs.readFileSync(source);
  const retained = path.join(artifactRoot, `${label}.json`);
  fs.copyFileSync(source, retained, fs.constants.COPYFILE_EXCL);
  assert.equal(sha256(fs.readFileSync(retained)), sha256(bytes));
  report.nativeSaves.push({ source, retained, sha256: sha256(bytes), bytes: bytes.length,
    saveId: stored.save_id, layout: current, generatedAt: fs.statSync(source).mtime.toISOString() });
  save();
}
async function loadUI(slot) {
  await page.keyboard.press("Escape"); await screenReady("main_menu");
  await page.getByTestId("open-save-load").click(); await screenReady("save_load");
  await page.getByRole("tab", { name: "手动", exact: true }).click();
  await page.getByRole("button", { name: "读取", exact: true }).click();
  await page.getByTestId(`save-slot-manual-${slot}`).locator(".save-card-main").click();
  await screenReady("playing"); await reveal();
}
async function matrix() {
  for (const [width, height] of (business ? [[businessViewport.width,businessViewport.height]] : [[1920, 1080], [2560, 1440], [3840, 2160]]))
    for (const dpr of (business ? [businessViewport.dpr] : [1, 2]))
      for (const reduced of (business ? [businessViewport.reduced] : [false, true])) {
    expected = { width, height, dpr, reduced }; const row = { layout: current, ...expected, status: "RUNNING" }; report.matrix.push(row); save();
    try {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" }); await readInstalledViewport(page, expected);
      await reveal(); row.dialog = await snapshot(); assert(row.dialog.overflow <= 1);
      row.controls = await page.locator(current === "renpy" ? ".renpy-quick-action" : '[data-testid="quick-menu-toggle"]').evaluateAll(nodes => nodes.map(e => {
        const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { text: e.textContent, hit: Boolean(hit && (hit === e || e.contains(hit))),
          x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }));
      assert.equal(row.controls.length, current === "renpy" ? (current1922 ? 9 : 8) : 1);
      assert(row.controls.every(c => c.hit && c.x >= -1 && c.y >= -1 && c.right <= width + 1 && c.bottom <= height + 1));
      if (current === "renpy") assert(Math.max(...row.controls.map(c => c.y)) - Math.min(...row.controls.map(c => c.y)) < 1);
      await shot(`ordinary-${width}-${dpr}-${reduced}`); row.status = "PASS";
    } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
    save();
  }
  if (business) return;
  expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
}
async function start(cartridge) {
  const port = await new Promise(r => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
  const env = { ...process.env }; for (const key of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(key)) delete env[key];
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
  if (currentNative) {
    Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: prep.webview, TEMP: prep.temporary, TMP: prep.temporary });
    const log = fs.openSync(path.join(out, `${current}-player.log`), "wx");
    try { child = spawn(exe, ["--mode", "library"], { cwd: installRoot, env, windowsHide: true, stdio: ["ignore", log, log] }); }
    finally { fs.closeSync(log); }
  } else child = spawn(exe, ["--mode", "library"], { cwd: installRoot, env, windowsHide: true, stdio: "ignore" });
  owned = processInfo(child.pid); assert(owned && path.resolve(owned.ExecutablePath).toLowerCase() === path.resolve(exe).toLowerCase());
  report.launches.push({ layout: current, pid: child.pid, cdpPort: port, identity: owned,
    ...(currentNative ? { webview: prep.webview, isolatedLibraryViaProtectedJunction:
      ["PROTECTED_JUNCTION_TO_F", "CODEX_EXPLICIT_PROFILE_JUNCTION_LIBRARY"].includes(prep.defaultStorage),
      libraryStorage: prep.defaultStorage } : {}) }); save();
  const deadline = Date.now() + 45000; let ready = false;
  while (Date.now() < deadline && child.exitCode === null) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (ready) break; await pause(100);
  } assert(ready);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page); page.setDefaultTimeout(20000);
  page.on("pageerror", e => report.pageErrors.push({ layout: current, error: String(e) })); cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: expected.width, height: expected.height, deviceScaleFactor: expected.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: expected.reduced ? "reduce" : "no-preference" });
  await readInstalledViewport(page, expected); await page.getByTestId("game-state-library").waitFor();
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path)), m = JSON.parse(await zip.file("manifest.json").async("string"));
  const records = await native("list_installed_cartridges");
  const existing = records.find(r => r.installId === installId), now = new Date().toISOString();
  const before = await saves();
  const record = await native("import_cartridge_from_path", { sourcePath: cartridge.path, record: {
    installId, gameId: m.game_id, title: m.title, author: m.author, version: m.version, language: m.language,
    description: m.description, sourceFileName: path.basename(cartridge.path), installedAt: existing?.installedAt || now,
    updatedAt: now, cartridgePath: existing?.cartridgePath || "" } });
  assert.equal(sha256(fs.readFileSync(record.cartridgePath)), cartridge.sha256);
  report.launches.at(-1).libraryPreparation = { controlledPublicNativeCommand: true, normalFilePickerClaim: false, record, savesBefore: before };
  assert.deepEqual(await saves(), before, "Changing only layout through library replacement must not alter any save");
  await page.reload({ waitUntil: "domcontentloaded" });
  const ordered = await native("list_installed_cartridges");
  await page.waitForFunction(count => document.querySelectorAll(".cartridge-spine").length === count, ordered.length);
  assert.deepEqual(await page.locator(".cartridge-spine strong").allTextContents(), ordered.map(r => r.title));
  const selectedIndex = ordered.findIndex(r => r.installId === installId); assert(selectedIndex >= 0);
  await page.locator(".cartridge-spine").nth(selectedIndex).click();
  await page.getByRole("button", { name: "启动卡带", exact: true }).click(); await screenReady("title_menu");
}
async function stop() {
  await browser?.close().catch(() => {}); browser = null; page = null; cdp = null;
  const row = report.launches.at(-1); if (!child || !row) return;
  row.cleanup = { status: "RUNNING", method: "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE" }; save();
  if (child.exitCode === null) {
    assert.deepEqual(processInfo(child.pid), owned, "PID/path/parent/creation identity must match before termination");
    child.kill(); await new Promise(r => child.exitCode !== null ? r() : child.once("exit", r));
  }
  let listening = true; const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { await fetch(`http://127.0.0.1:${row.cdpPort}/json/version`, { signal: AbortSignal.timeout(250) }); }
    catch { listening = false; break; } await pause(100);
  }
  assert(!processInfo(row.pid) && !listening); row.cleanup.status = "PASS"; child = null; owned = null; save();
}
async function quickFlow() {
  if (!quickOnly) {
    await advance(); await page.getByRole("button", { name: "选择：进入存档验收", exact: true }).click(); await command(0, "saves");
  } else {
    const initial = (await saves()).filter(s => s.save_kind === "quick");
    assert(initial.length > 0 && initial.every(s => s.scene_id === "saves" && s.command_index === 0));
    await page.getByTestId("open-save-load").click(); await screenReady("save_load");
    await page.getByRole("tab", { name: "快存", exact: true }).click();
    await page.getByTestId(`save-slot-quick-${initial[0].slot}`).locator(".save-card-main").click();
    await screenReady("playing"); await command(0, "saves");
  }
  const priorQuick = (await saves()).filter(s => s.save_kind === "quick");
  const details = { writes: [], priorQuick, noSaveFeedback: "NOT_RUN_EXISTING_QUICK_SAVES" };
  report.quickProgress = details; save();
  if (!priorQuick.length) {
    await page.getByTestId("renpy-quick-load").click();
    await page.getByText("没有可读取的有效快存，请先快速保存。", { exact: true }).waitFor();
    assert.equal(await page.getByTestId("confirm-quick-load").count(), 0);
    details.noSaveFeedback = "PASS"; save();
  }
  const manual = (await saves()).filter(s => (s.save_kind || "manual") === "manual");
  for (let i = 0; i < 7; i++) {
    const before = (await saves()).map(s => s.save_id);
    await page.getByTestId("renpy-quick-save").click();
    const deadline = Date.now() + 10000; let created;
    while (Date.now() < deadline) {
      created = (await saves()).find(s => s.save_kind === "quick" && !before.includes(s.save_id));
      if (created) break; await pause(80);
    }
    assert(created, "One real quick-save action must create a durable new save");
    assert.equal(created.command_index, i);
    await page.waitForFunction(() => document.querySelector('[data-testid="renpy-quick-save"]')?.getAttribute("aria-busy") !== "true");
    details.writes.push(created); save();
    if (i < 6) { await advance(); await command(i + 1, "saves"); }
  }
  const all = await saves(), retained = all.filter(s => s.save_kind === "quick");
  assert.equal(retained.length, 6);
  assert.deepEqual(retained.map(s => s.command_index).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(all.filter(s => (s.save_kind || "manual") === "manual"), manual);
  if (business) for (const item of retained) await retainSave(item, `${current}-quick-${item.slot}`);
  await advance(); await command(7, "saves");
  await page.getByTestId("renpy-quick-load").click(); await page.getByTestId("confirm-quick-load").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click(); await command(7, "saves");
  await page.getByTestId("renpy-quick-load").click(); await page.getByTestId("confirm-quick-load").click();
  await screenReady("playing"); await command(6, "saves");
  await page.getByTestId("renpy-quick-save-load").click(); await screenReady("save_load");
  await page.getByRole("tab", { name: "快存", exact: true }).click();
  assert.equal(await page.locator(".save-slot.has-save").count(), 6); await shot("six-quick-saves");
  await page.getByRole("tab", { name: "手动", exact: true }).click(); assert.equal(await page.locator(".save-slot").count(), 6);
  await page.getByTestId("save-page-next").click(); await page.getByTestId("save-slot-manual-7").waitFor();
  assert.equal(await page.getByTestId("save-slot-manual-1").count(), 0);
  await page.getByTestId("save-page-previous").click(); await page.getByTestId("save-slot-manual-1").waitFor();
  return { ...details, retained, manualUnchanged: true, cancelPreservesCommand: 7, loadedCommand: 6,
    sixSlotsPerPage: true, invalidLatestFallback: "NOT_RUN", quickWriteFailure: "NOT_RUN", concurrentSubmission: "NOT_RUN" };
}
(async () => {
  for (const cartridge of (crossOnly || quickOnly ? [] : exported.cartridges.filter(c => !renpyOnly || c.layout === "renpy"))) {
    current = cartridge.layout;
    try {
      await step("Controlled native library preparation then real card/title entry with unchanged save bytes", () => start(cartridge));
      await step("Explicit ordinary mode overrides inherited bubble and retains configured short-text size", async () => {
        await page.getByTestId("start-new-game").click(); await screenReady("playing"); await command(0);
        const s = await snapshot(); assert.equal(s.mode, "dialog"); assert.equal(s.fontMode, "configured"); assert.equal(s.pages, 1);
        if (!matrixSource) await matrix(); return s;
      });
      await step("Long ordinary text shrinks and every page preserves exact text without clipping", async () => {
        await advance(); await command(1); const result = await textPages(fixture.text.mid);
        if (business) {
          const short = report.checks.find(c => c.layout === current
            && c.name.startsWith("Explicit ordinary mode")).detail;
          assert(["configured","adaptive"].includes(result.fontMode));
          assert(result.scale > 0 && result.scale <= 1 && result.font <= short.font + .1);
          if(result.fontMode === "adaptive") assert(result.scale < 1);
          else assert.equal(result.font, short.font);
        } else {
          assert.equal(result.fontMode, "adaptive"); assert(result.scale > 0 && result.scale < 1);
        }
        await shot("adaptive-long"); return result;
      });
      await step("Extreme ordinary text uses readable lower-bound pagination without omission or duplication", async () => {
        await advance(); await command(2); const result = await textPages(fixture.text.extreme, true); await shot("extreme-last-page"); return result;
      });
      await step("NVL inheritance accumulates once, native manual save/load and rollback preserve exact page", async () => {
        await advance(); await command(3); assert.equal((await snapshot()).mode, "nvl");
        await advance(); await command(4); await advance(); await command(5);
        const before = await snapshot(); assert.equal(before.nvl.length, 3);
        assert(before.nvl[0].includes("NVL_ONE") && before.nvl[1].includes("NVL_TWO") && before.nvl[2].includes("NVL_THREE"));
        const stored = await saveUI(1); assert.equal(stored.nvl_page.length, 3); assert.equal(stored.nvl_presentation_mode, "nvl");
        await advance(); await command(6); assert.equal((await snapshot()).nvl.length, 1);
        assert((await snapshot()).text.includes("NVL_CLEAR"));
        await loadUI(1); await command(5); assert.deepEqual((await snapshot()).nvl, before.nvl);
        // A fresh load need not retain pre-load rollback history. Advance from
        // the loaded page, then test the real newly-created rollback checkpoint.
        await advance(); await command(6); assert.equal((await snapshot()).nvl.length, 1);
        await page.keyboard.press("PageUp"); await command(5); assert.deepEqual((await snapshot()).nvl, before.nvl);
        await page.keyboard.press("PageDown"); await command(6); assert.equal((await snapshot()).nvl.length, 1);
        await page.keyboard.press("PageUp"); await command(5); assert.deepEqual((await snapshot()).nvl, before.nvl);
        await shot("nvl-restored"); return { before, stored, restored: await snapshot(), noAudioFixture: true, voiceReplayClaim: false };
      });
      await step("NVL explicit clear and branch transition clear accumulation without deleting history", async () => {
        await advance(); await command(6); const cleared = await snapshot(); assert.equal(cleared.nvl.length, 1);
        await advance(); await page.getByRole("button", { name: "选择：进入气泡验收", exact: true }).click();
        await command(1, "bubble"); const s = await snapshot(); assert.equal(s.mode, "bubble");
        assert.equal(s.anchor, "character"); assert.equal(s.nvl.length, 0); return { cleared, bubble: s };
      });
      await step("Bubble follows actor/camera, saves/loads, falls back after departure and clamps fixed anchors", async () => {
        const left = await snapshot(); await advance(); await command(4, "bubble"); const moved = await snapshot();
        assert.equal(moved.anchor, "character"); assert(moved.rect.x > left.rect.x, "Bubble should move right with actor");
        const stored = await saveUI(2); assert.equal(stored.nvl_presentation_mode, "bubble");
        await advance(); await command(6, "bubble"); const absent = await snapshot(); assert.equal(absent.anchor, "fallback");
        await loadUI(2); await command(4, "bubble"); assert.equal((await snapshot()).anchor, "character");
        await advance(); await command(6, "bubble"); await advance(); await command(7, "bubble");
        const fixed = await snapshot(); assert.equal(fixed.anchor, "fixed");
        assert(fixed.rect.x >= -1 && fixed.rect.y >= -1 && fixed.rect.right <= expected.width + 1 && fixed.rect.bottom <= expected.height + 1);
        await advance(); await command(8, "bubble"); const long = await textPages(fixture.text.bubbleLong, true);
        await shot("bubble-long-last"); return { left, moved, stored, absent, fixed, long };
      });
      if (current === "renpy") await step("Real quick-save actions keep latest six independently, quick-load requires confirmation and restores latest", quickFlow);
    } catch (e) {
      report.layoutErrors ??= []; report.layoutErrors.push({ layout: current, error: String(e.stack || e) });
      if (page) { report.failureText ??= {}; report.failureText[current] = (await page.locator("body").innerText().catch(() => "")).slice(-5000);
        await shot("failure").catch(() => {}); }
    } finally { await stop(); }
  }
  if (quickOnly) {
    current = "renpy";
    try {
      await step("Controlled native library preparation then real card/title entry with unchanged save bytes",
        () => start(exported.cartridges.find(c => c.layout === "renpy")));
      await step("Real quick-save actions keep latest six independently, quick-load requires confirmation and restores latest", quickFlow);
    } catch (e) {
      report.error = String(e.stack || e);
      if (page) { report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-5000);
        await shot("quick-only-failure").catch(() => {}); }
    } finally { await stop(); }
  }
  if (crossOnly) {
    current = "agentvn";
    try {
      await step("After actual Renpy process exit, AgentVN library update reads its quick/manual saves without identity or byte changes", async () => {
        await start(exported.cartridges.find(c => c.layout === "agentvn"));
        const before = await saves(), quick = before.filter(s => s.save_kind === "quick");
        assert.equal(quick.length, 6); assert.equal(before.filter(s => (s.save_kind || "manual") === "manual").length, 2);
        const latest = quick.toSorted((a, b) => b.created_at.localeCompare(a.created_at))[0];
        assert.equal(latest.command_index, 6); assert.equal(latest.scene_id, "saves");
        await page.getByTestId("open-save-load").click(); await screenReady("save_load");
        await page.getByRole("tab", { name: "快存", exact: true }).click();
        assert.equal(await page.locator(".save-slot.has-save").count(), 6);
        await shot("renpy-quick-saves-visible");
        await page.getByTestId(`save-slot-quick-${latest.slot}`).locator(".save-card-main").click();
        await screenReady("playing"); await command(6, "saves");
        const restored = await snapshot(); assert.equal(restored.mode, "dialog");
        await page.keyboard.press("Escape"); await screenReady("main_menu");
        await page.getByTestId("open-save-load").click(); await screenReady("save_load");
        await page.getByRole("tab", { name: "手动", exact: true }).click();
        await page.getByRole("button", { name: "读取", exact: true }).click();
        const manualCard = page.getByTestId("save-slot-manual-2").locator(".save-card-main");
        assert.equal(await manualCard.getAttribute("aria-label"), "读取手动存档 2");
        await manualCard.click();
        await screenReady("playing"); await command(4, "bubble"); assert.equal((await snapshot()).mode, "bubble");
        assert.deepEqual(await saves(), before, "Actual cross-layout reads must not mutate saves");
        const storage = await native("get_save_storage_info", { installId });
        assert.equal(storage.portable, false, "Library save location is NOT standalone portable saves acceptance");
        const retainedDirectory = path.join(path.dirname(fixture.input), `${path.basename(out)}-native-saves`);
        assert(!fs.existsSync(retainedDirectory)); fs.mkdirSync(retainedDirectory);
        const files = fs.readdirSync(storage.targetDirectory).filter(f => f.endsWith(".json")).map(name => {
          const file = path.join(storage.targetDirectory, name), bytes = fs.readFileSync(file);
          const retained = path.join(retainedDirectory, name);
          fs.copyFileSync(file, retained, fs.constants.COPYFILE_EXCL); assert.equal(sha256(fs.readFileSync(retained)), sha256(bytes));
          return { path: file, retained, sha256: sha256(bytes), bytes: bytes.length, data: JSON.parse(bytes) };
        });
        assert(files.length >= 8);
        // Library saves intentionally retain the existing install identity in
        // game_id. Only fixed standalone exports use the manifest game identity.
        for (const s of before) assert(files.some(f => f.data.save_id === s.save_id && f.data.install_id === installId && f.data.game_id === installId));
        await shot("renpy-bubble-save-loaded");
        return { storage, before, loadedLatestQuick: latest.save_id, restored, files, realPlayerRestart: true,
          nativePickerClaim: false, standaloneExeSaveLocationClaim: false };
      });
    } catch (e) { report.error = String(e.stack || e); if (page) await shot("cross-layout-failure").catch(() => {}); }
    finally { await stop(); }
  }
  report.status = report.checks.length >= (business ? 15 : crossOnly ? 1 : quickOnly ? 2 : renpyOnly ? 8 : 12) && report.checks.every(c => c.status === "PASS")
    && report.matrix.length === (business ? 2 : 24) && report.matrix.every(c => c.status === "PASS") && !report.pageErrors.length ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try { await stop(); } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.map(c => ({ name: c.name, layout: c.layout, status: c.status, error: c.error })),
    matrix: report.matrix.length, cleanupError: report.cleanupError, error: report.error, out }, null, 2));
});
