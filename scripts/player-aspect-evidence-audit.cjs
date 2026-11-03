"use strict";
// Independent final evidence checks; never launches/repeats the product matrix.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const [gatesFile, nativeFile, output] = process.argv.slice(2);
assert(gatesFile && nativeFile && output && !fs.existsSync(output));
const root = path.resolve(__dirname, "..");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [] };
function check(name, run) { run(); report.checks.push({ name, status: "PASS" }); }
const describe = file => ({ file, sha256: sha(file) });
try {
  const gates = read(gatesFile), native = read(nativeFile);
  const browser = read(gates.browser.identity.file);
  check("complete current-source browser matrix and shared-install isolation", () => {
    assert.equal(browser.status, "PASS"); assert.equal(browser.cleanup, "PASS");
    assert.equal(browser.cases.length, 30); assert.deepEqual(browser.errors, []);
    for (const type of ["renpy", "agentvn"]) {
      const cases = browser.cases.filter(c => c.type === type);
      assert.equal(cases.length, 15); assert(cases.every(c => c.status === "PASS"));
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
        assert(cases.some(c => c.width === width && c.dpr === dpr && c.reduced === reduced && !c.mobile));
      assert(cases.some(c => c.mobile));
      assert(cases.some(c => c.browserProcessRestart === true));
      assert(cases.some(c => c.name.startsWith("shared-install-") && c.identities.length === 4
        && c.identities.every(i => i.installId === "preview_gamecli")));
    }
    for (const [file, expected] of Object.entries(browser.sourceHashes)) assert.equal(sha(path.join(root, file)), expected);
    assert.equal(sha(browser.testIdentity.file), browser.testIdentity.sha256);
    for (const input of browser.inputs) {
      assert.equal(sha(input.file), input.sha256); assert.equal(sha(input.second), input.secondSha256);
    }
  });
  check("build command exit codes, fresh Dev and bundled resource provenance", () => {
    assert.equal(gates.status, "PASS"); assert.equal(gates.commands.length, 8);
    for (const c of gates.commands) {
      assert.equal(c.status, "PASS"); assert.equal(c.exitCode, 0);
      assert.equal(sha(c.log), c.logIdentity.sha256);
    }
    assert.equal(gates.dev.status, "PASS");
    for (const key of ["dev", "compiled", "player", "previewResource"])
      assert.equal(sha(gates.dev[key].file), gates.dev[key].sha256);
    assert.equal(gates.dev.dev.sha256, gates.dev.compiled.sha256);
    assert.equal(gates.dev.player.sha256, gates.dev.previewResource.sha256);
    assert(new Date(gates.dev.dev.modifiedAt) > new Date(gates.startedAt));
    assert(gates.dev.bundled.bundled.length >= 9);
    for (const f of gates.dev.bundled.bundled) {
      assert.equal(sha(path.join(root, f.file)), f.sha256);
      assert.equal(sha(path.join(root, "editor/src-tauri/bundle-workspace", f.file)), f.sha256);
    }
  });
  check("native WebView 24 combinations, real process restarts and distinct game preferences", () => {
    assert.equal(native.status, "PASS"); assert.equal(native.cleanup, "PASS");
    assert.deepEqual(native.errors, []); assert.equal(native.error, undefined); assert.equal(native.cleanupError, undefined);
    assert.equal(native.cases.length, 26); assert(native.cases.every(c => c.status === "PASS"));
    assert.equal(native.launches.length, 8);
    assert.equal(sha(native.testIdentity.file), native.testIdentity.sha256);
    assert.equal(sha(native.gates.file), native.gates.sha256);
    assert.equal(native.executable.sha256, gates.dev.player.sha256);
    for (const type of ["renpy", "agentvn"]) {
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const c = native.cases.find(c => c.type === type && c.width === width && c.dpr === dpr && c.reduced === reduced);
        assert(c); assert.deepEqual(c.choices.map(c => c.value), ["16:9", "16:10", "4:3", "default"]);
        assert(c.choices.every(c => c.geometry.length === 4 && c.geometry.every(g => g.hit)));
      }
      const restart = native.cases.find(c => c.type === type && c.browserProcessRestart);
      assert(restart && restart.storyPositionUnchanged && restart.gameIds[0] !== restart.gameIds[1]);
      assert.deepEqual(native.launches.filter(l => l.type === type).map(l => l.label), ["A", "B", "A-restart", "B-restart"]);
    }
  });
  check("12 PNG byte identities, actual DPR dimensions and unchanged capture parameters", () => {
    assert.equal(browser.screenshots.length, 8); assert.equal(native.screenshots.length, 4);
    for (const s of [...browser.screenshots, ...native.screenshots]) {
      const file = s.file || s.path, bytes = fs.readFileSync(file);
      assert.equal(sha(file), s.sha256);
      const width = s.before?.width ?? s.w, height = s.before?.height ?? s.h, dpr = s.before?.dpr ?? s.dpr;
      assert.equal(bytes.readUInt32BE(16), width * dpr); assert.equal(bytes.readUInt32BE(20), height * dpr);
      if (s.before) assert.deepEqual(s.before, s.after);
    }
  });
  check("native profile restoration, original bytes, owned processes and ports absent", () => {
    const restoration = read(native.profileRestoration.file);
    assert.equal(sha(native.profileRestoration.file), native.profileRestoration.sha256);
    assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
    assert.equal(restoration.removedOnlyOwnedJunctions, true);
    for (const p of restoration.restored) for (const file of p.files || [])
      assert.equal(sha(path.join(p.original, file.relative)), file.sha256);
    const live = rows(), identities = new Set(native.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`));
    assert(!live.some(p => identities.has(`${p.ProcessId}:${p.Created}`)));
    assert.deepEqual(listeners(native.launches.map(l => l.port)), []);
    assert(native.launches.every(l => l.cleanup.status === "PASS"));
    report.nativeOwnedProcessIdentities = identities.size;
  });
  report.inputs = [describe(gatesFile), describe(nativeFile), describe(gates.browser.identity.file)];
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
