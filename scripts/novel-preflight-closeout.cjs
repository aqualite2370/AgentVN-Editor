"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/novel-preflight-20261019-01");
const checkpoint = "F:/AgentVN/Checkpoints/Novel-Preflight-20261019-01";
const load = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const artifact = file => ({ path: path.resolve(file), sha256: sha(file),
  bytes: fs.statSync(file).size, modifiedAt: fs.statSync(file).mtime.toISOString() });
function absent(pid) {
  assert(Number.isInteger(pid));
  let alive = false;
  try { process.kill(pid, 0); alive = true; }
  catch (error) { if (error.code !== "ESRCH") throw error; }
  assert(!alive, `Recorded PID ${pid} exists; inspect ownership without killing unrelated processes`);
}
const evidence = {};
for (const folder of ["red", "green", "green-02"]) {
  const file = path.join(output, folder, "report.json"), report = load(file);
  assert.equal(report.status, folder === "red" ? "FAILED" : "PASS");
  assert.equal(report.cases.length, 12);
  assert(report.cases.every(item => item.status === (folder === "red" ? "FAILED" : "PASS")));
  assert.equal(report.modelSubmissions, 0);
  assert.equal(new Set(report.cases.map(item =>
    `${item.width}x${item.height}/${item.dpr}/${item.motion}`)).size, 12);
  if (folder === "green-02") {
    for (const item of report.cases) {
      for (const phase of ["preflight", "cancelled", "reopened"]) {
        const state = item[phase];
        assert.equal(state.cards, 0);
        assert.equal(state.snapshots.length, 0);
        assert.deepEqual(state.viewport, { width: item.width, height: item.height,
          dpr: item.dpr, reduced: item.motion === "reduce" });
      }
      const png = fs.readFileSync(item.screenshot.path);
      assert.equal(png.readUInt32BE(16), item.width * item.dpr);
      assert.equal(png.readUInt32BE(20), item.height * item.dpr);
      assert.equal(sha(item.screenshot.path), item.screenshot.sha256);
    }
    assert.equal(report.cases[0].oldLocalRecovery.cards, 0);
    assert.equal(report.cases[0].existingTaskAfterCancel.cards, 1);
    assert.equal(report.cases[0].existingTaskAfterCancel.snapshots[0].value.job.jobId,
      "preflight-preserved-api-task");
  }
  absent(report.service.backendPid);
  absent(report.service.frontendPid);
  evidence[folder] = artifact(file);
}
const controllerFile = path.join(output, "controller/report.json"), controller = load(controllerFile);
assert.equal(controller.status, "PASS");
assert.equal(controller.cases.length, 3);
assert(controller.cases.every(item => item.status === "PASS"));
absent(controller.isolation.backendPid);
absent(controller.owner.pid);
evidence.controller = { ...artifact(controllerFile),
  actualViewport: "1920x1080 DPR1 normal; branch does not execute its advertised full matrix" };
for (const [name, failures] of [["adapter-red-02.log", 4], ["adapter-green.log", 0]]) {
  const lines = fs.readFileSync(path.join(output, name), "utf8").trim().split(/\r?\n/);
  const result = JSON.parse(lines.at(-1));
  assert.equal(result.tests, 10);
  assert.equal(result.failed, failures);
}
const baseline = load(path.join(checkpoint, "manifest.json"));
const dev = artifact(path.join(root, "AgentVN Dev.exe"));
const debug = artifact(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
assert.equal(dev.sha256, debug.sha256);
assert(fs.statSync(dev.path).mtimeMs > Date.parse(baseline.createdAt));
assert.equal(sha(path.join(checkpoint, "AgentVN-Dev-before.exe")), baseline.devSha256);
assert.match(fs.readFileSync(path.join(output, "dev-build.log"), "utf8"), /\[AgentVN\] Dev container built:/);
const frozen = artifact("F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-editor.exe");
assert.equal(frozen.sha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
const backend = artifact(path.join(root, "editor/src-tauri/binaries/creator-backend.exe"));
assert.equal(backend.sha256, "920dc21854eefadfa62f3ffe1fd545e7bfa58dee99e7b982b4836e44a42912e0");
const receipt = { createdAt: new Date().toISOString(),
  status: "SCOPED_LOCAL_PREFLIGHT_PASS_AND_DEV_OVERWRITTEN", notOverallAcceptance: true,
  modelSubmissions: 0, checkpoint, evidence, products: { dev, debug, backend, frozenInstalledUnchanged: frozen },
  source: artifact(path.join(root, "editor/src/novel-import/novelProcessJobAdapter.ts")),
  logs: ["adapter-red.log", "adapter-red-02.log", "adapter-green.log",
    "novel-processing-core-test.cjs.log", "novel-import-preflight-choice-contract.cjs.log",
    "novel-import-append-graph-contract-test.cjs.log", "editor-workspace-contract.cjs.log",
    "editor-typecheck.log", "editor-build.log", "gamecli-build.log", "dev-build.log"]
    .map(file => artifact(path.join(output, file))),
  limitations: [
    "Controlled cache/API fixtures and local files; no real-model, installed Release or device acceptance.",
    "First adapter red log includes undefined-vs-JSON test-harness mismatch; red-02 is the valid 4-failure product baseline.",
    "No Editor/Runtime motion token or curve changes; no final user-project operations.",
    "Historical installed 18-group verdict is not rewritten by source and Dev fixes.",
  ] };
assert(!fs.existsSync(path.join(output, "receipt.json")), "Do not overwrite terminal receipt");
fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ status: receipt.status, devSha256: dev.sha256,
  modelSubmissions: 0, browserCases: 12, unitCases: 10, controllerCases: 3 }));
