"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const cp = require("node:child_process");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const base = "F:/testavn/Android-Sprite-Preview-1975-20261116-03";
const previous = "F:/testavn/Android-Sprite-Preview-1975-20261116-01";
const output = path.join(base, "audit.json");
assert(!fs.existsSync(output), "Preserve original audit");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file) });
const r = { status: "RUNNING", at: new Date().toISOString(), checks: [], inputs: [],
  productStarts: 0, deviceStarts: 0, builds: 0, models: 0 };
function verify(name, fn) { fn(); r.checks.push({ name, status: "PASS" }); }
try {
  const reportFile = path.join(base, "report.json"), report = read(reportFile);
  const launcher = read(path.join(base, "launcher.json")), cleanup = read(path.join(base, "cleanup.json"));
  const preparation = read(path.join(base, "preparation.json")), old = read(path.join(previous, "report.json"));
  for (const file of [reportFile, path.join(base, "launcher.json"), path.join(base, "cleanup.json"),
    path.join(base, "preparation.json"), path.join(previous, "report.json"), path.join(previous, "cleanup.json"),
    "F:/testavn/Android-Sprite-Preview-1975-20261116-02/report.json",
    "F:/testavn/Android-Sprite-Preview-1975-20261116-02/cleanup.json"])
    r.inputs.push(desc(file));
  verify("actual administrator terminal and unchanged APK sources", () => {
    assert.equal(report.status, "PASS_TWO_THEME_ANDROID_PREVIEW_SPRITE_GEOMETRY_LOGS_RETAINED");
    assert.equal(launcher.status, "FINISHED_TARGETED_PREVIEW_AND_CLEANUP_CHECK_REPORT");
    assert(launcher.administrator && report.isElevated && report.finishedAt);
    assert.equal(report.productBuilds, 0); assert.equal(report.modelRequests, 0);
    assert.equal(report.environment.sdk, "35"); assert.equal(report.environment.abi, "x86_64");
    for (const input of preparation.inputs) assert.equal(sha(input.path), input.sha256);
    for (const item of preparation.copies) assert.equal(sha(item.path), item.sha256);
    for (const input of report.inputs) assert.equal(sha(input.path), input.sha256);
    for (const row of report.cases) assert.equal(sha(row.apk.path), row.apk.sha256);
  });
  verify("original failed QA and exact scoped geometry inheritance", () => {
    assert.equal(old.status, "FAILED");
    assert(old.error.includes("Real exit and entered raster frames must be captured"));
    assert.equal(report.inheritedDefaultCounts.originalTotalStatus, "FAILED");
    assert.equal(sha(report.inheritedDefaultCounts.path), report.inheritedDefaultCounts.sha256);
    assert.deepEqual(report.inheritedDefaultCounts.sizes, old.cases[0].sizes);
    assert.deepEqual(old.cases[0].sizes.map(row => row.count), [1, 2, 5, 1]);
    assert.equal(read(path.join(previous, "cleanup.json")).status, "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
  });
  verify("two real raster geometries plus exit frames and author scale", () => {
    assert.deepEqual(report.cases.map(row => row.type), ["renpy"]);
    assert.equal(report.inheritedDefaultComplete.originalTotalStatus, "FAILED");
    assert.equal(sha(report.inheritedDefaultComplete.path), report.inheritedDefaultComplete.sha256);
    const cases = [report.inheritedDefaultComplete.case, ...report.cases];
    assert.deepEqual(cases.map(row => row.type), ["agentvn", "renpy"]);
    for (const row of cases) {
      assert.equal(sha(row.apk.path), row.apk.sha256);
      assert.equal(row.status, "PASS");
      assert.equal(row.previewReply.type, "agentvn.live-preview.ready");
      assert.equal(row.previewReply.sessionId, "qa_android_sprite_1975_" + row.type);
      assert.deepEqual(row.sizes.map(item => item.count), row.type === "agentvn" ? [5, 1] : [1, 2, 5, 1]);
      const counts = row.type === "agentvn" ? [...old.cases[0].sizes, ...row.sizes] : row.sizes;
      const baseline = counts[0].rect;
      for (const item of counts) {
        assert.equal(item.naturalWidth, 900); assert.equal(item.naturalHeight, 600);
        assert.equal(item.authorScale, "0.85");
        assert(Math.abs(item.rect.width - baseline.width) < .5 && Math.abs(item.rect.height - baseline.height) < .5);
      }
      assert(row.exit.intermediateOpacityFrames > 0 && row.exit.geometryStable);
      assert(row.frames.some(frame => frame.id === "c1" && frame.measurementPhase === "leaving"
        && frame.opacity > 0 && frame.opacity < .99));
      assert.equal(row.authorScale.authorScale, "1.1");
      assert(Math.abs(row.authorScale.rect.width / baseline.width - 1.1 / .85) < .01);
    }
    assert.deepEqual(report.errors, []);
    assert(report.touches.filter(row => !row.systemOverlay).length >= 4);
  });
  verify("native screenshots use measured physical dimensions and package surface", () => {
    assert.equal(report.screenshots.length, 1);
    const screenshots = [report.inheritedDefaultComplete.screenshot, ...report.screenshots];
    const cases = [report.inheritedDefaultComplete.case, ...report.cases];
    for (let i = 0; i < 2; i++) {
      const item = screenshots[i], bytes = fs.readFileSync(item.path);
      assert.equal(sha(item.path), item.sha256);
      assert.equal(bytes.subarray(1, 4).toString(), "PNG");
      assert.equal(bytes.readUInt32BE(16), Math.round(item.viewport.width * item.viewport.dpr));
      assert.equal(bytes.readUInt32BE(20), Math.round(item.viewport.height * item.viewport.dpr));
      assert.equal(sha(item.hierarchy.path), item.hierarchy.sha256);
      assert(fs.readFileSync(item.hierarchy.path, "utf8").includes(cases[i].package));
    }
  });
  verify("owned package ports and exact temporary trees retired", () => {
    assert.equal(report.cleanup, "PROCESS_PACKAGE_PORT_RETIREMENT_AWAITING_TEMP_CLEANUP");
    assert.deepEqual(report.cleanupErrors, []);
    assert(report.packageCleanup.length === 2 && report.packageCleanup.every(item => item.absent));
    assert.equal(cleanup.status, "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
    assert.equal(cleanup.targets.length, 2);
    for (const row of cleanup.targets) {
      assert.equal(path.dirname(row.path).toLowerCase(), path.resolve(base).toLowerCase());
      assert(["avd", "temp"].includes(path.basename(row.path)));
      assert(row.removed && !fs.existsSync(row.path));
    }
    const ports = cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
      "@(Get-NetTCPConnection -State Listen -LocalPort 5582,5583,5990,5992,5994 -ErrorAction SilentlyContinue).Count"],
    { encoding: "utf8", windowsHide: true }).trim();
    assert.equal(ports, "0");
    assert(!fs.existsSync(path.join(base, "staging.apk")));
    assert.equal(sha(preparation.git.index), preparation.git.sha256);
    assert.equal(cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), preparation.git.head);
  });
  verify("complete new logs retained without waiving prior unresolved events", () => {
    r.newLogs = [];
    for (const row of [report.inheritedDefaultComplete.case, ...report.cases]) {
      assert.equal(sha(row.logcat.path), row.logcat.sha256);
      assert(Array.isArray(row.logReview.messages));
      assert.equal(row.logReview.fatal.length, 0);
      r.newLogs.push({ type: row.type, logcat: row.logcat, records: row.logReview.messages.length,
        disposition: "RETAINED_NEW_PREVIEW_SESSION_NOT_A_HISTORICAL_RECOVERY_CLAIM" });
    }
    const oldReview = "F:/testavn/Client-Presentation-Android-1975-20261116-04/current-log-review-02.json";
    const unresolved = read(oldReview); assert.equal(unresolved.records, 271); assert.equal(unresolved.unresolved, 92);
    r.inputs.push(desc(oldReview));
  });
  for (const item of r.inputs) assert.equal(sha(item.path), item.sha256);
  r.status = "PASS_TARGETED_ANDROID_PREVIEW_GEOMETRY_AND_CLEANUP_WITH_RETAINED_LOG_AND_PHYSICAL_PHONE_LIMITS";
} catch (error) { r.status = "FAILED"; r.error = error.stack; process.exitCode = 1; }
r.finishedAt = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(r, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: r.status, checks: r.checks.length, output, error: r.error }));
