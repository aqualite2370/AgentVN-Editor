#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const compiled = requireEditor("esbuild").buildSync({
  stdin: {
    contents: `
      export { useProjectStore } from './editor/src/store/projectStore';
      export { getDefaultUISkinLayout } from './shared/cartridge/uiSkin';
      export { filterInactiveRuntimeLayoutAssets, resolveRuntimeUILayoutSettings } from './shared/cartridge/uiLayoutProfiles';
    `,
    loader: "ts", resolveDir: root,
  },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", compiled.outputFiles[0].text)(loaded, loaded.exports, requireEditor);
const { useProjectStore, getDefaultUISkinLayout } = loaded.exports;
const original = getDefaultUISkinLayout();
original.name = "用户原布局";
original.tokens.colorAccent = "#123456";
const before = structuredClone(original);
useProjectStore.getState().loadProjectMetadata({
  project_id: "legacy-layout", title: "旧工程", author: "",
  asset_manifest: [], editor_settings: { runtimeUILayout: original },
});
const migrated = useProjectStore.getState().settings;
assert.equal(migrated.runtimeUILayoutProfiles?.activeType, "agentvn", "旧工程必须迁入 AgentVN 布局类型");
// This fixture now contains the shipped, visible native Hide action. Its
// previously stale 0.1.0 metadata must be upgraded; every visual field stays exact.
const expectedLegacy = { ...before, target_runtime: "0.25.0" };
assert.deepEqual(migrated.runtimeUILayoutProfiles.profiles.agentvn, expectedLegacy, "只修正已使用能力的版本，旧布局其余字段完整保留");
assert.deepEqual(migrated.runtimeUILayout, expectedLegacy, "兼容输出使用同一能力归一化结果");
assert.equal(migrated.runtimeUILayoutProfiles.profiles.renpy, undefined, "不自动创建或套用新类型");
assert.deepEqual(original, before, "加载不得修改调用者的数据");
console.log("PASS legacy projects keep their complete AgentVN layout in an isolated profile");
const edited = structuredClone(migrated.runtimeUILayout);
edited.name = "保存后的旧布局";
useProjectStore.getState().setRuntimeUILayout(edited);
const persisted = structuredClone(useProjectStore.getState().settings);
useProjectStore.getState().loadProjectMetadata({
  project_id: "legacy-layout", title: "旧工程", author: "",
  asset_manifest: [], editor_settings: persisted,
});
assert.equal(useProjectStore.getState().settings.runtimeUILayout.name, edited.name, "保存、重开后必须保留最新布局");
assert.equal(useProjectStore.getState().settings.runtimeUILayoutProfiles.profiles.agentvn.name, edited.name,
  "现有布局编辑入口必须同步写入活动配置，不能产生两套真相");
console.log("PASS existing layout edits survive reloading the complete project settings");
useProjectStore.getState().setRuntimeUILayoutType("renpy");
const initialRenpy = structuredClone(useProjectStore.getState().settings.runtimeUILayout);
assert.notDeepEqual(initialRenpy, edited, "首次切换必须创建独立预设，不复制覆盖原布局");
const defaultQuickButtons = initialRenpy.screens.find(screen => screen.screen_id === "player")
  .components.filter(component => component.component_type === "quick_button");
assert(defaultQuickButtons.length >= 6, "Test the actual default native controls, not an empty fixture");
assert(defaultQuickButtons.every(component => component.style?.fontSize === undefined),
  "新建 Ren’Py 预设不能把 AgentVN 的局部字号当成作者覆盖，快捷栏应统一继承角色字号");
assert(defaultQuickButtons.every(component => component.style?.fontWeight === undefined),
  "新预设九项快捷按钮不能混入 AgentVN 抽屉按钮的局部字重");
console.log("PASS new RenPy quick controls inherit role typography without AgentVN drawer overrides");
const explicitQuick = initialRenpy.screens.find(screen => screen.screen_id === "player")
  .components.find(component => component.component_id === "quick_history_button");
explicitQuick.style.fontSize = 23;
const renamedRenpy = { ...initialRenpy, name: "独立 RenPy 修改" };
useProjectStore.getState().setRuntimeUILayout(renamedRenpy);
useProjectStore.getState().setRuntimeUILayoutType("agentvn");
assert.deepEqual(useProjectStore.getState().settings.runtimeUILayout, edited, "切回必须恢复原布局");
useProjectStore.getState().setRuntimeUILayoutType("renpy");
assert.deepEqual(useProjectStore.getState().settings.runtimeUILayout, renamedRenpy, "RenPy 修改应独立保留");
const settingsA = structuredClone(useProjectStore.getState().settings);
settingsA.runtimeUILayout = before; // stale compatibility mirror must never win.
useProjectStore.getState().createProject({ title: "另一个工程", author: "" });
assert.equal(useProjectStore.getState().settings.runtimeUILayoutProfiles.activeType, "agentvn");
assert.equal(useProjectStore.getState().settings.runtimeUILayoutProfiles.profiles.renpy, undefined);
useProjectStore.getState().loadProjectMetadata({
  project_id: "legacy-layout", title: "旧工程", author: "", asset_manifest: [], editor_settings: settingsA,
});
assert.deepEqual(useProjectStore.getState().settings.runtimeUILayout, renamedRenpy, "重启必须由活动配置派生兼容输出");
assert.equal(useProjectStore.getState().settings.runtimeUILayout.screens.find(screen => screen.screen_id === "player")
  .components.find(component => component.component_id === "quick_history_button").style.fontSize, 23,
  "切换、保存与重开不能抹掉旧工程或用户明确设置的控件字号");
