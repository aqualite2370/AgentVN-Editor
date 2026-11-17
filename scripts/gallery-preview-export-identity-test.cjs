"use strict";
// Exercise regenerated editor artifacts rather than assuming the same cartridge
// will be reused on the next preview launch.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync } = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Gallery-Preview-") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "REAL_EDITOR_EXPORTERS_IDENTITY_NOT_UI_AUTHORING",
  cases: [], models: 0, productLaunches: 0 };
const m = { exports: {} };
try {
  const built = buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
    export {exportEditorCartridge,exportEditorPreviewDirectory,createEditorLivePreviewData}
      from "./editor/src/cartridge/exportCartridge";
    export {galleryStorageId} from "./GameCli_framework/src/engine/galleryAnchorManager";
  ` }, bundle: true, platform: "node", format: "cjs", write: false,
    define: { "import.meta.env": "{}" }, nodePaths: [path.join(root, "editor/node_modules"),
      path.join(root, "GameCli_framework/node_modules")] });
  new Function("module", "exports", "require", built.outputFiles[0].text)(m, m.exports, require);
} catch (e) { report.status = "FAILED"; report.error = e.stack; }
(async () => {
  assert.equal(report.status, "RUNNING", report.error);
  // The external launcher overwrites script.game_id with projectId; live preview
  // also supplies gameId. Neither path derives identity from the mutable title.
  const external = fs.readFileSync(path.join(root, "editor/src/components/advanced/PreviewWindowControls.tsx"), "utf8");
  const live = fs.readFileSync(path.join(root, "editor/src/components/editor/PreviewPanel.tsx"), "utf8");
  assert.match(external, /game_id:\s*project\.projectId/);
  assert.match(live, /gameId:\s*currentProject\.projectId/);
  for (const projectId of ["37fc5325-58cb-4d81-a413-173d0706cd32", "c2c865c8-8c71-42a9-8cea-562416ee1a27"]) {
    const row = { projectId, status: "RUNNING", artifacts: [] }; report.cases.push(row);
    for (const revision of [1, 2]) {
      const input = {
        script: { schema_version: "1.0.0", game_id: projectId, title: "原始标题", entry_scene_id: "scene",
          scenes: [{ scene_id: "scene", title: "场景", summary: "", chapter: 1, tags: [],
            commands: [{ type: "narration", text: "预览第" + revision + "版" }] }] },
        title: revision === 1 ? "首次试玩" : "改名后重新生成", author: "QA", version: "0.1.0-preview",
        language: "zh-CN", description: "", includeGallery: true, includeMetadata: true,
        projectAssets: [], projectAssetRefs: [],
      };
      const directory = await m.exports.exportEditorPreviewDirectory(input);
      const packed = await m.exports.exportEditorCartridge(input);
      const liveData = await m.exports.createEditorLivePreviewData({ ...input, gameId: projectId });
      const script = JSON.parse(directory.textFiles.find(f => f.path === "script.json").contents);
      for (const artifact of [directory.manifest, packed.manifest, liveData.manifest, liveData.script, script])
        assert.equal(artifact.game_id, projectId);
      assert.equal(script.scenes[0].commands[0].text, input.script.scenes[0].commands[0].text);
      const storageId = await m.exports.galleryStorageId({ install_id: "preview_gamecli", game_id: script.game_id });
      assert.match(storageId, /^preview_gallery_[a-f0-9]{64}$/);
      row.artifacts.push({ revision, gameId: script.game_id, storageId, packedBytes: packed.blob.size });
    }
    assert.equal(row.artifacts[0].storageId, row.artifacts[1].storageId);
    row.status = "PASS";
  }
  assert.notEqual(report.cases[0].artifacts[0].storageId, report.cases[1].artifacts[0].storageId);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = e.stack; process.exitCode = 1; })
  .finally(() => {
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report));
  });
