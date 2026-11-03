"use strict";
// Candidate guards and generated-entry validation; never launches an emulator.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
async function main(configFile, auditFile, reportFile, mode) {
  assert(configFile && auditFile && reportFile);
  assert(!fs.existsSync(reportFile));
  const c = read(configFile), audit = read(auditFile);
  const q = { scope: "installed-current-navigation", package: audit.upgradePair.current.packageName,
    apk: audit.upgradePair.currentApk, packageAudit: fileEvidence(auditFile),
    serial: "emulator-5554", sdk: "D:\\Android_dev\\Sdk", adbPort: 41121, cdpPort: 41122,
    coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd", adbPort: 41123, grpcPort: 41124,
      discoveryRoot: "C:\\Users\\1\\AppData\\Local\\Temp\\avd\\running", mediaVolumeTarget: 13 },
    outputDir: path.resolve(`F:/AgentVN/QA/Android-Package-20261021-01/device-navigation-${c.attempt}-99/runtime`) };
  const r = { startedAt: new Date().toISOString(), status: "RUNNING", tests: [],
    deviceOperations: 0, productChanges: 0, modelRequests: 0 };
  function test(name, fn) {
    const row = { name, status: "RUNNING" }; r.tests.push(row);
    try { row.evidence = fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  }
  try {
    if (mode === "--red") {
      let failure;
      try { require("./android-current-navigation.cjs").validateNavigationRequest(q); }
      catch (e) { failure = String(e.stack || e); }
      assert(failure, "The historical validator unexpectedly accepts the current candidate");
      r.status = "EXPECTED_BASELINE_FAILURE_REPRODUCED";
      r.failure = failure;
    } else {
      const tool = require("./android-candidate-navigation.cjs");
      test("Current signed APK and completed installed workflow are explicitly bound", () => {
        tool.validateCandidate(configFile, auditFile);
        tool.loadRunner(tool.runnerSource(c, audit)).validateNavigationRequest(q);
        return { apk: q.apk, config: fileEvidence(configFile) };
      });
      test("Wrong package, old APK, audit, ports, output, probes and transport are rejected", () => {
        const runner = tool.loadRunner(tool.runnerSource(c, audit));
        const mutations = [
          v => v.package = "com.other", v => v.apk = audit.upgradePair.old,
          v => v.apk.sha256 = "0".repeat(64), v => v.packageAudit.sha256 = "0".repeat(64),
          v => v.cdpPort = v.adbPort, v => v.outputDir = "D:\\AgentVN",
          v => v.outputDir = v.outputDir.replace(`${c.attempt}-99`, "00-99"),
          v => v.exitProbe = "no-game-autosave-disabled", v => v.traceExitBoundary = true,
          v => v.serial = "emulator-5556", v => v.coldBoot = null,
          v => delete v.coldBoot.avdHome, v => delete v.coldBoot.discoveryRoot,
          v => v.coldBoot.mediaVolumeTarget = undefined,
        ];
        for (const change of mutations) {
          const v = structuredClone(q); change(v);
          assert.throws(() => runner.validateNavigationRequest(v));
        }
        return { rejected: mutations.length };
      });
      test("Historical APK cannot be substituted for the current artifact", () => {
        const old = read("F:/AgentVN/QA/Android-Package-20261021-01/device-upgrade-17-03/request-submitted.json");
        assert.throws(() => tool.loadRunner(tool.runnerSource(c, audit)).validateNavigationRequest({
          ...q, apk: old.apk, packageAudit: old.packageAudit,
        }));
      });
      test("Source drift is refused and real Node-to-PowerShell parser accepts the entry", () => {
        assert.throws(() => tool.runnerSource(c, audit, "SOURCE_DRIFT"));
        const prep = path.resolve(path.dirname(configFile), "navigation-syntax-only");
        const entry = tool.startSource(path.join(prep, "start.ps1"), path.join(prep, "runner.cjs"));
        require("./android-candidate-device.cjs").validateStartSyntax(entry);
        assert(!entry.includes("'android-current-navigation.cjs'"),
          "Navigation must run the frozen per-attempt runner, never another checkout");
        assert(entry.includes(path.join(prep, "runner.cjs")));
        assert(!fs.existsSync(prep));
      });
      test("Expected-failure baseline and lifecycle assertions remain independently available", () => {
        assert.throws(() => require("./android-current-navigation.cjs").validateNavigationRequest(q));
        const { validateImmediateActivityReopen } = require("./android-exit-device.cjs");
        assert.throws(() => validateImmediateActivityReopen({ basis: "PID_DISAPPEARED" }));
      });
      r.status = "PASS";
    }
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportFile, JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify(r, null, 2));
}
if (require.main === module) main(...process.argv.slice(2)).catch(e => { console.error(e); process.exitCode = 1; });
