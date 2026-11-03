"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Candidate-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `audit-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: hash(file), bytes: fs.statSync(file).size });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
  scope: "ACTUAL_HOST_NSIS_INSTALLED_WORKSPACE_DEFAULT_PATHS_NOT_UPGRADE_OR_FULL_FEATURE_ACCEPTANCE",
  modelTasksStarted: 0, normalNativeClose: "NOT_RUN", nativePickers: "NOT_RUN", physical4K: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function check(label, run) {
  const row = { label, status: "RUNNING" }; report.groups.push(row);
  try { row.result = run(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { save(); }
}
try {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const installed = read(path.join(qa, "installation.json")), ui = read(path.join(qa, "ui-01/report.json"));
  const restored = read(path.join(qa, "profile-restoration.json"));
  const migrated = read(path.join(qa, "profile-evidence-migration-02.json"));
  check("Actual NSIS installation, generated shortcuts and frozen artifacts", () => {
    assert.equal(installed.status, "PASS"); assert.equal(installed.exitCode, 0);
    assert.equal(installed.metadataRestoration, "PASS"); assert.equal(installed.cleanupError, null);
    assert.equal(hash(installed.executable.path), installed.executable.sha256);
    assert.equal(installed.generatedShortcuts.length, 2);
    for (const f of [...installed.frozen, ...installed.generatedShortcuts.map(s => ({ path: s.copy, sha256: s.sha256 }))])
      assert.equal(hash(f.path), f.sha256, f.path);
    assert.equal(hash(installed.originalDatabase.path), installed.originalDatabase.sha256);
    return { installation: desc(path.join(qa, "installation.json")), shortcuts: installed.generatedShortcuts,
      frozen: installed.frozen.length, defaultDatabaseUnchanged: true };
  });
  check("Independently read original registry types/values and shortcut bytes now", () => {
    const script = `$ErrorActionPreference='Stop';$all=@();
foreach($relative in @('Software\\agentvn\\AgentVN Editor','Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor')){
  $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($relative);
  if(!$key){throw 'Original key missing'}
  try{
    $values=@(foreach($name in $key.GetValueNames()){
      @{name=$name;kind=$key.GetValueKind($name).ToString();
      value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
    });
    $all+=@{path=$relative;values=$values}
  }finally{$key.Dispose()}
}
ConvertTo-Json -Depth 8 -Compress -InputObject $all`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0);
    const actual = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
    assert.equal(actual.length, 2);
    for (const expected of installed.registry) {
      const row = actual.find(r => r.path === expected.path); assert(row);
      const sort = a => [...a].sort((a, b) => a.name.localeCompare(b.name));
      assert.deepEqual(sort(row.values), sort(expected.values));
    }
    for (const s of installed.shortcuts) {
      assert.equal(fs.existsSync(s.path), s.existed);
      if (s.existed) assert.equal(hash(s.path), s.sha256);
    }
    return { keys: 2, shortcuts: installed.shortcuts.length, typesAndBytesPreserved: true };
  });
  check("12 real display combinations and 96 actual tool navigation paths", () => {
    assert.equal(ui.status, "PASS"); assert.equal(ui.cases.length, 12);
    assert.equal(new Set(ui.cases.map(c => `${c.width}/${c.dpr}/${c.reduced}`)).size, 12);
    assert.deepEqual([...new Set(ui.cases.map(c => c.width))].sort(), [1920, 2560, 3840]);
    const files = [];
    for (const c of ui.cases) {
      assert.equal(c.status, "PASS"); assert.equal(c.tabs.length, 8);
      for (const tab of c.tabs) {
        assert(tab.geometry.visible && tab.geometry.hit);
        const w = tab.workspace;
        assert(w.paletteVisible && w.inspectorVisible && !w.paletteClipped && !w.paletteCoveredByPanel
          && !w.inspectorCoveredByPanel && !w.horizontalOverflow);
      }
      for (const s of [c.screenshot, c.optionsScreenshot]) {
        assert.equal(hash(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        assert.deepEqual(s.before, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
        const bytes = fs.readFileSync(s.path);
        assert.equal(bytes.readUInt32BE(16), c.width * c.dpr); assert.equal(bytes.readUInt32BE(20), c.height * c.dpr);
        files.push(desc(s.path));
      }
    }
    assert.equal(ui.modelRequests, 0); assert.deepEqual(ui.errors, []);
    return { cases: 12, toolClicks: 96, png: files, note: "WebView emulation, not physical high-DPI monitor or full frame-motion audit" };
  });
  check("Host-owned packaged backend and physical default paths on both launches", () => {
    assert.equal(ui.dataDirectoryOverride, false); assert.equal(ui.webviewDirectoryOverride, false);
    assert.equal(ui.manualBackendSpawn, false); assert.equal(ui.sourceServer, false);
    assert.equal(ui.launches.length, 2);
    for (const l of ui.launches) {
      assert(l.tree.some(p => p.ProcessId === l.pid && path.resolve(p.ExecutablePath) === path.resolve(installed.executable.path)));
      assert(l.tree.some(p => p.Name === "creator-backend.exe" && path.resolve(p.ExecutablePath)
        === path.resolve(installed.installRoot, "creator-backend.exe")));
      assert.equal(l.owners.length, 2);
      assert(l.owners.every(o => l.tree.some(p => p.ProcessId === o.OwningProcess)));
      assert(l.defaultProfileCommandLines.some(p => /C:\\Users\\1\\AppData\\Local\\com\.agentvn\.editor\\EBWebView/i.test(p.CommandLine || "")));
      assert(l.capabilities.includes("backend-base-url=http://127.0.0.1:8278"));
    }
    return { launches: ui.launches, noDevelopmentServerUsed: true, cleanMachine: false };
  });
  check("Real SQLite bytes after force-stop and same-profile restart", () => {
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    assert.equal(migrated.status, "PASS"); assert.equal(migrated.deletedUserFiles, 0);
    assert.equal(read(path.join(qa, "profile-evidence-migration.json")).status, "FAILED",
      "Original accounting failure must not be rewritten as PASS");
    const roaming = migrated.profiles.find(p => p.source.includes("/Roaming/") || p.source.includes("\\Roaming\\"));
    assert(roaming);
    const database = path.join(roaming.target, "backend/vn_engine.db");
    // SQLite may update shared-memory bookkeeping even for a read-only database.
    // Query an exact owned copy, not the sealed profile evidence or user DB.
    const sqlCopy = path.join(out, "sqlite-readonly-copy"); fs.mkdirSync(sqlCopy);
    for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(database + suffix)) {
      const target = path.join(sqlCopy, "vn_engine.db" + suffix);
      fs.copyFileSync(database + suffix, target, fs.constants.COPYFILE_EXCL);
      assert.equal(hash(database + suffix), hash(target));
    }
    const db = new DatabaseSync(path.join(sqlCopy, "vn_engine.db"), { readOnly: true });
    try {
      const rows = db.prepare("SELECT project_id,project_json FROM editor_project_details").all();
      assert.equal(rows.length, 1);
      const row = rows[0], project = JSON.parse(row.project_json);
      assert.equal(row.project_id, ui.createdProject.metadata.projectId);
      assert.equal(ui.afterRestart.metadata.projectId, row.project_id);
      assert.equal(project.nodes.find(n => n.id === "node_scene_opening").data.scene.title,
        `安装版持久化 ${ui.cases.at(-1).key}`);
      return { database: desc(database), projectId: row.project_id, title: project.nodes.find(n => n.id === "node_scene_opening").data.scene.title,
        method: "node:sqlite readOnly SELECT; test database only", normalShutdown: false };
    } finally { db.close(); }
  });
  check("Original profiles restored, test C-drive residues preserved on F, no owned process/port", () => {
    assert.equal(restored.restored.length, 2); assert.equal(migrated.profiles.length, 2);
    for (const p of migrated.profiles) {
      assert.equal(p.cleanup, "PASS"); assert(!fs.existsSync(p.source));
      for (const f of p.files) assert.equal(hash(path.join(p.target, f.relative)), f.sha256);
    }
    const identities = ui.knownProcesses.map(p => `${p.ProcessId}:${p.created}`);
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      "$rows=@(Get-CimInstance Win32_Process|Select-Object ProcessId,@{n='created';e={$_.CreationDate.ToUniversalTime().ToString('o')}});" +
      "$ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Select-Object LocalPort,OwningProcess);" +
      "ConvertTo-Json -Depth 4 -Compress @{processes=$rows;ports=$ports}"],
    { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0);
    const actual = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
    assert(!actual.processes.some(p => identities.includes(`${p.ProcessId}:${p.created}`)));
    const ports = [8278, ...ui.launches.map(l => l.cdpPort)];
    assert(!actual.ports.some(p => ports.includes(p.LocalPort)));
    assert.equal(ui.cleanupError, undefined);
    return { ownedIdentities: identities.length, releasedPorts: ports, deletedUserFiles: 0,
      recoveredTestBytes: migrated.removedTestBytes, migration: desc(path.join(qa, "profile-evidence-migration-02.json")),
      normalWindowClose: false };
  });
  report.products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe"]
    .map(file => desc(path.join(root, file)));
  assert.equal(report.products[0].sha256, "5eaf4855207286bfa9c52344973e83f9d3f5045a9b7ee7f17943f1cb91f738fa");
  assert.equal(report.products[0].sha256, report.products[1].sha256);
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
}
