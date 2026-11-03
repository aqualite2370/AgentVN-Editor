"use strict";
// Validate usable reload evidence without laundering the unreached race into a
// PASS. Raw FAILED reports, including the first comparator failure, stay intact.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Preview-1.9.35-20261102-01";
const out = path.join(qa, "reload-audit-01");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
function validate(report) {
  assert.equal(report.status, "FAILED");
  assert(report.finishedAt && report.startedAt);
  assert.equal(report.cases.length, 3);
  assert.deepEqual(report.cases.map(c => c.status), ["PASS", "PASS", "FAILED"]);
  const reloads = report.cases[1].detail;
  assert.equal(reloads.length, 3);
  assert.deepEqual(reloads.map(r => r.projectId), [
    "qa-current-preview-reload-1935-A", "qa-current-preview-reload-1935-B", "qa-current-preview-reload-1935-A",
  ]);
  for (const r of reloads) {
    const letter = r.projectId.at(-1); assert.deepEqual(r.nodeIds, ["scene-" + letter, "start"]);
    assert.equal(r.savedBytesEquivalent, true);
  }
  assert.match(report.cases[2].error, /locator.waitFor: Timeout 30000ms/);
  assert.match(report.cases[2].error, /project-home/);
  assert(report.failureText.includes("1.9.35预览工程重载_A"));
  assert(report.failureText.includes("后端请求超过 20 秒仍未完成"));
  assert(!report.failureText.includes("1.9.35预览工程重载_B"));
  assert.equal(report.cleanupVerified, true); assert.equal(report.launches.length, 1);
  assert.equal(report.cleanups.length, 1); assert.equal(report.cleanups[0].status, "PASS");
  assert.equal(report.productChanges, 0); assert.equal(report.builds, 0); assert.equal(report.modelRequests, 0);
  assert.deepEqual(report.errors, []); assert.equal(report.blockedModelRequests || 0, 0);
  assert.equal(report.screenshots.length, 4);
  assert.deepEqual(report.cache.map(c => [c.action, c.exitCode]), [["SelfTest", 0], ["Prepare", 0], ["Restore", 0]]);
}
function main() {
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const file = path.join(qa, "session-02/report.json"), r = read(file);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(file), cases: [],
    productChanges: 0, productStarts: 0, builds: 0, modelRequests: 0,
    ordinaryReloadStatus: "PASS", lateCrossProjectResponseStatus: "BLOCKED",
    blocker: "UI blocks home navigation while preview reload is busy; B was never entered. No late-response PASS.",
    scope: "EVIDENCE_AUDIT_NOT_AN_AGGREGATE_PRODUCT_PASS" };
  const check = (name, fn) => {
    const row = { name, status: "RUNNING" }; report.cases.push(row);
    try { row.detail = fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; throw e; }
  };
  try {
    check("Raw partial outcome, A-B-A data checks and unreached race remain distinct", () => {
      validate(r); const previousFile = path.join(qa, "session-01/report.json"), previous = read(previousFile);
      assert.equal(previous.status, "FAILED"); assert(previous.error.includes("measured"));
      assert(previous.error.includes("loadingAnimation")); assert.equal(previous.cleanupVerified, true);
      report.previous = desc(previousFile);
      const mutations = [x => { x.status = "PASS"; }, x => { x.cases[1].detail.pop(); },
        x => { x.cases[1].detail[1].nodeIds = ["scene-A", "start"]; },
        x => { x.cases[2].status = "PASS"; }, x => { x.cleanupVerified = false; }];
      for (const mutate of mutations) { const changed = structuredClone(r); mutate(changed); assert.throws(() => validate(changed)); }
      return { reloads: 3, crossProjectRaceProven: false, falseClaimsRejected: mutations.length };
    });
    check("Exact frozen candidate and four no-side-effect screenshots", () => {
      const installed = descriptor();
      assert.equal(r.launches[0].executable.sha256, installed.executable.sha256);
      assert.equal(r.launches[0].backend.sha256,
        installed.resources.find(p => path.basename(p.path) === "creator-backend.exe").sha256);
      assert.equal(sha(path.join(qa, "session-02/executed-test.cjs")), r.tools[0].sha256);
      for (const screenshot of r.screenshots) {
        assert.equal(sha(screenshot.path), screenshot.sha256); assert.deepEqual(screenshot.before, screenshot.after);
        validateNativeViewport(screenshot.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
        const png = fs.readFileSync(screenshot.path);
        assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
      }
      return { editor: installed.executable, screenshots: 4, viewport: "1920x1080/DPR1/ordinary only" };
    });
    check("Both raw sessions cleaned owned resources and restored environment cache", () => {
      const values = [read(path.join(qa, "session-01/report.json")), r];
      const known = values.flatMap(v => v.knownProcesses);
      const ids = new Set(known.map(p => `${p.ProcessId}:${p.Created}`));
      assert(!rows().some(p => ids.has(`${p.ProcessId}:${p.Created}`)));
      const ports = values.flatMap(v => v.launches.flatMap(l => l.ports)); assert.deepEqual(listeners(ports), []);
      for (const [i, v] of values.entries()) {
        assert(v.cleanupVerified);
        const restore = read(path.join(qa, `session-0${i + 1}/native-cache-restoration.json`));
        assert.equal(restore.status, "PASS"); assert.equal(restore.deletedUserFiles, 0);
        for (const product of v.products) assert.equal(sha(product.path), product.sha256);
      }
      return { identities: ids.size, ports, cacheRestorations: 2, deletedUserFiles: 0 };
    });
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, ordinaryReloadStatus: report.ordinaryReloadStatus,
      lateCrossProjectResponseStatus: report.lateCrossProjectResponseStatus, out, error: report.error }));
  }
}
if (require.main === module) main();
