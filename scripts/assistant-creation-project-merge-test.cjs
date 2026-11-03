"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: {
    contents: `export {
      captureAssistantCreationLayoutBaseline,
      planAssistantCreationProjectMerge,
      planAssistantCreationProjectMergeBatch,
    } from "./editor/src/assistant/assistantCreationProjectMerge";`,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(
  loaded, loaded.exports, requireEditor,
);

const {
  captureAssistantCreationLayoutBaseline,
  planAssistantCreationProjectMerge,
  planAssistantCreationProjectMergeBatch,
} = loaded.exports;

const layout = {
  layout_type: "renpy",
  ui_layout_version: "2.0.0",
  name: "进阶",
  target_runtime: "0.10.0",
  tokens: {},
  screens: [{
    screen_id: "title",
    components: [{
      component_id: "title_hero",
      component_type: "main_menu_hero",
      required: true,
      rect: { x: 20, y: 20, width: 60, height: 30 },
    }],
  }],
  assets: [],
};
const draft = {
  schemaVersion: 1,
  name: "标题徽章",
  description: "安全合并验证",
  html: '<div class="root"><span>标题</span></div>',
  css: ".root { display: flex; }",
  definition: {
    schemaVersion: 1,
    root: { tag: "div", className: "root", children: [{ tag: "span", text: "标题", children: [] }] },
    styles: { ".root": { display: "flex" } },
  },
  generatedAt: "2026-10-03T00:00:00.000Z",
};
const baseline = captureAssistantCreationLayoutBaseline("project-a", layout);

const changedLayout = structuredClone(layout);
changedLayout.screens[0].components[0].rect.x = 25;
const conflicted = planAssistantCreationProjectMerge({
  currentProjectId: "project-a",
  currentLayout: changedLayout,
  currentAssets: [],
  baseline,
  targetScreenId: "title",
  rect: { x: 30, y: 60, width: 40, height: 16 },
  draft,
  componentId: "assistant-title-badge",
});
assert.equal(conflicted.status, "conflict",
  "审核期间目标页面被编辑后必须阻止合并，不能覆盖或叠加到过期基线上");
assert.match(conflicted.reason, /页面.*变化|基线/);
assert.equal(changedLayout.screens[0].components.length, 1,
  "冲突时不能修改工程布局");

const wrongProject = planAssistantCreationProjectMerge({
  currentProjectId: "project-b",
  currentLayout: layout,
  currentAssets: [],
  baseline,
  targetScreenId: "title",
  rect: { x: 30, y: 60, width: 40, height: 16 },
  draft,
  componentId: "assistant-title-badge",
});
assert.equal(wrongProject.status, "conflict", "草稿只能合并回生成时所属的工程");
assert.match(wrongProject.reason, /工程/);

const merged = planAssistantCreationProjectMerge({
  currentProjectId: "project-a",
  currentLayout: layout,
  currentAssets: [],
  baseline,
  targetScreenId: "title",
  rect: { x: 30, y: 60, width: 40, height: 16 },
  draft,
  componentId: "assistant-title-badge",
});
assert.equal(merged.status, "ready");
assert.equal(merged.layout.screens[0].components.length, 2,
  "通过审核的草稿应作为独立组件添加到选定页面");
assert.equal(merged.assets.length, 0);
assert.equal(layout.screens[0].components.length, 1, "规划阶段不得就地修改工程基线");

const batchLayout = structuredClone(layout);
batchLayout.screens.push({
  screen_id: "preferences",
  components: [{
    component_id: "settings_panel",
    component_type: "settings_group",
    required: true,
    rect: { x: 10, y: 15, width: 80, height: 70 },
  }],
});
const batchBaseline = captureAssistantCreationLayoutBaseline("project-a", batchLayout);
const batchDraft = (name) => ({ ...draft, name });
const batch = planAssistantCreationProjectMergeBatch({
  currentProjectId: "project-a",
  currentLayout: batchLayout,
  currentAssets: [],
  baseline: batchBaseline,
  items: [
    { itemId: "title-card", screenId: "title", rect: { x: 10, y: 60, width: 40, height: 15 },
      draft: batchDraft("标题组件"), componentId: "assistant-title-card" },
    { itemId: "preferences-card", screenId: "preferences", rect: { x: 10, y: 80, width: 30, height: 10 },
      draft: batchDraft("选项组件"), componentId: "assistant-preferences-card" },
  ],
});
assert.equal(batch.status, "ready", "多个页面的审核项应生成单一批量合并计划");
assert.equal(batch.items.length, 2);
assert.deepEqual(batch.expectedScreenSnapshots, Object.fromEntries(batchLayout.screens
  .map(screen => [screen.screen_id, batchBaseline.screens[screen.screen_id]])),
  "提交快照覆盖所有页面，避免规划后其它页面的并发修改被整布局写入覆盖");
assert.equal(batch.layout.screens.find(screen => screen.screen_id === "title").components
  .some(component => component.component_id === "assistant-title-card"), true);
assert.equal(batch.layout.screens.find(screen => screen.screen_id === "preferences").components
  .some(component => component.component_id === "assistant-preferences-card"), true);
assert.equal(batchLayout.screens.reduce((count, screen) => count + screen.components.length, 0), 2,
  "批量规划不得修改工程当前布局");

const staleBatchLayout = structuredClone(batchLayout);
staleBatchLayout.screens.find(screen => screen.screen_id === "preferences").components[0].rect.x = 11;
const staleBatch = planAssistantCreationProjectMergeBatch({
  currentProjectId: "project-a",
  currentLayout: staleBatchLayout,
  currentAssets: [],
  baseline: batchBaseline,
  items: [
    { itemId: "title-card", screenId: "title", rect: { x: 10, y: 60, width: 40, height: 15 },
      draft: batchDraft("标题组件"), componentId: "assistant-title-card" },
    { itemId: "preferences-card", screenId: "preferences", rect: { x: 10, y: 80, width: 30, height: 10 },
      draft: batchDraft("选项组件"), componentId: "assistant-preferences-card" },
  ],
});
assert.equal(staleBatch.status, "conflict",
  "批量中任一目标页的基线过期时必须拒绝整批，不能部分合并");
assert.equal(staleBatchLayout.screens.find(screen => screen.screen_id === "title").components.length, 1,
  "批量冲突时不得留下其它目标页的部分合并结果");

console.log("assistant-creation-project-merge-test: PASS");
