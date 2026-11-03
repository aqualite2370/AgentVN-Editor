"use strict";
// Read-only evidence review. Does not execute the product or revise raw results.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const qa = "F:/AgentVN/QA/Preview-Ownership-1940-20261103-01";
const attempt = process.argv[2] || "02"; assert.match(attempt, /^\d{2}$/);
const reportFile = path.join(qa, `session-${attempt}/report.json`);
const destination = path.join(qa, `audit-${attempt}.json`); assert(!fs.existsSync(destination));
const r = read(reportFile);
const audit = { status: "RUNNING", startedAt: new Date().toISOString(), report: desc(reportFile),
  scope: "INSTALLED_UI_GUARD_ABORT_RETRY_ONLY_NOT_UNABORTED_CROSS_PROJECT_RESPONSE",
  productChanges: 0, builds: 0, modelRequests: 0, checks: [] };
function check(name, fn) {
  const c = { name, status: "RUNNING" }; audit.checks.push(c);
  try { c.evidence = fn(); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); }
}
check("Actual installed Editor, bundled backend, source provenance and zero model writes", () => {
  assert.equal(r.status, "PASS"); assert(r.finishedAt);
  assert.equal(r.productChanges, 0); assert.equal(r.builds, 0); assert.equal(r.modelRequests, 0);
  assert.equal(r.blockedModelRequests || 0, 0); assert.deepEqual(r.errors, []);
  for (const f of [r.installation, ...r.products]) assert.equal(sha(f.path), f.sha256, f.path);
  for (const [index, f] of r.tools.entries()) {
    // The task ledger is expected to receive this result after the run. Its
    // pre-run bytes remain immutable in the recorded recoverable checkpoint.
    const actual = path.basename(f.path) === "ACTIVE_TASKS.md"
      ? path.join(r.checkpoint, `${index}-${path.basename(f.path)}`) : f.path;
    assert.equal(sha(actual), f.sha256, actual);
  }
  assert.equal(r.launches.length, 1);
  const launch = r.launches[0];
  assert.equal(launch.sourceServer, false); assert.equal(launch.manualBackendSpawn, false);
  assert.equal(launch.executable.version, "1.9.40");
  assert.equal(path.resolve(launch.executable.path), path.resolve(r.products[0].path));
  assert.equal(path.resolve(launch.backend.ExecutablePath),
    path.resolve(path.dirname(launch.executable.path), "creator-backend.exe"));
  assert(r.products.some(f => f.sha256 === launch.backend.sha256));
  return { editor: r.products[0], backend: launch.backend.sha256, modelRequests: 0 };
});
check("Twelve pending ownership conditions and two actual timeout-retry cases", () => {
  assert.equal(r.cases.length, 15); assert(r.cases.every(c => c.status === "PASS"));
  const ownership = r.cases.filter(c => c.name.startsWith("Pending reload retains owner "));
  assert.equal(ownership.length, 12);
  const keys = [];
  for (const c of ownership) {
    const d = c.detail, m = d.actual;
    assert.equal(d.homeBlocked, true); assert.equal(d.duplicateBlocked, true);
    assert.equal(d.response.calls, 1); assert.equal(d.response.held, true);
    assert.equal(d.response.fulfilled, true); assert.equal(d.response.finished, true);
    assert(!d.response.transportError);
    assert.match(d.response.responseSha256, /^[a-f0-9]{64}$/);
    assert(d.response.repeatClick.withinViewport); assert(d.response.homeClick.hit);
    assert(d.subsequentProject.endsWith("-B"));
    // Inspect the persisted sampling schema rather than inferring DPR from names.
    assert(m && typeof m === "object");
    assert.equal(c.name, `Pending reload retains owner ${m.width} DPR${m.dpr} reduce=${m.reduced}`);
    assert.equal(m.height, m.width * 9 / 16); keys.push(c.name);
  }
  assert.equal(new Set(keys).size, 12);
  for (const w of [1920, 2560, 3840]) for (const d of [1, 2]) for (const reduced of [false, true])
    assert(keys.includes(`Pending reload retains owner ${w} DPR${d} reduce=${reduced}`));
  const timeout = r.cases.filter(c => c.name.startsWith("Timeout releases navigation,"));
  assert.equal(timeout.length, 2);
  for (const c of timeout) {
    assert.match(c.detail.error, /20 秒|20秒/);
    assert(c.detail.activeAfterTimeout.endsWith("-B")); assert(c.detail.retryProject.endsWith("-A"));
    assert.equal(c.detail.response.calls, 1); assert.equal(c.detail.response.finished, true);
    assert.match(c.detail.response.responseSha256, /^[a-f0-9]{64}$/);
  }
  return { pendingConditions: ownership.length, timeoutConditions: timeout.length,
    boundary: "Busy navigation is blocked; timeout aborts before switch; un-aborted stale success not claimed" };
});
check("Every captured PNG has actual sampled dimensions and immutable bytes", () => {
  assert.equal(r.screenshots.length, 14);
  return r.screenshots.map(s => {
    assert.equal(sha(s.path), s.sha256);
    const bytes = fs.readFileSync(s.path);
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.deepEqual(s.before, s.after);
    assert.equal(width, s.before.width * s.before.dpr);
    assert.equal(height, s.before.height * s.before.dpr);
    assert.deepEqual(s.png, { width, height });
    return { path: s.path, width, height, sampling: s.before };
  });
});
check("Original failure retained and owned process/port/cache cleanup completed", () => {
  const original = read(path.join(qa, "session-01/report.json"));
  assert.equal(original.status, "FAILED"); assert.equal(original.cleanupVerified, true);
  assert.match(original.error, /Actual navigation button/);
  assert.equal(r.cleanupVerified, true); assert(!r.cleanupError);
  assert.deepEqual(r.cache.map(c => [c.action, c.exitCode]),
    [["SelfTest", 0], ["Prepare", 0], ["Restore", 0]]);
  for (const c of r.cache) assert.equal(sha(c.log.path), c.log.sha256);
  const identities = new Set(r.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`));
  assert(!rows().some(p => identities.has(`${p.ProcessId}:${p.Created}`)));
  assert.deepEqual(listeners(r.launches.flatMap(l => l.ports)), []);
  assert(r.cleanups.length && r.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
  return { originalFailure: desc(path.join(qa, "session-01/report.json")),
    cleanedIdentities: identities.size, ports: r.launches.flatMap(l => l.ports),
    naturalCloseClaimed: false };
});
audit.status = audit.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
audit.finishedAt = new Date().toISOString();
fs.writeFileSync(destination, JSON.stringify(audit, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: audit.status, checks: audit.checks.map(c => ({
  name: c.name, status: c.status, error: c.error })), destination }, null, 2));
if (audit.status !== "PASS") process.exitCode = 1;
