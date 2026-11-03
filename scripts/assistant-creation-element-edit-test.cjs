"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: {
    contents: `export {
      parseAssistantCreationDraftBatchValue,
      parseAssistantCreationElementEditBatchValue,
    } from "./editor/src/assistant/creationAgent";
    export {
      captureAssistantCreationLayoutBaseline,
      planAssistantCreationElementEditBatch,
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
  parseAssistantCreationDraftBatchValue,
  parseAssistantCreationElementEditBatchValue,
  captureAssistantCreationLayoutBaseline,
  planAssistantCreationElementEditBatch,
} = loaded.exports;
const authorizedTargets = [{
  targetId: "target-1",
  screenId: "title",
  componentType: "main_menu_start_button",
  label: "开始游戏",
  rect: { x: 72, y: 40, width: 18, height: 8 },
}];

const valid = parseAssistantCreationElementEditBatchValue({
  edits: [{
    target_id: "target-1",
    screen_id: "title",
    label: "进入故事",
    rect: { x: 70, y: 42, width: 20, height: 8 },
  }],
}, authorizedTargets);
assert.equal(valid.ok, true, `获准控件的有限修改应被接受：${valid.issues.join(" ")}`);
assert.deepEqual(valid.edits, [{
  targetId: "target-1",
  screenId: "title",
  label: "进入故事",
  rect: { x: 70, y: 42, width: 20, height: 8 },
}]);

const editOnlyResponse = parseAssistantCreationDraftBatchValue({
  edits: [{ target_id: "target-1", screen_id: "title", label: "进入故事" }],
}, "2026-10-04T00:00:00.000Z", { authorizedTargets });
assert.equal(editOnlyResponse.ok, true, "仅修改现有控件的结果也必须通过统一提案解析流程");
assert.equal(editOnlyResponse.drafts, undefined);
assert.deepEqual(editOnlyResponse.edits, [{
  targetId: "target-1",
  screenId: "title",
  label: "进入故事",
}]);

const unselectedResponse = parseAssistantCreationDraftBatchValue({
  edits: [{ target_id: "target-2", screen_id: "title", label: "越权控件" }],
}, "2026-10-04T00:00:00.000Z", { authorizedTargets });
assert.equal(unselectedResponse.ok, false, "统一解析器不得绕过授权目标检查");

const unauthorized = parseAssistantCreationElementEditBatchValue({
  edits: [{ target_id: "target-2", screen_id: "title", label: "越权控件" }],
}, authorizedTargets);
assert.equal(unauthorized.ok, false, "模型不得修改未由用户明确授权的控件");

const crossPage = parseAssistantCreationElementEditBatchValue({
  edits: [{ target_id: "target-1", screen_id: "preferences", label: "跨页修改" }],
}, authorizedTargets);
assert.equal(crossPage.ok, false, "目标别名不能被改用于访问另一页面");

const forbiddenField = parseAssistantCreationElementEditBatchValue({
  edits: [{
    target_id: "target-1",
    screen_id: "title",
    component_type: "help_panel",
  }],
}, authorizedTargets);
assert.equal(forbiddenField.ok, false, "组件类型、动作与结构字段不属于本切片可修改范围");

const invalidGeometry = parseAssistantCreationElementEditBatchValue({
  edits: [{ target_id: "target-1", screen_id: "title", rect: { x: 95, y: 20, width: 10, height: 8 } }],
}, authorizedTargets);
assert.equal(invalidGeometry.ok, false, "越出画布的几何修改必须在本地拒绝");

const missingBaseGeometry = parseAssistantCreationElementEditBatchValue({
  edits: [{ target_id: "target-1", screen_id: "title", rect: { x: 10 } }],
}, [{ targetId: "target-1", screenId: "title", componentType: "main_menu_start_button" }]);
assert.equal(missingBaseGeometry.ok, false, "没有完整原始几何时不能校验布局修改是否越界");

const currentLayout = {
  layout_type: "renpy",
  ui_layout_version: "2.0.0",
  name: "进阶",
  target_runtime: "0.10.0",
  tokens: {},
  screens: [{
    screen_id: "title",
    components: [{
      component_id: "title_start",
      component_type: "main_menu_start_button",
      label: "开始游戏",
      required: true,
      rect: { x: 72, y: 40, width: 18, height: 8 },
    }],
  }],
  assets: [],
};
const baseline = captureAssistantCreationLayoutBaseline("project-a", currentLayout);
const localTargets = [{
  targetId: "target-1",
  screenId: "title",
  componentType: "main_menu_start_button",
  label: "开始游戏",
  rect: { x: 72, y: 40, width: 18, height: 8 },
  componentId: "title_start",
}];
const planned = planAssistantCreationElementEditBatch({
  currentProjectId: "project-a",
  currentLayout,
  baseline,
  authorizedTargets: localTargets,
  edits: valid.edits,
});
assert.equal(planned.status, "ready", "通过本地审核的修改应产生可预览合并草稿");
assert.equal(planned.layout.screens[0].components[0].component_id, "title_start",
  "修改现有控件必须保留原 component_id");
assert.equal(planned.layout.screens[0].components[0].label, "进入故事");
assert.deepEqual(planned.layout.screens[0].components[0].rect, { x: 70, y: 42, width: 20, height: 8 });
assert.equal(currentLayout.screens[0].components[0].label, "开始游戏",
  "合并规划不得就地修改工程数据");

const unauthorizedPlan = planAssistantCreationElementEditBatch({
  currentProjectId: "project-a",
  currentLayout,
  baseline,
  authorizedTargets: [],
  edits: valid.edits,
});
assert.equal(unauthorizedPlan.status, "conflict", "合并层必须再次校验本地授权 alias");

const changedLayout = structuredClone(currentLayout);
changedLayout.screens[0].components[0].rect.x = 74;
const stalePlan = planAssistantCreationElementEditBatch({
  currentProjectId: "project-a",
  currentLayout: changedLayout,
  baseline,
  authorizedTargets: localTargets,
  edits: valid.edits,
});
assert.equal(stalePlan.status, "conflict", "审核期间页面变化时不得覆盖新布局");
assert.equal(changedLayout.screens[0].components[0].label, "开始游戏");

console.log("assistant-creation-element-edit-test: PASS");
