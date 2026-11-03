"use strict";
// Trusted CDP input in frozen installed Player. No store writes, delay mocks,
// persistence interception, model requests, or standalone/Android claims.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { InstalledRuntimeSession, processIdentity, sha, pause } = require("./lib/installed-runtime-session.cjs");
const { validatePendingObservation } = require("./installed-runtime-quick-observation.cjs");
const root = "D:/AgentVN";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const nativeIndex = process.argv.indexOf("--current-native-preparation");
const currentNative = nativeIndex >= 0;
const prepFile = currentNative ? process.argv[nativeIndex + 1]
  : `${root}/output/installed-runtime-quick-gaps-20261019-01/preparation.json`;
assert(prepFile && !prepFile.startsWith("--"));
const prep = read(prepFile);
const current1922 = currentNative && prep.current1922Library === true;
const smoke = process.argv.includes("--smoke");
assert(!smoke || currentNative, "Smoke subset must not change historical installed acceptance");
const base = currentNative ? prep.sessionRoot : `${root}/output/installed-runtime-quick-gaps-20261019-01`;
const work = currentNative ? base : "F:/AgentVN/QA/Runtime-Quick-Gaps-20261019-01";
const sourcePath = current1922 ? prep.originalExport.path
  : `${root}/output/installed-runtime-abilities-20261018-01/export-03/report.json`;
const source = read(sourcePath), fixturePath = current1922 ? prep.originalFixture.path
  : `${root}/output/installed-runtime-abilities-20261018-01/fixtures-02.json`;
const fixture = currentNative ? prep.fixture : read(fixturePath);
if (currentNative) {
  assert.equal(sha(sourcePath), prep.originalExport.sha256);
  assert.equal(sha(fixturePath), prep.originalFixture.sha256);
  source.cartridges = prep.cartridges;
}
const reportFile = `${base}/player-01.json`;
assert(!fs.existsSync(reportFile)); assert.equal(prep.status, "PASS");
if (!currentNative) assert.equal(prep.blankDefaultProfiles, true);
assert.equal(source.status, "PASS"); assert.equal(source.cartridges.length, 2);
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(base));
const report = { status: "RUNNING", at: new Date().toISOString(), cells: [], launches: [], screenshots: [], pageErrors: [],
  nativeSaves: [], faults: [], locks: [], sources: [sourcePath, fixturePath, fixture.input,
    ...source.cartridges.map(c => c.path)].map(p => ({ path: p, sha256: sha(p) })),
  runner: { path: __filename, sha256: sha(__filename) }, expectedCells: smoke ? 1 : 12,
  project: process.env.AGENTVN_TEST_PROJECT, output: process.env.AGENTVN_WORKSPACE_OUTPUT,
  scope: current1922 ? "ACTUAL_1922_INSTALLED_SHIPPED_LIBRARY_QUICK_EXCEPTIONS_NOT_STANDALONE_ANDROID_OR_NATIVE_PICKER"
    : currentNative ? "CURRENT_NATIVE_PLAYER_LIBRARY_NOT_RELEASE_INSTALL_STANDALONE_ANDROID_OR_NATIVE_PICKER"
    : "ACTUAL_INSTALLED_PLAYER_LIBRARY_NOT_STANDALONE_SETUP_ANDROID_OR_NATIVE_PICKER",
  controlledBoundaries: ["Public native library import; real subsequent UI actions",
    "Offline semantic scene_id corruption in this fresh QA identity only, original bytes retained/restored",
    "Real Windows read sharing lock denies atomic replacement, not ACL",
    "Actual WebView viewport emulation, not a physical 4K display"],
  productChanges: 0, modelRequests: 0, newBuilds: 0, mockDelay: false, error: null, cleanupError: null };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
