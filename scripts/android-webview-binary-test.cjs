"use strict";
const assert = require("node:assert/strict");
const { captureWebViewBinary } = require("./lib/android-webview-binary.cjs");
const remote = "/data/app/~~owned/com.google.android.trichromelibrary_636771938-test/TrichromeLibrary.apk";
const calls = [];
const config = { packageName: "com.google.android.trichromelibrary_636771938", outputFile: "test/TrichromeLibrary.apk" };
const execute = args => {
  calls.push(args);
  if (args.includes("path")) return { status: 0, stdout: `package:${remote}\n`, stderr: "" };
  if (args.includes("package")) return { status: 0, stdout: "versionName=124.0.6367.219", stderr: "" };
  return { status: 0, stdout: "", stderr: "1 file pulled" };
};
const result = captureWebViewBinary(config, { execute, exists: () => false, inspect: () => ({ bytes: 100, sha256: "hash", zipMagic: true }) });
assert.equal(result.status, "CAPTURED_REQUIRES_REVIEW");
assert.deepEqual(calls.at(-1), ["pull", remote, config.outputFile]);
assert.match(result.packageMetadata, /124/);
assert.throws(() => captureWebViewBinary({ ...config, packageName: "bad;rm" }, { execute }), /PACKAGE_INVALID/);
assert.throws(() => captureWebViewBinary(config, { execute, exists: () => true }), /PRESERVE_EVIDENCE/);
assert.throws(() => captureWebViewBinary(config, { execute: () => ({ status: 1, stderr: "device offline" }), exists: () => false }), /device offline/);
for (const bad of ["package:/data/app/../secrets.apk", "package:/sdcard/user.apk", `package:${remote}\npackage:${remote}`]) {
  assert.throws(() => captureWebViewBinary(config, { execute: () => ({ status: 0, stdout: bad }), exists: () => false }), /PATH_INVALID/);
}
assert.throws(() => captureWebViewBinary(config, { execute, exists: () => false,
  inspect: () => ({ bytes: 2, zipMagic: false }) }), /INVALID_APK/);
assert(calls.every(args => !args.some(a => /^(install|uninstall|push|rm|setprop|chmod|kill-server)$/.test(a))));
const mappedCalls = [];
const mapped = captureWebViewBinary({ ...config, sourceApk: remote }, {
  execute(args) {
    mappedCalls.push(args);
    assert(!args.includes("pm"), "Mapped APK must not depend on static-library PackageManager lookup");
    return { status: 0, stdout: args.includes("webviewupdate") ? "124.0.6367.219" : "", stderr: "" };
  }, exists: () => false, inspect: () => ({ bytes: 100, zipMagic: true, sha256: "hash" }),
});
assert.equal(mapped.remote, remote);
assert(mappedCalls.some(args => args.includes("webviewupdate")));
assert.throws(() => captureWebViewBinary({ ...config, sourceApk: "/sdcard/user.apk" },
  { execute, exists: () => false }), /PATH_INVALID/);
console.log("android-webview-binary: PASS (read-only actual package, safe paths, no overwrite, stderr, offline, binary header)");
