"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("../editor/node_modules/typescript");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
};
const { createMockNovelProcessSnapshot, readPersistedNovelProcessTaskSnapshot } =
  require("../editor/src/novel-import/novelProcessJobAdapter.ts");
const storage = new Map();
global.window = { localStorage: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
} };
const now = new Date().toISOString();
const input = { projectId: "preflight-unit-project", projectTitle: "本地预检",
  session: { session_id: "unit-session", chapters: [], scenes: [], chunks: [],
    adapted_scenes: [], planned_chapter_ids: [], created_at: now, updated_at: now },
  errors: [], warnings: [], inspectableResults: [], isProcessing: true,
  progress: { phase: "import", current: 0, total: 1, message: "读取文件", updatedAt: Date.now() } };
const results = [];
function test(name, run) {
  try { run(); results.push({ name, status: "PASS" }); }
  catch (error) { results.push({ name, status: "FAILED", error: String(error.stack || error) }); }
}
test("local-file-read-does-not-create-model-task", () => {
  assert.equal(createMockNovelProcessSnapshot(input), undefined);
});
test("local-chapter-split-does-not-create-model-task", () => {
  assert.equal(createMockNovelProcessSnapshot({ ...input,
    progress: { ...input.progress, total: 5000, current: 2400, message: "本地拆分" } }), undefined);
});
const actual = JSON.parse(JSON.stringify(createMockNovelProcessSnapshot({
  ...input, progress: { ...input.progress, phase: "scan" },
})));
test("actual-scan-still-creates-snapshot", () => {
  assert(actual);
  assert.equal(actual.job.status, "running");
  assert(actual.events.some(event => event.payload?.phase === "scan"));
});
test("existing-legacy-paused-job-keeps-state-during-local-read", () => {
  const snapshot = createMockNovelProcessSnapshot({ ...input,
    importJob: { status: "paused", pauseRequested: true, total: 1, failedSceneIds: [] } });
  assert.equal(snapshot.job.status, "paused");
  assert(!snapshot.events.some(event => event.payload?.phase === "import"),
    "Local file progress must not contaminate an existing task's event log");
});
const oldLocal = structuredClone(actual);
oldLocal.events = oldLocal.events.map(event => event.payload?.phase === "scan"
  ? { ...event, payload: { ...event.payload, phase: "import" } } : event);
const key = `agentvn.novelProcessTaskWorkbench.snapshot.${input.projectId}`;
function restore(snapshot) {
  const raw = JSON.stringify(snapshot);
  storage.clear();
  storage.set(key, raw);
  const result = readPersistedNovelProcessTaskSnapshot(input.projectId);
  assert.equal(storage.get(key), raw, "Reading must preserve original cache bytes for recovery");
  return result;
}
test("old-local-only-cache-is-not-revived-as-processing", () => {
  assert.equal(restore(oldLocal), undefined);
});
test("real-api-cache-with-similar-events-is-preserved", () => {
  const api = { ...oldLocal, job: { ...oldLocal.job, source: "api" } };
  assert.deepEqual(restore(api), api);
});
test("legacy-scan-cache-is-preserved", () => {
  assert.deepEqual(restore(actual), actual);
});
test("cache-with-real-result-event-is-preserved", () => {
  const real = { ...oldLocal, events: [...oldLocal.events, {
    eventId: "result", jobId: oldLocal.job.jobId, type: "agent_completed",
    createdAt: now, level: "success", title: "实际结果", message: "保留",
  }] };
  assert.deepEqual(restore(real), real);
});
test("completed-history-is-preserved", () => {
  const completed = { ...oldLocal, job: { ...oldLocal.job, status: "completed", completedChunks: 1 } };
  assert.deepEqual(restore(completed), completed);
});
test("ambiguous-cache-with-warning-is-preserved", () => {
  const ambiguous = { ...oldLocal, events: [...oldLocal.events, {
    eventId: "warning", type: "agent_output_updated", message: "需要复核",
  }] };
  assert.deepEqual(restore(ambiguous), ambiguous);
});
for (const result of results) console.log(JSON.stringify(result));
const failed = results.filter(item => item.status === "FAILED").length;
console.log(JSON.stringify({ tests: results.length, passed: results.length - failed, failed }));
if (failed) process.exitCode = 1;
