"use strict";
// Acceptance tooling only. Installed native Player, trusted WebView input.
// Public native commands prepare/inspect the library; no store/Tauri mocking.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process"), net = require("node:net");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const { sha256, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => sha256(fs.readFileSync(f));
const root = "D:/AgentVN", previous = path.join(root, "output/installed-runtime-abilities-20261018-01");
const run = path.join(root, "output/installed-runtime-exceptions-20261018-01");
const work = "F:/AgentVN-QA-InstalledRuntimeExceptions-20261018-01";
const out = process.argv[2]; assert(out && path.dirname(path.resolve(out)) === path.resolve(run) && !fs.existsSync(out));
const historyOnly = process.argv.includes("--history-only");
const followup = process.argv.includes("--followup") || historyOnly;
const prep = read(path.join(run, "preparation.json")), sourceFile = path.join(previous, "export-03/report.json");
const source = read(sourceFile), fixture = read(path.join(previous, "fixtures-02.json"));
assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
assert.equal(source.status, "PASS"); assert.equal(source.cartridges.length, 2);
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
const exe = path.join(prep.installRoot, "agentvn-player.exe"), exeSha = sha(exe);
assert.equal(exeSha, "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
for (const c of source.cartridges) assert.equal(sha(c.path), c.sha256);
fs.mkdirSync(out);
const installId = "qa_runtime_exceptions_20261018";
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], launches: [], screenshots: [], matrix: [],
  scope: "INSTALLED_PLAYER_LIBRARY_NOT_STANDALONE_WINDOWS_SETUP_ANDROID", installId,
  source: { path: sourceFile, sha256: sha(sourceFile) }, fixture: { path: fixture.input, sha256: sha(fixture.input) },
  exe: { path: exe, sha256: exeSha }, tool: { path: __filename, sha256: sha(__filename) },
  controlledBoundaries: ["Public native library import/inspection (not OS file picker)",
    "Corrupt only this QA install's newest quick-save while Player is stopped",
    "Real Windows sharing lock denies atomic overwrite, NOT an ACL test"],
  productChanges: 0, realModelRequests: 0, pageErrors: [], faultRestoration: [], error: null };
