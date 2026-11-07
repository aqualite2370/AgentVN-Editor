"use strict";
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict"), ts = require("../editor/node_modules/typescript");
const filename = path.resolve(__dirname, "../editor/src/packaging/standalonePackage.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let response, rejection, calls = [];
const subject = new Module(filename, module);
subject.filename = filename;
subject.paths = Module._nodeModulePaths(path.dirname(filename));
subject.require = name => {
  if (name === "@tauri-apps/api/core") return { invoke: async (command, args) => {
    calls.push({ command, args });
    if (rejection !== undefined) throw rejection;
    return response;
  } };
  if (name.endsWith("frontendErrorLogger")) return { reportFrontendError() {} };
  return module.require(name);
};
subject._compile(compiled, filename);
global.window = { __TAURI_INTERNALS__: {} };
const api = subject.exports;
const nativeError = "Failed to publish JSON C:\\测试目录\\windows-env-check.json atomically: 系统找不到指定的路径。 (os error 3)";
(async () => {
  let count = 0;
  for (const [method, expectedCommand] of [
    ["checkWindowsBuildEnvironment", "check_windows_build_environment"],
    ["installWindowsBuildEnvironment", "install_windows_build_environment"],
    ["checkAndroidBuildEnvironment", "check_android_build_environment"],
    ["installAndroidBuildEnvironment", "install_android_build_environment"],
    ["importAndroidEnvironmentPackage", "import_android_environment_package"],
  ]) {
    rejection = nativeError;
    await assert.rejects(api[method]("isolated-run"), error => {
      assert(error instanceof Error, `${method}: native string must reach UI Error branches`);
      assert.equal(error.message, nativeError);
      assert.equal(error.cause, nativeError);
      return true;
    });
    assert.equal(calls.at(-1).command, expectedCommand);
    count++;
  }
  const original = new Error("已有错误");
  rejection = original;
  await assert.rejects(api.checkWindowsBuildEnvironment(), error => error === original); count++;
  rejection = { message: "原生结构化错误", code: 5 };
  await assert.rejects(api.checkWindowsBuildEnvironment(), error =>
    error instanceof Error && error.message === rejection.message && error.cause === rejection); count++;
  for (const value of ["", null, 42, {}]) {
    rejection = value;
    await assert.rejects(api.checkWindowsBuildEnvironment(), error =>
      error instanceof Error && error.message.includes("check_windows_build_environment")); count++;
  }
  rejection = undefined; response = { ok: true, status: "PASS", cacheHit: true };
  assert.equal(await api.checkWindowsBuildEnvironment("real-run", true), response);
  assert.deepEqual(calls.at(-1).args, { runId: "real-run", forceRecheck: true }); count++;
  console.log(`PASS: ${count} packaging native error/identity/success cases; controlled native responses, no product start`);
})().catch(error => { console.error(error); process.exitCode = 1; });
