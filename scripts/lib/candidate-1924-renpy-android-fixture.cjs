"use strict";
// QA fixture only: read the final installed-author database, not its initial
// input or a reconstructed approximation of the GUI. Never write that source.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const base = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-57";
const sourceFiles = {
  report: { path: path.join(base, "report.json"), sha256: "52d8e4e4f623d459f4157a78fa91ca325d6d450a3369b839c8fff9ccab49004a" },
  database: { path: path.join(base, "data/backend/vn_engine.db"), sha256: "793634bcb18669ed9ffc3c5bb867f35ba14091c76e542ef325318ccfdf482dc6" },
};
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const describe = file => ({ path: path.resolve(file), sha256: hash(fs.readFileSync(file)),
  bytes: fs.statSync(file).size, generatedAt: fs.statSync(file).mtime.toISOString() });
function verifiedBytes(file) {
  const bytes = fs.readFileSync(file.path);
  assert.equal(hash(bytes), file.sha256, `Source drift: ${file.path}`);
  return bytes;
}
function sourceProject() {
  const report = JSON.parse(verifiedBytes(sourceFiles.report));
  verifiedBytes(sourceFiles.database);
  assert.equal(report.status, "EDITOR_PASS_NATIVE_PLAYER_NOT_RUN");
  assert.equal(report.steps.length, 8);
  assert(report.steps.every(step => step.status === "PASS"));
  verifiedBytes(report.cartridge);
  const db = new DatabaseSync(sourceFiles.database.path, { readOnly: true });
  let project;
  try {
    const rows = db.prepare("SELECT project_id, project_json FROM editor_project_details").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].project_id, "installed-gui-library-1924-57");
    project = JSON.parse(rows[0].project_json);
  } finally { db.close(); }
  // Closing a read-only connection must not change the evidence database.
  verifiedBytes(sourceFiles.database);
  assert.equal(project.project_id, report.savedProject.projectId);
  const withoutSessionPort = asset => {
    const copy = structuredClone(asset);
    const url = new URL(copy.metadata.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.protocol, "http:");
    assert.equal(url.pathname, "/api/project/assets/" + copy.metadata.backend_asset_path);
    copy.metadata.url = url.pathname;
    return copy;
  };
  assert.deepEqual(project.asset_manifest.map(withoutSessionPort),
    report.savedProject.assetManifest.map(withoutSessionPort));
  assert.deepEqual(project.editor_settings, report.savedProject.settings);
  assert.equal(project.editor_settings.runtimeUILayoutProfiles.activeType, "renpy");
  assert.equal(project.asset_manifest.length, 26);
  assert.equal(report.assetProofs.length, 26);
  assert.equal(report.cartridge.assets.length, 7);
  return { project, report };
}
function transportFree(asset) {
  const result = structuredClone(asset);
  for (const key of ["filePath", "url", "backend_asset_path", "data_url", "blob_url"])
    delete result.metadata[key];
  return result;
}
function validateFixture(result, original) {
  assert.equal(result.applicationId, "com.agentvn.qa.renpygui20261025");
  assert.equal(result.gameVersion, "0.1.0");
  assert.equal(result.versionCode, 1000);
  const project = structuredClone(result.project);
  assert.equal(project.asset_manifest.length, original.project.asset_manifest.length);
  for (let i = 0; i < project.asset_manifest.length; i++) {
    const asset = project.asset_manifest[i], previous = original.project.asset_manifest[i];
    const proof = original.report.assetProofs.find(row => row.id === asset.asset_id);
    assert(proof, `Unknown asset: ${asset.asset_id}`);
    assert.deepEqual(transportFree(asset), transportFree(previous));
    for (const key of ["filePath", "url", "backend_asset_path", "blob_url"])
      assert.equal(asset.metadata[key], undefined, `Stale transport: ${key}`);
    assert.equal(typeof asset.metadata.data_url, "string");
    const prefix = `data:${previous.metadata.mime_type};base64,`;
    assert(asset.metadata.data_url.startsWith(prefix));
    const payload = asset.metadata.data_url.slice(prefix.length), bytes = Buffer.from(payload, "base64");
    assert.equal(bytes.toString("base64"), payload, "Canonical base64 required");
    assert.equal(bytes.length, proof.bytes);
    assert.equal(hash(bytes), proof.sha256, proof.id);
    project.asset_manifest[i] = previous;
  }
  assert.deepEqual(project, original.project, "Only asset transport can change");
  assert.deepEqual(result.source, sourceFiles.report);
  return true;
}
function renpyAndroidFixture() {
  const original = sourceProject(), project = structuredClone(original.project), assets = [];
  const boundary = path.resolve(base, "data/backend/project_assets") + path.sep;
  for (const asset of project.asset_manifest) {
    const proof = original.report.assetProofs.find(row => row.id === asset.asset_id);
    assert(proof);
    const file = path.resolve(asset.metadata.filePath);
    assert(file.startsWith(boundary), "Asset must belong to this isolated source project");
    const physical = fs.realpathSync.native(file);
    assert(physical.startsWith(boundary), "Asset link escaped the source project");
    const bytes = verifiedBytes({ path: file, sha256: proof.sha256 });
    assert.equal(bytes.length, proof.bytes);
    assets.push({ id: asset.asset_id, ...describe(file), archiveSource: proof.source });
    const clean = transportFree(asset);
    asset.metadata = { ...clean.metadata,
      data_url: `data:${clean.metadata.mime_type};base64,${bytes.toString("base64")}` };
  }
  const result = { project, gameVersion: "0.1.0", versionCode: 1000,
    applicationId: "com.agentvn.qa.renpygui20261025", source: { ...sourceFiles.report } };
  validateFixture(result, original);
  return { ...result, provenance: { scope: "READ_ONLY_FINAL_INSTALLED_GUI_PROJECT_TRANSPORT_REPACK",
    sources: Object.values(sourceFiles).map(file => describe(file.path)),
    priorCartridge: original.report.cartridge, assets,
    graphUnchanged: true, layoutsUnchanged: true, sourceDatabaseUnchanged: true,
    boundaries: { newAuthoring: false, androidBuild: false, androidDevice: false, nativePicker: false } } };
}
function selfTest() {
  const result = renpyAndroidFixture(), original = sourceProject();
  const mutations = [
    r => { r.applicationId += ".other"; },
    r => { r.gameVersion = "0.1.2"; },
    r => { r.versionCode = 1002; },
    r => { r.source.sha256 = "0".repeat(64); },
    r => { r.project.asset_manifest.pop(); },
    r => { r.project.asset_manifest[0].asset_id += "_wrong"; },
    r => { r.project.asset_manifest[0].metadata.filePath = "C:/unrelated.ttf"; },
    r => { r.project.asset_manifest[0].metadata.url = "http://127.0.0.1:52444/stale"; },
    r => { r.project.asset_manifest[0].metadata.data_url = "data:font/ttf;base64,AAAA"; },
    r => { r.project.asset_manifest[0].metadata.filename = "wrong.ttf"; },
    r => { r.project.nodes[1].data.scene.commands.pop(); },
    r => { r.project.editor_settings.runtimeUILayoutProfiles.activeType = "agentvn"; },
    r => { r.project.editor_settings.runtimeUILayout.screens.pop(); },
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(result); mutate(bad);
    assert.throws(() => validateFixture(bad, original));
  }
  return { status: "PASS", negativeCases: mutations.length, assets: result.provenance.assets.length,
    actualPriorExportAssets: result.provenance.priorCartridge.assets.length,
    sourceDatabaseUnchanged: true, productLaunches: 0, apkBuilds: 0, modelRequests: 0 };
}
module.exports = { renpyAndroidFixture, validateFixture, selfTest };
if (require.main === module) {
  assert.equal(process.argv[2], "--self-test");
  console.log(JSON.stringify(selfTest()));
}
