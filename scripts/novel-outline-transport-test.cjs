"use strict";
// Execute the actual transport in a controlled browser-like clock/socket seam.
// No network, backend or paid request. Late events must not reopen a terminal job.
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const ts = require("../editor/node_modules/typescript");
const source = fs.readFileSync(require.resolve("../editor/src/novel-import/adaptationClient.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
async function test(mode) {
  const commands = [], callbacks = [], timers = new Set(), intervals = new Set();
  let fetches = 0, sockets = 0, errors = 0, finals = 0;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    constructor() { sockets++; setImmediate(() => this.onopen?.()); }
    send(raw) {
      const command = JSON.parse(raw); commands.push(command.command);
      if (command.command === "start_novel_job") {
        setImmediate(() => {
          this.onmessage({ data: JSON.stringify({ type: "lifecycle", seq: 1, payload: "started" }) });
          if (mode === "lost") {
            this.readyState = 3; this.onclose();
          } else {
            this.onmessage({ data: JSON.stringify({ type: "error", seq: 2, payload: { message: "length" } }) });
            this.onmessage({ data: JSON.stringify({ type: "message_delta", seq: 3, payload: "late" }) });
            this.onmessage({ data: JSON.stringify({ type: "final", seq: 4, payload: {} }) });
          }
        });
      } else if (command.command === "subscribe_job") {
        setImmediate(() => {
          this.onmessage({ data: JSON.stringify({ type: "error", payload: { message: "job not found" } }) });
          this.onmessage({ data: JSON.stringify({ type: "final", seq: 3, payload: {} }) });
        });
      }
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const exports = {};
  const context = vm.createContext({ exports, console, WebSocket: Socket, AbortController,
    fetch: async () => { fetches++; throw Error("SSE must not replay a started job"); },
    window: {
      setTimeout(fn, delay) {
        const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay <= 3000 ? 1 : delay);
        timers.add(timer); return timer;
      },
      clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
      setInterval(fn, delay) { const timer = setInterval(fn, delay); intervals.add(timer); return timer; },
      clearInterval(timer) { clearInterval(timer); intervals.delete(timer); },
    },
    require(name) {
      if (name === "nanoid") return { nanoid: () => "controlled" };
      if (name.includes("backendClient")) return { backendClient: { getBaseUrl: () => "http://127.0.0.1:1" } };
      if (name.includes("sourceMapping")) return {};
      if (name.includes("frontendErrorLogger")) return { reportFrontendError() {} };
      throw Error(`Unexpected import ${name}`);
    },
  });
  vm.runInContext(code, context);
  try {
    await assert.rejects(exports.aiBuildNovelOutlineStream({
      document_id: "doc", title: "QA", total_chars: 100, analyses: [],
      partial_source_hash: "a".repeat(64), partial_batches: [],
    }, {
      onDelta: value => callbacks.push(value), onError: () => errors++, onFinal: () => finals++,
    }), mode === "lost" ? /未自动重新提交/ : /length/);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(commands.filter(c => c === "start_novel_job").length, 1);
    assert.equal(commands.filter(c => c === "subscribe_job").length, mode === "lost" ? 1 : 0);
    assert.equal(sockets, mode === "lost" ? 2 : 1);
    assert.equal(fetches, 0); assert.equal(errors, 1); assert.equal(finals, 0);
    assert.deepEqual(callbacks, []);
    assert.equal(timers.size, 0); assert.equal(intervals.size, 0);
    return { mode, status: "PASS", starts: 1, subscribes: mode === "lost" ? 1 : 0,
      sseRequests: fetches, lateCallbacks: callbacks.length + finals };
  } finally { for (const timer of timers) clearTimeout(timer); for (const timer of intervals) clearInterval(timer); }
}
(async () => {
  const cases = [await test("lost"), await test("terminal")];
  console.log(JSON.stringify({ status: "PASS", cases }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
