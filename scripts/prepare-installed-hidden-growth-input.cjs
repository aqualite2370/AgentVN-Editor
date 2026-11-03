const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const JSZip = require("../editor/node_modules/jszip");
const { loadProjectContainerSync, isSafeProjectPath } = require("./project-container.cjs");
async function main() {
const root = path.resolve(__dirname, "..");
assert.ok(process.argv[2], "explicit new input directory required");
const directory = path.resolve(process.argv[2]);
assert.ok(!fs.existsSync(directory), "never overwrite previous evidence");
fs.mkdirSync(directory, { recursive: true });
const source = path.join(root, "data/backup-timeline/project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sourceHash = hash(source);
assert.equal(sourceHash, "e1c43983ae8b7488c080c55889727d38915602596d873180e6062fff5a3df250");
const project = loadProjectContainerSync(source).project;
const graph = JSON.stringify({ nodes: project.nodes, edges: project.edges });
const assets = [];
const integrity = [];
const zip = new JSZip();
for (const asset of project.asset_manifest) {
  const metadata = asset.metadata;
  const sourceAsset = [metadata.filePath, metadata.backend_asset_path &&
    path.join(root, "data/backend/project_assets", metadata.backend_asset_path)]
    .filter(Boolean).find(candidate => fs.existsSync(candidate));
  assert.ok(sourceAsset, `missing project asset: ${asset.asset_id}`);
  const absolute = path.resolve(sourceAsset);
  assert.ok(absolute.toLowerCase().startsWith(`${path.resolve(root, "data").toLowerCase()}${path.sep}`),
    `asset outside authorized project data: ${absolute}`);
  const sha256 = hash(absolute);
  if (metadata.hash_sha256) assert.equal(sha256, metadata.hash_sha256);
  assert.ok(isSafeProjectPath(metadata.project_path) && metadata.project_path.startsWith("assets/"));
  zip.file(metadata.project_path, fs.createReadStream(absolute), { compression: "STORE" });
  metadata.path = metadata.project_path;
  metadata.size_bytes = fs.statSync(absolute).size;
  metadata.hash_sha256 = sha256;
  for (const field of ["data_url", "blob_url", "filePath", "url", "backend_asset_path"]) delete metadata[field];
  integrity.push({ path: metadata.project_path, sizeBytes: metadata.size_bytes, hashSha256: sha256 });
  assets.push({ assetId: asset.asset_id, source: absolute, sha256, bytes: fs.statSync(absolute).size });
}
const output = path.join(directory, "隐忍的成长.vnproj");
// Stream the same canonical format, avoiding a second 500+ MiB in-memory copy.
const projectText = `${JSON.stringify(project, null, 2)}\n`;
zip.file("project.json", projectText, { compression: "DEFLATE" });
zip.file("format.json", JSON.stringify({
  format: "agentvn-vnproj-zip", version: 1, updatedAt: new Date().toISOString(),
  assetCount: assets.length, totalAssetBytes: integrity.reduce((sum, item) => sum + item.sizeBytes, 0),
  projectHashSha256: crypto.createHash("sha256").update(projectText).digest("hex"), assets: integrity,
}), { compression: "DEFLATE" });
await pipeline(zip.generateNodeStream({ type: "nodebuffer", streamFiles: true }), fs.createWriteStream(output, { flags: "wx" }));
const packaged = loadProjectContainerSync(output).project;
assert.equal(JSON.stringify({ nodes: packaged.nodes, edges: packaged.edges }), graph);
assert.equal(hash(source), sourceHash);
const report = { source, sourceSha256: sourceHash, sourcePreserved: true, output,
  outputSha256: hash(output), generatedAt: new Date().toISOString(),
  graphPreserved: true, assets };
fs.writeFileSync(path.join(directory, "input-provenance.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, assets: assets.length }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
