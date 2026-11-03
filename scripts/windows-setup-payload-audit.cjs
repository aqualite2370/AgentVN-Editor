"use strict";
// Payload verification only, never counted as an actual install.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { compareBundleMarker } = require("./lib/tauri-windows-bundle-marker.cjs");
const { ps } = require("./lib/current-native-editor-session.cjs");
const nativeUI = process.argv.includes("--native-ui");
const upgrade = process.argv.includes("--upgrade-from-retained");
const sourceNumber = process.argv.find(a => a.startsWith("--native-ui-source="))?.split("=")[1];
const auditNumber = process.argv.find(a => a.startsWith("--native-build-audit="))?.split("=")[1];
assert(!sourceNumber || (nativeUI && /^\d{2}$/.test(sourceNumber) && /^\d{2}$/.test(auditNumber)));
assert(!upgrade || nativeUI, "Upgrade payload must use actual native UI build");
const number = process.argv[2] || "01"; assert(/^\d{2}$/.test(number));
const base = "F:/AgentVN/QA/Windows-Package-20261021-01", out = path.join(base, `setup-payload-audit-${number}`);
fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const report = { status: "RUNNING", scope: "ACTUAL_NSIS_PAYLOAD_BYTES_NOT_INSTALLATION",
  startedAt: new Date().toISOString(), resources: [] };
try {
  const sourceFile = path.join(base, sourceNumber ? `editor-${sourceNumber}/report.json`
    : upgrade ? "editor-04/report.json" : nativeUI ? "editor-03/report.json" : "editor-01/report.json");
  const buildFile = path.join(base, sourceNumber ? `native-ui-audit-${auditNumber}/report.json`
    : upgrade ? "native-ui-audit-03/report.json" : nativeUI ? "native-ui-audit-02/report.json" : "build-audit-01/report.json");
  const raw = read(sourceFile);
  const context = sourceNumber ? require("./lib/windows-current-native-source.cjs").loadNativeSource(sourceFile, buildFile) : undefined;
  if (nativeUI && !context) require("./installed-windows-native-ui-current-audit.cjs").validate(raw);
  if (context?.candidateBinding) report.candidateBinding = context.candidateBinding;
  if (upgrade) require("./lib/windows-game-upgrade-fixture.cjs").validateUpgradeFixture(raw.upgradeFixture);
  const artifact = nativeUI ? raw.windowsInstaller : raw.artifacts.find(a => a.kind === "windows_nsis_installer");
  const portable = nativeUI ? raw.windowsPortable : raw.artifacts.find(a => a.kind === "windows_portable_exe");
  assert.equal(sha(artifact.path), artifact.sha256); assert.equal(sha(portable.path), portable.sha256);
  report.installer = artifact;
  report.source = { path: sourceFile, sha256: sha(sourceFile) };
  report.nativeUIBuildSource = nativeUI;
  const payloadRoot = path.join(base, `setup-payload-${number}`);
  if (nativeUI) {
    assert(!fs.existsSync(payloadRoot), "Never overwrite extracted payload evidence");
    const extractor = "C:/Program Files/7-Zip/7z.exe";
    const result = require("node:child_process").spawnSync(extractor, ["x", artifact.path, `-o${payloadRoot}`, "-y"],
      { encoding: "utf8", windowsHide: true, timeout: 60000 });
    fs.writeFileSync(path.join(out, "extraction.log"), (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    report.extractor = { path: extractor, sha256: sha(extractor), exitCode: result.status };
  }
  const exe = path.join(payloadRoot, "agentvn-player.exe");
  report.executable = { path: exe, sha256: sha(exe), bytes: fs.statSync(exe).size };
  report.marker = compareBundleMarker(fs.readFileSync(portable.path), fs.readFileSync(exe));
  if (!nativeUI) {
    const prior = read(path.join(base, "runtime-06/installation.json"));
    assert.equal(report.executable.sha256, prior.executable.sha256);
    report.actualFirstInstallSha256 = prior.executable.sha256;
  }
  const source = "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-utils-2.9.2/src/platform.rs";
  const text = fs.readFileSync(source, "utf8");
  assert(text.includes('static mut __TAURI_BUNDLE_TYPE: &str = "__TAURI_BUNDLE_TYPE_VAR_UNK"'));
  assert(text.includes('"__TAURI_BUNDLE_TYPE_VAR_NSS" => Some(BundleType::Nsis)'));
  report.bundleTypeSource = { path: source, sha256: sha(source) };
  const build = read(buildFile); assert.equal(build.status, "PASS");
  if (nativeUI) assert.equal(build.source.sha256, sha(sourceFile));
  report.buildAudit = { path: buildFile, sha256: sha(buildFile) };
  const embedded = nativeUI
    ? build.groups.find(g => g.name === "observed-input-cartridge-and-embedded-bytes").detail.entries
      .map(e => ({ name: e.name, sha256: e.outputSha256, bytes: e.outputBytes }))
    : build.embedded;
  if (nativeUI) {
    const file = path.join(path.dirname(portable.path), "embedded-cartridge/startup-index.json");
    embedded.push({ name: "startup-index.json", sha256: sha(file), bytes: fs.statSync(file).size });
  }
  for (const item of embedded) {
    const file = path.join(payloadRoot, "embedded-cartridge", item.name);
    assert.equal(sha(file), item.sha256); assert.equal(fs.statSync(file).size, item.bytes);
    report.resources.push({ name: item.name, path: file, sha256: item.sha256, bytes: item.bytes });
  }
  report.pe = JSON.parse(ps(`$v=(Get-Item -LiteralPath '${exe}').VersionInfo;` +
    `@{fileVersion=$v.FileVersion;productVersion=$v.ProductVersion;productName=$v.ProductName}|ConvertTo-Json -Compress`));
  const manifest = nativeUI ? read(path.join(payloadRoot, "embedded-cartridge/manifest.json")) : raw.cartridge.manifest;
  assert.equal(report.pe.fileVersion, context?.options.expectedUpgradeFixture?.version || (upgrade ? "1.0.1" : "1.0.0")); assert.equal(report.pe.productName, manifest.title);
  report.upgradeFromRetained = upgrade;
  report.product = manifest.title; report.gameId = manifest.game_id;
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
