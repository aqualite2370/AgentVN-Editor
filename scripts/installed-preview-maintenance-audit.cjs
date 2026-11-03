"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const root = path.resolve(__dirname, "..");
const run = path.join(root, "output/installed-preview-20261018-01");
const destination = process.argv[2];
assert(destination && !fs.existsSync(destination));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { status: "RUNNING", evidenceStatus: "RUNNING", productStatus: "FAILED",
  defect: "HOST-03_SHARED_BACKEND_RELOAD_IMPORTS_PREVIOUS_PROJECT_GRAPH_UNDER_CURRENT_ID",
  startedAt: new Date().toISOString(), checks: [], error: null };
let browser;
(async () => {
  const behavior = read(path.join(run, "maintenance-01/report.json"));
  assert.equal(behavior.status, "FAILED");
  const expected = ["preview-scene", "start"], stale = ["node_scene_opening", "start"];
  assert.deepEqual(behavior.expectedNodeIds, expected);
  assert.deepEqual(behavior.renderedNodeIds, stale);
  assert(behavior.maintenanceText.includes("重载完成"));
  report.checks.push("Original real-click failure and claimed successful reload preserved");
  const launch = read(path.join(run, "launch.json"));
  assert.equal(hash(path.join(launch.installRoot, "agentvn-editor.exe")), launch.executableSha256);
  report.executable = { path: path.join(launch.installRoot, "agentvn-editor.exe"), sha256: launch.executableSha256 };
  report.checks.push("Actual installed frozen 1.9.9 executable identity unchanged");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost"));
  assert(page);
  const activeIds = await page.locator(".react-flow__node").evaluateAll(nodes => nodes.map(n => n.getAttribute("data-id")).sort());
  assert.deepEqual(activeIds, stale);
  const panel = await page.getByTestId("preview-launch-panel").innerText();
  assert(panel.includes("安装版独立预览验收_20261018") && panel.includes("重载完成"));
  report.activeUi = { nodeIds: activeIds, panel };
  report.checks.push("Independent actual WebView observation confirms wrong graph remains active");
  const stateResponse = await fetch("http://127.0.0.1:8278/api/project/state");
  assert(stateResponse.ok);
  const state = (await stateResponse.json()).data;
  const projectId = "installed-preview-isolated-20261018-01";
  assert.equal(state.project_metadata.projectId, projectId);
  assert.deepEqual(state.project_graph.nodes.map(n => n.id).sort(), stale);
  report.sharedState = { metadata: state.project_metadata, graph: state.project_graph };
  const savedResponse = await fetch(`http://127.0.0.1:8278/api/project/projects/${projectId}`);
  assert(savedResponse.ok);
  const saved = (await savedResponse.json()).data;
  assert.equal(saved.project_id, projectId);
  assert.deepEqual(saved.nodes.map(n => n.id).sort(), expected);
  report.actualSavedProject = saved;
  report.persistedGraphStatus = "ORIGINAL_IMPORTED_GRAPH_STILL_CORRECT_AT_OBSERVATION";
  report.risk = "Active editor draft was replaced by the previous project's graph. No persisted data loss is proven; saving this wrong draft is a risk, not an executed test step.";
  report.checks.push("Separate real backend endpoints prove mismatched shared graph but correct saved project");
  const image = behavior.screenshots.find(s => s.path.endsWith("maintenance-reload-result.png"));
  assert(image);
  assert.equal(hash(image.path), image.sha256);
  assert.deepEqual(image.before, image.after);
  report.screenshot = image;
  report.checks.push("Actual failure screenshot SHA and WebView capture parameters match");
  report.status = "FAILED";
  report.evidenceStatus = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  await browser?.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus,
    checks: report.checks.length, defect: report.defect, error: report.error, destination }, null, 2));
});
