"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: {
    contents: `
      export { useProjectStore } from "./editor/src/store/projectStore";
      export { stableSerialize } from "./editor/src/utils/stableSerialize";
    `,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(
  loaded, loaded.exports, requireEditor,
);
const { useProjectStore, stableSerialize } = loaded.exports;

useProjectStore.getState().loadProjectMetadata({
  project_id: "creation-merge-store-project",
  title: "创造合并状态测试",
  author: "",
  asset_manifest: [],
});
useProjectStore.getState().setRuntimeUILayoutType("renpy");

const initial = useProjectStore.getState();
const target = initial.settings.runtimeUILayout.screens.find(screen => screen.screen_id === "title");
const expectedScreenSnapshot = stableSerialize(target);
const changedLayout = structuredClone(initial.settings.runtimeUILayout);
changedLayout.screens.find(screen => screen.screen_id === "title").components.push({
  component_id: "assistant-test-component",
  component_type: "custom_component",
  label: "审核组件",
  required: false,
  locked: false,
  visible: true,
  rect: { x: 20, y: 70, width: 30, height: 12 },
  customComponent: {
    schemaVersion: 1,
    root: { tag: "div", className: "root", children: [] },
    styles: {},
  },
});
const addition = {
  asset_id: "assistant-test-image",
  asset_type: "ui",
  metadata: { filename: "徽章.png", mime_type: "image/png", size_bytes: 8, data_url: "data:image/png;base64,test" },
};

const staleSnapshot = useProjectStore.getState().mergeRuntimeUILayoutIfScreenMatches({
  expectedProjectId: initial.projectId,
  expectedLayoutType: "renpy",
  screenId: "title",
  expectedScreenSnapshot: `${expectedScreenSnapshot}stale`,
  runtimeUILayout: changedLayout,
  assetManifest: [addition],
});
assert.equal(staleSnapshot, false, "目标页面基线不匹配时不能写入布局或素材");
assert.equal(useProjectStore.getState().settings.runtimeUILayout.screens
  .find(screen => screen.screen_id === "title").components.some(item => item.component_id === "assistant-test-component"), false);
assert.equal(useProjectStore.getState().assetManifest.length, 0);

const wrongProject = useProjectStore.getState().mergeRuntimeUILayoutIfScreenMatches({
  expectedProjectId: "another-project",
  expectedLayoutType: "renpy",
  screenId: "title",
  expectedScreenSnapshot,
  runtimeUILayout: changedLayout,
  assetManifest: [addition],
});
assert.equal(wrongProject, false, "切换工程后应在 store 边界再次拒绝旧草稿");
assert.equal(useProjectStore.getState().assetManifest.length, 0);

const applied = useProjectStore.getState().mergeRuntimeUILayoutIfScreenMatches({
  expectedProjectId: initial.projectId,
  expectedLayoutType: "renpy",
  screenId: "title",
  expectedScreenSnapshot,
  runtimeUILayout: changedLayout,
  assetManifest: [addition],
});
assert.equal(applied, true);
const after = useProjectStore.getState();
assert.equal(after.settings.runtimeUILayout.screens
  .find(screen => screen.screen_id === "title").components.some(item => item.component_id === "assistant-test-component"), true);
assert.equal(after.assetManifest[0].asset_id, "assistant-test-image",
  "布局和图片依赖必须通过同一次工程 store 更新落盘");
assert.equal(after.settings.runtimeUILayoutProfiles.activeType, "renpy");

const batchBase = useProjectStore.getState();
const titleSnapshot = stableSerialize(batchBase.settings.runtimeUILayout.screens
  .find(screen => screen.screen_id === "title"));
const preferencesSnapshot = stableSerialize(batchBase.settings.runtimeUILayout.screens
  .find(screen => screen.screen_id === "preferences"));
const batchSnapshots = Object.fromEntries(batchBase.settings.runtimeUILayout.screens
  .map(screen => [screen.screen_id, stableSerialize(screen)]));
