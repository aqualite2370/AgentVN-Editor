"use strict";
// Add actual old-UI profile creation to the preserved same-directory NSIS chain.
// Product binaries, the historical chain and its reports are never rewritten.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { augment, selfTest } = require("./lib/editor-profile-upgrade-flow.cjs");
const [action, configFile] = process.argv.slice(2);
assert(["--self-test", "run", "audit", "cleanup", "verify-cleanup"].includes(action));
const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
assert.equal(config.profileUpgrade, true);
assert.equal(config.oldVersion, "1.9.33"); assert.equal(config.version, "1.9.34");
assert.match(config.out, /^F:\/AgentVN\/QA\/Editor-Profile-Upgrade-1934-20261029-\d{2}$/);
const original = path.join(__dirname, "editor-candidate-upgrade.cjs");
assert.equal(sha(original), "9d94cfd2721ab8b5479b8f97ab6bc86db59d1565eeb56c4d4c22f41dab690278");
let source = fs.readFileSync(original, "utf8");
function one(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, () => after);
}
one('if (kind !== "session") new vm.Script(Module.wrap(source));',
  'if (kind === "business") source = require("./lib/editor-profile-upgrade-flow.cjs").augment(source);\n' +
  '  if (kind !== "session") new vm.Script(Module.wrap(source));');
one("files: [__filename, configFile, c.actualInstallation.path, c.oldInstaller.path, sealed,",
  `files: [__filename, ${JSON.stringify(original)}, require.resolve("./lib/editor-profile-upgrade-flow.cjs"),
      require.resolve("./lib/controlled-assistant-provider.cjs"), configFile, c.actualInstallation.path, c.oldInstaller.path, sealed,`);
one("if (require.main === module) main();", "main();");
new vm.Script(Module.wrap(source));
if (action === "--self-test") selfTest();
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
