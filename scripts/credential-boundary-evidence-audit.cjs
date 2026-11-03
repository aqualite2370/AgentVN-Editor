"use strict";
// Read-only audit of completed evidence, not another product/model run.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2] || "01";
assert.match(attempt, /^\d{2}$/);
const qa = "F:/AgentVN/QA/Credential-Boundaries-20261102-01";
const file = path.join(qa, `audit-${attempt}.json`); assert(!fs.existsSync(file));
const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: hash(f), bytes: fs.statSync(f).size });
const verify = d => { assert.equal(hash(d.path), d.sha256); if (d.bytes !== undefined) assert.equal(fs.statSync(d.path).size, d.bytes); };
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], inputs: [],
  scope: "READ_ONLY_SECURITY_EVIDENCE_NOT_WHOLE_PROJECT_ACCEPTANCE", realModelRequests: 0, productStarts: 0 };
function load(relative) {
  const f = path.join(qa, relative); report.inputs.push(desc(f));
  const data = JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
  assert.equal(data.status, "PASS", f); return data;
}
function check(name, run) {
  const c = { name, status: "RUNNING" }; report.checks.push(c);
  try { c.detail = run(); c.status = "PASS"; } catch (e) { c.status = "FAILED"; throw e; }
}
try {
  const browser = load("browser-05/report.json"), native = load("installed-03/report.json");
  const originalFile = path.join(qa, "installed-01/report.json");
  report.inputs.push(desc(originalFile));
  const original = JSON.parse(fs.readFileSync(originalFile, "utf8"));
  assert.equal(original.status, "FAILED");
  assert.equal(native.continuation.sha256, hash(originalFile));
  const gates = load("gates-01/report.json"), dev = load("dev-01/report.json"), release = load("release-01/report.json");
  const install = load("installation-01/installation.json"), payload = load("payload-01/installer-resource-report.json");
  check("nonempty-behavior-and-actual-provider-auth-without-prompt-keys", () => {
    assert.equal(browser.cases.length, 15); assert.equal(native.cases.length, 3);
    assert.equal(original.cases.length, 17); assert(original.cases.slice(0, 16).every(c => c.status === "PASS"));
    assert.equal(original.cleanup, "PASS");
    for (const value of [browser, native]) {
      assert(value.cases.every(c => c.status === "PASS")); assert.equal(value.cleanup, "PASS");
      assert.equal(value.errors.length, 0); assert.equal(value.realModelRequests, 0);
      assert(value.model.every(m => m.authenticated && !m.credentialInBody));
      assert(value.api.length >= 6 && value.api.every(a => a.cacheControl === "no-store"));
      assert(value.api.filter(a => a.pathname === "/api/project/state").every(a => !a.containsCredential));
      assert(value.api.some(a => a.pathname === "/api/providers/secrets" && a.containsCredential));
      assert(value.firstProfileScan.files > 0 && value.firstProfileScan.credentialMatches === 0);
      const final = value.cases.find(c => c.name.startsWith("normal-browser-disk-cache"));
      assert(final.detail.files > 0 && final.detail.credentialMatches === 0);
    }
    assert.equal(browser.model.length, 2); assert.equal(native.model.length, 2); assert.equal(original.model.length, 8);
    assert(original.model.every(m => m.authenticated && !m.credentialInBody));
    assert.equal(original.model.filter(m => m.purpose === "outline").length, 6);
    assert(original.model.filter(m => m.purpose === "outline").every(m => !m.providerConfigInMessages));
    assert.equal(native.normalCacheDuringCredentialTests, true); assert.equal(native.syntheticDatabaseKeysCleared, true);
    assert(native.previousProfileScan.files > 0 && native.previousProfileScan.credentialMatches === 0);
    const xml = fs.readFileSync(path.join(qa, "backend-qa-corrected-02.xml"), "utf8");
    assert(/tests="71"/.test(xml) && /failures="0"/.test(xml) && /errors="0"/.test(xml));
    report.inputs.push(desc(path.join(qa, "backend-qa-corrected-02.xml")));
    return { backendTests: 71, sourceFlows: 15, originalInstalledPassedFlows: 16,
      continuationFlows: 3, originalReportStatusUnchanged: "FAILED", installedOutlineHttpRequests: 6 };
  });
  check("all-twelve-displays-and-no-side-effect-captures-in-both-environments", () => {
    const expected = [1920, 2560, 3840].flatMap(w => [1, 2].flatMap(d => [false, true].map(r => `${w}/${d}/${r}`))).sort();
    for (const value of [browser, original]) {
      assert.equal(value.screenshots.length, 12);
      assert.deepEqual(value.screenshots.map(s => `${s.before.width}/${Math.round(s.before.dpr)}/${s.before.reduced}`).sort(), expected);
      for (const shot of value.screenshots) {
        verify(shot); assert.deepEqual(shot.before, shot.after);
        const png = fs.readFileSync(shot.path), m = shot.before;
        assert(Math.abs(png.readUInt32BE(16) - m.width * m.dpr) < .01);
        assert(Math.abs(png.readUInt32BE(20) - m.height * m.dpr) < .01);
        assert(shot.actual.focused && shot.actual.hit && shot.actual.masked && shot.actual.within && shot.actual.overflow <= 1);
      }
    }
    return { actualPngFiles: 24, sourceAndInstalledMatrices: 2, physical4KClaim: false };
  });
  check("exact-dev-exe-installer-and-installed-bundled-backend", () => {
    for (const stage of [gates, dev, release]) {
      assert(stage.commands.length > 0 && stage.commands.every(c => c.status === "PASS" && c.exitCode === 0));
      for (const command of stage.commands) verify(command.logIdentity);
      assert.equal(stage.version, "1.9.38");
    }
    verify(dev.dev); verify(release.installer); verify(release.retainedInstaller); verify(release.backendExe);
    assert.equal(hash(path.join(root, "AgentVN Dev.exe")), dev.dev.sha256);
    assert.equal(hash(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")), dev.dev.sha256);
    verify(install.executable); assert.equal(install.executable.version, "1.9.38");
    assert.equal(install.metadataRestoration, "PASS");
    assert.equal(install.installer.sha256, release.installer.sha256);
    assert.equal(payload.installers.length, 1); assert.equal(payload.installerFormat, "nsis");
    assert.equal(native.installation.executable.sha256, install.executable.sha256);
    assert.equal(native.launches.length, 2);
    for (const launch of native.launches) {
      assert.equal(launch.sourceServer, false); assert.equal(launch.manualBackendSpawn, false);
      assert.equal(launch.backend.sha256, release.backendExe.sha256);
    }
    for (const resource of install.resources) verify(resource);
    return { dev: dev.dev, installer: release.installer, installedBackend: release.backendExe };
  });
  check("owned-processes-ports-and-frozen-security-source-boundary", () => {
    assert(native.cleanups.length === 2 && native.cleanups.every(c => c.status === "PASS"));
    const ports = [browser.modelPort, Number(new URL(browser.services.backend).port),
      Number(new URL(browser.services.frontend).port), native.modelPort, ...native.launches.flatMap(l => l.ports)];
    assert.equal(listeners(ports).length, 0);
    const active = rows(), id = p => `${p.ProcessId}:${p.Created}`;
    assert(!native.knownProcesses.some(p => active.some(a => id(a) === id(p))));
    report.currentSecuritySource = [
      "backend/app/main.py", "backend/app/api/routes_project.py", "backend/app/api/routes_providers.py",
      "backend/app/services/project_state_service.py", "backend/app/services/novel_import_service.py",
      "editor/src/api/backendClient.ts", "editor/src/api/types.ts", "editor/src/app/App.tsx",
      "backend/tests/test_credential_boundaries.py",
    ].map(f => desc(path.join(root, f)));
    report.executedTools = ["browser-05/executed-test.cjs", "installed-01/executed-test.cjs", "installed-03/executed-test.cjs"]
      .map(f => desc(path.join(qa, f)));
    return { listeningOwnedPorts: 0, survivingOwnedProcesses: 0,
      historicalUserCachesNotErased: true, plaintextLocalDatabaseEncryptionNotClaimed: true };
  });
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, file, error: report.error }));
