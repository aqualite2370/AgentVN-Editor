"use strict";
// An export-only audit cannot promote a blocked native picker, APK or device.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const { renpyAndroidFixture } = require("./lib/candidate-1924-renpy-android-fixture.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = "F:/AgentVN/QA/Android-Package-20261021-01";
const source = path.join(root, "editor-18/report.json");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: hash(fs.readFileSync(file)),
  bytes: fs.statSync(file).size, generatedAt: fs.statSync(file).mtime.toISOString() });
function verify(file) {
  const bytes = fs.readFileSync(file.path);
  assert.equal(hash(bytes), file.sha256, file.path);
  if (file.bytes !== undefined) assert.equal(bytes.length, file.bytes);
  return bytes;
}
function validateExportReceipt(report) {
  assert.equal(report.version, "1.9.24");
  assert.equal(report.modelRequests, 0);
  assert.equal(report.productChanges, 0);
  assert.equal(report.builds, 0, "This audit is only for the blocked-before-build case");
  assert.equal(report.steps[0].status, "PASS");
  assert.equal(report.steps[1].status, "PASS");
  assert.equal(report.fixtureProvenance.assets.length, 26);
  assert.equal(report.exportedAssetProofs.length, 7);
  assert.equal(report.cartridge.manifest.game_id, "installed-gui-library-1924-57");
  assert.equal(report.cartridge.layoutSha256, "05dcb7df2e58d4011aeb823e4abcece0cbc1b31f4f74de41ae14cadb9831d769");
  assert.equal(report.administratorLaunch.token.elevated, true);
  assert.equal(report.administratorLaunch.probe.isElevated, true);
  assert.equal(report.administratorLaunch.probe.success, true);
  assert.equal(report.normalUIExportStatus, "NOT_RUN_NATIVE_PICKER");
  assert.equal(report.androidDeviceStatus, "NOT_RUN");
  assert.equal(report.artifacts, undefined);
}
async function inspectExport(report) {
  validateExportReceipt(report);
  const fixture = renpyAndroidFixture();
  assert.deepEqual(JSON.parse(verify(report.input)), fixture.project);
  const actual = await JSZip.loadAsync(verify(report.cartridge), { checkCRC32: true });
  const previous = await JSZip.loadAsync(verify(fixture.provenance.priorCartridge), { checkCRC32: true });
  assert.equal(hash(await actual.file("ui/layout.json").async("nodebuffer")), report.cartridge.layoutSha256);
  assert.deepEqual(await actual.file("script.json").async("nodebuffer"),
    await previous.file("script.json").async("nodebuffer"));
  const manifest = JSON.parse(await actual.file("manifest.json").async("string"));
  assert.deepEqual(manifest, report.cartridge.manifest);
  assert.equal(manifest.assets.length, 7);
  const assetIds = new Set(), paths = new Set(), assets = [];
  for (const asset of manifest.assets) {
    assert(!assetIds.has(asset.asset_id)); assetIds.add(asset.asset_id);
    assert(!paths.has(asset.path)); paths.add(asset.path);
    const proof = fixture.provenance.priorCartridge.assets.find(row => row.id === asset.asset_id);
    assert(proof); assert.equal(asset.path, proof.path);
    const bytes = await actual.file(asset.path).async("nodebuffer");
    assert.equal(hash(bytes), proof.sha256, asset.asset_id);
    assert.equal(bytes.length, proof.bytes);
    assets.push({ id: asset.asset_id, path: asset.path, sha256: hash(bytes), bytes: bytes.length });
  }
  for (const file of [report.installation, ...report.tools, ...report.fixtureProvenance.sources])
    verify(file);
  const installation = read(report.installation.path);
  assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, "1.9.24");
  for (const file of [installation.package, installation.executable, ...installation.resources])
    verify(file);
  return { assets, layoutSha256: report.cartridge.layoutSha256,
    scriptSha256: hash(await actual.file("script.json").async("nodebuffer")),
    installation: desc(report.installation.path), sourceReport: desc(source) };
}
async function main() {
  const report = read(source);
  if (process.argv[2] === "--self-test") {
    validateExportReceipt(report);
    const mutations = [
      r => { r.version = "1.9.22"; },
      r => { r.builds = 1; },
      r => { r.modelRequests = 1; },
      r => { r.steps[1].status = "FAILED"; },
      r => { r.fixtureProvenance.assets.pop(); },
      r => { r.exportedAssetProofs.pop(); },
      r => { r.cartridge.layoutSha256 = "0".repeat(64); },
      r => { r.cartridge.manifest.game_id = "another"; },
      r => { r.administratorLaunch.token.elevated = false; },
      r => { r.administratorLaunch.probe.success = false; },
      r => { r.normalUIExportStatus = "PASS_NATIVE_UI"; },
      r => { r.androidDeviceStatus = "PASS"; },
      r => { r.artifacts = [{ kind: "android_apk" }]; },
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(report); mutate(bad);
      assert.throws(() => validateExportReceipt(bad));
    }
    await inspectExport(report);
    console.log(JSON.stringify({ status: "PASS", invalidReceiptsRejected: mutations.length,
      actualExportAssets: 7, productLaunches: 0, deviceOperations: 0 }));
    return;
  }
  assert.deepEqual(process.argv.slice(2), ["01"]);
  const out = path.join(root, "renpy-export-18-audit-01");
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const audit = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "ACTUAL_INSTALLED_RENPY_EXPORT_ONLY_NATIVE_PICKER_BLOCKED_APK_NOT_RUN",
    tool: desc(__filename), groups: [] };
  try {
    assert(report.finishedAt, "Wait for the same original controller's finally");
    assert.equal(report.status, "FAILED");
    assert.match(report.error, /Native android-output-select input not completed/);
    assert.equal(report.steps[2].status, "FAILED");
    assert.equal(report.steps.length, 3);
    assert.equal(report.cleanupError, undefined);
    assert.equal(report.protectedUnchanged, true);
    audit.export = await inspectExport(report);
    audit.groups.push({ name: "Installed final GUI input and real UI export bytes", status: "PASS" });
    const restoration = read(path.join(root, "editor-18/cache-restoration.json"));
    assert.equal(restoration.status, "PASS");
    const admin = read(path.join(root, "administrator-18/result.json"));
    assert(admin.finishedAt); assert.equal(admin.policyRestoration, "PASS");
    assert.equal(admin.physicalProtectionRestoration, "PASS");
    const task = read(path.join(root, "administrator-18/task-engine.json"));
    assert(task.finishedAt); assert.equal(task.cleanup, "PASS");
    audit.groups.push({ name: "Physical caches, policy and task restoration", status: "PASS" });
    const live = rows();
    for (const p of [...report.knownProcesses, ...report.buildKnownProcesses])
      assert(!live.some(row => row.ProcessId === p.ProcessId && row.Created === p.Created));
    assert.equal(listeners(report.cleanups.flatMap(row => row.ports)).length, 0);
    audit.groups.push({ name: "Owned process identities and ports released", status: "PASS" });
    audit.nativeInput = read(path.join(root, "editor-18/native-input-request.json"));
    assert.equal(audit.nativeInput.ownerPid, report.launches[0].pid);
    assert.equal(fs.existsSync(audit.nativeInput.completion), false);
    audit.groups.push({ name: "No fabricated picker completion or APK", status: "PASS" });
    audit.status = "EXPORT_EVIDENCE_PASS_ANDROID_BLOCKED_NATIVE_INPUT";
    audit.feature = { installedProjectImport: "PASS", installedCartridgeExport: "PASS",
      nativeDirectorySelection: "BLOCKED_COMPUTER_USE_INPUT_NO_EFFECT", apkBuild: "NOT_RUN",
      androidRuntime: "NOT_RUN", fullAcceptance: "NOT_COMPLETE" };
  } catch (error) { audit.status = "FAILED"; audit.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    audit.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(audit, null, 2), { flag: "wx" });
    fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
    console.log(JSON.stringify({ status: audit.status, groups: audit.groups, out, error: audit.error }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
