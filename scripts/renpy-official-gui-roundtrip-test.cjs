"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, ".."), requireEditor = createRequire(path.join(root, "editor/package.json"));
const out = process.argv[2];
assert(out && !fs.existsSync(out), "Preserve prior evidence");
fs.mkdirSync(out, { recursive: true });
const manifest = JSON.parse(fs.readFileSync("F:/AgentVN/Checkpoints/GUI-Scope-20261019-01/manifest.json", "utf8"));
const loaded = { exports: {} }, sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const code = requireEditor("esbuild").buildSync({
  stdin: { contents: `
    export {scanRenpyGuiArchive} from "./editor/src/renpy/renpyGuiImport";
    export {prepareRenpyGuiImport} from "./editor/src/renpy/renpyGuiImportPlan";
    export {createGuiPack,encodeGuiPack,decodeGuiPack} from "./editor/src/renpy/guiPackLibrary";
    export {prepareGuiPackApplication} from "./editor/src/renpy/guiPackApplication";
    export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";
    export {exportEditorCartridge} from "./editor/src/cartridge/exportCartridge";
    export {loadCartridgeFromArrayBuffer} from "./shared/cartridge/unpacker";
    export {validateRuntimeCartridge} from "./GameCli_framework/src/cartridge/importCartridge";
  `, loader: "ts", resolveDir: root },
  bundle: true, platform: "node", format: "cjs", packages: "external",
  define: { "import.meta.env": "{}" }, write: false, logLevel: "silent",
}).outputFiles[0].text;
new Function("module", "exports", "require", code)(loaded, loaded.exports, requireEditor);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), assets: [],
  scope: "real source scanner/transaction/exporter/Runtime unpack + validation, not GUI playthrough or installed acceptance",
  officialArchive: manifest.officialArchive, modelSubmissions: 0 };