if (followup) {
  const original = path.join(run, "exceptions-01/report.json"), first = read(original);
  assert.equal(first.status, "FAILED"); assert.equal(first.checks.length, 8);
  assert([0, 1, 2, 3, 5].every(i => first.checks[i].status === "PASS"));
  assert.equal(first.source.sha256, report.source.sha256);
  assert(first.launches.every(l => l.cleanup.status === "PASS"));
  report.continuation = { path: original, sha256: sha(original), originalStatus: "FAILED",
    onlyPassingCasesReferenced: [0, 1, 2, 3, 5],
    correction: "Separate single-click write denial from overlapping-success double click; history compares text content, not the accessible action/speaker label" };
}
let browser, page, cdp, child, owned, current = "renpy", lockChild, pendingRestore;
let expected = { width: 1920, height: 1080, dpr: 1, reduced: false }, storage;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const pause = ms => new Promise(r => setTimeout(r, ms));
function info(pid) {
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"|Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate|ConvertTo-Json`],
  { encoding: "utf8", windowsHide: true });
  return raw.trim() ? JSON.parse(raw.replace(/^\uFEFF/, "")) : null;
}
async function check(name, fn) {
  const row = { name, layout: current, status: "RUNNING" }; report.checks.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) {
    row.status = "FAILED"; row.error = String(e.stack || e);
    if (page) {
      row.body = (await page.locator("body").innerText().catch(() => "")).slice(-7000);
      await shot(`failure-${report.checks.length}`).catch(() => {});
    }
  } finally { save(); console.log(`${row.status}: ${name}`); }
  return row.status === "PASS";
}
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${current}-${name}.png`), expected)); save();
}
async function ready(screen) {
  await page.waitForFunction(s => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.getAttribute("data-runtime-presented-screen") === s && n?.getAttribute("data-runtime-screen-transition") === "idle"
      && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, screen);
  await settleRuntime(page);
}
const native = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const saves = () => native("list_saves", { installId });
const quicks = async () => (await saves()).filter(s => s.save_kind === "quick");
async function state() {
  return page.locator('[data-testid="game-state-playing"]').evaluate(e => ({
    scene: e.getAttribute("data-current-scene-id"), command: Number(e.getAttribute("data-current-command-index")),
    text: document.querySelector(".dialog-box")?.getAttribute("aria-label"),
    dialogText: document.querySelector(".dialog-text")?.textContent,
  }));
}
async function command(index) {
  await page.waitForFunction(i => Number(document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-command-index")) === i, index);
  const d = page.locator(".dialog-box"), text = await d.getAttribute("aria-label");
  if ((text || "").length > 400 && await d.getAttribute("data-dialog-page-done") !== "true") await d.click();
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
}
async function start() {
  assert(!child); expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  const port = await new Promise(r => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
  const env = { ...process.env }; for (const key of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(key)) delete env[key];
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
  child = spawn(exe, ["--mode", "library"], { cwd: prep.installRoot, env, windowsHide: true, stdio: "ignore" });
  owned = info(child.pid); assert(owned && path.resolve(owned.ExecutablePath).toLowerCase() === path.resolve(exe).toLowerCase());
  const launch = { layout: current, pid: child.pid, port, identity: owned }; report.launches.push(launch); save();
  const deadline = Date.now() + 45000; let online = false;
  while (Date.now() < deadline && child.exitCode === null) {
    try { online = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (online) break; await pause(100);
  }
  assert(online); browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(15000); page.on("pageerror", e => report.pageErrors.push({ layout: current, error: String(e) }));
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" }); await page.getByTestId("game-state-library").waitFor();
  const cartridge = source.cartridges.find(c => c.layout === current);
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path)), m = JSON.parse(await zip.file("manifest.json").async("string"));
  const existing = (await native("list_installed_cartridges")).find(r => r.installId === installId), now = new Date().toISOString();
  const before = await saves();
  const record = await native("import_cartridge_from_path", { sourcePath: cartridge.path, record: {
    installId, gameId: m.game_id, title: m.title, author: m.author, version: m.version, language: m.language,
    description: m.description, sourceFileName: path.basename(cartridge.path), installedAt: existing?.installedAt || now,
    updatedAt: now, cartridgePath: existing?.cartridgePath || "" } });
  assert.equal(sha(record.cartridgePath), cartridge.sha256); assert.deepEqual(await saves(), before);
  launch.library = { nativeControlledPreparation: true, record, savesBefore: before };
  storage = await native("get_save_storage_info", { installId }); assert.equal(storage.portable, false);
  assert.equal(path.resolve(storage.targetDirectory), path.resolve(`C:/Users/1/AppData/Roaming/com.agentvn.player/saves/${installId}`));
  report.storage = storage; save();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".cartridge-spine").filter({ hasText: fixture.title }).click();
  await page.getByRole("button", { name: "启动卡带", exact: true }).click(); await ready("title_menu");
  await page.getByTestId("start-new-game").click(); await ready("playing"); await command(0);
}
async function stop() {
  await browser?.close().catch(() => {}); browser = null; page = null; cdp = null;
  if (!child) return;
  const launch = report.launches.at(-1);
  if (child.exitCode === null) {
    assert.deepEqual(info(child.pid), owned, "Exact process identity before termination");
    child.kill(); await new Promise(r => child.exitCode !== null ? r() : child.once("exit", r));
  }
  const deadline = Date.now() + 10000; let listening = true;
  while (Date.now() < deadline) {
    try { await fetch(`http://127.0.0.1:${launch.port}/json/version`, { signal: AbortSignal.timeout(250) }); }
    catch { listening = false; break; } await pause(100);
  }
  assert(!info(launch.pid) && !listening);
  launch.cleanup = { status: "PASS", method: "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE" }; child = null; owned = null; save();
}
function files() {
  return fs.existsSync(storage.targetDirectory) ? fs.readdirSync(storage.targetDirectory).filter(n => /^quick-\d\d\.json$/.test(n))
    .sort().map(n => ({ name: n, path: path.join(storage.targetDirectory, n), sha256: sha(path.join(storage.targetDirectory, n)),
      bytes: fs.statSync(path.join(storage.targetDirectory, n)).size })) : [];
}
async function writeQuick() {
  const before = await quicks();
  await page.getByTestId("renpy-quick-save").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="renpy-quick-save"]')?.getAttribute("aria-busy") !== "true");
  const after = await quicks(), fresh = after.filter(s => !before.some(b => b.save_id === s.save_id));
  assert.equal(fresh.length, 1, "A real click writes exactly one new save");
  return fresh[0];
}
async function history() {
  if (current === "renpy") await page.getByTestId("renpy-quick-history").click();
  else {
    await page.getByTestId("quick-menu-toggle").click();
    await page.getByRole("button", { name: "打开历史记录", exact: true }).click();
  }
  await ready("history");
}
async function noQuickMatrix() {
  const before = await quicks(); assert.equal(before.length, 0);
  const initial = await state();
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    expected = { width, height, dpr, reduced };
    const row = { ...expected, layout: current, status: "RUNNING" }; report.matrix.push(row); save();
    try {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" }); await readInstalledViewport(page, expected);
      await page.getByTestId("renpy-quick-load").click();
      await page.getByText("没有可读取的有效快存，请先快速保存。", { exact: true }).waitFor();
      assert.equal(await page.getByTestId("confirm-quick-load").count(), 0); assert.deepEqual(await state(), initial);
      const toast = page.locator(".save-status-toast.is-error"); await toast.waitFor();
      row.geometry = await toast.evaluate(e => {
        const r = e.getBoundingClientRect(), b = document.querySelector('[data-testid="renpy-quick-load"]'), q = b.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, overflow: document.documentElement.scrollWidth - innerWidth,
          buttonHit: b.contains(document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2)) };
      });
      assert(row.geometry.x >= -1 && row.geometry.y >= -1 && row.geometry.right <= width + 1 && row.geometry.bottom <= height + 1);
      assert(row.geometry.overflow <= 1 && row.geometry.buttonHit);
      await shot(`no-save-${width}-${dpr}-${reduced}`); row.status = "PASS";
    } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
    save();
  }
  assert.equal(report.matrix.length, 12); assert(report.matrix.every(r => r.status === "PASS"));
  expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" }); assert.equal((await quicks()).length, 0);
  return { combinations: 12, initial, noNativeWrite: true, fullQuickBusinessMatrixClaim: false };
}
async function offlineCorrupt(file) {
  await stop(); const bytes = fs.readFileSync(file);
  const retained = path.join(work, `${path.basename(out)}-before-corrupt-${path.basename(file)}`);
  fs.writeFileSync(retained, bytes, { flag: "wx" });
  const invalid = Buffer.from('{"qa_corrupt_latest":');
  pendingRestore = { file, retained, originalSha256: sha256(bytes), injectedSha256: sha256(invalid) }; save();
  fs.writeFileSync(file, invalid); assert.equal(sha(file), pendingRestore.injectedSha256);
  report.faultRestoration.push({ ...pendingRestore, injectedAt: new Date().toISOString(), status: "INJECTED" }); save();
}
async function restoreCorrupt() {
  if (!pendingRestore) return;
  await stop();
  assert.equal(sha(pendingRestore.file), pendingRestore.injectedSha256, "Do not overwrite an unexpected concurrent write");
  fs.copyFileSync(pendingRestore.retained, pendingRestore.file);
  assert.equal(sha(pendingRestore.file), pendingRestore.originalSha256);
  report.faultRestoration.at(-1).status = "RESTORED"; pendingRestore = null; save();
}
async function beginLock(file) {
  const name = path.basename(out), readyFile = path.join(work, `${name}-lock-ready`), releaseFile = path.join(work, `${name}-lock-release`);
  const identityFile = path.join(work, `${name}-lock-identity.json`);
  lockChild = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/installed-runtime-save-lock.ps1"),
    "-Target", file, "-Ready", readyFile, "-Release", releaseFile], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const lock = { file, readyFile, releaseFile, pid: lockChild.pid, identity: info(lockChild.pid), stderr: "", stdout: "" };
  fs.writeFileSync(identityFile, JSON.stringify(lock, null, 2), { flag: "wx" });
  lockChild.stderr.on("data", d => { lock.stderr += d; }); lockChild.stdout.on("data", d => { lock.stdout += d; });
  report.lock = lock; save();
  const deadline = Date.now() + 8000;
  while (!fs.existsSync(readyFile) && Date.now() < deadline && lockChild.exitCode === null) await pause(50);
  assert(fs.existsSync(readyFile), `Native lock not ready: ${lock.stderr}`);
  assert.equal(fs.readFileSync(readyFile, "utf8"), "READ_SHARED_WRITE_DELETE_DENIED");
}
async function endLock() {
  if (!lockChild) return;
  if (!fs.existsSync(report.lock.releaseFile)) fs.writeFileSync(report.lock.releaseFile, "RELEASE", { flag: "wx" });
  if (lockChild.exitCode === null) await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Lock helper did not stop")), 10000);
    lockChild.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  report.lock.exitCode = lockChild.exitCode; assert.equal(lockChild.exitCode, 0, report.lock.stderr);
  assert.equal(info(lockChild.pid), null); report.lock.cleanup = "PASS"; lockChild = null; save();
}
async function observeClicks(count) {
  await page.evaluate(() => {
    window.__qaQuickObservation?.observer?.disconnect();
    const data = { clicks: [], busy: [], observer: null };
    const button = document.querySelector('[data-testid="renpy-quick-save"]');
    button.addEventListener("click", e => data.clicks.push({ at: performance.now(), trusted: e.isTrusted }), { capture: true });
    data.observer = new MutationObserver(() => data.busy.push({ at: performance.now(), busy: button.getAttribute("aria-busy"),
      disabled: button.disabled }));
    data.observer.observe(button, { attributes: true, attributeFilter: ["aria-busy"] });
    window.__qaQuickObservation = data;
  });
  const box = await page.getByTestId("renpy-quick-save").boundingBox(); assert(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: count, delay: 8 });
  await page.waitForFunction(() => document.querySelector('[data-testid="renpy-quick-save"]')?.getAttribute("aria-busy") !== "true");
  return page.evaluate(() => {
    const d = window.__qaQuickObservation; d.observer.disconnect();
    return { clicks: d.clicks, busy: d.busy };
  });
}
(async () => {
  await start();
  if (!followup) {
  await check("No quick-save feedback through real Renpy quick-load button, native writes absent, 12 actual WebView combinations", noQuickMatrix);
  // Ensure the matrix's failure cannot contaminate subsequent desktop tests.
  expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const seeded = await check("Two real quick-save actions persist different command positions and bytes", async () => {
    const first = await writeQuick(); assert.equal(first.command_index, 0);
    await command(0); await page.locator(".dialog-box").click(); await command(1);
    const second = await writeQuick(); assert.equal(second.command_index, 1);
    assert(Date.parse(second.created_at) > Date.parse(first.created_at));
    report.seeded = { first, second, files: files() }; return report.seeded;
  });
  if (seeded) await check("Corrupt newest native JSON offline; actual Player restart excludes it and quick-load confirms older valid save", async () => {
    const latest = report.seeded.second, older = report.seeded.first;
    const file = path.join(storage.targetDirectory, `quick-${String(latest.slot).padStart(2, "0")}.json`);
    try {
      await offlineCorrupt(file); await start();
      const remaining = await quicks(); assert.equal(remaining.length, 1); assert.equal(remaining[0].save_id, older.save_id);
      await page.getByTestId("renpy-quick-load").click(); await page.getByTestId("confirm-quick-load").waitFor();
      await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click(); await command(0);
      await page.locator(".dialog-box").click(); await command(1);
      await page.getByTestId("renpy-quick-load").click(); await page.getByTestId("confirm-quick-load").click();
      await ready("playing"); await command(0);
      assert.equal((await native("read_save", { installId, kind: "quick", slot: older.slot })).save_id, older.save_id);
      await shot("invalid-latest-fallback"); return { latestInvalidSlot: latest.slot, loadedOlderId: older.save_id,
        restoredPosition: await state(), nativeList: remaining, restartRequiredInThisCase: true, corruptionDuringRunningCase: "NOT_RUN" };
    } finally { await restoreCorrupt(); await start(); }
  });
  const full = await check("Fill remaining quick slots through real UI without altering previous native bytes", async () => {
    const before = files(), created = [];
    for (let i = (await quicks()).length; i < 6; i++) created.push(await writeQuick());
    assert.equal((await quicks()).length, 6);
    for (const f of before) assert.equal(sha(f.path), f.sha256);
    return { created, all: await quicks(), files: files() };
  });
  if (!full) throw new Error("Six-slot native baseline required for remaining failure tests");
  }
  assert.equal((await quicks()).length, 6);
  if (!historyOnly) await check("Real Windows sharing denial preserves all six saves, reports failure, releases busy state, and retry succeeds", async () => {
    const before = files(), all = await quicks(), oldest = all.toSorted((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.slot - b.slot)[0];
    const target = path.join(storage.targetDirectory, `quick-${String(oldest.slot).padStart(2, "0")}.json`);
    let observed, failure;
    try {
      await beginLock(target); observed = await observeClicks(1);
      report.failedWriteObservation = observed; save();
      const toast = page.locator(".save-status-toast.is-error"); await toast.waitFor();
      failure = await toast.innerText(); assert(failure.includes("快存失败") && failure.includes(storage.targetDirectory));
      assert(failure.includes("不会回退")); assert.deepEqual(files(), before);
      assert(observed.busy.some(b => b.busy === "true") && observed.busy.at(-1).busy !== "true");
      assert(observed.clicks.every(c => c.trusted)); assert.equal(observed.clicks.length, 1);
      assert(!fs.readdirSync(storage.targetDirectory).some(n => n.endsWith(".tmp")), "Failed atomic write leaves no staging files");
      await shot("write-failure");
    } finally { await endLock(); }
    const retried = await writeQuick(); assert.equal(retried.slot, oldest.slot); assert.notEqual(retried.save_id, oldest.save_id);
    for (const f of before.filter(f => f.path !== target)) assert.equal(sha(f.path), f.sha256);
    return { method: "NATIVE_FILE_SHARE_DENY_NOT_ACL", before, target, failure, observed, retried, after: files(),
      aclFailureClaim: false, oldValidSavesPreservedOnFailure: true };
  });
  if (!followup) await check("Successful physical double click while native snapshot is pending creates exactly one save and one busy interval", async () => {
    const before = await quicks(), observed = await observeClicks(2), after = await quicks();
    const created = after.filter(s => !before.some(b => b.save_id === s.save_id)); assert.equal(created.length, 1);
    assert.equal(after.length, 6); assert.equal(observed.clicks.length, 1);
    assert(observed.clicks[0].trusted); assert(observed.busy.some(b => b.busy === "true") && observed.busy.at(-1).busy !== "true");
    await shot("successful-double-click");
    return { before, created, after, observed, mockDelay: false };
  });
  await check("Renpy real history navigation displays exact existing dialogue once and returns to unchanged command", async () => {
    const before = await state(); await history();
    const entries = await page.locator(".history-list article p").allTextContents();
    report.historyObservation ??= []; report.historyObservation.push({ layout: current, before, entries }); save();
    assert(before.dialogText); assert.equal(entries.filter(t => t === before.dialogText).length, 1);
    await shot("history"); await page.getByTestId("renpy-menu-return").click(); await ready("playing");
    assert.deepEqual(await state(), before); return { before, entries, restored: await state() };
  });
  // Test shared history in a distinct native AgentVN process, not a skin mock.
  await stop(); current = "agentvn"; await start();
  await check("AgentVN real menu history navigation displays current line once and returns without losing progress", async () => {
    const before = await state(); await history();
    const entries = await page.locator(".history-list article p").allTextContents();
    report.historyObservation ??= []; report.historyObservation.push({ layout: current, before, entries }); save();
    assert(before.dialogText); assert.equal(entries.filter(t => t === before.dialogText).length, 1); await shot("history");
    await page.getByTestId("back-to-player").click(); await ready("playing");
    assert.deepEqual(await state(), before); return { before, entries, restored: await state() };
  });
  const retained = path.join(work, `${path.basename(out)}-native-saves`); fs.mkdirSync(retained);
  report.retained = files().map(f => {
    const destination = path.join(retained, f.name); fs.copyFileSync(f.path, destination, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(destination), f.sha256); return { ...f, retained: destination, data: read(destination) };
  });
  report.status = report.checks.length === (historyOnly ? 2 : followup ? 3 : 8) && report.checks.every(c => c.status === "PASS") && !report.pageErrors.length ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  try { await endLock(); await restoreCorrupt(); await stop(); }
  catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; }
  report.finishedAt = new Date().toISOString(); save();
  if (report.status !== "PASS") process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, checks: report.checks.map(c => ({ name: c.name, status: c.status, error: c.error })),
    error: report.error, cleanupError: report.cleanupError, out }, null, 2));
});
