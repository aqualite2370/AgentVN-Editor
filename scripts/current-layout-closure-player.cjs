"use strict";
// Preserve the historical Player/profile scripts. Bind their exact assertions
// to the current candidate and a fresh, equally restricted profile archive.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict"), vm = require("node:vm");
const closure = require("./current-layout-closure.cjs");
const base = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Editor-1.9.35-20261101-01";
const configFile = path.join(qa, "current-layout-candidate.json");
const layoutRoot = "F:/AgentVN/QA/Installed-Layout-20261101-01";
const playerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01";
const config = closure.validateCandidateConfig(JSON.parse(fs.readFileSync(configFile, "utf8")));
deriveActual(config.actual, config.version);
const mode = process.argv[2];
assert(["self-test", "run"].includes(mode));
const original = path.join(__dirname, "installed-authored-layout-player.cjs");
const profile = path.join(__dirname, "native-dev-preview-profile.ps1");
const guard = "'^Native-(Dev-Preview-(Repair-)?|Runtime-State-)20261020-\\d{2}$'";
const restrictedGuard = "'^Native-Runtime-State-20261101-01$'";
const profileSource = fs.readFileSync(profile, "utf8");
assert.equal(profileSource.split(guard).length - 1, 1);
const adaptedProfile = profileSource.replace(guard, () => restrictedGuard);
const prepare = path.join(qa, "layout-closure-native-player-preparation-01");
const helper = path.join(prepare, "exact-current-player-profile.ps1");
const moved = closure.relocate(fs.readFileSync(original, "utf8"));
const needle = 'path.resolve(__dirname, "native-dev-preview-profile.ps1")';
assert.equal(moved.source.split(needle).length - 1, 1);
const source = moved.source.replace(needle, JSON.stringify(helper));
new vm.Script(Module.wrap(source));
if (mode === "self-test") {
  assert(adaptedProfile.includes(restrictedGuard) && !adaptedProfile.includes(guard));
  assert.equal(adaptedProfile.replace(restrictedGuard, () => guard), profileSource,
    "All profile protection and restoration code must remain byte-for-byte unchanged");
  console.log(JSON.stringify({ status: "PASS", checked: ["same actual candidate",
    "only profile root guard changed", "unchanged profile restoration", "compiled Player assertions"] }));
} else {
  fs.mkdirSync(prepare, { recursive: false });
  fs.writeFileSync(helper, adaptedProfile, { flag: "wx" });
  const executed = path.join(prepare, "adapted-executed-test.cjs");
  fs.writeFileSync(executed, source, { flag: "wx" });
  const describe = file => ({ path: path.resolve(file), sha256: sha(file) });
  fs.copyFileSync(__filename, path.join(prepare, "frozen-adapter.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(prepare, "binding.json"), JSON.stringify({
    actual: config.actual, source: describe(original), executed: describe(executed),
    adapter: describe(__filename), profileSource: describe(profile), profileExecuted: describe(helper),
    relocations: moved.edits, profileGuard: { before: guard, after: restrictedGuard },
    productChanges: 0, builds: 0, modelRequests: 0,
  }, null, 2), { flag: "wx" });
  process.argv = [process.execPath, original, configFile, `${layoutRoot}/editor-03/report.json`, "01"];
  const worker = new Module(original, module);
  worker.filename = original; worker.paths = Module._nodeModulePaths(path.dirname(original));
  worker.require = function (request) {
    if (request === "./candidate-layout-consumption.cjs")
      return { ...base, validateCandidateConfig: closure.validateCandidateConfig };
    return Module.prototype.require.call(this, request);
  };
  worker._compile(source, original);
}
