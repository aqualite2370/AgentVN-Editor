"use strict";
// Explicit candidate binding for the complete existing native GUI roundtrip
// and independent terminal audit. Old tools and their evidence stay untouched.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), crypto = require("node:crypto");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const args = process.argv.slice(2), mode = args.shift();
assert(["self-test", "run", "audit"].includes(mode));
const configArgs = args.filter(a => a.startsWith("--candidate-config="));
assert.equal(configArgs.length, 1);
const auditIdArgs = args.filter(a => a.startsWith("--audit-ids="));
assert(auditIdArgs.length <= 1);
const auditIds = auditIdArgs.length ? auditIdArgs[0].slice("--audit-ids=".length).split(",") : ["01", "01", "01"];
assert.equal(auditIds.length, 3);
assert(auditIds.every(id => /^\d{2}$/.test(id)), "Three explicit audit attempt IDs required");
const auditNames = ["gui-library-audit", "gui-negative-audit", "gui-directory-audit"]
  .map((name, index) => `${name}-${auditIds[index]}`);
const numbers = args.filter(a => !a.startsWith("--"));
assert.equal(args.length, numbers.length + 1 + auditIdArgs.length);
assert.equal(numbers.length, mode === "audit" ? 5 : 4);
assert(numbers.every(a => /^\d{2}$/.test(a)));
const [author, portable, negative, directory, auditAttempt] = numbers;
assert.equal(new Set([author, portable, negative, directory]).size, 4);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const configFile = configArgs[0].slice("--candidate-config=".length);
const config = validateCandidateConfig(read(configFile));
const actual = deriveActual(config.actual, config.version);
const editorRoot = n => `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${n}`;
const authorRoot = editorRoot(author), portableRoot = editorRoot(portable);
const installationFile = path.join(config.qa, `gui-author-preparation-${author}`, "derived-installed.json");
assert.deepEqual(read(installationFile), actual);
const authorFile = path.join(authorRoot, "report.json"), authored = read(authorFile);
assert.equal(authored.version, config.version);
assert.equal(authored.status, "EDITOR_PASS_NATIVE_PLAYER_NOT_RUN");
assert.equal(authored.steps.length, 8);
assert(authored.steps.every(s => s.status === "PASS" && s.finishedAt));
assert.equal(authored.nativeCacheRestoration, "PASS");
assert(authored.launches.every(l => l.executable.sha256 === actual.executable.sha256));
for (const [name, expectedInput] of [
  [auditNames[0], null],
  [auditNames[1], path.join(editorRoot(negative), "report.json")],
  [auditNames[2], path.join(editorRoot(directory), "report.json")],
]) {
  const audit = read(path.join(config.qa, name, "report.json"));
  assert.equal(audit.status, "PASS");
  assert(audit.groups.length >= 3 && audit.groups.every(g => g.status === "PASS"));
  if (expectedInput) {
    assert.equal(path.resolve(audit.input.path), path.resolve(expectedInput));
    assert.equal(audit.input.sha256, sha(expectedInput));
    assert.equal(read(expectedInput).version, config.version);
  } else {
    const input = audit.inputs.find(f => path.resolve(f.path) === path.resolve(authorFile));
    assert(input); assert.equal(input.sha256, sha(authorFile));
  }
}
const table = {
  run: ["candidate-1930-gui-portable.cjs", "37a5152b9fe58e9a84f4d58b515c8fb3e2c46adefba921b66e7c17135a363d74"],
  audit: ["candidate-1930-gui-terminal-audit.cjs", "ec2e56de01e1cd91d77b5228ab9a9409d6e9a637334f9ff09b58cc036d5be79f"],
};
function build(kind) {
  const file = path.join(__dirname, table[kind][0]);
  assert.equal(sha(file), table[kind][1]);
  const original = fs.readFileSync(file, "utf8"); let source = original; const changes = [];
  function replace(before, after) {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, after); changes.push({ before, after });
  }
  if (kind === "run") {
    replace('const sourceRoot="F:/AgentVN/QA/Installed-Layout-20261021-01/editor-66";',
      `const sourceRoot=${JSON.stringify(authorRoot)};`);
    replace('const out="F:/AgentVN/QA/Installed-Layout-20261021-01/editor-67";',
      `const out=${JSON.stringify(portableRoot)};`);
    replace('const installationFile="F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json";',
      `const installationFile=${JSON.stringify(installationFile)};`);
    replace('const report={status:"RUNNING",version:"1.9.30",',
      'const report={status:"RUNNING",version:module.qaConfig.version,qaBinding:module.qaBinding,');
    replace('  fs.copyFileSync(__filename,path.join(out,"executed-test.cjs"),fs.constants.COPYFILE_EXCL);',
      '  fs.copyFileSync(__filename,path.join(out,"executed-test.cjs"),fs.constants.COPYFILE_EXCL);\n' +
      '  fs.writeFileSync(path.join(out,"executed-business.cjs"),module.qaSource,{flag:"wx"});');
  } else {
    if (auditIdArgs.length)
      replace('const inputs=["gui-library-audit-01","gui-negative-audit-02","gui-directory-audit-01"]',
        `const inputs=${JSON.stringify(auditNames)}`);
    replace('const base="F:/AgentVN/QA/Editor-1.9.30-20261026-01";',
      `const base=${JSON.stringify(config.qa)};`);
    replace('const portableRoot="F:/AgentVN/QA/Installed-Layout-20261021-01/editor-67";',
      `const portableRoot=${JSON.stringify(portableRoot)};`);
    replace('const out=path.join(base,"gui-terminal-audit-01");',
      `const out=path.join(base,"gui-terminal-audit-${auditAttempt ?? "01"}");`);
    replace('const result={status:"RUNNING",at:',
      'const result={status:"RUNNING",version:module.qaConfig.version,qaBinding:module.qaBinding,at:');
    replace('scope:"INSTALLED_1930_OFFICIAL_GUI_LIBRARY_AND_PORTABLE_CHAIN_NOT_DEFAULT_PROFILE_UPGRADE_SETUP_ANDROID_OR_FULL_RENPY"',
      'scope:"CURRENT_INSTALLED_OFFICIAL_GUI_LIBRARY_AND_NATIVE_PORTABLE_NOT_DEFAULT_PROFILE_UPGRADE_SETUP_ANDROID_OR_FULL_RENPY"');
    replace('    for(const f of inputs) {',
      '    assert.equal(p.version,module.qaConfig.version);assert.equal(source.version,module.qaConfig.version);\n' +
      '    assert.deepEqual(p.qaBinding.configurationFile,module.qaBinding.configurationFile);\n' +
      '    assert.deepEqual(p.qaBinding.actualInstallation,module.qaConfig.actual);\n' +
      '    assert.equal(sha(p.qaBinding.source.path),p.qaBinding.source.sha256);\n' +
      '    assert.equal(sha(path.join(portableRoot,"executed-business.cjs")),p.qaBinding.executedSourceSha256);\n' +
      '    for(const f of inputs) {');
    replace('"candidate-1930-gui-portable.cjs"', '"candidate-gui-portable.cjs"');
    replace('const installed=read(path.join(base,"derived-components-installation-01.json"));',
      `const installed=read(${JSON.stringify(installationFile)});\n` +
      '    assert.deepEqual(installed,module.qaActual);');
    replace('...installed.protectedFiles]', '...(installed.protectedFiles??[])]');
    replace('const negative=read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-64/report.json");',
      `const negative=read(${JSON.stringify(path.join(editorRoot(negative), "report.json"))});`);
    replace('    fs.copyFileSync(__filename,path.join(out,"executed-audit.cjs"),fs.constants.COPYFILE_EXCL);',
      '    fs.copyFileSync(__filename,path.join(out,"executed-audit.cjs"),fs.constants.COPYFILE_EXCL);\n' +
      '    fs.writeFileSync(path.join(out,"executed-business.cjs"),module.qaSource,{flag:"wx"});');
  }
  new vm.Script(Module.wrap(source), { filename: __filename });
  let replay = original;
  for (const c of changes) {
    assert.equal(replay.split(c.before).length - 1, 1);
    replay = replay.replace(c.before, c.after);
  }
  assert.equal(replay, source);
  return { file, source, changes };
}
if (mode === "self-test") {
  const business = build("run"), audit = build("audit");
  assert(business.source.includes('assert.equal(report.cases.length,3)'));
  assert(business.source.includes('await A.nativeInput'));
  assert(business.source.includes('localLibraryNotBundled:true'));
  assert(business.source.includes('await cache("Restore")'));
  assert(audit.source.includes('assert.equal(r.cases.length,3)'));
  assert(audit.source.includes('assert(/Computer Use/.test(receipt.interaction))'));
  assert(audit.source.includes('invalidPortableEvidenceRejected:bad.length'));
  if (auditIdArgs.length) assert(audit.source.includes(`const inputs=${JSON.stringify(auditNames)}`));
  console.log(JSON.stringify({ status: "PASS", version: config.version,
    businessAdaptations: business.changes.length, auditAdaptations: audit.changes.length,
    auditAttempts: auditIds,
    inheritedBusinessResults: false, productStarts: 0, modelRequests: 0 }));
} else {
  const generated = build(mode), worker = new Module(__filename, module);
  Object.assign(worker, { filename: __filename, paths: module.paths, qaConfig: config, qaActual: actual,
    qaSource: generated.source, qaBinding: {
      configurationFile: desc(configFile), actualInstallation: config.actual,
      source: desc(generated.file), adaptations: generated.changes,
      executedSourceSha256: crypto.createHash("sha256").update(generated.source).digest("hex"),
      author, portable, negative, directory, inheritedBusinessResults: false,
      ...(auditIdArgs.length ? { auditInputs: auditNames.map(name => desc(path.join(config.qa, name, "report.json"))) } : {}),
    } });
  worker._compile(generated.source, __filename);
}
