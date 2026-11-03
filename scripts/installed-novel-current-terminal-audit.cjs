"use strict";
// Independent evidence, actual archived QA database and profile-restoration audit.
// Controlled task HTTP is never promoted to real provider/backend task execution.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const { assertFloatingMotion } = require("./lib/floating-motion-probe.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-novel-session-20261018-01");
const checkpoint = "F:/AgentVN-QA-NovelFloating-Checkpoint-20261018-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => sha256(fs.readFileSync(p));
const dest = process.argv[2]; assert(dest && path.dirname(path.resolve(dest)) === path.resolve(run) && !fs.existsSync(dest));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", controlledNovelUIStatus: "NOT_EVALUATED",
  realNovelModelStatus: "NOT_RUN_REQUIRES_USER_CONFIGURED_ISOLATED_CREDENTIALS", at: new Date().toISOString(),
  checks: [], inputs: [], commands: [], artifacts: [], screenshots: 0, motionFrames: 0,
  productChanges: 0, realModelRequests: 0, error: null };
const load = p => { report.inputs.push({ path: p, sha256: sha(p) }); return read(p); };
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
function actualTool(t) {
  if (sha(t.path) === t.sha256) return { path: t.path, sha256: t.sha256 };
  const candidates = path.basename(t.path) === "current-installed-novel-session.cjs"
    ? ["current-installed-novel-session.startup-race.cjs", "current-installed-novel-session.identity-oracle.cjs"]
    : ["installed-novel-task-floating.startup-race.cjs"];
  const matching = candidates.map(n => path.join(checkpoint, n)).find(p => fs.existsSync(p) && sha(p) === t.sha256);
  assert(matching, "Original failed tool identity must be preserved");
  return { path: matching, sha256: t.sha256, originalToolArchived: true };
}
(async () => {
  const prep = load(path.join(run, "preparation.json")), raw = load(path.join(run, "flow-03/report.json"));
  const early = [1, 2].map(n => load(path.join(run, `flow-0${n}/report.json`)));
  await check("Original zero-case tool failures remain FAILED and are not counted as clean launches or cleanup", () => {
    for (const r of early) {
      assert.equal(r.status, "FAILED"); assert.equal(r.cases.length, 0); assert.equal(r.matrix.length, 0);
      assert.equal(r.cleanup.length, 0); assert(r.error);
    }
    assert(fs.existsSync(path.join(run, "tool-startup-race-01.md")));
    const tools = [...early, raw].flatMap(r => r.tools.map(actualTool));
    const firstLaunch = load(path.join(run, "launch.json"));
    assert.equal(raw.launches[0].editorPid, firstLaunch.editorPid,
      "First healthy original process was adopted, not restarted because of a health-observation race");
    return { originalToolFailures: 2, zeroMatricesExcluded: true, originalLaunchAdopted: firstLaunch.editorPid, tools };
  });
  await check("Two actual frozen NSIS Editor/automatic-backend sessions use protected default paths,560 source hashes unchanged", () => {
    assert.equal(raw.status, "PASS"); report.controlledNovelUIStatus = raw.status;
    assert.equal(raw.productChanges, 0); assert.equal(raw.realModelRequests, 0);
    assert.equal(raw.launches.length, 2); assert.notEqual(raw.launches[0].editorPid, raw.launches[1].editorPid);
    assert.notEqual(raw.launches[0].backendPid, raw.launches[1].backendPid);
    assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    for (const l of raw.launches) {
      assert.equal(l.exeSha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
      assert.equal(l.dataDirectoryOverride, false); assert.equal(l.webviewDirectoryOverride, false);
      assert.equal(l.manualBackendSpawn, false);
      assert.equal(path.resolve(l.databasePath), path.resolve("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"));
      const ready = load(l.backendReadyFile); assert.equal(ready.status, "PASS");
      assert.equal(sha(path.join(prep.installRoot, "creator-backend.exe")), ready.backendSha256);
      const parent = ready.processes.find(p => p.Name === "creator-backend.exe" && p.ParentProcessId === l.editorPid);
      assert(parent && parent.ProcessId === l.backendPid);
    }
    const frozen = load(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560);
    for (const p of frozen.source) assert.equal(sha(p.path), p.sha256, p.path);
    assert.equal(raw.sourceUnchanged, true);
    assert.equal(raw.errors.length, 0); assert.equal(raw.forbiddenRequests.length, 0);
    return { actualNativeEditorSessions: 2, automaticPackagedBackends: 2, frozenSourceFiles: 560,
      controlledTaskHTTP: true, realTaskBackendExecutionClaim: false };
  });
  await check("Eight complete nonempty real-UI flows and12 full viewport/DPR/media combinations have48 continuous probes", () => {
    const names = ["installed-task-recovery-and-real-project-entry",
      "installed-high-resolution-card-workspace-motion-and-focus-matrix",
      "installed-drag-threshold-project-position-and-real-process-restart",
      "installed-pointer-capture-cancel-and-nonmodal-workspace",
      "installed-slow-refresh-single-flight-and-task-controls",
      "installed-late-action-and-result-reject-A-B-A-ownership",
      "installed-results-failure-retry-real-navigation-idempotence-and-chapter-append",
      "installed-native-save-confirmation-priority-and-floating-focus"];
    assert.deepEqual(raw.cases.map(c => c.name), names); assert(raw.cases.every(c => c.status === "PASS"));
    assert.equal(raw.matrix.length, 12);
    const keys = new Set(raw.matrix.map(m => `${m.width}:${m.height}:${m.dpr}:${m.reduced}`));
    assert.equal(keys.size, 12);
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true])
      assert(keys.has(`${w}:${h}:${dpr}:${reduced}`));
    for (const m of raw.matrix) {
      assert.equal(m.status, "PASS");
      const expected = { width: m.width, height: m.height, dpr: m.dpr, reduced: m.reduced };
      assert.deepEqual(m.actualBefore, expected); assert.deepEqual(m.actualAfter, expected);
      for (const [key, duration, minOpacity] of [["entry", 240, 0], ["exit", 240, 0], ["redirect", 240, 0], ["token", 160, 0.65]]) {
        const p = m[key], summary = assertFloatingMotion(p, m, {
          reduced: m.reduced, duration: m.reduced ? 80 : duration, minOpacity,
        });
        assert.deepEqual(summary, m[`${key}Summary`]);
        for (const f of p.frames.filter(f => f.rendered)) assert.deepEqual(f.viewport,
          { width: m.width, height: m.height, dpr: m.dpr });
        report.motionFrames += p.frames.length;
      }
      const g = m.geometry;
      assert(g.hit && g.progress === "50" && g.nestedButtons === 0 && g.overflow <= 1);
      assert(g.card.width >= 250 && g.card.width <= 282 && g.card.height >= 80 && g.card.height <= 96);
      assert(g.card.x >= 12 && g.card.right <= m.width - 12 && g.card.bottom <= g.status.top - 11);
      assert(m.footer.length > 0 && m.footer.every(b => b.hit && b.contained));
      assert(m.redirectInput.hit && m.redirectInput.previousInert);
    }
    return { businessFlows: names.length, matrices: 12, probes: 48, rawFrames: report.motionFrames,
      reducedMotionIndependentlyChecked: true, nativeWebviewEmulationNotPhysical4K: true };
  });
  await check("Native drag commit restores after actual process termination; default reset tombstone and extra-pointer invariants remain", () => {
    const c = raw.cases[2], p = raw.cases[3], probe = raw.restartProbe;
    assert.deepEqual(c.initial, c.small, "4px movement must not cross6px threshold");
    assert(c.initial.x - c.moved.x > 100 && c.initial.y - c.moved.y > 40);
    assert(c.saved.x >= 0 && c.saved.x <= 1 && c.saved.y >= 0 && c.saved.y <= 1);
    assert.deepEqual(probe.beforeClosePosition, c.saved);
    assert.deepEqual(probe.restored.saved, c.saved);
    for (const key of ["x", "y", "width", "height"]) assert(Math.abs(c.restored[key] - c.moved[key]) < 2);
    assert.equal(p.captureLoss, "PASS"); assert.deepEqual(p.singlePointer, p.extraPointer);
    for (const track of ["palette", "flow", "inspector"]) for (const k of ["x", "y", "width", "height"])
      assert(Math.abs(p.before[track][k] - p.after[track][k]) < 1);
    assert.equal(raw.normalWindowClose.status, "NOT_RUN");
    const restoration = load(path.join(run, "profile-restoration.json"));
    const held = restoration.profiles.find(p => p.app === "editor" && p.kind === "Roaming").testHeld;
    const id = "installed_novel_flow-03_a";
    const file = path.join(held, "ui-preferences/novel-card-positions", `${sha256(Buffer.from(id))}.json`);
    const value = load(file); assert.deepEqual(value, { schemaVersion: 1, projectId: id, position: null });
    return { actualNativePositionTombstone: file, nativePositionRestoredInNewProcess: true,
      nonmodalBackgroundEdit: true, realBackendTaskCrashRecoveryClaim: false };
  });
  await check("Slow polling is single-flight,real task actions and delayed success/error/result deliveries are explicit controlled HTTP", () => {
    const c = raw.cases[4], late = raw.cases[5];
    assert(c.reads.length >= 3);
    for (const [i, r] of c.reads.entries()) {
      assert.equal(r.operation, "panel"); assert(r.end && r.browserFinished); assert(r.end - r.start >= 1100);
      assert(!c.reads.slice(i + 1).some(n => n.start < r.end));
    }
    assert.deepEqual(c.operations.map(o => o.operation), ["pause", "resume", "retry_failed_chunks", "cancel"]);
    assert(c.operations.every(o => o.method === "POST" && o.end && o.browserFinished));
    assert.deepEqual(late.staleActionSuccessAndError.map(r => r.failure), [false, true]);
    assert(late.staleActionSuccessAndError.every(r => r.response.held && r.response.browserFinished));
    assert.equal(late.staleActionSuccessAndError[1].response.controlledFailure, "controlled-stale-action-error");
    assert.equal(late.staleAbaResult, "PASS");
    assert(raw.transport.some(r => r.operation === "results" && r.held && r.browserFinished));
    assert(raw.transport.some(r => r.operation === "results" && r.chapterCount === 2 && r.browserFinished));
    assert.equal(raw.forbiddenRequests.length, 0);
    return { transportRecords: raw.transport.length, controlledJobs: [...new Set(raw.transport.map(r => r.jobId))],
      slowCompletedReads: c.reads.length, actualTaskActionClicks: c.operations.length, newModelTaskRequests: 0,
      noClaimOfRealBackendPauseOrInference: true };
  });
  await check("Saved native vnproj and read-only archived QA database preserve idempotent chapters and keep other project uncontaminated", async () => {
    const c = raw.cases[6], last = raw.cases[7]; assert.deepEqual(c.first, c.repeated);
    assert(c.first.nodes.every(id => c.appended.nodes.includes(id)));
    assert(c.first.edges.every(id => c.appended.edges.includes(id)));
    assert.equal(c.appended.nodes.length, c.first.nodes.length + 1);
    assert.equal(c.appended.edges.length, c.first.edges.length + 1);
    assert(last.priority.hit && last.priority.focus); assert.equal(last.exportedFiles.length, 1);
    const file = path.join(last.exportDirectory, last.exportedFiles[0]), bytes = fs.readFileSync(file);
    const zip = await JSZip.loadAsync(bytes), project = JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(project.project_id, "installed_novel_flow-03_a");
    assert.deepEqual(project.nodes.map(n => n.id), c.appended.nodes);
    assert.deepEqual(project.edges.map(e => e.id), c.appended.edges);
    assert.equal(project.nodes.find(n => n.id === "scene").data.editorMeta.sourceProcessJobId, "unrelated-completed-task");
    const imported = project.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === "installed-floating-a");
    assert.equal(imported.length, 2);
    for (const n of raw.importedNodes) assert.deepEqual(imported.find(i => i.id === n.id), n);
    const artifact = { path: file, sha256: sha256(bytes), bytes: bytes.length, generatedAt: fs.statSync(file).mtime.toISOString() };
    report.artifacts.push(artifact);
    const restoration = read(path.join(run, "profile-restoration.json"));
    const held = restoration.profiles.find(p => p.app === "editor" && p.kind === "Roaming").testHeld;
    const dbfile = path.join(held, "backend/vn_engine.db"), before = sha(dbfile);
    const db = new DatabaseSync(dbfile, { readOnly: true });
    try {
      const row = id => JSON.parse(db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get(id).project_json);
      const a = row("installed_novel_flow-03_a"), b = row("installed_novel_flow-03_b");
      assert.deepEqual(a.nodes.map(n => n.id), c.appended.nodes);
      assert.deepEqual(a.edges.map(e => e.id), c.appended.edges);
      assert.equal(b.nodes.length, 2);
      assert.equal(b.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === "installed-floating-a").length, 0);
      assert.equal(b.nodes.find(n => n.id === "scene").data.editorMeta.sourceProcessJobId, "unrelated-completed-task");
    } finally { db.close(); }
    assert.equal(sha(dbfile), before, "Independent archived QA DB inspection must remain read-only");
    return { artifact, importedChapters: 2, exactImportedNodePayloads: true, preservedOtherProjectNodes: 2,
      archivedDatabase: { path: dbfile, sha256: before, readOnly: true }, runtimeCartridgeConsumptionClaim: false };
  });
  await check("Four original profiles55SHA/DB/Dev/pendingMSI are restored and all owned processes/ports ended", () => {
    const restoration = load(path.join(run, "profile-restoration.json")); assert.equal(restoration.status, "PASS");
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) {
        assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++;
      }
    }
    assert.equal(count, 55); assert.equal(sha(path.join(root, "AgentVN Dev.exe")), prep.originalDevSha256);
    const incident = load(path.join(root, "output/host-msi-session-20261018-01/incident-audit-01.json"));
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(sha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    assert.equal(raw.cleanup.length, 2);
    for (const c of raw.cleanup) {
      assert.equal(c.editor.exitCode, 0); assert.equal(c.backend.exitCode, 0); assert.equal(sha(c.evidence), c.sha256);
      const stop = load(c.evidence); assert.equal(stop.status, "PASS"); assert.equal(stop.after.length, 0);
      assert.equal(stop.before.length, 3); assert.equal(stop.normalWindowClose, "NOT_RUN");
    }
    const ports = [...new Set(raw.launches.flatMap(l => [l.backendPort, l.cdpPort, l.playerCdpPort]))];
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaProcesses;ports=$qaPorts}|ConvertTo-Json -Depth 6
    `], { windowsHide: true, encoding: "utf8", timeout: 20000 });
    assert.equal(result.status, 0, result.stderr);
    const live = JSON.parse(result.stdout.replace(/^\uFEFF/, "")); assert.equal(live.processes.length, 0); assert.equal(live.ports.length, 0);
    assert.equal(raw.portCleanup.status, "PASS"); assert.deepEqual(raw.portCleanup.ports.sort(), [...new Set(raw.launches.flatMap(l => [l.backendPort, l.cdpPort]))].sort());
    return { originalFileHashes: count, attributedNativeProcessStops: 6, normalCloseClaim: false, portsChecked: ports, ...live };
  });
  await check("Fourteen native PNGs preserve actual highDPI pixels and screenshot geometry", () => {
    assert.equal(raw.screenshots.length, 14);
    for (const s of raw.screenshots) {
      assert.deepEqual(s.before, s.after); assert.equal(sha(s.path), s.sha256); const bytes = fs.readFileSync(s.path);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr); report.screenshots++;
    }
    return { nativeScreenshots: report.screenshots, screenshotOnlyClaim: false };
  });
  await check("Core/append/position/evidence support regressions and changed test tool parsers pass", () => {
    const tests = ["novel-processing-core-test.cjs", "novel-import-append-graph-contract-test.cjs",
      "novel-card-position-store-test.cjs", "full-regression-evidence-test.cjs"];
    for (const [i, f] of tests.entries()) {
      const result = spawnSync(process.execPath, [`scripts/${f}`], { cwd: root, windowsHide: true, encoding: "utf8", timeout: 120000 });
      const file = path.join(run, `${path.basename(dest, ".json")}-support-${i + 1}.log`);
      fs.writeFileSync(file, `${result.stdout || ""}\n${result.stderr || ""}`, { flag: "wx" });
      report.commands.push({ executable: process.execPath, args: [`scripts/${f}`], exitCode: result.status, log: file, sha256: sha(file) });
      assert.ifError(result.error); assert.equal(result.status, 0, file);
      assert(/PASS|: ok|"status":"PASS"/.test(result.stdout), file);
    }
    for (const f of ["scripts/installed-novel-task-floating-playwright.cjs", "scripts/lib/current-installed-novel-session.cjs",
      "scripts/installed-novel-current-terminal-audit.cjs"]) {
      const result = spawnSync(process.execPath, ["--check", f], { cwd: root, windowsHide: true, encoding: "utf8", timeout: 20000 });
      assert.equal(result.status, 0, result.stderr);
    }
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      foreach($qaFile in @('D:\\AgentVN\\scripts\\installed-preview-session.ps1','D:\\AgentVN\\scripts\\installed-assistant-recovery-session.ps1')){
        $qaTokens=$null;$qaErrors=$null;
        [System.Management.Automation.Language.Parser]::ParseFile($qaFile,[ref]$qaTokens,[ref]$qaErrors)|Out-Null;
        if($qaErrors.Count){throw ($qaErrors|Out-String)};Write-Output "PASS Parser $qaFile"
      }
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(result.status, 0, result.stderr); assert(result.stdout.includes("PASS"));
    return { supportTests: tests.length, jsParsers: 3, psParsers: 2, noProductBuild: true };
  });
  assert.equal(report.checks.length, 9); report.status = report.evidenceStatus = "PASS";
})().catch(e => { report.status = report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(dest, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, controlledNovelUIStatus: report.controlledNovelUIStatus,
    realNovelModelStatus: report.realNovelModelStatus, checks: report.checks.length, screenshots: report.screenshots,
    motionFrames: report.motionFrames, error: report.error, dest }));
});
