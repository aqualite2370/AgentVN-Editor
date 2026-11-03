"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("../GameCli_framework/node_modules/sharp");
const { runtimeFailures, scopedRuntimeLog, assessRestartTrials, compareRestartScreenshots } = require("./android-runtime-log-analysis.cjs");
const own = "com.agentvn.game.test";
const lines = [
  `09-21 11:16:14.154 589 14066 E ActivityManager: ANR in ${own} (${own}/.MainActivity)`,
  "09-21 11:16:14.154 589 14066 E ActivityManager: ANR in com.unrelated.app",
  "09-21 11:16:14.154 100 101 E AndroidRuntime: FATAL EXCEPTION: main",
  `09-21 11:16:14.154 100 101 E AndroidRuntime: Process: ${own}, PID: 100`,
  "09-21 11:16:14.154 200 201 E AndroidRuntime: FATAL EXCEPTION: main",
  "09-21 11:16:14.154 200 201 E AndroidRuntime: Process: com.unrelated.app, PID: 200",
  "09-21 11:16:14.154 100 101 E RustStdoutStderr: thread 'main' panicked at 'error'",
  "09-21 11:16:14.154 100 101 E chromium: Could not reconstruct index from disk",
];
const failures = runtimeFailures(lines, own, ["100"]);
assert.equal(failures.length, 3);
assert.ok(failures.some(line => line.includes(`ANR in ${own}`)));
assert.ok(failures.some(line => line.includes("FATAL EXCEPTION")));
assert.ok(failures.some(line => line.includes("panicked")));
assert.equal(runtimeFailures(lines, "com.agentvn.game.test2", []).length, 0);
assert.equal(runtimeFailures([`09-21 11:16:14.154 589 14066 E ActivityManager: ANR in ${own}.other`], own, []).length, 0);
// device-05: bionic can report FORTIFY without a later "Fatal signal" line
// before the process dies. Retain both libc records and Rust forwarding.
const destroyedMutex = [
  "10-23 21:43:39.960 3218 3259 F libc    : FORTIFY: pthread_mutex_lock called on a destroyed mutex (0x743b33002ab8)",
  "10-23 21:43:39.974 3218 3258 F libc    : FORTIFY: pthread_mutex_lock called on a destroyed mutex (0x743b33002ab8)",
  "10-23 21:43:39.974 3218 3243 I RustStdoutStderr: FORTIFY: pthread_mutex_lock called on a destroyed mutex (0x743b33002ab8)",
  "10-23 21:43:39.960 9000 9001 F libc    : FORTIFY: pthread_mutex_lock called on a destroyed mutex (0x1234)",
];
const mutexFailures = scopedRuntimeLog(destroyedMutex, own, ["3218"]);
assert.equal(mutexFailures.fatal.length, 3,
  "app-owned FORTIFY aborts must not disappear when Fatal signal is absent");
assert(mutexFailures.fatal.every(line => !line.includes("9000")));
assert.equal(runtimeFailures(destroyedMutex, "com.unrelated.app", ["8000"]).length, 0);
const rendererMutex = scopedRuntimeLog([
  `10-23 21:43:39.900 579 610 I ActivityManager: Start proc 3218:com.google.android.webview:sandboxed_process0/u0i1 for  {${own}/org.chromium.content.app.SandboxedProcessService0:0}`,
  ...destroyedMutex,
], own, ["100"]);
assert.equal(rendererMutex.fatal.length, 3,
  "owned isolated renderer FORTIFY must also fail acceptance");
const { validateRecordedCellLog } = require("./android-exit-device-audit.cjs");
assert.throws(() => validateRecordedCellLog({
  package: own, logs: { pids: ["3218"], fatal: [], warnings: [] },
}, destroyedMutex.join("\n")), /Stored fatal classification/,
"audit must reclassify raw logs rather than trust the device-05 empty fatal summary");
assert.doesNotThrow(() => validateRecordedCellLog({
  package: own, logs: { pids: ["8000"], fatal: [], warnings: [] },
}, destroyedMutex.join("\n")), "unrelated native failures must not be assigned to the tested app");
const scoped = scopedRuntimeLog([
  `09-21 11:16:14.154 589 610 I ActivityManager: Start proc 300:com.google.android.webview:sandboxed_process0/u0i1 for  {${own}/org.chromium.content.app.SandboxedProcessService0:0}`,
  `09-21 11:16:14.154 589 610 I ActivityManager: Start proc 400:com.google.android.webview:sandboxed_process1/u0i2 for  {com.other/org.chromium.content.app.SandboxedProcessService0:0}`,
  '09-21 11:16:14.154 300 301 W chromium: tile memory limits exceeded',
  '09-21 11:16:14.154 400 401 W chromium: tile memory limits exceeded',
  '09-21 11:16:14.154 100 101 E chromium: Could not reconstruct index from disk',
], own, ['100']);
assert.deepEqual(scoped.pids, ['100', '300']);
assert.equal(scoped.warnings.length, 2, 'cache index and isolated renderer warnings must not be omitted');
const fakeIndexError = '[ERROR:simple_version_upgrade.cc(152)] Failed to write a new fake index.';
const capturedCacheErrors = scopedRuntimeLog([
  `10-16 20:02:54.115 4742 4812 E chromium: ${fakeIndexError}`,
  `10-16 20:02:54.119 4742 4812 I RustStdoutStderr: ${fakeIndexError}`,
  `10-16 20:02:54.120 9000 9001 E chromium: ${fakeIndexError}`,
  '10-16 20:02:54.121 4742 4812 E chromium: [ERROR:disk_cache.cc(208)] New upstream cache failure text.',
  '10-16 20:02:54.122 4742 4812 E chromium: [ERROR:simple_backend_impl.cc(762)] New upstream backend failure text.',
  '10-16 20:02:54.123 4742 4812 I chromium: [INFO:simple_backend_impl.cc(762)] Normal initialization.',
], own, ['4742']);
assert.equal(capturedCacheErrors.warnings.length, 4,
  'capture app-owned cache implementation errors including Rust forwarding without admitting unrelated PIDs or INFO');
