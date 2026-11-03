"use strict";
// Exercise the real orchestration loop: a picker request can be observed mid-write.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { EventEmitter } = require("node:events");
const sourcePath = path.join(__dirname, "installed-assistant-native-flow.cjs");
const source = fs.readFileSync(sourcePath, "utf8");
async function run(mode) {
  const partial = mode === "partial", failing = ["corrupt", "owner", "helper"].includes(mode);
  const out = path.resolve("output/native-flow-test-only"), files = new Map();
  const requestFile = path.join(out, "native-input-request.json");
  const requests = ["project-save-directory", "project-open"].map((name, index) => ({
    name, requestId: `request-${index}`, ownerPid: 12345, cancel: false,
    selectedPath: path.join(out, index ? "中文 工程.vnproj" : "中文 目录"),
    completion: path.join(out, `${name}-completed.json`),
  }));
  files.set(path.join(out, "installed-processes.json"), JSON.stringify({ editorPid: 12345 }));
  let index = 0, injected = false, helperCount = 0, readCount = 0, clock = 0, resolveReport;
  const done = new Promise(resolve => { resolveReport = resolve; });
  const runner = new EventEmitter(); runner.pid = 123; runner.stdout = new EventEmitter(); runner.stderr = new EventEmitter();
  const fakeFs = {
    existsSync(file) { return files.has(file); },
    readFileSync(file) {
      if (file === requestFile && mode === "corrupt" && index === 1) {
        readCount += 1; clock += 1000; if (readCount === 3) setTimeout(() => runner.emit("exit", 7), 0);
        return '{"requestId":';
      }
      if (file === path.join(out, "installed-processes.json") && mode === "owner" && index === 1)
        return JSON.stringify({ editorPid: 54321 });
      if (file === requestFile && partial && index === 1 && !injected) { injected = true; return '{"requestId":'; }
      if (!files.has(file)) { const error = new Error(`ENOENT ${file}`); error.code = "ENOENT"; throw error; }
      return files.get(file);
    },
    writeFileSync(file, data, options) {
      if (options?.flag === "wx") assert(!files.has(file), "Existing completion must never be replaced");
      files.set(file, data);
      if (file === requests[index]?.completion) {
        const completed = JSON.parse(data);
        if (failing && index === 1) {
          assert.equal(completed.status, "NATIVE_INPUT_FAILED");
          setTimeout(() => runner.emit("exit", 7), 0); return;
        }
        index += 1;
        if (index < requests.length) files.set(requestFile, JSON.stringify(requests[index]));
        else setTimeout(() => runner.emit("exit", 0), 0);
      }
      if (file === path.join(out, "native-wrapper-report.json")) resolveReport(JSON.parse(data));
    },
  };
  function spawn(command, args) {
    if (command === "node-test") { setTimeout(() => files.set(requestFile, JSON.stringify(requests[0])), 0); return runner; }
    assert.equal(command, "powershell.exe"); helperCount += 1;
    const helper = new EventEmitter(); helper.stdout = new EventEmitter(); helper.stderr = new EventEmitter();
    const argument = name => args[args.indexOf(name) + 1];
    const evidence = argument("-ReportPath"), selectedPath = argument("-Directory");
    const failedHelper = mode === "helper" && index === 1;
    files.set(evidence, JSON.stringify({ status: failedHelper ? "FAILED" : "PASS", ownerPid: 12345, directory: selectedPath }));
    setTimeout(() => { helper.stderr.emit("data", failedHelper ? "native input failed" : "normal diagnostic output"); helper.emit("exit", failedHelper ? 9 : 0); }, 0);
    return helper;
  }
  const processShim = { argv: ["node-test", sourcePath, path.join(out, "audit.json"), out],
    execPath: "node-test", env: { AGENTVN_WORKSPACE_OUTPUT: out }, stdout: { write() {} } };
  vm.runInNewContext(source, { require(name) {
    if (name === "node:fs") return fakeFs;
    if (name === "node:child_process") return { spawn };
    if (name === "./lib/installed-acceptance.cjs") return { inside: require("./lib/installed-acceptance.cjs").inside };
    return require(name);
  }, __dirname, process: processShim, Date: { now: () => mode === "corrupt" ? clock : Date.now() },
    setTimeout: (fn, delay) => setTimeout(fn, Math.min(delay, 2)) }, { filename: sourcePath });
  const result = await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("Wrapper failed to finish")), 2000))]);
  if (failing) {
    assert.equal(result.status, "FAILED"); assert.equal(result.runnerExitCode, 7);
    if (mode === "corrupt") { assert.equal(result.readRetries, 3); assert(result.pendingReadError.includes("SyntaxError")); }
    if (mode === "owner") assert.equal(helperCount, 1, "Changed owner must never receive native input");
    if (mode === "helper") assert.equal(result.nativeRecords[1].result.code, 9);
    return;
  }
  assert.equal(result.status, "PASS", files.get(path.join(out, "native-wrapper.log")));
  assert.equal(result.runnerExitCode, 0); assert.equal(helperCount, 2);
  assert.equal(result.nativeRecords.length, 2);
  assert(result.nativeRecords.every(record => record.status === "PASS"));
  assert.equal(injected, partial);
}
(async () => { await run("complete"); console.log("PASS complete request / native stderr / two pickers");
  await run("partial"); console.log("PASS partial rewritten request recovers without duplicate picker");
  for (const mode of ["corrupt", "owner", "helper"]) { await run(mode); console.log(`PASS ${mode} failure preserved / waits for runner cleanup`); }
})().catch(error => { console.error(error); process.exitCode = 1; });
