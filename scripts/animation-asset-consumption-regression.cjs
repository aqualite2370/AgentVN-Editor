"use strict";

// Source-data regression only. Never starts Editor, Player, a browser, or a backend.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { build } = require("../editor/node_modules/esbuild");
const JSZip = require("../editor/node_modules/jszip");

const root = path.resolve(__dirname, "..");
const output = path.resolve(process.argv[2] || "");
const qaRoot = path.resolve("F:/AgentVN/QA");
assert(process.argv[2], "An explicit, new evidence directory is required.");
assert(output.startsWith(qaRoot + path.sep), "Evidence must stay below F:/AgentVN/QA.");
assert(!fs.existsSync(output), "Never overwrite an earlier run.");
const sourcePaths = [
  "editor/src/animation/types.ts",
  "editor/src/animation/exportAnimationCommand.ts",
  "editor/src/cartridge/collectProjectAssets.ts",
  "shared/cartridge/assetScanner.ts",
  "shared/cartridge/packer.ts",
  "GameCli_framework/src/engine/StoryEngine.ts",
  "GameCli_framework/src/engine/assetResolver.ts",
  "GameCli_framework/src/components/player/runtimeAnimation.ts",
  "shared/animation/nativeAnimationAsset.ts",
  "editor/src/animation/animationAsset.ts",
  "editor/src/cartridge/exportCartridge.ts",
  "shared/cartridge/runtimeCapabilities.ts",
  "shared/cartridge/assetTaxonomy.ts",
  "editor/src/utils/editorAssetReferences.ts",
  "editor/src/utils/assetAudit.ts",
];
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sources = () => sourcePaths.map(file => ({
  file,
  sha256: hash(fs.readFileSync(path.join(root, file))),
}));
const report = {
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  scope: "SOURCE_DATA_PIPELINE_WITH_CONTROLLED_NATIVE_PRESET_FIXTURES",
  limits: [
    "No UI, DOM/WAAPI playback, installed binary, Windows game, or Android validation.",
    "AnimationPreset fixtures follow the existing internal model, not a previously published external-file specification.",
    "Only the private compiler is additionally exported inside the in-memory test bundle; production files are unchanged.",
  ],
  productChanges: 0,
  productBuilds: 0,
  modelRequests: 0,
  sourcesBefore: sources(),
  tests: [],
  observations: {},
};

