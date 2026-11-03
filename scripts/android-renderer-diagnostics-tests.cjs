"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/android-renderer-diagnostics-tests", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const tests = ["android-runtime-result-test", "android-cache-probe-test", "android-cache-stack-test", "android-cache-debugger-test", "android-trace-capabilities-test", "android-webview-binary-test", "android-cache-perf-test", "android-perf-selfcheck-test", "android-cache-attribution-test",
  "android-runtime-log-analysis-test", "android-acceptance-evidence-test", "android-version-provenance-test",
  "android-acceptance-runner-test", "android-cleanup-behavior-test",
  "android-test-artifact-cleanup-test", "android-runner-failure-test", "android-runner-arguments-test",
  "android-installed-resource-flow-test", "android-layout-type-exit-contract-test",
  "android-audio-capture-order-contract-test", "android-uiautomator-capture-test",
  "android-process-argument-roundtrip-test", "android-full-story-flow-test",
  "android-runtime-stability-test", "android-audio-volume-contract-test"];
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "acceptance-tooling-regressions-only-not-device-or-product-acceptance", tests: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
try {
  assert.equal(tests.length, 25); assert.equal(new Set(tests).size, 25);
  for (const test of tests) {
    const result = spawnSync(process.execPath, [`scripts/${test}.cjs`], {
      cwd: root, encoding: "utf8", windowsHide: true, timeout: 90000,
    });
    fs.writeFileSync(path.join(out, `${test}.log`), `${result.stdout || ""}\n${result.stderr || ""}`);
    report.tests.push({ command: `node scripts/${test}.cjs`, exitCode: result.status,
      status: !result.error && result.status === 0 && /PASS/.test(result.stdout) ? "PASS" : "FAILED",
      error: result.error?.message, log: path.join(out, `${test}.log`) });
    save();
    assert.equal(report.tests.at(-1).status, "PASS", `${test}: ${result.error || result.stderr}`);
    console.log(`PASS ${test}`);
  }
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${out}`); }
