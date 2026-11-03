"use strict";
// Keep the preserved real-NSIS/default-profile workflow. Substitute only the
// unavailable physical-close input with the installed public native-close API.
// This is explicitly NOT Computer Use, Alt+F4, or a physical close-button test.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const original = path.join(__dirname, "editor-candidate-upgrade.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
function augment(kind, text) {
  let source = text;
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, `${kind}: source drift ${before}`);
    source = source.replace(before, () => after);
  };
  if (kind === "business") {
    const start = source.indexOf("async function closeNormally(label){");
    const end = source.indexOf("async function forceCleanup(){", start);
    assert(start > 0 && end > start);
    one(source.slice(start, end), `async function closeNormally(label){
  remember();
  let result;
  try{
    result=await require("./lib/installed-background-close.cjs").closeInstalledWindow(current);
  }catch(error){
    fs.writeFileSync(path.join(out,label+"-close-completed.json"),
      JSON.stringify({...error.closeEvidence,label,status:"FAILED",error:String(error.stack||error)},null,2),{flag:"wx"});
    throw error;
  }
  assert.equal(result.status,"PASS");assert.equal(result.normalClose,true);
  assert.equal(result.physicalInput,false);
  fs.writeFileSync(path.join(out,label+"-close-completed.json"),
    JSON.stringify({...result,label},null,2),{flag:"wx"});
  await browser.close().catch(()=>{});browser=null;child=null;
  report.cleanups.push({label,status:"PASS",normalClose:true,
    physicalInput:false,method:result.method,killed:[],ports:current.ports});save();
}
`);
    one('  productChanges:0,modelRequests:0,steps:[]',
      '  closeInput:"PUBLIC_NATIVE_IPC_NOT_PHYSICAL_INPUT",computerUse:"BLOCKED_NATIVE_PIPE_UNAVAILABLE",productChanges:0,modelRequests:0,steps:[]');
    one('"Not a clean machine"', '"Not a clean machine","Native IPC close only; Computer Use/Alt+F4 NOT_RUN"');
  } else if (kind === "audit") {
    one("real-default-path-launches-and-Computer-Use-normal-exit",
      "real-default-path-launches-and-public-native-IPC-exit-NOT-physical-input");
    one('assert.equal(c.pid,l.pid);assert.equal(c.method,"Computer Use Alt+F4");',
      'assert.equal(c.pid,l.pid);assert.equal(c.created,l.created);assert.equal(c.label,l.label);' +
      'assert.equal(c.method,"Installed native window.close via public Tauri IPC");' +
      'assert.equal(c.physicalInput,false);assert.equal(c.normalClose,true);assert.equal(c.status,"PASS");');
  } else if (kind === "session") {
    one("'D:\\AgentVN\\plans\\ACTIVE_TASKS.md'",
      `'${path.resolve(__dirname, "../plans/ACTIVE_TASKS.md")}'`);
  }
  if (kind !== "session") new vm.Script(Module.wrap(source));
  return source;
}
function main() {
  assert.equal(sha(original), "ce742065bc82cfe2b2879dd6c824adce021481d26059c343efd253a89d50b980");
  const [action, configFile] = process.argv.slice(2), config = read(configFile);
  assert.equal(config.closeMode, "public-native-ipc-not-physical");
  assert.equal(config.version, "1.9.35");
  assert(["1.9.34", "1.9.8"].includes(config.oldVersion));
  let source = fs.readFileSync(original, "utf8");
  function one(before, after) {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after);
  }
  one("  return { source, changes };",
    '  source = require("./editor-upgrade-native-ipc-current.cjs").augment(kind,source);\n' +
    "  return { source, changes };");
  one("files: [__filename, configFile, c.actualInstallation.path, c.oldInstaller.path, sealed,",
    `files: [__filename, ${JSON.stringify(original)}, require.resolve("./lib/installed-background-close.cjs"),
      configFile, c.actualInstallation.path, c.oldInstaller.path, sealed,`);
  one("if (require.main === module) main();", "main();");
  new vm.Script(Module.wrap(source));
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  worker._compile(source, __filename);
}
module.exports = { augment };
if (require.main === module) main();
