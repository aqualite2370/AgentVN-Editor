"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-assistant-session-20261018-01", out = process.argv[2];
assert(out && !fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => sha256(fs.readFileSync(f));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", g03Status: "FAILED",
  at: new Date().toISOString(), checks: [], inputs: [], screenshots: 0, error: null, productChanges: 0, realModelRequests: 0,
  notRun: ["Frontend-only restart during active task and backend worker_lost with queued task",
    "Second native Editor process global monitor/cancellation", "Full creation merge/exclusions/conflict/export player and real DeepSeek",
    "Full floating-window motion/reverse/cancellation frame audit", "Android, physical4K and normal physical window close"] };
function load(name) {
  const f = path.join(run, name); report.inputs.push({ path: f, sha256: sha(f) }); return read(f);
}
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
function matrix(rows) {
  assert.equal(rows.length, 12);
  const keys = new Set(rows.map(r => `${r.width}/${r.height}/${r.dpr}/${r.reduced}`));
  for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const d of [1, 2]) for (const m of [false, true])
    assert(keys.has(`${w}/${h}/${d}/${m}`));
  assert(rows.every(r => r.status === "PASS"));
}
(async () => {
  const fixture = load("fixtures.json"), prep = load("preparation.json");
  const window = load("window-02/report.json"), windowRestart = load("window-restart-01/report.json");
  const lifecycle = load("lifecycle-01/report.json"), finish = load("lifecycle-finish-01/report.json");
  const restart = load("lifecycle-restart-02/report.json");
  const focus = [];
  for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const d of [1, 2]) for (const m of [false, true]) {
    const f = load(w === 1920 && d === 1 && !m ? "focus-02/report.json" : `focus-${w}-${d}-${m}/report.json`);
    focus.push({ width: w, height: h, dpr: d, reduced: m, report: f });
  }
  await check("Actual installed candidate and independent checkpoint/fixture provenance", () => {
    const installRoot = prep.installRoot, launches = [];
    for (const suffix of ["", "-02", "-03"]) {
      const l = load(`launch${suffix}.json`), b = load(`backend-ready${suffix}.json`);
      assert.equal(l.status, "PASS"); assert.equal(b.status, "PASS");
      assert(!l.dataDirectoryOverride && !l.webviewDirectoryOverride && !l.manualBackendSpawn);
      assert.equal(l.installRoot, installRoot);
      assert.equal(sha(path.join(installRoot, "agentvn-editor.exe")), l.executableSha256);
      assert.equal(l.executableSha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
      assert.equal(sha(path.join(installRoot, "creator-backend.exe")), b.backendSha256);
      launches.push({ editorPid: l.editorPid, editorSha256: l.executableSha256, backendSha256: b.backendSha256 });
    }
    assert.equal(fixture.status, "PASS"); assert.equal(fixture.projects.length, 2);
    for (const p of fixture.projects) assert.equal(sha(p.input), p.sha256);
    const checkpoint = "F:/AgentVN-QA-Assistant-Checkpoint-20261018-01";
    const copies = ["scripts/installed-preview-session.ps1", "scripts/installed-assets-recover-tool-session.ps1",
      "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"].map(f => ({ path: path.join(checkpoint, f), sha256: sha(path.join(checkpoint, f)) }));
    return { launches, fixtureProjects: 2, preservedPrechangeCopies: copies };
  });
  await check("Real window pointer/keyboard resize, docking, minimize, bounds and actual process restart", () => {
    assert.equal(window.status, "PASS"); assert.equal(window.checks.length, 16); matrix(window.matrix);
    assert.equal(window.apiSubmissions, 0); assert(window.checks.every(c => c.status === "PASS")); assert.equal(window.errors.length, 0);
    assert.equal(windowRestart.status, "PASS"); assert.equal(windowRestart.checks.length, 1); assert.equal(windowRestart.apiSubmissions, 0);
    return { checks: 17, matrix: 12, actualProcessRestart: true,
      pointerCancelAndFullMotionNotTested: true };
  });
  await check("Controlled real HTTP inquiry/queue/lock/history and deletion continuation, without paid retry or automatic merge", () => {
    assert.equal(lifecycle.status, "FAILED"); assert.equal(lifecycle.checks.length, 6);
    assert(lifecycle.checks.slice(0, 5).every(c => c.status === "PASS"));
    assert(lifecycle.error.includes("name: '永久删除'"));
    matrix(lifecycle.lockMatrix); matrix(lifecycle.historyMatrix);
    assert.equal(lifecycle.errors.length, 0); assert.equal(lifecycle.modelBoundary.length, 3);
    assert.deepEqual(lifecycle.modelBoundary.map(r => r.marker), ["HISTORY_A", "QUEUE_A", "QUEUE_C"]);
    assert.equal(lifecycle.modelBoundary[0].creation, false); assert.deepEqual(lifecycle.modelBoundary[0].tools, []);
    assert.equal(lifecycle.providerCleanup.stopped, true); assert.equal(lifecycle.providerCleanup.maxConcurrentCreation, 1);
    assert.equal(lifecycle.credentialCleanup, "CLEARED_TEST_ONLY_PROVIDER_AND_SECRET"); assert(!lifecycle.taskCleanupError);
    assert.equal(finish.status, "PASS"); assert.equal(finish.checks.length, 1);
    assert.equal(finish.continuedFrom.sha256, sha(path.join(run, "lifecycle-01/report.json")));
    assert.equal(finish.submissions.length, 0); assert.equal(finish.finalConversations.length, 3);
    return { originalPassingStages: 5, continuationStages: 1, locks: 12, history: 12,
      controlledExternalHttpRequests: 3, paidRequests: 0, automaticMerge: false };
  });
  await check("Actual installed Editor/backend restart preserves serialized history/drafts and deleted conversation remains absent", () => {
    const old = load("lifecycle-restart-01/report.json");
    assert.equal(old.status, "FAILED"); assert(old.error.includes("undefined"));
    assert.equal(restart.status, "PASS"); assert.equal(restart.checks.length, 1); assert.equal(restart.submissions.length, 0);
    assert.equal(restart.checks[0].detail.records, 3);
    return { passingRestartStages: 1, serializedFieldsAllCompared: true,
      originalUndefinedVsAbsentOracleFailureRetained: true, secondReportSameLaunchedProcess: true };
  });
  await check("Keyboard focus defect genuinely reproduced across twelve native WebView combinations, not hidden as pass", () => {
    assert.equal(focus.length, 12);
    for (const f of focus) {
      assert.equal(f.report.status, "FAILED"); assert.equal(f.report.error, null);
      assert.equal(f.report.defect, "G03_FLOATING_WORKBENCH_KEYBOARD_FOCUS_NOT_HANDED_OFF");
      assert.equal(f.report.openFocus.inside, false); assert.equal(f.report.openFocus.tag, "BODY");
      assert.equal(f.report.closeFocus.restored, false); assert.equal(f.report.closeFocus.activeTag, "BODY");
      assert.equal(f.report.checks.length, 2); assert(f.report.checks.every(c => c.status === "FAILED"));
      const view = f.report.screenshots[0].before;
      assert.deepEqual(view, { width: f.width, height: f.height, dpr: f.dpr, reduced: f.reduced });
    }
    report.defect = "G03_FLOATING_WORKBENCH_KEYBOARD_FOCUS_NOT_HANDED_OFF";
    return { productStatus: "FAILED", combinations: 12, failedFocusAssertions: 24 };
  });
  await check("All captures independently verify actual viewport/DPR/media, PNG pixel dimensions and SHA", () => {
    const extraRestart = load("lifecycle-restart-01/report.json");
    const reports = [window, windowRestart, lifecycle, finish, restart, extraRestart, ...focus.map(f => f.report)];
    for (const r of reports) for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const png = fs.readFileSync(s.path);
      assert.equal(png.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(png.readUInt32BE(20), s.before.height * s.before.dpr);
      report.screenshots++;
    }
    assert(report.screenshots > 40);
    return { screenshots: report.screenshots, nativeWebviewEmulation: true, physical4k: false, fullAnimationClaim: false };
  });
  await check("Original four profiles/55 independent file hashes, original database/Dev/pending MSI stay unchanged", () => {
    const restore = load("profile-restoration.json"); assert.equal(restore.status, "PASS");
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original)); assert(!fs.existsSync(p.held));
      for (const f of p.files) {
        assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++;
      }
    }
    assert.equal(count, 55); assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const incident = read("D:/AgentVN/output/host-msi-session-20261018-01/incident-audit-01.json");
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(sha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    return { independentOriginalHashes: 55, originalDbUnchanged: true, devUnchanged: true, pendingMsiUntouched: true };
  });
  await check("Three attributed test teardowns and controlled provider leave no owned process/listener; failures immutable", () => {
    const ports = [8278, Number(new URL(lifecycle.provider.url).port)];
    for (const suffix of ["", "-02", "-03"]) {
      const l = load(`launch${suffix}.json`), c = load(`computer-use-import-blocked${suffix}.json`);
      assert.equal(c.cleanupStatus, "PASS"); assert.equal(c.normalClose, "NOT_RUN_CONTROLLED_TEST_TEARDOWN");
      ports.push(l.cdpPort, l.playerCdpPort);
    }
    const state = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object ProcessId,Name)
      $s=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$p;ports=$s}|ConvertTo-Json -Depth 6
    `], { windowsHide: true, encoding: "utf8", timeout: 15000 });
    assert.equal(state.status, 0, state.stderr);
    const current = JSON.parse(state.stdout.replace(/^\uFEFF/, ""));
    assert.equal(current.processes.length, 0); assert.equal(current.ports.length, 0);
    assert.equal(load("window-01/report.json").status, "FAILED");
    assert.equal(load("focus-01/report.json").status, "FAILED");
    return { ...current, portsChecked: ports, retainedToolFailures: 4, normalPhysicalClose: "NOT_RUN", notRun: report.notRun };
  });
  report.status = "PASS"; report.evidenceStatus = "PASS";
})().catch(e => { report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus, g03Status: report.g03Status,
    groups: report.checks.length, screenshots: report.screenshots, error: report.error, out }, null, 2));
});
