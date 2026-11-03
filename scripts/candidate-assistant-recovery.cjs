"use strict";
// Explicit current-candidate binding of the unchanged six-stage installed recovery suite.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
assert(process.env.AGENTVN_EXIT_CANDIDATE_CONFIG, "Explicit recovery candidate config required");
const options = require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate();
assert(process.argv.includes(`--candidate=${options.version}`), "Explicit matching recovery candidate required");
const qa = path.join(options.base, "assistant-recovery-01");
const checkpoint = `F:/AgentVN/Checkpoints/Assistant-Recovery-${options.stamp}-20261028-01`;
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const bindings = () => [options.bindingFile, ...["candidateConfig", "installation", "predecessor", "exported", "fixture"]
  .map(k => options.binding[k].path)].map(desc);
function verify() {
  require("./candidate-1930-exit.cjs").validateInstallation(options.installation);
  const current = require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate();
  assert.equal(current.version, options.version);
  assert.equal(path.resolve(current.base), path.resolve(options.base));
  assert.deepEqual(bindings(), frozenBindings);
}
const frozenBindings = bindings();
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
    'const currentCandidate = true, expectedVersion = module.qaOptions.version;');
  const evidence = '    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);';
  if (audit) {
    replace('const { qa, stages, readDb } = require("./installed-assistant-recovery-current.cjs");',
      'const { qa, stages, readDb } = module.qaRecovery;');
    replace(evidence, evidence + '\n' +
      '    fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
      '    fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });\n' +
      '    module.qaVerify();\n' +
      '    assert.deepEqual(prep.candidateBindings, module.qaBindings());\n' +
      '    assert.equal(path.resolve(r.installation.path), path.resolve(module.qaOptions.installation));');
  } else {
    replace('const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;',
      'const qa = module.qaRoot, checkpoint = module.qaCheckpoint;');
    replace('const installationFile = currentCandidate ?\n' +
      '  "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json" :\n' +
      '  "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json";',
      'const installationFile = module.qaOptions.installation;');
    replace('if (currentCandidate) tools.push("scripts/installed-layout-cache-session.ps1");',
      'if (currentCandidate) tools.push("scripts/installed-layout-cache-session.ps1",\n' +
      '  "scripts/installed-assistant-recovery-current.cjs", "scripts/installed-assistant-recovery-current-audit.cjs",\n' +
      '  "scripts/lib/candidate-1924-quick-adapter.cjs", "scripts/candidate-1930-exit.cjs");');
    replace('  assert(fs.existsSync(checkpoint)); assert(!fs.existsSync(qa)); fs.mkdirSync(qa);',
      '  module.qaVerify();\n  assert(fs.existsSync(checkpoint)); assert(!fs.existsSync(qa)); fs.mkdirSync(qa);');
    replace('  const prev = read(currentCandidate ?\n' +
      '    "F:/AgentVN/QA/Installed-Assistant-Lifecycle-1922-20261022-01/preparation.json" :\n' +
      '    "F:/AgentVN/QA/Installed-Assistant-Lifecycle-20261021-01/preparation.json");',
      '  const lifecycleRoot = path.join(module.qaOptions.base, "assistant-lifecycle-01");\n' +
      '  const lifecycleFile = path.join(lifecycleRoot, "preparation.json");\n' +
      '  const lifecycleReport = read(path.join(lifecycleRoot, "session-01/report.json"));\n' +
      '  const lifecycleAudit = read(path.join(lifecycleRoot, "audit-01/report.json"));\n' +
      '  assert.equal(lifecycleReport.status, "PASS"); assert.equal(lifecycleReport.version, expectedVersion);\n' +
      '  assert.equal(lifecycleReport.cacheRestoration, "PASS");\n' +
      '  assert.equal(lifecycleAudit.status, "PASS");\n' +
      '  assert.equal(lifecycleAudit.input.sha256, sha(path.join(lifecycleRoot, "session-01/report.json")));\n' +
      '  const prev = read(lifecycleFile);');
    replace('currentCandidate ? "1922-20261022" : "20261021"', '`${module.qaOptions.stamp}-20261028`');
    replace('currentCandidate ? "1.9.22 20261022" : "20261021"', '`${expectedVersion} 20261028`');
    replace('  write(path.join(qa, "preparation.json"), { at: new Date().toISOString(), products: prev.products,',
      '  write(path.join(qa, "preparation.json"), { at: new Date().toISOString(), products: prev.products,\n' +
      '    candidateBindings: module.qaBindings(), lifecycle: desc(lifecycleFile),\n' +
      '    lifecycleReport: desc(path.join(lifecycleRoot, "session-01/report.json")),\n' +
      '    lifecycleAudit: desc(path.join(lifecycleRoot, "audit-01/report.json")),');
    replace('  assert.match(attempt, /^\\d{2}$/); const out = path.join(qa, `session-${attempt}`);',
      '  module.qaVerify();\n  assert.match(attempt, /^\\d{2}$/); const out = path.join(qa, `session-${attempt}`);');
    replace('  const prep = read(path.join(qa, "preparation.json")), projects = prep.projects;',
      '  const prep = read(path.join(qa, "preparation.json")), projects = prep.projects;\n' +
      '  assert.deepEqual(prep.candidateBindings, module.qaBindings());\n' +
      '  assert.equal(path.resolve(prep.installation.path), path.resolve(installationFile));\n' +
      '  for (const f of [prep.installation, prep.lifecycle, prep.lifecycleReport, prep.lifecycleAudit])\n' +
      '    assert.equal(sha(f.path), f.sha256);');
    replace('      path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView"],',
      '      path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView",\n' +
      '      "-AllowedRunRoot", path.resolve(qa)],');
    replace('  for (const f of tools) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);',
      '  for (const f of tools) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);\n' +
      '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
      '  write(path.join(out, "adaptations.json"), module.qaChanges);');
    replace('module.exports = { qa, stages, readDb };', 'module.exports = { qa, stages, readDb, prepare, run };');
  }
  new vm.Script(Module.wrap(source), { filename: __filename });
  let replay = original;
  for (const c of changes) {
    assert.equal(replay.split(c.before).length - 1, c.count);
    replay = replay.split(c.before).join(c.after);
  }
  assert.equal(replay, source);
  return { source, changes };
}
function load(audit, recovery) {
  const a = adapt(audit), worker = new Module(__filename, module);
  Object.assign(worker, { filename: __filename, paths: module.paths, qaSource: a.source, qaChanges: a.changes,
    qaRecovery: recovery, qaOptions: options, qaRoot: qa, qaCheckpoint: checkpoint, qaVerify: verify, qaBindings: bindings });
  worker._compile(a.source, __filename); return worker.exports;
}
const action = process.argv[2], args = process.argv.slice(3).filter(a => !a.startsWith("--"));
verify();
if (action === "--self-test") {
  const business = adapt(false), audit = adapt(true), recovery = load(false);
  assert.equal(path.resolve(recovery.qa), path.resolve(qa)); assert.equal(recovery.stages.length, 6);
  assert.equal(typeof recovery.prepare, "function"); assert.equal(typeof recovery.run, "function");
  assert.equal(bindings().length, 6);
  console.log(JSON.stringify({ status: "PASS", version: options.version, qa,
    businessAdaptations: business.changes.length, auditAdaptations: audit.changes.length,
    scope: "BINDING_ONLY_NO_PRODUCT_OR_MODEL" }));
} else {
  assert(["session", "audit"].includes(action));
  assert(action === "session" ? args.length === 1 && (args[0] === "prepare" || /^\d{2}$/.test(args[0]))
    : args.length === 2 && args.every(a => /^\d{2}$/.test(a)));
  process.argv.splice(2, 1);
  const recovery = load(false);
  if (action === "audit") load(true, recovery);
  else Promise.resolve().then(() => args[0] === "prepare" ? recovery.prepare() : recovery.run(args[0]))
    .catch(e => { console.error(e); process.exitCode = 1; });
}
