"use strict";
// One read-only Runtime animation observation around an actual quick-load.
// Only fresh QA save copies are written; product code/state setters untouched.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { InstalledRuntimeSession } = require("./lib/installed-runtime-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const attempt = process.argv[2] || "04"; assert.match(attempt, /^\d{2}$/);
const out = path.join(base, `quick-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const sourceFile = path.join(base, "quick-03/installed-session.json"), source = read(sourceFile);
assert.equal(source.status, "PASS");
const rawFile = path.join(base, "quick-03/player-01.json"), prior = read(rawFile), cell = prior.cells[0];
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(sourceFile), prior: desc(rawFile),
  scope: "ONE_INSTALLED_QUICK_LOAD_ANIMATION_CAPTURE_DIAGNOSTIC_NOT_FULL_VISUAL_ACCEPTANCE",
  productChanges: 0, modelRequests: 0, builds: 0, commands: [], screenshots: [], launches: [], pageErrors: [],
  controls: [], executable: source.executable, protectedFiles: source.protectedFiles };
const save = () => fs.writeFileSync(path.join(out, "capture-diagnostic.json"), JSON.stringify(report, null, 2));
let session, protectedProfile = false, fault;
function profiles(action) {
  const p = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out,
    "-Storage", "NativeRoaming"], { encoding: "utf8", windowsHide: true, timeout: 60000 });
  const row = { action, status: p.status, stdout: p.stdout, stderr: p.stderr }; report.commands.push(row); save();
  assert.equal(p.status, 0, p.stdout + p.stderr);
}
async function observe(page) {
  return page.evaluate(() => {
    const n = document.querySelector('[data-testid="game-state-playing"]');
    const nodes = [...document.querySelectorAll(".game-launch-blackout,[data-runtime-modal-exit],.modal-backdrop")];
    return { at: performance.now(), screen: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition"),
      scene: n?.getAttribute("data-current-scene-id"), command: Number(n?.getAttribute("data-current-command-index")),
      overlays: nodes.map(el => ({ cls: el.className, exit: el.hasAttribute("data-runtime-modal-exit"),
        opacity: Number(getComputedStyle(el).opacity), background: getComputedStyle(el).backgroundColor })),
      animations: document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a =>
        ({ state: a.playState, target: a.effect?.target?.className, time: a.currentTime,
          duration: a.effect?.getComputedTiming().duration })),
      playingOpacity: n ? getComputedStyle(n).opacity : null,
      centerStack: document.elementsFromPoint(innerWidth / 2, innerHeight / 2).slice(0, 8)
        .map(e => ({ cls: e.className, opacity: getComputedStyle(e).opacity, background: getComputedStyle(e).backgroundColor })),
      ancestors: (() => { const result = []; for (let e = n; e; e = e.parentElement)
        result.push({ cls: e.className, opacity: getComputedStyle(e).opacity, filter: getComputedStyle(e).filter });
        return result; })() };
  });
}
(async () => {
  for (const f of source.protectedFiles) assert.equal(sha(f.path), f.sha256);
  report.tool = desc(__filename); fs.copyFileSync(__filename, path.join(out, "executed-diagnostic.cjs"), fs.constants.COPYFILE_EXCL);
  report.input = source.isolation.AGENTVN_TEST_PROJECT;
  process.env.AGENTVN_TEST_PROJECT = report.input; process.env.AGENTVN_WORKSPACE_OUTPUT = out;
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
  protectedProfile = true; profiles("Prepare");
  const journal = read(path.join(out, "profile-protection.json"));
  const prep = { status: "PASS", sessionRoot: out, defaultStorage: "PHYSICAL_DEFAULT_PATH", executable: source.executable,
    profiles: journal.records.filter(p => p.existed), webview: path.join(out, "webview"), temporary: path.join(out, "temporary") };
  fs.mkdirSync(prep.temporary);
  const fixture = { ...read(source.originalFixture.path), input: report.input };
  session = new InstalledRuntimeSession({ prep, fixture, cartridges: source.cartridges, out, report, save,
    installId: cell.installId, currentNative: true });
  await session.start("renpy", false);
  const dir = path.resolve(session.storage.targetDirectory);
  assert.equal(dir, path.resolve(journal.records[0].original, "saves", cell.installId));
  fs.mkdirSync(dir, { recursive: true }); assert.equal(fs.readdirSync(dir).length, 0);
  report.importedCopies = cell.finalNativeSaves.map(f => {
    assert.equal(sha(f.retained), f.sha256); const to = path.join(dir, f.name);
    fs.copyFileSync(f.retained, to, fs.constants.COPYFILE_EXCL); return desc(to);
  });
  const latest = (await session.saves()).filter(s => s.save_kind === "quick")
    .toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  assert.equal(latest.command_index, 2);
  const file = path.join(dir, `quick-${String(latest.slot).padStart(2, "0")}.json`), original = fs.readFileSync(file);
  fault = { file, original, sha256: sha(file) };
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(original), scene_id: "__qa_missing_scene_current_native__" }));
  report.fault = { file, originalSha256: fault.sha256, injectedSha256: sha(file) }; save();
  // Copies were introduced after the initial library hydration. Re-open the
  // actual process before exercising Runtime's cached save list; do not force
  // a store refresh or pretend out-of-band disk writes are normal UI writes.
  report.diskPreparation = { installedSaves: await session.saves(), requiresActualRestart: true };
  await session.stop(); await session.start("renpy", false);
  assert.equal((await session.saves()).filter(s => s.save_kind === "quick").length, 6);
  await session.page.getByTestId("start-new-game").click(); await session.ready("playing");
  await session.setAuto(false, true); await session.command("ordinary_nvl", 0);
  await session.page.getByTestId("renpy-quick-load").click();
  await session.page.getByTestId("confirm-quick-load").waitFor();
  await session.page.evaluate(() => {
    const data = { frames: [], done: false, stopped: false, stable: 0 }; window.__qaLoadCapture = data;
    function tick() {
      if (data.stopped || data.frames.length >= 240) return;
      const n = document.querySelector('[data-testid="game-state-playing"]');
      const overlays = [...document.querySelectorAll(".game-launch-blackout,[data-runtime-modal-exit],.modal-backdrop")];
      const animations = document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity);
      const row = { at: performance.now(), command: Number(n?.getAttribute("data-current-command-index")),
        screen: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition"),
        overlays: overlays.map(el => ({ cls: el.className, opacity: Number(getComputedStyle(el).opacity),
          exit: el.hasAttribute("data-runtime-modal-exit") })),
        animations: animations.map(a => ({ target: a.effect?.target?.className, state: a.playState })) };
      data.frames.push(row);
      const clean = row.command === 1 && row.screen === "idle" && !overlays.length &&
        !animations.some(a => a.playState === "running" || a.playState === "pending");
      data.stable = clean ? data.stable + 1 : 0;
      if (data.stable >= 3) { data.done = true; return; }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  await session.page.getByTestId("confirm-quick-load").click();
  await session.ready("playing"); await session.command("ordinary_nvl", 1);
  // Match the original capture seam exactly, before adding any stronger wait.
  await settleRuntime(session.page); report.originalCaptureSeam = await observe(session.page);
  report.screenshots.push(await captureInstalledWebview(session.page, session.cdp,
    path.join(out, "original-capture-seam.png"), session.expected));
  report.afterOriginalCapture = await observe(session.page); save();
  await session.page.waitForFunction(() => window.__qaLoadCapture?.done === true, null, { timeout: 15000 });
  report.frames = await session.page.evaluate(() => {
    const d = window.__qaLoadCapture; d.stopped = true; return d.frames;
  });
  report.stableCapture = await observe(session.page);
  assert.equal(report.stableCapture.command, 1); assert.equal(report.stableCapture.overlays.length, 0);
  assert(!report.stableCapture.animations.some(a => a.state === "running" || a.state === "pending"));
  report.screenshots.push(await captureInstalledWebview(session.page, session.cdp,
    path.join(out, "stable-capture.png"), session.expected));
  report.afterStableCapture = await observe(session.page);
  assert.equal(report.afterStableCapture.overlays.length, 0);
  report.controls = await session.page.locator(".renpy-quick-action").evaluateAll(nodes => nodes.map(n => {
    const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { label: n.textContent, hit: hit === n || n.contains(hit) };
  }));
  assert.equal(report.controls.length, 8); assert(report.controls.every(c => c.hit));
  assert.deepEqual(report.pageErrors, []);
  report.status = "OBSERVATION_PASS_NOT_COMPLETE_MOTION_ACCEPTANCE";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (session?.page) {
    report.failureBody = await session.page.locator("body").innerText().catch(String);
    report.failureObservation = await observe(session.page).catch(String);
  }
})
.finally(async () => {
  try {
    if (session?.page) await session.page.evaluate(() => { if (window.__qaLoadCapture) window.__qaLoadCapture.stopped = true; }).catch(() => {});
    await session?.stop();
    if (fault) {
      assert.equal(sha(fault.file), report.fault.injectedSha256); fs.writeFileSync(fault.file, fault.original);
      assert.equal(sha(fault.file), fault.sha256); report.fault.restoration = "PASS";
    }
    // Child shutdown can outlive the root exit briefly. Poll actual identities,
    // not a fixed delay, before restoring either original directory.
    await until(() => !rows().some(p => p.Name === "agentvn-player.exe" ||
      p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)), "Player/WebView shutdown before restore", 15000);
    if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profiles("Restore"); report.restoration = desc(path.join(out, "profile-restoration.json"));
    }
    for (const f of source.protectedFiles) assert.equal(sha(f.path), f.sha256);
    assert.deepEqual(listeners(report.launches.map(l => l.port)), []);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError,
    originalCaptureSeam: report.originalCaptureSeam, stableCapture: report.stableCapture }));
});
