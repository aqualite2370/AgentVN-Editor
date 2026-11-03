"use strict";
// Independent evidence/safety audit. No product repair, model call or UI consent injection.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-database-migration-20261018-01");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => sha256(fs.readFileSync(p));
const destination = process.argv[2];
assert(destination && path.dirname(path.resolve(destination)) === path.resolve(run) && !fs.existsSync(destination));
const result = { status: "RUNNING", g09Status: "RUNNING", at: new Date().toISOString(),
  checks: [], inputs: [], commands: [], screenshotCount: 0, productChanges: 0, realModelRequests: 0, error: null };
function load(p) { result.inputs.push({ path: p, sha256: sha(p) }); return read(p); }
function check(name, fn) {
  const item = { name, status: "RUNNING" }; result.checks.push(item);
  try { item.detail = fn(); item.status = "PASS"; }
  catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
}
function sqlite(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    return db.prepare("SELECT project_id,project_json FROM editor_project_details ORDER BY project_id").all()
      .map(r => ({ id: r.project_id, project: JSON.parse(r.project_json) }));
  } finally { db.close(); }
}
try {
  const prep = load(path.join(run, "preparation.json")), fixture = load(path.join(run, "fixtures.json"));
  const retained = load(path.join(run, "retain-legacy-preparation.json"));
  const cases = ["cancel", "cancel-restart", "accept", "accept-restart", "conflict"];
  const reports = cases.map(n => load(path.join(run, n === "cancel" ? "cancel-ui-02/report.json" : `${n}-ui/report.json`)));
  check("Frozen actual NSIS Editor,560 product sources, real1.9.8 old DB and independent fixture identity match", () => {
    assert.equal(prep.status, "PASS"); assert.equal(fixture.status, "PASS");
    const frozen = load(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560);
    for (const f of frozen.source) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(fixture.source.sha256, "1fc4acb108144f8b5168041d33aa660e3ad8772e8aa2efc50860cc3a4f747545");
    assert.equal(sha(fixture.source.path), fixture.source.sha256);
    assert.equal(sha(fixture.input), fixture.inputSha256);
    assert.notDeepEqual(fixture.seed.project.nodes, fixture.source.project.nodes);
    assert.equal(fixture.seed.project.project_id, fixture.source.project.project_id);
    return { productSources: 560, actualInstalledEditorVersion: "1.9.9", oldDatabaseVersion: "1.9.8",
      legacyInputWasCopiedToCurrentExePath: true, notOriginalOldInstallationPathProof: true };
  });
  check("Real native No/Yes decisions, all5 automatically spawned installed backends and13 nonempty UI checks", () => {
    const no = load(path.join(run, "native-cancel-observation.json"));
    const yes = load(path.join(run, "native-accept-observations.json"));
    assert.equal(no.case, "cancel"); assert.equal(yes.actions.length, 2);
    assert.equal(yes.consentFileInjected, false); assert.equal(yes.legacyPathEnvironmentOverride, false);
    let checks = 0;
    for (const [i, r] of reports.entries()) {
      assert.equal(r.which, cases[i]); assert.equal(r.status, "PASS"); assert.equal(r.error, null);
      assert.equal(r.productChanges, 0); assert.equal(r.realModelRequests, 0); assert.deepEqual(r.pageErrors, []);
      assert.equal(r.checks.length, i < 2 ? 2 : 3);
      assert(r.checks.every(c => c.status === "PASS")); checks += r.checks.length;
      assert.equal(r.launch.dataDirectoryOverride, false); assert.equal(r.launch.webviewDirectoryOverride, false);
      assert.equal(r.launch.manualBackendSpawn, false); assert.equal(r.launch.consentInjected, false);
      const backend = load(path.join(run, `${r.which}-backend.json`));
      assert.equal(backend.status, "PASS"); assert(backend.processes.length >= 2);
      assert(backend.processes.every(p => path.resolve(path.dirname(p.path)) === path.resolve(prep.installRoot)));
      const observed = r.checks[0].detail;
      assert.equal(observed.decision.approved, i >= 2); assert.equal(observed.legacySha256, fixture.source.sha256);
      assert.equal(path.resolve(observed.decision.sources[0]), path.resolve(fixture.legacy));
      assert.equal(path.resolve(observed.database.path), path.resolve(fixture.defaultRoaming, "backend/vn_engine.db"));
    }
    assert.equal(checks, 13); assert.equal(new Set(reports.map(r => r.launch.editorPid)).size, 5);
    return { cases, UIchecks: checks, nativeActions: 3, nativeModalPNGsRetained: false,
      confirmationEvidence: "Computer Use transcript + action observations + product-generated decisions" };
  });
  check("Reject stays empty across restart; consent restores old graph; restart receipt and backup are idempotent", () => {
    for (const r of reports.slice(0, 2)) {
      assert.deepEqual(r.checks[0].detail.database.details, []);
      assert.deepEqual(r.checks[0].detail.backups, []);
      assert.equal(r.checks[1].detail.oldProjectImported, false);
    }
    for (const r of reports.slice(2, 4)) {
      const project = r.checks[2].detail.database.details[0].project;
      assert.deepEqual(project.nodes, fixture.source.project.nodes); assert.deepEqual(project.edges, fixture.source.project.edges);
      assert.equal(r.checks[2].detail.receipt.status, "MERGED"); assert.deepEqual(r.checks[2].detail.receipt.conflicts, []);
    }
    assert.equal(reports[2].checks[2].detail.recordSha256, reports[3].checks[2].detail.recordSha256);
    assert.deepEqual(reports[2].checks[2].detail.backups, reports[3].checks[2].detail.backups);
    const cancelled = path.join(fixture.defaultRoaming + ".qa-case-database-migration-cancelled", "backend");
    assert.deepEqual(sqlite(path.join(cancelled, "vn_engine.db")), []);
    assert.equal(read(path.join(cancelled, "database-migration-decision.json")).approved, false);
    assert(!fs.existsSync(path.join(cancelled, "database-migration-record.json")));
    const accepted = path.join(fixture.defaultRoaming + ".qa-case-database-migration-accepted", "backend");
    assert.deepEqual(sqlite(path.join(accepted, "vn_engine.db"))[0].project.nodes, fixture.source.project.nodes);
    assert.equal(sha(path.join(accepted, "database-migration-record.json")), reports[3].checks[2].detail.recordSha256);
    return { rejectedRestarts: 1, acceptedRestarts: 1, consentNotInjected: true, receiptAndBackupNotDuplicated: true };
  });
  check("Conflict preserves newer shared graph and both old/shared backup bytes; test legacy path removed recoverably", () => {
    const r = reports[4], detail = r.checks[2].detail;
    assert.deepEqual(detail.database.details[0].project.nodes, fixture.seed.project.nodes);
    assert.deepEqual(detail.database.details[0].project.edges, fixture.seed.project.edges);
    assert.deepEqual(detail.receipt.conflicts, [fixture.projectId]);
    assert.equal(retained.status, "PASS"); assert(!fs.existsSync(fixture.legacyRoot));
    assert.equal(sha(path.join(retained.retainedRoot, "backend/vn_engine.db")), fixture.source.sha256);
    for (const row of detail.backups) {
      let file;
      if (path.resolve(row.path).startsWith(path.resolve(fixture.legacyRoot) + path.sep))
        file = path.join(retained.retainedRoot, path.relative(fixture.legacyRoot, row.path));
      else {
        assert.equal(path.resolve(path.dirname(row.path)), path.resolve(fixture.defaultRoaming, "backend"));
        file = path.join(fixture.defaultRoaming + ".qa-tested-database-migration-20261018-01", "backend", path.basename(row.path));
      }
      assert.equal(sha(file), row.sha256);
    }
    const final = path.join(fixture.defaultRoaming + ".qa-tested-database-migration-20261018-01", "backend");
    assert.deepEqual(sqlite(path.join(final, "vn_engine.db"))[0].project.nodes, fixture.seed.project.nodes);
    return { conflictProjectId: fixture.projectId, backups: detail.backups.length, retainedLegacyRoot: retained.retainedRoot,
      receiptPathAliasNote: "Product receipt may report MSIX redirected AppData path; actual default-access bytes independently verified" };
  });
  check("Original zero-case selector failure preserved;5 actual WebView PNGs match viewport/DPR and SHA", () => {
    const failed = load(path.join(run, "cancel-ui/report.json"));
    assert.equal(failed.status, "FAILED"); assert.equal(failed.checks.length, 0);
    assert(failed.error.includes("strict mode violation"));
    for (const r of reports) for (const s of r.screenshots) {
      const bytes = fs.readFileSync(s.path); assert.equal(sha256(bytes), s.sha256); assert.deepEqual(s.before, s.after);
      assert.deepEqual(s.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr); result.screenshotCount++;
    }
    assert.equal(result.screenshotCount, 5);
    return { retainedToolFailure: true, selectorCorrection: "Choose unique primary homepage create action, not both same-name buttons",
      screenshots: 5, fullUIMatrixOrPhysical4KClaim: false };
  });
  check("Four original profiles55 hashes, original DB/Dev/pendingMSI bytes restored;6 ports and associated processes empty", () => {
    const restored = load(path.join(run, "profile-restoration.json")); assert.equal(restored.status, "PASS");
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) {
        assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++;
      }
    }
    assert.equal(count, 55); assert.equal(sha(path.join(root, "AgentVN Dev.exe")), prep.originalDevSha256);
    const incident = load(path.join(root, "output/host-msi-session-20261018-01/incident-audit-01.json"));
    assert.equal(sha(path.join(fixture.defaultRoaming, "backend/vn_engine.db")), incident.userPersistence.databaseSha256);
    assert.equal(sha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    const ports = [8278, ...reports.map(r => r.launch.cdpPort)];
    for (const r of reports) {
      const stop = load(path.join(run, `${r.which}-stop.json`));
      assert.equal(stop.status, "PASS"); assert.equal(stop.method, "ATTRIBUTED_TERMINATION_NOT_NORMAL_WINDOW_CLOSE");
      assert.deepEqual(stop.remainingProcesses, []); assert.deepEqual(stop.remainingPorts, []);
    }
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaProcesses;ports=$qaPorts}|ConvertTo-Json -Depth 5
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); const observed = JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
    assert.deepEqual(observed.processes, []); assert.deepEqual(observed.ports, []);
    return { originalFiles: count, ports, ...observed, normalWindowCloseClaim: false };
  });
  check("Supporting migration contract and3 JavaScript/2 PowerShell parsers pass, not substituting installed evidence", () => {
    const args = [["scripts/database-migration-contract.cjs"],
      ...["installed-database-migration-fixtures.cjs", "installed-database-migration-playwright.cjs",
        "installed-database-migration-terminal-audit.cjs"].map(n => ["--check", `scripts/${n}`])];
    for (const [i, a] of args.entries()) {
      const p = spawnSync(process.execPath, a, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000 });
      const log = path.join(run, `${path.basename(destination, ".json")}-support-${i + 1}.log`);
      fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
      result.commands.push({ executable: process.execPath, args: a, exitCode: p.status, log, sha256: sha(log) });
      assert.ifError(p.error); assert.equal(p.status, 0, log); if (i === 0) assert(p.stdout.includes("PASS"));
    }
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      foreach($qaFile in @('D:\\AgentVN\\scripts\\installed-preview-session.ps1','D:\\AgentVN\\scripts\\installed-database-migration-session.ps1')){
        $qaTokens=$null;$qaErrors=$null;
        [System.Management.Automation.Language.Parser]::ParseFile($qaFile,[ref]$qaTokens,[ref]$qaErrors)|Out-Null;
        if($qaErrors.Count){throw ($qaErrors|Out-String)};Write-Output "PASS Parser $qaFile"
      }
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr);
    result.commands.push({ executable: "powershell.exe", purpose: "ParseFile", exitCode: p.status, stdout: p.stdout });
    return { supportingSourceTests: 1, JSParsers: 3, PSParsers: 2 };
  });
  assert.equal(result.checks.length, 7); assert(result.checks.every(c => c.status === "PASS"));
  result.status = result.g09Status = "PASS";
  result.remaining = { actualOldMSIUpgrade: "BLOCKED_PENDING_USER_DECISION", independentWindowsExport: "BLOCKED",
    realModels: "NOT_RUN", android: "NOT_RUN", originalProductFailures: "FAILED_UNCHANGED", finalProject: "NOT_RUN" };
} catch (e) {
  result.status = result.g09Status = "FAILED"; result.error = String(e.stack || e); process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, g09Status: result.g09Status, checks: result.checks.length,
    screenshots: result.screenshotCount, error: result.error, destination }, null, 2));
}