assert.deepEqual(useProjectStore.getState().settings.runtimeUILayoutProfiles.profiles.agentvn, edited);
console.log("PASS profile switching, edits, project isolation and stale-mirror precedence");
const versionedProfiles = structuredClone(useProjectStore.getState().settings.runtimeUILayoutProfiles);
versionedProfiles.activeType = "renpy";
versionedProfiles.profiles.renpy.target_runtime = "0.10.0";
// Isolate the button-role floor from the newer Hide action's independent floor.
versionedProfiles.profiles.renpy.screens.find(screen => screen.screen_id === "player").components
  .find(component => component.component_id === "quick_hide_ui_button").visible = false;
versionedProfiles.profiles.renpy.renpy = {
  shared: { buttonRoles: { story_choice: { states: { normal: { textColor: "#426789" } } } } },
};
const unmodifiedProfiles = structuredClone(versionedProfiles);
const canonical = loaded.exports.resolveRuntimeUILayoutSettings({ runtimeUILayoutProfiles: versionedProfiles });
assert.equal(canonical.runtimeUILayout.target_runtime, "0.14.0",
  "启用按钮角色必须提升活动布局能力版本");
assert.deepEqual(canonical.runtimeUILayoutProfiles.profiles.renpy, canonical.runtimeUILayout,
  "活动配置与兼容输出必须在同一次选择中完成归一化，不能等下次保存或重开");
assert.deepEqual(canonical.runtimeUILayoutProfiles.profiles.agentvn, unmodifiedProfiles.profiles.agentvn,
  "能力归一化不得修改未活动布局");
assert.deepEqual(versionedProfiles, unmodifiedProfiles, "解析不得改写调用方数据");
assert.deepEqual(loaded.exports.resolveRuntimeUILayoutSettings(canonical), canonical,
  "重复加载归一化配置不得再变化");
canonical.runtimeUILayout.tokens.colorAccent = "#998877";
assert.notEqual(canonical.runtimeUILayoutProfiles.profiles.renpy.tokens.colorAccent, "#998877",
  "兼容输出与源配置必须是独立对象，不能通过修改输出绕过活动配置更新接口");
console.log("PASS active profile capability normalization is canonical, idempotent and copy isolated");
const intact = structuredClone(useProjectStore.getState().settings);
for (const badProfiles of [
  { ...intact.runtimeUILayoutProfiles, version: 99 },
  { ...intact.runtimeUILayoutProfiles, activeType: "missing" },
  { ...intact.runtimeUILayoutProfiles, profiles: { agentvn: {} } },
  { ...intact.runtimeUILayoutProfiles, profiles: { agentvn: intact.runtimeUILayoutProfiles.profiles.agentvn, renpy: {} } },
]) {
  assert.throws(() => useProjectStore.getState().loadProjectMetadata({
    project_id: "broken", title: "损坏工程", author: "", asset_manifest: [],
    editor_settings: { runtimeUILayoutProfiles: badProfiles },
  }), /LAYOUT_PROFILES_INVALID/, "损坏或未来版本配置必须明确拒绝，不能默默重置");
  assert.deepEqual(useProjectStore.getState().settings, intact, "失败加载不能污染当前工程");
}
console.log("PASS malformed profiles do not replace current project data");
const assetProfiles = structuredClone(intact.runtimeUILayoutProfiles);
assetProfiles.activeType = "agentvn";
assetProfiles.profiles.agentvn.tokens.fontAssetId = "shared-font";
assetProfiles.profiles.renpy.tokens.fontAssetId = "shared-font";
assetProfiles.profiles.renpy.assets = [
  { asset_id: "inactive-only", path: "assets/ui/inactive-only.png" },
  { asset_id: "story-shared", path: "assets/ui/story-shared.png" },
];
const assets = ["shared-font", "inactive-only", "story-shared", "unrelated-library"]
  .map((asset_id) => ({ asset_id, path: `assets/ui/${asset_id}.png`, asset_type: "ui" }));
const retained = loaded.exports.filterInactiveRuntimeLayoutAssets(assetProfiles, assets, ["story-shared"]);
assert.deepEqual(retained.map((a) => a.asset_id), ["shared-font", "story-shared"],
  "游戏导出只保留活动布局和剧情依赖，剔除非活动专属及未引用的素材库文件；便携工程不裁剪");
console.log("PASS game asset filtering protects shared/story resources and excludes unrelated library files");
