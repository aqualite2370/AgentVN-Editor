"use strict";
// Read-only artifact/source verification after a test-only post-build auditor fix.
// No former failure is rewritten, no build or browser test is claimed rerun.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
const sourcePath = path.resolve(process.argv[2] || "");
const previous = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const output = path.join(root, "output/dialog-presentation-gates",
  `${new Date().toISOString().replace(/[:.]/g, "-")}-artifact-final`);
fs.mkdirSync(output, { recursive: true });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { status: "RUNNING", scope: previous.scope, startedAt: new Date().toISOString(),
  priorReport: sourcePath, priorStatus: previous.status, evidenceMode: "read-only post-build audit correction",
  steps: [], limits: ["not installed Release or Android",
    "backend source hash is not packaged backend provenance"] };
try {
  assert.equal(previous.status, "FAILED");
  assert(previous.error.includes("bundle-workspace\\backend\\app\\models\\commands.py"),
    "This finalizer only handles the known backend audit routing error");
  assert.equal(previous.steps.length, 35, "All prerequisite commands must already have completed");
  assert(previous.steps.every(step => step.status === "PASS" && step.exitCode === 0));
  for (const step of previous.steps) {
    if (step.caseCount !== undefined) {
      const evidencePath = step.evidencePaths.at(-1);
      const evidence = JSON.parse(fs.readFileSync(evidencePath.endsWith(".json")
        ? evidencePath : path.join(evidencePath, "report.json"), "utf8"));
      assert.equal(evidence.status, "PASS");
      assert.equal(evidence.cases.length, step.caseCount);
      assert(evidence.cases.every(row => row.status === "PASS"));
    }
    report.steps.push({ ...step, execution: "REFERENCED_UNCHANGED", referencedFrom: sourcePath });
  }
  report.sourceBefore = previous.sourceBefore;
  report.sourceAfter = previous.sourceBefore.map(row => {
    assert.equal(sha(path.join(root, row.file)), row.sha256, `Candidate changed: ${row.file}`);
    return { ...row, unchanged: true };
  });
  report.dev = previous.dev;
  assert(report.dev.overwritten && !report.dev.pending);
  assert.equal(sha(report.dev.path), report.dev.sha256);
  assert.equal(sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")), report.dev.sha256);
  assert(!fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")));
  report.resources = collectStageResourceEvidence(root,
    previous.sourceBefore.map(row => row.file).filter(file => !file.startsWith("scripts/")));
  report.auditFiles = ["scripts/lib/stage-resource-evidence.cjs",
    "scripts/stage-resource-evidence-test.cjs", "scripts/dialog-presentation-finalize-evidence.cjs"]
    .map(file => ({ file, sha256: sha(path.join(root, file)) }));
  report.status = "E4_DIALOGUE_BROWSER_DEV_PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  console.error(report.error);
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(`Evidence: ${output}`);
  console.log(report.status);
}
