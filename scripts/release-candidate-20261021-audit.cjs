"use strict";

// Archive and independently inspect this candidate. No registry writes or UI input.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Release-Candidate-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `audit-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: hash(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
  scope: "CANDIDATE_PAYLOAD_INTEGRITY_NOT_NORMAL_INSTALL_OR_UPGRADE",
  modelRequests: 0, actualInstallStatus: "NOT_RUN", androidStatus: "NOT_RUN" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function check(label, action) {
  const row = { label, status: "RUNNING" }; report.groups.push(row); save();
  try { row.result = action(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { save(); }
}
try {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const receipts = {};
  check("Real nonempty gates and unchanged source/log bytes", () => {
    for (const phase of ["checkpoint-02", "check-01", "dev-01", "release-01", "payload-01"]) {
      const file = path.join(qa, phase, "report.json"), data = read(file); receipts[phase] = data;
      assert.equal(data.status, "PASS", file);
      assert(phase.startsWith("checkpoint") || data.commands.length > 0);
      for (const c of data.commands) {
        assert.equal(c.status, "PASS"); assert.equal(c.exitCode, 0);
        assert.equal(hash(c.log.path), c.log.sha256);
      }
      for (const s of data.sources || []) assert.equal(hash(path.join(root, s.file)), s.sha256, s.file);
    }
    assert.equal(receipts["check-01"].commands.length, 9);
    assert.equal(receipts["dev-01"].commands.length, 2);
    assert.equal(read(path.join(qa, "version-red.json")).status, "FAILED");
    assert.equal(read(path.join(qa, "check-01/version-green.json")).status, "PASS");
    return Object.keys(receipts).map(phase => desc(path.join(qa, phase, "report.json")));
  });
  const payload = read(path.join(qa, "payload-01/deployments/installer-resource-report.json"));
  check("Three real payloads: current source and exact binaries", () => {
    assert.equal(payload.status, "PASS"); assert.equal(payload.deployments.length, 3);
    const sources = receipts["release-01"].sources.filter(s =>
      /^(GameCli_framework\/src\/|GameCli_framework\/src-tauri\/src\/|shared\/)/.test(s.file));
    assert(sources.length >= 100, "No shallow or empty source comparison");
    return payload.deployments.map(deployment => {
      assert.equal(read(deployment.versionResource.path).editorVersion, "1.9.13");
      for (const s of sources)
        assert.equal(hash(path.join(deployment.installedRoot, s.file)), s.sha256, `${deployment.kind}: ${s.file}`);
      for (const name of ["creator-backend.exe", "agentvn-player.exe"])
        assert.equal(hash(path.join(deployment.installedRoot, name)), hash(path.join(root, "editor/src-tauri/binaries", name)));
      return { kind: deployment.kind, sourceFiles: sources.length, version: desc(deployment.versionResource.path),
        executable: desc(deployment.executable.path) };
    });
  });
  check("Rebuilt Dev and exact native Player supplement", () => {
    const dev = desc(path.join(root, "AgentVN Dev.exe"));
    assert.equal(dev.sha256, hash(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert.equal(dev.sha256, receipts["dev-01"].products[0].sha256);
    const file = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/opacity-current-03/report.json";
    const native = read(file);
    assert.equal(native.status, "PASS"); assert.equal(native.cleanupError, null);
    assert.equal(native.executable.sha256, hash(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe")));
    assert.equal(native.cases.length, 2);
    assert(native.cases.every(c => c.status === "PASS" && c.realCategoryClick && c.categoryFinal.transition === "idle"));
    assert(native.launches.every(l => l.cleanup === "PASS"));
    const restoration = read(path.join(path.dirname(file), "profile-restoration.json"));
    assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
    return { dev, native: desc(file), nativeScope: native.scope, normalClose: false };
  });
  check("Internal PE/MSI versions, no filename inference", () => {
    const exeFiles = [
      path.join(root, "AgentVN Dev.exe"), path.join(root, "editor/src-tauri/target/release/agentvn-editor.exe"),
      ...payload.deployments.map(d => d.executable.path), receipts["release-01"].installers[0].path,
    ];
    const msiFiles = receipts["release-01"].installers.slice(1).map(i => i.path);
    const script = `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$rows=@()
foreach($file in (ConvertFrom-Json $env:AGENTVN_CANDIDATE_EXES)) {
  $rows += [pscustomobject]@{path=$file;version=(Get-Item -LiteralPath $file).VersionInfo.ProductVersion}
}
$installer=New-Object -ComObject WindowsInstaller.Installer
foreach($file in (ConvertFrom-Json $env:AGENTVN_CANDIDATE_MSIS)) {
  $db=$installer.OpenDatabase($file,0)
  $view=$db.OpenView('SELECT Property, Value FROM Property')
  [void]$view.Execute()
  $row=[ordered]@{path=$file}
  while($record=$view.Fetch()){
    if($record.StringData(1) -in @('ProductVersion','ProductLanguage','ProductCode','UpgradeCode')){
      $row[$record.StringData(1)]=$record.StringData(2)
    }
  }
  [void]$view.Close()
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($db)
  $row.version=$row.ProductVersion
  $rows += [pscustomobject]$row
}
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
ConvertTo-Json -InputObject $rows -Compress
`;
    const rows = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", windowsHide: true, env: {
        ...process.env, AGENTVN_CANDIDATE_EXES: JSON.stringify(exeFiles), AGENTVN_CANDIDATE_MSIS: JSON.stringify(msiFiles),
      } }).replace(/^\uFEFF/, ""));
    assert.equal(rows.length, 8);
    assert(rows.every(row => row.version === "1.9.13"));
    assert.deepEqual(rows.filter(r => r.ProductLanguage).map(r => r.ProductLanguage).sort(), ["1033", "2052"]);
    return rows;
  });
  check("Frozen installation and historical release bytes preserved", () => {
    const old = receipts["checkpoint-02"];
    for (const file of [...old.frozen, ...old.history]) assert.equal(hash(file.path), file.sha256, file.path);
    assert.equal(hash(old.savedRelease.path), old.savedRelease.sha256);
    return { frozenFiles: old.frozen.length, historicalInstallers: old.history.length, savedRelease: old.savedRelease };
  });
  check("Publishing preflight leaves real HEAD/index unchanged", () => {
    const head = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const index = path.resolve(root, execFileSync("git", ["rev-parse", "--git-path", "index"],
      { cwd: root, encoding: "utf8" }).trim());
    const before = { head: head(), index: hash(index) };
    const text = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/push-agentvn-editor.ps1"), "-CheckOnly"],
    { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 });
    assert.match(text, /CHECK_ONLY_PASS/);
    const after = { head: head(), index: hash(index) }; assert.deepEqual(after, before);
    const ignored = execFileSync("git", ["check-ignore", "--",
      "output/release-candidate-20261021-01/REPORT.md", "AgentVN Dev.exe",
      "releases/editor/AgentVN_Editor_v1.9.13_candidate.exe"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/);
    assert.equal(ignored.length, 3);
    const candidates = execFileSync("git", ["ls-files", "--others", "--exclude-standard"],
      { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).split(/\r?\n/);
    for (const file of ["scripts/release-candidate-20261021.cjs", "scripts/release-candidate-20261021-audit.cjs"])
      assert(candidates.includes(file), `New QA source is accidentally ignored: ${file}`);
    const safetyFile = "F:/AgentVN/QA/Gitpush-Ignore-20261020-01/run-XlX0OG/report.json";
    const safety = read(safetyFile);
    assert.equal(safety.status, "PASS");
    assert(safety.results.length === 10 && safety.results.every(c => c.status === "PASS"));
    return { before, after, output: text, safety: desc(safetyFile), realPush: false };
  });
  check("Archive candidate trio without overwriting previous releases", () => {
    const date = new Date(receipts["release-01"].finishedAt);
    const pad = n => String(n).padStart(2, "0");
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    return receipts["release-01"].installers.map((file, index) => {
      assert.equal(hash(file.path), file.sha256);
      const suffix = index === 0 ? ".exe" : index === 1 ? "_en-US.msi" : "_zh-CN.msi";
      const target = path.join(root, "releases/editor", `AgentVN_Editor_v1.9.13_${stamp}${suffix}`);
      fs.copyFileSync(file.path, target, fs.constants.COPYFILE_EXCL);
      assert.equal(hash(target), file.sha256);
      return { ...desc(target), source: file.path };
    });
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
}
