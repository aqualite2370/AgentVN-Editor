"use strict";
// Real retained files exercise the public validator. No ADB, RunAs, emulator,
// native windows, builds, or model calls are invoked by this regression.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const candidate = require("./android-candidate-device.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function main(configFile, reportFile) {
  assert(configFile && reportFile, "Explicit CONFIG and fresh REPORT required");
  assert(!fs.existsSync(reportFile), "Never overwrite a regression report");
  assert(path.resolve(reportFile).startsWith(path.resolve("F:/AgentVN/QA") + path.sep));
  const c = read(configFile);
  const requestFile = "F:/AgentVN/QA/Android-Package-20261021-01/device-upgrade-17-03/request-submitted.json";
  const realRequest = read(requestFile);
  const r = { status: "RUNNING", scope: "QA_CANDIDATE_DEVICE_PREFLIGHT_ONLY_NOT_DEVICE_ACCEPTANCE",
    startedAt: new Date().toISOString(), tests: [], config: { path: configFile, sha256: sha(configFile) },
    historicalRequest: { path: requestFile, sha256: sha(requestFile) },
    deviceOperations: 0, modelRequests: 0, productLaunches: 0 };
  function test(name, action) {
    const result = { name, status: "RUNNING" }; r.tests.push(result);
    try { result.evidence = action(); result.status = "PASS"; }
    catch (e) { result.status = "FAILED"; result.error = String(e.stack || e); throw e; }
  }
  try {
    const oldCandidate = { gameVersion: realRequest.upgradePair.current.versionName,
      versionCode: realRequest.upgradePair.current.versionCode };
    const historicalRunner = candidate.loadRunner(oldCandidate);
    test("Actual retained signed APK pair and audited bytes pass the parameterized public validator", () => {
      historicalRunner.validateRequest(realRequest);
      return { currentApkSha256: sha(realRequest.apk.path), oldApkSha256: sha(realRequest.oldApk.path),
        packageAuditSha256: sha(realRequest.packageAudit.path), version: oldCandidate };
    });
    test("Current candidate does not accept the historical candidate as its own device result", () => {
      assert.throws(() => candidate.loadRunner(c).validateRequest(realRequest));
      return { expected: c.gameVersion, historical: oldCandidate.gameVersion };
    });
    test("Tampered identity, signer, APK, audit, scope and unsafe output are refused before device operations", () => {
      const mutations = [
        q => q.package = "com.other",
        q => q.upgradePair.current.versionCode = 1000,
        q => q.upgradePair.current.signerSha256 = "0".repeat(64),
        q => q.apk.sha256 = "0".repeat(64),
        q => q.oldApk.sha256 = "0".repeat(64),
        q => q.packageAudit.sha256 = "0".repeat(64),
        q => q.outputDir = "D:\\AgentVN",
        q => q.scope = "installed-package-smoke",
      ];
      for (const change of mutations) {
        const q = structuredClone(realRequest); change(q);
        assert.throws(() => historicalRunner.validateRequest(q));
      }
      return { rejected: mutations.length };
    });
    test("Upgrade window refuses uninstall and clear while keeping install-r and actual input available", () => {
      for (const args of [["uninstall", realRequest.package], ["shell", "pm", "clear", realRequest.package]]) {
        assert.throws(() => historicalRunner.assertPreservedUpgradeData(args, true, false));
        assert.doesNotThrow(() => historicalRunner.assertPreservedUpgradeData(args, true, true));
      }
      for (const args of [["install", "-r", "current-staging.apk"],
        ["shell", "input", "tap", "100", "200"], ["exec-out", "cat", "/owned/save.json"]])
        assert.doesNotThrow(() => historicalRunner.assertPreservedUpgradeData(args, true, false));
      assert.equal(historicalRunner.runningPackagePid({ status: 1, stdout: "", stderr: "" }), null);
      assert.throws(() => historicalRunner.runningPackagePid({ status: 1, stdout: "", stderr: "device offline" }));
      return { forbidden: 2, available: 3, cleanupStillAllowed: true };
    });
    test("Invalid and inconsistent candidate versions cannot construct a runner", () => {
      const invalid = [{ gameVersion: "0.1.3';exit", versionCode: 1003 },
        { gameVersion: "0.1.3", versionCode: 1002 }, { gameVersion: "0.1.0", versionCode: 1000 },
        { gameVersion: "0.1.1001", versionCode: 2001 }];
      for (const v of invalid) assert.throws(() => candidate.loadRunner(v));
      return { rejected: invalid.length };
    });
    test("Generated RunAs/cold-boot/finally entry is parsed by the real Node-to-Windows-PowerShell environment", () => {
      const prep = path.resolve(path.dirname(configFile), "device-binding-syntax-only");
      const startFile = path.join(prep, "start.ps1"), runnerFile = path.join(prep, "runner.cjs");
      candidate.launchSource(startFile, runnerFile);
      candidate.validateStartSyntax(candidate.startSource(startFile, runnerFile));
      assert(!fs.existsSync(prep), "Syntax checking must not create a runtime");
      return { parser: "Windows PowerShell via actual Node child", launched: false };
    });
    test("Actual current prebuild-only audit cannot prepare or launch a device run", () => {
      const auditFile = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01",
        `native-upgrade-audit-${c.attempt}-01/report.json`);
      assert.equal(read(auditFile).status, "PREBUILD_PASS_APK_AND_DEVICE_NOT_RUN");
      const prep = path.join(path.dirname(configFile), `android-device-${c.attempt}-99`);
      const runtime = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01", `device-upgrade-${c.attempt}-99`);
      assert(!fs.existsSync(prep) && !fs.existsSync(runtime));
      assert.throws(() => candidate.prepare(configFile, "01", "99"), /completed actual APK artifact audit/);
      assert(!fs.existsSync(prep) && !fs.existsSync(runtime));
      return { audit: auditFile, directoriesCreated: 0, newApkStillNotRun: true };
    });
    r.status = "PASS";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportFile, JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify(r, null, 2));
}
if (require.main === module) main(...process.argv.slice(2));
