"use strict";
// Read-only audit of real old-binary execution and unchanged installation exports.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const [input, output] = process.argv.slice(2);
assert(input && output && !fs.existsSync(output));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const r = read(input), report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [] };
function check(name, run) { run(); report.checks.push({ name, status: "PASS" }); }
function identity(d) { assert.equal(sha(d.path || d.file), d.sha256); }
try {
  check("traceable actual old Player, unmodified current exports and old positive control", () => {
    assert.equal(r.status, "PASS"); assert.equal(r.cleanup, "PASS");
    assert.deepEqual(r.errors, []); assert.equal(r.error, undefined); assert.equal(r.cleanupError, undefined);
    assert.equal(r.modelRequests, 0);
    for (const f of [r.oldInstallation, r.author, r.controls, r.executable, r.testIdentity]) identity(f);
    const installation = verifiedInstalledCandidate(r.oldInstallation.file);
    assert.equal(installation.executable.version, "1.9.35");
    assert.equal(r.executable.file, path.join(installation.installRoot, "agentvn-player.exe"));
    assert.equal(r.executable.sha256, "66945ed6a9d026ab2f17370c9fe1fa207cdc741b7005f61f1ccd539c56e46b0e");
    const author = read(r.author.file); assert.equal(author.status, "PASS");
    for (const type of ["renpy", "agentvn"]) {
      const refusal = r.cases.find(c => c.type === type), exported = author.cartridges.find(c => c.type === type);
      assert.equal(refusal.cartridge.file, exported.path); assert.equal(refusal.cartridge.sha256, exported.sha256);
    }
    assert.equal(r.cases.length, 3); assert(r.cases.every(c => c.status === "PASS"));
    const control = r.cases.find(c => c.type === "control"), oldExports = read(r.controls.file);
    assert.equal(control.playing, true); assert.equal(control.requiredRuntime, "0.25.0");
    assert(oldExports.cartridges.some(c => c.path === control.cartridge.file && c.sha256 === control.cartridge.sha256));
    for (const c of r.cases) identity(c.cartridge);
  });
  check("both layout exports rejected by protocol gate, 24 bounded refusal displays and five real PNGs", () => {
    for (const type of ["renpy", "agentvn"]) {
      const c = r.cases.find(c => c.type === type);
      assert.equal(c.actualRuntime, "0.26.0"); assert.equal(c.requiredRuntime, "0.27.0");
      assert.equal(c.storyMounted, false); assert(/卡带要求\s*0\.27\.0/.test(c.refusalText));
      assert(/当前 GameCLI 为\s*0\.26\.0/.test(c.refusalText));
      assert.equal(c.matrix.length, 12);
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const m = c.matrix.find(m => m.width === width && m.dpr === dpr && m.reduced === reduced);
        assert(m && m.status === "PASS"); assert.equal(m.geometry.buttons.length, 2);
        assert(m.geometry.buttons.every(b => b.hit));
      }
    }
    assert.equal(r.screenshots.length, 5);
    for (const s of r.screenshots) {
      identity(s); assert.deepEqual(s.before, s.after);
      const b = fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
    }
  });
  check("profiles restored, all three attributed launches and ports cleaned", () => {
    identity(r.profileRestoration);
    const restoration = read(r.profileRestoration.file);
    assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
    for (const p of restoration.restored) for (const f of p.files || [])
      assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
    assert.equal(r.launches.length, 3); assert(r.launches.every(l => l.cleanup.status === "PASS"));
    const identities = new Set(r.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`));
    assert(!rows().some(p => identities.has(`${p.ProcessId}:${p.Created}`)));
    assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
    report.ownedProcessIdentities = identities.size;
    report.scope = "Old protocol gate and old supported control; not upgrade, Android or full story playthrough";
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.source = { file: input, sha256: sha(input) }; report.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
