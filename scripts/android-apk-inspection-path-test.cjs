"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "inspect-android-apk.cjs"), "utf8");
const start = source.indexOf("function readApkBadging(");
const end = source.indexOf("\nfunction ", start + 1);
assert(start >= 0 && end > start, "real inspection implementation required");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-path-test-"));
const original = path.join(root, "中文 空格 & %name%.apk");
const bytes = Buffer.from("immutable test apk bytes");
fs.writeFileSync(original, bytes, { flag: "wx" });
let nativeInput, behavior = "success", copyFailure = false, cleanupFailure = false;
const context = vm.createContext({
  fs: { ...fs,
    copyFileSync: (...args) => { if (copyFailure) throw Error("COPY_DENIED"); return fs.copyFileSync(...args); },
    rmdirSync: (...args) => { if (cleanupFailure) throw Error("CLEANUP_DENIED"); return fs.rmdirSync(...args); } },
  os: { tmpdir: () => path.join(root, "不存在的中文临时目录") },
  path, process: { platform: "win32" },
  spawnSync: (_exe, args, options) => {
    nativeInput = args[2];
    assert(!/[^\x00-\x7F]/.test(nativeInput), "native tool must only receive ASCII input");
    assert.deepEqual(fs.readFileSync(nativeInput), bytes, "copied bytes must match");
    assert.equal(options.windowsHide, true);
    assert.equal(options.shell, undefined, "never interpolate user paths into shell commands");
    if (behavior === "exit") return { status: 1, stderr: "ORIGINAL_AAPT_ERROR" };
    if (behavior === "spawn") return { status: null, error: Error("SPAWN_DENIED") };
    return { status: 0, stdout: "package metadata", stderr: "normal diagnostic" };
  },
});
vm.runInContext(source.slice(start, end) + "\nglobalThis.inspect = readApkBadging;", context);
try {
  const result = context.inspect(original, "fake-aapt");
  assert.equal(result.stdout, "package metadata");
  assert.equal(result.temporaryInputUsed, true);
  assert(!fs.existsSync(path.dirname(nativeInput)), "successful invocation cleans its private directory");
  for (const [mode, error] of [["exit", /ORIGINAL_AAPT_ERROR/], ["spawn", /SPAWN_DENIED/]]) {
    behavior = mode;
    assert.throws(() => context.inspect(original, "fake-aapt"), error);
    assert(!fs.existsSync(path.dirname(nativeInput)), "failed invocation must clean staging");
  }
  copyFailure = true;
  assert.throws(() => context.inspect(original, "fake-aapt"), /COPY_DENIED/);
  assert.deepEqual(fs.readdirSync(root), [path.basename(original)], "copy failure must clean staging");
  copyFailure = false;
  behavior = "success";
  cleanupFailure = true;
  assert.throws(() => context.inspect(original, "fake-aapt"), /CLEANUP_DENIED/);
  cleanupFailure = false;
  fs.rmdirSync(path.dirname(nativeInput));
  assert.deepEqual(fs.readFileSync(original), bytes, "source must survive all paths unchanged");
  console.log("android-apk-inspection-path: PASS (Chinese/spaces/metacharacters, Unicode TEMP, stderr, native/copy/cleanup failures, source preserved)");
} finally {
  fs.unlinkSync(original);
  fs.rmdirSync(root);
}
