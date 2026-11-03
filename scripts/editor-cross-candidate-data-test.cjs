"use strict";
// Replay the real failed comparison without opening retained SQLite evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { build } = require("./editor-cross-candidate.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const [configFile, output] = process.argv.slice(2);
assert(configFile && output);
const out = path.resolve(output);
assert(out.startsWith(path.resolve("F:/AgentVN/QA/Editor-1.9.31-20261027-01") + path.sep));
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const fixture = "F:/AgentVN/QA/Editor-Cross-1931-20261028-02";
const sourceDB = path.join(fixture, "archived-profile-0/backend/vn_engine.db");
const originalSHA = sha(sourceDB), copy = path.join(out, "comparison.db");
const result = { status: "RUNNING", fixture, sourceSHA256: originalSHA, productChanges: 0, modelRequests: 0 };
try {
  assert.equal(read(path.join(fixture, "report.json")).status, "FAILED");
  fs.copyFileSync(sourceDB, copy, fs.constants.COPYFILE_EXCL);
  const db = new DatabaseSync(copy, { readOnly: true });
  let project;
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    const records = db.prepare("SELECT project_json FROM editor_project_details").all();
    assert.equal(records.length, 1); project = JSON.parse(records[0].project_json);
  } finally { db.close(); }
  const expected = read(path.join(fixture, "old-baseline.json")).project;
  const node = expected.graph.nodes.find(n => n.id === "node_scene_opening");
  node.data.description = node.data.scene.summary = "实际跨代后新保存1.9.31";
  const actual = { metadata: { projectId: project.project_id, title: project.title, author: project.author },
    graph: { nodes: project.nodes, edges: project.edges } };
  const source = build(read(configFile), read("F:/AgentVN/QA/Editor-1.9.31-20261027-01/cross-preparation-02/binding.json").registered).source;
  const start = source.indexOf("function comparable("), end = source.indexOf("async function closeNormally(", start);
  assert(start > 0 && end > start);
  const api = new Function("assert", source.slice(start, end) + "\nreturn {comparable,retainedFields};")(assert);
  const compare = (a, b) => api.retainedFields(api.comparable(a), api.comparable(b));
  compare(actual, expected);
  const mutations = [
    p => p.metadata.projectId = "wrong",
    p => p.metadata.title += "丢失",
    p => p.graph.nodes[1].id = "wrong",
    p => p.graph.nodes[1].position.x += 1,
    p => p.graph.nodes[1].data.description = "丢失",
    p => p.graph.nodes[1].data.scene.commands.pop(),
    p => p.graph.edges.pop(),
    p => p.graph.nodes[1].width = 500,
    p => p.graph.nodes[1].height = 500,
  ];
  for (const mutate of mutations) {
    const baseline = structuredClone(expected);
    // Authored width/height are retained; they are not React Flow's measured values.
    const changed = structuredClone(actual);
    if ([7, 8].includes(mutations.indexOf(mutate))) {
      baseline.graph.nodes[1][mutations.indexOf(mutate) === 7 ? "width" : "height"] = 400;
    }
    mutate(changed); assert.throws(() => compare(changed, baseline));
  }
  for (const invalid of [{ width: -1 }, { height: Infinity }, { width: 100, custom: true }]) {
    const bad = structuredClone(actual); bad.graph.nodes[1].measured = invalid;
    assert.throws(() => api.comparable(bad));
  }
  result.status = "PASS"; result.rejectedAuthoredChanges = mutations.length;
  result.rejectedInvalidMeasurements = 3;
  result.excluded = "Only finite nonnegative React Flow measured.width/height; authored geometry is retained";
} catch (e) { result.status = "FAILED"; result.error = String(e.stack || e); process.exitCode = 1; }
finally {
  assert.equal(sha(sourceDB), originalSHA);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify(result));
}
