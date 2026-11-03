"use strict";
// Recheck one terminal diagnostic; this never declares the broken APK passed.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
function validatePendingCloseTrace(t, runtime) {
  assert.equal(t.observation, "CDP_FUNCTION_CALL_BREAKPOINTS_NO_FUNCTION_REPLACEMENT");
  assert.equal(t.pauses, 0);
  assert(Object.values(t.descriptors).length === 3 && Object.values(t.descriptors)
    .every(d => d.writable === false && d.configurable === false));
  assert.equal(t.trace.invocations.length, 1); assert.equal(t.trace.calls.length, 1);
  assert.equal(t.trace.invocations[0].command, "plugin:window|destroy");
  const call = t.trace.calls[0]; assert.equal(call.command, "plugin:window|destroy");
  assert(Number.isInteger(call.callback) && Number.isInteger(call.error) && call.callback !== call.error);
  assert.equal(t.trace.replies.length, 0);
  assert(t.at - call.at >= 60000 && call.at >= t.trace.invocations[0].at);
  assert.equal(runtime.status, "FAILED"); assert(runtime.finishedAt);
  assert.equal(runtime.exitProbe.gameplayStarted, false);
  assert.equal(runtime.exitProbe.autosaveDisabledThroughUI, true);
  assert.equal(runtime.cases.length, 1); assert.equal(runtime.cases[0].status, "FAILED");
  assert.match(runtime.error, /untouched title native exit with autosave disabled/);
  assert.equal(runtime.touches.filter(c => c.selector === '[data-testid="confirm-exit-game"]').length, 1);
  assert.match(t.text, /自动保存已关闭/);
  return { command: call.command, unansweredMs: t.at - call.at, confirmationClicks: 1 };
}
function main() {
  const root = "F:/AgentVN/QA/Android-Package-20261021-01";
  const files = ["device-navigation-12-06/runtime/exit-boundary-trace.json",
    "device-navigation-12-06/runtime/navigation-report.json", "device-navigation-audit-12-06-01/report.json"]
    .map(f => path.join(root, f));
  const [trace, runtime, audit] = files.map(read);
  assert.equal(audit.status, "EVIDENCE_AUDIT_PASS_FEATURE_FAILED");
  const observed = validatePendingCloseTrace(trace, runtime);
  const bad = [
    t => { t.pauses = 1; }, t => { t.trace.invocations = []; },
    t => { t.trace.calls[0].command = "write_save"; },
    t => { t.trace.replies = [{ id: t.trace.calls[0].callback }]; },
    t => { t.at = t.trace.calls[0].at + 100; },
    t => { t.descriptors.invoke.writable = true; },
    t => { t.trace.calls[0].error = t.trace.calls[0].callback; },
  ];
  for (const mutate of bad) { const t = structuredClone(trace); mutate(t); assert.throws(() => validatePendingCloseTrace(t, runtime)); }
  const out = "F:/AgentVN/QA/Android-Exit-20261024-01/boundary-audit-01.json";
  assert(!fs.existsSync(out));
  fs.writeFileSync(out, JSON.stringify({ status: "BOUNDARY_OBSERVED_NOT_PRODUCT_PASS",
    at: new Date().toISOString(), sources: files.map(fileEvidence), observed, rejectedInvalidTraces: bad.length,
    limitations: ["Proves the frontend reached native close IPC; does not pinpoint dependency internals",
      "Instrumented old APK, not new-source or uninstrumented Android acceptance"],
  }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "BOUNDARY_OBSERVED_NOT_PRODUCT_PASS", observed, rejected: bad.length, out }));
}
if (require.main === module) main();
module.exports = { validatePendingCloseTrace };
