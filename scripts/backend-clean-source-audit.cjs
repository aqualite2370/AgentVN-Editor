"use strict";
// Read-only audit of an existing run; never executes tests or installs packages.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const base = "F:/AgentVN/QA/Source-Delivery-20261103-01";
const number = process.argv[2] || "04";
assert.match(number, /^\d{2}$/);
const run = path.join(base, `backend-clean-${number}`);
const output = path.join(run, "audit-01.json");
assert(!fs.existsSync(output), "Do not overwrite audit evidence");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const checks = [];
function check(name, body) { body(); checks.push({ name, status: "PASS" }); }
function artifact(row) {
  assert.equal(fs.statSync(row.path).size, row.bytes);
  assert.equal(sha(row.path), row.sha256, row.path);
}
const result = { status: "RUNNING", startedAt: new Date().toISOString(), checks,
  scope: "Existing backend source test evidence only; no installation/native build claim" };
try {
  const report = read(path.join(run, "report.json"));
  check("terminal report and subprocess", () => {
    assert.equal(report.status, "PASS");
    assert.equal(report.cleanup, "PASS");
    assert.equal(report.sourceBytesPreserved, true);
    assert.equal(report.commands.length, 1);
    const command = report.commands[0];
    assert.equal(command.name, "backend-tests");
    assert.equal(command.status, "PASS");
    assert.equal(command.exitCode, 0);
    assert(Date.parse(command.finishedAt) > Date.parse(command.startedAt));
    artifact(command.log);
    assert.match(fs.readFileSync(command.log.path, "utf8"), /203 passed in [\d.]+s/);
    for (const field of ["productChanges", "modelRequests", "deviceLaunches",
      "releasesBuilt", "commits", "pushes"]) assert.equal(report[field], 0);
  });
  check("203 nonempty actual cases, no failure/error/skip", () => {
    assert.equal(report.tests.count, 203);
    artifact(report.tests.junit);
    const xml = fs.readFileSync(report.tests.junit.path, "utf8");
    assert.equal([...xml.matchAll(/<testcase\b/g)].length, 203);
    assert(!/<(?:failure|error|skipped)\b/.test(xml));
    for (const name of [
      "test_stream_mcp_tools_mode_falls_back_when_provider_rejects_tool_choice",
      "test_stream_tools_mode_does_not_fall_back_when_tool_request_times_out",
      "test_stream_mcp_auto_mode_rejects_plain_text_when_model_skips_required_tool",
    ]) assert(xml.includes(`name="${name}"`));
  });
  check("isolation self-checks and no unexpected blocked operation", () => {
    artifact(report.boundary); artifact(report.guard);
    const boundary = read(report.boundary.path);
    assert.equal(boundary.status, "PASS");
    assert.equal(boundary.pytestExitCode, 0);
    assert.equal(boundary.externalConnectionsAllowed, false);
    assert.equal(boundary.loopbackConnectionsAllowed, true);
    assert.equal(boundary.selfChecks.length, 5);
    assert(boundary.selfChecks.every(c => c.status === "PASS"));
    assert.deepEqual(boundary.blockedUnexpectedOperations, []);
    assert.equal(boundary.platformMetadataProbe.cache.misses, 1);
    assert(boundary.platformMetadataProbe.cache.hits > 0);
  });
  check("clean dependency provenance", () => {
    const prior = read(report.reusedCleanEnvironment.receipt.path);
    artifact(report.reusedCleanEnvironment.receipt);
    artifact(report.pythonEnvironment);
    assert.equal(prior.cleanup, "PASS");
    for (const name of ["create-venv", "fresh-install", "dependency-check", "dependency-versions"]) {
      const command = prior.commands.find(c => c.name === name);
      assert.equal(command.status, "PASS"); assert.equal(command.exitCode, 0);
      artifact(command.log);
    }
    assert.match(fs.readFileSync(report.pythonEnvironment.path, "utf8"),
      /include-system-site-packages = false/);
  });
  check("107 archived files; only three explicit test overlays", () => {
    artifact(report.sourceReceipt); artifact(report.archive);
    assert.equal(report.files.length, 107);
    assert.deepEqual(report.testOverlays.map(f => f.relative).sort(), [
      "backend/tests/test_api.py", "backend/tests/test_novel_process_service.py",
      "backend/tests/test_provider_structured_modes.py",
    ]);
    const frozen = path.join(base, "snapshot-02", "source");
    for (const file of report.files) {
      assert.equal(sha(path.join(frozen, file.relative)), file.archivedSha256);
      assert.equal(sha(path.join(run, "source", file.relative)), file.sha256);
      assert.equal(sha(path.join(__dirname, "..", file.relative)), file.sha256);
      if (!report.testOverlays.some(f => f.relative === file.relative))
        assert.equal(file.sha256, file.archivedSha256);
    }
  });
  check("prior failures retained", () => {
    for (const priorNumber of ["01", "02", "03"])
      assert.equal(read(path.join(base, `backend-clean-${priorNumber}`, "report.json")).status, "FAILED");
    const previous = read(path.join(base, "backend-clean-03", "test-boundary.json"));
    assert.equal(previous.blockedUnexpectedOperations.length, 9);
  });
  result.status = "PASS";
  result.reportSha256 = sha(path.join(run, "report.json"));
} catch (error) {
  result.status = "FAILED"; result.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify(result));
}
