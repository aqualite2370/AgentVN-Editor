"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const requireEditor = createRequire(path.join(root, "editor/package.json"));
const esbuild = requireEditor("esbuild");
const compiled = esbuild.buildSync({
  stdin: {
    contents: `export {
      cancelAssistantCreationProcess,
      enqueueAssistantCreationProcess,
      getAssistantCreationProcesses,
      subscribeAssistantCreationProcesses,
    } from "./editor/src/assistant/creationProcessQueue";`,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  define: { "import.meta.env": JSON.stringify({ VITE_BACKEND_URL: "http://queue.test" }) },
  write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", compiled.outputFiles[0].text)(loaded, loaded.exports);
global.window = global;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  const records = new Map();
  const fifo = [];
  const order = [];
  let hasActiveProcess = false;
  let modelCalls = 0;
  let maxConcurrent = 0;
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const activeStarted = deferred();
  const releaseActive = deferred();

  const component = (name) => ({
    name,
    description: "受控结果",
    html: '<div class="root"><span>结果</span></div>',
    css: ".root { display: flex; }",
  });
  const publicRecord = record => ({
    id: record.id, projectId: record.projectId, projectTitle: record.projectTitle,
    conversationId: record.conversationId, status: record.status,
    submittedAt: record.submittedAt,
    ...(record.result ? { result: record.result } : {}),
  });
  const pump = async () => {
    if (hasActiveProcess) return;
    const record = fifo.shift();
    if (!record) return;
    hasActiveProcess = true;
    record.status = "running";
    modelCalls += 1;
    maxConcurrent = Math.max(maxConcurrent, modelCalls);
    order.push(record.request.user_request);
    if (record.request.user_request.includes("任务 A")) {
      firstStarted.resolve();
      await releaseFirst.promise;
    }
    if (record.request.user_request.includes("活动取消")) {
      activeStarted.resolve();
      await releaseActive.promise;
    }
    record.status = record.status === "cancelling" ? "cancelled" : "completed";
    if (record.status === "completed") record.result = component(record.request.user_request);
    hasActiveProcess = false;
    void pump();
  };

  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const pathname = url.pathname;
    const method = init.method ?? "GET";
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "content-type": "application/json" },
    });
    if (pathname === "/api/assistant/creation/processes" && method === "POST") {
      const payload = JSON.parse(init.body);
      const record = {
        id: payload.id, projectId: payload.project_id, projectTitle: payload.project_title,
        conversationId: payload.conversation_id, request: payload.request,
        status: "queued", submittedAt: Date.now(),
      };
      records.set(record.id, record);
      fifo.push(record);
      void pump();
      return json(publicRecord(record), 202);
    }
    if (pathname === "/api/assistant/creation/processes" && method === "GET") {
      return json({ processes: [...records.values()].map(publicRecord) });
    }
    const match = pathname.match(/^\/api\/assistant\/creation\/processes\/([^/]+)(?:\/(cancel))?$/);
    if (!match) return json({ message: "not found" }, 404);
    const record = records.get(decodeURIComponent(match[1]));
    if (!record) return json({ message: "not found" }, 404);
    if (match[2] === "cancel" && method === "POST") {
      if (record.status === "queued") {
        const index = fifo.indexOf(record);
        if (index >= 0) fifo.splice(index, 1);
        record.status = "cancelled";
      } else if (record.status === "running") record.status = "cancelling";
      return json(publicRecord(record));
    }
    return json(publicRecord(record));
  };

  const first = loaded.exports.enqueueAssistantCreationProcess({
    projectId: "project-a", projectTitle: "工程 A", conversationId: "conversation-a",
  }, { user_request: "任务 A", messages: [], provider_selection: undefined });
  const second = loaded.exports.enqueueAssistantCreationProcess({
    projectId: "project-b", projectTitle: "工程 B", conversationId: "conversation-b",
  }, { user_request: "任务 B", messages: [], provider_selection: undefined });
  await firstStarted.promise;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(modelCalls, 1, "第一个任务运行期间不能并发调用第二个模型任务");
  assert.equal(loaded.exports.cancelAssistantCreationProcess(second.id), true);
  await assert.rejects(second.result, { name: "AbortError" });
  releaseFirst.resolve();
  assert.equal((await first.result).name, "任务 A");
  assert.deepEqual(order, ["任务 A"], "取消的排队任务不得调用模型");
  assert.equal(maxConcurrent, 1);

  const active = loaded.exports.enqueueAssistantCreationProcess({
    projectId: "project-c", projectTitle: "工程 C", conversationId: "conversation-c",
  }, { user_request: "活动取消", messages: [] });
  const activeRecord = records.get(active.id);
  assert(activeRecord, "提交进程应立即进入本机后端持久队列");
  await activeStarted.promise;
  assert.equal(activeRecord.status, "running");
  loaded.exports.cancelAssistantCreationProcess(active.id);
  assert.equal(records.get(active.id).status, "cancelling");
  releaseActive.resolve();
  await assert.rejects(active.result, { name: "AbortError" });
  assert.equal(loaded.exports.getAssistantCreationProcesses().find(item => item.id === active.id).status, "cancelled");

  console.log("assistant-creation-process-queue-test: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
