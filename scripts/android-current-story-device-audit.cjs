"use strict";
// Independent read-only review of the real Android full-story flow.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence: desc } = require("./android-acceptance-evidence.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { rendererReview } = require("./android-candidate-renpy-device-audit.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
function actualPids(runtime, packageName, logTexts) {
  assert.equal(typeof packageName, "string"); assert(packageName.length > 0);
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = new RegExp(`\\bStart proc (\\d+):${escaped}(?:[:/])`);
  const recovered = logTexts.flatMap(({ file, text }) => text.split(/\r?\n/).flatMap(line => {
    const match = line.match(start);
    return match ? [{ pid: match[1], file, line }] : [];
  }));
  const pids = [...new Set([runtime.logcat?.pid, ...(runtime.restartTrials || []).flatMap(t =>
    [t.pid, ...(t.appAndRendererPids || [])]), ...recovered.map(v => v.pid)].filter(Boolean).map(String))];
  assert(pids.length, "Actual Runtime PIDs are required");
  return { pids, recovered };
}
function reviewLogs(runtime, directory) {
  const logs = fs.readdirSync(directory).filter(n => /(?:^|-)logcat[.]txt$/.test(n));
  assert(logs.length, "Raw logcat is required");
  const request = read(path.join(path.dirname(directory), "request-submitted.json"));
  const { pids, recovered } = actualPids(runtime, request.package,
    logs.map(n => ({ file: path.join(directory, n), text: fs.readFileSync(path.join(directory, n), "utf8") })));
  const reviews = logs.map(n => ({ file: desc(path.join(directory, n)),
    ...rendererReview({ pids }, fs.readFileSync(path.join(directory, n), "utf8")) }));
  const events = reviews.flatMap(r => r.events);
  const unique = [...new Map(events.map(e => [[e.time, e.ownerPid, e.rendererPid, e.code].join(":"), e])).values()];
  return { status: unique.length ? "BLOCKED_RENDERER_TERMINATION_REVIEW" : "NO_RENDERER_TERMINATION_RECORD",
    pids, recoveredPidEvidence: recovered, reviews, events: unique, rawMatchingLines: events.length };
}
function assertStoryComplete(runtime) {
  assert.equal(runtime.scope, "installed-full-story");
  assert.equal(runtime.fullStory?.status, "PASS");
  assert.equal(runtime.fullStory.cases.length, 7);
  assert(runtime.fullStory.cases.every(c => c.status === "PASS"));
  assert(Object.keys(runtime.requiredCoverage).length >= 19);
  assert(Object.values(runtime.requiredCoverage).every(v => v === "PASS"));
  assert(runtime.touches.length > 30);
  assert.equal(runtime.restartTrials?.length, 6);
  for (const kind of ["clean-install", "retained-data"])
    assert.deepEqual(runtime.restartTrials.filter(t => t.kind === kind).map(t => t.iteration), [1, 2, 3]);
  assert.equal(runtime.rotationEvidence?.observedDegrees, 270);
}
async function audit(bindingFile, number) {
  assert.match(number, /^\d{2}$/); bindingFile = path.resolve(bindingFile);
  const b = read(bindingFile), directory = path.join(b.output, "runtime");
  const out = `${b.output}-audit-${number}`; assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), sources: [desc(__filename), desc(bindingFile)],
    checks: [], productChanges: 0, builds: 0, deviceOperations: 0, modelRequests: 0 };
  const load = f => { r.sources.push(desc(f)); return read(f); };
  const verify = f => { assert.equal(sha(f.path), f.sha256, f.path); r.sources.push(desc(f.path)); };
  const check = async (name, fn) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = await fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
  };
  try {
    const wrapper = load(path.join(b.output, "report.json"));
    const runtime = load(path.join(directory, "runtime-smoke-report.json"));
    const owner = load(path.join(directory, "acceptance-launch.json"));
    const q = load(path.join(b.output, "request-submitted.json"));
    const boot = load(path.join(directory, "cold-boot.json"));
    const artifact = load(b.audit.path);
    r.rawStatus = runtime.status; r.rawFailureCode = runtime.failureCode; r.rawError = runtime.message;
    await check("Frozen candidate, actual installed artifact and unchanged execution sources", () => {
      for (const f of b.sources) verify(f); verify(b.audit); verify(b.fixture); verify(artifact.apk);
      const receipt = { path: bindingFile, sha256: sha(bindingFile) };
      assert.deepEqual(q.candidateBinding, receipt);
      assert.deepEqual(wrapper.candidateBinding, receipt);
      assert.deepEqual(runtime.sourceApk, desc(artifact.apk.path));
      assert.equal(wrapper.productChanges, 0); assert.equal(wrapper.builds, 0); assert.equal(wrapper.modelRequests, 0);
      return { apk: artifact.apk, candidate: artifact.candidate, sourceFiles: b.sources.length };
    });
    await check("Actual non-admin to admin boundary, symlink probe and owned cold boot", () => {
      const permission = load(path.join(directory, "acceptance-permission.json"));
      assert.equal(owner.parentBoundary, "non-admin-to-RunAs"); assert.equal(owner.isElevated, true);
      assert.equal(permission.isElevated, true); assert.equal(permission.success, true);
      assert.equal(boot.status, "PASS"); assert.equal(boot.coldBoot, true);
      assert(boot.processes.length >= 2); assert.equal(runtime.isElevated, true);
      return { bootId: boot.bootId, permission, ownerPid: owner.processId };
    });
    await check("All seven real story cases, coverage, rotation and six restart trials", () => {
      assertStoryComplete(runtime);
      return { cases: runtime.fullStory.cases.map(({ name, status }) => ({ name, status })),
        touches: runtime.touches.length, coverage: runtime.requiredCoverage, restarts: runtime.restartTrials.length };
    });
    await check("Actual screenshot pixels, XML and historical audio source without new listening", () => {
      assert(runtime.screenshots.length > 0); const physical = runtime.viewport.physical;
      const images = [...new Set(runtime.screenshots)].map(f => {
        const bytes = fs.readFileSync(f); assert.equal(bytes.subarray(1, 4).toString(), "PNG");
        const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
        assert.equal(width, physical.width); assert.equal(height, physical.height);
        r.sources.push(desc(f)); return { name: path.basename(f), width, height };
      });
      const xml = fs.readdirSync(directory).filter(n => n.endsWith(".xml")); assert(xml.length > 0);
      for (const name of xml) {
        const f = path.join(directory, name); assert.match(fs.readFileSync(f, "utf8"), /<hierarchy[ >]/); r.sources.push(desc(f));
      }
      verify(b.audio); verify(b.audioSource);
      assert.equal(b.audio.sha256, b.audioSource.sha256);
      assert.equal(runtime.audioConfirmation?.status, "USER_CONFIRMED_PASS");
      assert.equal(runtime.audioConfirmation.newCapture, false);
      return { images, xml: xml.length, audio: b.audio, newListening: false,
        viewportLimit: "Physical emulator pixels only; no desktop DPR matrix claim" };
    });
    await check("Finally uninstall and staging deletion, source preserved, owned processes and ports gone", () => {
      assert.equal(runtime.uninstallStatus, "PASS"); assert.equal(runtime.apkCleanupStatus, "PASS");
      assert.equal(runtime.cleanupError, null); assert.equal(owner.emulatorCleanupStatus, "PASS");
      assert(owner.finishedAt); assert(wrapper.finishedAt); assert(!fs.existsSync(path.join(directory, "staging.apk")));
      verify(artifact.apk);
      const ports = [q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort, 5554, 5555];
      assert.deepEqual(listeners(ports), []);
      const live = rows(), owned = [...boot.processes.map(p => p.ProcessId), owner.processId, runtime.ownership.runnerPid];
      assert(!live.some(p => owned.includes(p.ProcessId)), "Recorded test process remains live; inspect creation identity");
      return { package: "PASS", staging: "PASS", source: artifact.apk, releasedPorts: ports, owned };
    });
    r.rendererReview = reviewLogs(runtime, directory);
    const warnings = [runtime.logcat?.warnings || [], ...(runtime.restartTrials || []).map(t => t.warnings || [])].flat();
    r.warningReview = { count: warnings.length, raw: warnings, assessment: runtime.rendererWarningAssessment || null };
    r.functionalStatus = r.checks[2].status;
    r.status = r.checks.some(c => c.status === "FAILED") || runtime.status === "FAILED" ? "FAILED"
      : r.rendererReview.events.length ? "BLOCKED_RENDERER_TERMINATION_REVIEW"
      : warnings.length || runtime.status !== "RUNTIME_PASS" ? "BLOCKED" : "PASS";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); }
  r.limitations = ["Native directory selection used an authorized restored controlled response, native picker NOT_RUN",
    "API35 emulator isolated authored fixture, not all routes, physical phone or final user project",
    "Historical audio confirmation retained; no new listening"];
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, output: out, checks: r.checks.map(({ name, status }) => ({ name, status })),
    rendererEvents: r.rendererReview?.events, error: r.error }));
  if (r.status === "FAILED") process.exitCode = 1;
}
function selfTest() {
  const valid = { scope: "installed-full-story", fullStory: { status: "PASS",
    cases: Array.from({ length: 7 }, () => ({ status: "PASS" })) },
    requiredCoverage: Object.fromEntries(Array.from({ length: 19 }, (_, i) => [i, "PASS"])),
    touches: Array(31).fill({}), rotationEvidence: { observedDegrees: 270 },
    restartTrials: ["clean-install", "retained-data"].flatMap(kind => [1, 2, 3].map(iteration => ({ kind, iteration }))) };
  assertStoryComplete(valid);
  const bad = [r => r.scope = "other", r => r.fullStory.cases = [],
    r => r.fullStory.cases[0].status = "NOT_RUN", r => r.requiredCoverage = {},
    r => r.requiredCoverage[0] = "BLOCKED", r => r.touches = [],
    r => r.restartTrials.pop(), r => r.rotationEvidence.observedDegrees = 90];
  for (const change of bad) { const r = structuredClone(valid); change(r); assert.throws(() => assertStoryComplete(r)); }
  const pidProof = actualPids({}, "com.agentvn.qa.narrative20261102", [{ file: "retained-log",
    text: "11-02 05:28:51.562 593 625 I ActivityManager: Start proc 2701:com.agentvn.qa.narrative20261102/u0a216 for next-top-activity\n" +
      "11-02 05:28:52.562 593 625 I ActivityManager: Start proc 9999:com.agentvn.qa.narrative202611020/u0a216 for next-top-activity" }]);
  assert.deepEqual(pidProof.pids, ["2701"]); assert.equal(pidProof.recovered.length, 1);
  assert.throws(() => actualPids({}, "com.expected", [{ file: "other", text: "Start proc 99:com.other/u0a1" }]));
  return { status: "PASS", rejectedIncompleteResults: bad.length, exactPackagePidRecovery: "PASS", deviceOperations: 0 };
}
module.exports = { audit, reviewLogs, actualPids, assertStoryComplete, selfTest };
if (require.main === module) {
  if (process.argv[2] === "self-test") console.log(JSON.stringify(selfTest()));
  else audit(...process.argv.slice(2)).catch(e => { console.error(e); process.exitCode = 1; });
}