assert(capturedCacheErrors.warnings.every(line => !line.includes('9000')));
const stable = { layers: { documents: 2, nodes: 410, jsEventListeners: 188 }, pssKb: 102000, fatal: [], images: [] };
const capturedCacheAssessment = assessRestartTrials(Array.from({ length: 6 }, (_, index) => ({
  ...stable, screenshotSha256: 'same-render', warnings: index === 4 ? capturedCacheErrors.warnings : [],
})));
assert.equal(capturedCacheAssessment.status, 'BLOCKED',
  'newly detected cache initialization errors need individual causal review, not an automatic whitelist');
assert.equal(capturedCacheAssessment.unknownWarnings.length, 4);
const knownCache = 'E chromium: [ERROR:simple_file_enumerator.cc(21)] opendir /cache/WebView/Default/HTTP Cache/Code Cache/js: No such file or directory (2)';
const knownIndex = 'E chromium: [ERROR:simple_index_file.cc(614)] Could not reconstruct index from disk';
const knownCacheEntry = 'E chromium: [ERROR:simple_file_enumerator.cc(58)] Could not get file info for /data/user/0/com.agentvn.game.test/cache/WebView/Default/HTTP Cache/Code Cache/js/abc123_0';
const knownCacheDirectory = 'E chromium: [ERROR:simple_file_enumerator.cc(43)] readdir /data/user/0/com.agentvn.game.test/cache/WebView/Default/HTTP Cache/Code Cache/js: No such file or directory (2)';
const justified = assessRestartTrials([
  { ...stable, screenshotSha256: 'a', warnings: [] }, { ...stable, screenshotSha256: 'b', pssKb: 101000, warnings: [knownCache, knownIndex] },
  { ...stable, pssKb: 100000, warnings: [] }, { ...stable, pssKb: 99000, warnings: [] },
  { ...stable, pssKb: 98000, warnings: [] }, { ...stable, pssKb: 99000, warnings: [knownCache] },
]);
assert.equal(justified.status, 'PASS_WITH_NON_BLOCKING_WEBVIEW_CACHE_WARNING');
assert.deepEqual(justified.warningTrials, [2, 6]);
const observedCacheVariants = assessRestartTrials([
  { ...stable, screenshotSha256: 'a', warnings: [knownCacheEntry] },
  { ...stable, screenshotSha256: 'a', warnings: [knownCacheDirectory] },
  { ...stable, screenshotSha256: 'a', warnings: [] },
  { ...stable, screenshotSha256: 'a', warnings: [] },
  { ...stable, screenshotSha256: 'a', warnings: [] },
  { ...stable, screenshotSha256: 'a', warnings: [] },
]);
assert.equal(observedCacheVariants.status, 'PASS_WITH_NON_BLOCKING_WEBVIEW_CACHE_WARNING',
  'observed Code Cache file-info and directory warnings should be classified as non-blocking cache warnings');
for (const trials of [
  Array.from({ length: 6 }, () => ({ ...stable, warnings: [knownIndex] })),
  [{ ...stable, warnings: ['W chromium: tile memory limits exceeded'] }, ...Array.from({ length: 5 }, () => ({ ...stable, warnings: [] }))],
  Array.from({ length: 6 }, (_, i) => ({ ...stable, pssKb: 100000 + i * 10000, warnings: [] })),
  [{ ...stable, layers: { ...stable.layers, nodes: 410 }, warnings: [] }, { ...stable, layers: { ...stable.layers, nodes: 500 }, warnings: [] }],
]) assert.equal(assessRestartTrials(trials).status, 'BLOCKED');
const tileWithExactVisualMatch = assessRestartTrials(Array.from({ length: 6 }, (_, index) => ({ ...stable,
  screenshotSha256: 'same-render', warnings: index === 5 ? ['W chromium: tile memory limits exceeded'] : [] })));
