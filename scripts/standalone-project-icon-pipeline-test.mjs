import assert from "node:assert/strict";

import {
  readStandaloneIconSourceBlob,
  resolveStandaloneIconAsset,
} from "../editor/src/packaging/standaloneIcon.ts";

const appearance = {
  standaloneIconAssetId: "standalone",
  iconAssetId: "shell",
  coverAssetId: "cover",
};
const assets = [
  {
    asset_id: "standalone",
    asset_type: "ui",
    metadata: {
      filename: "白绪之头像.png",
      mime_type: "image/png",
      url: "http://127.0.0.1:8278/unavailable-during-test.png",
      filePath: "D:\\AgentVN\\data\\backend\\project_assets\\hidden-growth\\ui\\portrait.png",
    },
  },
  { asset_id: "shell", asset_type: "ui", metadata: { bytes: new Uint8Array([2]) } },
  { asset_id: "cover", asset_type: "background", metadata: { bytes: new Uint8Array([3]) } },
];

const selection = resolveStandaloneIconAsset(appearance, assets);
assert.equal(selection.assetId, "standalone", "standalone icon must win over shell icon and cover");
assert.equal(selection.asset?.asset_id, "standalone");

const expectedBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
let desktopReadPath;
const source = await readStandaloneIconSourceBlob(selection.asset, {
  fetch: async () => { throw new Error("backend is temporarily unavailable"); },
  readDesktopFile: async (filePath) => {
    desktopReadPath = filePath;
    return expectedBytes;
  },
});

assert.equal(desktopReadPath, assets[0].metadata.filePath, "persisted project filePath must be used as the reliable fallback");
assert.equal(source.blob.type, "image/png");
assert.deepEqual(new Uint8Array(await source.blob.arrayBuffer()), expectedBytes);
assert.equal(source.fileName, "白绪之头像.png");
assert.equal(source.sourceKind, "filePath");

const shellFallback = resolveStandaloneIconAsset({ iconAssetId: "shell", coverAssetId: "cover" }, assets);
assert.equal(shellFallback.assetId, "shell");
const coverFallback = resolveStandaloneIconAsset({ coverAssetId: "cover" }, assets);
assert.equal(coverFallback.assetId, "cover");

const missing = resolveStandaloneIconAsset({ standaloneIconAssetId: "missing" }, assets);
assert.equal(missing.asset, undefined);
assert.equal(missing.assetId, "missing");

console.log("PASS standalone project icon pipeline");
