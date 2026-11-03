"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateDevNarrativePreparation } = require("./lib/dev-narrative-preparation.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), sha256: sha(p) });
const buildPath = "F:/AgentVN/QA/Narrative-Geometry-Source-20261024-01/build-01/report.json";
const exportPath = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-49/report.json";
const build = read(buildPath), exported = read(exportPath);
const sessionRoot = path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01/dev-narrative-20261024-01");
const prep = { status: "PASS", scope: "CURRENT_DEV_NATIVE_NARRATIVE_NOT_INSTALLED_ACCEPTANCE",
  sessionRoot, defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
  build: desc(buildPath), executable: desc(build.preview.path), exported: desc(exportPath),
  fixture: exported.fixture, cartridges: exported.cartridges,
  temporary: path.join(sessionRoot, "temporary"), webview: path.join(sessionRoot, "webview") };
assert.doesNotThrow(() => validateDevNarrativePreparation(prep));
const mutations = [
  p => { p.status = "RUNNING"; }, p => { p.scope = "ACTUAL_INSTALLED_ACCEPTANCE"; },
  p => { p.sessionRoot = "D:/AgentVN"; }, p => { p.sessionRoot += "/nested"; },
  p => { p.defaultStorage = "PHYSICAL_DEFAULT_PATH"; }, p => { p.build.sha256 = "wrong"; },
  p => { p.executable.sha256 = "wrong"; }, p => { p.executable.path = build.dev.path; },
  p => { p.exported.sha256 = "wrong"; }, p => { p.fixture.inputSha256 = "wrong"; },
  p => { p.cartridges.pop(); }, p => { p.fixture.voice.listeningAcceptanceClaim = true; },
  p => { p.temporary = "C:/Windows/Temp"; }, p => { p.webview = "C:/Users/1/AppData/Local"; },
];
for (const mutate of mutations) {
  const p = structuredClone(prep); mutate(p); assert.throws(() => validateDevNarrativePreparation(p));
}
console.log(JSON.stringify({ status: "PASS", accepted: 1, rejectedVariants: mutations.length,
  scope: "DEV_QA_SOURCE_AND_ISOLATION_GUARD_NO_PRODUCT_OR_MODEL_START" }));
