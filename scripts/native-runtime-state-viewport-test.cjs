"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs");
const { readInstalledViewport: original } = require("./lib/installed-webview-capture.cjs");
const { validateNativeViewport, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const report = JSON.parse(fs.readFileSync(
  "F:/AgentVN/QA/Native-Runtime-State-20261020-01/session-01/flow/report.json", "utf8"));
assert.equal(report.status, "FAILED"); assert.equal(report.matrix.length, 0);
assert(report.checks.every(c => c.status === "FAILED" && c.error.includes("1.0000000149011612")));
const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const actual = { ...expected, dpr: 1.0000000149011612 };
(async () => {
  await assert.rejects(original({ evaluate: async () => actual }, expected), /viewport\/DPR\/media/);
  assert.equal(await readInstalledViewport({ evaluate: async () => actual }, expected), actual);
  for (const delta of [
    { dpr: 1.25 }, { dpr: 2 }, { dpr: NaN }, { dpr: null }, { width: 2560 },
    { height: 1440 }, { reduced: true },
  ]) assert.throws(() => validateNativeViewport({ ...expected, ...delta }, expected));
  const dpr2 = { ...expected, dpr: 2.0000000298023224 };
  assert.equal(validateNativeViewport(dpr2, { ...expected, dpr: 2 }), dpr2);
  assert.equal(validateNativeViewport(expected, expected), expected);
  console.log(JSON.stringify({ status: "PASS", cases: 11,
    originalExactComparisonFailureReproduced: true, rawDprPreserved: true,
    tolerance: 1e-6, scope: "QA_VIEWPORT_GUARDS_NOT_PRODUCT_ACCEPTANCE" }));
})().catch(error => { console.error(error); process.exitCode = 1; });
