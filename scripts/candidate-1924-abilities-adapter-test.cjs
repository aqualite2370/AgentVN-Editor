"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { adaptAbilitiesFlow, validateAbilitiesPreparation, loadAdaptedFlow } = require("./lib/candidate-1924-abilities-adapter.cjs");
const file = path.join(__dirname, "installed-runtime-abilities-playwright.cjs"), before = sha(file);
const original = fs.readFileSync(file, "utf8"), { source, adaptations } = adaptAbilitiesFlow(original);
assert.equal(adaptations.length, 6);
new vm.Script(Module.wrap(source));
assert(source.includes('current === "renpy" ? 9 : 1'));
assert(source.includes("business ? 16 : crossOnly ? 1"));
assert(source.includes("validateAbilitiesPreparation(prep)"));
assert(source.includes('path.join(artifactRoot, "cross-layout-native-saves")'));
for (const change of adaptations) {
  assert.throws(() => adaptAbilitiesFlow(original.replace(change.before, "")), undefined, change.reason);
  assert.throws(() => adaptAbilitiesFlow(original + "\n" + change.before), undefined, change.reason);
}
for (const fragment of [
  'assert.equal((await snapshot()).mode, "nvl")',
  'assert.equal(cleared.nvl.length, 1)',
  'assert.equal(moved.anchor, "character")',
  'assert.equal(absent.anchor, "fallback")',
  'assert.equal(fixed.anchor, "fixed")',
  'assert.equal(retained.length, 6)',
  'assert.equal(latest.command_index, 6)',
  'assert.deepEqual(await saves(), before',
  'assert.equal(pages.join(""), original',
]) assert(source.includes(fragment), fragment);
assert.equal(sha(file), before);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file) });
const candidate = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const installation = desc(path.join(candidate, "installation.json")), installed = read(installation.path);
const originalExport = desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/report.json");
const exported = read(originalExport.path);
const sessionRoot = path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01/abilities-installed-1924-01");
const prep = { status: "PASS", scope: "INSTALLED_1_9_24_INHERITANCE_ANCHORS_QUICK_LIBRARY",
  sessionRoot, installation, originalExport, fixture: exported.fixture, cartridges: exported.cartridges,
  executable: installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),
  defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
  installId: "qa_abilities_1924_01_01", webview: path.join(sessionRoot, "webview"),
  temporary: path.join(sessionRoot, "temporary"), tools: [desc(__filename)] };
validateAbilitiesPreparation(prep);
const corruptions = [
  p => { p.scope = "CURRENT_DEV"; },
  p => { p.current1922Library = true; },
  p => { p.cartridges = []; },
  p => { p.installId = "user-game"; },
  p => { p.executable.path = path.resolve("editor/src-tauri/binaries/agentvn-player.exe"); },
  p => { p.fixture = { ...p.fixture, inputSha256: "0".repeat(64) }; },
];
for (const mutate of corruptions) {
  const bad = structuredClone(prep); mutate(bad);
  assert.throws(() => validateAbilitiesPreparation(bad));
}
const wrapper = path.join(__dirname, "candidate-1924-abilities-flow.cjs");
const loaded = loadAdaptedFlow('module.exports = { filename: __filename, bytes: ' +
  'require("node:fs").readFileSync(__filename, "utf8"), relative: require("./lib/installed-runtime-session.cjs").sha(__filename) };',
wrapper, module);
assert.equal(loaded.filename, wrapper); assert.equal(loaded.bytes, fs.readFileSync(wrapper, "utf8"));
assert.equal(loaded.relative, sha(wrapper));
assert.throws(() => loadAdaptedFlow("", path.join(__dirname, "__candidate-1924-abilities-flow.cjs"), module));
console.log(JSON.stringify({ status: "PASS", adaptations: adaptations.length, driftRejections: 12,
  preservedBusinessAssertions: 9, preparationRejections: corruptions.length,
  actualInstallationAndHistoricalFixtureVerified: true, actualModuleFilenameAndRelativeRequire: true,
  historicalToolUnchanged: true, productStarted: false }));
