#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const req = createRequire(path.join(root, "editor/package.json"));
const bundle = req("esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export * from './shared/cartridge/uiLayoutProfiles';
    export { normalizeUISkinLayoutForRuntime, validateUISkinLayout } from './shared/cartridge/uiSkin';
    export { createEditorLivePreviewData, exportEditorCartridge } from './editor/src/cartridge/exportCartridge';
    export { resolveRenpyNavigation, resolveRenpySaveGrid, resolveRenpyMenuFrame,
      RENPY_MENU_FRAME_DEFAULTS, RENPY_MENU_FRAME_LIMITS } from './shared/cartridge/renpyGui';
    export { minimumRuntimeVersionForLayout } from './shared/cartridge/runtimeCapabilities';
    export { isRuntimeCompatible } from './shared/cartridge/compatibility';
    export { SUPPORTED_RUNTIME_VERSION } from './shared/cartridge/constants';
  ` },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
});
const mod = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(mod, mod.exports, req);
const api = mod.exports;
(async () => {
  const legacy = api.resolveRuntimeUILayoutSettings();
  const baseline = structuredClone(legacy);
  const renpy = api.switchRuntimeUILayoutType(legacy, "renpy");
  assert.equal(renpy.runtimeUILayout.layout_type, "renpy",
    "活动布局必须向 Runtime 传递 Ren’Py 类型，而不是仅编辑器保存类型");
  assert.equal(renpy.runtimeUILayout.screens.find((s) => s.screen_id === "title").components
    .filter((c) => c.component_type === "mask").length, 0,
    "首次 Ren’Py 默认布局不得继承 AgentVN 右侧按钮遮罩");
  assert.equal(api.normalizeUISkinLayoutForRuntime(renpy.runtimeUILayout).layout.layout_type, "renpy");
  assert.deepEqual(legacy, baseline, "不能污染调用者数据");
  assert.deepEqual(api.switchRuntimeUILayoutType(renpy, "agentvn").runtimeUILayout, baseline.runtimeUILayout);
  // A Stage 1 profile without a discriminator must project as Ren'Py, without rewriting saved data.
  const old = structuredClone(renpy.runtimeUILayoutProfiles);
  delete old.profiles.renpy.layout_type;
  assert.equal(api.resolveRuntimeUILayoutSettings({ runtimeUILayoutProfiles: old }).runtimeUILayout.layout_type, "renpy");
  assert.equal(old.profiles.renpy.layout_type, undefined);
  const input = {
    gameId: "renpy-title-test", title: "双类型运行端", author: "QA", projectAssets: [],
    projectAssetRefs: [], uiLayoutProfiles: renpy.runtimeUILayoutProfiles,
    script: { schema_version: "1.1.0", game_id: "renpy-title-test", title: "双类型运行端",
      entry_scene_id: "main", characters: [],
      scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "实际 Runtime。" }] }] },
  };
  const exported = await api.createEditorLivePreviewData(input);
  assert.equal(exported.uiSkin.layout_type, "renpy");
  assert.equal(exported.manifest.runtime_version,
    api.minimumRuntimeVersionForLayout("0.2.0", exported.uiSkin),
    "Ren’Py 卡带必须按实际活动布局声明最低 Runtime 能力");
  assert.equal(exported.manifest.runtime_version, "0.25.0",
    "当前默认 Ren’Py 布局包含隐藏快捷栏能力，应声明 0.25.0");
  assert.equal(api.isRuntimeCompatible(exported.manifest.runtime_version, "0.24.0"), false,
    "旧 Runtime 必须明确拒绝新布局，不能默默显示 AgentVN");
  assert(api.isRuntimeCompatible(exported.manifest.runtime_version, api.SUPPORTED_RUNTIME_VERSION));
  const agentvn = await api.createEditorLivePreviewData({ ...input, uiLayoutProfiles: baseline.runtimeUILayoutProfiles });
  assert.equal(agentvn.manifest.runtime_version, "0.25.0",
    "当前 AgentVN 默认布局同样包含隐藏快捷栏能力，应声明 0.25.0");
  const withoutDefaultHide = (source) => {
    const copy = structuredClone(source);
    const player = copy.screens.find((screen) => screen.screen_id === "player");
    const hide = player?.components.find((component) => component.component_id === "quick_hide_ui_button");
    if (hide) hide.visible = false;
    copy.target_runtime = "0.2.0";
    return copy;
  };
  const featureLayout = withoutDefaultHide(renpy.runtimeUILayout);
  const featureProfiles = structuredClone(renpy.runtimeUILayoutProfiles);
  featureProfiles.profiles.renpy = featureLayout;
  input.uiLayoutProfiles = featureProfiles;
  assert(api.validateUISkinLayout({ ...renpy.runtimeUILayout, layout_type: "unknown" }).errors.length > 0);
  assert(api.validateUISkinLayout({ ...renpy.runtimeUILayout, renpy: { shared: { fontSize: -1 } } }).errors.length > 0);
  const customComponentLayout = structuredClone(featureLayout);
  customComponentLayout.screens.find((screen) => screen.screen_id === "title").components.push({
    component_id: "custom_component_test",
    component_type: "custom_component",
    rect: { x: 10, y: 10, width: 30, height: 20 },
    customComponent: {
      schemaVersion: 1,
      root: { tag: "div", className: "root", children: [
        { tag: "button", className: "button", action: "open_save_load", children: [
          { tag: "span", text: "存档", children: [] },
        ] },
      ] },
      styles: { ".root": { display: "flex" }, ".button:hover": { opacity: "0.9" } },
    },
  });
  assert.deepEqual(api.validateUISkinLayout(customComponentLayout).errors, [],
    "有效的受限组件应可通过真实卡带布局校验");
  const customProfiles = structuredClone(featureProfiles);
  customProfiles.profiles.renpy = structuredClone(customComponentLayout);
  const customExport = await api.createEditorLivePreviewData({
    ...input,
    uiLayoutProfiles: customProfiles,
  });
  assert.equal(customExport.manifest.runtime_version, "0.15.0",
    "使用自定义组件的卡带必须声明包含其渲染能力的最低 Runtime 版本");
  assert.equal(api.isRuntimeCompatible(customExport.manifest.runtime_version, "0.14.0"), false,
    "不支持自定义组件的旧 Runtime 必须拒绝新卡带");
  const unsafeCustomComponentLayout = structuredClone(customComponentLayout);
  unsafeCustomComponentLayout.screens.find((screen) => screen.screen_id === "title")
    .components.find((component) => component.component_type === "custom_component")
    .customComponent.root.children[0].action = "run_script";
  assert(api.validateUISkinLayout(unsafeCustomComponentLayout).errors.some((item) =>
    item.path.endsWith(".customComponent")),
  "未经授权的组件动作必须在卡带布局边界被拒绝");
  assert.equal(api.resolveRenpyNavigation({ shared: { fontSize: 28 }, title: { fontSize: 32 } }).fontSize, 32);
  assert.equal(api.resolveRenpyNavigation({ shared: { fontSize: 28 } }).fontSize, 28);
  const menuGUI = {
    shared: { fontSize: 28, x: 52, spacing: 6 },
    title: { fontSize: 40 },
    preferences: { fontSize: 30 },
  };
  assert.equal(api.resolveRenpyNavigation(menuGUI, "history").fontSize, 28,
    "菜单必须继承共享值，不能继承标题页覆盖");
  assert.deepEqual(api.resolveRenpyNavigation(menuGUI, "preferences"), { fontSize: 30, x: 52, spacing: 6 },
    "页面局部覆盖只覆盖显式字段");
  assert.deepEqual(api.resolveRenpySaveGrid(), { saveColumns: 3, saveGap: 14 },
    "存档页结构应使用稳定的模板默认值");
  const authoredGrid = { saveColumns: 2, saveGap: 30 };
  assert.deepEqual(api.resolveRenpySaveGrid(undefined, authoredGrid), authoredGrid,
    "未设置新结构字段时，继承应采用旧组件已保存的基准");
  assert.deepEqual(api.resolveRenpySaveGrid({ shared: { saveColumns: 4 } }, authoredGrid),
    { saveColumns: 4, saveGap: 30 }, "新字段只覆盖显式属性，不顺带覆盖旧间距");
  assert.deepEqual(api.resolveRenpySaveGrid({ shared: { saveGap: 18 },
    save_load: { saveGap: 20 } }, authoredGrid), { saveColumns: 2, saveGap: 20 },
    "页面覆盖、共享覆盖和旧组件基准必须按字段继承");
  assert.deepEqual(api.resolveRenpySaveGrid({ shared: { saveColumns: 6, saveGap: 2 },
    save_load: { saveColumns: 4 } }), { saveColumns: 4, saveGap: 2 },
    "存档页面覆盖优先，共享存档结构值用于缺省字段");
  assert.deepEqual(api.resolveRenpySaveGrid({ save_load: { saveColumns: 99, saveGap: -2 } }),
    { saveColumns: 6, saveGap: 0 }, "运行时解析须限制布局结构值的安全范围");
  assert(api.validateUISkinLayout({ ...renpy.runtimeUILayout,
    renpy: { save_load: { saveColumns: 4, saveGap: 20 } } }).errors.length === 0,
  "Ren’Py 存档结构覆盖应通过布局校验");
  assert(api.validateUISkinLayout({ ...renpy.runtimeUILayout,
    renpy: { save_load: { saveColumns: 7 } } }).errors.length > 0,
  "布局校验必须拒绝超界列数");
  assert(api.validateUISkinLayout({ ...renpy.runtimeUILayout,
    renpy: { save_load: { saveColumns: 2.5 } } }).errors.length > 0,
  "布局校验必须拒绝小数列数，避免生成无效 CSS grid");
  assert(api.validateUISkinLayout({ ...renpy.runtimeUILayout,
    renpy: { history: { saveGap: 20 } } }).errors.length > 0,
  "存档网格参数只属于共享基准和存读档页，不能误写历史/标题等页面");
  assert.deepEqual(api.validateUISkinLayout({ ...renpy.runtimeUILayout, renpy: menuGUI }).errors, [],
    "共享菜单页面覆盖必须能校验、保存和导出");
  assert(api.validateUISkinLayout({ ...renpy.runtimeUILayout, renpy: { history: { toString: 22 } } }).errors.length > 0,
    "每页覆盖只接受白名单属性，包括拒绝 Object 原型同名属性");
  input.uiLayoutProfiles.profiles.renpy.renpy = structuredClone(menuGUI);
  const packed = await api.exportEditorCartridge(input);
  assert.deepEqual(packed.errors, []);
  const zip = await req("jszip").loadAsync(await packed.blob.arrayBuffer());
  assert.equal(JSON.parse(await zip.file("ui/layout.json").async("string")).layout_type, "renpy",
    "实际卡带字节必须含运行布局类型");
  assert.deepEqual(JSON.parse(await zip.file("ui/layout.json").async("string")).renpy, menuGUI,
    "实际卡带字节必须保留共享值与每页覆盖，不能仅在编辑器显示生效");
  assert.equal(JSON.parse(await zip.file("manifest.json").async("string")).runtime_version, "0.10.0",
    "使用独立帮助页面及菜单覆盖必须提高最低 Runtime，禁止旧客户端静默忽略");
  assert.equal(api.isRuntimeCompatible("0.10.0", "0.9.0"), false);
  const saveGUI = { ...menuGUI, shared: { ...menuGUI.shared, saveColumns: 3, saveGap: 16 },
    save_load: { saveColumns: 4, saveGap: 20 } };
  input.uiLayoutProfiles.profiles.renpy.renpy = saveGUI;
  const savePacked = await api.exportEditorCartridge(input);
  const saveZip = await req("jszip").loadAsync(await savePacked.blob.arrayBuffer());
  assert.deepEqual(JSON.parse(await saveZip.file("ui/layout.json").async("string")).renpy, saveGUI,
    "导出真实卡带字节必须保留共享及页面网格参数");
  const saveVersion = JSON.parse(await saveZip.file("manifest.json").async("string")).runtime_version;
  assert.equal(saveVersion, "0.11.0", "存档结构新能力必须声明最低 Runtime 版本，不能沿用旧帮助版本");
  assert.equal(api.isRuntimeCompatible(saveVersion, "0.10.0"), false,
    "旧 Runtime 必须拒绝不认识的结构参数");
  assert(api.isRuntimeCompatible(saveVersion, api.SUPPORTED_RUNTIME_VERSION), "当前 Runtime 必须支持自己导出的网格布局");
  const framedGUI = {
    ...saveGUI,
    shared: {
      ...saveGUI.shared,
      buttonBorders: { left: 6, top: 8, right: 10, bottom: 12 },
      buttonTile: true,
    },
  };
  input.uiLayoutProfiles.profiles.renpy.renpy = framedGUI;
  const framedPacked = await api.exportEditorCartridge(input);
  const framedZip = await req("jszip").loadAsync(await framedPacked.blob.arrayBuffer());
  const framedVersion = JSON.parse(await framedZip.file("manifest.json").async("string")).runtime_version;
  assert.equal(framedVersion, "0.12.0",
    "Ren’Py 九宫格切片和平铺字段必须声明新的最低 Runtime 版本");
  assert.equal(api.isRuntimeCompatible(framedVersion, "0.11.0"), false,
    "只支持存档网格的旧 Runtime 必须拒绝使用九宫格按钮的卡带");
  assert(api.isRuntimeCompatible(framedVersion, api.SUPPORTED_RUNTIME_VERSION),
    "当前 Runtime 必须兼容九宫格按钮能力");
  input.uiLayoutProfiles.profiles.renpy.renpy = {
    shared: { buttonRoles: { title_action: { states: { hover: { backgroundColor: "#203040" } } } } },
  };
  const rolesPacked = await api.exportEditorCartridge(input);
  const rolesZip = await req("jszip").loadAsync(await rolesPacked.blob.arrayBuffer());
  const rolesVersion = JSON.parse(await rolesZip.file("manifest.json").async("string")).runtime_version;
  assert.equal(rolesVersion, "0.14.0",
    "按钮角色与状态字段必须要求支持角色解析的新 Runtime");
  assert.equal(api.isRuntimeCompatible(rolesVersion, "0.13.0"), false,
    "旧 Runtime 不得静默忽略按钮角色状态");
  assert(api.isRuntimeCompatible(rolesVersion, api.SUPPORTED_RUNTIME_VERSION),
    "当前 Runtime 必须支持导出的按钮角色配置");
  assert.deepEqual(api.resolveRenpyMenuFrame(undefined, "about"), api.RENPY_MENU_FRAME_DEFAULTS,
    "旧布局无新增字段时必须保留官方模板默认值");
  const frameGUI = {
    shared: { menuNavigationWidth: 310, menuTopPadding: 140, menuBottomPadding: 40,
      menuContentLeft: 32, menuContentRight: 24, menuContentTop: 12,
      menuTitleX: 56, menuTitleFontSize: 44 },
    about: { menuContentLeft: 48, menuTitleFontSize: 46 },
  };
  const beforeFrame = structuredClone(frameGUI);
  assert.deepEqual(api.resolveRenpyMenuFrame(frameGUI, "about"),
    { ...frameGUI.shared, ...frameGUI.about }, "菜单页面应按字段继承共享框架");
  assert.deepEqual(api.resolveRenpyMenuFrame(frameGUI, "help"), frameGUI.shared,
    "帮助不得继承关于的框架覆盖");
  assert.deepEqual(frameGUI, beforeFrame, "解析不得回写工程字段");
  for (const [key, [min, max]] of Object.entries(api.RENPY_MENU_FRAME_LIMITS)) {
    for (const invalid of [min - 1, max + 1, "100", null, NaN])
      assert(api.validateUISkinLayout({ ...renpy.runtimeUILayout,
        renpy: { shared: { [key]: invalid } } }).errors.length > 0,
      `${key} 必须拒绝非法参数: ${invalid}`);
    for (const page of ["title", "player"])
      assert(api.validateUISkinLayout({ ...renpy.runtimeUILayout,
        renpy: { [page]: { [key]: min } } }).errors.length > 0,
      `${page} 不能伪装成共享菜单框架`);
    for (const value of [min, max])
      assert.deepEqual(api.validateUISkinLayout({ ...renpy.runtimeUILayout,
        renpy: { shared: { [key]: value } } }).errors, [],
      `${key} 边界值应允许保存`);
  }
  input.uiLayoutProfiles.profiles.renpy.renpy = frameGUI;
  const framePacked = await api.exportEditorCartridge(input);
  assert.deepEqual(framePacked.errors, []);
  const frameZip = await req("jszip").loadAsync(await framePacked.blob.arrayBuffer());
  const frameLayout = JSON.parse(await frameZip.file("ui/layout.json").async("string"));
  assert.deepEqual(frameLayout.renpy, frameGUI, "真实卡带字节必须保存完整框架及页面覆盖");
  assert.deepEqual(api.normalizeUISkinLayoutForRuntime(frameLayout).layout.renpy, frameGUI,
    "Runtime 归一化不得丢失新增可选字段");
  const frameVersion = JSON.parse(await frameZip.file("manifest.json").async("string")).runtime_version;
  assert.equal(frameVersion, "0.16.1", "显式菜单框架必须声明支持该修复的 Runtime");
  assert.equal(api.isRuntimeCompatible(frameVersion, "0.16.0"), false,
    "旧 Runtime 必须拒绝未支持的作者框架参数");
  assert(api.isRuntimeCompatible(frameVersion, api.SUPPORTED_RUNTIME_VERSION));
  console.log("PASS layout projection, normalization, export, old-profile migration and Runtime compatibility");
})().catch((error) => { console.error(error); process.exitCode = 1; });
