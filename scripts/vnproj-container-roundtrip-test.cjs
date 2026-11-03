#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const JSZip = require("../editor/node_modules/jszip");
const {
  ZIP_MAGIC,
  loadProjectContainer,
  loadProjectContainerSync,
  saveProjectContainerSync,
  readZipEntrySync,
} = require("./project-container.cjs");

function projectWithAsset(bytes, projectPath = "assets/中文素材/隐忍的成长.txt") {
  const now = "2026-08-11T00:00:00.000Z";
  return {
    schema_version: "1.0.0",
    project_id: "unicode_roundtrip",
    title: "隐忍的成长",
    author: "中文作者",
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: [{
      asset_id: "素材_隐忍的成长",
      asset_type: "other",
      metadata: {
        filename: "隐忍的成长.txt",
        mime_type: "text/plain",
        project_path: projectPath,
        data_url: `data:text/plain;base64,${bytes.toString("base64")}`,
      },
    }],
    editor_settings: {},
    created_at: now,
    updated_at: now,
  };
}

async function main() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-vnproj-container-"));
  try {
    const assetBytes = Buffer.from("隐忍的成长：中文素材往返一致。", "utf8");
    const zipPath = path.join(fixtureRoot, "中文工程.vnproj");
    saveProjectContainerSync(zipPath, projectWithAsset(assetBytes), { container: "zip" });
    assert.deepEqual(fs.readFileSync(zipPath).subarray(0, 4), ZIP_MAGIC);

    const syncLoaded = loadProjectContainerSync(zipPath);
    assert.deepEqual(readZipEntrySync(zipPath, "assets/中文素材/隐忍的成长.txt"), assetBytes);
    assert.deepEqual(JSON.parse(readZipEntrySync(zipPath, "project.json").toString("utf8")), syncLoaded.project);
    assert.throws(() => readZipEntrySync(zipPath, "ui/missing.json"), /missing ui\/missing.json/);
    assert.equal(syncLoaded.container, "zip");
    assert.equal(syncLoaded.project.title, "隐忍的成长");
    const metadata = syncLoaded.project.asset_manifest[0].metadata;
    assert.equal(metadata.project_path, "assets/中文素材/隐忍的成长.txt");
    assert.equal(metadata.size_bytes, assetBytes.length);
    assert.equal(metadata.hash_sha256, crypto.createHash("sha256").update(assetBytes).digest("hex"));
    for (const forbidden of ["data_url", "blob_url", "filePath", "url", "backend_asset_path"]) {
      assert.equal(metadata[forbidden], undefined);
    }

    const asyncLoaded = await loadProjectContainer(zipPath);
    assert.equal(await asyncLoaded.zip.file(metadata.project_path).async("string"), assetBytes.toString("utf8"));
    assert.ok(asyncLoaded.zip.file("format.json"));

    const legacyPath = path.join(fixtureRoot, "legacy.vnproj");
    fs.writeFileSync(legacyPath, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(JSON.stringify({ ...projectWithAsset(assetBytes), asset_manifest: [] }), "utf8"),
    ]));
    assert.equal(loadProjectContainerSync(legacyPath).container, "json");

    const missingProjectPath = path.join(fixtureRoot, "missing-project.vnproj");
    const missingProjectZip = new JSZip();
    missingProjectZip.file("format.json", "{}");
    fs.writeFileSync(missingProjectPath, await missingProjectZip.generateAsync({ type: "nodebuffer" }));
    await assert.rejects(loadProjectContainer(missingProjectPath), /PROJECT_CONTAINER_INVALID/);

    const invalidPath = path.join(fixtureRoot, "invalid.vnproj");
    fs.writeFileSync(invalidPath, Buffer.from([0xff, 0xfe, 0x00, 0x00]));
    assert.throws(() => loadProjectContainerSync(invalidPath), /PROJECT_CONTAINER_INVALID/);

    const unsafePath = path.join(fixtureRoot, "unsafe.vnproj");
    assert.throws(
      () => saveProjectContainerSync(
        unsafePath,
        projectWithAsset(assetBytes, "../escape.txt"),
        { container: "zip", silent: true },
      ),
      /Command failed/,
    );
  } finally {
    const resolved = path.resolve(fixtureRoot);
    const tempRoot = path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(`${tempRoot}${path.sep}`));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log("vnproj ZIP/legacy JSON Unicode round-trip passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
