#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(
  ROOT,
  "output",
  "automated",
  "client-experience-enhancement",
  "custom-button-export",
  "report.json",
);

function runExportFixture() {
  const helper = path.join(ROOT, "scripts", "client-experience-custom-button-export-check.cjs");
  const result = spawnSync(process.execPath, [helper], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "custom-button export fixture must succeed");
}

function loadSharedApi() {
  const esbuild = require("../editor/node_modules/esbuild");
  const result = esbuild.buildSync({
    stdin: {
      contents: [
        "export { loadCartridgeFromArrayBuffer } from './shared/cartridge/unpacker';",
        "export { validateManifest } from './shared/cartridge/validators';",
        "export { validateUISkinHealth, validateUISkinLayout } from './shared/cartridge/uiSkin';",
      ].join("\n"),
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: "output/automated/cartridge-schema-e2e-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error("Unable to compile cartridge schema e2e harness.");
  const filename = path.join(ROOT, "output", "automated", "cartridge-schema-e2e-entry.cjs");
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(ROOT);
  compiled._compile(output, filename);
  return compiled.exports;
}

async function main() {
  runExportFixture();
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
  assert.equal(report.ok, true, "export report must be successful");
  assert.ok(fs.existsSync(report.archive), "exported .vncart archive must exist");
  const bytes = fs.readFileSync(report.archive);
  const api = loadSharedApi();
  const cartridge = await api.loadCartridgeFromArrayBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { runtimeVersion: "0.1.0", sourceFileName: path.basename(report.archive) },
  );
  const manifestValidation = api.validateManifest(cartridge.manifest);
  const layoutValidation = api.validateUISkinLayout(cartridge.uiSkin);
  const healthValidation = api.validateUISkinHealth(cartridge.uiSkin, {
    availableAssetIds: cartridge.manifest.assets.map((asset) => asset.asset_id),
    availableAssetPaths: cartridge.manifest.assets.map((asset) => asset.path),
  });
  assert.equal(manifestValidation.ok, true, "exported manifest must pass shared validation");
  assert.equal(layoutValidation.ok, true, "exported ui/layout.json must pass shared validation");
  assert.equal(healthValidation.ok, true, "exported UI skin health must not contain errors");
  assert.ok(cartridge.uiAssetBlobUrls[`asset:${report.assetId}`]?.startsWith("blob:"), "stable UI reference must resolve after shared unpack");

  console.log(JSON.stringify({
    ok: true,
    archive: report.archive,
    checks: [
      "checksum and cartridge structure verified by shared unpacker",
      "manifest and ui/layout.json pass shared validators",
      "UI asset reference resolves after archive import",
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
