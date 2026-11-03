#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const cartridge = path.join(root, "output", "hidden-growth", "hidden-growth.vncart");
const outputDir = path.join(root, "output", "hidden-growth", "android");
const diagnosticsDir = path.join(outputDir, "diagnostics");
const iconPath = path.join(root, "data", "backend", "project_assets", "project_msiz08p7_0_89ebc8a8cb", "ui", "asset-352617a1330feea8.png");
const unpacked = path.join(root, "output", "hidden-growth", "unpacked");
const sourceLayoutPath = path.join(unpacked, "ui", "layout.json");
const sourceManifestPath = path.join(unpacked, "manifest.json");
const runId = crypto.randomUUID();

function assert(condition, message) { if (!condition) throw new Error(message); }
function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

assert(fs.existsSync(cartridge), `hidden-growth cartridge missing: ${cartridge}`);
assert(fs.existsSync(sourceLayoutPath), `hidden-growth layout missing: ${sourceLayoutPath}`);
assert(fs.existsSync(sourceManifestPath), `hidden-growth manifest missing: ${sourceManifestPath}`);
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(diagnosticsDir, { recursive: true });
const releaseIdentity = JSON.stringify({
  schemaVersion: 1,
  title: "隐忍的成长",
  gameId: "project_msiz08p7_0_89ebc8a8cb",
  versionName: "0.1.0",
  versionCode: 1,
  androidApplicationId: "com.agentvn.hidden.growth",
});
const args = [
  path.join(root, "scripts", "build-runtime-standalone-android.cjs"),
  "--OutputDir", outputDir,
  "--DiagnosticsDir", diagnosticsDir,
  "--CartridgePath", cartridge,
  "--ReleaseIdentity", `base64:${Buffer.from(releaseIdentity, "utf8").toString("base64")}`,
  "--IconSource", "project",
  "--RunId", runId,
];
if (fs.existsSync(iconPath)) args.push("--IconPath", iconPath);
const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", stdio: "inherit", windowsHide: true });
if (result.status !== 0) process.exit(result.status || 1);
const manifestPath = path.join(diagnosticsDir, "package-build-manifest.json");
assert(fs.existsSync(manifestPath), `Android manifest missing: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
assert(manifest.status === "PASS", `Android build status was ${manifest.status}`);
assert(manifest.runId === runId, `Android build runId mismatch: expected ${runId}, received ${manifest.runId}`);
assert(manifest.iconSource === "project", "Android build did not use project icon");
assert(manifest.releaseIdentity?.title === "隐忍的成长", "Android release title mismatch");
const sourceHashes = {
  cartridge: sha256(cartridge),
  manifest: sha256(sourceManifestPath),
  layout: sha256(sourceLayoutPath),
};
manifest.sourceArtifacts = {
  ...sourceHashes,
  cartridgeBytes: fs.statSync(cartridge).size,
  layoutBytes: fs.statSync(sourceLayoutPath).size,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`hidden-growth-android-acceptance: PASS (${manifestPath})`);
