"use strict";
// Preserve the real legacy database migration flow; replace only native input.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const [action, configFile, auditId] = process.argv.slice(2);
assert(["self-test", "run", "audit", "cleanup", "verify-cleanup"].includes(action));
const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
assert.equal(config.version, "1.9.35"); assert.equal(config.oldVersion, "1.7.1");
assert.equal(config.closeMode, "repository-native");
require("./editor-candidate-upgrade.cjs").validateConfig(config);
const auditing = action === "audit";
if (auditing) assert.match(auditId || "", /^\d{2}$/);
const original = path.join(__dirname, auditing ? "editor-cross-candidate-audit.cjs" : "editor-cross-candidate.cjs");
assert.equal(sha(original), auditing ? "a0031356b79acbda46fd2e2a8cc318ae9a0aee126497a76ebd4313941cc19934"
  : "d5a772bd1d6c72b08eb7157202bd3dfc789ed84e1c0a127779d0727805c6ebee");
let source = fs.readFileSync(original, "utf8").replaceAll("1.9.31", config.version)
  .replaceAll("1_9_31", "1_9_35").replaceAll("Editor跨代1931", "Editor跨代1935");
const one = (before, after) => {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, () => after);
};
if (!auditing) {
  one('c.closeMode === undefined || c.closeMode === "computer-use"', 'c.closeMode === "repository-native"');
  one('psOne("\'D:\\\\AgentVN\\\\scripts\\\\editor-candidate-upgrade.cjs\'",',
    `psOne(${JSON.stringify("'" + require.resolve("./editor-candidate-upgrade.cjs") + "'")},`);
  one("  return { source, session, changes };",
    `  source=require("./lib/editor-cross-repository-native.cjs").business(source);
  session=session.replace("'D:\\\\AgentVN\\\\plans\\\\ACTIVE_TASKS.md'",
    ${JSON.stringify("'" + path.resolve(__dirname, "../plans/ACTIVE_TASKS.md") + "'")});
  return { source, session, changes };`);
  one("files: [__filename, configFile, c.actualInstallation.path, c.oldInstaller.path,",
    `files: [__filename, ${JSON.stringify(original)}, require.resolve("./lib/editor-cross-repository-native.cjs"),
      require.resolve("./lib/editor-upgrade-wm-close.cjs"), require.resolve("./lib/windows-repository-native.cjs"),
      path.join(__dirname,"editor-migration-consent-uia.ps1"),
      configFile, c.actualInstallation.path, c.oldInstaller.path,`);
  one("if (require.main === module) main();", "main();");
} else {
  one('assert.equal(receipt.method, "Computer Use native Yes"); assert.equal(receipt.physicalInput, true);',
    'require("./lib/editor-cross-repository-native.cjs").validateConsent(req,receipt);');
  one('read(path.join(root, "physical-old-close-observation.json"))',
    'read(path.join(root, "old-close-observation.json"))');
  one('assert.equal(observation.physicalInput, true);',
    'require("./lib/editor-cross-repository-native.cjs").validateFailedOld(observation,launch);');
  one('read(path.join(root, `computer-use-close-${launch.label}-request.json`))',
    'read(path.join(root, launch.label+"-close-request.json"))');
  one("validateNativeCloseReceipt(request, result);",
    'require("./lib/editor-upgrade-wm-close.cjs").validate(result,launch,r.known);');
  one('"current-physical-closes-old-limitation-and-zero-residual"',
    '"current-WM_CLOSE-natural-exits-old-limitation-and-zero-residual"');
  one("currentNormalPhysicalCloses: 2", "currentNormalWMCloses: 2");
  one('scope: "REAL_NSIS_CROSS_GENERATION_PROJECT_THEME_MIGRATION_AND_CURRENT_PHYSICAL_CLOSE"',
    'scope: "REAL_NSIS_CROSS_GENERATION_PROJECT_THEME_MIGRATION_AND_WM_CLOSE_NOT_PHYSICAL_INPUT"');
}
new vm.Script(Module.wrap(source));
process.argv = [process.argv[0], __filename, ...(auditing ? [configFile, auditId] : [action, configFile])];
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker._compile(source, __filename);
