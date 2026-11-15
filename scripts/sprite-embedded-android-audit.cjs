"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const base = "F:/testavn/Sprite-Embedded-Android-1975-20261116-01";
const followup = process.argv.includes("--renpy-followup");
assert(process.argv.length <= 3 && process.argv.slice(2).every(arg => arg === "--renpy-followup"));
const output = path.join(base, "completion-audit-01.json");
assert(!fs.existsSync(output), "Preserve previous evidence");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const r = { status: "RUNNING", at: new Date().toISOString(), checks: [], inputs: [],
  editorBuilds: 0, models: 0, physicalPhones: "NOT_RUN", historicLogs: "271_RECORDS_92_UNRESOLVED_UNCHANGED" };
function input(file) {
  r.inputs.push({ path: path.resolve(file), sha256: sha(file) }); return read(file);
}
function verify(artifact) { assert.equal(sha(artifact.path), artifact.sha256, artifact.path); }
function check(name, fn) { const detail = fn(); r.checks.push({ name, status: "PASS", detail }); }
try {
  const prep = input(path.join(base, "preparation.json"));
  const build = input(path.join(base, "administrator.json"));
  const packaged = input(path.join(base, "package-audit-01.json"));
  const deviceName = followup ? "device-02" : "device-01";
  const device = input(path.join(base, deviceName, "report.json"));
  const launcher = input(path.join(base, deviceName, "launcher.json"));
  const deviceCleanup = input(path.join(base, deviceName, "cleanup.json"));
  const cleanup = input(path.join(base, "artifact-cleanup-01.json"));
  const cases = [...device.cases], screenshots = [...device.screenshots];
  let inheritedInputs = 0, originalCleanup;
  if (followup) {
    const original = input(path.join(base, "device-01/report.json"));
    originalCleanup = input(path.join(base, "device-01/cleanup.json"));
    assert.equal(original.status, "FAILED");
    assert(original.error.includes("Retained sprite changed size between counts"));
    assert.equal(originalCleanup.status, "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
    const inherited = device.inheritedDefaultComplete;
    verify(inherited);
    assert.equal(inherited.originalTotalStatus, "FAILED");
    assert.deepEqual(inherited.case, original.cases.find(row => row.type === "agentvn"));
    assert.equal(inherited.case.status, "PASS");
    assert.deepEqual(inherited.screenshot, original.screenshots.find(item => item.path.endsWith("agentvn.png")));
    assert.equal(inherited.nativeInputs, 5);
    inheritedInputs = inherited.nativeInputs;
    cases.unshift(inherited.case); screenshots.unshift(inherited.screenshot);
    r.inheritance = { path: inherited.path, sha256: inherited.sha256,
      originalTotalStatus: "FAILED", scope: inherited.scope, sameBoot: false };
    const renpy = device.cases.find(row => row.type === "renpy");
    assert(renpy.measurementReady.naturalWidth === 900 && renpy.measurementReady.rect.width > 0);
  }
  check("frozen installation resources and real source UI exports retained without APK modification", () => {
    verify(prep.installer);
    assert.equal(prep.installer.sha256, "58c1f44ba6f227c9db4a6a40c3280c97fe502b6538ed7762dd52339c60954e09");
    assert.equal(prep.sources.length, 351);
    const source = input("F:/testavn/Client-Presentation-Android-1975-20261116-02/preparation.json");
    assert.deepEqual(prep.sources, source.sources);
    const author = input("F:/testavn/Sprite-Author-Export-1975-20261116-03/report.json");
    assert.equal(author.status, "PASS_SOURCE_AUTHOR_UI_PERSISTENCE_AND_TWO_NORMAL_CARTRIDGES");
    for (const b of prep.builds) {
      verify(b.cartridge);
      assert.equal(b.cartridge.sha256, author.exports.find(e => e.type === b.type).sha256);
    }
    assert.equal(prep.editorBuilds, 0); assert.equal(prep.models, 0);
    return { sources: 351, sourceUiExports: 2, editorBuilds: 0, authoringScope: "SOURCE_EDITOR_UI_NOT_NEW_INSTALLED_AUTHOR_SESSION" };
  });
  check("supported normal build, real elevation/symlink checks, both signatures and four ABIs", () => {
    assert.equal(build.status, "PASS_TWO_INSTALLED_RESOURCE_APK_BUILDS_DEVICE_PENDING");
    assert(build.isElevated && build.persistentEnvironmentUnchanged);
    assert.equal(build.environmentPreflight, "PASS"); assert.equal(build.builds.length, 2);
    assert(build.builds.every(b => b.status === "PASS"));
    assert.equal(packaged.status, "PASS_TWO_EMBEDDED_UI_AUTHOR_CARTRIDGES_FOUR_ABIS_SPRITE_PIXELS_DEVICE_PENDING");
    assert.equal(packaged.cases.length, 2);
    for (const row of packaged.cases) {
      verify(row.apk); verify(row.sourceCartridge);
      assert.equal(row.native.length, 4); assert.equal(row.assets.length, 3);
      assert(row.assets.some(a => a.width === 900 && a.height === 600));
      assert(row.assets.some(a => a.width === 420 && a.height === 1100));
      assert.equal(row.assets.filter(a => a.optimizationMode === "lossless-webp" && a.pixelExact).length, 2);
      assert.match(row.signature, /^[A-F0-9]{64}$/);
      assert.equal(row.status, "PASS");
    }
    for (const e of packaged.inputs) verify(e);
    return { apks: 2, abisEach: 4, originalSpritePixelChecksEach: 2,
      background: "DECLARED_QUALITY_90_OPTIMIZATION_DIFFERENCE_MEASURED_NOT_LOSSLESS" };
  });
  check("normal launcher embedded games, real ADB progression and original raster geometry", () => {
    assert.equal(device.status, "PASS_TWO_NORMAL_EMBEDDED_AUTHOR_APKS_SPRITE_GEOMETRY_LOGS_RETAINED");
    assert.deepEqual(cases.map(c => c.type), ["agentvn", "renpy"]);
    assert.deepEqual(device.errors, []);
    for (const row of cases) {
      assert.equal(row.status, "PASS"); verify(row.apk);
      assert.equal(row.apk.sha256, packaged.cases.find(c => c.type === row.type).apk.sha256);
      assert.equal(row.formalLaunch.method, "NORMAL_ANDROID_LAUNCHER_EMBEDDED_GAME");
      assert(!new URL(row.formalLaunch.url).searchParams.has("cartridge"));
      assert.equal(row.fixture.scope, "NORMAL_EMBEDDED_GAME_NO_PREVIEW_INJECTION_OR_EXTERNAL_QUERY");
      assert.deepEqual(row.sizes.map(s => s.count), [1, 2, 5, 1]);
      for (const size of row.sizes) {
        assert.equal(size.naturalWidth, 900); assert.equal(size.naturalHeight, 600);
        assert.equal(size.authorScale, "0.85");
        assert(Math.abs(size.rect.width - row.sizes[0].rect.width) < .5);
        assert(Math.abs(size.rect.height - row.sizes[0].rect.height) < .5);
      }
      assert(row.exit.geometryStable && row.exit.intermediateOpacityFrames > 0);
      assert.equal(row.authorScale.authorScale, "1.1");
      assert(Math.abs(row.authorScale.rect.width / row.sizes[0].rect.width - 1.1 / .85) < .01);
      const measured = row.frames.filter(frame => frame.id === "c0");
      assert(measured.length > 10 && measured.every(frame =>
        Math.abs(frame.rect.width - row.sizes[0].rect.width) < .5
        && Math.abs(frame.rect.height - row.sizes[0].rect.height) < .5));
    }
    assert(device.touches.length + inheritedInputs >= 10);
    return { themes: 2, counts: [1, 2, 5, 1], nativeInputs: device.touches.length + inheritedInputs,
      sameBoot: !followup };
  });
  check("native screenshot dimensions match actual viewport DPR; logs retained without blanket acceptance", () => {
    assert.equal(screenshots.length, 2);
    for (const item of screenshots) {
      verify(item); verify(item.hierarchy);
      const bytes = fs.readFileSync(item.path);
      assert.equal(bytes.readUInt32BE(16), Math.round(item.viewport.width * item.viewport.dpr));
      assert.equal(bytes.readUInt32BE(20), Math.round(item.viewport.height * item.viewport.dpr));
    }
    for (const row of cases) {
      verify(row.logcat); assert.equal(row.logReview.fatal.length, 0);
    }
    r.currentLogDisposition = "CAPTURED_NOT_BLANKET_ACCEPTED_OR_HISTORIC_RECOVERY_PROOF";
    return { screenshots: 2, logs: 2, physicalPhoneProof: false };
  });
  check("packages staging emulator ADB ports and exact build/tool trees retired", () => {
    assert.equal(launcher.status, "FINISHED_NORMAL_EMBEDDED_AUTHOR_APKS_AND_CLEANUP_CHECK_REPORT");
    assert.equal(device.cleanup, "PROCESS_PACKAGE_PORT_RETIREMENT_AWAITING_TEMP_CLEANUP");
    assert.deepEqual(device.cleanupErrors, []);
    assert(device.packageCleanup.every(c => c.absent));
    assert.equal(deviceCleanup.status, "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
    assert(deviceCleanup.targets.every(t => t.removed && !fs.existsSync(t.path)));
    if (originalCleanup) assert(originalCleanup.targets.every(t => t.removed && !fs.existsSync(t.path)));
    assert.equal(cleanup.status, "PASS_EXACT_BUILD_AND_TOOL_TEMP_REMOVED_SOURCE_EXPORTS_APKS_REPORTS_RETAINED");
    assert.equal(cleanup.links.length, 4); assert(cleanup.links.every(l => l.removed));
    assert.equal(cleanup.targets.length, 4);
    assert(cleanup.targets.every(t => t.removed && !fs.existsSync(t.path)));
    for (const e of cleanup.retained) verify(e);
    for (const name of followup ? ["device-01", "device-02"] : ["device-01"])
      assert(!fs.existsSync(path.join(base, name, "staging.apk")));
    assert.equal(listeners(device.ports).length, 0);
    assert(!rows().some(p => p.ProcessId === device.emulator.pid
      && Date.parse(p.Created) >= Date.parse(device.at) - 1000
      && Date.parse(p.Created) <= Date.parse(device.finishedAt)));
    return { files: cleanup.files + deviceCleanup.files + (originalCleanup?.files || 0),
      logicalBytes: cleanup.logicalBytes + deviceCleanup.logicalBytes + (originalCleanup?.logicalBytes || 0),
      physicalFreeSpaceMeasured: false };
  });
  check("real HEAD/index daily Dev user databases and completed novel remain protected", () => {
    const head = cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
    assert.equal(head, prep.protected.head); verify(prep.protected.index); verify(prep.protected.dailyDev);
    assert.equal(build.editorBuilds, 0); assert.equal(build.modelRequests, 0);
    assert.equal(device.modelRequests, 0); assert.equal(device.userDatabaseWrites, 0);
    return { head, dailyDev: prep.protected.dailyDev, sourceDatabaseWrites: 0, models: 0 };
  });
  r.status = "PASS_EMBEDDED_SOURCE_AUTHOR_TWO_THEME_ANDROID_SPRITES_AND_EXACT_CLEANUP_LOGS_UNRESOLVED";
  r.boundaries = ["API35 emulator only; physical-phone reports remain separate",
    "Source Editor UI exports and frozen installed-source supported packaging, not another default-profile installed author session",
    "Original external-file query permission failure retained; this normal embedded path does not explain its OS root cause",
    "No repeated gallery/install/upgrade/display matrix; no claim of overall goal completion"];
} catch (error) { r.status = "FAILED"; r.error = error.stack; process.exitCode = 1; }
finally {
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, checks: r.checks.length, error: r.error, output }));
}
