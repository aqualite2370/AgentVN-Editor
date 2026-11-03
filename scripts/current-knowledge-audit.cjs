"use strict";
// Independent read-only evidence audit. A delivery failure never becomes PASS
// merely because the installed functional report passes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { qa, checkpoint, matrix, topics } = require("./current-knowledge-closure.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const root = path.resolve(__dirname, "..");
function validateFunctional(report, followup) {
  assert.equal(report.status, "FAILED"); assert(report.startedAt && report.finishedAt);
  assert(report.error.includes("strict mode violation") && report.error.includes("resolved to 2 elements"));
  assert.equal(report.cases.length, 2); assert.equal(report.cases[0].status, "PASS");
  assert.equal(report.cases[1].status, "FAILED");
  assert.equal(followup.status, "PASS"); assert(followup.startedAt && followup.finishedAt);
  assert.equal(followup.cases.length, 1); assert.equal(followup.cases[0].status, "PASS");
  assert.equal(report.matrix.length, 12);
  const key = m => JSON.stringify([m.width, m.height, m.dpr, m.reduced]);
  assert.deepEqual(report.matrix.map(key), matrix.map(key));
  for (const cell of report.matrix) {
    assert.equal(cell.status, "PASS"); assert.equal(cell.topics.length, 3);
    assert.deepEqual(cell.topics.map(t => t.topic), topics.map(t => t[0]));
    for (const topic of cell.topics) {
      assert.equal(topic.status, "PASS"); assert(topic.sourcePrefixVerified);
      assert(topic.geometry.hit && topic.geometry.focus && topic.geometry.overflow <= 1);
      const r = topic.geometry.rect;
      assert(r.left >= 0 && r.top >= 0 && r.right <= cell.width + 1 && r.bottom <= cell.height + 1);
      assert.equal(topic.context.access, "read-only"); assert.equal(topic.context.layoutType, "renpy");
      assert.equal(topic.context.screenId, "title"); assert(topic.context.componentId);
      assert(topic.citations.some(c => c.id.startsWith("guide-" + topic.topic + "-") && c.characters > 0));
    }
  }
  assert.equal(report.requests.length, 36); assert.equal(new Set(report.requests.map(r => r.question)).size, 36);
  for (const request of report.requests) {
    assert(request.context_chunks.length > 0);
    assert(!request.keys.some(k => /tool|draft|authorized/i.test(k)));
    assert(!JSON.stringify(request).includes("PRIVATE_STORY_DO_NOT_DISCLOSE_KNOWLEDGE"));
    assert(!JSON.stringify(request).includes("test-only-secret"));
  }
  assert.equal(report.providerRequests.length, 36);
  assert(report.providerRequests.every(r => !r.creation && r.tools.length === 0 && r.finishedAt >= r.startedAt));
  assert.equal(report.blockedModelRequests, 0); assert.equal(report.paidRequests, 0);
  assert.equal(report.productChanges, 0); assert.equal(report.builds, 0); assert.deepEqual(report.errors, []);
  assert.equal(report.launches.length, 2); assert.equal(report.cleanups.length, 2);
  assert(report.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
  assert.equal(report.screenshots.length, 13);
  assert.equal(report.providerCleanup.stopped, true); assert.equal(report.providerCleanup.requests, 36);
  assert.equal(report.cacheRestoration, "PASS");
  assert.equal(report.credentialCleanup, "CLEARED_TEST_ONLY_CONFIGURATION");
  assert.equal(followup.cases[0].detail.additionalRequests, 0);
  assert(followup.cases[0].detail.answerAndCitationsRestored && followup.cases[0].detail.projectUnchanged);
  assert.equal(followup.additionalLaunches, 1); assert.equal(followup.modelRequests, 0);
  assert.equal(followup.blockedModelRequests, 0); assert.equal(followup.cleanups.length, 1);
  assert.equal(followup.cleanups[0].status, "PASS"); assert.equal(followup.screenshots.length, 1);
  assert.equal(followup.cacheRestoration, "PASS"); assert.deepEqual(followup.errors, []);
}
function validateSource(report) {
  assert.equal(report.status, "FAILED");
  assert.equal(report.sources.length, 34); assert(report.chunks > 100);
  assert.equal(report.tests.length, 3);
  assert.deepEqual(report.tests.map(test => test.report.data.cases.length), [3, 18, 4]);
  assert(report.tests.every(test => test.exitCode === 0 && test.report.data.status === "PASS"));
  assert.deepEqual([...report.missingFromTrackedTree].sort(), [
    "GameCli_framework/docs/BUILD_ANDROID.md", "GameCli_framework/docs/BUILD_WINDOWS.md",
    "docs/ASSISTANT_USER_GUIDE.md", "scripts/build-agent-doc-index.cjs",
    "scripts/fixtures/assistant-project-image-proposal.json",
  ].sort());
  assert(report.ignoredDetails.includes("GameCli_framework/docs/BUILD_ANDROID.md"));
  assert(report.ignoredDetails.includes("GameCli_framework/docs/BUILD_WINDOWS.md"));
}
function selfTest(report, source, followup) {
  validateFunctional(report, followup); validateSource(source);
  const mutations = [
    r => { r.status = "RUNNING"; }, r => { r.matrix = []; }, r => { r.matrix.pop(); },
    r => { r.matrix[1] = r.matrix[0]; }, r => { r.requests.pop(); },
    r => { r.providerRequests.pop(); }, r => { r.providerRequests[0].creation = true; },
    r => { r.matrix[0].topics[0].geometry.hit = false; },
    r => { r.matrix[0].topics[0].context.access = "write"; },
    r => { r.cacheRestoration = "NOT_RUN"; }, r => { r.cleanups.pop(); },
    r => { r.screenshots.pop(); }, r => { r.paidRequests = 1; },
    r => { r.error = "other failure"; },
  ];
  for (const mutate of mutations) { const changed = structuredClone(report); mutate(changed); assert.throws(() => validateFunctional(changed, followup)); }
  for (const mutate of [r => { r.status = "FAILED"; }, r => { r.modelRequests = 1; },
    r => { r.cases[0].detail.additionalRequests = 1; }]) {
    const changed = structuredClone(followup); mutate(changed); assert.throws(() => validateFunctional(report, changed));
  }
  for (const mutate of [r => { r.status = "PASS"; }, r => { r.missingFromTrackedTree = []; },
    r => { r.tests[0].report.data.cases = []; }]) {
    const changed = structuredClone(source); mutate(changed); assert.throws(() => validateSource(changed));
  }
  return { malformedFunctionalEvidenceRejected: mutations.length + 3, falseSourceDeliveryPassRejected: 3 };
}
function main() {
  const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
  const sourceFile = path.join(qa, "source-01/report.json"), functionalFile = path.join(qa, "session-" + attempt, "report.json");
  const followupFile = path.join(qa, "session-02/report.json");
  const source = read(sourceFile), functional = read(functionalFile), followup = read(followupFile), cases = [];
  const selfTests = selfTest(functional, source, followup);
  const installed = descriptor();
  function check(name, fn) { const detail = fn(); cases.push({ name, status: "PASS", detail }); }
  check("real-source-and-installed-results-have-distinct-scope-and-status", () => {
    assert.equal(installed.executable.sha256, functional.installation.executable.sha256);
    assert.equal(sha(functionalFile), followup.sourceReport.sha256);
    assert.equal(followup.sourceReport.path, functionalFile);
    assert.equal(followup.installation.executable.sha256, installed.executable.sha256);
    for (const file of [source.generated, source.generator, functional.script, ...read(path.join(checkpoint, "report.json")).products]) {
      assert.equal(sha(file.path), file.sha256);
    }
    for (const test of source.tests) {
      assert.equal(sha(test.report.path), test.report.sha256);
      const actual = read(test.report.path); assert.equal(actual.status, "PASS");
      assert.equal(actual.cases.length, test.report.data.cases.length);
    }
    return { sourceDelivery: "FAILED", sourceCases: 25, installedFunctionality: "PASS", paidModel: "NOT_RUN" };
  });
  check("screenshots-have-real-native-metrics-and-physical-png-size", () => {
    for (const shot of [...functional.screenshots, ...followup.screenshots]) {
      assert.equal(sha(shot.path), shot.sha256);
      const b = fs.readFileSync(shot.path), expected = {
        width: shot.before.width, height: shot.before.height,
        dpr: shot.png.width / shot.before.width, reduced: shot.before.reduced,
      };
      assert([1, 2].includes(expected.dpr)); validateNativeViewport(shot.before, expected);
      assert.deepEqual(shot.before, shot.after);
      assert.equal(b.readUInt32BE(16), expected.width * expected.dpr);
      assert.equal(b.readUInt32BE(20), expected.height * expected.dpr);
    }
    return { pngs: functional.screenshots.length + followup.screenshots.length, physicalMonitorClaim: false };
  });
  check("owned-processes-ports-cache-and-provider-ended", () => {
    const known = new Set([...functional.knownProcesses, ...followup.knownProcesses].map(p => p.ProcessId + ":" + p.Created));
    assert(!rows().some(p => known.has(p.ProcessId + ":" + p.Created)));
    const ports = followup.launches.flatMap(l => l.ports); assert.equal(listeners(ports).length, 0);
    const restoration = read(path.join(qa, "session-" + attempt, "native-cache-restoration.json"));
    assert.equal(restoration.status, "PASS");
    assert.equal(read(path.join(qa, "session-02/native-cache-restoration.json")).status, "PASS");
    return { processIdentities: known.size, ports, restoration: describe(path.join(qa, "session-" + attempt, "native-cache-restoration.json")) };
  });
  check("no-test-only-secret-in-current-isolated-persisted-provider-settings", () => {
    const database = path.join(qa, "session-" + attempt, "data/backend/vn_engine.db");
    const code = "import sqlite3,sys,json\nc=sqlite3.connect('file:'+sys.argv[1].replace(chr(92),'/')+'?mode=ro',uri=True)\nr=list(c.execute(\"select key,value from editor_shared_state where key in ('provider_secrets','provider_connections','provider_models','provider_selections')\"))\nassert r and all('test-only-secret' not in v for k,v in r)\nprint(json.dumps({'checked':len(r),'secretsAbsent':True}))\nc.close()";
    const result = spawnSync("python", ["-c", code, database], { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  });
  check("missing-delivery-inputs-are-rechecked-against-current-git-index", () => {
    const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(tracked.status, 0); const files = new Set(tracked.stdout.split("\0"));
    for (const file of source.missingFromTrackedTree) assert(!files.has(file), file);
    return { missing: source.missingFromTrackedTree, installFailureClaimed: false };
  });
  const out = path.join(qa, "audit-" + attempt); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  const report = { status: "PASS", scope: "EVIDENCE_VALIDATION_WITH_SOURCE_DELIVERY_FAILED_NOT_PRODUCT_ALL_PASS",
    at: new Date().toISOString(), sourceReport: describe(sourceFile), installedReport: describe(functionalFile),
    restartReport: describe(followupFile), originalStatusPreserved: functional.status,
    cases, selfTests, sourceDeliveryStatus: source.status, installedFunctionStatus: "PASS_WITH_SEPARATE_RESTART_EVIDENCE",
    productChanges: 0, builds: 0, paidRequests: 0 };
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: cases.length, selfTests, sourceDelivery: "FAILED",
    installedFunctionality: "PASS", out }));
}
if (require.main === module) { try { main(); } catch (e) { console.error(e); process.exitCode = 1; } }