assert.equal(tileWithExactVisualMatch.status, 'PASS_WITH_NON_BLOCKING_WEBVIEW_TILE_WARNING');
assert.deepEqual(tileWithExactVisualMatch.warningTrials, [6]);
const nearIdenticalTitle = assessRestartTrials(Array.from({ length: 6 }, (_, index) => ({
  ...stable,
  kind: index < 3 ? 'clean-install' : 'retained-data',
  iteration: index % 3 + 1,
  status: 'TITLE_OBSERVED',
  layers: { documents: index === 4 ? 1 : 2, nodes: index === 4 ? 232 : 388, jsEventListeners: index === 4 ? 177 : 189 },
  pssKb: [103426, 103584, 117308, 115440, 109816, 115330][index],
  screenshotSha256: index === 0 ? 'tile-render' : 'normal-render',
  warnings: index === 0 ? ['W chromium: tile memory limits exceeded'] : [],
  visualComparison: index === 0 ? {
    screenshotSha256: 'tile-render', referenceSha256: 'normal-render',
    meanAbsoluteDifference: 0.181, maxBlockMeanAbsoluteDifference: 0.471,
    largeDifferencePixelRatio: 0.00003, width: 2400, height: 1080,
  } : undefined,
})));
assert.equal(nearIdenticalTitle.status, 'PASS_WITH_NON_BLOCKING_WEBVIEW_TILE_WARNING',
  'near-identical decoded title screenshots and bounded cross-process DOM variation should not be mistaken for missing tiles');
assert.equal(assessRestartTrials(Array.from({ length: 6 }, (_, index) => ({
  ...stable,
  screenshotSha256: index === 0 ? 'tile-render' : 'normal-render',
  warnings: index === 0 ? ['W chromium: tile memory limits exceeded'] : [],
  visualComparison: index === 0 ? {
    screenshotSha256: 'tile-render', referenceSha256: 'normal-render',
    meanAbsoluteDifference: 4.5, maxBlockMeanAbsoluteDifference: 80,
    largeDifferencePixelRatio: 0.08, width: 2400, height: 1080,
  } : undefined,
}))).status, 'BLOCKED', 'a missing tile must remain blocking');
assert.equal(assessRestartTrials(Array.from({ length: 6 }, (_, index) => ({
  ...stable, layers: { ...stable.layers, nodes: 200 + 55 * index }, screenshotSha256: 'same-render', warnings: [],
}))).status, 'BLOCKED', 'steady cross-trial DOM growth must remain blocking');
const separatedLifecycleBands = [
  { kind: 'clean-install', iteration: 1, layers: { documents: 1, nodes: 148, jsEventListeners: 176 }, pssKb: 111852, screenshotSha256: 'title', images: [], warnings: [] },
  { kind: 'clean-install', iteration: 2, layers: { documents: 1, nodes: 151, jsEventListeners: 180 }, pssKb: 112612, screenshotSha256: 'title', images: [], warnings: [knownCache, knownIndex] },
  { kind: 'clean-install', iteration: 3, layers: { documents: 1, nodes: 370, jsEventListeners: 185 }, pssKb: 91477, screenshotSha256: 'title', images: [], warnings: [] },
  { kind: 'retained-data', iteration: 1, layers: { documents: 2, nodes: 384, jsEventListeners: 188 }, pssKb: 110263, screenshotSha256: 'title', images: [], warnings: [] },
  { kind: 'retained-data', iteration: 2, layers: { documents: 2, nodes: 384, jsEventListeners: 188 }, pssKb: 110111, screenshotSha256: 'title', images: [], warnings: [] },
  { kind: 'retained-data', iteration: 3, layers: { documents: 2, nodes: 384, jsEventListeners: 188 }, pssKb: 106702, screenshotSha256: 'title', images: [], warnings: [] },
];
assert.equal(
  assessRestartTrials(separatedLifecycleBands).status,
  'PASS_WITH_NON_BLOCKING_WEBVIEW_CACHE_WARNING',
  'clean-install and retained-data lifecycle bands must be assessed independently',
);
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-tile-"));
  try {
    const base = path.join(temp, "base.png");
    const slight = path.join(temp, "slight.png");
    const missing = path.join(temp, "missing.png");
    const width = 128;
    const height = 128;
    const pixels = Buffer.alloc(width * height * 3, 80);
    const slightPixels = Buffer.from(pixels);
    slightPixels[0] = 84;
    const missingPixels = Buffer.from(pixels);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      missingPixels[(y * width + x) * 3] = 0;
      missingPixels[(y * width + x) * 3 + 1] = 0;
      missingPixels[(y * width + x) * 3 + 2] = 0;
    }
    await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toFile(base);
    await sharp(slightPixels, { raw: { width, height, channels: 3 } }).png().toFile(slight);
    await sharp(missingPixels, { raw: { width, height, channels: 3 } }).png().toFile(missing);
    const close = await compareRestartScreenshots(slight, base);
    const absent = await compareRestartScreenshots(missing, base);
    assert(close.meanAbsoluteDifference < 1 && close.maxBlockMeanAbsoluteDifference < 2);
    assert(absent.maxBlockMeanAbsoluteDifference > 2 && absent.largeDifferencePixelRatio > 0.001);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("android-runtime-log-analysis: PASS (scoped warnings, bounded DOM, decoded screenshot tiles)");
})().catch(error => { console.error(error); process.exitCode = 1; });
