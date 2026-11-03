"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/novel-entry-20261019-01");
const checkpoint = "F:/AgentVN/Checkpoints/Novel-Entry-20261019-01";
const load = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const artifact = file => ({
  path: path.resolve(file), sha256: sha(file),
  bytes: fs.statSync(file).size, modifiedAt: fs.statSync(file).mtime.toISOString(),
});
const baseline = load(path.join(checkpoint, "manifest.json"));
const evidence = {};
for (const [folder, passes, failures] of [
  ["red", 0, 12], ["green", 8, 4], ["green-02", 8, 4], ["green-03", 12, 0],
]) {
  const file = path.join(output, folder, "report.json"), report = load(file);
  assert.equal(report.cases.length, 12);
  assert.equal(report.cases.filter(item => item.status === "PASS").length, passes);
  assert.equal(report.cases.filter(item => item.status === "FAILED").length, failures);
  assert.equal(report.status, failures ? "FAILED" : "PASS");
  assert.equal(report.modelSubmissions, 0);
  assert.equal(new Set(report.cases.map(item =>
    `${item.width}x${item.height}/${item.dpr}/${item.motion}`)).size, 12);
  if (!failures) {
    for (const item of report.cases) {
      assert(item.entry.hit && !item.entry.hidden.length);
      assert.equal(item.entry.actualDpr, item.dpr);
      assert.equal(item.entry.actualReduced, item.motion === "reduce");
      const png = fs.readFileSync(item.screenshot.path);
      assert.equal(png.readUInt32BE(16), item.width * item.dpr);
      assert.equal(png.readUInt32BE(20), item.height * item.dpr);
      assert.equal(sha(item.screenshot.path), item.screenshot.sha256);
    }
  }
  for (const pid of [report.service.backendPid, report.service.frontendPid]) {
    assert(Number.isInteger(pid));
    let alive = false;
    try { process.kill(pid, 0); alive = true; }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    assert(!alive, `Recorded service PID ${pid} exists; inspect ownership, do not kill blindly`);
  }
  evidence[folder] = { ...artifact(file), passes, failures, recordedServicePidsAbsent: true };
}
const workspacePath = path.join(output, "workspace/report.json"), workspace = load(workspacePath);
assert.equal(workspace.ok, true);
assert.equal(workspace.viewports.length, 3);
assert.deepEqual(workspace.viewports.map(item => item.viewport.width).sort((a, b) => a - b),
  [1920, 2560, 3840]);
const dev = artifact(path.join(root, "AgentVN Dev.exe"));
const debug = artifact(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
assert.equal(dev.sha256, debug.sha256);
assert.notEqual(dev.sha256, baseline.devSha256);
assert(fs.statSync(dev.path).mtimeMs > Date.parse(baseline.createdAt));
assert.equal(sha(path.join(checkpoint, "AgentVN-Dev-before.exe")), baseline.devSha256);
assert.match(fs.readFileSync(path.join(output, "dev-build.log"), "utf8"),
  /\[AgentVN\] Dev container built:/);
const installed = artifact("F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-editor.exe");
assert.equal(installed.sha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
const backend = artifact(path.join(root, "editor/src-tauri/binaries/creator-backend.exe"));
assert.equal(backend.sha256, "920dc21854eefadfa62f3ffe1fd545e7bfa58dee99e7b982b4836e44a42912e0");
const receipt = {
  createdAt: new Date().toISOString(), status: "SCOPED_SOURCE_PASS_AND_DEV_OVERWRITTEN",
  notOverallAcceptance: true, modelSubmissions: 0, checkpoint, evidence,
  associatedWorkspace: { ...artifact(workspacePath), cases: 3,
    limitation: "Precedes final novel-panel CSS correction; final panel geometry covered by green-03" },
  products: { dev, debug, backend, frozenInstalledEditorUnchanged: installed },
  sources: ["editor/src/components/editor/EditorToolbar.tsx", "editor/src/styles/editor-topbar.css"]
    .map(file => artifact(path.join(root, file))),
  logs: ["workspace-contract.log", "novel-append-contract.log", "workspace-execution.log",
    "editor-typecheck.log", "editor-build.log", "gamecli-build.log", "dev-build.log"]
    .map(file => artifact(path.join(output, file))),
  limitations: [
    "Source Chromium and isolated backend; not installed Release, Computer Use or paid-model acceptance.",
    "Local TXT preflight only; no model parsing, graph import, export, Windows or Android acceptance.",
    "Post-cancel processing 0/1 card observed in screenshot: pending reproduction; not claimed resolved.",
    "No Editor or Runtime motion curves changed.",
    "Historical 18-group installed assessment remains unchanged.",
  ],
};
assert(!fs.existsSync(path.join(output, "receipt.json")), "Do not overwrite terminal receipt");
fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ status: receipt.status, browserCases: 12,
  devSha256: dev.sha256, frozenInstalledUnchanged: true, modelSubmissions: 0 }));
