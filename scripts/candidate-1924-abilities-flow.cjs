"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateAbilitiesPreparation, adaptAbilitiesFlow, loadAdaptedFlow } = require("./lib/candidate-1924-abilities-adapter.cjs");
const index = process.argv.indexOf("--current-native-preparation");
assert(index > 0 && process.argv[index + 1]);
const prep = JSON.parse(fs.readFileSync(process.argv[index + 1], "utf8").replace(/^\uFEFF/, ""));
validateAbilitiesPreparation(prep);
const original = path.join(__dirname, "installed-runtime-abilities-playwright.cjs");
const { source, adaptations } = adaptAbilitiesFlow(fs.readFileSync(original, "utf8"));
const out = path.resolve(process.argv[2]);
assert.equal(path.dirname(out), prep.sessionRoot);
assert.match(path.basename(out), /^cell-(0[1-9]|1[0-2])$/);
const executed = out + "-executed.cjs";
new (require("node:vm").Script)(Module.wrap(source), { filename: executed });
fs.writeFileSync(executed, source, { flag: "wx" });
fs.writeFileSync(out + "-adaptations.json", JSON.stringify({
  original: { path: original, sha256: sha(original) },
  executed: { path: executed, sha256: sha(executed) }, adaptations,
}, null, 2), { flag: "wx" });
loadAdaptedFlow(source, __filename, module);