const batchLayoutSnapshot = stableSerialize(batchBase.settings.runtimeUILayout);
const batchAssetsSnapshot = stableSerialize(batchBase.assetManifest);
const batchLayout = structuredClone(batchBase.settings.runtimeUILayout);
batchLayout.screens.find(screen => screen.screen_id === "title").components.push({
  component_id: "assistant-batch-title",
  component_type: "custom_component",
  label: "批量标题",
  required: false,
  locked: false,
  visible: true,
  rect: { x: 10, y: 80, width: 20, height: 10 },
  customComponent: { schemaVersion: 1, root: { tag: "div", className: "root", children: [] }, styles: {} },
});
batchLayout.screens.find(screen => screen.screen_id === "preferences").components.push({
  component_id: "assistant-batch-preferences",
  component_type: "custom_component",
  label: "批量选项",
  required: false,
  locked: false,
  visible: true,
  rect: { x: 10, y: 80, width: 20, height: 10 },
  customComponent: { schemaVersion: 1, root: { tag: "div", className: "root", children: [] }, styles: {} },
});
const batchAsset = { ...addition, asset_id: "assistant-batch-image" };
const stalePreferences = `${preferencesSnapshot}stale`;
const rejectedBatch = useProjectStore.getState().mergeRuntimeUILayoutIfScreensMatch({
  expectedProjectId: batchBase.projectId,
  expectedLayoutType: "renpy",
  expectedScreenSnapshots: { ...batchSnapshots, preferences: stalePreferences },
  expectedRuntimeUILayoutSnapshot: batchLayoutSnapshot,
  expectedAssetManifestSnapshot: batchAssetsSnapshot,
  runtimeUILayout: batchLayout,
  assetManifest: [addition, batchAsset],
});
assert.equal(rejectedBatch, false, "任一目标页过期时必须原子拒绝整个批量提交");
assert.equal(useProjectStore.getState().settings.runtimeUILayout.screens
  .find(screen => screen.screen_id === "title").components.some(item => item.component_id === "assistant-batch-title"), false,
  "批量冲突不得部分写入其它有效页面");
assert.equal(useProjectStore.getState().assetManifest.length, 1,
  "批量冲突不得写入任何新增素材");

const appliedBatch = useProjectStore.getState().mergeRuntimeUILayoutIfScreensMatch({
  expectedProjectId: batchBase.projectId,
  expectedLayoutType: "renpy",
  expectedScreenSnapshots: batchSnapshots,
  expectedRuntimeUILayoutSnapshot: batchLayoutSnapshot,
  expectedAssetManifestSnapshot: batchAssetsSnapshot,
  runtimeUILayout: batchLayout,
  assetManifest: [addition, batchAsset],
});
assert.equal(appliedBatch, true, "所有目标页基线有效时应一次性提交完整批量结果");
assert.equal(useProjectStore.getState().settings.runtimeUILayout.screens
  .find(screen => screen.screen_id === "title").components.some(item => item.component_id === "assistant-batch-title"), true);
assert.equal(useProjectStore.getState().settings.runtimeUILayout.screens
  .find(screen => screen.screen_id === "preferences").components.some(item => item.component_id === "assistant-batch-preferences"), true);
assert.deepEqual(useProjectStore.getState().assetManifest.map(asset => asset.asset_id),
  ["assistant-test-image", "assistant-batch-image"]);

const committedBatchState = useProjectStore.getState();
const staleCommitSnapshots = Object.fromEntries(committedBatchState.settings.runtimeUILayout.screens
  .map(screen => [screen.screen_id, stableSerialize(screen)]));
const staleWholeLayout = structuredClone(committedBatchState.settings.runtimeUILayout);
staleWholeLayout.screens.find(screen => screen.screen_id === "title").components.push({
  component_id: "assistant-stale-whole-layout",
  component_type: "custom_component",
  label: "过期整布局",
  required: false,
  locked: false,
  visible: true,
  rect: { x: 60, y: 80, width: 10, height: 8 },
  customComponent: { schemaVersion: 1, root: { tag: "div", className: "root", children: [] }, styles: {} },
});
const concurrentlyEditedLayout = structuredClone(committedBatchState.settings.runtimeUILayout);
concurrentlyEditedLayout.screens.find(screen => screen.screen_id === "history").components[0].label += "（已编辑）";
useProjectStore.getState().setRuntimeUILayout(concurrentlyEditedLayout);
const lostUpdateGuard = useProjectStore.getState().mergeRuntimeUILayoutIfScreensMatch({
  expectedProjectId: committedBatchState.projectId,
  expectedLayoutType: "renpy",
  expectedScreenSnapshots: staleCommitSnapshots,
  expectedRuntimeUILayoutSnapshot: stableSerialize(committedBatchState.settings.runtimeUILayout),
  expectedAssetManifestSnapshot: stableSerialize(committedBatchState.assetManifest),
  runtimeUILayout: staleWholeLayout,
  assetManifest: committedBatchState.assetManifest,
});
assert.equal(lostUpdateGuard, false,
  "提交规划后即使非目标页面发生变化，也必须阻止整布局快照覆盖这次修改");
assert.equal(useProjectStore.getState().settings.runtimeUILayout.screens
  .find(screen => screen.screen_id === "history").components[0].label.endsWith("（已编辑）"), true);
assert.equal(useProjectStore.getState().settings.runtimeUILayout.screens
  .find(screen => screen.screen_id === "title").components.some(item => item.component_id === "assistant-stale-whole-layout"), false);
console.log("assistant-creation-project-store-test: PASS");
