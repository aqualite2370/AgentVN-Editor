"use strict";
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-editor-motion-20261018-01", out = process.argv[2];
assert(out && !fs.existsSync(out));
const sha = f => sha256(fs.readFileSync(f)), read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", g12Status: "RUNNING", at: new Date().toISOString(),
  checks: [], inputs: [], traces: 0, frames: 0, screenshots: 0, commands: [], productChanges: 0, realModelRequests: 0, error: null };
function load(name) { const f = path.join(run, name); report.inputs.push({ path: f, sha256: sha(f) }); return read(f); }
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
function auditTrace(row, expected) {
  assert.equal(sha(row.trace.path), row.trace.sha256);
  const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(row.trace.path)).toString("utf8"));
  assert.equal(t.frames.length, row.trace.frames); assert(t.frames.length >= 3 && !t.limitReached);
  assert(t.inputs.some(i => i.trusted)); assert(t.frames.every(f => !f.pageHidden && f.visibilityState === "visible"
    && f.width === expected.width && f.height === expected.height && f.dpr === expected.dpr && f.reduced === expected.reduced));
  assert(row.checks.length >= 2); assert(!row.actionError);
  report.traces++; report.frames += t.frames.length; return t;
}
(async () => {
  const prep = load("preparation.json"), fixture = load("fixtures.json"), launch = load("launch.json"), backend = load("backend-ready.json");
  const main = load("motion-01/report.json"), follow = load("motion-followup-01/report.json");
  await check("Frozen actual installed Editor and automatically launched packaged backend retain identity", () => {
    assert.equal(prep.status, "PASS"); assert.equal(prep.verifiedOriginalFiles, 55); assert.equal(fixture.status, "PASS");
    assert.equal(launch.status, "PASS"); assert.equal(backend.status, "PASS");
    assert(!launch.dataDirectoryOverride && !launch.webviewDirectoryOverride && !launch.manualBackendSpawn);
    assert.equal(launch.executableSha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(launch.installRoot, "agentvn-editor.exe")), launch.executableSha256);
    assert.equal(sha(path.join(launch.installRoot, "creator-backend.exe")), backend.backendSha256);
    assert.equal(sha(path.join(launch.installRoot, "agentvn-player.exe")), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    for (const p of fixture.projects) assert.equal(sha(p.input), p.sha256);
    return { editor: launch.executableSha256, backend: backend.backendSha256, actualNsisInstall: true,
      cleanMachine: false, productLayer: "Editor ONLY", userProjectUsed: false, modelRequests: 0 };
  });
  await check("Complete twelve parameter combinations,192 episodes and original hashed frame traces", () => {
    assert.equal(main.status, "FAILED"); assert.equal(main.matrix.length, 12); assert.equal(main.errors.length, 0); assert.equal(main.modelSubmissions.length, 0);
    const keys = new Set(main.matrix.map(m => `${m.width}/${m.height}/${m.dpr}/${m.reduced}`)); assert.equal(keys.size, 12);
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const d of [1, 2]) for (const r of [false, true])
      assert(keys.has(`${w}/${h}/${d}/${r}`));
    let assertions = 0; const failures = [];
    for (const m of main.matrix) {
      assert.equal(m.episodes.length, 16); assert.equal(m.nodeWidthCheck.status, "PASS"); assert(!m.error);
      for (const e of m.episodes) {
        auditTrace(e, m); assertions += e.checks.length;
        for (const c of e.checks.filter(c => c.status === "FAILED")) failures.push({ matrix: m.key, episode: e.name, check: c.name });
      }
    }
    report.mainFailures = failures; report.mainAssertions = assertions;
    return { combinations: 12, episodes: 192, assertions, rawFailures: failures.length,
      normalAndReducedSeparate: true, measuredViewportSimulationNotPhysical4K: true, samplerNotPerformanceBenchmark: true };
  });
  await check("Actual CSS segment curves independently supplement mistaken effect-level linear oracle without rewriting originals", () => {
    assert.equal(follow.priorEvidence.sha256, sha(follow.priorEvidence.path)); assert(follow.priorEvidence.unchangedFailedReport);
    assert.equal(follow.status, "FAILED"); assert(follow.finishedAt);
    assert.equal(follow.curveMatrix.length, 12); assert.equal(follow.errors.length, 0); assert.equal(follow.modelSubmissions.length, 0);
    assert.equal(new Set(follow.curveMatrix.map(m => `${m.width}/${m.height}/${m.dpr}/${m.reduced}`)).size, 12);
    for (const c of follow.curveMatrix) { assert.equal(c.status, "PASS"); auditTrace(c, c); }
    const oracle = report.mainFailures.filter(f => f.check.startsWith("Existing container curve/duration"));
    assert.equal(oracle.length, 12);
    return { correctedReadoutCombinations: 12, effectEasing: "linear", actualSegmentEasing: "cubic-bezier(0.16, 0.86, 0.18, 1)",
      enterDurationMs: { normal: 1120, reduced: 520 }, originalFailureReportsPreserved: true, productModified: false };
  });
  await check("Panel overlap product failures are retained and independently checked by actual native DOM hit testing", () => {
    assert.equal(follow.interactionMatrix.length, 36);
    for (const name of ["inspector-boundary-assets", "inspector-boundary-library", "background-input-during-exit"])
      assert.equal(new Set(follow.interactionMatrix.filter(m => m.name === name).map(m => `${m.width}/${m.height}/${m.dpr}/${m.reduced}`)).size, 12);
    const failures = [], hits = [];
    for (const row of follow.interactionMatrix) {
      const t = auditTrace(row, row);
      if (row.name.startsWith("inspector-boundary")) {
        for (const f of t.frames.filter(f => f.inspectorOverlapHit?.belongsToPanel)) hits.push({ ...row, checks: undefined, trace: undefined,
          at: f.at, hit: f.inspectorOverlapHit });
        for (const c of row.checks.filter(c => c.status === "FAILED")) failures.push({ width: row.width, dpr: row.dpr, reduced: row.reduced, episode: row.name, check: c.name });
      }
    }
    assert(hits.length > 0); assert(failures.length > 0);
    const product = report.mainFailures.filter(f => !f.check.startsWith("Existing container curve/duration"));
    assert(product.length > 0);
    assert(product.every(f => f.check === "Node controls remain clear/visible, all three tracks remain fixed and panel covers neither rail nor Inspector"));
    assert(failures.every(f => f.check === "Animated panel never actually intercepts Inspector pixels"));
    report.productFailures = product; report.hitProbeFailures = failures;
    report.g12Status = "FAILED";
    return { defect: "G12-01_ANIMATED_PANEL_OVERLAPS_INSPECTOR", mainFailedEpisodes: product.length,
      actualHitFailedEpisodes: failures.length, interceptedFrames: hits.length, examples: hits.slice(0, 3),
      noAutomaticProductFix: true };
  });
  await check("Actual background editing during closing and other independent transition assertions retain their result", () => {
    const closing = follow.interactionMatrix.filter(m => m.name === "background-input-during-exit");
    assert.equal(closing.length, 12); assert(closing.every(c => c.status === "PASS"));
    const unknownFailures = follow.interactionMatrix.flatMap(m => m.checks.filter(c => c.status === "FAILED" && !m.name.startsWith("inspector-boundary")));
    assert.equal(unknownFailures.length, 0);
    for (const m of main.matrix) for (const e of m.episodes.filter(e => !e.name.startsWith("home-to-editor"))) {
      for (const c of e.checks.filter(c => c.name !== "Node controls remain clear/visible, all three tracks remain fixed and panel covers neither rail nor Inspector"))
        assert.equal(c.status, "PASS");
    }
    return { actualSceneAddWhileClosing: 12, keyboardAndFocus: "PASS in these specific workspace transitions; G03 workbench defect not revoked",
      realTabCrossfades: 96, rapidSwitchAndReversal: 24, fullRuntimeOrLoadingFaultsClaim: false };
  });
  await check("Every raw native PNG matches actual viewport/DPR before and after capture", () => {
    for (const s of [...main.screenshots, ...follow.screenshots]) {
      const b = fs.readFileSync(s.path); assert.equal(sha256(b), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr); assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
      report.screenshots++;
    }
    assert(report.screenshots >= 24); return { rawScreenshots: report.screenshots, screenshotOnlyPassClaim: false };
  });
  await check("Original four profiles and55 independent SHA restored; original DB, Dev and pending MSI are unchanged, owned processes/ports absent", () => {
    const stopped = load("final-stop.json"), restored = load("profile-restoration.json");
    assert.equal(stopped.status, "PASS"); assert.equal(restored.status, "PASS"); assert.equal(stopped.after.length, 0);
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++; }
    }
    assert.equal(count, 55); assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const old = read("D:/AgentVN/output/host-msi-session-20261018-01/incident-audit-01.json");
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), old.userPersistence.databaseSha256);
    assert.equal(sha(path.join(old.actualInstallation.path, "agentvn-editor.exe")), old.actualInstallation.executableSha256);
    const ports = [8278, launch.cdpPort, launch.playerCdpPort];
    const q = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)|AgentVN-QA-InstalledEditorMotion')}|Select-Object Name,ProcessId)
      $s=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$p;ports=$s}|ConvertTo-Json -Depth 6
    `], { windowsHide: true, encoding: "utf8", timeout: 15000 });
    assert.equal(q.status, 0, q.stderr); const state = JSON.parse(q.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { independentOriginalHashes: count, profiles: 4, portsChecked: ports, ...state, noDevBuildDuringTest: true };
  });
  await check("Acceptance evidence validators and modified JavaScript tools pass their actual syntax/self tests", () => {
    const commands = [
      ["scripts/full-regression-evidence-test.cjs"],
      ["--check", "scripts/installed-editor-motion-playwright.cjs"],
      ["--check", "scripts/lib/installed-editor-motion-sampler.cjs"],
      ["--check", "scripts/installed-editor-motion-followup.cjs"],
      ["--check", "scripts/installed-editor-motion-terminal-audit.cjs"],
      ["--check", "scripts/installed-assistant-current-fixtures.cjs"],
      ["--check", "scripts/editor-workspace-surface-transition-playwright.cjs"]
    ];
    for (const args of commands) {
      const p = spawnSync(process.execPath, args, { cwd: "D:/AgentVN", encoding: "utf8", timeout: 60000, windowsHide: true });
      report.commands.push({ command: `node ${args.join(" ")}`, exitCode: p.status, stdout: p.stdout, stderr: p.stderr }); assert.equal(p.status, 0, p.stderr);
    }
    return { commands: commands.length, behavioralTestClaimFromSyntax: false };
  });
  report.status = "PASS"; report.evidenceStatus = "PASS";
})().catch(e => { report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus, g12Status: report.g12Status,
    checks: report.checks.length, traces: report.traces, frames: report.frames, screenshots: report.screenshots, error: report.error, out }, null, 2));
});
