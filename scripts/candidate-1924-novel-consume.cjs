"use strict";
// Fresh current-candidate novel author/export/Player chain; preserves the port failure.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
function adapt(action) {
  const table = {
    author: ["installed-novel-consume-current.cjs", "d7a3f411f46a4001190f26841d8dc90c8126213d4c24a08e83c669f7f7a385ab"],
    player: ["installed-novel-consume-player-current.cjs", "35e8d7cf5f875cee87658103587824618adeac95fe3225631d78ece60401f845"],
    audit: ["installed-novel-consume-current-audit.cjs", "3f41c992e667e0252b2a8a856133ac08c6d28a6ee810d9cf569e5248c7d5a1cf"],
  };
  const [name, hash] = table[action], previous = path.join(__dirname, name);
  assert.equal(sha(previous), hash);
  const original = fs.readFileSync(previous, "utf8"); let source = original; const changes = [];
  function replace(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.split(before).join(after); changes.push({ before, after, count });
  }
  replace('"1.9.22"', '"1.9.24"', action === "author" ? 3 : 2);
  if (action === "author") {
    replace('"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"',
      '"F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json"');
    replace('path.join(qa, "session-04/report.json")', 'path.join(qa, "session-08/report.json")');
    replace('path.join(qa, "audit-01/report.json")',
      '"F:/AgentVN/QA/Editor-1.9.24-20261024-01/novel-default-audit-01/report.json"');
    replace('assert.equal(installation.version, "1.9.24")', 'assert.equal(installation.executable.version, "1.9.24")');
    replace('assert.equal(audit.status, "PASS");',
      'assert.equal(audit.status, "PASS"); assert.equal(audit.source.sha256, sha(sourceFile));');
    replace('"qa-installed-novel-default-1922-20261022-03"', '"qa-installed-novel-1924-20261025-08"');
    replace('"189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc"',
      '"ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143"');
    replace('module.exports = { qa, desc, read, sha, persistenceContent };',
      'module.exports = { qa, desc, read, sha, persistenceContent, run };');
    replace('  for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);',
      '  for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);\n' +
      '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
      '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
  } else {
    replace('"a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59"',
      '"6e7f4ec17d8388a99937123f88ddf7cebbe161fac39a19cfe3a3bc849e642168"');
    const expr = action === "player" ? "${attempt}" : "${playerId}";
    replace("installed-novel-consume-1922-" + expr, "installed-novel-consume-1924-" + expr);
    source += "\nmodule.exports.run = run;\n";
    changes.push({ appended: "\nmodule.exports.run = run;\n" });
    if (action === "audit") {
      replace('assert(editor.steps[0].inheritedFrom && editor.continuation.originalFailurePreserved);',
        'assert(!editor.continuation && editor.steps.every(s => !s.inheritedFrom));');
      replace('      const parent = read(editor.continuation.path);\n      for (const r of [parent, editor, player]) {',
        '      for (const r of [editor, player]) {');
      replace('path.dirname(r === parent ? editor.continuation.path :\n          r === editor ? editorFile : playerFile)',
        'path.dirname(r === editor ? editorFile : playerFile)');
      replace('pngCount: parent.screenshots.length + editor.screenshots.length + player.screenshots.length',
        'pngCount: editor.screenshots.length + player.screenshots.length');
      replace('const parent = read(editor.continuation.path), all = [parent, editor, player];', 'const all = [editor, player];');
      replace('all.flatMap(r => r.knownProcesses).map(p => `${p.ProcessId}:${p.Created}`)',
        'all.flatMap(r => [...r.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`),\n' +
        '        ...r.cleanups.flatMap(c => c.killed), ...r.launches.filter(l => l.backend).map(l => `${l.backend.ProcessId}:${l.backend.Created}`)])');
      replace('for (const r of [parent, editor]) {', 'for (const r of [editor]) {');
      replace('for (const id of ["01", "02"])', 'for (const id of ["07"])');
      replace('  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);',
        '  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);\n' +
        '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
        '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
    } else {
      replace('  for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);',
        '  for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);\n' +
        '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
        '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
    }
  }
  new vm.Script(Module.wrap(source), { filename: __filename });
  let replay = original;
  for (const c of changes) {
    if (c.appended) { replay += c.appended; continue; }
    assert.equal(replay.split(c.before).length - 1, c.count); replay = replay.split(c.before).join(c.after);
  }
  assert.equal(replay, source);
  return { source, changes };
}
// Explicit new-candidate binding; the original business runners and their assertions remain frozen.
function currentContext(candidateFile, consumeFile) {
  const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
  const { deriveActual } = require("./installed-profile-data-replay.cjs");
  const config = validateCandidateConfig(read(candidateFile)), consume = read(consumeFile);
  for (const key of ["installation", "source", "priorAudit"]) {
    assert.match(consume[key].sha256, /^[a-f0-9]{64}$/);
    assert.equal(sha(consume[key].path), consume[key].sha256, key);
  }
  const installation = read(consume.installation.path), actual = deriveActual(config.actual, config.version);
  for (const key of Object.keys(actual)) assert.deepEqual(installation[key], actual[key], key);
  for (const f of [...installation.resources, installation.executable, ...installation.protectedFiles])
    assert.equal(sha(f.path), f.sha256);
  for (const absent of installation.protectedAbsent) assert(!fs.existsSync(absent));
  for (const key of ["qa", "playerRoot"]) {
    consume[key] = path.resolve(consume[key]);
    assert.equal(path.dirname(consume[key]), path.resolve("F:/AgentVN/QA"));
  }
  assert.match(path.basename(consume.playerRoot), /^Native-Runtime-State-20261020-\d{2}$/);
  assert.notEqual(consume.qa, consume.playerRoot);
  const source = read(consume.source.path), audit = read(consume.priorAudit.path);
  assert.equal(source.status, "PASS"); assert.equal(source.version, config.version);
  assert.equal(source.productChanges, 0); assert.equal(source.realModelRequests, 0);
  assert.equal(source.cases.length, 4); assert(source.cases.every(c => c.status === "PASS"));
  assert.equal(source.bundles.length, 1);
  assert.equal(audit.status, "PASS"); assert.equal(audit.source.sha256, consume.source.sha256);
  assert.equal(path.resolve(audit.source.path), path.resolve(consume.source.path));
  assert(audit.checks.length > 0 && audit.checks.every(c => c.status === "PASS"));
  assert.equal(source.installation.sha256, consume.installation.sha256);
  const player = installation.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
  assert(player);
  return { ...consume, config, installed: installation, sourceReport: source, player,
    projectId: source.restored.project.project_id, version: config.version };
}
function adaptCurrent(action, c) {
  const files = {
    author: ["installed-novel-consume-current.cjs", "d7a3f411f46a4001190f26841d8dc90c8126213d4c24a08e83c669f7f7a385ab"],
    player: ["installed-novel-consume-player-current.cjs", "35e8d7cf5f875cee87658103587824618adeac95fe3225631d78ece60401f845"],
    audit: ["installed-novel-consume-current-audit.cjs", "3f41c992e667e0252b2a8a856133ac08c6d28a6ee810d9cf569e5248c7d5a1cf"],
  };
  assert(files[action]);
  const [file, hash] = files[action]; assert.equal(sha(path.join(__dirname, file)), hash);
  let source = fs.readFileSync(path.join(__dirname, file), "utf8"); const changes = [];
  function replace(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.split(before).join(after); changes.push({ before, after, count });
  }
  replace('"1.9.22"', JSON.stringify(c.version), action === "author" ? 3 : action === "audit" ? 2 : 2);
  if (action === "author") {
    replace('"F:/AgentVN/QA/Installed-Novel-Default-1922-20261022-01"', JSON.stringify(c.qa));
    replace('"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"',
      JSON.stringify(c.installation.path));
    replace('path.join(qa, "session-04/report.json")', JSON.stringify(c.source.path));
    replace('path.join(qa, "audit-01/report.json")', JSON.stringify(c.priorAudit.path));
    replace('assert.equal(audit.status, "PASS");',
      'assert.equal(audit.status, "PASS"); assert.equal(audit.source.sha256, sha(sourceFile));');
    replace('"qa-installed-novel-default-1922-20261022-03"', JSON.stringify(c.projectId));
    replace('"189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc"',
      JSON.stringify(c.installed.executable.sha256));
    replace('preferredBackendPort: 8278', 'preferredBackendPort: undefined');
    replace('"-RunDirectory", out, "-CodexCacheView"',
      '"-RunDirectory", out, "-AllowedRunRoot", qa, "-CodexCacheView"');
    replace('knownProductFailures: ["NOVEL-BACKEND-PORT-01 remains FAILED; no analysis request is made here"]',
      'knownProductFailures: [], historicalFailureBoundary: "Old port failure retained in its original report; this run issues no analysis requests"');
    replace("module.exports = { qa, desc, read, sha, persistenceContent };",
      "module.exports = { qa, desc, read, sha, persistenceContent, run };");
  } else {
    replace('require("./installed-novel-consume-current.cjs")',
      'require("./candidate-1924-novel-consume.cjs").bindings');
    replace('"a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59"',
      JSON.stringify(c.player.sha256));
    replace('F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-novel-consume-1922-',
      c.playerRoot.replaceAll("\\", "/") + "/installed-novel-consume-" + c.version.replaceAll(".", "") + "-");
    source += "\nmodule.exports.run = run;\n";
  }
  if (action === "audit") {
    replace('assert(editor.steps[0].inheritedFrom && editor.continuation.originalFailurePreserved);',
      'assert(!editor.continuation && editor.steps.every(s => !s.inheritedFrom));');
    replace('      const parent = read(editor.continuation.path);\n      for (const r of [parent, editor, player]) {',
      '      for (const r of [editor, player]) {');
    replace('path.dirname(r === parent ? editor.continuation.path :\n          r === editor ? editorFile : playerFile)',
      'path.dirname(r === editor ? editorFile : playerFile)');
    replace('pngCount: parent.screenshots.length + editor.screenshots.length + player.screenshots.length',
      'pngCount: editor.screenshots.length + player.screenshots.length');
    replace('const parent = read(editor.continuation.path), all = [parent, editor, player];',
      'const all = [editor, player];');
    replace('all.flatMap(r => r.knownProcesses).map(p => `${p.ProcessId}:${p.Created}`)',
      'all.flatMap(r => r.knownProcesses).map(p => `${p.ProcessId}:${p.Created}`)');
    replace('for (const r of [parent, editor]) {', 'for (const r of [editor]) {');
    replace('for (const id of ["01", "02"]) assert.equal(read(path.join(qa, `session-${id}`, "report.json")).status, "FAILED");',
      `assert.equal(read(${JSON.stringify(c.source.path)}).status, "PASS");`);
    replace('dynamicPortNovelAnalysis: "FAILED"', 'dynamicPortNovelAnalysis: "PASS_CONTROLLED_SOURCE_SEPARATELY_AUDITED"');
    replace('dynamicPortFailureStillFailed: true', 'historicalFailuresNotRewritten: true');
  }
  const archive = action === "audit"
    ? '  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);'
    : '  for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);';
  replace(archive, archive + '\n' +
    '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
    '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });\n' +
    '  fs.writeFileSync(path.join(out, "candidate-binding.json"), JSON.stringify(module.qaBinding, null, 2), { flag: "wx" });');
  new vm.Script(Module.wrap(source));
  return { source, changes };
}
module.exports = { adapt, adaptCurrent, currentContext };
const currentArg = process.argv.find(a => a.startsWith("--candidate-config="));
if (currentArg) {
  const consumeArg = process.argv.find(a => a.startsWith("--consume-config="));
  assert(consumeArg, "Explicit consume config required");
  const options = process.argv.slice(2).filter(a => a.startsWith("--"));
  assert.equal(options.length, 2); assert.equal(new Set(options.map(a => a.split("=")[0])).size, 2);
  const context = currentContext(currentArg.slice("--candidate-config=".length), consumeArg.slice("--consume-config=".length));
  const positional = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const [action, ...args] = positional;
  assert(["self-test", "author", "player", "audit"].includes(action));
  assert.equal(args.length, action === "self-test" ? 0 : action === "author" ? 1 : action === "player" ? 2 : 3);
  for (const id of args) assert.match(id, /^\d{2}$/);
  module.exports.bindings = { ...require("./installed-novel-consume-current.cjs"), qa: context.qa };
  if (action === "self-test") {
    const counts = Object.fromEntries(["author", "player", "audit"].map(k => [k, adaptCurrent(k, context).changes.length]));
    assert.throws(() => currentContext(currentArg.slice("--candidate-config=".length), currentArg.slice("--candidate-config=".length)));
    console.log(JSON.stringify({ status: "PASS", version: context.version, adaptations: counts,
      wrongBindingRejected: true, launches: 0, realModelRequests: 0 }));
  } else {
    fs.mkdirSync(context.qa, { recursive: true }); fs.mkdirSync(context.playerRoot, { recursive: true });
    const a = adaptCurrent(action, context);
    const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
    worker.qaSource = a.source; worker.qaChanges = a.changes;
    worker.qaBinding = { version: context.version, installation: context.installation,
      source: context.source, priorAudit: context.priorAudit, player: context.player };
    worker._compile(a.source, __filename);
    Promise.resolve(worker.exports.run(...args)).catch(e => { console.error(e); process.exitCode = 1; });
  }
} else if (process.argv[2] === "--self-test") {
  console.log(JSON.stringify({ status: "PASS", cases: Object.fromEntries(["author", "player", "audit"].map(k =>
    [k, adapt(k).changes.length])), scope: "BINDING_AND_FRESH_EVIDENCE_ONLY_NO_PRODUCT_OR_MODEL" }));
} else {
  const action = process.argv[2], args = process.argv.slice(3);
  assert(["author", "player", "audit"].includes(action));
  assert.deepEqual(args, action === "author" ? ["09"] : action === "player" ? ["09", "01"] : ["09", "01", "02"]);
  const a = adapt(action); process.argv.splice(2, 1);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = a.source; worker.qaChanges = a.changes; worker._compile(a.source, __filename);
  Promise.resolve(worker.exports.run(...args)).catch(e => { console.error(e); process.exitCode = 1; });
}
