"use strict";
// Real installation upgrade and durable data tests with explicit owned teardown.
// Never report attributed termination as native/physical window-close acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
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
  remember();
  const identity={label,pid:current.pid,created:current.created,ports:current.ports,
    method:"ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE",physicalInput:false,normalClose:false};
  await forceCleanup();
  fs.writeFileSync(path.join(out,label+"-close-completed.json"),
    JSON.stringify({...identity,status:"PASS"},null,2),{flag:"wx"});
}
`);
    one('  productChanges:0,modelRequests:0,steps:[]',
      '  closeInput:"ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE",nativeCloseStatus:"BLOCKED",computerUse:"BLOCKED_NATIVE_PIPE_UNAVAILABLE",productChanges:0,modelRequests:0,steps:[]');
    one('"Not a clean machine"',
      '"Not a clean machine","Native close NOT_RUN: Computer Use unavailable and public IPC denied; owned termination only"');
  } else if (kind === "audit") {
    one("real-default-path-launches-and-Computer-Use-normal-exit",
      "real-default-path-launches-and-attributed-teardown-NOT-native-close");
    one('assert.equal(c.pid,l.pid);assert.equal(c.method,"Computer Use Alt+F4");',
      'assert.equal(c.pid,l.pid);assert.equal(c.created,l.created);assert.equal(c.label,l.label);' +
      'assert.equal(c.method,"ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE");' +
      'assert.equal(c.physicalInput,false);assert.equal(c.normalClose,false);assert.equal(c.status,"PASS");');
    one('c.label===l.label&&c.normalClose&&c.status==="PASS"&&c.killed.length===0',
      'c.label===l.label&&c.normalClose===false&&c.status==="PASS"&&c.killed.length>0');
    one('return {launches:3,normalExits:3,identities:r.known.length};',
      'return {launches:3,normalExits:0,attributedTeardowns:3,nativeClose:"BLOCKED",identities:r.known.length};');
  } else if (kind === "session") {
    one("'D:\\AgentVN\\plans\\ACTIVE_TASKS.md'",
      `'${path.resolve(__dirname, "../plans/ACTIVE_TASKS.md")}'`);
  }
  if (kind !== "session") new vm.Script(Module.wrap(source));
  return source;
}
function main() {
  assert.equal(sha(original), "ce742065bc82cfe2b2879dd6c824adce021481d26059c343efd253a89d50b980");
  const [action, configFile] = process.argv.slice(2);
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.equal(config.closeMode, "attributed-termination-not-native-close");
  assert.equal(config.profileUpgrade, true);
  assert.equal(config.version, "1.9.35"); assert.equal(config.oldVersion, "1.9.34");
  let source = fs.readFileSync(original, "utf8");
  function one(before, after) {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after);
  }
  one("  return { source, changes };",
    '  source = require("./editor-upgrade-attributed-current.cjs").augment(kind,source);\n' +
    "  return { source, changes };");
  one("files: [__filename, configFile, c.actualInstallation.path, c.oldInstaller.path, sealed,",
    `files: [__filename, ${JSON.stringify(original)}, require.resolve("./lib/editor-profile-upgrade-flow.cjs"),
      require.resolve("./lib/controlled-assistant-provider.cjs"),
      configFile, c.actualInstallation.path, c.oldInstaller.path, sealed,`);
  one("if (require.main === module) main();", "main();");
  new vm.Script(Module.wrap(source));
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  worker._compile(source, __filename);
}
module.exports = { augment };
if (require.main === module) main();