let session, cell, fault, lockChild, lock;
const quick = async () => (await session.saves()).filter(s => s.save_kind === "quick");
const newest = rows => rows.toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.slot - a.slot)[0];
const fileFor = slot => path.join(session.storage.targetDirectory, `quick-${String(slot).padStart(2, "0")}.json`);
async function state() {
  return session.page.getByTestId("game-state-playing").evaluate(e => ({
    scene: e.getAttribute("data-current-scene-id"), command: Number(e.getAttribute("data-current-command-index")),
    text: document.querySelector(".dialog-text")?.textContent,
  }));
}
async function done(index) {
  await session.command("ordinary_nvl", index, false);
  const d = session.page.locator(".dialog-box");
  if (await d.getAttribute("data-dialog-page-done") !== "true") await d.click();
  await session.command("ordinary_nvl", index);
}
async function startCell(restart = false) {
  await session.start("renpy", false); await session.viewport(cell.viewport);
  session.launch.cell = cell.name; session.launch.restart = restart; session.launch.reimportsLibrary = true; save();
  await session.page.getByTestId("start-new-game").click(); await session.ready("playing");
  if (!restart) cell.preferences = await session.setAuto(false, true);
  await done(0);
}
async function shot(name) { await session.shot(`${cell.name}-${name}`); }
async function retain(label) {
  const dest = path.join(work, `${cell.name}-${label}`); fs.mkdirSync(dest);
  const rows = session.files().map(f => {
    const retained = path.join(dest, f.name); fs.copyFileSync(f.path, retained, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(retained), f.sha256); return { ...f, retained, data: read(retained) };
  });
  report.nativeSaves.push(...rows); save(); return rows;
}
async function check(name, fn) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() }; cell.checks.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) {
    row.status = "FAILED"; row.error = String(e.stack || e);
    row.body = await session.page?.locator("body").innerText().catch(() => "");
    await shot(`failure-${cell.checks.length}`).catch(() => {});
  } finally { row.finishedAt = new Date().toISOString(); save(); console.log(`${cell.name} ${row.status}: ${name}`); }
  return row.status === "PASS";
}
async function writeQuick() {
  const before = await quick();
  await session.page.getByTestId("renpy-quick-save").click();
  await session.page.waitForFunction(() => document.querySelector('[data-testid="renpy-quick-save"]')?.getAttribute("aria-busy") !== "true");
  const after = await quick(), created = after.filter(a => !before.some(b => b.save_id === a.save_id));
  assert.equal(created.length, 1, "Exactly one new durable save for an accepted single click");
  const durable = read(fileFor(created[0].slot)); assert.equal(durable.save_id, created[0].save_id);
  return created[0];
}
async function observeInput(clickCount) {
  await session.page.evaluate(() => {
    window.__qaQuickInput?.controller.abort(); window.__qaQuickInput?.observer.disconnect();
    const button = document.querySelector('[data-testid="renpy-quick-save"]');
    const controller = new AbortController();
    const data = { pointers: [], clicks: [], busy: [], controller, observer: null };
    const sample = () => ({ at: performance.now(), busy: button.getAttribute("aria-busy") === "true", disabled: button.disabled });
    for (const type of ["pointerdown", "pointerup"]) window.addEventListener(type, e => {
      const b = button.getBoundingClientRect();
      data.pointers.push({ ...sample(), type, trusted: e.isTrusted, x: e.clientX, y: e.clientY,
        hit: e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom,
        target: e.target?.getAttribute?.("data-testid") });
    }, { capture: true, signal: controller.signal });
    button.addEventListener("click", e => data.clicks.push({ ...sample(), trusted: e.isTrusted }),
      { capture: true, signal: controller.signal });
    data.observer = new MutationObserver(() => {
      const s = sample(); if (!data.busy.length || data.busy.at(-1).busy !== s.busy) data.busy.push(s);
    });
    data.observer.observe(button, { attributes: true, attributeFilter: ["aria-busy"] });
    window.__qaQuickInput = data;
  });
  const b = await session.page.getByTestId("renpy-quick-save").boundingBox(); assert(b);
  await session.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { clickCount, delay: 8 });
  await session.page.waitForFunction(() => document.querySelector('[data-testid="renpy-quick-save"]')?.getAttribute("aria-busy") !== "true");
  return session.page.evaluate(() => {
    const d = window.__qaQuickInput; d.observer.disconnect(); d.controller.abort();
    return { pointers: d.pointers, clicks: d.clicks, busy: d.busy };
  });
}
async function beginLock(file) {
  const prefix = `${cell.name}-lock`, readyFile = path.join(work, `${prefix}-ready`), releaseFile = path.join(work, `${prefix}-release`);
  lockChild = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    `${root}/scripts/installed-runtime-quick-gaps-lock.ps1`, "-Target", file, "-Ready", readyFile, "-Release", releaseFile,
    ...(currentNative ? ["-RunDirectory", work] : []), ...(current1922 ? ["-Current1922"] : [])],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  lock = { cell: cell.name, file, readyFile, releaseFile, pid: lockChild.pid,
    identity: processIdentity(lockChild.pid), stderr: "", stdout: "" };
  report.locks.push(lock); save();
  lockChild.stderr.on("data", b => { lock.stderr += b; }); lockChild.stdout.on("data", b => { lock.stdout += b; });
  const deadline = Date.now() + 8000;
  while (!fs.existsSync(readyFile) && Date.now() < deadline && lockChild.exitCode === null) await pause(50);
  assert(fs.existsSync(readyFile), lock.stderr);
  assert.equal(fs.readFileSync(readyFile, "utf8"), "READ_SHARED_WRITE_DELETE_DENIED");
}
async function endLock() {
  if (!lockChild) return;
  if (!fs.existsSync(lock.releaseFile)) fs.writeFileSync(lock.releaseFile, "RELEASE", { flag: "wx" });
  if (lockChild.exitCode === null) await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Lock helper still running")), 10000);
    lockChild.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  lock.exitCode = lockChild.exitCode; assert.equal(lock.exitCode, 0, lock.stderr);
  assert.equal(processIdentity(lock.pid), null); lock.cleanup = "PASS"; lockChild = null; save();
}
async function restoreFault() {
  if (!fault) return;
  await session.stop();
  assert.equal(sha(fault.file), fault.injectedSha256, "Do not overwrite an unexpected later write");
  fs.copyFileSync(fault.retained, fault.file); assert.equal(sha(fault.file), fault.originalSha256);
  fault.restoration = "PASS"; fault = null; save();
}
async function concurrent() {
  const before = await quick(), beforeFiles = session.files(), oldIds = before.map(s => s.save_id);
  const observed = await observeInput(2), after = await quick();
  // Save raw timings before running the strict oracle. Failure remains evidence.
  const detail = { before, beforeFiles, observed, after }; cell.concurrentObservation = detail; save();
  const timing = validatePendingObservation(observed);
  const fresh = after.filter(s => !oldIds.includes(s.save_id));
  assert.equal(fresh.length, 1); assert.equal(after.length, 6);
  const changed = session.files().filter(f => beforeFiles.find(b => b.name === f.name)?.sha256 !== f.sha256);
  assert.equal(changed.length, 1); assert.equal(read(changed[0].path).save_id, fresh[0].save_id);
  const next = await writeQuick(); assert.equal((await quick()).length, 6); assert.notEqual(next.save_id, fresh[0].save_id);
  await shot("pending-input"); return { ...detail, timing, changed, nextAcceptedAfterCompletion: next };
}
async function denied() {
  const before = session.files(), all = await quick();
  const oldest = all.toSorted((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.slot - b.slot)[0];
  const target = fileFor(oldest.slot); let observed, failure;
  try {
    await beginLock(target); observed = await observeInput(1);
    const toast = session.page.locator(".save-status-toast.is-error"); await toast.waitFor();
    failure = await toast.innerText();
    cell.deniedObservation = { before, target, observed, failure }; save();
    assert(failure.includes("快存失败") && failure.includes(session.storage.targetDirectory) && failure.includes("不会回退"));
    assert.deepEqual(session.files(), before);
    assert.equal(observed.clicks.length, 1); assert(observed.clicks[0].trusted);
    assert(observed.busy.some(b => b.busy) && observed.busy.at(-1).busy === false);
    assert(!fs.readdirSync(session.storage.targetDirectory).some(n => n.endsWith(".tmp")));
    const geometry = await toast.evaluate(e => {
      const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom,
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert(geometry.x >= -1 && geometry.y >= -1 && geometry.right <= cell.viewport.width + 1 &&
      geometry.bottom <= cell.viewport.height + 1 && geometry.overflow <= 1);
    await shot("write-denied");
  } finally { await endLock(); }
  const retried = await writeQuick(); assert.equal(retried.slot, oldest.slot); assert.notEqual(retried.save_id, oldest.save_id);
  assert.equal((await quick()).length, 6);
  for (const f of before.filter(f => f.path !== target)) assert.equal(sha(f.path), f.sha256);
  return { before, target, observed, failure, retried, after: session.files(), method: "REAL_WINDOWS_SHARING_DENIAL_NOT_ACL" };
}
async function semantic() {
  await session.page.locator(".dialog-box").click(); await done(1);
  const latest = await writeQuick(); assert.equal(latest.command_index, 1);
  const all = await quick(), older = newest(all.filter(s => s.save_id !== latest.save_id)); assert.equal(older.command_index, 0);
  const file = fileFor(latest.slot); await session.stop();
  const retained = path.join(work, `${cell.name}-before-semantic-${path.basename(file)}`);
  fs.copyFileSync(file, retained, fs.constants.COPYFILE_EXCL);
  const original = read(retained), invalid = { ...original, scene_id: "__qa_missing_scene_20261019__" };
  fault = { cell: cell.name, file, retained, originalSha256: sha(retained), status: "PREPARED" };
  report.faults.push(fault); save();
  fs.writeFileSync(file, JSON.stringify(invalid));
  fault.injectedSha256 = sha(file); fault.status = "INJECTED"; save();
  try {
    await startCell(true);
    const listed = await quick(); assert.equal(listed.length, 6);
    assert.equal(listed.find(s => s.save_id === latest.save_id)?.scene_id, invalid.scene_id);
    assert.equal(newest(listed).save_id, latest.save_id);
    await session.page.locator(".dialog-box").click(); await done(1);
    const before = await state(); assert.equal(before.command, 1);
    await session.page.getByTestId("renpy-quick-load").click(); await session.page.getByTestId("confirm-quick-load").waitFor();
    await session.page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
    assert.deepEqual(await state(), before);
    await session.page.getByTestId("renpy-quick-load").click(); await session.page.getByTestId("confirm-quick-load").click();
    await session.ready("playing"); await done(0);
    assert.equal((await state()).command, 0);
    assert.equal((await session.native("read_save", { installId: session.installId, kind: "quick", slot: older.slot })).save_id, older.save_id);
    assert.equal(sha(file), fault.injectedSha256); await shot("semantic-invalid-fallback");
    return { originalNewest: latest, injected: invalid, latestValid: older, nativeList: listed, before, restored: await state(),
      restart: true, libraryReseedOnRestart: true, notAnUnseededRestartClaim: true };
  } finally { await restoreFault(); }
}
async function distinctSemantic() {
  // Three distinguishable positions prevent "any valid older save" from
  // accidentally satisfying "latest valid save".
  const oldest = newest(await quick()); assert.equal(oldest.command_index, 0);
  await session.page.locator(".dialog-box").click(); await done(1);
  const latestValid = await writeQuick(); assert.equal(latestValid.command_index, 1);
  for (let count = 0; count < 30; count++) {
    const now = await state(); if (now.command === 2) break;
    assert.equal(now.command, 1);
    const pageBefore = await session.page.locator(".dialog-box").getAttribute("data-dialog-page");
    await session.page.locator(".dialog-box").click();
    await session.page.waitForFunction(before => {
      const s = document.querySelector('[data-testid="game-state-playing"]');
      return Number(s?.getAttribute("data-current-command-index")) !== 1
        || document.querySelector(".dialog-box")?.getAttribute("data-dialog-page") !== before;
    }, pageBefore);
    await session.page.waitForFunction(() =>
      document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
  }
  await session.command("ordinary_nvl", 2);
  const latest = await writeQuick(); assert.equal(latest.command_index, 2);
  assert(Date.parse(oldest.created_at) < Date.parse(latestValid.created_at)
    && Date.parse(latestValid.created_at) < Date.parse(latest.created_at));
  const file = fileFor(latest.slot); await session.stop();
  const retained = path.join(work, `${cell.name}-before-distinct-${path.basename(file)}`);
  fs.copyFileSync(file, retained, fs.constants.COPYFILE_EXCL);
  const invalid = { ...read(retained), scene_id: "__qa_missing_scene_current_native__" };
  fault = { cell: cell.name, file, retained, originalSha256: sha(retained), status: "PREPARED" };
  report.faults.push(fault); save();
  fs.writeFileSync(file, JSON.stringify(invalid)); fault.injectedSha256 = sha(file); fault.status = "INJECTED"; save();
  try {
    await startCell(true);
    const listed = await quick(); assert.equal(listed.length, 6);
    assert.equal(newest(listed).save_id, latest.save_id);
    assert.equal(listed.find(s => s.save_id === latest.save_id)?.scene_id, invalid.scene_id);
    const before = await state(); assert.equal(before.command, 0);
    await session.page.getByTestId("renpy-quick-load").click();
    await session.page.getByTestId("confirm-quick-load").waitFor();
    await session.page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
    assert.deepEqual(await state(), before);
    await session.page.getByTestId("renpy-quick-load").click();
    await session.page.getByTestId("confirm-quick-load").click();
    await session.ready("playing"); await session.command("ordinary_nvl", 1);
    const restored = await state();
    assert.equal(restored.command, latestValid.command_index);
    assert.notEqual(restored.command, oldest.command_index); assert.notEqual(restored.command, latest.command_index);
    assert(restored.text.includes("MID_ADAPT")); assert.equal(sha(file), fault.injectedSha256);
    await shot("distinct-invalid-fallback");
    return { oldest, latestValid, invalidLatest: latest, restored, listed,
      cancellationUnchanged: true, actualRestart: true, publicLibraryReseedOnRestart: true };
  } finally { await restoreFault(); }
}
(async () => {
  save();
  let index = 0;
  for (const [width, height] of (smoke ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]]))
    for (const dpr of (smoke ? [1] : [1, 2])) for (const reduced of (smoke ? [false] : [false, true])) {
      index++; const name = `${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}`;
      cell = { name, viewport: { width, height, dpr, reduced }, installId: currentNative
        ? `${prep.installId}_${String(index).padStart(2, "0")}` : `qa_quick_gaps_20261019_${String(index).padStart(2, "0")}`,
        status: "RUNNING", checks: [], at: new Date().toISOString() };
      report.cells.push(cell); save();
      session = new InstalledRuntimeSession({ prep, fixture, cartridges: source.cartridges, out: work, report, save,
        installId: cell.installId, currentNative });
      try {
        await startCell();
        assert.equal((await quick()).length, 0, "Fresh independent QA identity");
        for (let n = 0; n < 6; n++) assert.equal((await writeQuick()).command_index, 0);
        assert.equal((await quick()).length, 6); cell.seed = await retain("seed"); save();
        await check("Actual second trusted pointer during pending creates one durable save and next action is accepted", concurrent);
        if (index === 1 && !currentNative) cell.existingWriteDenial = {
          scope: "1920x1080/DPR1/normal real sharing denial and retry already evidenced, not rerun",
          path: `${root}/output/installed-runtime-exceptions-20261018-01/exceptions-02/report.json`,
          sha256: sha(`${root}/output/installed-runtime-exceptions-20261018-01/exceptions-02/report.json`) };
        else await check("Actual sharing-denied atomic write preserves six old saves and real retry replaces only target", denied);
        await check("Valid JSON with nonexistent scene_id is excluded by quick-load; cancel stays and confirm restores latest valid",
          currentNative ? distinctSemantic : semantic);
        cell.finalNativeSaves = await retain("final");
        cell.status = cell.checks.length === (index === 1 && !currentNative ? 2 : 3)
          && cell.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
      } catch (e) { cell.status = "FAILED"; cell.error = String(e.stack || e); }
      finally {
        await endLock(); await restoreFault(); await session.stop(); cell.finishedAt = new Date().toISOString(); save();
        console.log(`CELL ${cell.name}: ${cell.status}`);
      }
    }
  assert.equal(report.cells.length, report.expectedCells); assert.equal(report.pageErrors.length, 0);
  report.status = report.cells.every(c => c.status === "PASS") ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  try { await endLock(); await restoreFault(); await session?.stop(); }
  catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; }
  report.finishedAt = new Date().toISOString(); save(); if (report.status !== "PASS") process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, cells: report.cells.length,
    checks: report.cells.reduce((n, c) => n + c.checks.length, 0), reportFile, error: report.error, cleanupError: report.cleanupError }));
});
