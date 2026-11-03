const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require(path.join(__dirname, "..", "editor", "node_modules", "esbuild"));

const root = path.resolve(__dirname, "..");
const modulePath = path.join(root, "editor/src/packaging/packageEnvironmentState.ts");
const bundled = esbuild.buildSync({
  entryPoints: [modulePath],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
}).outputFiles[0].text;
const moduleObject = { exports: {} };
new Function("module", "exports", "require", bundled)(moduleObject, moduleObject.exports, require);
const {
  deriveActivePackageEnvironment,
  derivePackageEnvironmentVerification,
  shouldPublishPackageEnvironmentMessages,
  visiblePackageEnvironmentManualFix,
} = moduleObject.exports;

assert.deepEqual(
  derivePackageEnvironmentVerification({
    busy: null,
    result: { status: "PASS", cacheHit: true },
  }),
  {
    state: "passed",
    label: "已通过",
    detail: "已复用当前编辑器版本通过的环境检测结果。",
    freshPass: true,
  },
  "a host-validated current-version cached PASS must allow publishing",
);

const androidPendingWindowsPass = {
  mode: "standalone_package",
  targetPlatform: "windows",
  androidBusy: "check",
  windowsBusy: null,
  androidResult: undefined,
  windowsResult: { status: "PASS", manualFix: ["stale setup guidance"] },
};
for (const targetPlatform of ["windows", "android"]) {
  const active = deriveActivePackageEnvironment({
    ...androidPendingWindowsPass,
    targetPlatform,
    androidBusy: null,
    androidResult: { status: "PASS", cacheHit: true },
    windowsResult: { status: "PASS", cacheHit: true },
  });
  assert.equal(active.verification.freshPass, true, `${targetPlatform}: version-valid cached PASS must satisfy the build gate`);
  assert.equal(active.blocked, false);
}
assert.equal(derivePackageEnvironmentVerification({ busy: null, result: { status: "BLOCKED", cacheHit: true } }).state, "failed");
assert.equal(derivePackageEnvironmentVerification({ busy: "check", result: { status: "PASS", cacheHit: true } }).state, "checking");
assert.deepEqual(
  deriveActivePackageEnvironment(androidPendingWindowsPass),
  {
    busy: null,
    result: androidPendingWindowsPass.windowsResult,
    verification: {
      state: "passed",
      label: "已通过",
      detail: "当前构建环境已通过检测。",
      freshPass: true,
    },
    blocked: false,
  },
  "an Android background check must not keep the Windows action busy or blocked",
);

const androidFinishedInBackground = {
  ...androidPendingWindowsPass,
  androidBusy: null,
  androidResult: { status: "BLOCKED", manualFix: ["install Android SDK"] },
};
assert.equal(
  deriveActivePackageEnvironment(androidFinishedInBackground).result.status,
  "PASS",
  "an Android result arriving later must not replace the active Windows result",
);
assert.equal(
  shouldPublishPackageEnvironmentMessages({
    mode: "standalone_package",
    activePlatform: "windows",
    resultPlatform: "android",
    requestId: 1,
    latestRequestId: 1,
  }),
  false,
  "an inactive platform must not publish its messages",
);
assert.equal(
  shouldPublishPackageEnvironmentMessages({
    mode: "standalone_package",
    activePlatform: "windows",
    resultPlatform: "windows",
    requestId: 1,
    latestRequestId: 2,
  }),
  false,
  "a stale request must not publish its messages",
);

const switchedBackToAndroid = deriveActivePackageEnvironment({
  ...androidFinishedInBackground,
  targetPlatform: "android",
});
assert.equal(switchedBackToAndroid.result.status, "BLOCKED");
assert.equal(switchedBackToAndroid.blocked, true, "switching back must reveal the cached Android result");
assert.deepEqual(
  switchedBackToAndroid.verification,
  {
    state: "failed",
    label: "未通过",
    detail: "当前构建环境未通过检测。",
    freshPass: false,
  },
  "a blocked result must be visibly distinct from an unchecked environment",
);
assert.deepEqual(
  visiblePackageEnvironmentManualFix(androidPendingWindowsPass.windowsResult),
  [],
  "PASS must hide manual fix guidance",
);
assert.deepEqual(
  visiblePackageEnvironmentManualFix(androidFinishedInBackground.androidResult),
  ["install Android SDK"],
  "BLOCKED must retain manual fix guidance",
);

console.log("package environment race contract: PASS");
