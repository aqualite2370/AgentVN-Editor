#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const JSZip = require("../editor/node_modules/jszip");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(
  ROOT,
  "output",
  "automated",
  "client-experience-enhancement",
  "custom-button-export",
);

function resetOutput() {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function loadPublicApi() {
  const esbuild = require("../editor/node_modules/esbuild");
  const result = esbuild.buildSync({
    stdin: {
      contents: [
        "export { exportEditorCartridge } from './editor/src/cartridge/exportCartridge';",
        "export { createImportedUIImageAsset, assetRefToManifestItem } from './editor/src/utils/projectAssets';",
        "export { getDefaultUISkinLayout } from './shared/cartridge/uiSkin';",
        "export { importRuntimeCartridge } from './GameCli_framework/src/cartridge/importCartridge';",
        "export { importCartridgeFromFile } from './GameCli_framework/src/cartridge/desktopLibrary';",
      ].join("\n"),
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: "output/automated/custom-button-export-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error("Unable to bundle custom-button export acceptance.");
  const filename = path.join(OUTPUT_DIR, "custom-button-export-entry.cjs");
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(ROOT);
  compiled._compile(output, filename);
  return compiled.exports;
}

function expect(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `; ${JSON.stringify(details)}` : ""}`);
}

function buildScript(gameId) {
  return {
    schema_version: "1.0.0",
    game_id: gameId,
    title: "Custom Button Export",
    entry_scene_id: "scene_start",
    characters: [],
    scenes: [{
      scene_id: "scene_start",
      title: "Start",
      summary: "Custom button export acceptance.",
      chapter: 1,
      tags: ["acceptance"],
      commands: [{ type: "narration", text: "Export acceptance." }],
      is_ending: true,
    }],
  };
}

function addCustomButton(uiSkin, component) {
  const title = uiSkin.screens.find((screen) => screen.screen_id === "title");
  if (!title) throw new Error("Default UI skin is missing title screen.");
  title.components.push(component);
}

async function exportWithAsset(api) {
  const asset = api.createImportedUIImageAsset(
    { name: "official-button.png", type: "image/png", size: 1 },
    "data:image/png;base64,AA==",
    new Set(),
    "2026-07-10T00:00:00.000Z",
  );
  const manifestItem = api.assetRefToManifestItem(asset);
  const uiSkin = api.getDefaultUISkinLayout();
  addCustomButton(uiSkin, {
    component_id: "title_custom_button_export",
    component_type: "main_menu_custom_button",
    label: "官方网站",
    visible: true,
    rect: { x: 6, y: 88, width: 20, height: 7 },
    mobileRect: { x: 6, y: 90, width: 27, height: 6 },
    style: {
      backgroundImage: `asset:${asset.asset_id}`,
      backgroundFit: "cover",
      color: "#f6f8ff",
    },
    action: {
      kind: "external_url",
      url: "https://example.com/official",
      open_mode: "system_browser",
    },
  });
  const result = await api.exportEditorCartridge({
    script: buildScript("custom_button_export"),
    title: "Custom Button Export",
    author: "AgentVN QA",
    version: "0.1.0",
    language: "zh-CN",
    description: "Custom button export acceptance.",
    includeGallery: false,
    includeMetadata: false,
    projectAssets: [manifestItem],
    projectAssetRefs: [asset],
    uiSkin,
  });
  return { asset, manifestItem, result };
}

async function exportMissingAsset(api) {
  const uiSkin = api.getDefaultUISkinLayout();
  addCustomButton(uiSkin, {
    component_id: "title_custom_button_missing_asset",
    component_type: "main_menu_custom_button",
    label: "缺图仍显示文字",
    visible: true,
    rect: { x: 6, y: 88, width: 20, height: 7 },
    mobileRect: { x: 6, y: 90, width: 27, height: 6 },
    style: {
      backgroundImage: "asset:missing-button-art",
      backgroundFit: "cover",
      color: "#f6f8ff",
    },
    action: { kind: "none" },
  });
  return api.exportEditorCartridge({
    script: buildScript("custom_button_missing_asset"),
    title: "Custom Button Missing Asset",
    author: "AgentVN QA",
    version: "0.1.0",
    language: "zh-CN",
    description: "Missing asset tolerance acceptance.",
    includeGallery: false,
    includeMetadata: false,
    projectAssets: [],
    projectAssetRefs: [],
    uiSkin,
  });
}

async function main() {
  resetOutput();
  const localStorageValues = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => localStorageValues.get(key) ?? null,
      setItem: (key, value) => localStorageValues.set(key, String(value)),
      removeItem: (key) => localStorageValues.delete(key),
      clear: () => localStorageValues.clear(),
    },
  };
  const api = loadPublicApi();
  const checks = [];
  const { asset, manifestItem, result } = await exportWithAsset(api);
  expect(result.errors.length === 0, "Cartridge export returned errors", result.errors);
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  fs.writeFileSync(path.join(OUTPUT_DIR, result.fileName), bytes);
  const zip = await JSZip.loadAsync(bytes);
  const layoutEntry = zip.file("ui/layout.json");
  expect(Boolean(layoutEntry), "Archive is missing ui/layout.json");
  const layout = JSON.parse(await layoutEntry.async("string"));
  const button = layout.screens
    .find((screen) => screen.screen_id === "title")
    ?.components.find((component) => component.component_id === "title_custom_button_export");
  expect(Boolean(button), "ui/layout.json is missing the custom button");
  expect(button.label === "官方网站", "Exported custom button label changed", button);
  expect(button.action?.kind === "external_url", "Exported action kind changed", button.action);
  expect(button.action?.url === "https://example.com/official", "Exported action URL changed", button.action);
  expect(button.style?.backgroundImage === `asset:${asset.asset_id}`, "Stable image reference changed", button.style);
  checks.push("ui/layout.json preserves custom button label/action/asset reference");

  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const exportedManifestAsset = manifest.assets.find((item) => item.asset_id === asset.asset_id);
  expect(Boolean(exportedManifestAsset), "manifest.json is missing the custom button image", manifest.assets);
  expect(exportedManifestAsset.path === manifestItem.path, "Manifest image path changed", exportedManifestAsset);
  const archivedAsset = zip.file(exportedManifestAsset.path);
  expect(Boolean(archivedAsset), "Archive is missing the custom button image file", exportedManifestAsset);
  expect((await archivedAsset.async("uint8array")).byteLength === 1, "Archived image bytes are incorrect");
  checks.push("manifest entry and physical custom button image are both packaged");

  const imported = await api.importRuntimeCartridge(new File(
    [bytes],
    result.fileName,
    { type: "application/vnd.agentvn.cartridge" },
  ));
  const importedButton = imported.cartridge.uiSkin?.screens
    .find((screen) => screen.screen_id === "title")
    ?.components.find((component) => component.component_id === "title_custom_button_export");
  expect(imported.validation.ok, "GameCli import validation failed", imported.validation);
  expect(importedButton?.label === "官方网站", "GameCli import lost the custom button label", importedButton);
  expect(importedButton?.action?.url === "https://example.com/official", "GameCli import lost the safe action", importedButton);
  const resolvedAssetUrl = imported.cartridge.uiAssetBlobUrls?.[`asset:${asset.asset_id}`];
  expect(
    typeof resolvedAssetUrl === "string" && resolvedAssetUrl.startsWith("blob:"),
    "GameCli import did not resolve asset:<id> to a runtime Blob URL",
    imported.cartridge.uiAssetBlobUrls,
  );
  checks.push("GameCli import preserves button data and resolves asset:<id> to a Blob URL");

  const libraryImported = await api.importCartridgeFromFile(new File(
    [bytes],
    result.fileName,
    { type: "application/vnd.agentvn.cartridge" },
  ), []);
  expect(libraryImported.validation.ok, "Game library production import validation failed", libraryImported.validation);
  expect(
    libraryImported.game.uiAssetUrls?.[`asset:${asset.asset_id}`]?.startsWith("blob:"),
    "Game library production import did not resolve the custom button image",
    libraryImported.game.uiAssetUrls,
  );
  checks.push("actual browser game-library import uses the same validation and stable asset resolution");

  const missingResult = await exportMissingAsset(api);
  expect(
    missingResult.warnings.some((warning) => warning.includes("missing-button-art")),
    "Missing custom button image did not produce an export warning",
    missingResult.warnings,
  );
  const missingBytes = new Uint8Array(await missingResult.blob.arrayBuffer());
  const missingImported = await api.importRuntimeCartridge(new File(
    [missingBytes],
    missingResult.fileName,
    { type: "application/vnd.agentvn.cartridge" },
  ));
  expect(missingImported.validation.ok, "Missing optional button art must not block GameCli import", missingImported.validation);
  expect(
    missingImported.validation.warnings.some((warning) => warning.code === "ui_missing_background_asset"),
    "GameCli import did not report the missing optional custom button image",
    missingImported.validation.warnings,
  );
  const missingButton = missingImported.cartridge.uiSkin?.screens
    .find((screen) => screen.screen_id === "title")
    ?.components.find((component) => component.component_id === "title_custom_button_missing_asset");
  expect(missingButton?.label === "缺图仍显示文字", "Missing image fallback lost the button text", missingButton);
  expect(!missingImported.cartridge.uiAssetBlobUrls?.["asset:missing-button-art"], "Missing image created an invalid runtime URL");
  checks.push("missing optional image produces warnings while preserving a text-button fallback");

  const libraryMissingImported = await api.importCartridgeFromFile(new File(
    [missingBytes],
    missingResult.fileName,
    { type: "application/vnd.agentvn.cartridge" },
  ), [libraryImported.index]);
  expect(
    libraryMissingImported.validation.warnings.some((warning) => warning.code === "ui_missing_background_asset"),
    "Actual game-library import did not report the missing optional image",
    libraryMissingImported.validation,
  );
  expect(
    libraryMissingImported.game.uiSkin?.screens
      .find((screen) => screen.screen_id === "title")
      ?.components.find((component) => component.component_id === "title_custom_button_missing_asset")
      ?.label === "缺图仍显示文字",
    "Actual game-library import lost the text-button fallback",
  );
  checks.push("actual game-library import preserves text fallback and returns missing-art warnings");

  const report = {
    ok: true,
    checks,
    archive: path.join(OUTPUT_DIR, result.fileName),
    assetId: asset.asset_id,
    assetPath: exportedManifestAsset.path,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), JSON.stringify({
    ok: false,
    error: String(error.stack || error),
  }, null, 2), "utf8");
  console.error(error.stack || error);
  process.exit(1);
});
