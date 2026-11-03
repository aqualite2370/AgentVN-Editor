"use strict";
// Real installed hosts and packaged backend; only local model and explicit death injection.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
function adapt(audit) {
  const previous = path.join(__dirname, audit ? "installed-assistant-recovery-current-audit.cjs" : "installed-assistant-recovery-current.cjs");
  assert.equal(sha(previous), audit ? "bd408b988a2fbe3e324c173e2189fc64d626d61ce474e6767568856227f8e2d7" :
    "9095b4804c8668bfb2507fa529683c15052824c5c02dc774fe9b36ac788cbae8");
  const original = fs.readFileSync(previous, "utf8"); let source = original; const changes = [];
  function replace(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.split(before).join(after); changes.push({ before, after, count });
  }
  replace('const currentCandidate = process.argv.includes("--candidate=1.9.22"), expectedVersion = currentCandidate ? "1.9.22" : "1.9.14";',
    'const currentCandidate = true, expectedVersion = "1.9.24";');
  if (audit) {
    replace('const { qa, stages, readDb } = require("./installed-assistant-recovery-current.cjs");',
      'const { qa, stages, readDb } = module.qaRecovery;');
    replace('prep = read(path.join(qa, "preparation.json"))', 'prep = read(path.join(qa, "preparation-1924.json"))');
    replace('    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);',
      '    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);\n' +
      '    fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
      '    fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
  } else {
    replace('const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;',
      'const qa = `F:/AgentVN/QA/${label}`, checkpoint = "F:/AgentVN/Checkpoints/Installed-Assistant-Recovery-1924-20261025-01";');
    replace('"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"',
      '"F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json"');
    replace('assert(fs.existsSync(checkpoint)); assert(!fs.existsSync(qa)); fs.mkdirSync(qa);',
      'assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint); assert(fs.existsSync(qa));');
    replace('assert.equal(currentCandidate ? install.version : install.executable.version, expectedVersion);',
      'assert.equal(install.executable.version, expectedVersion);\n' +
      '  assert.equal(install.executable.sha256, "ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");');
    replace('"F:/AgentVN/QA/Installed-Assistant-Lifecycle-1922-20261022-01/preparation.json"',
      '"F:/AgentVN/QA/Installed-Assistant-Lifecycle-1922-20261022-01/preparation-1924.json"');
    replace('currentCandidate ? "1922-20261022" : "20261021"', '"1924-20261025"');
    replace('currentCandidate ? "1.9.22 20261022" : "20261021"', '"1.9.24 20261025"');
    replace('"preparation.json"', '"preparation-1924.json"', 2);
    replace('  for (const f of tools) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);',
      '  for (const f of tools) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);\n' +
      '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
      '  write(path.join(out, "adaptations.json"), module.qaChanges);');
    replace('module.exports = { qa, stages, readDb };', 'module.exports = { qa, stages, readDb, prepare, run };');
  }
  new vm.Script(Module.wrap(source), { filename: __filename });
  let replay = original;
  for (const c of changes) { assert.equal(replay.split(c.before).length - 1, c.count); replay = replay.split(c.before).join(c.after); }
  assert.equal(replay, source);
  return { source, changes };
}
function load(audit, recovery) {
  const a = adapt(audit), worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = a.source; worker.qaChanges = a.changes; worker.qaRecovery = recovery;
  worker._compile(a.source, __filename); return worker.exports;
}
if (process.argv[2] === "--self-test") {
  console.log(JSON.stringify({ status: "PASS", sessionAdaptations: adapt(false).changes.length,
    auditAdaptations: adapt(true).changes.length, scope: "BINDING_ONLY_NO_PRODUCT_OR_MODEL" }));
} else {
  const action = process.argv[2], args = process.argv.slice(3);
  assert(["session", "audit"].includes(action));
  if (action === "session") assert(args.length === 1 && ["prepare", "02"].includes(args[0]));
  else assert.deepEqual(args, ["02", "02"]);
  process.argv.splice(2, 1);
  const recovery = load(false);
  if (action === "audit") load(true, recovery);
  else Promise.resolve().then(() => args[0] === "prepare" ? recovery.prepare() : recovery.run(args[0]))
    .catch(e => { console.error(e); process.exitCode = 1; });
}
