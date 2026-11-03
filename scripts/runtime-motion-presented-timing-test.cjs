"use strict";
// Replay actual captured native events through the production audit function.
// No application starts, profiles, product changes or live animation overrides.
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const output = process.argv[2]; assert(output && !fs.existsSync(output));
const sourceFile = path.resolve("scripts/installed-runtime-motion-current-audit.cjs");
const source = fs.readFileSync(sourceFile, "utf8");
const start = source.indexOf("function presentedTiming("), end = source.indexOf("\ntry {", start);
assert(start >= 0 && end > start);
const timing = new Function("assert", source.slice(start, end) + "\nreturn presentedTiming;")(assert);
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const historyFile = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-motion-current-33/motion.json";
const history = JSON.parse(fs.readFileSync(historyFile, "utf8"));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
  source: { path: sourceFile, sha256: sha(sourceFile) },
  historicalInput: { path: historyFile, sha256: sha(historyFile) },
  productStarts: 0, profileChanges: 0, modelRequests: 0 };
function fixture(dpr, reduced, name) {
  const m = history.matrix.find(m => m.layout === "agentvn" && m.width === 1920 && m.dpr === dpr && m.reduced === reduced);
  const e = m.episodes.find(e => e.name === name);
  const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path)));
  return { m, e, t };
}
function check(name, run) {
  try { run(); report.checks.push({ name, status: "PASS" }); }
  catch (error) { report.checks.push({ name, status: "FAILED", error: String(error.stack || error) }); }
}
const normal = fixture(1, false, "title-to-settings");
const swap = fixture(2, true, "title-to-settings");
const canceled = fixture(2, false, "playing-to-main-menu-Escape");
check("Original normally named actual CSS completion accepted", () => {
  assert.equal(timing(normal.m, normal.e, normal.t).duration, 1632);
});
check("Actual completion with already committed is-swap class accepted", () => {
  assert(swap.t.events.some(e => e.type === "transitionend" && e.target?.includes("is-swap")));
  assert.equal(timing(swap.m, swap.e, swap.t).duration, 816);
});
check("Historical real early cancellation remains rejected", () => {
  assert(canceled.t.events.some(e => e.type === "transitioncancel" && e.name === "opacity"));
  assert.throws(() => timing(canceled.m, canceled.e, canceled.t));
});
const changes = [
  ["missing cover end", t => { t.events = t.events.filter(e => !(e.type === "transitionend" && e.target?.includes("is-covering"))); }],
  ["fake root owner", t => { t.events.forEach(e => { if (e.target?.startsWith("runtime-screen-transition")) e.target = e.target.replace("runtime-screen-transition", "runtime-screen-transition-fake"); }); }],
  ["interleaved cancellation", t => { const e = t.events.find(e => e.type === "transitionend" && e.target?.includes("is-covering")); t.events.push({ ...e, type: "transitioncancel" }); }],
  ["wrong nominal duration", t => { t.events.find(e => e.type === "transitionend" && e.target?.includes("is-covering")).elapsed = .7; }],
  ["reveal before cover", t => { t.events.find(e => e.type === "transitionend" && e.target?.includes("is-revealing")).at = 0; }],
  ["missing owning start", t => { t.events = t.events.filter(e => !(e.type === "transitionrun" && e.target?.includes("is-covering"))); }],
  ["duplicate completed cover", t => { t.events.push({ ...t.events.find(e => e.type === "transitionend" && e.target?.includes("is-covering")) }); }],
];
for (const [name, mutate] of changes) check(`Reject ${name}`, () => {
  const t = structuredClone(normal.t); mutate(t);
  assert.throws(() => timing(normal.m, normal.e, t));
});
check("Current installed Player24 actual native traces have complete owning clocks", () => {
  const file = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/curtain-installed-1933-02/report.json";
  const current = JSON.parse(fs.readFileSync(file, "utf8"));
  report.currentInput = { path: file, sha256: sha(file) };
  assert.equal(current.status, "PASS"); assert.equal(current.cases.length, 24);
  for (const c of current.cases) {
    assert.equal(sha(c.evidence.path), c.evidence.sha256);
    const { trace } = JSON.parse(fs.readFileSync(c.evidence.path, "utf8"));
    const result = timing(c, { name: trace.name, timings: { from: "playing", to: "main_menu" } }, trace);
    assert.equal(result.duration, c.reduced ? 816 : 1632);
  }
});
report.status = report.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
report.finishedAt = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, checks: report.checks.map(c => ({ name: c.name, status: c.status })), output }));
if (report.status !== "PASS") process.exitCode = 1;
