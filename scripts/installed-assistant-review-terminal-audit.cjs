"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), { sha256 } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-assistant-review-20261018-01", out = process.argv[2];
assert(out && !fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")), sha = f => sha256(fs.readFileSync(f));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", controlledReviewSliceStatus: "RUNNING", g03Status: "FAILED",
  realModelTasksStatus: "NOT_RUN", at: new Date().toISOString(), checks: [], inputs: [], screenshots: 0, realModelRequests: 0, productChanges: 0, error: null };
function load(name) {
  const file = path.join(run, name); report.inputs.push({ path: file, sha256: sha(file) }); return read(file);
}
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
(async () => {
  const prep = load("preparation.json"), fixture = load("fixtures.json");
  const launches = [load("launch.json"), load("launch-02.json")], backends = [load("backend-ready.json"), load("backend-ready-02.json")];
  const author = load("review-06/report.json"), finish = load("review-07/report.json"), player = load("player-01/report.json");
  const restarted = load("review-frontend-restart.json");
  await check("Frozen installed editor/backend/player identities and default isolated profiles, not source backend", () => {
    assert.equal(prep.status, "PASS"); assert.equal(prep.verifiedOriginalFiles, 55); assert.equal(fixture.status, "PASS");
    for (const p of fixture.projects) assert.equal(sha(p.input), p.sha256);
    for (const [i, l] of launches.entries()) {
      assert.equal(l.status, "PASS"); assert.equal(backends[i].status, "PASS");
      assert(!l.dataDirectoryOverride && !l.webviewDirectoryOverride && !l.manualBackendSpawn);
      assert.equal(l.executableSha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
      assert.equal(sha(path.join(l.installRoot, "agentvn-editor.exe")), l.executableSha256);
      assert.equal(sha(path.join(l.installRoot, "creator-backend.exe")), backends[i].backendSha256);
    }
    assert.equal(player.exe.sha256, "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    assert.equal(sha(player.exe.path), player.exe.sha256);
    return { editor: launches[0].executableSha256, backend: backends[0].backendSha256, player: player.exe.sha256,
      cleanMachine: false, actualNsisInstall: true, originalProfilesProtected: true };
  });
  await check("One explicitly consented image alias, six real tool completions and genuine local validate/preview receipts", () => {
    assert.equal(author.cases[0].status, "PASS"); assert.equal(author.modelRequests.length, 6); assert.equal(author.submissions.length, 1);
    assert.equal(author.localReceipts.length, 2); assert(author.localReceipts.every(r => r.payload.result.ok));
    assert.deepEqual(author.localReceipts.map(r => r.payload.result.status), ["validated", "rendered"]);
    assert.deepEqual(author.submissions[0].request.authorized_assets, [{ id: "project-asset-1", filename: "中文 徽章.png", mime_type: "image/png" }]);
    const context = author.modelRequests[1].receipts[0].result;
    assert.deepEqual(context.assets, author.submissions[0].request.authorized_assets);
    assert.deepEqual(context.targets, []); assert(author.modelRequests.every(r => r.privateMaterialAbsent));
    assert.equal(author.tasks[0].status, "completed");
    assert.equal(author.tasks[0].toolEvents.filter(e => e.status === "completed").length, 6);
    assert.equal(author.cases[0].detail.noAutoMerge, true);
    return { submission: author.submissions[0].id, sixRealTools: true, actualLocalReceipts: 2, externalModel: "CONTROLLED_HTTP_NOT_DEEPSEEK" };
  });
  await check("Three reviewed candidates, one excluded, actual preview and twelve nonempty hit/focus/bounds combinations", () => {
    assert.equal(author.cases[1].status, "PASS"); assert.equal(author.matrix.length, 12);
    const keys = new Set(author.matrix.map(v => `${v.width}/${v.height}/${v.dpr}/${v.reduced}`));
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const d of [1, 2]) for (const m of [false, true])
      assert(keys.has(`${w}/${h}/${d}/${m}`));
    assert(author.matrix.every(v => v.status === "PASS" && v.geometry.hit && v.geometry.focus && v.geometry.overflow <= 1));
    assert(author.cases[1].detail.realRuntimePreview); assert.equal(author.cases[1].detail.excluded, 1);
    return { combinations: 12, actualSelectedRuntimePreview: true, fullEditorMotionClaim: false };
  });
  await check("Selected candidates merge atomically, independent layout/graph retained and native saved bytes survive actual restart", () => {
    assert.equal(author.cases[2].status, "PASS"); assert.equal(author.cases[3].status, "PASS");
    assert(author.atomicObservation.includes(2) && !author.atomicObservation.includes(1));
    assert.deepEqual(author.merged.settings.runtimeUILayoutProfiles.profiles.agentvn, author.baseline.settings.runtimeUILayoutProfiles.profiles.agentvn);
    assert.deepEqual(author.merged.nodes, author.baseline.nodes); assert.deepEqual(author.merged.edges, author.baseline.edges);
    assert.deepEqual(author.reopened.settings.runtimeUILayoutProfiles, author.merged.settings.runtimeUILayoutProfiles);
    assert.equal(restarted.status, "PASS"); assert(!restarted.webviewDirectoryOverride && !restarted.dataDirectoryOverride);
    assert(restarted.backendReusedWithoutManualSpawn); assert.notEqual(restarted.editorPid, launches[1].editorPid);
    const a = author.projectArtifact; assert.equal(sha(a.path), a.sha256); assert.equal(sha(a.source), a.sha256);
    assert.deepEqual(finish.merged, author.merged); assert.deepEqual(finish.projectArtifact, a);
    assert.equal(finish.priorEvidence.sha256, sha(finish.priorEvidence.path)); assert(finish.priorEvidence.notRerun);
    return { atomicObservation: author.atomicObservation, nativeSave: a, actualFrontendRestart: restarted.editorPid,
      nativePickerImportClaim: false, fourStagesReferencedNotRerun: finish.priorEvidence.passedStages.length };
  });
  await check("Actual UI cartridge byte tracing, new-session consent reset and real author edit conflict rejected", () => {
    assert.equal(finish.status, "PASS"); assert.equal(finish.cases.length, 2); assert(finish.cases.every(c => c.status === "PASS"));
    assert.equal(finish.modelRequests.length, 6); assert.equal(finish.submissions.length, 1); assert.equal(finish.localReceipts.length, 2);
    assert(finish.localReceipts.every(r => r.payload.result.ok));
    assert(finish.authorConflict.rejected); assert.equal(finish.authorConflict.realAuthorUI, "Add mask + Save layout");
    assert.equal(sha(finish.cartridge.path), finish.cartridge.sha256); assert(finish.cartridge.assets.length >= 2);
    assert(finish.cartridge.assets.every(a => a.sha256 === fixture.image.sha256));
    return { cartridge: finish.cartridge, actualConflict: finish.authorConflict, newConversationAuthorizationReset: true };
  });
  await check("Unmodified UI-exported cartridge consumed by actual installed Player, twelve matrix combinations and24 actions", () => {
    assert.equal(player.status, "PASS"); assert.equal(player.cases.length, 12); assert.equal(player.checks.length, 2);
    assert(player.cases.every(c => c.status === "PASS" && c.actions.length === 2 && c.components.length === 2));
    for (const c of player.cases) for (const component of c.components) {
      assert.equal(component.title, fixture.title); assert.equal(component.images.length, 1);
      assert.equal(component.images[0].sha256, fixture.image.sha256); assert(component.hit && component.overflow <= 1);
    }
    assert.equal(player.cartridge.sha256, finish.cartridge.sha256); assert.equal(player.cleanup.status, "PASS");
    assert.equal(player.consoleErrors.length, 0);
    return { combinations: 12, successfulActions: 24, actualStoryEntry: true,
      playerMode: "PREVIEW_WITH_EXPORTED_VNCART_NOT_GAME_SETUP", windowsGameUpgradeClaim: false, androidClaim: false };
  });
  await check("Raw native captures preserve actual DPR/PNG dimensions and failed attempts remain unmodified", () => {
    const attempts = [load("review-01/report.json"), load("review-03/report.json"), load("review-04/report.json"), load("review-05/report.json"), author];
    assert(attempts.every(a => a.status === "FAILED"));
    const failedFixture = load("fixtures-failed-01.json"); assert.equal(failedFixture.status, "FAILED"); assert(failedFixture.error.includes("pngjs"));
    const abort = load("review-02-tool-abort.json"); assert.equal(abort.status, "FAILED");
    assert.equal(abort.externalRequestCount, "UNKNOWN_AFTER_UNHANDLED_PROCESS_EXIT");
    assert.equal(abort.tasks[0].errorCode, "provider_error");
    assert.equal(attempts[3].localReceipts[1].payload.result.ok, false);
    assert.equal(attempts[3].localReceipts[1].payload.result.preview[0].clipped, true);
    const captures = [...attempts.flatMap(r => r.screenshots), ...finish.screenshots, ...player.screenshots];
    assert(captures.length >= 30);
    for (const c of captures) {
      const png = fs.readFileSync(c.path); assert.equal(sha256(png), c.sha256); assert.deepEqual(c.before, c.after);
      assert.equal(png.readUInt32BE(16), c.before.width * c.before.dpr); assert.equal(png.readUInt32BE(20), c.before.height * c.before.dpr);
      report.screenshots++;
    }
    assert.equal(author.providerCleanup.stopped, true); assert.equal(finish.providerCleanup.stopped, true);
    assert.equal(author.credentialCleanup, "CLEARED_TEST_ONLY_PROVIDER_SECRET"); assert.equal(finish.credentialCleanup, "CLEARED_TEST_ONLY_PROVIDER_SECRET");
    assert(!author.cleanupError && !finish.cleanupError);
    return { screenshots: captures.length, originalFailuresPreserved: true, paidRequests: 0,
      loggedControlledModelRequests: attempts.reduce((n, a) => n + (a.modelRequests?.length || 0), 0) + finish.modelRequests.length,
      extraAbortedAttemptRequestCount: "UNKNOWN; not claimed zero", correctedFixturesAndHarnessesNotProductFixes: true };
  });
  await check("Original four profiles restored with55 SHA, DB/Dev/pending MSI unchanged, all owned processes and ports clear", () => {
    const restored = load("profile-restoration.json"), stopped = load("final-stop.json"), abortStop = load("tool-abort-stop.json");
    assert.equal(restored.status, "PASS"); assert.equal(stopped.status, "PASS"); assert.equal(abortStop.status, "PASS"); assert.equal(stopped.after.length, 0);
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++; }
    }
    assert.equal(count, 55); assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const old = read("D:/AgentVN/output/host-msi-session-20261018-01/incident-audit-01.json");
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), old.userPersistence.databaseSha256);
    assert.equal(sha(path.join(old.actualInstallation.path, "agentvn-editor.exe")), old.actualInstallation.executableSha256);
    const prior = read("D:/AgentVN/output/installed-assistant-session-20261018-01/terminal-audit-01.json"); assert.equal(prior.g03Status, "FAILED");
    const ports = [...new Set([8278, restarted.cdpPort, player.cdpPort, ...launches.flatMap(l => [l.cdpPort, l.playerCdpPort]),
      ...[...attemptsForPorts(), author, finish].map(r => r.modelEndpoint ? Number(new URL(r.modelEndpoint).port) : 0).filter(Boolean)])];
    function attemptsForPorts() { return ["review-02", "review-03", "review-04", "review-05"].map(d => read(path.join(run, d, "report.json"))); }
    const query = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)|AgentVN-QA-InstalledAssistantReview')}|Select-Object Name,ProcessId)
      $s=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$p;ports=$s}|ConvertTo-Json -Depth 6
    `], { windowsHide: true, encoding: "utf8", timeout: 15000 });
    assert.equal(query.status, 0, query.stderr); const state = JSON.parse(query.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { independentOriginalHashes: 55, profiles: 4, originalDbDevAndMsiUnchanged: true, portsChecked: ports,
      ...state, g03FocusStillFailed: true, realDeepSeekStillNotRun: true };
  });
  report.status = "PASS"; report.evidenceStatus = "PASS"; report.controlledReviewSliceStatus = "PASS";
})().catch(e => { report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus, controlledReviewSliceStatus: report.controlledReviewSliceStatus,
    g03Status: report.g03Status, realModelTasksStatus: report.realModelTasksStatus, checks: report.checks.length, screenshots: report.screenshots, error: report.error, out }, null, 2));
});
