"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(out.startsWith("F:\\testavn\\Editor-Home-Save-Ordering-20261116-01\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const bytes = require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: 'export {BackendClient} from "./editor/src/api/backendClient";' },
  bundle: true, platform: "node", format: "cjs", write: false, define: { "import.meta.env": "{}" },
  nodePaths: [path.join(root, "editor/node_modules")],
}).outputFiles[0].text;
const compiled = new Module(path.join(out, "entry.cjs"), module); compiled.filename = path.join(out, "entry.cjs");
compiled.paths = Module._nodeModulePaths(root); compiled._compile(bytes, compiled.filename);
const { BackendClient } = compiled.exports;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(setImmediate);
const report = { status: "RUNNING", scope: "ACTUAL_BACKEND_CLIENT_TWO_REAL_WRITE_ENTRYPOINTS_CONTROLLED_TRANSPORT",
  cases: [], modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function check(name, firstMethod, secondMethod, rejectFirst = false) {
  const row = { name, status: "RUNNING", calls: [] }; report.cases.push(row); save();
  const held = deferred(); let active = 0, maximum = 0, stored;
  const client = new BackendClient();
  client.request = async (route, options) => {
    const data = JSON.parse(options.body), call = { route, method: options.method, data };
    row.calls.push(call); active++; maximum = Math.max(maximum, active);
    try {
      if (row.calls.length === 1) { await held.promise; if (rejectFirst) throw Error("QA_FIRST_WRITE_FAILED"); }
      stored = data; return { ok: true, data };
    } finally { active--; }
  };
  const invoke = (method, revision) => method === "PUT"
    ? client.saveProject({ project_id: "qa_write_ordering", revision })
    : client.saveProjectState(() => ({ project_metadata: { projectId: "qa_write_ordering" }, revision }));
  const first = invoke(firstMethod, "old").then(value => ({ value }), error => ({ error: error.message }));
  await tick(); const second = invoke(secondMethod, "new"); await tick();
  row.beforeRelease = { requests: row.calls.length, maximum, stored };
  held.resolve();
  const result = await first; await second;
  try {
    assert.equal(row.beforeRelease.requests, 1, "Both entrypoints must share one write queue");
    assert.equal(maximum, 1, "No overlapping project writes");
    assert.equal(stored.revision, "new", "Newest author revision wins");
    if (rejectFirst) assert.equal(result.error, "QA_FIRST_WRITE_FAILED"); else assert(result.value);
    row.status = "PASS";
  } catch (error) { row.status = "FAILED"; row.error = error.stack; }
  row.maximum = maximum; row.finalStored = stored; save();
}
(async () => {
  await check("detail PUT then graph state POST", "PUT", "POST");
  await check("graph state POST then detail PUT", "POST", "PUT");
  await check("detail PUT then detail PUT", "PUT", "PUT");
  await check("graph state POST then graph state POST", "POST", "POST");
  await check("failed detail PUT releases queued graph write", "PUT", "POST", true);
  await check("failed graph write releases queued detail PUT", "POST", "PUT", true);
  report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; }).finally(() => {
  save(); console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    failed: report.cases.filter(c => c.status === "FAILED").map(c => c.name), out }));
  if (report.status !== "PASS") process.exitCode = 1;
});
