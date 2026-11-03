"use strict";
// Exercise the actual release CLI in validation-only mode, never build or
// install from a synthetic gate. The positive input is a completed real run.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const gateFile = path.resolve(process.argv[2] || "");
assert(process.argv[2], "Pass the actual completed Runtime WebView gate");
const gate = JSON.parse(fs.readFileSync(gateFile, "utf8"));
assert.equal(gate.status, "RUNTIME_WEBVIEW_SOURCE_PRODUCTION_AND_DEV_PASS");
assert(gate.steps.some(row => row.name === "actual-legacy-engine-production" && row.status === "PASS"));
const output = path.join(root, "output/runtime-webview-release-validation",
  new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { status: "RUNNING", gateFile, startedAt: new Date().toISOString(), cases: [] };
function check(name, input, pass, extra = []) {
  const target = path.join(output, name + "-would-be-release");
  const result = spawnSync(process.execPath, [
    path.join(root, "scripts/installed-player-authoring-release.cjs"),
    input, target, "--runtime-webview", "--validate-only", ...extra,
  ], { cwd: root, windowsHide: true, encoding: "utf8", timeout: 30000 });
  const row = { name, exitCode: result.status, stdout: result.stdout, stderr: result.stderr,
    expected: pass ? "ACCEPT_WITHOUT_BUILD" : "REJECT_WITHOUT_BUILD" };
  report.cases.push(row);
  assert.equal(fs.existsSync(target), false, "Validation must not build, install or create a Release run");
  assert.equal(result.status === 0, pass, `${name}: ${result.stderr || result.error}`);
  if (pass) assert.equal(JSON.parse(result.stdout).status, "RUNTIME_WEBVIEW_RELEASE_GATE_VALIDATED_ONLY");
  row.status = "PASS";
}
try {
  check("actual-completed-gate", gateFile, true);
  const reject = (name, mutate) => {
    const changed = structuredClone(gate);
    mutate(changed);
    const file = path.join(output, name + "-negative-fixture.json");
    fs.writeFileSync(file, JSON.stringify(changed), { flag: "wx" });
    check(name, file, false);
  };
  reject("unfinished-gate", value => { value.status = "RUNNING"; });
  reject("zero-steps", value => { value.steps = []; });
  reject("failed-step", value => { value.steps[0].status = "FAILED"; });
  reject("missing-old-engine", value => {
    value.steps = value.steps.filter(row => row.name !== "actual-legacy-engine-production");
  });
  reject("empty-source-list", value => { value.sources = []; });
  reject("changed-source", value => { value.sources[0].sha256 = "0".repeat(64); });
  reject("escaping-source-path", value => { value.sources[0].file = "../outside"; });
  reject("pending-dev", value => { value.dev.pending = true; });
  reject("mismatched-dev", value => { value.dev.compiledSha256 = "0".repeat(64); });
  reject("empty-bundled-proof", value => { value.resourcesAfterDev.bundled = []; });
  reject("stale-bundled-proof", value => { value.resourcesAfterDev.bundled[0].sha256 = "0".repeat(64); });
  function rejectEvidence(name, stepName, mutate) {
    reject(name, value => {
      const step = value.steps.find(row => row.name === stepName);
      const evidence = JSON.parse(fs.readFileSync(step.evidence));
      mutate(evidence);
      const file = path.join(output, name + "-browser-negative-fixture.json");
      fs.writeFileSync(file, JSON.stringify(evidence), { flag: "wx" });
      step.evidence = file;
    });
  }
  rejectEvidence("empty-production-matrix", "startup-production-full", value => { value.cases = []; });
  rejectEvidence("diagnostic-override-not-product", "actual-legacy-engine-production",
    value => { value.diagnosticOnlyFrameOverride = true; });
  rejectEvidence("duplicate-old-engine-coverage", "actual-legacy-engine-production",
    value => { value.cases[1] = structuredClone(value.cases[0]); });
  rejectEvidence("production-byte-drift", "startup-production-full",
    value => { value.productionFilesServed[0].sha256 = "0".repeat(64); });
  rejectEvidence("wrong-scope", "actual-legacy-engine-production",
    value => { value.scope = "ANDROID_DEVICE_PASS"; });
  reject("missing-title-coverage", value => {
    value.steps = value.steps.filter(row => !row.name.startsWith("title-color-"));
  });
  rejectEvidence("empty-title-matrix", "title-color-modern", value => { value.cases = []; });
  rejectEvidence("duplicate-title-coverage", "title-color-modern",
    value => { value.cases[1] = structuredClone(value.cases[0]); });
  rejectEvidence("title-smoke-not-full-matrix", "title-color-modern", value => { value.smoke = true; });
  rejectEvidence("wrong-title-engine", "title-color-legacy", value => { value.legacy = false; });
  rejectEvidence("failed-title-contrast", "title-color-modern", value => { value.cases[0].contrast = 1.17; });
  rejectEvidence("title-explicit-color-regression", "title-color-modern", value => {
    const row = value.cases.find(row => row.kind === "component");
    row.before.color = "rgb(246, 248, 255)";
  });
  rejectEvidence("title-missing-actual-parameters", "title-color-modern",
    value => { delete value.cases[0].afterCapture.actual; });
  rejectEvidence("title-byte-drift", "title-color-legacy",
    value => { value.served[0].sha256 = "0".repeat(64); });
  rejectEvidence("title-cleanup-missing", "title-color-modern",
    value => { value.cleanup.serverStopped = false; });
  rejectEvidence("legacy-missing-actual-media", "actual-legacy-engine-production",
    value => { delete value.cases[0].actualParameters; });
  rejectEvidence("legacy-media-label-only", "actual-legacy-engine-production", value => {
    value.cases.find(row => row.reduced).actualParameters[0].actual.reduced = false;
  });
  rejectEvidence("legacy-dpr-label-only", "actual-legacy-engine-production", value => {
    value.cases.find(row => row.dpr === 2).actualParameters[1].actual.dpr = 1;
  });
  check("mutually-exclusive-modes", gateFile, false, ["--portable-saves"]);
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, output, cases: report.cases.length }));
}
