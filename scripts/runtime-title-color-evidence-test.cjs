"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { validateTitleColorEvidence } = require("./lib/runtime-title-color-evidence.cjs");
assert(process.argv[2], "Pass a real completed modern title report for schema-only validation");
const file = path.resolve(process.argv[2]), actual = JSON.parse(fs.readFileSync(file, "utf8"));
const out = path.join(__dirname, "../output/runtime-title-evidence-validation",
  new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const report = { scope: "PURE_EVIDENCE_VALIDATOR_TEST_NOT_CURRENT_SOURCE_OR_PRODUCT_ACCEPTANCE",
  status: "RUNNING", input: file, cases: [] };
function check(name, body) { body(); report.cases.push({ name, status: "PASS" }); }
function reject(name, mutate) {
  check(name, () => { const value = structuredClone(actual); mutate(value);
    assert.throws(() => validateTitleColorEvidence(value, false)); });
}
try {
  check("real-modern-matrix-schema", () => validateTitleColorEvidence(actual, false));
  reject("failed-run", value => { value.status = "FAILED"; });
  reject("smoke-not-full", value => { value.smoke = true; });
  reject("empty-matrix", value => { value.cases = []; });
  reject("duplicate-matrix", value => { value.cases[1] = structuredClone(value.cases[0]); });
  reject("fake-row-id", value => { value.cases[0].kind = "not-a-title-kind"; });
  reject("missing-media-sample", value => { delete value.cases[0].afterCapture.actual; });
  reject("media-label-not-effective", value => {
    value.cases.find(row => row.reduced).before.actual.reduced = false;
  });
  reject("dpr-label-not-effective", value => {
    value.cases.find(row => row.dpr === 2).afterCapture.actual.dpr = 1;
  });
  reject("contrast-low", value => { value.cases[0].contrast = 1.17; });
  reject("contrast-not-measured", value => { delete value.cases[0].contrast; });
  reject("explicit-token-lost", value => {
    value.cases.find(row => row.kind === "token").before.color = "rgb(246, 248, 255)";
  });
  reject("explicit-component-lost", value => {
    value.cases.find(row => row.kind === "component").before.color = "rgb(246, 248, 255)";
  });
  reject("return-color-drift", value => { value.cases[0].afterReturn.color = "rgb(0, 0, 0)"; });
  reject("title-outside-frame", value => { value.cases[0].before.rect.x = -5; });
  reject("horizontal-overflow", value => { value.cases[0].before.overflow = true; });
  reject("no-real-flow", value => { delete value.cases[0].flow; });
  reject("runtime-error", value => { value.cases[0].errors.push("error"); });
  reject("unowned-network", value => { value.cases[0].blockedRequests.push("unexpected"); });
  reject("server-not-cleaned", value => { value.cleanup.serverStopped = false; });
  reject("missing-served-bundle", value => { value.served = []; });
  check("modern-not-legacy", () => assert.throws(() => validateTitleColorEvidence(actual, true)));
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
}
