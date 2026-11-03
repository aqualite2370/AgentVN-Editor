#!/usr/bin/env node
"use strict";

/*
 * Builds a .vncart from either a portable ZIP .vnproj or a legacy JSON
 * .vnproj.  It deliberately reads ZIP assets as raw bytes so large desktop
 * projects never have to turn every asset into a base64 data URL first.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { loadProjectContainer } = require("./project-container.cjs");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const inputPath = required("--input");
const outputPath = required("--output");

function required(name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : "";
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path.`);
  return path.resolve(value);
}

function readOptional(name, fallback = "") {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : "";
  return value && !value.startsWith("--") ? value : fallback;
}

function loadExportApi() {
  const esbuild = require(path.join(root, "editor", "node_modules", "esbuild"));
  const result = esbuild.buildSync({
    stdin: {
      contents: [
        "export { exportEditorCartridge } from './editor/src/cartridge/exportCartridge';",
        "export { exportScript, applyProjectRuntimeSettingsToScript } from './editor/src/utils/exportScript';",
        "export { manifestAssetsFromProjectAssets } from './editor/src/utils/projectAssets';",
      ].join("\n"),
      loader: "ts",
      resolveDir: root,
      sourcefile: "scripts/build-vnproj-cartridge-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const source = result.outputFiles?.[0]?.text;
  if (!source) throw new Error("Unable to compile the trusted cartridge export entry.");
  const compiledPath = path.join(root, "output", "temporary", `build-vnproj-cartridge-${process.pid}.cjs`);
  fs.mkdirSync(path.dirname(compiledPath), { recursive: true });
  const compiled = new Module(compiledPath, module);
  compiled.filename = compiledPath;
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(source, compiledPath);
  return compiled.exports;
}

function normalizeProjectAsset(asset) {
  const metadata = { ...(asset?.metadata ?? {}) };
  return {
    ...asset,
    metadata,
  };
}

async function materializeProjectAssetBytes(loaded, assets) {
  const repairedMetadata = [];
  for (const asset of assets) {
    const projectPath = asset.metadata?.project_path;
    let bytes;
    if (loaded.container === "zip") {
      if (!projectPath || !loaded.zip?.file(projectPath)) {
        throw new Error(`PROJECT_ASSET_MISSING: ${asset.asset_id || "<unknown>"} -> ${projectPath || "<empty>"}`);
      }
      bytes = new Uint8Array(await loaded.zip.file(projectPath).async("nodebuffer"));
    } else {
      const filePath = asset.metadata?.filePath || (asset.metadata?.backend_asset_path
        ? path.join(root, "data", "backend", "project_assets", asset.metadata.backend_asset_path)
        : "");
      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error(`PROJECT_ASSET_MISSING: ${asset.asset_id || "<unknown>"} -> ${filePath || projectPath || "<empty>"}`);
      }
      bytes = new Uint8Array(fs.readFileSync(filePath));
    }
    const expected = Number(asset.metadata?.size_bytes ?? 0);
    const actualHash = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
    const expectedHash = String(asset.metadata?.hash_sha256 || "").trim().toLowerCase();
    if (expectedHash && expectedHash !== actualHash) {
      throw new Error(`PROJECT_ASSET_HASH_MISMATCH: ${asset.asset_id || projectPath} hash differs from the project manifest.`);
    }
    if (expected !== bytes.byteLength || !expectedHash) {
      repairedMetadata.push({
        assetId: asset.asset_id,
        path: projectPath,
        previousSizeBytes: expected || null,
        actualSizeBytes: bytes.byteLength,
        hadHash: Boolean(expectedHash),
      });
      asset.metadata.size_bytes = bytes.byteLength;
      asset.metadata.hash_sha256 = actualHash;
    }
    asset.metadata.bytes = bytes;
  }
  return { assets, repairedMetadata };
}

async function main() {
  if (!fs.existsSync(inputPath)) throw new Error(`Input project does not exist: ${inputPath}`);
  const loaded = await loadProjectContainer(inputPath);
  const project = loaded.project;
  const api = loadExportApi();
  const materialized = await materializeProjectAssetBytes(
    loaded,
    Array.isArray(project.asset_manifest) ? project.asset_manifest.map(normalizeProjectAsset) : [],
  );
  const projectAssets = Array.isArray(materialized) ? materialized : materialized.assets;
  const script = api.applyProjectRuntimeSettingsToScript(
    api.exportScript(project.nodes ?? [], project.edges ?? []),
    project.editor_settings ?? {},
  );
  const version = readOptional("--version", "0.1.0");
  const result = await api.exportEditorCartridge({
    script,
    gameId: project.project_id,
    title: project.title,
    author: project.author,
    version,
    language: readOptional("--language", "zh-CN"),
    description: readOptional("--description", ""),
    includeGallery: true,
    includeMetadata: true,
    projectAssets: api.manifestAssetsFromProjectAssets(projectAssets),
    projectAssetRefs: projectAssets,
    uiSkin: project.editor_settings?.runtimeUILayout,
    packageAppearance: project.editor_settings?.packageAppearance,
    characterDialogStyles: project.editor_settings?.characterDialogStyles,
  });
  if (result.assetReport.placeholderAssets.length || result.assetReport.missingAssets.length) {
    throw new Error(`PROJECT_ASSET_MISSING: cartridge export would contain placeholders: ${JSON.stringify(result.assetReport)}`);
  }
  const bytes = Buffer.from(await result.blob.arrayBuffer());
  const temporary = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, outputPath);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    inputPath,
    outputPath,
    container: loaded.container,
    title: result.manifest.title,
    gameId: result.manifest.game_id,
    assets: result.manifest.assets.length,
    bytes: bytes.length,
    warnings: result.warnings,
    repairedMetadata: Array.isArray(materialized) ? [] : materialized.repairedMetadata,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
