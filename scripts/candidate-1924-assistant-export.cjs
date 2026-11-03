"use strict";
// Current-candidate import -> genuine UI export -> installed Player -> independent audit.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
function adapt(action) {
  const table = {
    author: ["installed-assistant-export-current.cjs", "04996ce1c785b29fd1ef7332fd71ddafde08f0221f67b76aedb90e098e3f1ef4"],
    player: ["installed-assistant-export-player-current.cjs", "b17d71ead100b028ab451ef2f4b74567e10abd8ffde6df977cbdbf25c69f61c6"],
    audit: ["installed-assistant-export-current-audit.cjs", "7185d99d35744d67e7a0759440016904411bbbca82becc87c432c6dd43e39649"],
  };
  const [name, hash] = table[action], previous = path.join(__dirname, name);
  assert.equal(sha(previous), hash);
  const original = fs.readFileSync(previous, "utf8"); let source = original; const changes = [];
  function replace(before, after) {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, after); changes.push({ before, after });
  }
  replace('const currentCandidate = process.argv.includes("--candidate=1.9.22"), expectedVersion = currentCandidate ? "1.9.22" : "1.9.14";',
    'const currentCandidate = true, expectedVersion = "1.9.24";');
  if (action !== "audit") {
    replace('"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"',
      '"F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json"');
    if (action === "author") {
      replace('path.join(previous, "session-01/report.json")', 'path.join(previous, "session-02/report.json")');
      replace('currentCandidate ? "audit-01/report.json" : "audit-02/report.json"', '"audit-02/report.json"');
      replace('assert.equal(read(installationFile).version, expectedVersion)',
        'assert.equal(read(installationFile).executable.version, expectedVersion)');
      // This exact export normalization is already independently verified for the candidate.
      replace('    assert.deepEqual(layout, project.editor_settings.runtimeUILayout);',
        '    require("./lib/assistant-export-layout.cjs").assertAssistantExportLayout(layout, project.editor_settings.runtimeUILayout);');
      replace('  for (const f of files) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);',
        '  for (const f of files) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);\n' +
        '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
        '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
    } else {
      replace('assert.equal(installation.version, expectedVersion)', 'assert.equal(installation.executable.version, expectedVersion)');
      replace('${currentCandidate ? "1922-" : ""}${attempt}', '${currentCandidate ? "1924-" : ""}${attempt}');
      replace('  save(); for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);',
        '  save(); for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);\n' +
        '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
        '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
    }
  } else {
    replace('${currentCandidate ? "1922-" : ""}${pa}', '${currentCandidate ? "1924-" : ""}${pa}');
    replace('  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);',
      '  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);\n' +
      '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
      '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
  }
  new vm.Script(Module.wrap(source), { filename: __filename });
  let replay = original;
  for (const c of changes) { assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after); }
  assert.equal(replay, source);
  return { source, changes };
}
if (process.argv[2] === "--self-test") {
  const cases = Object.fromEntries(["author", "player", "audit"].map(k => [k, adapt(k).changes.length]));
  console.log(JSON.stringify({ status: "PASS", cases, scope: "ADAPTER_ONLY_NO_PRODUCT_OR_MODEL" }));
} else {
  const action = process.argv[2]; assert(["author", "player", "audit"].includes(action));
  const args = process.argv.slice(3);
  assert.deepEqual(args, action === "author" ? ["03"] : action === "player" ? ["03", "01"] : ["03", "01", "02"]);
  const adapted = adapt(action); process.argv.splice(2, 1);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = adapted.source; worker.qaChanges = adapted.changes; worker._compile(adapted.source, __filename);
}