let cartridge;
(async () => {
  const api = loaded.exports, source = fs.readFileSync(manifest.officialArchive.path);
  assert.equal(sha(source), manifest.officialArchive.sha256);
  const scan = await api.scanRenpyGuiArchive(new Uint8Array(source));
  assert.equal(scan.assets.length, 25);
  const selection = {};
  for (const [scope, fields] of Object.entries(scan.parameters.values)) for (const [key, value] of Object.entries(fields)) {
    if (key === "buttonTextColors") for (const state of Object.keys(value)) selection[`${scope}.${key}.${state}`] = true;
    else selection[`${scope}.${key}`] = true;
  }
  const layout = api.getDefaultUISkinLayout(); layout.layout_type = "renpy";
  const prefix = "官方模板 中文/game/";
  const bindings = Object.fromEntries(Object.entries({
    "gui/main_menu.png": "title_background", "gui/textbox.png": "dialog_panel",
    "gui/button/choice_idle_background.png": "choice_button",
    "gui/button/quick_idle_background.png": "button_normal",
    "gui/button/quick_hover_background.png": "button_hover",
    "DejaVuSans.ttf": "interface_font",
  }).map(([relative, role]) => [prefix + relative, role]));
  const reviewedPack = process.argv.includes("--library") ? api.decodeGuiPack(api.encodeGuiPack(api.createGuiPack(scan, {
    name: "官方完整GUI模板", sourceName: "官方完整界面模板.zip", parameterSelection: selection,
    assetBindings: bindings, assetPaths: scan.assets.map(asset => asset.path),
  }))) : null;
  if (reviewedPack) {
    report.library = { revision: reviewedPack.revision, assets: reviewedPack.assetCount,
      sourceName: reviewedPack.sourceName, noProjectIdentity: !Object.hasOwn(reviewedPack, "projectId") };
    assert.equal(reviewedPack.assetCount, 25);
    for (const asset of reviewedPack.scan.assets) assert.equal(sha(asset.bytes), sha(scan.assets.find(a => a.path === asset.path).bytes));
  }
  const importOptions = { layout, existingAssets: [], scan: reviewedPack?.scan ?? scan,
    parameterSelection: selection, assetSelection: Object.fromEntries(scan.assets.map(a => [a.path, "add"])),
    assetBindings: bindings };
  const prepared = reviewedPack
    ? api.prepareGuiPackApplication({ ...importOptions, scope: { kind: "project" } })
    : api.prepareRenpyGuiImport(importOptions);
  assert.equal(prepared.assets.length, 25);
  assert.equal(prepared.layout.renpy.shared.fontSize, 22);
  assert.equal(prepared.layout.renpy.shared.spacing, 4);
  assert.equal(prepared.layout.renpy.save_load.saveColumns, 3);
  const result = await api.exportEditorCartridge({
    gameId: "gui_scope_roundtrip_20261019", title: "官方GUI作用域往返", author: "QA",
    version: "1.0.0", language: "zh-CN", description: "", includeGallery: false, includeMetadata: true,
    uiSkin: prepared.layout, projectAssetRefs: prepared.assets,
    projectAssets: prepared.assets.map(asset => ({ asset_id: asset.asset_id, asset_type: asset.asset_type,
      path: asset.metadata.project_path, filename: asset.metadata.filename, mime_type: asset.metadata.mime_type,
      size_bytes: asset.metadata.size_bytes })),
    script: { schema_version: "1.1.0", game_id: "gui_scope_roundtrip_20261019", title: "官方GUI作用域往返",
      entry_scene_id: "scene", characters: [], scenes: [{ scene_id: "scene", title: "临时场景", chapter: 1,
        tags: [], commands: [{ type: "narration", text: "本片为临时工程静态往返，不代证玩家运行。" }] }] },
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.assetReport.placeholderAssets, []);
  const bytes = Buffer.from(await result.blob.arrayBuffer());
  const productFolder = path.join("F:/AgentVN/QA/GUI-Scope-20261019-01", path.basename(out));
  fs.mkdirSync(productFolder, { recursive: true });
  const target = path.join(productFolder, "官方GUI作用域往返.vncart");
  fs.writeFileSync(target, bytes, { flag: "wx" });
  report.cartridge = { path: target, sha256: sha(bytes), bytes: bytes.length };
  cartridge = await api.loadCartridgeFromArrayBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { maxPackageSizeMB: 32, maxSingleFileSizeMB: 8 },
  );
  const validation = api.validateRuntimeCartridge(cartridge);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors)); report.runtimeValidation = validation;
  assert.deepEqual(cartridge.uiSkin.renpy, prepared.layout.renpy);
  report.values = cartridge.uiSkin.renpy;
  for (const asset of cartridge.manifest.assets) {
    const imported = prepared.assets.find(a => a.asset_id === asset.asset_id); assert(imported);
    const sourcePath = imported.metadata.tags.find(t => t.startsWith("renpy_gui_path:")).slice("renpy_gui_path:".length);
    const expected = manifest.officialFiles.find(file => prefix + file.relative === sourcePath); assert(expected);
    const url = cartridge.assetBlobUrls[asset.asset_id]; assert(url);
    const hash = sha(Buffer.from(await (await fetch(url)).arrayBuffer())); assert.equal(hash, expected.sha256);
    report.assets.push({ id: asset.asset_id, sourcePath, sha256: hash });
  }
  for (const sourcePath of Object.keys(bindings))
    assert(report.assets.some(a => a.sourcePath === sourcePath), `Missing actual bound dependency ${sourcePath}`);
  assert(report.assets.length >= 6);
  // This records current exporter behavior; unused-resource pruning is a different open defect.
  report.unusedResourcePruningNotAssessed = true;
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => {
  for (const url of Object.values(cartridge?.assetBlobUrls ?? {})) URL.revokeObjectURL(url);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, assets: report.assets.length, error: report.error, output: out }));
});
