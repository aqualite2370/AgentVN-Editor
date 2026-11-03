"use strict";
// Read retained evidence and present machine state, never rerun the matrices.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const { compareBundleMarker } = require("./lib/tauri-windows-bundle-marker.cjs");
const [input, output] = process.argv.slice(2);
assert(input && output && !fs.existsSync(output));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const r = read(input), source = read(r.source.path);
const portableSource = r.portableEvidence && read(r.portableEvidence.path);
const runs = portableSource ? [portableSource, r] : [r];
const cases = portableSource ? [...portableSource.cases.slice(0, 2), ...r.cases] : r.cases;
const matrix = runs.flatMap(r => r.matrix), launches = runs.flatMap(r => r.launches), screenshots = runs.flatMap(r => r.screenshots);
const out = path.dirname(input), quote = s => "'" + String(s).replaceAll("'", "''") + "'";
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
  scope: "CURRENT_WINDOWS_PLAYER_ASPECT_PORTABLE_AND_ACTUAL_NSIS_INSTALL_NOT_UPGRADE_OR_ANDROID" };
function identity(d) {
  const file = d.path || d.file;
  assert.equal(sha(file), d.sha256);
  if (d.bytes !== undefined) assert.equal(fs.statSync(file).size, d.bytes);
}
function check(name, fn) { fn(); report.checks.push({ name, status: "PASS" }); }
try {
  check("actual installed 1.9.36 Editor, single UI build and materialized inputs", () => {
    for (const record of [r, source]) {
      assert.equal(record.status, "PASS"); assert.equal(record.cleanup, "PASS");
      assert.equal(record.error, undefined); assert.equal(record.cleanupError, undefined);
      assert.deepEqual(record.errors, []); assert.equal(record.modelRequests, 0);
    }
    if (portableSource) {
      identity(r.portableEvidence); identity(portableSource.source); identity(portableSource.testIdentity);
      assert.equal(portableSource.status, "FAILED"); assert.equal(portableSource.cleanup, "PASS");
      assert(portableSource.error.includes("Get-FileHash")); assert.deepEqual(portableSource.errors, []);
      assert.equal(portableSource.source.sha256, r.source.sha256);
      assert.equal(portableSource.matrix.length, 12); assert.equal(portableSource.launches.length, 3);
      assert.equal(portableSource.cases[2].status, "FAILED");
      assert(!fs.existsSync(path.join(path.dirname(r.portableEvidence.path), "setup-protection.json")));
      report.composition = "Passing portable stages retained from FAILED setup preflight, plus setup-only continuation; no repeated matrix";
    }
    assert.equal(source.builds, 1); assert.equal(source.productChanges, 0); assert.equal(r.builds, 0);
    identity(r.source); identity(source.installation); identity(source.author); identity(source.testIdentity); identity(r.testIdentity);
    const installation = verifiedInstalledCandidate(source.installation.path);
    assert.equal(installation.executable.version, "1.9.36");
    assert.equal(source.steps.length, 4); assert(source.steps.every(s => s.status === "PASS"));
    assert.equal(source.nativeChooserClaim, false);
    assert.equal(source.steps[1].detail.nativePicker, "NOT_RUN");
    for (const f of source.artifacts) identity(f);
    for (const f of source.observedFiles) identity(f);
    for (const name of ["builder", "settings", "viewport", "versions", "verify"])
      assert(source.observedFiles.some(f => f.name === name));
    identity(source.packageRestoration);
    const restored = read(source.packageRestoration.path);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    assert(source.cleanups.every(c => c.status === "PASS" && c.killed.length === 0));
    const close = source.steps[3].detail;
    assert.equal(close.receipt.naturalExitObserved, true);
    assert.equal(close.receipt.physicalInputVerified, false);
    identity(close.receipt.requestEvidence);
  });
  check("portable and actual installed setup executable/resource byte chain", () => {
    identity(r.portable); identity(r.installation); identity(source.portable); identity(source.installer);
    assert.equal(r.portable.sha256, source.portable.sha256);
    const installation = read(r.installation.path);
    assert.equal(installation.status, "PASS"); assert.equal(installation.isElevated, false);
    assert.equal(installation.process.exitCode, 0); assert.equal(installation.installer.sha256, source.installer.sha256);
    assert.equal(installation.pe.ProductName, "AgentVN Aspect QA1936");
    assert.equal(installation.pe.FileVersion, "1.0.0");
    identity(installation.archivedExecutable);
    assert.equal(installation.archivedExecutable.sha256, installation.executable.sha256);
    report.marker = compareBundleMarker(fs.readFileSync(r.portable.path), fs.readFileSync(installation.archivedExecutable.path));
    assert.equal(installation.resources.length, 6);
    for (const resource of installation.resources) {
      const name = path.relative(path.join(installation.client, "embedded-cartridge"), resource.path);
      const exported = source.artifacts.find(f => f.path === path.join(source.embedded.directory, name));
      assert(exported); assert.equal(resource.sha256, exported.sha256);
      assert.equal(sha(path.join(path.dirname(r.portable.path), "embedded-cartridge", name)), resource.sha256);
    }
    const manifest = read(source.embedded.manifest.path), layout = read(source.embedded.layout.path);
    assert.equal(manifest.game_id, "qa_player_aspect_windows_1936"); assert.equal(manifest.runtime_version, "0.27.0");
    assert.equal(layout.layout_type, "renpy"); assert.equal(layout.gameViewport.aspectRatio, "4:3");
    report.gameId = manifest.game_id;
  });
  check("24 complete independent-game display conditions, four actual player choices each", () => {
    assert.equal(cases.length, 5); assert(cases.every(c => c.status === "PASS"));
    assert.equal(matrix.length, 24);
    for (const kind of ["portable", "setup"]) {
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const m = matrix.filter(m => m.kind === kind && m.width === width && m.dpr === dpr && m.reduced === reduced);
        assert.equal(m.length, 1); assert.equal(m[0].status, "PASS");
        assert.deepEqual(m[0].choices.map(c => c.value), ["16:9", "16:10", "4:3", "default"]);
        for (const c of m[0].choices) {
          assert.equal(c.buttons.length, 4); assert(c.buttons.every(b => b.hit));
          assert.equal(c.frame.ratio, c.value === "default" ? "4:3" : c.value);
          assert.equal(c.frame.viewport.width, width); assert.equal(c.frame.viewport.height, width * 9 / 16);
          assert(Math.abs(c.frame.viewport.dpr - dpr) <= 1e-6); assert.equal(c.frame.viewport.reduced, reduced);
        }
      }
      const functional = cases.find(c => c.name.startsWith(`${kind}-embedded`)).detail;
      assert.equal(functional.authorDefault, "4:3"); assert.equal(functional.savedPlayerOverride, "16:10");
      assert.equal(typeof functional.storyIndexUnchanged, "string");
      const restart = cases.find(c => c.name.startsWith(`${kind}-real-process`)).detail;
      assert.equal(restart.realLaunches, 2); assert.equal(restart.restoredProjectDefault, "4:3");
    }
  });
  check("six genuine no-argument launches and six verified PNG captures", () => {
    assert.equal(launches.length, 6);
    const installation = read(r.installation.path);
    for (const l of launches) {
      assert.deepEqual(l.args, []); assert.equal(l.cleanup.status, "PASS");
      assert.equal(l.executable.sha256, l.kind === "portable" ? source.portable.sha256 : installation.executable.sha256);
      assert.equal(l.markers["runtime-mode.json"].mode, "fixed");
      assert.equal(l.markers["fixed-only.json"].fixedOnly, true);
      assert.equal(l.markers["release-package.json"].presentationMode, "release");
      assert.equal(l.storage.portable, true);
      assert.equal(path.resolve(l.storage.targetDirectory),
        path.join(path.dirname(l.executable.path), "saves", report.gameId, "preview_gamecli"));
    }
    assert.equal(screenshots.length, 6);
    for (const s of screenshots) {
      identity(s); assert.deepEqual(s.before, s.after);
      const b = fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
    }
  });
  check("actual uninstall, absent QA registration/shortcuts and original profiles restored", () => {
    for (const record of [r.uninstallation, r.setupCleanup, ...runs.map(r => r.profileRestoration)]) {
      identity(record); assert.equal(read(record.path).status, "PASS");
    }
    assert.equal(read(r.uninstallation.path).process.exitCode, 0);
    assert.equal(read(r.setupCleanup.path).deletedUserFiles, 0);
    assert.equal(read(r.profileRestoration.path).deletedUserFiles, 0);
    const installed = read(r.installation.path);
    assert(!fs.existsSync(installed.executable.path) && !fs.existsSync(installed.uninstaller.path));
    for (const s of installed.shortcuts) assert(!fs.existsSync(s.path));
    for (const run of runs) for (const p of read(path.join(path.dirname(run.testIdentity.path), "profile-protection.json")).records) {
      assert(!fs.existsSync(p.held)); assert(!fs.existsSync(p.retained));
      if (p.byteInventory) {
        assert(Array.isArray(p.files));
        for (const f of p.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
      } // Local browser cache uses the declared NTFS directory identity contract.
      if (p.existed) {
        const result = ps(`fsutil.exe file queryfileid ${quote(p.original)}`);
        assert(result.toLowerCase().includes(p.directoryId));
      } else assert(!fs.existsSync(p.original));
    }
    const registration = ps(`@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Aspect QA1936',` +
      `'HKCU:\\Software\\agentvn\\AgentVN Aspect QA1936','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Aspect QA1936')` +
      `|ForEach-Object {if(Test-Path -LiteralPath $_){throw 'QA registration remains'}};'PASS'`);
    assert.equal(registration, "PASS");
    report.profileVerification = "Roaming file bytes plus original NTFS directory identity; Local cache directory identity only";
  });
  check("all recorded native/build process identities and ports absent", () => {
    const identities = new Set([...runs.flatMap(r => r.knownProcesses || []), ...(source.knownProcesses || []), ...(source.knownBuildProcesses || [])]
      .map(p => `${p.ProcessId}:${p.Created}`));
    assert(!rows().some(p => identities.has(`${p.ProcessId}:${p.Created}`)));
    const ports = [...new Set([...launches.map(l => l.port), ...source.launches.flatMap(l => l.ports || [])])];
    assert.deepEqual(listeners(ports), []);
    report.ownedIdentities = identities.size; report.ports = ports;
  });
  report.status = "PASS";
} catch (e) {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
} finally {
  report.source = { path: input, sha256: sha(input) }; report.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
