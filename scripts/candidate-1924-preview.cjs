"use strict";
// Reuse all existing preview business checks, bound to the frozen 1.9.24 install.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const installFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const installation = JSON.parse(fs.readFileSync(installFile, "utf8"));
assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, "1.9.24");
for (const f of [installation.executable, ...installation.resources, ...installation.protectedFiles]) assert.equal(sha(f.path), f.sha256);
const entries = {
  run: ["installed-preview-current.cjs", "e6e30db3f3abfcb46ffb1215135ecfdd544f4f4daa4cf8d734eb67eb2e783883"],
  audit: ["installed-preview-current-audit.cjs", "1e313973e70a90dad9e536ee9b52afc25a2405129f97eb058b8ecc43db5f5d8a"],
};
function adapt(action) {
  const [name, expected] = entries[action], original = path.join(__dirname, name);
  assert.equal(sha(original), expected);
  let source = fs.readFileSync(original, "utf8"); const changes = [];
  function replace(before, after) {
    assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, after);
    changes.push({ before, after });
  }
  replace('qa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01"',
    'qa = "F:/AgentVN/QA/Editor-1.9.24-20261024-01"');
  if (action === "run") {
    replace('project.title = "1.9.14安装版真实预览";', 'project.title = "1.9.24安装版真实预览";');
    replace('version: "1.9.14"', 'version: "1.9.24"');
    replace('const protectedFiles = [...read(path.join(qa, "checkpoint-01/report.json")).frozen,',
      "const protectedFiles = [...installation.protectedFiles,");
    replace('path.join(root, "scripts/native-dev-preview-profile.ps1")',
      'path.join(root, "scripts/candidate-1924-preview-profile.ps1")');
    replace('"scripts/lib/installed-release-session.cjs", "scripts/native-dev-preview-profile.ps1",',
      '"scripts/lib/installed-release-session.cjs", "scripts/native-dev-preview-profile.ps1", "scripts/candidate-1924-preview-profile.ps1",');
    replace('playerPage = playerBrowser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost|^tauri:/.test(p.url())); assert(playerPage);',
      'await until(() => { playerPage = playerBrowser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost|^tauri:/.test(p.url())); return !!playerPage; }, "Actual external WebView application URL");');
    replace('save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
      'save(); fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
      '  fs.writeFileSync(path.join(out, "candidate-adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });\n' +
      '  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);');
  } else {
    replace('assert.equal(run.version, "1.9.14")', 'assert.equal(run.version, "1.9.24")');
    replace('sha(path.resolve(__dirname, "installed-preview-current.cjs"))', 'sha(__filename)');
    replace('const previewRecord = journal.records.find(r => r.original.endsWith("gamecli-preview")); assert(previewRecord);',
      'const previewRecord = journal.records.find(r => run.players[1].script.path.startsWith(r.original + path.sep)); assert(previewRecord);');
    replace('assert.equal(journal.records.length, 3); assert.equal(restored.restored.length, 3);',
      'assert.equal(journal.records.length, 6); assert.equal(restored.restored.length, 6);');
    replace('originalDirectories: 3', 'originalDirectories: 6');
  }
  new vm.Script(Module.wrap(source), { filename: __filename });
  let replay = fs.readFileSync(original, "utf8");
  for (const c of changes) { assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after); }
  assert.equal(replay, source); return { source, changes, original };
}
if (process.argv[2] === "--self-test") {
  console.log(JSON.stringify({ status: "PASS", changes: Object.fromEntries(Object.keys(entries).map(k => [k, adapt(k).changes.length])),
    productLaunches: 0, scope: "CANDIDATE_BINDING_PROFILE_ISOLATION_AND_URL_READY_ADAPTATIONS" }));
} else {
  const action = process.argv[2]; assert(entries[action]);
  assert.deepEqual(process.argv.slice(3), action === "run" ? ["03"] : ["03", "02"]);
  const adapted = adapt(action);
  if (action === "run") {
    const checkpoint = "F:/AgentVN/Checkpoints/Installed-Preview-1924-20261025-02";
    assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);
    const names = ["scripts/candidate-1924-preview.cjs", "scripts/candidate-1924-preview-profile.ps1",
      "scripts/installed-preview-current.cjs", "scripts/installed-preview-current-audit.cjs",
      "scripts/native-dev-preview-profile.ps1", "scripts/lib/installed-release-session.cjs", "plans/ACTIVE_TASKS.md"];
    const copied = names.map(n => {
      const from = path.resolve(__dirname, "..", n), to = path.join(checkpoint, path.basename(n));
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); assert.equal(sha(from), sha(to));
      return { source: from, copy: to, sha256: sha(from) };
    });
    fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify(copied, null, 2), { flag: "wx" });
  }
  process.argv.splice(2, 1);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = adapted.source; worker.qaChanges = adapted.changes;
  worker._compile(adapted.source, __filename);
}
