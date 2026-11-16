"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), cp = require("node:child_process");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Windows-Isolated-1986-20261117-03";
const first = "F:/testavn/Windows-Isolated-1986-20261117-01";
const out = path.join(base, "functional-audit.json"); assert(!fs.existsSync(out));
const r = { status: "RUNNING", groups: [], inputs: [], launches: 0, builds: 0, modelRequests: 0 };
function read(f) { r.inputs.push({ path: f, sha256: sha(f) }); return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")); }
function check(f) { assert.equal(sha(f.path), f.sha256, f.path); }
function group(name, fn) { const row = { name, status: "RUNNING" }; r.groups.push(row);
  try { row.detail = fn(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; row.error = e.stack; throw e; } }
try {
  const releaseRoot = "F:/testavn/Sprite-Hide-Rollback-Release-1986-20261117-01";
  const build = read(path.join(releaseRoot, "release/build.json")), run = read(path.join(base, "resource-01/report.json"));
  group("engine-and-real-art-browser-two-hide-paths", () => {
    const engine = read("F:/testavn/Sprite-Hide-Rollback-20261117-animation-after02/report.json");
    assert.equal(engine.status, "PASS"); assert.equal(engine.cases.length, 18); assert(engine.cases.every(c => c.status === "PASS"));
    for (const [file, count] of [["browser04", 48], ["browser05", 8]]) {
      const data = read(`F:/testavn/Sprite-Hide-Rollback-20261117-${file}/report.json`);
      assert.equal(data.status, "PASS"); assert.equal(data.cases.length, count); assert(data.cases.every(c => c.status === "PASS"));
      assert.deepEqual(data.errors, []); assert.equal(data.cleanup, "OWNED_BROWSER_SERVER_STOPPED");
    }
    return { engine: 18, primaryMatrix: 48, finalCallbackSupplement: 8, controlledNotFullUserStory: true };
  });
  group("new-native-player-dev-nsis-and-bundled-source", () => {
    assert.equal(build.version, "1.9.86"); assert.equal(build.nativePlayerBuilds, 1);
    assert.equal(build.msiInstallers, 0); assert.equal(build.androidBuilds, 0);
    for (const f of [build.installer, build.dev, build.player, build.backend, build.payloadReport]) check(f);
    assert.notEqual(build.player.sha256, build.oldPlayer.sha256);
    assert(build.sources.some(s => /StoryEngine\.ts$/.test(s.path)));
    for (const s of build.sources) check(s);
    for (const s of build.bundledSources) { check(s.source); check(s.bundled); assert.equal(s.source.sha256, s.bundled.sha256); }
    const actual = read(path.join(first, "install-new.json"));
    assert.equal(actual.status, "PASS"); assert.equal(actual.executable.version, "1.9.86"); check(actual.executable);
    assert.equal(sha(path.join(actual.installRoot, "agentvn-player.exe")), build.player.sha256);
    return { installer: build.installer, nativePlayer: build.player, oneFinalCandidate: true };
  });
  group("actual-install-confirmation-and-four-native-cartridges", () => {
    assert.equal(run.status, "PASS"); assert.equal(run.cleanupStatus, "PASS"); assert.equal(run.installations, 0);
    assert.equal(run.stages.length, 5); assert(run.stages.every(s => s.status === "PASS"));
    const original = read(path.join(first, "resource-01/report.json"));
    assert.equal(original.installations, 1); assert.equal(original.status, "FAILED");
    assert(original.stages.slice(0, 2).every(s => s.status === "PASS"));
    assert.equal(run.cases.length, 4); assert(run.cases.every(c => c.status === "PASS" && c.rollback.length === 2));
    assert.deepEqual(run.errors, []); assert.equal(run.blockedModelRequests || 0, 0);
    for (const c of read(path.join(base, "cartridges.json"))) check(c);
    for (const shot of [...original.screenshots, ...run.screenshots]) check(shot);
    assert(original.cleanups.some(c => c.method === "WM_CLOSE"));
    return { cases: 4, editorActions: true, normalEditorClose: true, display: "1080p DPR1 normal",
      derivedCartridgesNotAuthorExports: true, originalProfileSeparateFromNativeFollowup: true, reinstall: false };
  });
  group("retirement-and-preserved-daily-frozen-git", () => {
    const retired = read(path.join(base, "account-retirement-01.json"));
    assert.equal(retired.status, "PASS"); assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted);
    assert(!fs.existsSync(retired.account.profile));
    if (retired.databaseEvidence) check(retired.databaseEvidence);
    const firstRetired = read(path.join(first, "account-retirement-01.json"));
    assert.equal(firstRetired.status, "PASS"); assert(firstRetired.cleanup.accountDeleted && firstRetired.cleanup.profileDeleted);
    assert(!fs.existsSync(firstRetired.account.profile)); check(firstRetired.databaseEvidence);
    const secondRetired = read("F:/testavn/Windows-Isolated-1986-20261117-02/account-retirement-01.json");
    assert.equal(secondRetired.status, "PASS"); assert(secondRetired.cleanup.accountDeleted && secondRetired.cleanup.profileDeleted);
    assert(!fs.existsSync(secondRetired.account.profile));
    const before = read(path.join(releaseRoot, "checkpoint.json"));
    check(before.daily); check(before.frozen.installer); check(before.frozen.player);
    const git = args => cp.execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim();
    assert.equal(git(["rev-parse", "HEAD"]), before.git.head); check(before.git.index);
    return { qaProfileRetired: true, dailyAndFrozenUnchanged: true, gitHeadIndexUnchanged: true };
  });
  group("old-qa-cleanup-completed-with-failures-retained", () => {
    const cleanup = read("F:/testavn/Windows-Isolated-1985-20261116-03/artifact-cleanup-03.json");
    assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.targets.length, 9);
    assert(cleanup.targets.every(t => t.removed && !fs.existsSync(t.path)));
    return { files: cleanup.files, logicalBytes: cleanup.logicalBytes, physicalFreedNotMeasured: true };
  });
  r.status = "PASS";
} catch (e) { r.status = "FAILED"; r.error = e.stack; process.exitCode = 1; }
fs.writeFileSync(out, JSON.stringify(r, null, 2), { flag: "wx" }); console.log(JSON.stringify(r));
