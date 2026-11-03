"use strict";
// Static verification of retained real builds. Never rebuilds an old version,
// runs a game, installs a package, reads signing secrets or uses ADB.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { ps } = require("./lib/current-native-editor-session.cjs");
const { validateBuildEvidence } = require("./lib/windows-package-current-evidence.cjs");
const { verifyProvenance } = require("./android-acceptance-evidence.cjs");
const base = "F:/AgentVN/QA/Game-Upgrade-Samples-20261022-01";
const attempt = process.argv[2] || "01"; assert(/^\d{2}$/.test(attempt));
const out = path.join(base, `preflight-${attempt}`); fs.mkdirSync(out, { recursive: false });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedAt: fs.statSync(f).mtime.toISOString() });
const r = { status: "RUNNING", scope: "READ_ONLY_REAL_RETAINED_GAME_SAMPLES_NOT_UPGRADE_ACCEPTANCE",
  startedAt: new Date().toISOString(), builds: 0, installations: 0, deviceOperations: 0, modelRequests: 0,
  checks: [], sources: [], upgradeStatus: "NOT_RUN", preSaveMechanismSample: "BLOCKED_MISSING_TRUSTED_BINARY" };
function load(file) { r.sources.push(desc(file)); return read(file); }
function command(exe, args, logName) {
  const result = spawnSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 60000 });
  const log = path.join(out, logName + ".log");
  fs.writeFileSync(log, (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  assert.ifError(result.error); assert.equal(result.status, 0, log);
  r.sources.push(desc(log)); return result.stdout;
}
try {
  const winRoot = "F:/AgentVN/QA/Windows-Package-20261021-01";
  const old = load(path.join(winRoot, "editor-01/report.json")); validateBuildEvidence(old);
  const oldAudit = load(path.join(winRoot, "build-audit-01/report.json"));
  assert.equal(oldAudit.status, "PASS"); assert.equal(oldAudit.source.sha256, sha(path.join(winRoot, "editor-01/report.json")));
  const installation = load(old.installation.path); assert.equal(sha(old.installation.path), old.installation.sha256);
  assert.equal(installation.executable.version, "1.9.16");
  const payload = load(path.join(winRoot, "setup-payload-audit-01/report.json")); assert.equal(payload.status, "PASS");
  const oldPortable = old.artifacts.find(a => a.kind === "windows_portable_exe");
  const oldInstaller = old.artifacts.find(a => a.kind === "windows_nsis_installer");
  for (const f of [oldPortable, oldInstaller, payload.executable]) assert.equal(sha(f.path), f.sha256);
  assert.equal(payload.installer.sha256, oldInstaller.sha256);
  assert.equal(payload.marker.portableSha256, oldPortable.sha256);
  const pe = JSON.parse(ps(`$v=(Get-Item -LiteralPath '${payload.executable.path}').VersionInfo;` +
    "@{version=$v.FileVersion;title=$v.ProductName}|ConvertTo-Json -Compress"));
  assert.equal(pe.title, old.cartridge.manifest.title);
  assert.equal(pe.version, old.nativeResult.result.releaseIdentity.versionName);
  r.windowsOld = { editorVersion: installation.executable.version, gameId: old.cartridge.manifest.game_id,
    title: pe.title, actualPeVersion: pe.version, embeddedGameVersion: old.cartridge.manifest.version,
    portable: desc(oldPortable.path), installer: desc(oldInstaller.path), collectedStatus: old.status,
    collectorFailure: "Preserved exact known collector failure; independently audited native build and actual prior installation",
    input: old.input, releaseIdentity: old.nativeResult.result.releaseIdentity };
  assert.equal(sha(old.input.path), old.input.sha256);
  r.checks.push({ name: "Retained actual Editor 1.9.16 Windows package and actual payload PE", status: "PASS" });
  const currentFile = path.join(winRoot, "editor-03/report.json"), current = load(currentFile);
  require("./installed-windows-native-ui-current-audit.cjs").validate(current);
  const currentManifest = read(path.join(path.dirname(current.windowsPortable.path), "embedded-cartridge/manifest.json"));
  r.windowsCurrent = { editorVersion: "1.9.22", gameId: currentManifest.game_id, title: currentManifest.title,
    version: currentManifest.version, installer: desc(current.windowsInstaller.path) };
  assert.notEqual(r.windowsOld.gameId, r.windowsCurrent.gameId);
  r.directCurrentWindowsUpgrade = { status: "INAPPLICABLE_DIFFERENT_GAME_ID",
    reason: "Both builds are real, but the new native-publishing fixture belongs to a different game. It cannot prove same-game preservation.",
    next: "Use the retained old isolated project identity in a genuine new 1.9.22 normal-UI build, with increasing game version and observable changed content." };
  r.checks.push({ name: "Different-game current package is rejected as an upgrade candidate", status: "PASS" });
  const androidRoot = "F:/AgentVN/QA/Android-Package-20261021-01";
  const android = load(path.join(androidRoot, "editor-10/report.json"));
  assert.equal(android.status, "PASS"); assert.equal(android.version, "1.9.19");
  assert.equal(android.builds, 1); assert.equal(android.modelRequests, 0);
  const apk = android.artifacts.find(a => a.kind === "android_apk_signed"); assert(apk);
  assert.equal(sha(apk.path), apk.sha256);
  const metadata = load(apk.path + ".acceptance.json");
  assert.equal(verifyProvenance(apk.path, metadata).status, "PASS");
  assert.equal(metadata.editorVersion, android.version);
  assert.equal(metadata.runId, android.buildRequest.runId);
  assert.equal(metadata.packageName, android.buildRequest.releaseIdentity.androidApplicationId);
  assert(metadata.isElevated && metadata.symlinkProbe.isElevated && metadata.symlinkProbe.success);
  const toolchain = "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain";
  const java = path.join(toolchain, "jdk-17/bin/java.exe");
  const signer = path.join(toolchain, "Sdk/build-tools/35.0.0/lib/apksigner.jar");
  const aapt = path.join(toolchain, "Sdk/build-tools/35.0.0/aapt2.exe");
  const signature = command(java, ["-jar", signer, "verify", "--verbose", "--print-certs", apk.path], "old-apk-signature");
  const badging = command(aapt, ["dump", "badging", apk.path], "old-apk-manifest");
  assert(signature.includes("Verifies"));
  const digest = signature.match(/Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})/i)?.[1];
  assert(digest, "Actual public signer digest required");
  const identity = badging.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/);
  assert(identity); assert.equal(identity[1], metadata.packageName);
  assert.equal(Number(identity[2]), android.buildRequest.releaseIdentity.versionCode);
  assert.equal(identity[3], metadata.gameVersion);
  r.androidOld = { editorVersion: metadata.editorVersion, engineVersion: metadata.engineVersion,
    packageName: identity[1], versionCode: Number(identity[2]), versionName: identity[3],
    gameId: android.cartridge.manifest.game_id, title: android.cartridge.manifest.title,
    signerSha256: digest.toLowerCase(), apk: desc(apk.path), input: android.input,
    protocolVersion: metadata.runtimeProtocolVersion, trustedBuildRunId: metadata.runId };
  assert.equal(sha(android.input.path), android.input.sha256);
  assert.equal(sha(apk.path), apk.sha256, "Static tools must not alter the source APK");
  r.sources.push(...[java, signer, aapt].map(desc));
  r.checks.push({ name: "Retained signed Editor 1.9.19 Android build verified by actual apksigner and aapt2", status: "PASS" });
  r.androidCurrent = { status: "NOT_BUILT_1_9_22",
    requiredIdentity: { gameId: r.androidOld.gameId, packageName: r.androidOld.packageName,
      signerSha256: r.androidOld.signerSha256, versionCodeGreaterThan: r.androidOld.versionCode },
    normalNativePicker: "NOT_RUN_FOR_CURRENT_ANDROID",
    administratorAndSymlinkGate: "MUST_BE_FRESH_FOR_THIS_NEW_BUILD" };
  for (const f of r.sources.filter(f => f.path.endsWith(".json"))) assert.equal(sha(f.path), f.sha256);
  r.status = "PASS"; // Only static sample verification; no upgrade PASS.
} catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
r.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
console.log(JSON.stringify(r, null, 2));
