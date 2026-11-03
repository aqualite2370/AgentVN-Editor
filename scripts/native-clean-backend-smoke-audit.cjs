"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs");
const path = require("node:path"), crypto = require("node:crypto");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Source-Delivery-20261103-01";
const attempt = process.argv[2] || "02"; assert.match(attempt, /^\d{2}$/);
const auditNumber = process.argv[3] || "01"; assert.match(auditNumber, /^\d{2}$/);
const out = path.join(base, `native-backend-smoke-${attempt}`);
const output = path.join(out, `audit-${auditNumber}.json`);
assert(!fs.existsSync(output));
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const receipt = path.join(out, "report.json"), report = read(receipt);
const result = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
  scope: "READ_ONLY_AUDIT_OF_PACKAGED_BACKEND_HTTP_SQLITE_RESTART_NOT_INSTALLED_EDITOR" };
const check = (name, callback) => { callback(); result.groups.push({ name, status: "PASS" }); };
const file = f => {
  assert.equal(fs.statSync(f.path).size, f.bytes);
  assert.equal(sha(f.path), f.sha256);
};
try {
  check("exact executable and frozen build provenance", () => {
    assert.equal(report.status, "PASS"); assert.equal(report.cleanup, "PASS");
    file(report.executable); file(report.build); file(report.buildAudit);
    const build = read(report.build.path), audit = read(report.buildAudit.path);
    assert.equal(build.status, "PASS"); assert.equal(audit.status, "PASS");
    assert.equal(audit.reportSha256, report.build.sha256);
    assert.equal(report.executable.sha256, build.artifacts.find(a => a.path.endsWith("creator-backend.exe")).sha256);
  });
  check("four nonempty real steps and exact scope", () => {
    assert.equal(report.modelRequests, 0); assert.equal(report.deviceLaunches, 0);
    assert.equal(report.productChanges, 0);
    assert.deepEqual(report.cases.map(c => c.name), [
      "isolated-executable-start-and-owned-http",
      "real-sqlite-project-roundtrip-and-synthetic-secret-boundary",
      "actual-exe-restart-restores-projects-and-secret",
      "erase-synthetic-key-before-final-shutdown",
    ]);
    assert(report.cases.every(c => c.status === "PASS" && c.startedAt && c.finishedAt));
    assert.equal(report.cases[2].result.projectsRestored, 2);
    assert.equal(report.cases[3].result.storedSyntheticKeysRemoved, true);
  });
  check("actual loopback requests and ownership", () => {
    assert.equal(report.launches.length, 2);
    assert.notEqual(report.launches[0].pid, report.launches[1].pid);
    for (const launch of report.launches) {
      assert(launch.created && launch.readyAt);
      assert.equal(launch.listeners.length, 1);
      assert(report.knownProcesses.some(p => p.ProcessId === launch.listeners[0].OwningProcess
        && path.resolve(p.ExecutablePath) === path.resolve(report.executable.path)));
    }
    assert.deepEqual(report.http.map(h => [h.method, h.route]), [
      ["GET", "/api/health"], ["GET", "/api/project/catalog"],
      ["PUT", "/api/project/projects/qa-clean-agentvn"],
      ["PUT", "/api/project/projects/qa-clean-renpy"],
      ["POST", "/api/project/state"], ["GET", "/api/providers/secrets"],
      ["GET", "/api/project/catalog"],
      ["GET", "/api/project/projects/qa-clean-agentvn"],
      ["GET", "/api/project/projects/qa-clean-renpy"],
      ["GET", "/api/project/state?include_project=false&include_recent_projects=false"],
      ["GET", "/api/project/state"], ["GET", "/api/providers/secrets"],
      ["POST", "/api/project/state"], ["GET", "/api/providers/secrets"],
    ]);
    assert(report.http.every(h => h.status === 200 &&
      (h.route === "/api/health" || h.route === "/api/providers/secrets" || h.route.startsWith("/api/project/"))));
    assert.equal(report.http.filter(h => h.method === "PUT").length, 2);
    assert(report.http.some(h => h.route === "/api/project/state" && h.method === "GET"));
    assert(report.http.some(h => h.route.includes("include_project=false")));
  });
  check("physical SQLite and no false normal-close claim", () => {
    file(report.databaseArtifact);
    assert.deepEqual(report.databaseCheck, { integrity: "ok", projects: 2 });
    assert.equal(report.cleanups.length, 2);
    for (const cleanup of report.cleanups) {
      assert.equal(cleanup.normalExitClaimed, false);
      assert(cleanup.killed.length > 0);
      assert.deepEqual(cleanup.survivors, []); assert.deepEqual(cleanup.listeners, []);
    }
  });
  check("actual terminal processes and ports; prior failure retained", () => {
    const current = rows();
    assert(!report.knownProcesses.some(p => current.some(n =>
      p.ProcessId === n.ProcessId && p.Created === n.Created)));
    assert.deepEqual(listeners(report.launches.map(l => l.port)), []);
    const prior = read(path.join(base, "native-backend-smoke-01", "report.json"));
    assert.equal(prior.status, "FAILED"); assert.equal(prior.cleanup, "PASS");
  });
  result.status = "PASS"; result.reportSha256 = sha(receipt);
} catch (error) {
  result.status = "FAILED"; result.error = String(error.stack || error); process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify(result));
}
