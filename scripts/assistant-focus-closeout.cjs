"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."), output = path.join(root, "output/assistant-focus-20261019-01");
const checkpoint = "F:/AgentVN/Checkpoints/Assistant-Focus-20261019-01";
const load = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const artifact = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString(), sha256: sha(file) });
function absent(pid) {
  assert(Number.isInteger(pid));
  let alive = false;
  try { process.kill(pid, 0); alive = true; }
  catch (error) { if (error.code !== "ESRCH") throw error; }
  assert(!alive, `Recorded service PID ${pid} exists; inspect ownership without killing unrelated processes`);
}
const evidence = {};
for (const folder of ["red", "green"]) {
  const file = path.join(output, folder, "report.json"), report = load(file);
  const expected = folder === "red" ? "FAILED" : "PASS";
  assert.equal(report.status, expected);
  assert.equal(report.cases.length, 12);
  assert.equal(report.cases.flatMap(item => item.checks).length, 24);
  assert(report.cases.every(item => item.status === expected
    && item.checks.every(check => check.status === expected)));
  assert.equal(report.modelSubmissions, 0);
  const expectedMatrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
    ["no-preference", "reduce"].map(motion => `${width}/${dpr}/${motion}`))).sort();
  assert.deepEqual(report.cases.map(item => `${item.width}/${item.dpr}/${item.motion}`).sort(), expectedMatrix);
  for (const item of report.cases) {
    assert.deepEqual(item.openFocus.viewport, { width: item.width, height: item.height,
      dpr: item.dpr, reduced: item.motion === "reduce" });
    const png = fs.readFileSync(item.screenshot.path);
    assert.equal(png.readUInt32BE(16), item.width * item.dpr);
    assert.equal(png.readUInt32BE(20), item.height * item.dpr);
    assert.equal(sha(item.screenshot.path), item.screenshot.sha256);
    if (folder === "green") {
      assert(item.openFrames.length > 0 && item.openFrames.every(frame => frame.inside));
      assert(item.closeFocus.meaningful && !item.closeFocus.inside);
    }
  }
  if (folder === "green") assert.equal(report.cases[0].nonmodalMinimizeAndCloseInterruption, "PASS");
  absent(report.service.backendPid);
  absent(report.service.frontendPid);
  evidence[folder] = { ...artifact(file), displayCases: 12, focusChecks: 24,
    frames: report.cases.reduce((sum, item) => sum + (item.openFrames?.length ?? 0), 0) };
}
const baseline = load(path.join(checkpoint, "manifest.json"));
const unchangedCss = "editor/src/components/assistant/assistant-creation-workbench.css";
assert.equal(sha(path.join(root, unchangedCss)), baseline.entries.find(item => item.relative === unchangedCss).sha256);
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
const receipt = { createdAt: new Date().toISOString(), status: "SCOPED_SOURCE_FOCUS_PASS_AND_DEV_OVERWRITTEN",
  notOverallAcceptance: true, modelSubmissions: 0, checkpoint, evidence,
  products: { dev, debug, backend, frozenInstalledUnchanged: frozen },
  sources: ["editor/src/components/assistant/AssistantCreationWorkbenchWindow.tsx",
    "editor/src/components/editor/EditorToolbar.tsx", unchangedCss].map(file => artifact(path.join(root, file))),
  logs: ["editor-workspace-contract.cjs.log", "assistant-creation-recovery-test.cjs.log",
    "assistant-creation-process-queue-test.cjs.log", "assistant-creation-element-edit-test.cjs.log",
    "editor-typecheck.log", "editor-build.log", "gamecli-build.log", "dev-build.log"]
    .map(file => artifact(path.join(output, file))),
  limitations: [
    "Chromium source browser with isolated backend; not updated installed Release, Computer Use or real-model acceptance.",
    "Open/close focus, nonmodal background access, minimize/restore and exit cleanup only; not all G03 functionality.",
    "Automatic recovery skips autofocus by implementation; recovery-driven focus behavior was not reproduced end-to-end here.",
    "No Editor/Runtime animation curve or duration changes; original workbench CSS SHA unchanged.",
    "Historical installed 18-group result remains unchanged; no Windows/Android or final-project acceptance.",
  ] };
assert(!fs.existsSync(path.join(output, "receipt.json")), "Preserve terminal receipts");
fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ status: receipt.status, checks: 24, modelSubmissions: 0,
  devSha256: dev.sha256, frozenInstalledUnchanged: true }));
