"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: { contents: 'export * from "./editor/src/assistant/projectAssetAuthorization";', loader: "ts", resolveDir: root },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
});
const mod = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(mod, mod.exports, requireEditor);
const { projectCreationAssetMime, readProjectCreationAssetAuthorization } = mod.exports;
const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l8sAAAAASUVORK5CYII=", "base64"));
const chosen = { asset_id: "private-id", asset_type: "ui", metadata: { filename: "C:\\私有\\图标.png",
  mime_type: "image/png", bytes, prompt: "private-prompt", source: "generated" } };
async function main() {
  const result = await readProjectCreationAssetAuthorization([chosen, { ...chosen, asset_id: "unselected" }], [chosen.asset_id]);
  assert.deepEqual(result.context, [{ id: "project-asset-1", filename: "图标.png", mime_type: "image/png" }]);
  assert.deepEqual(result.assets[0].bytes, bytes);
  assert.notEqual(result.assets[0].bytes, bytes);
  assert(!JSON.stringify(result.context).includes("private"));
  assert.equal(projectCreationAssetMime({ ...chosen, metadata: { filename: "图片.jpeg" } }), "image/jpeg");
  assert.equal(projectCreationAssetMime({ ...chosen, metadata: { mime_type: "image/svg+xml" } }), undefined);
  assert.equal(projectCreationAssetMime({ ...chosen, metadata: { ...chosen.metadata, placeholder: true } }), undefined);
  for (const ids of [["missing"], [chosen.asset_id, chosen.asset_id], Array.from({ length: 17 }, (_, index) => String(index))]) {
    await assert.rejects(readProjectCreationAssetAuthorization([chosen], ids));
  }
  await assert.rejects(readProjectCreationAssetAuthorization([chosen, chosen], [chosen.asset_id]), /编号重复/);
  await assert.rejects(readProjectCreationAssetAuthorization([{ ...chosen, metadata: { ...chosen.metadata, bytes: new Uint8Array([1, 2]) } }], [chosen.asset_id]), /格式不一致/);
  await assert.rejects(readProjectCreationAssetAuthorization([{ ...chosen, metadata: { ...chosen.metadata, size_bytes: 9 * 1024 * 1024 } }], [chosen.asset_id]), /8 MiB/);
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async url => { calls.push(url); return new Response("", { status: 404 }); };
  try {
    await assert.rejects(readProjectCreationAssetAuthorization([{ ...chosen, metadata: { filename: "图片.png",
      mime_type: "image/png", url: "http://private-source.test/token" } }], [chosen.asset_id]), error => {
      assert(!error.message.includes("private-source") && !error.message.includes("private-id"));
      return /读取失败/.test(error.message);
    });
    assert.equal(calls.length, 1);
  } finally { global.fetch = originalFetch; }
  const many = Array.from({ length: 5 }, (_, index) => {
    const large = new Uint8Array(7 * 1024 * 1024); large.set(bytes);
    return { ...chosen, asset_id: `image-${index}`, metadata: { ...chosen.metadata, bytes: large } };
  });
  await assert.rejects(readProjectCreationAssetAuthorization(many, many.map(asset => asset.asset_id)), /32 MiB/);
  console.log("PASS project image explicit selection, private aliases, independent bytes, missing/duplicate/unsupported/oversize/source failures");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
