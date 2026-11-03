"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict");
const { build, validateConfig } = require("./installed-editor-android-candidate.cjs");
const [configFile, reportFile] = process.argv.slice(2);
assert(configFile && reportFile && !fs.existsSync(reportFile));
const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
const report = { status: "RUNNING", tests: [], productLaunches: 0, apkBuilds: 0, modelRequests: 0 };
async function test(name, fn) {
  const row = { name, status: "RUNNING" }; report.tests.push(row);
  try { row.evidence = await fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
(async () => {
  try {
    await test("Explicit controlled configuration replaces only the directory seam, with honest scope", () => {
      validateConfig(config);
      const source = build("business", config).source;
      assert(source.includes("selectControlledPackageOutput"), "Missing authorized one-shot directory seam");
      assert(source.includes('report.normalUIExportStatus = "PASS_UI_CONTROLLED_DIRECTORY"'));
      assert(!source.includes("report.nativeOutput = await nativeInput"));
      assert(source.includes('report.nativePickerStatus = "NOT_RUN_CONTROLLED_INPUT"'));
      const native = build("business", { ...config, outputDirectoryMode: undefined }).source;
      assert(native.includes("report.nativeOutput = await nativeInput"));
      assert(!native.includes("selectControlledPackageOutput"));
      for (const mode of ["", "auto", "native", true, "../escape"])
        assert.throws(() => validateConfig({ ...config, outputDirectoryMode: mode }));
      return { invalidModesRejected: 5, normalPickerUnchanged: true };
    });
    const { oneShotDirectoryResponse, validateControlledDestination } =
      require("./lib/controlled-package-output.cjs");
    const destination = path.join("F:/AgentVN/QA/Android-Package-20261021-01", "editor-28", "Android 输出");
    const ipcUrl = "http://ipc.localhost/select_package_output_dir";
    const contextFor = original => {
      const api = {};
      Object.defineProperty(api, "invoke", { value: async () => "NATIVE" });
      Object.defineProperty(api, "convertFileSrc", { value: () => ipcUrl });
      return vm.createContext({ window: { __TAURI_INTERNALS__: api, fetch: original }, Response });
    };
    const options = { method: "POST", body: "{}" };
    await test("One exact picker response, all other IPC preserved, original invoke restored", async () => {
      const calls = [], original = async (...args) => { calls.push(args); return "REAL_IPC"; };
      const context = contextFor(original);
      const run = (action, extra = {}) => vm.runInContext(
        `(${oneShotDirectoryResponse.toString()})(${JSON.stringify({ action, token: "qa-token", destination, ...extra })})`,
        context);
      run("install");
      assert.equal(await context.window.fetch("http://ipc.localhost/read_native_file", { key: 2 }), "REAL_IPC");
      const response = await context.window.fetch(ipcUrl, options);
      assert.equal(await response.json(), destination);
      assert.equal(response.headers.get("Tauri-Response"), "ok");
      assert.equal(context.window.fetch, original);
      assert.equal(await context.window.fetch(ipcUrl, options), "REAL_IPC");
      assert.equal(Object.getOwnPropertyDescriptor(context.window.__TAURI_INTERNALS__, "invoke").writable, false);
      const state = run("inspect");
      assert.equal(state.calls, 1); assert.equal(state.restored, true);
      run("cleanup"); assert.equal(context.window.__agentvnQaDirectory, undefined);
      assert.equal(calls.length, 2);
      return { injectedCalls: 1, realIpcCalls: calls.length, restored: true };
    });
    await test("Cancellation, failed click, wrong token and changed IPC cannot leak a test hook", async () => {
      for (const changed of [false, true]) {
        const original = async () => null;
        const context = contextFor(original);
        const run = (action, token = "qa-token") => vm.runInContext(
          `(${oneShotDirectoryResponse.toString()})(${JSON.stringify({ action, token, destination })})`, context);
        run("install");
        assert.throws(() => run("install"));
        assert.throws(() => run("inspect", "stale"));
        if (changed) context.window.fetch = async () => "OTHER_OWNER";
        const state = run("cleanup");
        assert.equal(state.calls, 0);
        assert.equal(context.window.__agentvnQaDirectory, undefined);
        if (!changed) assert.equal(context.window.fetch, original);
        else assert.equal(await context.window.fetch(), "OTHER_OWNER");
      }
      const context = contextFor(async () => "REAL");
      vm.runInContext(`(${oneShotDirectoryResponse.toString()})(${JSON.stringify({
        action: "install", token: "qa-token", destination,
      })})`, context);
      await assert.rejects(() => context.window.fetch(ipcUrl, { method: "POST", body: '{"unrecognized":true}' }));
      assert.equal(await context.window.fetch("http://ipc.localhost/unrelated"), "REAL");
      assert.equal(context.window.__agentvnQaDirectory.calls, 0);
      vm.runInContext(`(${oneShotDirectoryResponse.toString()})(${JSON.stringify({
        action: "cleanup", token: "qa-token", destination,
      })})`, context);
      return { scenarios: 5, noProductFilesChanged: true };
    });
    await test("Destination is the owned run directory only, no arbitrary path or symlink escape", () => {
      validateControlledDestination({ out: path.dirname(destination), destination, ownerPid: 123 });
      for (const input of [
        { out: "D:/AgentVN" }, { destination: "C:/Users/1/Downloads" }, { ownerPid: 0 },
        { destination: path.join(destination, "..") },
        { out: path.dirname(destination) + "-other" },
      ]) assert.throws(() => validateControlledDestination({
        out: path.dirname(destination), destination, ownerPid: 123, ...input,
      }));
      return { rejected: 5 };
    });
    await test("Temporary hook is excluded from all shipped build helpers", () => {
      const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, "standalone-build-scripts.json"), "utf8")).scripts;
      for (const name of ["lib/controlled-package-output.cjs", "installed-editor-android-candidate.cjs",
        "android-candidate-renpy.cjs"]) assert(!shipped.includes(name));
      return { shippedTemporaryHooks: 0 };
    });
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
})();
