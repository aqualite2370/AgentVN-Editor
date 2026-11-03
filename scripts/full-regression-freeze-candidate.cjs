"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), runRoot = path.resolve(process.argv[2] || "");
assert(process.argv[2] && runRoot.startsWith(path.join(root, "output", "full-regression-")));
const candidateName = process.argv[3] || "candidate";
assert(/^candidate(?:-\d+)?$/.test(candidateName), "Use a fresh candidate evidence name");
const out = path.join(runRoot, candidateName);
assert(!fs.existsSync(out), "Never replace the frozen candidate");
const report = { status: "RUNNING", scope: "FROZEN_BUILD_NOT_INSTALLED_FUNCTIONAL_ACCEPTANCE",
  startedAt: new Date().toISOString(), artifacts: [], source: [], prerequisites: [] };
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
async function hash(file) {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
async function describe(file) {
  const stat = fs.statSync(file);
  return { path: file, sha256: await hash(file), bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
}
function files(directory) {
  const found = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "target", "__pycache__", ".venv", "dist", "build"].includes(item.name)) continue;
    const file = path.join(directory, item.name);
    assert(!item.isSymbolicLink(), `Source manifest cannot follow links: ${file}`);
    if (item.isDirectory()) found.push(...files(file));
    else if (item.isFile()) found.push(file);
  }
  return found;
}
(async () => {
  for (const label of ["editor-version-green", "evidence-validator-green", "editor-typecheck",
    "editor-build", "gamecli-build-02", "version-resources-green", "workspace-behavior",
    "package-version-contract", "workspace-contract", "owned-vite-server", "checkpoint-supplement",
    "dev-build", "release-build"]) {
    const file = path.join(runRoot, "commands", label, "report.json"), data = read(file);
    assert.equal(data.status, "PASS", `Required command ${label} did not pass`);
    report.prerequisites.push(await describe(file));
  }
  const config = read(path.join(root, "editor/src-tauri/tauri.conf.json"));
  assert.equal(config.version, "1.9.9");
  const workspace = read(path.join(runRoot, "commands/workspace-behavior/workspace/report.json"));
  assert.equal(workspace.ok, true);
  assert.deepEqual(workspace.viewports.map(row => [row.viewport.width, row.viewport.height]),
    [[1920, 1080], [2560, 1440], [3840, 2160]]);
  assert.equal(read(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json")).editorVersion,
    config.version);
  const dev = path.join(root, "AgentVN Dev.exe"), debug = path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe");
  assert.equal(await hash(dev), await hash(debug), "Root Dev was not replaced");
  assert(!fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")), "Pending is not actual Dev delivery");
  const release = path.join(root, "editor/src-tauri/target/release/agentvn-editor.exe");
  const peQuery = "$ErrorActionPreference='Stop'; $paths=$env:AGENTVN_PE_PATHS | ConvertFrom-Json; @(foreach($p in $paths) { $f=Get-Item -LiteralPath $p; [pscustomobject]@{path=$f.FullName;version=$f.VersionInfo.ProductVersion} }) | ConvertTo-Json -Compress";
  report.pe = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", peQuery], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, AGENTVN_PE_PATHS: JSON.stringify([dev, release]) },
  }).replace(/^\uFEFF/, ""));
  assert(Array.isArray(report.pe) && report.pe.length === 2, "PE inventory must contain two individual files");
  assert(report.pe.every(row => row.version === config.version));
  fs.mkdirSync(out);
  report.version = config.version;
  for (const [source, target] of [
    [dev, "bin/AgentVN Dev.exe"], [release, "bin/agentvn-editor.exe"],
    [path.join(root, "editor/src-tauri/binaries/creator-backend.exe"), "bin/creator-backend.exe"],
    [path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"), "bin/agentvn-player.exe"],
    [path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json"), "bin/build-versions.json"],
    [path.join(root, `editor/src-tauri/target/release/bundle/nsis/AgentVN Editor_${config.version}_x64-setup.exe`),
      `installers/AgentVN Editor_${config.version}_x64-setup.exe`],
    ...["en-US", "zh-CN"].map(lang => [
      path.join(root, `editor/src-tauri/target/release/bundle/msi/AgentVN Editor_${config.version}_x64_${lang}.msi`),
      `installers/AgentVN Editor_${config.version}_x64_${lang}.msi`]),
  ]) {
    const destination = path.join(out, target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    const original = await describe(source), copy = await describe(destination);
    assert.equal(original.sha256, copy.sha256);
    report.artifacts.push({ source: original, frozen: copy });
  }
  const msiQuery = [
    "$ErrorActionPreference='Stop'",
    "$installer=New-Object -ComObject WindowsInstaller.Installer",
    "$paths=$env:AGENTVN_MSI_PATHS | ConvertFrom-Json",
    "$rows=@(foreach($file in $paths) {",
    "$db=$installer.OpenDatabase($file,0); $view=$db.OpenView('SELECT * FROM Property'); $view.Execute()",
    "$properties=@{}; while($record=$view.Fetch()) { $key=$record.StringData(1); if(@('ProductVersion','ProductCode','UpgradeCode','ProductName','Manufacturer') -contains $key) { $properties[$key]=$record.StringData(2) } }",
    "$view.Close(); [pscustomobject]@{path=$file;properties=$properties} })",
    "$rows | ConvertTo-Json -Depth 5 -Compress",
  ].join("\n");
  report.msiMetadata = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", msiQuery], {
    encoding: "utf8", windowsHide: true, env: { ...process.env,
      AGENTVN_MSI_PATHS: JSON.stringify(report.artifacts.filter(row => row.frozen.path.endsWith(".msi"))
        .map(row => row.frozen.path)) },
  }).replace(/^\uFEFF/, ""));
  assert.equal(report.msiMetadata.length, 2);
  assert(report.msiMetadata.every(row => row.properties.ProductVersion === config.version));
  const approvedVersionPaths = new Set(["editor/package.json", "editor/package-lock.json",
    "editor/src-tauri/tauri.conf.json", "editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock"]);
  report.checkpointScope = { scope: "Pre-existing checkpointed product files only; not a user DB audit",
    changed: [], unexpected: [] };
  const supplemental = read(path.join(runRoot, "checkpoint/supplement-01/manifest.json"));
  assert.equal(supplemental.status, "PASS");
  for (const entry of [...read(path.join(runRoot, "checkpoint/manifest.json")).files, ...supplemental.files]) {
    const relative = entry.relative.replaceAll("\\", "/");
    if (!approvedVersionPaths.has(relative)
      && !["editor/src/", "editor/src-tauri/src/", "GameCli_framework/src/",
        "GameCli_framework/src-tauri/src/", "shared/", "backend/app/"].some(prefix => relative.startsWith(prefix)))
      continue;
    const file = path.join(root, relative);
    const current = fs.existsSync(file) ? await hash(file) : null;
    if (current !== (entry.deleted ? null : entry.sha256)) {
      const change = { relative, before: entry.sha256 ?? null, after: current };
      report.checkpointScope.changed.push(change);
      if (!approvedVersionPaths.has(relative)) report.checkpointScope.unexpected.push(change);
    }
  }
  assert.deepEqual(report.checkpointScope.unexpected, [], "Unexpected product edit outside the version exception");
  for (const relative of ["editor/src", "editor/src-tauri/src", "GameCli_framework/src",
    "GameCli_framework/src-tauri/src", "shared", "backend/app"])
    for (const file of files(path.join(root, relative))) report.source.push(await describe(file));
  for (const relative of ["editor/package.json", "editor/package-lock.json",
    "editor/src-tauri/tauri.conf.json", "editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock",
    "GameCli_framework/package.json", "GameCli_framework/src-tauri/tauri.conf.json",
    "scripts/build-editor-windows.ps1", "scripts/build-backend-sidecar.ps1",
    "scripts/prepare-editor-runtime-resources.ps1"])
    report.source.push(await describe(path.join(root, relative)));
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  fs.mkdirSync(out, { recursive: true });
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, version: report.version,
    artifacts: report.artifacts.length, source: report.source.length, error: report.error }));
});
