"use strict";
// Bind the existing complete author/export/Player/audit chain to an explicit installed candidate.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
assert(process.env.AGENTVN_EXIT_CANDIDATE_CONFIG, "Explicit assistant export config required");
const options = require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate();
assert(process.argv.includes(`--candidate=${options.version}`), "Explicit matching assistant export candidate required");
const qa = path.join(options.base, "assistant-export-01"), previous = path.join(options.base, "assistant-review-01");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const table = {
  author: ["installed-assistant-export-current.cjs", "04996ce1c785b29fd1ef7332fd71ddafde08f0221f67b76aedb90e098e3f1ef4"],
  player: ["installed-assistant-export-player-current.cjs", "b17d71ead100b028ab451ef2f4b74567e10abd8ffde6df977cbdbf25c69f61c6"],
  audit: ["installed-assistant-export-current-audit.cjs", "7185d99d35744d67e7a0759440016904411bbbca82becc87c432c6dd43e39649"],
};
const adapterInputs = [__filename, ...Object.values(table).map(([name]) => path.join(__dirname, name)),
  path.join(__dirname, "lib/assistant-export-layout.cjs")].map(desc);
const bindings = () => [options.bindingFile, ...["candidateConfig", "installation", "predecessor", "exported", "fixture"]
  .map(k => options.binding[k].path), path.join(previous, "session-01/report.json"),
  path.join(previous, "audit-01/report.json")].map(desc);
const frozenBindings = bindings();
function verify() {
  const installed = require("./candidate-1930-exit.cjs").validateInstallation(options.installation);
  assert.deepEqual(bindings(), frozenBindings);
  for (const f of adapterInputs) assert.equal(sha(f.path), f.sha256);
  const sourceFile = path.join(previous, "session-01/report.json"), source = read(sourceFile);
  const audit = read(path.join(previous, "audit-01/report.json"));
  assert.equal(source.status, "PASS"); assert.equal(source.version, options.version);
  assert.equal(audit.status, "PASS"); assert.equal(audit.input.sha256, sha(sourceFile));
  assert.equal(path.resolve(source.installation.path), path.resolve(options.installation));
  assert.equal(source.installation.sha256, sha(options.installation));
  assert.equal(source.cacheRestoration, "PASS");
  assert.equal(source.realModelRequests, 0); assert.equal(source.productChanges, 0);
  assert.equal(sha(source.projectArtifact.path), source.projectArtifact.sha256);
  return installed;
}
function adapt(action) {
  const [name, hash] = table[action], file = path.join(__dirname, name);
  assert.equal(sha(file), hash);
  const original = fs.readFileSync(file, "utf8"); let source = original; const changes = [];
  function replace(before, after) {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, after); changes.push({ before, after });
  }
  replace('const currentCandidate = process.argv.includes("--candidate=1.9.22"), expectedVersion = currentCandidate ? "1.9.22" : "1.9.14";',
    'const currentCandidate = true, expectedVersion = module.qaOptions.version;');
  replace(action === "author"
    ? 'currentCandidate ?\n  "F:/AgentVN/QA/Installed-Assistant-Export-1922-20261022-01" : "F:/AgentVN/QA/Installed-Assistant-Export-20261021-01"'
    : 'currentCandidate ? "F:/AgentVN/QA/Installed-Assistant-Export-1922-20261022-01" :\n' +
      '  "F:/AgentVN/QA/Installed-Assistant-Export-20261021-01"', 'module.qaRoot');
  replace('const report = { status: "RUNNING",', 'const report = { status: "RUNNING",\n' +
    '  qaBindings: module.qaBindings(), qaAdapterInputs: module.qaAdapterInputs,');
  if (action !== "audit") {
    replace('"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"',
      'module.qaOptions.installation');
    if (action === "author") {
      replace('const previous = currentCandidate ? "F:/AgentVN/QA/Installed-Assistant-Review-1922-20261022-01" :\n' +
        '  "F:/AgentVN/QA/Installed-Assistant-Review-20261021-01";', 'const previous = module.qaPrevious;');
      replace('  { encoding: "utf8", windowsHide: true, timeout: 45000 });',
        '  { encoding: "utf8", windowsHide: true, timeout: 45000,\n' +
        '    env: { ...process.env, AGENTVN_INSTALLED_GUI_QA_ROOT: path.resolve(qa) } });');
      replace('  for (const f of files) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);',
        '  for (const f of files) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);\n' +
        '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
        '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
    } else {
      replace('${currentCandidate ? "1922-" : ""}${attempt}', '${module.qaOptions.stamp}-${attempt}');
      replace('  save(); for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);',
        '  save(); for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);\n' +
        '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
        '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
    }
  } else {
    replace('${currentCandidate ? "1922-" : ""}${pa}', '${module.qaOptions.stamp}-${pa}');
    replace('    if (currentCandidate) assertAssistantExportLayout(layout, e.persisted.editor_settings.runtimeUILayout);\n' +
      '    else assert.deepEqual(layout, e.persisted.editor_settings.runtimeUILayout);',
      '    assert.deepEqual(layout, e.persisted.editor_settings.runtimeUILayout);');
    replace('  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);',
      '  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);\n' +
      '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
      '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });\n' +
      '  for (const r of [e, p]) {\n' +
      '    assert.deepEqual(r.qaBindings, module.qaBindings());\n' +
      '    assert.deepEqual(r.qaAdapterInputs, module.qaAdapterInputs);\n' +
      '    for (const f of r.qaAdapterInputs) assert.equal(sha(f.path), f.sha256);\n' +
      '  }');
  }
  new vm.Script(Module.wrap(source), { filename: __filename });
  let replay = original;
  for (const c of changes) {
    assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after);
  }
  assert.equal(replay, source);
  return { source, changes };
}
const action = process.argv[2], args = process.argv.slice(3).filter(a => !a.startsWith("--"));
verify();
if (action === "--self-test") {
  const adaptations = Object.fromEntries(Object.keys(table).map(k => [k, adapt(k).changes.length]));
  assert.equal(bindings().length, 8);
  console.log(JSON.stringify({ status: "PASS", version: options.version, qa, adaptations,
    scope: "BINDING_ONLY_NO_PRODUCT_OR_MODEL" }));
} else {
  assert(Object.hasOwn(table, action));
  assert.equal(args.length, action === "author" ? 1 : action === "player" ? 2 : 3);
  assert(args.every(a => /^\d{2}$/.test(a)));
  const adapted = adapt(action); process.argv.splice(2, 1);
  const worker = new Module(__filename, module);
  Object.assign(worker, { filename: __filename, paths: module.paths, qaSource: adapted.source, qaChanges: adapted.changes,
    qaOptions: options, qaRoot: qa, qaPrevious: previous, qaBindings: bindings, qaAdapterInputs: adapterInputs });
  worker._compile(adapted.source, __filename);
}
