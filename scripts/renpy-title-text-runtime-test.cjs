"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, ".."), req = createRequire(path.join(root, "editor/package.json"));
const mod = { exports: {} };
const code = req("esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export * from "./shared/cartridge/renpyTitleControls";
    export * from "./shared/cartridge/uiLayoutProfiles";
    export {normalizeUISkinLayoutForRuntime, validateUISkinLayout} from "./shared/cartridge/uiSkin";
    export {minimumRuntimeVersionForLayout} from "./shared/cartridge/runtimeCapabilities";
    export {SUPPORTED_RUNTIME_VERSION} from "./shared/cartridge/constants";
    export {isRuntimeCompatible} from "./shared/cartridge/compatibility";
    export {createEditorLivePreviewData, exportEditorCartridge} from "./editor/src/cartridge/exportCartridge";
  ` },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
}).outputFiles[0].text;
new Function("module", "exports", "require", code)(mod, mod.exports, req);
const api = mod.exports;
(async () => {
  const original = api.resolveRuntimeUILayoutSettings(), originalBytes = JSON.stringify(original);
  const settings = api.switchRuntimeUILayoutType(original, "renpy");
  const baseline = structuredClone(settings.runtimeUILayout);
  const oldFloor = api.minimumRuntimeVersionForLayout("0.2.0", baseline);
  const authored = structuredClone(baseline);
  authored.renpyTitleText = { title: { visible: false, text: "作品名称" }, version: { text: "特别版" } };
  const next = api.updateActiveRuntimeUILayout(settings, authored);
  assert.equal(next.runtimeUILayout.target_runtime, "0.26.0");
  assert.deepEqual(api.resolveRenpyTitleText(authored.renpyTitleText, "工程名", "1.0"),
    { title: undefined, version: "特别版" });
  assert.deepEqual(api.resolveRenpyTitleText({ title: { text: "" }, version: { visible: false } }, "工程名", "1.0"),
    { title: "", version: undefined });
  assert.deepEqual(api.resolveRenpyTitleText(undefined, "工程名", "1.0"), { title: "工程名", version: "1.0" });
  assert.equal(api.minimumRuntimeVersionForLayout("0.2.0", baseline), oldFloor);
  const inactive = api.switchRuntimeUILayoutType(next, "agentvn");
  assert.deepEqual(inactive.runtimeUILayoutProfiles.profiles.renpy.renpyTitleText, authored.renpyTitleText);
  assert.equal(inactive.runtimeUILayout.renpyTitleText, undefined);
  assert.deepEqual(inactive.runtimeUILayoutProfiles.profiles.agentvn, original.runtimeUILayoutProfiles.profiles.agentvn);
  const restored = api.switchRuntimeUILayoutType(JSON.parse(JSON.stringify(inactive)), "renpy");
  assert.deepEqual(restored.runtimeUILayout.renpyTitleText, authored.renpyTitleText);
  assert.equal(JSON.stringify(original), originalBytes, "Never mutate the caller or inactive profile");
  assert.deepEqual(api.normalizeUISkinLayoutForRuntime(restored.runtimeUILayout).layout.renpyTitleText, authored.renpyTitleText);
  assert.deepEqual(api.validateUISkinLayout(restored.runtimeUILayout).errors, []);
  const bad = [null, [], "title", { title: false }, { title: { visible: 1 } },
    { title: { text: 7 } }, { title: { text: "中".repeat(161) } }, { extra: {} },
    { version: { html: "<b>text</b>" } }, { title: { text: "<script>alert(1)</script>" } }];
  for (const value of bad)
    assert(api.validateUISkinLayout({ ...authored, renpyTitleText: value }).errors.length > 0);
  assert.equal(api.resolveRenpyTitleActionLabel({ component_id: "title_help_button", component_type: "menu_button",
    label: "帮助按钮" }, "帮助"), "帮助");
  assert.equal(api.resolveRenpyTitleActionLabel({ component_id: "title_help_button", component_type: "menu_button",
    label: "操作说明" }, "帮助"), "操作说明");
  const input = { gameId: "qa-title-text", title: "工程名不变", author: "QA", version: "1.0.0",
    language: "zh-CN", description: "", includeGallery: false, includeMetadata: false,
    projectAssets: [], projectAssetRefs: [], uiLayoutProfiles: next.runtimeUILayoutProfiles,
    script: { schema_version: "1.1.0", game_id: "qa-title-text", title: "工程名不变",
      entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "场景", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "普通文字编辑不改剧情。" }] }] } };
  const preview = await api.createEditorLivePreviewData(input);
  assert.equal(preview.manifest.title, input.title); assert.equal(preview.manifest.version, input.version);
  assert.equal(preview.manifest.runtime_version, "0.26.0");
  assert.deepEqual(preview.uiSkin.renpyTitleText, authored.renpyTitleText);
  assert.equal(api.isRuntimeCompatible(preview.manifest.runtime_version, "0.25.0"), false);
  assert(api.isRuntimeCompatible(preview.manifest.runtime_version, api.SUPPORTED_RUNTIME_VERSION));
  const exported = await api.exportEditorCartridge(input);
  assert.deepEqual(exported.errors, []);
  const zip = await req("jszip").loadAsync(await exported.blob.arrayBuffer(), { checkCRC32: true });
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  assert.deepEqual(layout.renpyTitleText, authored.renpyTitleText);
  assert(!JSON.stringify(layout).includes("runtimeUILayoutProfiles"));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.equal(manifest.title, input.title); assert.equal(manifest.version, input.version);
  const standard = await api.createEditorLivePreviewData({ ...input, uiLayoutProfiles: inactive.runtimeUILayoutProfiles });
  assert.equal(standard.uiSkin.renpyTitleText, undefined);
  assert(!api.isRuntimeCompatible(preview.manifest.runtime_version, "0.25.0"));
  console.log(JSON.stringify({ status: "PASS", scope: "SOURCE_MODEL_EXPORT_NOT_NATIVE_OLD_BINARY",
    malformedConfigsRejected: bad.length, independentInheritance: true, profilesIsolated: true,
    actualCartridgeBytes: exported.blob.size, compatibilityFloor: manifest.runtime_version,
    oldBinaryTested: false }));
})().catch(e => { console.error(e); process.exitCode = 1; });
