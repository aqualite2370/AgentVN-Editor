"use strict";

// Candidate preparation only. Payload extraction is not an installation test.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Release-Candidate-20261021-01";
const [mode, attempt = "01"] = process.argv.slice(2);
const checkpoint = `F:/AgentVN/Checkpoints/Release-Candidate-20261021-${attempt}`;
assert(["checkpoint", "check", "dev", "release", "payload"].includes(mode));
assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `${mode}-${attempt}`);
assert(!fs.existsSync(out), "Never overwrite evidence");
fs.mkdirSync(out, { recursive: true });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const describe = file => ({
  path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString(),
});
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const config = () => read(path.join(root, "editor/src-tauri/tauri.conf.json"));
const products = [
  "AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/target/release/agentvn-editor.exe",
  "editor/src-tauri/binaries/agentvn-player.exe", "editor/src-tauri/binaries/creator-backend.exe",
];
const frozen = [
  "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-editor.exe",
  "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-player.exe",
];
const sourceVersionFiles = [
  "editor/package.json", "editor/package-lock.json", "editor/src-tauri/tauri.conf.json",
  "editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock",
];
const report = {
  status: "RUNNING", scope: "NEW_CANDIDATE_NOT_INSTALLATION_OR_FUNCTIONAL_UPGRADE",
  mode, startedAt: new Date().toISOString(), modelRequests: 0, commands: [],
  before: products.map(f => describe(path.join(root, f))), frozen: frozen.map(describe),
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function previous(name) {
  const file = path.join(qa, name, "report.json"), value = read(file);
  assert.equal(value.status, "PASS", file);
  assert(value.commands.length || name.startsWith("checkpoint-"), "No empty gate PASS");
  assert(value.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  for (const s of value.sources || []) assert.equal(sha(path.join(root, s.file)), s.sha256, `Stale: ${s.file}`);
  return { value, identity: describe(file) };
}
function sourceFingerprint() {
  const names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString("utf8").split("\0");
  return [...new Set(names)].filter(name =>
    /^(editor\/|GameCli_framework\/|backend\/|shared\/|scripts\/)/.test(name)
    && !name.startsWith("editor/src-tauri/target/") && fs.existsSync(path.join(root, name))
    && fs.statSync(path.join(root, name)).isFile()
  ).sort().map(file => ({ file, sha256: sha(path.join(root, file)) }));
}
async function command(label, exe, args) {
  const log = path.join(out, `${String(report.commands.length + 1).padStart(2, "0")}.log`);
  const fd = fs.openSync(log, "wx");
  const row = { label, command: [exe, ...args], status: "RUNNING", startedAt: new Date().toISOString() };
  report.commands.push(row); save(); console.log(`START ${label}`);
  const child = spawn(exe, args, {
    cwd: root, windowsHide: true, stdio: ["ignore", fd, fd],
    env: { ...process.env, TEMP: out, TMP: out,
      AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED: "",
      AGENTVN_TEST_PROJECT: "F:/AgentVN/QA/Layout-Opacity-Split-20261020-01/分层透明度 隔离小工程.vnproj",
      AGENTVN_WORKSPACE_OUTPUT: path.join(out, `test-${report.commands.length}`) },
  });
  row.pid = child.pid; save();
  try {
    row.exitCode = await new Promise((resolve, reject) => {
      child.once("exit", resolve); child.once("error", reject);
    });
  } finally {
    fs.closeSync(fd); row.log = describe(log); row.finishedAt = new Date().toISOString();
  }
  row.status = row.exitCode === 0 ? "PASS" : "FAILED"; save(); console.log(`${row.status} ${label}`);
  assert.equal(row.exitCode, 0, `${label}: ${log}`);
}
function history() {
  const query = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$installer = New-Object -ComObject WindowsInstaller.Installer
$rows = @(Get-ChildItem -LiteralPath $env:AGENTVN_RELEASE_HISTORY -File | ForEach-Object {
  $row = [ordered]@{path=$_.FullName;bytes=$_.Length;kind=$_.Extension}
  if ($_.Extension -eq '.exe') { $row.version=$_.VersionInfo.ProductVersion }
  elseif ($_.Extension -eq '.msi') {
    $db=$installer.OpenDatabase($_.FullName,0)
    $view=$db.OpenView('SELECT Property, Value FROM Property')
    [void]$view.Execute()
    while ($record=$view.Fetch()) {
      $key=$record.StringData(1)
      if ($key -in @('ProductVersion','ProductCode','UpgradeCode','ProductLanguage')) {
        $row[$key]=$record.StringData(2)
      }
    }
    [void]$view.Close()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($db)
    $row.version=$row.ProductVersion
  }
  [pscustomobject]$row
})
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
ConvertTo-Json -InputObject $rows -Depth 4 -Compress
`;
  const rows = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand",
    Buffer.from(query, "utf16le").toString("base64")], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, AGENTVN_RELEASE_HISTORY: path.join(root, "releases/editor") },
  }).replace(/^\uFEFF/, ""));
  assert(rows.length > 0 && rows.every(row => row && row.path), "MSI query returned non-artifact output");
  return rows.map(row => ({ ...row, ...describe(row.path) }));
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  if (mode === "checkpoint") {
    assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });
    const diff = execFileSync("git", ["diff", "--binary", "HEAD"],
      { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    fs.writeFileSync(path.join(checkpoint, "worktree.patch"), diff, { flag: "wx" });
    const names = execFileSync("git", ["ls-files", "--modified", "--others", "--exclude-standard", "-z"],
      { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean);
    report.snapshots = [];
    for (const name of new Set(names)) {
      const source = path.resolve(root, name);
      assert(source.startsWith(root + path.sep));
      if (!fs.existsSync(source)) { report.snapshots.push({ file: name, deleted: true }); continue; }
      assert(fs.statSync(source).isFile());
      const target = path.join(checkpoint, "worktree", name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(source), sha(target)); report.snapshots.push({ file: name, ...describe(target) });
    }
    const oldRelease = path.join(root, products[2]);
    const savedRelease = path.join(checkpoint, "agentvn-editor-1.9.12.exe");
    fs.copyFileSync(oldRelease, savedRelease, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(oldRelease), sha(savedRelease)); report.savedRelease = describe(savedRelease);
    report.history = history();
    const newest = report.history.filter(r => /^\d+\.\d+\.\d+$/.test(r.version || ""))
      .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
    assert.equal(newest.version, "1.9.12");
    assert.equal(report.history.filter(r => r.version === newest.version).length, 3);
    const bundle = path.join(root, "editor/src-tauri/target/release/bundle");
    report.oldBundle = [];
    for (const [kind, suffix] of [["nsis", ".exe"], ["msi", ".msi"]]) {
      for (const name of fs.readdirSync(path.join(bundle, kind)).filter(n => n.endsWith(suffix))) {
        const item = describe(path.join(bundle, kind, name));
        assert(report.history.some(h => h.sha256 === item.sha256), "Old bundle needs a preserved release counterpart");
        report.oldBundle.push(item);
      }
    }
    assert.equal(report.oldBundle.length, 3);
    report.nextVersion = "1.9.13";
  } else {
    assert.equal(config().version, "1.9.13");
    const pre = previous(mode === "check" ? "checkpoint-02" : mode === "dev" ? "check-01"
      : mode === "release" ? "dev-01" : "release-01");
    report.precondition = pre.identity; report.sources = sourceFingerprint();
    if (mode === "check") {
      for (const name of ["package-version-contract", "package-version-encoding-regression-test",
        "editor-runtime-resource-wiring-contract", "installer-payload-provenance-test", "installer-backend-upgrade-contract"])
        await command(name, process.execPath, [`scripts/${name}.cjs`]);
      await command("version forward", process.execPath, ["scripts/editor-forward-version-test.cjs", path.join(out, "version-green.json")]);
      const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
      for (const [folder, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
        await command(`${folder} ${task}`, process.execPath, [npm, "--prefix", path.join(root, folder), "run", task]);
    } else if (mode === "dev") {
      await command("complete Dev", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts/build-dev-launcher.ps1")]);
      assert.equal(sha(path.join(root, products[0])), sha(path.join(root, products[1])));
      assert.notEqual(sha(path.join(root, products[0])), report.before[0].sha256);
      assert(fs.statSync(path.join(root, products[0])).mtimeMs >= Date.parse(report.startedAt));
      await command("installed version fault matrix", process.execPath, ["scripts/editor-installed-version-resources-test.cjs"]);
    } else if (mode === "release") {
      // These exact binaries passed their own packaged-backend/native-player gates.
      report.reusedRuntimeBinaries = report.before.slice(3);
      await command("official release build using verified binaries", "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/build-editor-windows.ps1"),
          "-SkipBackendSidecar", "-SkipGameCliPlayer"]);
      for (const p of report.reusedRuntimeBinaries) assert.equal(sha(p.path), p.sha256);
      const bundle = path.join(root, "editor/src-tauri/target/release/bundle");
      report.installers = [
        path.join(bundle, "nsis/AgentVN Editor_1.9.13_x64-setup.exe"),
        ...["en-US", "zh-CN"].map(lang => path.join(bundle, `msi/AgentVN Editor_1.9.13_x64_${lang}.msi`)),
      ].map(describe);
    } else {
      for (const p of pre.value.installers) assert.equal(sha(p.path), p.sha256);
      await command("three installer payloads", process.execPath, ["scripts/editor-installer-resources-acceptance.cjs",
        path.join(out, "deployments"), "1.9.13"]);
      const payload = read(path.join(out, "deployments/installer-resource-report.json"));
      assert.equal(payload.status, "PASS"); assert.equal(payload.deployments.length, 3);
      report.payloadReport = describe(path.join(out, "deployments/installer-resource-report.json"));
    }
    for (const s of report.sources) assert.equal(sha(path.join(root, s.file)), s.sha256, `Source changed: ${s.file}`);
  }
  for (const f of report.frozen) assert.equal(sha(f.path), f.sha256, "Frozen candidate changed");
  report.products = products.map(f => describe(path.join(root, f)));
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
