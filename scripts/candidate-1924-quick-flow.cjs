"use strict";
// Run the unchanged quick business assertions with explicit candidate adapters.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateCandidateQuickPreparation, adaptQuickFlow, adaptQuickSession,
  adaptQuickValidator, loadModule } = require("./lib/candidate-1924-quick-adapter.cjs");
const index = process.argv.indexOf("--current-native-preparation");
assert(index > 0 && process.argv[index + 1]);
assert(!process.argv.includes("--smoke"), "Full quick exception matrix is required");
const prep = JSON.parse(fs.readFileSync(process.argv[index + 1], "utf8").replace(/^\uFEFF/, ""));
validateCandidateQuickPreparation(prep, prep.sessionRoot);
const mappings = [
  ["flow", path.join(__dirname, "installed-runtime-quick-gaps-playwright.cjs"), adaptQuickFlow],
  ["session", path.join(__dirname, "lib/installed-runtime-session.cjs"), adaptQuickSession],
  ["validator", path.join(__dirname, "native-runtime-quick-audit.cjs"), adaptQuickValidator],
];
const adaptations = [];
let flow;
for (const [name, original, adapt] of mappings) {
  const result = adapt(fs.readFileSync(original, "utf8"));
  const executed = path.join(prep.sessionRoot, `${name}-executed.cjs`);
  new vm.Script(Module.wrap(result.source), { filename: executed });
  fs.writeFileSync(executed, result.source, { flag: "wx" });
  adaptations.push({ name, original: { path: original, sha256: sha(original) },
    executed: { path: executed, sha256: sha(executed) }, adaptations: result.adaptations });
  if (name === "flow") flow = result.source;
}
fs.writeFileSync(path.join(prep.sessionRoot, "flow-adaptations.json"),
  JSON.stringify(adaptations, null, 2), { flag: "wx" });
loadModule(flow, __filename);
