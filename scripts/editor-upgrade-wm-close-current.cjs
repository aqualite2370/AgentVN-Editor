"use strict";
// Reuse the preserved real installation/data workflow, with owned WM_CLOSE.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const close = require("./lib/editor-upgrade-wm-close.cjs");
const original = path.join(__dirname, "editor-candidate-upgrade.cjs");
function augment(kind, text) {
  let source = text;
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, `${kind}: source drift ${before}`);
    source = source.replace(before, () => after);
  };
  if (kind === "business") {
    source = require("./lib/editor-profile-upgrade-flow.cjs").augment(source);
    const start = source.indexOf("async function closeNormally(label){");
    const end = source.indexOf("async function forceCleanup(){", start);
    assert(start > 0 && end > start);
    one(source.slice(start, end), `async function closeNormally(label){
  assert.equal(label,current.label);remember();
  const result=await require("./lib/editor-upgrade-wm-close.cjs").close({launch:current,known:report.known,out});
  await browser.close().catch(()=>{});browser=null;child=null;
  report.cleanups.push({label,status:"PASS",normalClose:true,physicalInput:false,
    method:result.method,killed:[],ports:current.ports});save();
}
`);
    one('  productChanges:0,modelRequests:0,steps:[]',
      '  closeInput:"REPOSITORY_WM_CLOSE_NATURAL_EXIT",nativeCloseStatus:"TESTED",physicalInput:false,productChanges:0,modelRequests:0,steps:[]');
    one('"Not a clean machine"',
      '"Not a clean machine","Real WM_CLOSE; Computer Use and physical Alt+F4 NOT_RUN"');
  } else if (kind === "audit") {
    one("real-default-path-launches-and-Computer-Use-normal-exit",
      "real-default-path-launches-and-WM_CLOSE-natural-exit-NOT-physical-input");
    one('assert.equal(c.pid,l.pid);assert.equal(c.method,"Computer Use Alt+F4");',
      'require("./lib/editor-upgrade-wm-close.cjs").validate(c,l,r.known);');
  } else if (kind === "session") {
    one("'D:\\AgentVN\\plans\\ACTIVE_TASKS.md'",
      `'${path.resolve(__dirname, "../plans/ACTIVE_TASKS.md")}'`);
  }
  if (kind !== "session") new vm.Script(Module.wrap(source));
  return source;
}
function profileAudit(configFile, output) {
  assert(output && !fs.existsSync(output));
  const file = path.join(__dirname, "installed-editor-upgrade-profile-audit.cjs");
  assert.equal(sha(file), "83cd5a18cb27ece3aee57627294d784c043937ec813d1738ccdc90ce306394e7");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  let source = fs.readFileSync(file, "utf8");
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after);
  };
  one('"Recent 1.9.34 upgrade only, not cross-generation database migration"',
    JSON.stringify(`Recent ${config.oldVersion} to ${config.version} upgrade only, not cross-generation database migration`));
  one('nativeClose: "BLOCKED"', 'nativeClose: "PASS_WM_CLOSE"');
  one('"Owned termination after saving; native close, Alt+F4 and live-process upgrade NOT_RUN"',
    '"Real WM_CLOSE natural exit; physical Alt+F4 and live-process upgrade NOT_RUN"');
  one('assert.equal(r.closeInput, "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE");',
    'assert.equal(r.closeInput, "REPOSITORY_WM_CLOSE_NATURAL_EXIT");');
  one('assert.equal(r.cleanups.length, 3); assert(r.cleanups.every(c => c.normalClose === false));',
    'assert.equal(r.cleanups.length, 3); assert(r.cleanups.every(c => c.normalClose === true && c.killed.length === 0));' +
    'for(const launch of r.launches)require("./lib/editor-upgrade-wm-close.cjs").validate(read(path.join(out,launch.label+"-close-completed.json")),launch,r.known);');
  process.argv.splice(2, process.argv.length - 2, configFile, config.actualInstallation.path, output);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(source, __filename);
}
function main() {
  const [action, configFile, output] = process.argv.slice(2);
  assert.equal(sha(original), "ce742065bc82cfe2b2879dd6c824adce021481d26059c343efd253a89d50b980");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.equal(config.closeMode, "repository-wm-close-natural-exit");
  assert.equal(config.profileUpgrade, true);
  assert(["1.9.34->1.9.35", "1.9.39->1.9.40", "1.9.41->1.9.42"].includes(`${config.oldVersion}->${config.version}`),
    "Only reviewed, provenance-bound upgrade pairs are supported");
  if (action === "profile-audit") return profileAudit(configFile, output);
  if (action === "--self-test") console.log(JSON.stringify(close.selfTest()));
  let source = fs.readFileSync(original, "utf8");
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after);
  };
  one("  return { source, changes };",
    '  source = require("./editor-upgrade-wm-close-current.cjs").augment(kind,source);\n' +
    "  return { source, changes };");
  one("files: [__filename, configFile, c.actualInstallation.path, c.oldInstaller.path, sealed,",
    `files: [__filename, ${JSON.stringify(original)}, require.resolve("./lib/editor-upgrade-wm-close.cjs"),
      require.resolve("./lib/windows-repository-native.cjs"), require.resolve("./lib/editor-profile-upgrade-flow.cjs"),
      require.resolve("./lib/controlled-assistant-provider.cjs"), require.resolve("./installed-editor-upgrade-profile-audit.cjs"),
      configFile, c.actualInstallation.path, c.oldInstaller.path, sealed,`);
  one("if (require.main === module) main();", "main();");
  new vm.Script(Module.wrap(source));
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(source, __filename);
}
module.exports = { augment };
if (require.main === module) main();
