"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const cp = require("node:child_process");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = "F:/testavn/Sprite-Author-Export-1975-20261116-03";
const device = "F:/testavn/Android-Sprite-Author-Cartridge-1975-20261116-03";
const output = path.join(root, "completion-audit.json");
assert(!fs.existsSync(output), "Never replace evidence");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], inputs: [],
  builds: 0, models: 0, productStarts: 0, deviceStarts: 0 };
function input(file) { const data = read(file); report.inputs.push({ path: file, sha256: sha(file) }); return data; }
function check(name, fn) { fn(); report.checks.push({ name, status: "PASS" }); }
try {
  const author = input(path.join(root, "report.json")), player = input(path.join(root, "formal-player/report.json"));
  const native = input(path.join(device, "report.json")), preparation = input(path.join(device, "preparation.json"));
  const launcher = input(path.join(device, "launcher.json")), cleanup = input(path.join(device, "cleanup.json"));
  const artifacts = input(path.join(root, "artifact-cleanup.json"));
  check("real author controls persistence reload and both unmodified downloads", () => {
    assert.equal(author.status, "PASS_SOURCE_AUTHOR_UI_PERSISTENCE_AND_TWO_NORMAL_CARTRIDGES");
    assert.equal(author.stages.length, 5); assert(author.stages.every(row => row.status === "PASS"));
    assert.equal(author.exports.length, 2); assert.deepEqual(author.errors, []);
    assert.equal(author.authored.commands.filter(c => c.type === "sprite").length, 10);
    for (const item of author.exports) assert.equal(sha(item.path), item.sha256);
    assert.equal(player.input.sha256, sha(path.join(root, "report.json")));
  });
  check("formal native Player receives exact UI downloads and original image sizes", () => {
    assert.equal(player.status, "PASS_TWO_UNCHANGED_UI_EXPORTS_FORMAL_FIXED_PLAYER_GEOMETRY");
    assert.deepEqual(player.cases.map(row => row.type), ["agentvn", "renpy"]);
    assert.deepEqual(player.errors, []); assert(player.cleanups.every(row => row.status === "PASS"));
    for (const row of player.cases) {
      assert.equal(row.status, "PASS");
      assert.equal(row.cartridge.sha256, author.exports.find(e => e.type === row.type).sha256);
      assert.deepEqual(row.sizes.map(size => size.count), [1, 2, 5, 1]);
      for (const size of row.sizes) {
        assert.equal(size.width, 900); assert.equal(size.height, 600); assert.equal(size.scale, "0.85");
        assert(Math.abs(size.rect.width - row.sizes[0].rect.width) < .5);
      }
      assert.equal(row.authorScale.scale, "1.1");
      assert(Math.abs(row.authorScale.rect.width / row.sizes[0].rect.width - 1.1 / .85) < .01);
    }
    // Geometry teardown was attributed force-stop, not a natural exit acceptance.
    assert.equal(player.cleanups.filter(row => row.stopped.length > 0).length, 2);
  });
  check("Android formal query failure retained without a rendering PASS claim", () => {
    assert.equal(native.status, "FAILED");
    assert.equal(launcher.status, "FAILED_DEVICE_TEMP_RETIRED");
    assert(launcher.administrator && native.isElevated);
    assert.equal(native.cases.length, 1);
    assert(native.failureText.includes("Cannot open cartridge: Permission denied (os error 13)"));
    assert.equal(native.cases[0].sizes.length, 0);
    for (const row of native.cases) {
      assert.equal(row.status, "RUNNING"); assert.equal(sha(row.apk.path), row.apk.sha256);
      const download = author.exports.find(item => item.type === row.type);
      assert.equal(row.fixture.sourceUiExport.sha256, download.sha256);
      assert.equal(row.cartridgeDeviceFile.sha256, download.sha256);
      assert.equal(row.formalLaunch.method, "EXISTING_FIXED_LAUNCH_QUERY_NATIVE_CARTRIDGE");
      assert(!row.previewReply);
    }
    const harness = fs.readFileSync(preparation.copies.find(item => item.path.endsWith("sprite-count-android-preview.cjs")).path, "utf8");
    assert(!harness.includes("window.postMessage") && !harness.includes("createSpritePreview("));
    const failureLog = path.join(device, "failure-logcat.txt");
    assert(fs.statSync(failureLog).size > 0);
    report.inputs.push({ path: failureLog, sha256: sha(failureLog) });
    report.featureResults = { sourceAuthorAndExports: "PASS", formalWindowsConsumption: "PASS",
      androidFormalQuery: "FAILED_NATIVE_FILE_PERMISSION_BEFORE_GAME_READY",
      androidNewEmbeddedCartridge: "NOT_RUN", physicalPhones: "NOT_RUN" };
  });
  check("native and desktop screenshots preserve measured DPR and PNG geometry", () => {
    assert.equal(player.screenshots.length, 2); assert.equal(native.screenshots.length, 0);
    for (const item of player.screenshots) {
      const bytes = fs.readFileSync(item.path), sample = item.viewport || item.before;
      assert.equal(sha(item.path), item.sha256);
      assert.equal(bytes.readUInt32BE(16), Math.round(sample.width * sample.dpr));
      assert.equal(bytes.readUInt32BE(20), Math.round(sample.height * sample.dpr));
    }
  });
  check("exact temporary cleanup source and real Git state protected", () => {
    assert.equal(cleanup.status, "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
    assert.equal(artifacts.status, "PASS_EXACT_AUTHOR_TEST_TEMP_AND_PLAYER_COPY_REMOVED_EVIDENCE_RETAINED");
    for (const item of [...cleanup.targets, ...artifacts.targets]) {
      assert(!fs.existsSync(item.path)); assert(!item.existed || item.removed);
    }
    assert.deepEqual(native.cleanupErrors, []);
    const live = rows();
    assert(!live.some(row => player.known.some(owned =>
      owned.ProcessId === row.ProcessId && owned.Created === row.Created)));
    const ports = [5582, 5583, 5990, 5992, 5994, ...player.launches.flatMap(row => row.ports),
      Number(new URL(author.services.backendUrl).port), Number(new URL(author.services.url).port)];
    assert.equal(listeners(ports).length, 0);
    for (const item of preparation.inputs) assert.equal(sha(item.path), item.sha256);
    for (const item of preparation.copies) assert.equal(sha(item.path), item.sha256);
    assert.equal(sha(preparation.git.index), preparation.git.sha256);
    assert.equal(cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), preparation.git.head);
    const previousCleanup = input("F:/testavn/Android-Sprite-Author-Cartridge-1975-20261116-02/cleanup.json");
    assert.equal(previousCleanup.status, "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
    for (const item of previousCleanup.targets) assert(item.removed && !fs.existsSync(item.path));
    report.cleanup = { files: cleanup.files + artifacts.files + previousCleanup.files,
      logicalBytes: cleanup.logicalBytes + artifacts.logicalBytes + previousCleanup.logicalBytes };
  });
  report.limitations = ["Not new Android embedded packaging or an installed Editor authoring repeat",
    "No physical-phone claim", "New logs retained; original 271/92 and historical event limits remain",
    "Android sideloaded cartridge query failed before gameplay; exact OS permission cause not established",
    "Windows rendering teardown is attributed process termination, not natural exit"];
  report.status = "PARTIAL_PASS_UI_AUTHOR_AND_WINDOWS_ANDROID_FORMAL_QUERY_FAILED_CLEANUP_PASS";
} catch (error) { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error, output }));
