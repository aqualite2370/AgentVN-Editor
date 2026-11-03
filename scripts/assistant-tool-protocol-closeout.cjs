"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/assistant-tool-protocol-20261019-01");
const checkpoint = "F:/AgentVN/Checkpoints/Assistant-Tool-Protocol-20261019-01";
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const load = file => JSON.parse(fs.readFileSync(file, "utf8"));
const artifact = file => ({
  path: path.resolve(file), sha256: sha(file),
  bytes: fs.statSync(file).size, modifiedAt: fs.statSync(file).mtime.toISOString(),
});
function junit(name, expectedTests, expectedFailures) {
  const file = path.join(output, name);
  const xml = fs.readFileSync(file, "utf8");
  const attributes = xml.match(/<testsuite\s[^>]*>/)?.[0];
  assert(attributes, "JUnit suite must exist");
  const number = key => Number(attributes.match(new RegExp(`\\b${key}="(\\d+)"`))?.[1]);
  assert.equal(number("tests"), expectedTests);
  assert.equal(number("failures"), expectedFailures);
  assert.equal(number("errors"), 0);
  assert.equal(number("skipped"), 0);
  return { ...artifact(file), tests: expectedTests, failures: expectedFailures };
}
function browserReport(folder, expectedCases) {
  const parent = path.join(output, folder);
  const runs = fs.readdirSync(parent).filter(name =>
    fs.existsSync(path.join(parent, name, "report.json")));
  assert.equal(runs.length, 1, "Require exactly this run's terminal report, not a convenient old PASS");
  const file = path.join(parent, runs[0], "report.json");
  const report = load(file);
  assert.equal(report.status, "PASS", report.error);
  assert.equal(report.cases.length, expectedCases);
  assert(report.cases.every(item => item.status === "PASS"));
  const cleanup = report.cleanup ?? report.creationApiCleanup;
  assert.equal(cleanup.code, 0);
  assert.equal(cleanup.apiStopped, true);
  if (expectedCases === 13) {
    const matrix = report.cases.filter(item => item.width !== undefined);
    assert.equal(matrix.length, 12);
    assert.equal(new Set(matrix.map(item =>
      `${item.width}x${item.height}/${item.dpr}/${item.motion}`)).size, 12);
    assert.deepEqual([...new Set(matrix.map(item => item.width))].sort((a, b) => a - b), [1920, 2560, 3840]);
    assert.deepEqual([...new Set(matrix.map(item => item.dpr))].sort(), [1, 2]);
    assert.deepEqual([...new Set(matrix.map(item => item.motion))].sort(), ["no-preference", "reduce"]);
    assert.equal(cleanup.modelRequestCount, 78);
  }
  const service = report.service ?? {};
  const pids = [service.pid, service.vitePid, report.creationApi?.pid, report.creationApi?.modelHostPid]
    .filter(Number.isInteger);
  for (const pid of pids) {
    let alive = false;
    try { process.kill(pid, 0); alive = true; }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    assert(!alive, `Test-owned PID still present: ${pid}; inspect without killing unrelated processes`);
  }
  return {
    ...artifact(file), cases: report.cases.length, scope: report.scope,
    modelBoundary: "controlled-loopback-only", cleanup,
    servicePidsAbsent: pids, sidecarSha256: report.sidecarSha256,
  };
}
const baseline = load(path.join(checkpoint, "manifest.json"));
const installed = artifact(baseline.installedEditor.path);
assert.equal(installed.sha256, baseline.installedEditor.sha256, "Frozen installed candidate must be unchanged");
assert.equal(sha(path.join(checkpoint, "AgentVN-Dev-before.exe")), baseline.dev.sha256);
const dev = artifact(path.join(root, "AgentVN Dev.exe"));
const debug = artifact(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
assert.equal(dev.sha256, debug.sha256, "Root Dev must match the actual compiled executable");
const devLog = path.join(output, "dev-build.log");
assert.match(fs.readFileSync(devLog, "utf8"), /\[AgentVN\] Dev container built:/,
  "A pending replacement or frontend-only build is not a completed Dev overwrite");
assert(fs.statSync(dev.path).mtimeMs >= Date.parse(baseline.at), "Dev must have actually been overwritten after the checkpoint");
const sourceTools = browserReport("browser/agent-tools", 13);
const elementEdits = browserReport("browser/assistant-creation-element-edit", 5);
const packagedTools = browserReport("packaged-browser/agent-tools", 13);
const sidecar = artifact(path.join(root, "editor/src-tauri/binaries/creator-backend.exe"));
assert.equal(packagedTools.sidecarSha256, sidecar.sha256);
assert.equal(sidecar.sha256, sha(path.join(root, "backend/dist/creator-backend.exe")));
const commands = [
  "python -m pytest tests/test_assistant_agent_tool_protocol.py -q --junitxml=D:/AgentVN/output/assistant-tool-protocol-20261019-01/red.xml",
  "python -m pytest tests/test_assistant_agent_tool_protocol.py tests/test_assistant_creation_agent.py tests/test_assistant_creation_transport.py tests/test_assistant_creation_authorization.py tests/test_assistant_creation_api.py tests/test_assistant_creation_process_api.py tests/test_assistant_creation_queue.py tests/test_provider_structured_modes.py -q --junitxml=D:/AgentVN/output/assistant-tool-protocol-20261019-01/green.xml",
  "python -m pytest tests/test_assistant_agent_tool_protocol.py tests/test_assistant_creation_agent.py -q --junitxml=D:/AgentVN/output/assistant-tool-protocol-20261019-01/fixture-contract.xml",
  "node scripts/assistant-agent-tools-playwright.cjs (source API; isolated harness; full 12 combinations + reload)",
  "ASSISTANT_CREATION_REAL_BACKEND=1 node scripts/assistant-creation-element-edit-playwright.cjs",
  "npm --prefix D:/AgentVN/editor run typecheck",
  "npm --prefix D:/AgentVN/editor run build",
  "npm --prefix D:/AgentVN/GameCli_framework run build",
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:/AgentVN/scripts/build-backend-sidecar.ps1 -KeepPyInstallerArtifacts",
  "ASSISTANT_AGENT_PACKAGED_SIDECAR=1 node scripts/assistant-agent-tools-playwright.cjs",
  ...["element-edit", "resource-authorization", "project-merge", "project-store", "process-queue", "recovery"]
    .map(name => `node scripts/assistant-creation-${name}-test.cjs`),
  "node scripts/editor-workspace-contract.cjs",
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:/AgentVN/scripts/build-dev-launcher.ps1",
  "node scripts/assistant-tool-protocol-closeout.cjs",
];
const receipt = {
  createdAt: new Date().toISOString(),
  status: "SCOPED_SOURCE_AND_PACKAGED_PASS",
  notOverallAcceptance: true,
  paidModelRequests: 0,
  originalPaidResponseBodiesAvailable: false,
  originalPaidFailureExactCause: "UNPROVEN; do not infer the original response call count",
  reproducedDefect: "auto permits text-only responses while the executor requires one native tool call",
  repair: "required native call, model-selected tool; fail closed with bounded count/step diagnostics; no text JSON fallback or retries",
  checkpoint,
  tests: {
    red: junit("red.xml", 8, 6),
    backend: junit("green.xml", 108, 0),
    hardenedFixture: junit("fixture-contract.xml", 13, 0),
    sourceTools, elementEdits, packagedTools,
  },
  products: { dev, debug, sidecar, frozenInstalledEditorUnchanged: installed },
  preservedArtifacts: [
    artifact(path.join(checkpoint, "AgentVN-Dev-before.exe")),
    artifact(path.join(checkpoint, "creator-backend-before.exe")),
  ],
  sources: [
    "backend/app/ai/provider.py", "backend/tests/test_assistant_agent_tool_protocol.py",
    "backend/tests/test_assistant_creation_agent.py",
  ].map(file => artifact(path.join(root, file))),
  commands,
  limitations: [
    "No real-model retry; G01 real installed model-to-merge/reopen/export remains FAILED/NOT_RUN as originally reported.",
    "Browser harnesses are source frontend + source API / new packaged backend, NOT an updated installed Editor or Computer Use.",
    "No Release rebuild, installation, Android, standalone Windows, or final user-project acceptance in this slice.",
    "No Editor or Runtime animation code modified.",
  ],
  warnings: [
    "Existing Starlette/httpx deprecation in pytest.",
    "Existing editor Vite mixed dynamic/static import and large chunk warnings.",
    "Build reported npm audit: 1 moderate and 3 high vulnerabilities; no automatic dependency rewrites performed.",
    "Backend build reported existing invalid ~orch distribution; build completed successfully.",
  ],
};
fs.writeFileSync(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({
  status: receipt.status, backendTests: 108, browserCases: 31,
  devSha256: dev.sha256, sidecarSha256: sidecar.sha256,
  frozenInstalledUnchanged: true, paidModelRequests: 0,
}));
