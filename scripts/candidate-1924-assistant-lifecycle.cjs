"use strict";
// Re-execute installed inquiry/queue/history behavior, preserving the approved boundary.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
function adapt(action) {
  const audit = action === "audit";
  const previous = path.join(__dirname, audit ? "installed-assistant-lifecycle-current-audit.cjs" : "installed-assistant-lifecycle-current.cjs");
  assert.equal(sha(previous), audit ? "3021b325c0c734f217e51706277cf32d434619c6d82bb4a7ae0e02a043d47162" :
    "d382315a7fb5635f638cf430a203df5cb6fc9384ed282a64c22d58e458c1ef9d");
  const original = fs.readFileSync(previous, "utf8"); let source = original; const changes = [];
  function replace(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.split(before).join(after); changes.push({ before, after, count });
  }
  if (audit) {
    replace('const currentCandidate=process.argv.includes("--candidate=1.9.22"),expectedVersion=currentCandidate?"1.9.22":"1.9.14";',
      'const currentCandidate=true,expectedVersion="1.9.24";');
    replace('const now = rows(), keys = new Set(r.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`));',
      'const now = rows(), keys = new Set([...r.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`),\n' +
      '        ...r.cleanups.flatMap(c => c.killed), ...r.launches.map(l => `${l.backend.ProcessId}:${l.backend.Created}`)]);');
    replace('    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);',
      '    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);\n' +
      '    fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
      '    fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
  } else {
    replace('const currentCandidate=process.argv.includes("--candidate=1.9.22");', 'const currentCandidate=true;');
    replace('const expectedVersion=currentCandidate?"1.9.22":"1.9.14";', 'const expectedVersion="1.9.24";');
    replace('const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;',
      'const qa = `F:/AgentVN/QA/${label}`, checkpoint = "F:/AgentVN/Checkpoints/Installed-Assistant-Lifecycle-1924-20261025-01";');
    replace('"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"',
      '"F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json"');
    replace('assert(fs.existsSync(checkpoint));', 'assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);');
    replace('assert.equal(currentCandidate?installation.version:installation.executable.version, expectedVersion);',
      'assert.equal(installation.executable.version, expectedVersion);\n' +
      '  assert.equal(installation.executable.sha256, "ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143");');
    replace('...read("F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json").protectedFiles,', '...installation.protectedFiles,');
    replace('currentCandidate?"1922-20261022":"20261021"', '"1924-20261025"');
    replace('currentCandidate?"1.9.22 20261022":"20261021"', '"1.9.24 20261025"');
    replace('  for (const f of tools) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);',
      '  for (const f of tools) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);\n' +
      '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
      '  write(path.join(out, "adaptations.json"), module.qaChanges);');
  }
  replace('"preparation.json"', '"preparation-1924.json"', audit ? 1 : 3);
  new vm.Script(Module.wrap(source), { filename: __filename });
  let replay = original;
  for (const c of changes) { assert.equal(replay.split(c.before).length - 1, c.count); replay = replay.split(c.before).join(c.after); }
  assert.equal(replay, source);
  return { source, changes };
}
if (process.argv[2] === "--self-test") {
  const cases = Object.fromEntries(["session", "audit"].map(k => [k, adapt(k).changes.length]));
  console.log(JSON.stringify({ status: "PASS", cases, scope: "BINDING_ONLY_NO_PRODUCT_OR_MODEL" }));
} else {
  const action = process.argv[2], args = process.argv.slice(3);
  assert(["session", "audit"].includes(action));
  if (action === "session") assert(args.length === 1 && ["prepare", "03"].includes(args[0]));
  else assert.deepEqual(args, ["03", "03"]);
  const a = adapt(action); process.argv.splice(2, 1);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = a.source; worker.qaChanges = a.changes; worker._compile(a.source, __filename);
}
