"use strict";
// Continue the stopped work using the exact previously persisted graph.
// A raw import fixture omits BGM's persisted fade_ms=0 and is not a restart oracle.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), { DatabaseSync } = require("node:sqlite");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Resource-Guidance-1.9.35-20261102-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const originalFile = path.join(__dirname, "current-resource-guidance-closure.cjs");
const originalBinding = read(path.join(qa, "resume-binding.json"));
for (const f of [originalBinding.original, originalBinding.adapter, originalBinding.executed, originalBinding.prior])
  assert.equal(sha(f.path), f.sha256);
const failedPath = path.join(qa, "session-02/report.json"), failed = read(failedPath);
assert.equal(failed.status, "FAILED"); assert(failed.error.includes("fade_ms: 0"));
assert(failed.cleanups.every(c => c.status === "PASS"));
assert.equal(read(failed.cacheRestoration.path).status, "PASS");
assert(!rows().some(p => /^(agentvn-editor|creator-backend|agentvn-player)\.exe$/i.test(p.Name)));
const dbFile = path.join(qa, "session-01/data/backend/vn_engine.db");
const db = new DatabaseSync(dbFile, { readOnly: true });
let persisted;
try { persisted = JSON.parse(db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?")
  .get("qa-resource-guidance-1935-20261102").project_json); } finally { db.close(); }
const commands = persisted.nodes.find(n => n.id === "scene").data.scene.commands;
assert.equal(commands.length, 20); assert.equal(commands[0].background_id, "valid_background");
assert.equal(commands[14].fade_ms, 0);
let source = fs.readFileSync(originalBinding.executed.path, "utf8"); const edits = [];
function change(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, () => after); edits.push({ before, after });
}
change('const out = path.join(qa, "session-02");', 'const out = path.join(qa, "session-03");');
change("  continuedFrom: module.qaPrior, qaBinding: module.qaBinding, inheritedDisplayCombinations: 12,",
  "  continuedFrom: module.qaPrior, qaBinding: module.qaBinding, inheritedDisplayCombinations: 12,\n" +
  "  failedResume: module.qaFailedResume, persistedRestartOracle: module.qaOracle,");
change('    const commands = structuredClone(project.nodes[1].data.scene.commands);\n    commands[0].background_id = "valid_background";',
  "    const commands = module.qaExpectedCommands;");
new vm.Script(Module.wrap(source));
const executed = path.join(qa, "finish-executed.cjs"), binding = path.join(qa, "finish-binding.json");
assert(!fs.existsSync(executed) && !fs.existsSync(binding));
fs.writeFileSync(executed, source, { flag: "wx" });
const oracle = { sourceDatabase: desc(dbFile), persistedCommands: commands, sourceProjectId: persisted.project_id };
fs.writeFileSync(binding, JSON.stringify({ originalExecuted: originalBinding.executed, adapter: desc(__filename),
  executed: desc(executed), prior: originalBinding.prior, failedResume: desc(failedPath), oracle, edits }, null, 2), { flag: "wx" });
const worker = new Module(originalFile, module);
Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname),
  qaBinding: desc(binding), qaPrior: originalBinding.prior, qaFailedResume: desc(failedPath),
  qaExecuted: desc(executed), qaExpectedCommands: commands, qaOracle: oracle });
worker._compile(source, originalFile);
