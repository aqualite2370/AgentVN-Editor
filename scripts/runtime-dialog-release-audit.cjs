"use strict";
// Independent evidence and cleanup audit; never promotes the old failed install.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01";
const [flowAttempt = "06", attempt = "01"] = process.argv.slice(2);
for (const n of [flowAttempt, attempt]) assert.match(n, /^\d{2}$/);
const out = path.join(qa, `audit-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [], modelRequests: 0,
  scope: "NEW_INSTALLED_EDITOR_DIALOG_REPAIR_NOT_FULL_REGRESSION_OR_STANDALONE",
  oldInstalledCandidate: "FAILED_UNCHANGED", actualPush: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function check(label, fn) {
  const row = { label, status: "RUNNING" }; report.groups.push(row); save();
  try { row.result = fn(); row.status = "PASS"; console.log(`PASS ${label}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; } finally { save(); }
}
function run(exe, args) {
  const r = spawnSync(exe, args, { cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout.trim();
}
try {
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  const receipts = {};
  check("Nonempty candidate gates, exact sources/logs and actual version", () => {
    for (const phase of ["checkpoint", "check", "dev", "release", "payload"]) {
      const file = path.join(qa, `${phase}-01/report.json`), data = read(file); receipts[phase] = data;
      assert.equal(data.status, "PASS");
      if (phase !== "checkpoint") assert(data.commands.length > 0);
      for (const c of data.commands) {
        assert.equal(c.status, "PASS"); assert.equal(c.exitCode, 0); assert.equal(sha(c.log.path), c.log.sha256);
      }
      for (const f of data.sources || []) assert.equal(sha(path.join(root, f.file)), f.sha256);
    }
    assert.equal(receipts.check.commands.length, 11); assert.equal(receipts.dev.commands.length, 2);
    assert.equal(read(path.join(qa, "version-red.json")).status, "FAILED");
    assert.equal(read(path.join(qa, "check-01/version-green.json")).status, "PASS");
    assert.equal(receipts.dev.products[0].sha256, sha(path.join(root, "AgentVN Dev.exe")));
    assert.equal(sha(path.join(root, "AgentVN Dev.exe")), sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    for (const f of receipts.payload.archived) assert.equal(sha(f.path), f.sha256);
    assert.equal(receipts.payload.deployments.length, 3);
    const repair = receipts.checkpoint.repairEvidence;
    assert.equal(sha(repair.path), repair.sha256);
    const green = read("F:/AgentVN/QA/Runtime-Dialog-Measurement-20261021-01/browser-05/report.json");
    assert.equal(green.status, "PASS"); assert.equal(green.cases.length, 56);
    for (const f of green.sourceFiles) assert.equal(sha(f.path), f.sha256);
    return Object.keys(receipts).map(phase => desc(path.join(qa, `${phase}-01/report.json`)));
  });
  const installation = read(path.join(qa, "installation.json"));
  check("Actual NSIS installed bytes, resource provenance and original install metadata restored", () => {
    assert.equal(installation.status, "PASS"); assert.equal(installation.exitCode, 0);
    assert.equal(installation.metadataRestoration, "PASS"); assert.equal(installation.cleanupError, null);
    assert.equal(installation.executable.version, "1.9.14");
    assert.equal(sha(installation.executable.path), installation.executable.sha256);
    for (const f of installation.resources) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(path.join(installation.installRoot, "GameCli_framework/src/styles/player.css")),
      sha(path.join(root, "GameCli_framework/src/styles/player.css")));
    for (const row of installation.registry) {
      const actual = JSON.parse(ps(`$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${row.path}');` +
        `if(!$key){throw 'Missing key'};try{$v=@(foreach($name in $key.GetValueNames()){` +
        `@{name=$name;kind=$key.GetValueKind($name).ToString();value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}});` +
        `ConvertTo-Json -InputObject $v -Depth 6 -Compress}finally{$key.Dispose()}`));
      assert.equal(actual.length, row.values.length);
      for (const v of row.values) assert.deepEqual(actual.find(a => a.name === v.name), v);
    }
    for (const s of installation.shortcuts) {
      assert.equal(fs.existsSync(s.path), s.existed);
      if (s.existed) assert.equal(sha(s.path), s.sha256);
    }
    assert(installation.generatedShortcuts.length >= 2);
    const msiPaths = receipts.payload.archived.slice(1).map(f => f.path);
    const msiRows = JSON.parse(ps(`$installer=New-Object -ComObject WindowsInstaller.Installer;$rows=@();` +
      `try{foreach($file in @(${msiPaths.map(f => "'" + f.replace(/'/g, "''") + "'").join(",")})){` +
      `$db=$installer.OpenDatabase($file,0);$view=$db.OpenView('SELECT Property, Value FROM Property');[void]$view.Execute();` +
      `$row=@{path=$file};while($rec=$view.Fetch()){if($rec.StringData(1) -in @('ProductVersion','ProductLanguage'))` +
      `{$row[$rec.StringData(1)]=$rec.StringData(2)}};$rows+=$row;[void]$view.Close();` +
      `[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($db)}` +
      `;ConvertTo-Json -InputObject $rows -Compress}finally{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)}`));
    assert.equal(msiRows.length, 2); assert(msiRows.every(r => r.ProductVersion === "1.9.14"));
    assert.deepEqual(msiRows.map(r => r.ProductLanguage).sort(), ["1033", "2052"]);
    return { installation: desc(path.join(qa, "installation.json")), shortcuts: installation.generatedShortcuts.length };
  });
  const pointer = read(path.join(qa, `installed-flow-${flowAttempt}.json`));
  assert.equal(pointer.status, "PASS"); assert.equal(sha(pointer.report.path), pointer.report.sha256);
  const flow = read(pointer.report.path);
  check("Fresh author, real node iframe, native package, restart and two actual UI exports", () => {
    assert.equal(flow.status, "PASS"); assert.equal(flow.version, "1.9.14"); assert.equal(flow.steps.length, 5);
    assert(flow.steps.every(s => s.status === "PASS")); assert.equal(flow.cases.length, 4);
    assert.equal(new Set(flow.cases.map(c => `${c.type}/${c.reduced}`)).size, 4);
    for (const c of flow.cases) {
      assert.equal(c.status, "PASS"); assert.equal(c.owner.title, "GameCLI 内嵌预览"); assert.equal(c.owner.ghost, false);
      assert.equal(c.samples.length, 30); assert.equal(new Set(c.samples.slice(-10).map(s => JSON.stringify(s))).size, 1);
      assert(c.samples.every(s => s.layout === c.type && s.text.startsWith("PORTRAIT_LAYOUT") &&
        s.scroll[0] <= s.width + 1 && s.scroll[1] <= s.height + 1));
    }
    assert.deepEqual(flow.errors, []); assert.equal(flow.modelRequests, 0); assert.equal(flow.cleanupError, undefined);
    assert.equal(flow.launches.length, 2);
    for (const l of flow.launches) {
      assert.equal(l.executable.sha256, installation.executable.sha256);
      assert.equal(path.resolve(l.backend.ExecutablePath), path.resolve(installation.installRoot, "creator-backend.exe"));
      assert(l.dataDirectoryOverride && l.webviewDirectoryOverride && !l.sourceServer && !l.manualBackendSpawn);
    }
    assert.equal(flow.cartridges.length, 2);
    assert.equal(flow.postExportNodeChecks.length, 2);
    assert(flow.postExportNodeChecks.every(c => c.status === "PASS" && c.samples.length === 30));
    for (const c of flow.cartridges) assert.equal(sha(c.path), c.sha256);
    assert.equal(sha(flow.portable.path), flow.portable.sha256);
    assert.equal(flow.downloadCleanup.status, "PASS"); assert(!fs.existsSync(flow.nativeSaveSource.path));
    const dbRoot = path.join(flow.launches[0].data, "backend"), copiedDb = path.join(out, "sqlite");
    fs.mkdirSync(copiedDb);
    for (const name of ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"]) {
      const original = path.join(dbRoot, name); if (!fs.existsSync(original)) continue;
      fs.copyFileSync(original, path.join(copiedDb, name), fs.constants.COPYFILE_EXCL);
      assert.equal(sha(path.join(copiedDb, name)), sha(original));
    }
    const db = new DatabaseSync(path.join(copiedDb, "vn_engine.db"), { readOnly: true });
    try {
      const p = db.prepare("SELECT project_id,project_json FROM editor_project_details WHERE project_id=?")
        .get("installed-portrait-20261021-01");
      assert(p, "Real isolated SQLite project required");
      const stored = JSON.parse(p.project_json);
      for (const c of flow.cartridges)
        assert.deepEqual(stored.editor_settings.runtimeUILayoutProfiles.profiles[c.type].dialogPortrait, c.layout.dialogPortrait);
      return { flow: pointer.report, realSqliteProject: p.project_id, nodes: flow.cases.length, exports: 2 };
    } finally { db.close(); }
  });
  check("Actual screenshot parameters and bytes", () => {
    assert.equal(flow.screenshots.length, 2);
    for (const s of flow.screenshots) {
      assert.equal(sha(s.path), s.sha256);
      const png = fs.readFileSync(s.path);
      assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
      // Capture helper validates pre/post media and DPR; require its raw samples.
      validateNativeViewport(s.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
      validateNativeViewport(s.after, { width: 1920, height: 1080, dpr: 1, reduced: false });
    }
    return flow.screenshots;
  });
  check("Native cache restoration, process/port ownership and protected files", () => {
    assert.equal(sha(flow.nativeCacheRestoration.path), flow.nativeCacheRestoration.sha256);
    const restoration = read(flow.nativeCacheRestoration.path); assert.equal(restoration.status, "PASS");
    const actualId = ps(`$v=(& fsutil.exe file queryfileid '${restoration.originalDirectory}'|Out-String);` +
      `if($LASTEXITCODE -ne 0 -or $v -notmatch '0x[0-9a-fA-F]+'){throw 'ID unavailable'};$Matches[0].ToLowerInvariant()`);
    assert.equal(actualId, restoration.originalDirectoryId);
    for (const f of restoration.originalFiles) assert.equal(sha(path.join(restoration.originalDirectory, f.relative)), f.sha256);
    const known = new Set(flow.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`)), ports = flow.launches.flatMap(l => l.ports);
    assert(!rows().some(p => known.has(`${p.ProcessId}:${p.Created}`))); assert.equal(listeners(ports).length, 0);
    assert.equal(flow.cleanups.length, 2);
    assert(flow.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
    for (const f of [...receipts.checkpoint.frozen, ...receipts.checkpoint.history]) assert.equal(sha(f.path), f.sha256);
    for (const n of ["04", "05"]) {
      const old = read(`F:/AgentVN/QA/Installed-Portrait-20261021-01/editor-${n}/report.json`);
      assert.equal(old.status, "FAILED"); assert(old.errors.some(e => e.includes("#185")));
    }
    return { processIdentities: known.size, ports, oldCacheMissingOriginalBytesStillDisclosed: true,
      oldFailuresUnchanged: true, normalClose: false };
  });
  check("Read-only git publication preflight and ignore boundaries", () => {
    const head = run("git", ["rev-parse", "HEAD"]);
    const index = path.resolve(root, run("git", ["rev-parse", "--git-path", "index"])), before = sha(index);
    const text = run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/push-agentvn-editor.ps1"), "-CheckOnly"]);
    assert.match(text, /CHECK_ONLY_PASS/); assert.equal(run("git", ["rev-parse", "HEAD"]), head); assert.equal(sha(index), before);
    for (const f of ["scripts/runtime-dialog-release.cjs", "scripts/runtime-dialog-installed-session.ps1",
      "scripts/runtime-dialog-installed-current.cjs", "scripts/lib/installed-release-session.cjs", "scripts/runtime-dialog-release-audit.cjs"])
      assert.equal(spawnSync("git", ["check-ignore", "--", f], { cwd: root, windowsHide: true }).status, 1);
    assert.equal(spawnSync("git", ["check-ignore", "--", "output/runtime-dialog-release-20261021-01/REPORT.md"],
      { cwd: root, windowsHide: true }).status, 0);
    return { head, indexSha256: before, preflight: text, actualPush: false, ignoreChangesNeeded: false };
  });
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); }
