"use strict";
// Real installed WebView only. No source server, store injection, model request,
// database writes, or synthetic project creation.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const [launchFile, destination, phase = "first", expectedVersion = "1.9.9"] = process.argv.slice(2);
assert(["1.9.9", "1.9.16"].includes(expectedVersion), "Explicit tested candidate required");
assert(launchFile && destination && ["first", "restart"].includes(phase));
assert(!fs.existsSync(destination), "Fresh report directory required");
fs.mkdirSync(destination);
const launch = JSON.parse(fs.readFileSync(launchFile, "utf8"));
const baseline = JSON.parse(fs.readFileSync(path.join(path.dirname(launchFile), "old-ui-data-created.json"), "utf8"));
const title = baseline.project.metadata.title, author = baseline.project.metadata.author;
const marker = `覆盖升级后实际编辑保存_${expectedVersion}_${expectedVersion === "1.9.9" ? "20261018" : "20261021"}`;
const report = { status: "RUNNING", scope: launch.installerKind === "MSI" ||
    launch.installRoot === "D:\\agentvntest\\AgentVN Editor"
    ? "HOST_MSI_UPGRADE_ACTUAL_INSTALLED_UI" : "HOST_NSIS_UPGRADE_ACTUAL_INSTALLED_UI",
  phase, startedAt: new Date().toISOString(), version: launch.actualVersion,
  testProject: process.env.AGENTVN_TEST_PROJECT || "UNRECORDED",
  workspaceOutput: process.env.AGENTVN_WORKSPACE_OUTPUT || destination,
  executableSha256: launch.executableSha256, checks: [], screenshots: [],
  realModelRequests: 0, limitations: ["Not a clean machine", "Not the full desktop matrix",
    "Old sample has no current AI session/component-library UI"] };
