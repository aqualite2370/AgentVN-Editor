"use strict";
// Keep the historical business assertions and reports intact. Only candidate
// binding, current control count and cross-layout coverage change here.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module");
const { sha } = require("./installed-runtime-session.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const base = path.resolve("F:/AgentVN/QA/Editor-1.9.24-20261024-01");
function validateAbilitiesPreparation(prep) {
  assert.equal(prep.status, "PASS");
  assert.equal(prep.scope, "INSTALLED_1_9_24_INHERITANCE_ANCHORS_QUICK_LIBRARY");
  assert.equal(prep.current1922Library, undefined, "Do not relabel the archived 1.9.22 binding");
  assert.equal(path.dirname(prep.sessionRoot),
    path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01"));
  assert.match(path.basename(prep.sessionRoot), /^abilities-installed-1924-\d{2}$/);
  assert.match(prep.installId, /^qa_abilities_1924_\d{2}_(0[1-9]|1[0-2])$/);
  assert.equal(prep.defaultStorage, "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION");
  assert.equal(path.resolve(prep.installation.path), path.join(base, "installation.json"));
  const installed = read(prep.installation.path), packaged = read(path.join(base, "package-01/report.json"));
  assert.equal(installed.status, "PASS"); assert.equal(installed.metadataRestoration, "PASS");
  assert.equal(installed.executable.version, "1.9.24"); assert.equal(packaged.status, "PASS");
  assert.equal(installed.package.sha256, packaged.installer.sha256);
  const player = installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
  assert(player); assert.deepEqual(prep.executable, player);
  assert.equal(path.resolve(player.path), path.join(base, "installed-editor/agentvn-player.exe"));
  assert.equal(player.sha256, packaged.player.sha256);
  assert.equal(path.resolve(prep.originalExport.path),
    path.resolve("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/report.json"));
  const exported = read(prep.originalExport.path);
  assert.equal(exported.status, "PASS"); assert(exported.finishedAt && !exported.cleanupError);
  assert.equal(exported.scope, "ACTUAL_1922_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE");
  assert.equal(exported.steps.length, 3); assert(exported.steps.every(s => s.status === "PASS"));
  assert.deepEqual(prep.cartridges, exported.cartridges);
  assert.deepEqual(prep.fixture, exported.fixture); assert.equal(prep.cartridges.length, 2);
  for (const item of [prep.installation, prep.executable, prep.originalExport, installed.executable,
    ...installed.resources, ...installed.protectedFiles, packaged.installer, ...prep.cartridges, ...prep.tools])
    assert.equal(sha(item.path), item.sha256, item.path);
  assert.equal(sha(prep.fixture.input), prep.fixture.inputSha256);
  const project = read(prep.fixture.input);
  assert.equal(project.editor_settings.defaultDialogPresentation, "nvl");
  assert.deepEqual(project.editor_settings.characterDialogPresentations, { alice: "bubble", nvl_person: "nvl" });
  assert.equal(path.resolve(prep.webview), path.join(prep.sessionRoot, "webview"));
  assert.equal(path.resolve(prep.temporary), path.join(prep.sessionRoot, "temporary"));
}
function adaptAbilitiesFlow(original) {
  let source = original;
  const adaptations = [];
  function replace(before, after, reason) {
    assert.equal(source.split(before).length - 1, 1, reason);
    source = source.replace(before, after); adaptations.push({ before, after, reason });
  }
  replace("const prep = read(prepFile);",
    'const prep = read(prepFile);\nassert(currentNative && business && !current1922);\n' +
    'require("./lib/candidate-1924-abilities-adapter.cjs").validateAbilitiesPreparation(prep);',
    "Bind the actual candidate before starting any Player; require the complete business viewport path");
  replace('scope: current1922 ? "ACTUAL_1922_SHIPPED_PLAYER_LIBRARY_FRESH_CURRENT_UI_EXPORT_CONTROLLED_LIBRARY_IMPORT_NOT_STANDALONE"\n' +
    '    : currentNative ? "CURRENT_NATIVE_RELEASE_PLAYER_LIBRARY_WITH_HISTORICAL_UI_EXPORTED_FIXTURE_NOT_NEW_INSTALL_EXPORT_OR_ANDROID"\n' +
    '    : "ACTUAL_INSTALLED_PLAYER_LIBRARY_NATIVE_SAVES; NOT_STANDALONE_EXE_SETUP_ANDROID",',
    'scope: "INSTALLED_1_9_24_INHERITANCE_ANCHORS_QUICK_LIBRARY_HISTORICAL_UI_EXPORT_NOT_NEW_AUTHOR_OR_ANDROID",',
    "Record the current installation and historical fixture honestly");
  replace('current === "renpy" ? (current1922 ? 9 : 8) : 1',
    'current === "renpy" ? 9 : 1',
    "The approved current single-row quick bar has nine actions, including Hide");
  replace("  if (crossOnly) {\n", "  if (!report.layoutErrors?.length) {\n",
    "After both real layout processes, test AgentVN reads of Renpy quick and bubble saves in the same cell");
  replace("business ? 15 : crossOnly ? 1", "business ? 16 : crossOnly ? 1",
    "Require all fifteen ordinary business checks plus the actual cross-layout check");
  replace('path.join(path.dirname(fixture.input), `${path.basename(out)}-native-saves`)',
    'path.join(artifactRoot, "cross-layout-native-saves")',
    "Retain cross-layout evidence under this new run, never in a historical fixture directory");
  return { source, adaptations };
}
function loadAdaptedFlow(source, wrapperFilename, parent) {
  // Legacy flows record/read __filename at startup. Use the real wrapper file
  // in the same scripts directory, while retaining executed source separately.
  assert(fs.statSync(wrapperFilename).isFile());
  const worker = new Module(wrapperFilename, parent);
  worker.filename = wrapperFilename;
  worker.paths = Module._nodeModulePaths(path.dirname(wrapperFilename));
  worker._compile(source, wrapperFilename);
  return worker.exports;
}
module.exports = { validateAbilitiesPreparation, adaptAbilitiesFlow, loadAdaptedFlow };