async function check(id, description, execute) {
  try {
    await execute();
    report.tests.push({ id, description, status: "PASS" });
  } catch (error) {
    report.tests.push({ id, description, status: "FAILED", error: error.message });
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const compilerSource = fs.readFileSync(
    path.join(root, "GameCli_framework/src/components/player/runtimeAnimation.ts"), "utf8",
  );
  const built = await build({
    absWorkingDir: root,
    stdin: {
      contents: `
        export { StoryEngine } from "./GameCli_framework/src/engine/StoryEngine";
        export { assetResolver } from "./GameCli_framework/src/engine/assetResolver";
        export { exportAnimationCommand } from "./editor/src/animation/exportAnimationCommand";
        export { collectProjectAssets } from "./editor/src/cartridge/collectProjectAssets";
        export { createCartridgePackage } from "./shared/cartridge/packer";
        export { compileRuntimeAnimation } from "./GameCli_framework/src/components/player/runtimeAnimation";
        export { resolveNativeAnimationAssets, parseNativeAnimationAsset, fetchNativeAnimationAsset } from "./shared/animation/nativeAnimationAsset";
        export { exportEditorCartridge, createEditorLivePreviewData } from "./editor/src/cartridge/exportCartridge";
        export { minimumRuntimeVersionForScript } from "./shared/cartridge/runtimeCapabilities";
        export { validateVersionCompatibility } from "./shared/cartridge/validators";
        export { assetTypeMatchesExpected, assetTypeDisplayLabel } from "./shared/cartridge/assetTaxonomy";
        export { collectCommandAssetFields } from "./editor/src/utils/editorAssetReferences";
        export { buildPendingVisualAssetsForScene } from "./editor/src/utils/assetAudit";
      `,
      resolveDir: root,
      loader: "ts",
    },
    nodePaths: [path.join(root, "editor/node_modules"), path.join(root, "GameCli_framework/node_modules")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [{
      name: "expose-unchanged-private-compiler",
      setup(build) {
        build.onLoad({ filter: /[/\\]player[/\\]runtimeAnimation\.ts$/ }, args => ({
          contents: compilerSource + "\nexport { compileRuntimeAnimation };\n",
          loader: "ts",
          resolveDir: path.dirname(args.path),
        }));
      },
    }],
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(
    require, loaded, loaded.exports,
  );
  const api = loaded.exports;
  global.window = {
    setTimeout: () => 1, clearTimeout() {},
    setInterval: () => 1, clearInterval() {},
    matchMedia: () => ({ matches: false }),
    dispatchEvent: () => true,
  };
  const assetId = "qa_native_animation_asset";
  const presetA = {
    preset_id: assetId, name: "原生动画甲", description: "非默认关键帧探针",
    target_type: "screen", duration_ms: 731, easing: "ease-out",
    loop: false, direction: "normal",
    keyframes: [{ offset: 0, opacity: 0.8, x: 37 }, { offset: 1, opacity: 0.3, x: -93 }],
  };
  const presetB = {
    ...presetA, name: "原生动画乙", duration_ms: 947,
    keyframes: [{ offset: 0, opacity: 0.6, y: -51 }, { offset: 1, opacity: 0.4, y: 89 }],
  };
  const scriptFor = command => ({
    schema_version: "1.1.0", game_id: "qa-animation-consumption", title: "隔离动画消费",
    entry_scene_id: "main", characters: [],
    scenes: [{
      scene_id: "main", title: "Main", chapter: 1, tags: [],
      commands: [command, { type: "narration", text: "动画后的隔离对白。" }],
    }],
  });
  const asset = {
    asset_id: assetId, asset_type: "animation", path: `assets/animation/${assetId}.json`,
    filename: `${assetId}.json`, mime_type: "application/json", preload: false, tags: [],
  };
  const manifest = {
    game_id: "qa-animation-consumption", title: "隔离动画消费", assets: [asset],
  };
  const commandFor = preset => api.exportAnimationCommand({
    preset, target: "screen", blocking: true,
  });
  const compile = async (command, assetText) => {
    const blobUrl = "data:application/json;base64," + Buffer.from(assetText).toString("base64");
    api.assetResolver.configure(manifest, "", { [assetId]: blobUrl });
    const engine = new api.StoryEngine();
    const script = await api.resolveNativeAnimationAssets(scriptFor(command), manifest.assets, asset =>
      api.fetchNativeAnimationAsset(api.assetResolver.resolveAsset(asset.asset_id)));
    engine.loadScript(script, manifest);
    engine.start();
    const effect = engine.state.animationEffects.find(item => item.animation_id === command.animation_id);
    assert(effect, "The actual StoryEngine must dispatch the animation.");
    const compiled = api.compileRuntimeAnimation(effect);
    return { keyframes: compiled.keyframes, options: compiled.options };
  };
  const aText = JSON.stringify(presetA);
  const bText = JSON.stringify(presetB);
  let expectedA, expectedB;
  await check("INLINE-CONTROL", "Existing inline native keyframes produce distinct, non-default effects.", async () => {
    expectedA = await compile(commandFor(presetA), aText);
    expectedB = await compile(commandFor(presetB), bText);
    assert.equal(expectedA.options.duration, 731);
    assert.equal(expectedB.options.duration, 947);
    assert.equal(expectedA.keyframes[1].opacity, 0.3);
    assert.match(expectedA.keyframes[1].transform, /-93px/);
    assert.match(expectedB.keyframes[1].transform, /89px/);
    assert.notDeepEqual(expectedA, expectedB);
  });
  const selected = { type: "animation", animation_id: assetId, target: "screen", params: {}, blocking: true };
  const scan = api.collectProjectAssets(scriptFor(selected), [asset]);
  await check("ARCHIVE-BYTES-CONTROL", "Actual shared packer and ZIP roundtrip retain the two different JSON files.", async () => {
    const archives = [];
    for (const [label, text] of [["a", aText], ["b", bText]]) {
      const { zip } = await api.createCartridgePackage({
        manifest: { ...manifest, assets: scan.manifestAssets },
        script: scriptFor(selected), assets: [{ path: asset.path, data: text, manifestItem: asset }],
      });
      const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      const reopened = await JSZip.loadAsync(bytes);
      assert.equal(await reopened.file(asset.path).async("string"), text);
      assert.deepEqual(JSON.parse(await reopened.file("script.json").async("string")), scriptFor(selected));
      fs.writeFileSync(path.join(output, `${label}.vncart`), bytes);
      archives.push({ label, bytes: bytes.length, sha256: hash(bytes), assetSha256: hash(text) });
    }
    assert.notEqual(archives[0].assetSha256, archives[1].assetSha256);
    report.observations.archives = archives;
  });
  await check("SELECTED-ASSET-DEPENDENCY", "The selected animation file is reported as a script dependency.", () => {
    assert(scan.references.some(ref => ref.asset_id === assetId && ref.asset_type === "animation"),
      "Selected JSON is present in the manifest, but absent from collected script dependencies.");
  });
  const actualA = await compile(selected, aText);
  const actualB = await compile(selected, bText);
  report.observations.compilation = { expectedA, expectedB, actualA, actualB };
  await check("SELECTED-ASSET-CONSUMPTION", "Selecting native JSON yields the same effect as its existing inline representation.", () => {
    assert.deepEqual(actualA, expectedA, "Selected file content does not reach the production compiler.");
  });
  await check("REPLACEMENT-CONSUMPTION", "Replacing selected file bytes changes playback to the replacement keyframes.", () => {
    assert.notDeepEqual(actualA, actualB, "Changing JSON bytes leaves the compiled animation completely unchanged.");
    assert.deepEqual(actualB, expectedB);
  });
  const explicit = { ...selected, animation_asset_id: assetId };
  await check("EXPLICIT-REFERENCE", "New explicit references use the same native file as legacy asset selections.", async () => {
    assert.deepEqual(await compile(explicit, aText), expectedA);
  });
  await check("NO-MUTATION-AND-OVERRIDES", "Resolution preserves author data, applies valid overrides, and reads a shared asset once.", async () => {
    let reads = 0;
    const source = scriptFor({ ...explicit, params: { duration: 906 } });
    source.scenes[0].commands.unshift({ ...explicit });
    const before = structuredClone(source);
    const resolved = await api.resolveNativeAnimationAssets(source, [asset], async () => { reads++; return aText; });
    assert.equal(reads, 1);
    assert.deepEqual(source, before);
    assert.equal(resolved.scenes[0].commands[1].params.duration, 906);
    const referenceOnly = await api.resolveNativeAnimationAssets(source, [asset], async () => aText, { materialize: false });
    assert.equal(referenceOnly.scenes[0].commands[0].params.keyframes, undefined);
    assert.equal(referenceOnly.scenes[0].commands[1].params.duration, 906);
    assert.equal(api.minimumRuntimeVersionForScript(referenceOnly), "0.28.0");
  });
  await check("MISSING-AND-INVALID", "Missing/wrong-type/placeholder files and unsupported, oversized, empty, unsafe, unordered data fail explicitly.", async () => {
    for (const assets of [[], [{ ...asset, asset_type: "ui" }], [{ ...asset, placeholder: true }]]) {
      await assert.rejects(api.resolveNativeAnimationAssets(scriptFor(explicit), assets, async () => aText));
    }
    const invalid = [
      "{", "[]", JSON.stringify({ frames: [] }),
      JSON.stringify({ ...presetA, keyframes: [] }),
      JSON.stringify({ ...presetA, schema_version: "999" }),
      JSON.stringify({ ...presetA, onclick: "alert(1)" }),
      JSON.stringify({ ...presetA, keyframes: [{ offset: 0, x: 1, custom_css: "url(x)" }, { offset: 1, x: 0 }] }),
      JSON.stringify({ ...presetA, keyframes: [{ offset: 1, x: 1 }, { offset: 0, x: 0 }] }),
      JSON.stringify({ ...presetA, keyframes: [{ offset: 0, opacity: 2 }, { offset: 1, x: 0 }] }),
      JSON.stringify({ ...presetA, keyframes: Array.from({ length: 513 }, (_, i) => ({ offset: i / 512, x: i })) }),
      JSON.stringify({ ...presetA, duration_ms: -1 }),
      JSON.stringify({ ...presetA, easing: "cubic-bezier(2, 1, 0, 1)" }),
      " ".repeat(1024 * 1024 + 1),
    ];
    for (const value of invalid) assert.throws(() => api.parseNativeAnimationAsset(value));
    for (const params of [{ keyframes: [] }, { duration: -1 }, { loop: true }, { delay: -1 }, { unknown: "x" }]) {
      await assert.rejects(api.resolveNativeAnimationAssets(scriptFor({ ...explicit, params }), [asset], async () => aText));
    }
    await assert.rejects(api.resolveNativeAnimationAssets(scriptFor(explicit), [asset], async () => { throw new Error("read failure"); }), /read failure/);
  });
  await check("READ-FAILURE-AND-LEGACY", "Unreadable fetches fail, while old inline and built-in effects remain independent of file parsing.", async () => {
    await assert.rejects(api.fetchNativeAnimationAsset("data:application/json;base64," + Buffer.from("x".repeat(1024 * 1024 + 1)).toString("base64")));
    assert.deepEqual(await compile(commandFor(presetA), "{invalid"), expectedA);
    const builtin = { ...selected, animation_id: "sprite_shake" };
    const value = await compile(builtin, "{invalid");
    assert.equal(value.keyframes.length, 4);
    assert.equal(api.minimumRuntimeVersionForScript(scriptFor(builtin)), "0.2.0");
    const unresolved = new api.StoryEngine();
    unresolved.loadScript(scriptFor(explicit), manifest);
    assert.throws(() => unresolved.start(), /ANIMATION_ASSET_UNRESOLVED/);
  });
  await check("NATIVE-FILE-EXPORT-ROUNDTRIP", "Actual Editor export preserves source bytes and reference; reopening resolves replacement content and declares old-runtime rejection.", async () => {
    const input = text => ({
      script: scriptFor(explicit), title: "隔离动画消费", author: "QA", version: "0.0.1",
      language: "zh-CN", description: "", includeGallery: false, includeMetadata: false,
      projectAssets: [asset], projectAssetRefs: [{
        asset_id: assetId, asset_type: "animation",
        metadata: { bytes: new Uint8Array(Buffer.from(text)), filename: asset.filename },
      }],
    });
    for (const [label, text, expected] of [["a", aText, expectedA], ["b", bText, expectedB]]) {
      const result = await api.exportEditorCartridge(input(text));
      assert.equal(result.manifest.runtime_version, "0.28.0");
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      assert.equal(await zip.file(asset.path).async("string"), text);
      const script = JSON.parse(await zip.file("script.json").async("string"));
      assert.equal(script.scenes[0].commands[0].animation_asset_id, assetId);
      assert.equal(script.scenes[0].commands[0].params.keyframes, undefined);
      assert.deepEqual(await compile(script.scenes[0].commands[0], await zip.file(asset.path).async("string")), expected);
      const legacy = api.validateVersionCompatibility(result.manifest, "0.27.0");
      assert.equal(legacy.ok, false);
      const bytes = Buffer.from(await result.blob.arrayBuffer());
      fs.writeFileSync(path.join(output, `editor-${label}.vncart`), bytes);
      report.observations[`editor-${label}`] = { sha256: hash(bytes), bytes: bytes.length, minimumRuntime: result.manifest.runtime_version };
    }
    const preview = await api.createEditorLivePreviewData(input(aText));
    assert.equal(preview.script.scenes[0].commands[0].animation_asset_id, assetId);
    await assert.rejects(api.exportEditorCartridge(input(JSON.stringify({ frames: [] }))), /ANIMATION_ASSET_INVALID/);
  });
  await check("AUTHORING-CATEGORY-AND-LEGACY-AUDIT", "Native assets have an independent category; explicit and legacy references remain visible in authoring diagnostics.", () => {
    assert.equal(api.assetTypeDisplayLabel("animation"), "演出动画");
    assert.equal(api.assetTypeMatchesExpected("other", "animation"), false);
    assert.equal(api.assetTypeMatchesExpected("animation", "other"), false);
    assert.equal(api.collectCommandAssetFields(explicit, [asset])[0].field, "animation_asset_id");
    assert.equal(api.collectCommandAssetFields(selected, [asset])[0].asset_id, assetId);
    assert.equal(api.collectCommandAssetFields(commandFor(presetA), [asset]).length, 0);
    const problems = api.buildPendingVisualAssetsForScene(scriptFor(explicit).scenes[0], { projectAssets: [] });
    assert(problems.some(p => p.asset_id === assetId && p.field === "animation_asset_id"));
    const scene = scriptFor(selected).scenes[0];
    const legacyMissingFile = api.buildPendingVisualAssetsForScene(scene,
      { projectAssets: [{ asset_id: assetId, asset_type: "animation", metadata: {} }] });
    assert(legacyMissingFile.some(p => p.asset_id === assetId && p.field === "animation_id"));
  });
}

main().catch(error => {
  report.harnessError = error.stack;
}).finally(() => {
  report.sourcesAfter = sources();
  report.productSourceBytesUnchanged =
    JSON.stringify(report.sourcesBefore) === JSON.stringify(report.sourcesAfter);
  const counts = { PASS: 0, FAILED: 0 };
  for (const test of report.tests) counts[test.status]++;
  report.counts = counts;
  report.status = report.harnessError || !report.productSourceBytesUnchanged
    ? "ERROR" : report.tests.length !== 11 || counts.FAILED > 0 ? "FAILED" : "PASS";
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({
    status: report.status, counts, productSourceBytesUnchanged: report.productSourceBytesUnchanged,
    report: path.join(output, "report.json"), harnessError: report.harnessError,
  }, null, 2));
  process.exitCode = report.status === "PASS" ? 0 : 1;
});
