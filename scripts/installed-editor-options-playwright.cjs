// Real installed Release WebView: no Tauri mocks or internal navigation events.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");

assert(process.argv[2] && process.argv[3], "usage: node script <deployment-report-directory> <project.vnproj>");
const runRoot = path.resolve(process.argv[2]);
const project = path.resolve(process.argv[3]);
const projectImportedViaIsolatedBackend = process.argv.includes("--project-imported-via-isolated-backend");
const expectedProjectTitle = process.env.INSTALLED_ACCEPTANCE_PROJECT_TITLE || "隐忍的成长";
const state = JSON.parse(fs.readFileSync(path.join(runRoot, "installed-processes.json"), "utf8"));
const installer = JSON.parse(fs.readFileSync(path.join(runRoot, "installer-resource-report.json"), "utf8"));
assert.equal(installer.status, "PASS");
assert(installer.deployments.some(entry => entry.installedRoot === state.installRoot));
assert(path.resolve(state.databasePath).startsWith(`${runRoot}${path.sep}`), "database must be isolated");
const output = path.join(runRoot, `options-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
assert(!fs.existsSync(output), "refusing to overwrite prior UI evidence");
fs.mkdirSync(output);
const report = { ok: false, startedAt: new Date().toISOString(), state, project, cases: [], errors: [] };
const hash = async file => {
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
};
let browser, page, viewportSession;
async function waitForWorkspaceSettled({ requirePanel = false } = {}) {
  await page.waitForFunction(({ requirePanel }) => {
    const workspacePanel = document.querySelector(".workspace-task-panel");
    if (!workspacePanel?.classList.contains("is-open")) return !requirePanel;
    const tools = workspacePanel.querySelector(".advanced-tools-panel");
    return tools?.classList.contains("is-tab-idle")
      && !workspacePanel.classList.contains("is-morphing");
  }, { requirePanel }, { timeout: 30_000 });
}

async function main() {
  report.sourceSha256 = await hash(project);
  report.executableSha256 = await hash(path.join(state.installRoot, "agentvn-editor.exe"));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  page = browser.contexts()[0].pages().find(candidate => /tauri\.localhost|tauri:/.test(candidate.url()));
  assert(page, "must test installed app, not a Vite browser page");
  viewportSession = await browser.contexts()[0].newCDPSession(page);
  report.url = page.url();
  page.on("pageerror", error => report.errors.push(String(error)));
  report.importInteraction = projectImportedViaIsolatedBackend
    ? "isolated backend HTTP import; recent-project open in installed UI (Playwright)"
    : "native file picker completed before this test; recent-project open (Playwright)";
  if (!(await page.locator(".editor-toolbar").isVisible())) {
    if (projectImportedViaIsolatedBackend) {
      const catalogResponse = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/catalog`);
      assert.equal(catalogResponse.status, 200, "isolated installed backend catalog must be available");
      const catalog = await catalogResponse.json();
      assert(catalog.data.some(item => item.title === expectedProjectTitle),
        "the explicitly seeded project must exist in this run's isolated backend catalog");
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    }
    const recent = page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: expectedProjectTitle }).first();
    await recent.waitFor({ state: "visible", timeout: 240_000 });
    await recent.click();
  }
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 180_000 });
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 90_000 });
  await page.locator('[data-workspace-surface="edit"]:visible').click();
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator(".advanced-tools-panel").waitFor({ state: "visible" });
  await waitForWorkspaceSettled({ requirePanel: true });
  const projectSettingsTab = page.locator('[data-help-key="advanced.tab.settings"]:visible');
  await projectSettingsTab.waitFor({ state: "visible" });
  await projectSettingsTab.click();
  await waitForWorkspaceSettled({ requirePanel: true });
  assert.equal(await page.getByLabel("项目名称", { exact: true }).inputValue(), expectedProjectTitle,
    "installed UI did not open the expected project");
  await page.locator('[data-workspace-surface="edit"]:visible').click();
  const tabs = ["settings", "layout", "theme", "assets", "library", "animation", "providers", "history"];
  const viewports = [
    ...[3840, 2560, 1920].flatMap(width => {
      const height = width * 9 / 16;
      return [1, 2].map(deviceScaleFactor => ({
        width,
        height,
        deviceScaleFactor,
      }));
    }),
    ...(process.env.INSTALLED_ACCEPTANCE_HIGH_RES_ONLY === "1"
      ? []
      : [
        { width: 1440, height: 900, deviceScaleFactor: 1 },
        { width: 757, height: 299, deviceScaleFactor: 1 },
        { width: 390, height: 844, deviceScaleFactor: 1 },
      ]),
  ];
  for (const viewport of viewports) {
    await viewportSession.send("Emulation.setDeviceMetricsOverride", {
      ...viewport,
      mobile: false,
      scale: 1,
    });
    await page.waitForFunction(({ width, height, deviceScaleFactor }) =>
      innerWidth === width && innerHeight === height && devicePixelRatio === deviceScaleFactor,
    viewport);
    const actualViewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      deviceScaleFactor: devicePixelRatio,
    }));
    assert.deepEqual(actualViewport, viewport, "CDP must apply the requested CSS viewport and DPR");
    await page.locator('[data-workspace-surface="edit"]:visible').click();
    await waitForWorkspaceSettled();
    const nodeCount = await page.locator(".react-flow__node").count();
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator(".advanced-tools-panel").waitFor({ state: "visible" });
    await waitForWorkspaceSettled({ requirePanel: true });
    const buttons = page.locator(".advanced-tools-panel > nav button[data-help-key]");
    await buttons.first().waitFor({ state: "visible" });
    assert.deepEqual(await buttons.evaluateAll(items =>
      items.map(item => item.getAttribute("data-help-key").replace("advanced.tab.", ""))), tabs);
    for (const tab of tabs) {
      const button = page.locator(`[data-help-key="advanced.tab.${tab}"]`);
      await button.scrollIntoViewIfNeeded();
      await waitForWorkspaceSettled({ requirePanel: true });
      const before = await button.boundingBox();
      await button.click();
      const content = page.locator(`.advanced-tab-content[data-tab="${tab}"][data-advanced-tab-interactive="true"]`);
      await content.waitFor({ state: "visible" });
      await content.locator(".advanced-tab-loading").waitFor({ state: "hidden", timeout: 60_000 });
      await waitForWorkspaceSettled({ requirePanel: true });
      assert((await content.innerText()).trim().length > 0, `${tab}: empty module`);
      const metrics = await button.evaluate(element => {
        const box = element.getBoundingClientRect();
        const nav = element.closest("nav").getBoundingClientRect();
        return { width: box.width, height: box.height,
          inBounds: box.left >= Math.max(0, nav.left) - 1 && box.right <= Math.min(innerWidth, nav.right) + 1
            && box.top >= Math.max(0, nav.top) - 1 && box.bottom <= Math.min(innerHeight, nav.bottom) + 1,
          clickable: element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)),
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert(metrics.inBounds && metrics.clickable && metrics.overflow <= 1, `${tab}: clipped/obscured/overflow ${JSON.stringify(metrics)}`);
      assert(Math.abs(before.width - metrics.width) <= 1 && Math.abs(before.height - metrics.height) <= 1,
        `${tab}: selection changes button dimensions`);
      report.cases.push({ viewport: actualViewport, tab, metrics });
    }
    await page.screenshot({
      path: path.join(output, `${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor}x.png`),
    });
    await page.locator('[data-workspace-surface="edit"]:visible').click();
    await waitForWorkspaceSettled();
    assert.equal(await page.locator(".react-flow__node").count(), nodeCount, "returning to edit lost nodes");
    assert.equal(await page.locator(".scene-editor-pane .preview-panel").count(), 1, "node preview not restored");
  }
  assert.deepEqual(report.errors, [], "installed app raised page errors");
  assert.equal(await hash(project), report.sourceSha256, "input project was modified");
  report.ok = true;
}
main().catch(async error => {
  report.error = String(error.stack || error);
  if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, cases: report.cases.length, error: report.error, output }));
  if (viewportSession) {
    await viewportSession.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    await viewportSession.detach().catch(() => {});
  }
  if (browser) await browser.close(); // disconnect CDP; caller owns native processes
});
