"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), cp = require("node:child_process");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Windows-Isolated-1987-20261117-01";
const out = path.join(base, "functional-audit.json"); assert(!fs.existsSync(out));
const r = { status: "RUNNING", groups: [], inputs: [], productLaunches: 0, builds: 0 };
const read = f => { r.inputs.push({ path: f, sha256: sha(f) }); return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")); };
const check = d => assert.equal(sha(d.path), d.sha256, d.path);
function group(name, fn) {
  const row = { name, status: "RUNNING" }; r.groups.push(row);
  try { row.detail = fn(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; row.error = e.stack; throw e; }
}
try {
  const release = "F:/testavn/Sprite-Position-Gallery-Release-1987-20261117-01";
  const build = read(path.join(release, "release/build.json")), run = read(path.join(base, "resource-01/report.json"));
  group("position-real-art-24-matrix-and-regression", () => {
    for (const [file, count] of [
      ["Sprite-Position-20261117-after01", 19], ["Sprite-Position-Browser-20261117-02", 24],
      ["Sprite-Hide-Rollback-Position-20261117-01", 18],
    ]) {
      const d = read(`F:/testavn/${file}/report.json`); assert.equal(d.status, "PASS");
      assert.equal(d.cases.length, count); assert(d.cases.every(c => c.status === "PASS"));
      if (count === 24) {
        assert.equal(new Set(d.cases.map(c => [c.theme, c.width, c.dpr, c.reduced].join(":"))).size, 24);
        for (const c of d.cases) {
          assert(c.frames.length > 5); assert(c.samples.length === 5);
          const offset = (c.authorMove.image.x - c.authorMove.slot.x) - (c.baseline.image.x - c.baseline.slot.x);
          assert(Math.abs(offset - c.width * .08) < .6, "Author's 8% horizontal offset must remain effective");
        }
        assert.deepEqual(d.errors, []); assert.equal(d.cleanup, "OWNED_BROWSER_SERVER_STOPPED");
      }
    }
    return { direct: 19, browser: 24, hideRollbackEngine: 18 };
  });
  group("gallery-cross-process-and-real-browser-restart", () => {
    const d = read("F:/testavn/Gallery-Preview-Persistence-20261117-after02/report.json");
    assert.equal(d.status, "PASS"); assert.equal(d.cases.length, 20);
    const b = read("F:/testavn/Gallery-Preview-Browser-20261117-04/report.json");
    assert.equal(b.status, "PASS"); assert.equal(b.cases.length, 4); assert(b.cases.every(c => c.status === "PASS"));
    assert.deepEqual(b.errors, []);
    for (const c of b.cases) for (const s of c.screenshots) check(s);
    const owner = read("F:/testavn/Gallery-Preview-Owner-20261117-01/report.json");
    assert.equal(owner.status, "PASS"); assert.equal(owner.cases.length, 4);
    const identity = read("F:/testavn/Gallery-Preview-Export-Identity-20261117-01/report.json");
    assert.equal(identity.status, "PASS"); assert.equal(identity.cases.length, 2);
    assert(identity.cases.every(c => c.status === "PASS" && c.artifacts.length === 2 &&
      c.artifacts[0].storageId === c.artifacts[1].storageId));
    return { process: 20, browser: 4, delayedOwnership: 4, regeneratedProjectIdentities: 2, browserDiskInputControlled: true };
  });
  group("unique-new-player-nsis-bundled-payload", () => {
    assert.equal(build.version, "1.9.87"); assert.equal(build.nativePlayerBuilds, 1);
    assert.equal(build.msiInstallers, 0); assert.equal(build.androidBuilds, 0);
    for (const f of [build.installer, build.dev, build.player, build.backend, build.payloadReport]) check(f);
    assert.notEqual(build.player.sha256, build.oldPlayer.sha256);
    for (const f of build.sources) check(f);
    for (const f of build.bundledSources) { check(f.source); check(f.bundled); assert.equal(f.source.sha256, f.bundled.sha256); }
    const install = read(path.join(base, "install-new.json"));
    assert.equal(install.executable.version, build.version); check(install.executable);
    assert.equal(sha(path.join(install.installRoot, "agentvn-player.exe")), build.player.sha256);
    return { installer: build.installer, player: build.player };
  });
  group("installed-native-preview-restart-project-isolation-fixed-consumption", () => {
    assert.equal(run.status, "PASS"); assert.equal(run.cleanupStatus, "PASS"); assert.equal(run.installations, 1);
    assert.equal(run.cases.length, 2); assert(run.cases.every(c => c.status === "PASS" && c.samples.length === 4));
    for (const c of run.cases) { check(c.previewFile); check(c.fixedFile); }
    assert(run.stages.every(s => s.status === "PASS")); assert.deepEqual(run.errors, []);
    assert(run.cleanups.some(c => c.method === "WM_CLOSE"), "Editor normal-close evidence");
    for (const c of read(path.join(base, "cartridges.json"))) check(c);
    for (const s of run.screenshots) check(s);
    return { nativeDisplay: "1080p DPR1 normal only", themes: 2, previewRestart: true,
      previewProjectIsolation: true, fixedRestart: true, controlledCartridgesNotFreshAuthorExport: true };
  });
  group("retirement-and-originals-preserved", () => {
    const retired = read(path.join(base, "account-retirement-02.json"));
    assert.equal(retired.status, "PASS"); assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted);
    assert(!fs.existsSync(retired.account.profile)); if (retired.databaseEvidence) check(retired.databaseEvidence);
    const before = read(path.join(release, "checkpoint.json"));
    check(before.daily); check(before.frozen.installer); check(before.frozen.player); check(before.git.index);
    assert.equal(cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(), before.git.head);
    assert.equal(sha("C:/Users/1/Downloads/隐忍的成长_20261109_003641.vnproj"),
      "35a33a8b074d8aff682d14c634205450c069a307c34f25ac4d4c4ca5016656f3");
    return { qaAccountRetired: true, originalProjectDailyFrozenHeadIndexPreserved: true };
  });
  r.status = "PASS";
} catch (e) { r.status = "FAILED"; r.error = e.stack; process.exitCode = 1; }
fs.writeFileSync(out, JSON.stringify(r, null, 2), { flag: "wx" }); console.log(JSON.stringify(r));
