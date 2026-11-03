"use strict";
// Independent receipt/filesystem/SQLite/system-state audit. Does not repeat UI
// flows or upgrade installers, and does not turn known product failures green.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const run = "D:/AgentVN/output/host-msi-next-20261018-01";
const backupRoot = "F:/AgentVN-QA-HostMSINext-Backup-20261018-01";
const destination = process.argv[2];
assert(destination && !fs.existsSync(destination), "Fresh independent audit required");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const result = { status: "BLOCKED", evidenceStatus: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ORDINARY_AND_CROSS_GENERATION_MSI_EVIDENCE_AND_EXACT_RESTORATION_NOT_FULL_REGRESSION",
  checks: [], sources: [], screenshots: [], originalFailures: [], artifacts: [], error: null,
  productChanges: 0, devRebuilt: false, realModelRequests: 0, androidOperations: 0 };
function source(relative) {
  const file = path.join(run, relative);
  result.sources.push({ path: file, sha256: sha(file), bytes: fs.statSync(file).size });
  return read(file);
}
function check(name, callback) { const detail = callback(); result.checks.push({ name, status: "PASS", detail }); }
const archiveReceipt = path.join(run, "downloads-archive.json");
const cleanup = fs.existsSync(archiveReceipt) ? read(archiveReceipt) : null;
function artifact(file, expected) {
  let actual = file;
  if (!fs.existsSync(actual)) {
    assert.equal(cleanup?.status, "PASS", "Missing artifact without a successful relocation receipt");
    const row = cleanup.rows.find(item => path.resolve(item.source) === path.resolve(file) && item.sha256 === expected);
    assert(row?.copyVerified && row.sourceRemoved); actual = row.retained;
  }
  assert.equal(sha(actual), expected, actual);
  result.artifacts.push({ original: file, actual, sha256: expected });
  return actual;
}
function captures(row, finalPresentation) {
  if (finalPresentation) {
    assert(row.presentationReady.entryOverlayAbsent && row.presentationReady.containerIdle);
    assert(row.presentationReady.visibleControls > 0);
  }
  for (const capture of row.screenshots) {
    assert.equal(sha(capture.path), capture.sha256);
    assert.deepEqual(capture.before, capture.after);
    const bytes = fs.readFileSync(capture.path);
    assert.equal(bytes.readUInt32BE(16), capture.before.width * capture.before.dpr);
    assert.equal(bytes.readUInt32BE(20), capture.before.height * capture.before.dpr);
    result.screenshots.push({ path: capture.path, sha256: capture.sha256, actual: capture.before,
      finalEditorPresentationGuarded: !!finalPresentation });
  }
}
function database(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    return db.prepare("SELECT project_id,project_json FROM editor_project_details").all()
      .map(row => ({ id: row.project_id, project: JSON.parse(row.project_json) }));
  } finally { db.close(); }
}
try {
  check("Ten real ordinary/cross-generation MSI operations, elevation and immutable source packages", () => {
    let operations = 0;
    for (const language of ["en-US", "zh-CN"]) {
      for (const [scenario, stems] of [
        ["clean", [language === "en-US" ? "Install-1.9.9-attempt03" : "Install-1.9.9", "Uninstall-1.9.9"]],
        ["cross-generation", ["Install-1.7.1", "Install-1.9.9", "Uninstall-1.9.9"]]
      ]) {
        for (const stem of stems) {
          const item = source(`${scenario}/${language}/${stem}.json`);
          const parent = source(`${scenario}/${language}/${stem}-elevation.json`);
          assert.equal(item.exitCode, 0); assert.equal(item.isElevated, true);
          assert.equal(parent.parentElevated, false);
          assert.equal(sha(item.package), item.packageSha256);
          assert.equal(item.arguments[0], stem.startsWith("Uninstall") ? "/x" : "/i");
          assert(fs.statSync(path.join(run, scenario, language, stem + ".log")).size > 0);
          if (scenario === "clean" && language === "en-US" && stem.startsWith("Install")) {
            assert.equal(item.status, "FAILED"); assert.equal(parent.status, "BLOCKED");
            assert.equal(item.error, "Actual MSI identity/path mismatch");
            result.originalFailures.push({ type: "INSTALL_DESTINATION_MISMATCH", receipt: stem,
              status: "FAILED", productCauseNotEstablished: true });
          } else { assert.equal(item.status, "PASS"); assert.equal(parent.status, "PASS"); }
          operations++;
        }
      }
    }
    assert.equal(operations, 10); return { operations, administrativeExtractionCount: 0 };
  });
  check("Ordinary MSI creation/export/new-process recovery and retained normal-close defects", () => {
    for (const language of ["en-US", "zh-CN"]) {
      const created = source(`clean/${language}/created-ui-data.json`);
      const restarted = source(`clean/${language}/restart-ui-02/report.json`);
      assert.equal(created.status, "PASS"); assert.equal(restarted.status, "PASS");
      assert(created.checks.length >= 3 && restarted.checks.length >= 4);
      artifact(created.package.path, created.package.sha256); captures(created, false); captures(restarted, false);
      for (const phase of ["new", "restart"]) {
        const closed = source(`clean/${language}/${phase}-close-audit.json`);
        assert.equal(closed.status, "FAILED"); assert.equal(closed.cleanup, "PASS");
        assert.equal(closed.defect, "BACKEND_CHILD_SURVIVES_NORMAL_WINDOW_CLOSE");
        result.originalFailures.push({ type: closed.defect, language, phase, status: "FAILED" });
      }
    }
    return "Old loading-stage PNGs retained as such, not promoted to final visual evidence";
  });
  check("Both actual 1.7.1 -> 1.9.9 UI preservation, new save ZIP bytes and different-process recovery", () => {
    for (const language of ["en-US", "zh-CN"]) {
      const base = `cross-generation/${language}/${language === "en-US" ? "chain02/" : ""}`;
      const old = source(base + "old-ui-data-created.json");
      const first = source(base + "new-ui-01/report.json"), again = source(base + "restart-ui-01/report.json");
      for (const row of [old, first, again]) assert.equal(row.status, "PASS");
      for (const row of [first, again]) {
        assert.equal(row.checks.length, 6); assert(row.checks.every(item => item.status === "PASS"));
        assert.equal(row.resumedProject.metadata.projectId, old.project.metadata.projectId);
        captures(row, language === "zh-CN");
      }
      const exported = source(base + "new-project-export.json");
      assert.equal(exported.status, "PASS"); assert.equal(exported.checks.length, 5);
      assert(exported.checks.every(item => item.status === "PASS"));
      artifact(exported.package.path, exported.package.sha256); artifact(old.package.path, old.package.sha256);
      const firstCapture = source(base + "new-capture-audit.json"), nextCapture = source(base + "restart-capture-audit.json");
      assert.equal(firstCapture.status, "PASS"); assert.equal(nextCapture.status, "PASS");
      assert.notEqual(firstCapture.processes.find(p => p.Name === "agentvn-editor.exe").ProcessId,
        nextCapture.processes.find(p => p.Name === "agentvn-editor.exe").ProcessId);
      for (const phase of ["new", "restart"]) assert.equal(source(base + phase + "-owned-termination.json").status, "PASS");
    }
    return "Controlled owned termination for restart, not normal/physical close PASS";
  });
  check("Archived real legacy/shared SQLite, explicit native consent and new edit remain provable after restoration", () => {
    for (const language of ["en-US", "zh-CN"]) {
      const base = `cross-generation/${language}/`, nested = language === "en-US" ? "chain02/" : "";
      const migration = source(base + `cross-migration-audit-${language === "en-US" ? "01" : "02"}.json`);
      assert.equal(migration.status, "PASS"); assert.equal(migration.checks.length, 5);
      const old = source(base + nested + "old-ui-data-created.json");
      const before = source(base + "before-uninstall-snapshot.json"), after = source(base + "after-uninstall-verify.json");
      assert.equal(before.status, "PASS"); assert.equal(after.status, "PASS");
      assert.equal(after.files.length, language === "en-US" ? 31 : 26); assert(after.files.every(f => f.match));
      for (const file of before.files) assert.equal(sha(file.backup), file.sha256);
      const retained = source(base + "qa-legacy-retained.json");
      assert.equal(retained.status, "PASS");
      for (const file of retained.files) assert.equal(sha(file.retained), file.sha256);
      const legacy = retained.files.find(f => /[\\/]backend[\\/]vn_engine\.db$/.test(f.source));
      const shared = before.files.find(f => /[\\/]Roaming[\\/]com\.agentvn\.editor[\\/]backend[\\/]vn_engine\.db$/.test(f.source));
      const decision = before.files.find(f => /[\\/]database-migration-decision\.json$/.test(f.source));
      assert(legacy && shared && decision);
      const native = read(decision.backup);
      assert.equal(native.approved, true); assert.deepEqual(native, migration.nativeConsent.path ?
        Object.fromEntries(Object.entries(migration.nativeConsent).filter(([key]) => key !== "path")) : migration.nativeConsent);
      assert.deepEqual(native.sources, [legacy.source]);
      const a = database(legacy.retained), b = database(shared.backup);
      assert.equal(a.length, 1); assert.equal(b.length, 1);
      assert.equal(a[0].id, old.project.metadata.projectId); assert.equal(a[0].id, b[0].id);
      assert.deepEqual(a[0].project.nodes.map(n => n.id).sort(), b[0].project.nodes.map(n => n.id).sort());
      assert.deepEqual(a[0].project.edges, b[0].project.edges);
      assert.equal(b[0].project.nodes.find(n => n.id === "node_scene_opening").data.scene.summary,
        "覆盖升级后实际编辑保存_1.9.9_20261018");
    }
    return "Archived QA database bytes, not restored user's current database, used for independent SQL inspection";
  });
  check("Both languages retain actual 28-file/19-script resource audits and upgrade byte preservation", () => {
    for (const scenario of ["clean", "cross-generation"]) for (const language of ["en-US", "zh-CN"]) {
      const resources = source(`${scenario}/${language}/installed-resources.json`);
      assert.equal(resources.status, "PASS"); assert.equal(resources.files.length, 28); assert.equal(resources.scriptCount, 19);
      if (scenario === "cross-generation") {
        const preserved = source(`${scenario}/${language}/before-upgrade-verify.json`);
        assert.equal(preserved.status, "PASS"); assert.equal(preserved.files.length, language === "en-US" ? 19 : 16);
        assert(preserved.files.every(f => f.match));
      }
    }
    return "Historical installed resource audits; test MSI is now uninstalled, not pretending its files are still present";
  });
  const backup = read(path.join(backupRoot, "backup.json"));
  check("All 12,848 original F-installation files restored exactly and failed first restoration preserved", () => {
    assert.equal(backup.status, "PASS"); assert.equal(backup.fileCount, 12848);
    for (const file of backup.files) {
      assert.equal(sha(path.join(backupRoot, "installation", file.relative)), file.sha256);
      assert.equal(sha(path.join(backup.source, file.relative)), file.sha256);
    }
    const failed = source("installation-restoration.json"), restored = source("installation-restoration-attempt02.json");
    assert.equal(failed.status, "FAILED"); assert.match(failed.error, /SetValue/);
    assert.equal(restored.status, "PASS"); assert.equal(restored.restoredFileCount, 12848);
    assert.deepEqual(restored.registryAfter, backup.registry);
    for (const link of backup.shortcuts) {
      assert.equal(sha(link.backup), link.sha256); assert.equal(sha(link.path), link.sha256);
    }
    return { originalBytes: backup.totalBytes, registryWritableHandleFix: "QA tool only" };
  });
  check("Four original profiles/55 files and historical D data restored independently of QA copies", () => {
    const prep = source("preparation.json"), restored = source("profile-restoration.json");
    assert.equal(restored.status, "PASS"); let count = 0;
    for (const profile of prep.profiles) {
      assert(fs.existsSync(profile.original) && !fs.existsSync(profile.held));
      for (const file of profile.files) {
        assert.equal(sha(path.join(profile.original, file.relative)), file.sha256);
        assert.equal(sha(file.backup), file.sha256); count++;
      }
    }
    assert.equal(count, 55);
    const legacy = source("RestoreLegacy.json"); assert.equal(legacy.status, "PASS");
    for (const file of legacy.files) assert.equal(sha(path.join(legacy.to, file.relative.substring(5))), file.sha256);
    assert(!fs.existsSync("D:/agentvntest/AgentVN Editor/agentvn-editor.exe"));
    return { originalProfileFiles: count, oldDProgramUninstalled: true, originalDBackupRetained: true };
  });
  check("560 frozen product sources and root Dev unchanged; no product rebuild", () => {
    const frozen = read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
    assert.equal(frozen.source.length, 560);
    for (const file of frozen.source) assert.equal(sha(file.path), file.sha256, file.path);
    assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"),
      "ceb15d74880bbdee426c0a597734324878dec406583318992193c1cde432be96");
  });
  check("No AgentVN process/MSI/listener remains and live registry equals original backup", () => {
    const ports = new Set([8278]);
    function scan(folder) {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) scan(file);
        else if (/^(old|new|restart)-launch\.json$/.test(entry.name)) {
          const row = read(file); if (row.cdpPort) ports.add(row.cdpPort);
        }
      }
    }
    scan(run);
    const command = `
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {
        $_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')
      }|Select-Object Name,ProcessId,ExecutablePath)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${[...ports].join(",")})}|
        Select-Object LocalPort,OwningProcess)
      $qaMsi=@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue|
        Where-Object {$_.DisplayName -match 'AgentVN' -and $_.WindowsInstaller -eq 1})
      $qaKeys=@('HKCU:\\Software\\agentvn\\AgentVN Editor',
        'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor')
      $qaRegistry=@(foreach($qaPath in $qaKeys) {
        $qaKey=Get-Item -LiteralPath $qaPath
        @{path=$qaPath;exists=$true;values=@($qaKey.GetValueNames()|ForEach-Object {
          @{name=$_;kind=[string]$qaKey.GetValueKind($_);value=$qaKey.GetValue($_)}
        })}
      })
      @{processes=$qaProcesses;ports=$qaPorts;msiCount=$qaMsi.Count;registry=$qaRegistry}|ConvertTo-Json -Depth 8
    `;
    const state = spawnSync("powershell.exe", ["-NoProfile", "-Command", command],
      { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(state.status, 0, state.stderr);
    const actual = JSON.parse(state.stdout.replace(/^\uFEFF/, ""));
    assert.equal(actual.processes.length, 0); assert.equal(actual.ports.length, 0); assert.equal(actual.msiCount, 0);
    for (const key of backup.registry) {
      const live = actual.registry.find(k => k.path === key.path);
      assert(live);
      assert.deepEqual(live.values.sort((a, b) => a.name.localeCompare(b.name)),
        [...key.values].sort((a, b) => a.name.localeCompare(b.name)));
    }
    result.systemState = actual; return { checkedPorts: [...ports] };
  });
  if (cleanup) check("Exact generated Downloads copies removed only after verified F archiving", () => {
    assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.rows.length, 4);
    for (const row of cleanup.rows) {
      assert(row.copyVerified && row.sourceRemoved); assert(!fs.existsSync(row.source));
      assert.equal(sha(row.retained), row.sha256);
      assert.equal(sha(row.generatedReceipt), row.generatedReceiptSha256);
    }
    return { files: 4, recoverable: true };
  });
  result.evidenceStatus = "PASS"; result.overallFullRegressionStatus = "NOT_COMPLETE";
  result.limitations = [
    "Known normal-close failures and actual installation target mismatch remain; not silently repaired",
    "English historical loading-stage screenshots are not final presentation evidence",
    "Chinese final screenshots use recorded 2560x1369/DPR1 only, not the 12-combination display matrix",
    "Controlled exact process termination, not physical Alt+F4",
    "Host testing is not clean/no-development-workspace Windows acceptance",
    "Model, independent game setup/APK upgrades, Android and final user project remain open"
  ];
} catch (error) {
  result.status = "FAILED"; result.evidenceStatus = "FAILED"; result.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, evidenceStatus: result.evidenceStatus,
    checks: result.checks, screenshots: result.screenshots.length, error: result.error }, null, 2));
}
