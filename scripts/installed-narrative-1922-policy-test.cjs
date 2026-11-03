"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateNarrativePreparation } = require("./lib/installed-narrative-1922-policy.cjs");
const exportAttempt = process.argv[2] || "48"; assert.match(exportAttempt, /^\d{2}$/);
const exportedPath = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${exportAttempt}/report.json`;
const exported = JSON.parse(fs.readFileSync(exportedPath, "utf8"));
const descriptor = p => ({ path: path.resolve(p), sha256: sha(p) });
const installed = JSON.parse(fs.readFileSync(exported.installation.path, "utf8"));
const prep = {
  status: "PASS", sessionRoot: "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-narrative-1922-01",
  defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
  installation: exported.installation, executable: descriptor(path.join(installed.installRoot, "agentvn-player.exe")),
  exported: descriptor(exportedPath), fixture: exported.fixture, cartridges: exported.cartridges,
};
assert.doesNotThrow(() => validateNarrativePreparation(prep));
const mutations = [
  p => { p.status = "RUNNING"; }, p => { p.sessionRoot = "D:/AgentVN"; },
  p => { p.sessionRoot += "/nested"; }, p => { p.defaultStorage = "PHYSICAL_DEFAULT_PATH"; },
  p => { p.executable.sha256 = "wrong"; }, p => { p.installation.sha256 = "wrong"; },
  p => { p.exported.sha256 = "wrong"; }, p => { p.fixture.inputSha256 = "wrong"; },
  p => { p.cartridges.pop(); }, p => { p.fixture.voice.listeningAcceptanceClaim = true; },
];
for (const mutate of mutations) {
  const p = structuredClone(prep); mutate(p); assert.throws(() => validateNarrativePreparation(p));
}
console.log(JSON.stringify({ status: "PASS", accepted: 1, rejectedVariants: mutations.length,
  scope: "QA_SCOPE_AND_SOURCE_GUARD_NO_PRODUCT_START_OR_MODEL" }));
