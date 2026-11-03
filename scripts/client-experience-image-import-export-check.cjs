#!/usr/bin/env node
"use strict";

const Module = require("node:module");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function loadPublicApi() {
  const esbuild = require("../editor/node_modules/esbuild");
  const result = esbuild.buildSync({
    stdin: {
      contents: [
        "export { createImportedUIImageAsset, assetRefToManifestItem } from './editor/src/utils/projectAssets';",
        "export { exportEditorPreviewDirectory } from './editor/src/cartridge/exportCartridge';",
        "export { getDefaultUISkinLayout } from './shared/cartridge/uiSkin';",
      ].join("\n"),
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: "output/automated/client-experience-enhancement/image-import-export-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    write: false,
    logLevel: "silent",
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error("Unable to bundle image-import export check.");
  const compiled = new Module(path.join(ROOT, "output/automated/image-import-export-entry.cjs"), module);
  compiled.filename = path.join(ROOT, "output/automated/image-import-export-entry.cjs");
  compiled.paths = Module._nodeModulePaths(ROOT);
  compiled._compile(output, compiled.filename);
  return compiled.exports;
}

function expect(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `; ${JSON.stringify(details)}` : ""}`);
}

async function main() {
  const {
    assetRefToManifestItem,
    createImportedUIImageAsset,
    exportEditorPreviewDirectory,
    getDefaultUISkinLayout,
  } = loadPublicApi();
  const asset = createImportedUIImageAsset(
    { name: "export-button.png", type: "image/png", size: 1 },
    "data:image/png;base64,AA==",
    new Set(),
    "2026-07-10T00:00:00.000Z",
  );
  const manifestItem = assetRefToManifestItem(asset);
  const uiSkin = getDefaultUISkinLayout();
  const titleScreen = uiSkin.screens.find((screen) => screen.screen_id === "title");
  expect(Boolean(titleScreen), "Default UI skin is missing title screen");
  titleScreen.components.push({
    component_id: "title_custom_button_image_import_export",
    component_type: "main_menu_custom_button",
    label: "Official",
    visible: true,
    rect: { x: 6, y: 84, width: 20, height: 7 },
    style: { backgroundImage: `asset:${asset.asset_id}` },
  });
  const script = {
    schema_version: "1.0.0",
    game_id: "custom_button_image_import_export",
    title: "Custom Button Image Import Export",
    entry_scene_id: "scene_start",
    characters: [],
    scenes: [{
      scene_id: "scene_start",
      title: "Start",
      summary: "Export acceptance",
      chapter: 1,
      tags: ["acceptance"],
      commands: [{ type: "narration", text: "Export acceptance." }],
      is_ending: true,
    }],
  };
  const result = await exportEditorPreviewDirectory({
    script,
    title: script.title,
    author: "AgentVN QA",
    version: "0.1.0",
    language: "zh-CN",
    description: "Direct button image import export acceptance.",
    includeGallery: false,
    includeMetadata: false,
    projectAssets: [manifestItem],
    projectAssetRefs: [asset],
    uiSkin,
  });
  expect(result.errors.length === 0, "Preview export returned errors", result.errors);
  const exportedAsset = result.assets.find((item) => item.assetId === asset.asset_id);
  expect(Boolean(exportedAsset), "Imported UI asset was not included in preview export", result.assets);
  expect(exportedAsset.cartridgePath === asset.metadata.project_path, "Exported path differs from project path", exportedAsset);
  expect(exportedAsset.data instanceof Uint8Array && exportedAsset.data.byteLength === 1, "Export did not decode imported data URL", exportedAsset);
  expect(
    result.manifest.assets.some((item) => item.asset_id === asset.asset_id && item.path === asset.metadata.project_path),
    "Manifest does not include imported UI asset",
    result.manifest.assets,
  );
  console.log(JSON.stringify({
    ok: true,
    assetId: asset.asset_id,
    cartridgePath: exportedAsset.cartridgePath,
    byteLength: exportedAsset.data.byteLength,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
