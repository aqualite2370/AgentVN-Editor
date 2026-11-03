"use strict";
// Current repair evidence only. Never rewrites the historical failed audit.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const qa = "F:/AgentVN/QA/Runtime-Gallery-Repair-20261020-01";
const nativeQa = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const run = process.argv[2] || "audit-01", nativeRun = process.argv[3] || "04";
assert(/^audit-\d{2}$/.test(run) && /^\d{2}$/.test(nativeRun));
const out = path.join(qa, run); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
const files = [path.join(qa, "state-04/report.json"), path.join(qa, "browser-03/report.json"),
  path.join(qa, "gates-01/report.json"), path.join(nativeQa, `gallery-${nativeRun}/report.json`)];
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [],
  scope: "REPAIR_SOURCE_NEW_DEV_CURRENT_NATIVE_PLAYER_NOT_RELEASE_INSTALL", error: null };
const expectedMatrix = ["agentvn", "renpy"].flatMap(layout => [1920, 2560, 3840].flatMap(width =>
  [1, 2].flatMap(dpr => [false, true].map(reduced => ({ layout, width, height: width * 9 / 16, dpr, reduced })))));
function validate([state, browser, gates, native]) {
  for (const r of [state, browser, gates, native]) {
    assert.equal(r.status, "PASS"); assert.equal(r.error, null);
  }
  assert.equal(state.cases.length, 8); assert(state.cases.every(c => c.status === "PASS"));
  assert.deepEqual(state.cases.map(({ entry, exit }) => ({ entry, exit })),
    ["main_menu", "playing", "settings", "title_menu"].flatMap(entry => ["manual", "boundary"].map(exit => ({ entry, exit }))));
  for (const r of state.cases) {
    assert.equal(r.actual.returnScreen, r.entry === "settings" ? "playing" : r.entry);
    assert.equal(r.actual.scene, r.entry === "title_menu" ? "" : "main");
    assert.equal(r.actual.galleryReplayActive, false);
  }
  assert.equal(browser.cases.length, 8); assert(browser.cases.every(c => c.status === "PASS"));
  assert.deepEqual(browser.cases.map(({ layout, reduced, broken }) => ({ layout, reduced, broken })),
    ["agentvn", "renpy"].flatMap(layout => [false, true].flatMap(reduced => [false, true].map(broken => ({ layout, reduced, broken })))));
  assert.equal(browser.realModelRequests, 0); assert.equal(browser.cleanupError, null);
  assert.equal(browser.ownedServiceStopped, true);
  for (const r of [browser, native]) {
    assert.deepEqual(r.pageErrors, []);
    assert.deepEqual(r.matrix.map(({ layout, width, height, dpr, reduced }) => ({ layout, width, height, dpr, reduced })), expectedMatrix);
    assert(r.matrix.every(c => c.status === "PASS"));
  }
  for (const c of browser.cases) {
    if (c.broken) {
      assert.equal(c.initial.width, 0); assert.equal(c.initial.height, 0);
      assert.match(c.retryDiagnostic, /无法加载|失败|损坏/); assert.equal(c.originalStoryStillPlayable, true);
    } else assert.deepEqual(c.restored, ["manual-exit", "scene-end"]);
  }
  assert.equal(gates.commands.length, 12);
  assert(gates.commands.every(c => c.status === "PASS" && c.exitCode === 0 && c.error === null));
  assert.equal(gates.afterProducts.length, 4); assert.equal(gates.resourcePairs.length, 3);
  assert.equal(gates.afterProducts[0].sha256, gates.afterProducts[1].sha256);
  assert.equal(gates.afterProducts[2].sha256, gates.afterProducts[3].sha256);
  assert.notEqual(gates.beforeProducts[0].sha256, gates.afterProducts[0].sha256);
  assert.equal(native.returnOnly, false); assert.equal(native.cleanupError, null);
  assert.equal(native.cases.length, 12); assert(native.cases.every(c => c.status === "PASS"));
  assert.equal(native.launches.length, 6); assert(native.launches.every(l => l.cleanup?.status === "PASS"));
  assert.equal(native.realModelRequests, 0); assert.equal(native.installs, 0);
  for (const layout of ["agentvn", "renpy"]) {
    const returned = native.replayReturnObservations.find(c => c.layout === layout); assert(returned);
    assert.equal(returned.destination, "main_menu");
    const replay = native.cases.find(c => c.layout === layout && c.name.startsWith("Replay ends")); assert(replay);
    assert.equal(replay.detail.final.scene, "qa_gallery"); assert.equal(replay.detail.final.index, 2);
    assert(replay.detail.final.text.includes("GALLERY_AFTER")); assert.equal(replay.detail.savesUnchanged, true);
    const broken = native.brokenObservations.find(c => c.layout === layout); assert(broken);
    assert.equal(broken.visibleDiagnostic, true); assert.equal(broken.returned, "main_menu");
    const imageCase = native.cases.find(c => c.layout === layout && c.name.startsWith("Invalid image")); assert(imageCase);
    assert.equal(imageCase.detail.originalStoryStillPlayable, true); assert.match(broken.retryDiagnostic, /无法加载|失败|损坏/);
  }
  assert.equal(browser.screenshots.length, 12); assert.equal(native.screenshots.length, 8);
}
function check(name, fn) {
  const r = { name, status: "RUNNING" }; report.checks.push(r);
  try { r.detail = fn(); r.status = "PASS"; }
  catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); throw e; }
}
try {
  const data = files.map(read), [state, browser, gates, native] = data;
  check("Complete current workflows, build gates and native returns", () => {
    validate(data); return { reports: files.map(desc), stateCases: 8, browserCases: 8,
      nativeCases: 12, browserDisplayCells: 24, nativeDisplayCells: 24, normalCloseTested: false };
  });
  check("Empty, falsely green, incomplete and inconsistent evidence rejected", () => {
    const mutations = [
      r => { r[0].cases = []; }, r => { r[0].cases[0].actual.returnScreen = "title_menu"; },
      r => { r[1].cases[0].restored = []; }, r => { r[1].cases[1].retryDiagnostic = ""; },
      r => { r[1].matrix = []; }, r => { r[1].matrix[0].dpr = 3; },
      r => { r[1].ownedServiceStopped = false; }, r => { r[2].commands[0].exitCode = 1; },
      r => { r[2].afterProducts[0].sha256 = "wrong"; }, r => { r[3].launches[0].cleanup.status = "FAILED"; },
      r => { r[3].cases = []; }, r => { r[3].cases.find(c => c.name.startsWith("Invalid image")).detail.originalStoryStillPlayable = false; },
      r => { r[3].replayReturnObservations[0].destination = "title_menu"; }, r => { r[3].screenshots = []; },
    ];
    for (const mutate of mutations) {
      const modified = structuredClone(data); mutate(modified); assert.throws(() => validate(modified));
    }
    return { rejected: mutations.length };
  });
  check("Actual source, bundle, executable, raw screenshots and profile restoration bytes", () => {
    const verified = [];
    for (const item of [...state.productSources, ...browser.productSources, ...gates.afterProducts,
      ...gates.receipts, ...gates.resourcePairs.flatMap(p => [p.source, p.bundled]),
      ...gates.commands.map(c => c.log), ...native.products, ...native.tools, ...native.sources,
      native.profileRestoration, ...native.cartridges, ...native.brokenCartridges]) {
      assert.equal(sha(item.path), item.sha256, item.path); verified.push(item.path);
    }
    for (const s of [...browser.screenshots, ...native.screenshots]) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const bytes = fs.readFileSync(s.path);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    const restored = read(native.profileRestoration.path);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    for (const c of native.cases.filter(c => c.name.startsWith("Real story progression"))) {
      const physical = c.detail.physical;
      const archived = path.join(path.dirname(files[3]), "player-roaming/gallery",
        path.basename(path.dirname(physical.path)), path.basename(physical.path));
      assert.equal(sha(archived), physical.sha256);
    }
    const frozenBefore = read(path.join(qa, "browser-02/report.json"));
    assert.equal(frozenBefore.status, "FAILED"); assert.equal(frozenBefore.cases.length, 4);
    assert(frozenBefore.cases.every(c => c.status === "FAILED"));
    return { files: verified.length, screenshots: 20, userFilesDeleted: 0, historicalRedPreserved: true };
  });
  check("Owned processes, WebViews and debug ports have no residuals", () => {
    const pids = [browser.server.pid, ...native.launches.map(l => l.pid)].join(",");
    const ports = [Number(new URL(browser.server.url).port), ...native.launches.map(l => l.port)].join(",");
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);` +
      `$qaIds=@(${pids});$qaPorts=@(${ports});` +
      `$qaActive=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in $qaIds -or ` +
      `($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*Native-Runtime-State-20261020-01*gallery-${nativeRun}*')}|` +
      `Select-Object ProcessId,ExecutablePath,CreationDate);` +
      `$qaListeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in $qaPorts}|` +
      `Select-Object LocalAddress,LocalPort,OwningProcess);` +
      `@{processes=@($qaActive);listeners=@($qaListeners)}|ConvertTo-Json -Depth 5 -Compress`],
    { encoding: "utf8", windowsHide: true, timeout: 20000 }).trim();
    const remaining = JSON.parse(raw.replace(/^\uFEFF/, ""));
    assert.equal(remaining.processes.length, 0); assert.equal(remaining.listeners.length, 0);
    return remaining;
  });
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
