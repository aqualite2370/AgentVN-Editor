"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Runtime-Gallery-Repair-20261020-01";
const nativeQa = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const name = process.argv[2] || "session-audit-01";
assert(/^session-audit-\d{2}$/.test(name));
const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
const reports = ["state-06/report.json", "browser-05/report.json", "gates-02/report.json"]
  .map(f => path.join(qa, f)).concat(path.join(nativeQa, "gallery-05/report.json"));
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], error: null,
  scope: "ROLLBACK_SESSION_SOURCE_NEW_DEV_NATIVE_LIBRARY_NOT_RELEASE_INSTALL" };
function check(name, fn) {
  const c = { name, status: "RUNNING" }; report.checks.push(c);
  try { c.detail = fn(); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
}
function validate([state, browser, gates, native]) {
  for (const r of [state, browser, gates, native]) assert.equal(r.status, "PASS");
  assert.equal(state.rollbackRequired, true); assert.equal(state.cases.length, 8);
  assert(state.cases.every(c => c.status === "PASS"));
  assert.equal(state.cases.filter(c => c.rollback?.roundTrip === true).length, 6);
  assert(state.cases.filter(c => c.entry !== "title_menu").every(c => c.actual.canRollbackBeforeLeavingGallery));
  assert.equal(browser.rollbackRequired, true); assert.equal(browser.cases.length, 4);
  assert.deepEqual(browser.cases.map(({ layout, reduced }) => ({ layout, reduced })),
    ["agentvn", "renpy"].flatMap(layout => [false, true].map(reduced => ({ layout, reduced }))));
  for (const c of browser.cases) {
    assert.equal(c.status, "PASS"); assert.equal(c.broken, false);
    assert.deepEqual(c.restored, ["manual-exit", "scene-end"]);
    assert.deepEqual(c.rollbackRoundTrips, ["manual-exit", "scene-end"]);
  }
  assert.deepEqual(browser.matrix, []); assert.deepEqual(browser.pageErrors, []);
  assert.equal(browser.error, null); assert.equal(browser.cleanupError, null);
  assert.equal(browser.ownedServiceStopped, true);
  assert.equal(gates.sessionOnly, true); assert.equal(gates.commands.length, 16);
  assert(gates.commands.every(c => c.status === "PASS" && c.exitCode === 0 && !c.error));
  assert.equal(gates.resourcePairs.length, 4);
  assert.equal(gates.afterProducts[0].sha256, gates.afterProducts[1].sha256);
  assert.equal(gates.afterProducts[2].sha256, gates.afterProducts[3].sha256);
  assert.notEqual(gates.afterProducts[0].sha256, gates.beforeProducts[0].sha256);
  assert.equal(native.rollbackRequired, true); assert.equal(native.returnOnly, true);
  assert.equal(native.cases.length, 4); assert(native.cases.every(c => c.status === "PASS"));
  assert.deepEqual(native.matrix, []); assert.deepEqual(native.pageErrors, []);
  assert.equal(native.error, null); assert.equal(native.cleanupError, null);
  assert.equal(native.launches.length, 2); assert(native.launches.every(l => l.cleanup?.status === "PASS"));
  for (const layout of ["agentvn", "renpy"]) {
    const c = native.cases.find(c => c.layout === layout && c.name.startsWith("Replay ends")); assert(c);
    assert.equal(c.detail.destination, "main_menu"); assert.equal(c.detail.savesUnchanged, true);
    assert.equal(c.detail.rollbackRoundTrip.previous.index, 0);
    assert(c.detail.rollbackRoundTrip.previous.text.includes("GALLERY_OPENING"));
    assert.equal(c.detail.rollbackRoundTrip.restored.index, 2);
    assert(c.detail.rollbackRoundTrip.restored.text.includes("GALLERY_AFTER"));
  }
}
try {
  fs.copyFileSync(__filename, path.join(out, path.basename(__filename)), fs.constants.COPYFILE_EXCL);
  const data = reports.map(read), [state, browser, gates, native] = data;
  check("Complete current public actions, trusted keyboard and build flows", () => {
    validate(data); return { reports: reports.map(desc), stateCases: 8, browserCases: 4, nativeCases: 4,
      fullMotionOrDisplayMatrixRepeated: false, physicalCloseOrInstallClaim: false };
  });
  check("Empty, stale, incomplete and falsely green session evidence rejected", () => {
    const mutations = [r => { r[0].cases = []; }, r => { r[0].cases[0].rollback.roundTrip = false; },
      r => { r[1].cases[0].rollbackRoundTrips = []; }, r => { r[1].cases[0].reduced = true; },
      r => { r[1].ownedServiceStopped = false; }, r => { r[2].commands[0].exitCode = 1; },
      r => { r[2].afterProducts[0].sha256 = "invalid"; }, r => { r[3].cases = []; },
      r => { r[3].launches[0].cleanup.status = "FAILED"; },
      r => { r[3].cases.find(c => c.name.startsWith("Replay ends")).detail.rollbackRoundTrip.previous.index = 2; }];
    for (const mutation of mutations) { const modified = structuredClone(data); mutation(modified); assert.throws(() => validate(modified)); }
    return { rejected: mutations.length };
  });
  check("Raw source, bundle, executables, screenshots and user profile restoration", () => {
    const items = [...state.productSources, ...browser.productSources, ...gates.receipts,
      ...gates.commands.map(c => c.log), ...gates.afterProducts, ...gates.resourcePairs.flatMap(p => [p.source, p.bundled]),
      ...native.products, ...native.sources, ...native.tools, ...native.cartridges, ...native.brokenCartridges, native.profileRestoration];
    for (const item of items) assert.equal(sha(item.path), item.sha256, item.path);
    const screenshots = [...browser.screenshots, ...native.screenshots]; assert.equal(screenshots.length, 10);
    for (const s of screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const png = fs.readFileSync(s.path);
      assert.equal(png.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(png.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    const restoration = read(native.profileRestoration.path);
    assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
    const red = read(path.join(qa, "state-05/report.json")), browserRed = read(path.join(qa, "browser-04/report.json"));
    assert.equal(red.status, "FAILED"); assert.equal(red.cases.filter(c => c.status === "FAILED").length, 6);
    assert.equal(browserRed.status, "FAILED"); assert.equal(browserRed.cases.length, 2);
    assert(browserRed.cases.every(c => c.status === "FAILED"));
    for (const source of red.productSources) {
      const relative = path.relative(root, source.path);
      assert.equal(sha(path.join("F:/AgentVN/Checkpoints/Runtime-Gallery-Session-20261020-01", relative)), source.sha256);
    }
    return { files: items.length, screenshots: screenshots.length, oldFailedEvidencePreserved: true, deletedUserFiles: 0 };
  });
  check("Process/port cleanup and read-only publishing checks", () => {
    const pids = [browser.server.pid, ...native.launches.map(l => l.pid)].join(",");
    const ports = [Number(new URL(browser.server.url).port), ...native.launches.map(l => l.port)].join(",");
    const text = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$qaIds=@(${pids});$qaPorts=@(${ports});` +
      `$qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in $qaIds -or ` +
      `($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*Native-Runtime-State-20261020-01*gallery-05*')});` +
      `$qaListeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in $qaPorts});` +
      `@{processes=@($qaProcesses|Select-Object ProcessId,ExecutablePath);listeners=@($qaListeners|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4 -Compress`],
    { encoding: "utf8", windowsHide: true, timeout: 20000 }).trim();
    const remaining = JSON.parse(text.replace(/^\uFEFF/, ""));
    assert.equal(remaining.processes.length, 0); assert.equal(remaining.listeners.length, 0);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const index = sha(path.join(root, ".git/index"));
    const output = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/push-agentvn-editor.ps1"), "-CheckOnly"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
    assert.match(output, /CHECK_ONLY_PASS/);
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), head);
    assert.equal(sha(path.join(root, ".git/index")), index);
    return { remaining, head, indexSha256: index, publishingCheck: output, stagedOrCommittedOrPushed: false };
  });
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
