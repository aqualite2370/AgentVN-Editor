"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the actual acceptance entrypoints and their nested error paths.
// All OS/file mutations are intercepted; no device or administrator is needed.
async function exercise(script, { elevated = true, uninstallFails = false } = {}) {
  const staging = path.resolve("output/android-cleanup-test/staging.apk");
  const calls = [];
  const writes = [];
  let removed = false;
  const fakeFs = {
    existsSync: (file) => file !== staging || !removed,
    mkdirSync() {},
    statSync: () => ({ size: 4, mtime: new Date(0) }),
    readFileSync: () => Buffer.from("test"),
    writeFileSync: (file, text) => writes.push({ file, text }),
    rmSync: (file) => { assert.equal(file, staging); removed = true; calls.push("remove"); },
  };
  const spawnSync = (command, args = []) => {
    if (command === "powershell.exe") return { status: 0, stdout: `${elevated}`, stderr: "" };
    if (command === "fltmc.exe") return { status: elevated ? 0 : 1 };
    const action = args[2];
    calls.push(action);
    if (action === "get-state") return { status: 0, stdout: "device", stderr: "" };
    if (action === "install") return { status: 1, stdout: "", stderr: "INSTALL_FAILED_TEST" };
    if (action === "uninstall") {
      const repeated = calls.filter((item) => item === "uninstall").length > 1;
      return { status: uninstallFails || repeated ? 1 : 0, stdout: uninstallFails || repeated ? "Failure [DELETE_FAILED_INTERNAL_ERROR]" : "Success", stderr: "" };
    }
    return { status: 0, stdout: "Physical size: 2400x1080", stderr: "" };
  };
  const filename = path.join(__dirname, script);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    require: (name) => name === "node:fs" ? fakeFs
      : name === "node:child_process" ? { spawnSync }
        : require(name),
    __dirname,
    process: {
      platform: "win32",
      argv: ["node", filename, "--apk", staging, "--staging-apk", staging, "--package", "com.agentvn.test"],
      exit() {},
    },
    console: { log() {}, error() {} },
    Buffer,
    setTimeout,
    clearTimeout,
  }, { filename });
  await new Promise(setImmediate);
  const report = JSON.parse(writes.at(-1).text);
  return { calls, report, removed };
}

(async () => {
  // The unified runner now owns its staging copy and isolated ADB prefix;
  // exercise that contract with its dedicated process/ownership harness.
  require('./android-acceptance-runner-test.cjs');
  for (const script of ["hidden-growth-android-landscape-acceptance.cjs"]) {
    const failure = await exercise(script);
    assert.equal(failure.calls.filter((item) => item === "uninstall").length, 1, `${script}: nested error handlers must uninstall only once`);
    assert.equal(failure.report.uninstallStatus, "PASS", `${script}: preserve successful cleanup`);
    assert.equal(failure.report.apkCleanupStatus, "PASS");
    assert.match(failure.report.message, /INSTALL_FAILED_TEST/);
    assert.notEqual(failure.report.status, "RUNTIME_PASS");
    const cleanupFailure = await exercise(script, { uninstallFails: true });
    assert.match(cleanupFailure.report.cleanupError, /DELETE_FAILED_INTERNAL_ERROR/, `${script}: retain cleanup failure cause`);
    assert.equal(cleanupFailure.removed, true, `${script}: uninstall failure must not prevent staging cleanup`);
    const denied = await exercise(script, { elevated: false });
    assert.equal(denied.calls.length, 0, `${script}: failed admin gate must not run adb or remove files`);
    assert.equal(denied.report.failureCode, "ANDROID_ADMIN_REQUIRED");
  }
  require("./acceptance-native-command-test.cjs");
  require("./android-touch-scroll-test.cjs");
  console.log("PASS Android cleanup: nested failure, cleanup error reporting, administrator gate");
})().catch((error) => { console.error(error); process.exitCode = 1; });
