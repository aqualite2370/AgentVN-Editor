"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const req = createRequire(path.join(root, "editor/package.json"));
const mod = { exports: {} };
const code = req("esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export * from './shared/cartridge/uiLayoutProfiles';
    export { normalizeUISkinLayoutForRuntime, validateUISkinLayout } from './shared/cartridge/uiSkin';
    export { resolveRenpyNavigation } from './shared/cartridge/renpyGui';
    export { createEditorLivePreviewData, exportEditorCartridge } from './editor/src/cartridge/exportCartridge';
    export { isRuntimeCompatible } from './shared/cartridge/compatibility';
    export { SUPPORTED_RUNTIME_VERSION } from './shared/cartridge/constants';
  ` },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
}).outputFiles[0].text;
new Function("module", "exports", "require", code)(mod, mod.exports, req);
const api = mod.exports;
(async () => {
  const settings = api.switchRuntimeUILayoutType(api.resolveRuntimeUILayoutSettings(), "renpy");
  const layout = settings.runtimeUILayout;
  const help = layout.screens.find(screen => screen.screen_id === "help");
  assert(help?.components.some(component => component.component_type === "help_panel"),
    "Ren’Py 帮助必须拥有独立页面及 help_panel，不能借用 about");
  layout.renpy = { shared: { fontSize: 28, x: 52 }, about: { fontSize: 40 }, help: { spacing: 12 } };
  assert.deepEqual(api.validateUISkinLayout(layout).errors, [], "帮助页及覆盖必须可校验");
  assert.equal(api.resolveRenpyNavigation(layout.renpy, "help").fontSize, 28,
    "帮助未覆盖字段继承共享值，不能继承关于");
  help.components[0].style = { color: "#12abcd", fontSize: 21 };
  const aboutBefore = structuredClone(layout.screens.find(screen => screen.screen_id === "about"));
  settings.runtimeUILayoutProfiles.profiles.renpy = layout;
  const saved = api.updateActiveRuntimeUILayout(settings, layout);
  assert.deepEqual(saved.runtimeUILayout.screens.find(screen => screen.screen_id === "about"), aboutBefore);
  const old = structuredClone(layout);
  old.screens = old.screens.filter(screen => screen.screen_id !== "help");
  delete old.renpy.help;
  old.target_runtime = "0.9.0";
  const before = structuredClone(old);
  const normalized = api.normalizeUISkinLayoutForRuntime(old).layout;
  assert(normalized.screens.some(screen => screen.screen_id === "help"), "旧 Ren’Py 布局使用独立帮助默认值");
  assert.equal(api.validateUISkinLayout(normalized).errors.length, 0, "旧 Ren’Py 布局迁移后可正常校验");
  assert.deepEqual(old, before, "兼容读取不能重写旧布局");
  const oldProfiles = {
    version: 1, activeType: "renpy",
    profiles: { agentvn: api.resolveRuntimeUILayoutSettings().runtimeUILayout, renpy: old },
  };
  const oldProfilesBefore = structuredClone(oldProfiles);
  const editorResolved = api.resolveRuntimeUILayoutSettings({ runtimeUILayoutProfiles: oldProfiles });
  assert(editorResolved.runtimeUILayout.screens.some(screen => screen.screen_id === "help"
    && screen.components.some(component => component.component_type === "help_panel")),
    "旧 Ren’Py 活动配置必须在编辑器读取边界补齐帮助组件，否则真实预览存在但属性控件缺失");
  assert.deepEqual(oldProfiles, oldProfilesBefore, "编辑器兼容读取不能修改调用者的配置集合");
  assert.deepEqual(editorResolved.runtimeUILayoutProfiles.profiles.agentvn,
    oldProfilesBefore.profiles.agentvn,
    "兼容读取不得改写非活动 AgentVN 配置");
  assert.deepEqual(editorResolved.runtimeUILayoutProfiles.profiles.renpy,
    editorResolved.runtimeUILayout,
    "活动 Ren’Py 配置应在读取边界生成规范化的独立帮助页和能力版本");
  assert.notDeepEqual(editorResolved.runtimeUILayoutProfiles.profiles.renpy,
    oldProfilesBefore.profiles.renpy,
    "缺少独立帮助页的旧活动配置必须在返回值中规范化，不能继续以旧能力版本导出");
  assert.equal(editorResolved.runtimeUILayout.target_runtime, "0.10.0",
    "编辑输出补齐独立帮助能力后必须同步声明正确的 Runtime 门槛");
  const savedLegacy = api.updateActiveRuntimeUILayout(editorResolved, editorResolved.runtimeUILayout);
  assert(savedLegacy.runtimeUILayoutProfiles.profiles.renpy.screens.some(screen => screen.screen_id === "help"),
    "显式保存旧 Ren’Py 布局时必须将独立帮助页写入活动配置");
  assert.deepEqual(savedLegacy.runtimeUILayoutProfiles.profiles.agentvn, oldProfilesBefore.profiles.agentvn,
    "保存旧 Ren’Py 布局不能污染非活动 AgentVN 配置");
  assert.deepEqual(oldProfiles, oldProfilesBefore, "显式保存也不能原地修改调用者的旧配置");
  const legacy = api.resolveRuntimeUILayoutSettings();
  assert(!legacy.runtimeUILayout.screens.some(screen => screen.screen_id === "help"),
    "AgentVN 旧布局不能自动新增帮助页");
  const input = {
    gameId: "help-export-test", title: "帮助独立布局", author: "QA", projectAssets: [], projectAssetRefs: [],
    uiLayoutProfiles: saved.runtimeUILayoutProfiles,
    script: { schema_version: "1.1.0", game_id: "help-export-test", title: "帮助独立布局",
      entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1,
        tags: [], commands: [{ type: "narration", text: "测试帮助布局。" }] }] },
  };
  const data = await api.createEditorLivePreviewData(input);
  assert.equal(data.manifest.runtime_version, "0.10.0", "独立帮助需要明确的新 Runtime 能力门槛");
  assert(!api.isRuntimeCompatible(data.manifest.runtime_version, "0.9.0"));
  assert(api.isRuntimeCompatible(data.manifest.runtime_version, api.SUPPORTED_RUNTIME_VERSION));
  const result = await api.exportEditorCartridge(input);
  assert.deepEqual(result.errors, []);
  const zip = await req("jszip").loadAsync(await result.blob.arrayBuffer());
  const packed = JSON.parse(await zip.file("ui/layout.json").async("string"));
  assert.deepEqual(packed.renpy.help, layout.renpy.help);
  assert.deepEqual(packed.screens.find(screen => screen.screen_id === "help"), help,
    "实际导出字节必须包含独立帮助组件和样式");
  assert.deepEqual(packed.screens.find(screen => screen.screen_id === "about"), aboutBefore);
  console.log("PASS independent help layout, inheritance, legacy read, isolation, export bytes and capability rejection");
})().catch(error => { console.error(error); process.exitCode = 1; });
