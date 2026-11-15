"use strict";
// Offline only; preserves every scoped record and does not transfer historical
// acceptance or turn a provider source match into a product repair.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const { parseThreadtime, pairStderrRelays } = require("./lib/android-log-relay.cjs");
const base = "F:/testavn/Client-Presentation-Android-1975-20261116-04";
const device = "F:/testavn/Client-Presentation-Android-1975-20261116-device-04/report.json";
const prior = "F:/testavn/Windows-Isolated-1974-20261115-01/current-log-review-01.json";
const output = path.join(base, "current-log-review-01.json");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), sha256: sha(p) });
assert(!fs.existsSync(output), "Preserve previous review");
const d = read(device), p = read(prior);
assert(d.finishedAt && d.cases.length === 2 && d.cases.every(c => c.status === "PASS"));
assert.equal(d.environment.sdk, "35");
assert(d.environment.webview.includes("124.0.6367.219"));
const signature = line => {
  const x = parseThreadtime(line); assert(x);
  return JSON.stringify([x.severity, x.tag, x.message]);
};
const references = new Map();
for (const row of p.rows) {
  if (row.status !== "NON_BLOCKING_CURRENT_LOCAL_FUNCTION_SCOPE" || !row.reference) continue;
  assert.equal(sha(row.reference.path), row.reference.sha256);
  assert(fs.readFileSync(row.reference.path, "utf8").length > 100);
  references.set(signature(row.line), row);
}
const result = { status: "RUNNING", at: new Date().toISOString(), inputs: [device, prior].map(desc),
  environment: d.environment, rows: [], cases: [], supplemental: [], productLaunches: 0, models: 0,
  historicalAcceptanceApplied: false, functionalStatus: "PASS",
  boundary: "Current API35/WebView124 local bundled functions only; exact source-backed messages rechecked. No physical-phone, networking, cache recovery or historical event waiver." };
function review(c, logcat, session, completedCase) {
  assert.equal(sha(logcat.path), logcat.sha256);
  const fresh = scopedRuntimeLog(fs.readFileSync(logcat.path, "utf8"), c.package,
    [c.pid, ...(c.restarts || []).map(t => t.pid)]);
  if (completedCase) assert.deepEqual(fresh.messages, c.logReview.messages);
  assert.deepEqual(fresh.fatal, []); assert(fresh.lines.length > 0);
  const pairs = pairStderrRelays(fresh.messages, fresh.pids);
  const byRelay = new Map(pairs.map(pair => [pair.relayIndex, pair]));
  const rows = fresh.messages.map((line, index) => {
    const parsed = parseThreadtime(line); assert(parsed, "Every scoped record must parse completely");
    // A failed startup with no completed presentation has no functional basis
    // for the source-backed local-function classification.
    const ref = c.result?.status === "PASS" ? references.get(signature(line)) : null;
    return { key: session + "/" + c.type + "#" + (index + 1), line, ...parsed,
      ...(ref ? { status: "NON_BLOCKING_CURRENT_LOCAL_FUNCTION_SCOPE", reference: ref.reference,
        reason: ref.reason, currentEvidence: { presentation: c.result.status, restarts: c.restarts?.length || 0,
          ratios: c.displayRatios?.length || 0 } }
        : { status: "UNRESOLVED_CURRENT_EVENT", reason: "Current call/recovery boundary not established." }),
      ...(byRelay.has(index) ? { parentKey: session + "/" + c.type + "#" + (byRelay.get(index).nativeIndex + 1),
        relayDelayMs: byRelay.get(index).delayMs } : {}) };
  });
  for (const row of rows.filter(v => v.parentKey)) {
    const parent = rows.find(v => v.key === row.parentKey); assert(parent);
    if (parent.status === "NON_BLOCKING_CURRENT_LOCAL_FUNCTION_SCOPE")
      row.status = "MIRROR_OF_NON_BLOCKING_CURRENT_EVENT";
  }
  assert.deepEqual(rows.map(row => row.line), fresh.messages);
  const unresolved = rows.filter(row => !row.status.includes("NON_BLOCKING"));
  const summary = { session, type: c.type, logcat, records: rows.length, mirrors: pairs.length,
    nonBlocking: rows.length - unresolved.length, unresolved: unresolved.length,
    unresolvedSignatures: [...new Set(unresolved.map(row => signature(row.line)))],
    fatal: fresh.fatal, pids: fresh.pids };
  (completedCase ? result.cases : result.supplemental).push(summary);
  result.rows.push(...rows);
}
for (const c of d.cases) review(c, c.logcat, c.type === "agentvn" ? "device-03" : "device-04", true);
// Include the exact earlier sessions that supplied presentation evidence, plus
// the initial closed-page failure; never hide their logs behind a later PASS.
for (const attempt of ["01", "02", "03"]) {
  const folder = `F:/testavn/Client-Presentation-Android-1975-20261116-device-${attempt}`;
  const receipt = path.join(folder, "report.json"), earlier = read(receipt);
  assert.equal(earlier.status, "FAILED");
  assert.equal(earlier.environment.sdk, d.environment.sdk);
  assert.equal(earlier.environment.webview, d.environment.webview);
  result.inputs.push(desc(receipt));
  const c = earlier.cases.at(-1);
  assert(c?.pid && c.package);
  const logcat = desc(path.join(folder, "failure-logcat.txt"));
  review(c, logcat, "device-" + attempt, false);
}
assert.equal(new Set(result.rows.map(row => row.key)).size, result.rows.length);
result.records = result.rows.length;
result.unresolved = [...result.cases, ...result.supplemental].reduce((n, c) => n + c.unresolved, 0);
result.status = result.unresolved ? "FUNCTIONS_PASS_CURRENT_LOG_EVENTS_UNRESOLVED"
  : "FUNCTIONS_AND_CURRENT_LOCAL_LOG_REVIEW_PASS";
for (const input of result.inputs) assert.equal(sha(input.path), input.sha256);
result.finishedAt = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: result.status, records: result.records, unresolved: result.unresolved,
  cases: [...result.cases, ...result.supplemental].map(c => ({ session: c.session, type: c.type,
    records: c.records, mirrors: c.mirrors, unresolved: c.unresolved })), output }));
