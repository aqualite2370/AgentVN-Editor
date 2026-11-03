"use strict";
// Evidence/safety verdict remains separate from G11's already recorded HOST-03 failure.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), { DatabaseSync } = require("node:sqlite");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-preview-20261018-02");
const sha = f => sha256(fs.readFileSync(f)), read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const out = process.argv[2]; assert(out && path.dirname(path.resolve(out)) === path.resolve(run) && !fs.existsSync(out));
const report = { status: "RUNNING", previewFlowLimitedStatus: "RUNNING", g11Status: "FAILED",
  at: new Date().toISOString(), checks: [], inputs: [], commands: [], screenshotCount: 0,
  productChanges: 0, realModelRequests: 0, error: null };
function load(f) { report.inputs.push({ path: f, sha256: sha(f) }); return read(f); }
function check(name, fn) {
  const c = { name, status: "RUNNING" }; report.checks.push(c);
  try { c.detail = fn(); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
}
try {
  const prep = load(path.join(run, "preparation.json")), launch = load(path.join(run, "launch.json"));
  const ready = load(path.join(run, "backend-ready.json")), fixture = load(path.join(run, "fixtures.json"));
  const ui = load(path.join(run, "ui-01/report.json"));
  check("Actual installed frozen PE/backend,560 product sources and controlled fixture match current bytes", () => {
    for (const r of [prep, launch, ready, fixture]) assert.equal(r.status, "PASS");
    assert.equal(launch.manualBackendSpawn, false); assert.equal(launch.dataDirectoryOverride, false); assert.equal(launch.webviewDirectoryOverride, false);
    assert.equal(sha(path.join(launch.installRoot, "agentvn-editor.exe")), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(launch.installRoot, "creator-backend.exe")), ready.backendSha256);
    assert(ready.processes.some(p => p.Name === "creator-backend.exe" && p.ParentProcessId === launch.editorPid));
    assert.equal(sha(fixture.input), fixture.inputSha256); assert.equal(fixture.projectId, "installed-preview-isolated-20261018-02");
    assert.equal(sha(ui.tool.path), ui.tool.sha256); assert.equal(ui.productChanges, 0); assert.equal(ui.realModelRequests, 0);
    const frozen = load(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560); for (const f of frozen.source) assert.equal(sha(f.path), f.sha256);
    return { sources: 560, editorSha256: launch.executableSha256, controlledBackendImportNotNativePicker: true };
  });
  check("Real installed Player unavailable -> visible native launch failure -> exact-byte restoration -> successful real Retry", () => {
    assert.equal(ui.status, "PASS"); assert.equal(ui.checks.length, 2); assert(ui.checks.every(c => c.status === "PASS"));
    assert.equal(ui.error, null); assert.equal(ui.cleanupError, null); assert.deepEqual(ui.pageErrors, []);
    assert.equal(ui.fault.restored, true); assert(!fs.existsSync(ui.fault.held));
    assert.equal(sha(ui.fault.original), ui.fault.originalSha256);
    const failed = ui.checks[1].detail;
    assert(failed.text.includes("GameCLI executable was not found")); assert.deepEqual(failed.players, []);
    const first = ui.matrix[0].checks[1].detail;
    assert.equal(first.retryAfterRealFileRestoration, true); assert.equal(first.originalButtonText, "重试 GameCLI 预览");
    assert(ui.trustedInputs.length > 30 && ui.trustedInputs.every(i => i.trusted));
    assert(ui.trustedInputs.filter(i => i.key === "preview.open").length >= 13);
    return { realFileFaultNotMockedIPC: true, installedPlayerRestoredSha256: sha(ui.fault.original),
      retryUsesSameVisibleControl: true, trustedInputs: ui.trustedInputs.length };
  });
  check("All12 declared WebView combinations have nonempty confirmation/external/node behavior and12 separately owned real players", () => {
    assert.equal(ui.matrix.length, 12); const keys = new Set();
    for (const r of ui.matrix) {
      keys.add(`${r.width}:${r.height}:${r.dpr}:${r.reduced}`); assert.equal(r.status, "PASS");
      assert.equal(r.checks.length, 3); assert(r.checks.every(c => c.status === "PASS"));
      const confirm = r.checks[0].detail, external = r.checks[1].detail, node = r.checks[2].detail;
      assert(confirm.buttons.length >= 2 && confirm.buttons.filter(b => !b.disabled).every(b => b.hit && b.inside));
      assert.equal(confirm.focusUnavailable, false); assert.deepEqual(confirm.overlaps, []); assert(confirm.overflow <= 1);
      assert(external.runtime.text.includes(fixture.project.nodes.find(n => n.data.scene).data.scene.commands[0].text));
      assert.equal(node.separateEmbeddedRuntime, true); assert.equal(node.noExternalPlayer, true);
      assert.equal(node.settingsReturnedToCorrectScene, true); assert.equal(node.geometry.focusUnavailable, false);
      assert(node.geometry.buttons.filter(b => !b.disabled).every(b => b.hit && b.inside));
      assert.deepEqual(node.geometry.overlaps, []); assert(node.geometry.overflow <= 1);
    }
    assert.equal(keys.size, 12);
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const d of [1, 2]) for (const m of [false, true])
      assert(keys.has(`${w}:${h}:${d}:${m}`));
    assert.equal(ui.playerProcesses.length, 12); assert.equal(new Set(ui.playerProcesses.map(p => p.ProcessId)).size, 12);
    for (const p of ui.playerProcesses) {
      assert.equal(p.ParentProcessId, launch.editorPid);
      assert.equal(path.resolve(p.ExecutablePath), path.resolve(launch.installRoot, "agentvn-player.exe"));
      assert.equal(sha(p.ExecutablePath), p.sha256); assert(p.createdUtc && /--mode preview --preview-root/.test(p.CommandLine));
    }
    return { combinations: 12, matrixChecks: 36, actualExternalPlayers: 12, sourceServerOrStandalonePackageClaim: false };
  });
  check("All25 real WebView screenshots match pre/post actual viewport/DPR/media, native PNG pixels and SHA", () => {
    assert.equal(ui.screenshots.length, 25);
    for (const s of ui.screenshots) {
      const bytes = fs.readFileSync(s.path); assert.equal(sha256(bytes), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr); report.screenshotCount++;
    }
    return { screenshots: report.screenshotCount, realWebViewEmulation: true, physical4KClaim: false, fullMotionClaim: false };
  });
  check("Preview did not replace persisted QA graph; prior HOST-03/HOST-02 product failures remain failed", () => {
    const testProfile = prep.profiles.find(p => p.app === "editor" && p.kind === "Roaming").original + ".qa-tested-preview-20261018-02";
    const file = path.join(testProfile, "backend/vn_engine.db"), db = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      const row = db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get(fixture.projectId);
      assert(row); const project = JSON.parse(row.project_json);
      assert.deepEqual(project.edges, fixture.project.edges);
      assert.deepEqual(project.nodes.find(n => n.data.scene).data.scene.commands, fixture.project.nodes.find(n => n.data.scene).data.scene.commands);
    } finally { db.close(); }
    const old = load(path.join(root, "output/installed-preview-20261018-01/terminal-audit-01.json"));
    assert.equal(old.productStatus, "FAILED");
    return { QAgraphVerifiedReadOnly: true, oldReloadAndNaturalCloseFailures: "FAILED_UNCHANGED",
      noMaintenanceReloadRepeatedOrErroneousDraftSaved: true };
  });
  check("Four original profiles55 hashes restored, installedPlayer/DB/Dev/pendingMSI preserved and15 native process/port identities clean", () => {
    const restored = load(path.join(run, "profile-restoration.json")), stopped = load(path.join(run, "preview-continuation-stop.json"));
    assert.equal(restored.status, "PASS"); assert.equal(stopped.status, "PASS"); assert.deepEqual(stopped.after, []);
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++; }
    }
    assert.equal(count, 55); assert.equal(sha(path.join(root, "AgentVN Dev.exe")), prep.originalDevSha256);
    const incident = load(path.join(root, "output/host-msi-session-20261018-01/incident-audit-01.json"));
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(sha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    const ports = [8278, launch.cdpPort, launch.playerCdpPort];
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaLive=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaLive;ports=$qaPorts}|ConvertTo-Json -Depth 5
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); const state = JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
    assert.deepEqual(state.processes, []); assert.deepEqual(state.ports, []);
    return { originalFiles: count, externalPlayers: 12, editorAndBackendProcesses: 3, ports, ...state, naturalCloseClaim: false };
  });
  check("Direct preview source contracts and3 JS/2 PS syntax gates pass separately from installed evidence", () => {
    const args = [["scripts/gamecli-preview-upload-contract-test.cjs"], ["scripts/preview-entry-path-test.cjs"],
      ...["installed-preview-continuation-playwright.cjs", "installed-preview-continuation-terminal-audit.cjs",
        "installed-windows-export-continuation-audit.cjs"].map(n => ["--check", `scripts/${n}`])];
    for (const [i, a] of args.entries()) {
      const p = spawnSync(process.execPath, a, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60000 });
      const log = path.join(run, `${path.basename(out, ".json")}-support-${i + 1}.log`);
      fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
      report.commands.push({ executable: process.execPath, args: a, exitCode: p.status, log, sha256: sha(log) });
      assert.ifError(p.error); assert.equal(p.status, 0, log);
      if (i === 0) assert(p.stdout.includes("GameCLI preview upload contract passed."));
      if (i === 1) assert(p.stdout.includes("preview entry path test OK"));
    }
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      foreach($qaFile in @('D:\\AgentVN\\scripts\\installed-preview-session.ps1','D:\\AgentVN\\scripts\\installed-assistant-recovery-session.ps1')){
        $qaTokens=$null;$qaErrors=$null;
        [System.Management.Automation.Language.Parser]::ParseFile($qaFile,[ref]$qaTokens,[ref]$qaErrors)|Out-Null;
        if($qaErrors.Count){throw ($qaErrors|Out-String)};Write-Output "PASS Parser $qaFile"
      }
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr);
    report.commands.push({ executable: "powershell.exe", purpose: "ParseFile", exitCode: p.status, stdout: p.stdout });
    return { directSourceContracts: 2, JSParsers: 3, PSParsers: 2 };
  });
  assert.equal(report.checks.length, 7); report.status = report.previewFlowLimitedStatus = "PASS";
} catch (e) { report.status = report.previewFlowLimitedStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, previewFlowLimitedStatus: report.previewFlowLimitedStatus,
    g11Status: report.g11Status, checks: report.checks.length, screenshots: report.screenshotCount, error: report.error, out }, null, 2));
}