let browser;
function check(name, run) {
  try { const detail = run(); report.checks.push({ name, status: "PASS", detail }); }
  catch (error) { report.checks.push({ name, status: "FAILED", error: String(error.stack || error) }); }
}
async function state() {
  const response = await fetch("http://127.0.0.1:8278/api/project/state");
  assert(response.ok, `Backend state HTTP ${response.status}`);
  const payload = await response.json();
  assert(payload.ok && payload.data?.project_metadata && payload.data?.project_graph,
    "Expected installed backend state response envelope");
  // Deliberately exclude provider connections and secrets from evidence.
  return { metadata: payload.data.project_metadata, graph: payload.data.project_graph };
}
(async () => {
  assert.equal(launch.actualVersion, expectedVersion);
  assert.equal(launch.dataDirectoryOverride, false);
  assert.equal(launch.webviewDirectoryOverride, false);
  assert.equal(launch.manualBackendSpawn, false);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const pageDeadline=Date.now()+30000;
  let page;
  do {
    page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
    if(!page) await new Promise(resolve=>setTimeout(resolve,100));
  } while(!page && Date.now()<pageDeadline);
  assert(page, "Actual installed page missing");
  page.setDefaultTimeout(15000);
  const cdp = await page.context().newCDPSession(page);
  async function shot(name) {
    const expected = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
    report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, `${name}.png`), expected));
  }
  const returnHome = page.getByRole("button", { name: "返回首页", exact: true });
  if (await returnHome.isVisible()) await returnHome.click();
  await page.getByRole("button", { name: "继续上次编辑", exact: true }).waitFor();
  report.homeText = await page.locator("body").innerText();
  check(`Homepage shows installed ${expectedVersion} and old recent project`, () => {
    assert(report.homeText.includes(expectedVersion));
    assert(report.homeText.includes(title));
    assert(report.homeText.includes(author));
  });
  await shot("upgraded-home");
  // Exercise the actual primary resume action, rather than importing a package.
  await page.getByRole("button", { name: "继续上次编辑", exact: true }).click();
  await page.locator('[data-workspace-surface="edit"]:visible').waitFor();
  await page.getByRole("button", { name: "保存工程", exact: true }).waitFor();
  await page.locator('.react-flow__node[data-id="node_scene_opening"]').waitFor();
  // DOM controls can exist behind the entry loader before the editor is actually
  // presented. Do not count a loader screenshot as a final editor screenshot.
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "detached", timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
  await page.waitForFunction(() => document.querySelector(".theme-tone-switch"));
  report.presentationReady = await page.evaluate(() => ({
    entryOverlayAbsent: !document.querySelector(".project-entry-loading-overlay"),
    containerIdle: !document.querySelector(".app-transition-stage.is-switching"),
    visibleControls: [...document.querySelectorAll(".editor-toolbar button")]
      .filter(button => button.getBoundingClientRect().width > 0).length
  }));
  assert(report.presentationReady.entryOverlayAbsent && report.presentationReady.containerIdle);
  assert(report.presentationReady.visibleControls > 0);
  const current = await state();
  report.resumedProject = { metadata: current.metadata, graph: current.graph };
  check("Resume preserves project ID, title and author", () => {
    assert.equal(current.metadata.projectId, baseline.project.metadata.projectId);
    assert.equal(current.metadata.title, title);
    assert.equal(current.metadata.author, author);
  });
  check("Resume preserves node, edge and scene IDs and commands", () => {
    assert.deepEqual(current.graph.nodes.map(n => n.id).sort(), baseline.project.graph.nodes.map(n => n.id).sort());
    assert.deepEqual(current.graph.edges, baseline.project.graph.edges);
    const before = baseline.project.graph.nodes.find(n => n.id === "node_scene_opening").data.scene;
    const after = current.graph.nodes.find(n => n.id === "node_scene_opening").data.scene;
    assert.equal(after.scene_id, before.scene_id);
    assert.deepEqual(after.commands, before.commands);
  });
  report.theme = await page.locator(".theme-tone-switch:visible").evaluate(button => ({
    label: button.getAttribute("aria-label"), pressed: button.getAttribute("aria-pressed"),
    tone: localStorage.getItem("agentvn.themeTone")
  }));
  check("Old dark theme remains active", () => {
    assert.match(report.theme.label, /切换到浅色主题/);
    assert.equal(report.theme.tone, baseline.localStorage["agentvn.themeTone"]);
  });
  const viewport = await page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }));
  check("Viewport has no horizontal overflow", () => assert(viewport.scroll <= viewport.inner + 1));
  await shot("resumed-editor");
  if (report.checks.some(c => c.status === "FAILED")) {
    report.editAndSave = "NOT_RUN: preservation failed; do not overwrite old test project";
    return;
  }
  // Select the existing node and edit its real inspector textbox.
  const closeWorkbench = page.getByRole("button", { name: "关闭事件工作台", exact: true });
  if (await closeWorkbench.isVisible()) await closeWorkbench.click();
  const summary = page.getByRole("textbox", { name: /^场景摘要(?: 场景摘要)?$/ });
  if (!(await summary.isVisible())) {
    await page.locator('.react-flow__node[data-id="node_scene_opening"]').getByText("开场", { exact: true }).click();
  }
  await summary.waitFor();
  if (phase === "first") await summary.fill(marker);
  const summaryValue = await summary.inputValue();
  if (phase === "restart") {
    check(`Real inspector restores newly saved ${expectedVersion} edit after restart`, () => assert.equal(summaryValue, marker));
  }
  if (phase === "first") {
    await page.getByRole("button", { name: "保存工程", exact: true }).click();
    const deadline = Date.now() + 20000;
    let saved;
    do {
      saved = await state();
      if (saved.graph.nodes.find(n => n.id === "node_scene_opening").data.scene.summary === marker) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    } while (Date.now() < deadline);
    check("Real edit reaches backend state after Save Project", () => {
      assert.equal(saved.graph.nodes.find(n => n.id === "node_scene_opening").data.scene.summary, marker);
      assert.equal(saved.metadata.title, title);
      assert.equal(saved.metadata.author, author);
    });
    report.savedProject = { metadata: saved.metadata, graph: saved.graph };
    // The restart phase is the durable-write assertion; do not call state
    // inspection alone proof of successful disk persistence.
    report.durableWrite = "PENDING_RESTART_PHASE";
  }
  await shot("edited-or-restored-project");
})().catch(error => { report.error = String(error.stack || error); })
  .finally(async () => {
    await browser?.close().catch(() => {});
    report.status = report.error || !report.checks.length || report.checks.some(c => c.status !== "PASS") ? "FAILED" : "PASS";
    report.finishedAt = new Date().toISOString();
    const file = path.join(destination, "report.json");
    fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, checks: report.checks,
      error: report.error, report: file }, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  });
