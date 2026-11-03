#!/usr/bin/env node
"use strict";

// Read-only source; isolated backend/database and a unique evidence directory.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { loadProjectContainerSync, readZipEntrySync } = require("./project-container.cjs");

const root = path.resolve(__dirname, "..");
const input = path.resolve(process.env.AGENTVN_LARGE_PROJECT
  || "D:/agentvntest/options-export-input-streamed-20260922T154901Z/隐忍的成长.vnproj");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/large-project-import", runId);
const editorPort = 6901;
const backendPort = 8401;
const editorUrl = `http://127.0.0.1:${editorPort}`;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const report = {
  runId, input, inputBytes: fs.statSync(input).size, events: [], samples: [],
  sourcePreserved: false, imported: false, assetResponses: [],
};
fs.mkdirSync(output, { recursive: true });

async function hash(file) {
  const stream = fs.createReadStream(file);
  const digest = crypto.createHash("sha256");
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}
async function free(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
async function ready(url) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Server not ready: ${url}`);
}
function stop(child) {
  if (child?.pid) spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"],
    { windowsHide: true, stdio: "ignore" });
}
function record(type, details = {}) {
  report.events.push({ at: new Date().toISOString(), type, ...details });
}
function sample(pids) {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe','chrome-headless-shell.exe','headless_shell.exe','chromium.exe','msedge.exe','python.exe','node.exe','cmd.exe') } | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress`;
  const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command", script],
    { windowsHide: true, encoding: "utf8", timeout: 15000 });
  if (ps.status !== 0) return { error: String(ps.stderr || ps.error) };
  const processes = [JSON.parse(ps.stdout || "[]")].flat();
  const descendants = new Set(pids.filter(Boolean));
  for (let i = 0; i < 20; i += 1) {
    let changed = false;
    for (const item of processes) {
      if (descendants.has(item.ParentProcessId) && !descendants.has(item.ProcessId)) {
        descendants.add(item.ProcessId);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return processes.filter((item) => descendants.has(item.ProcessId))
    .map(({ ProcessId, ParentProcessId, Name, WorkingSetSize }) => ({
      pid: ProcessId, parentPid: ParentProcessId, name: Name, workingSetBytes: Number(WorkingSetSize),
    }));
}

async function main() {
  assert(report.inputBytes > 400 * 1024 * 1024, "The real large-project fixture is missing.");
  await free(editorPort); await free(backendPort);
  report.inputSha256Before = await hash(input);
  const data = path.join(output, "isolated-data");
  const backendLog = fs.createWriteStream(path.join(output, "backend.log"));
  const editorLog = fs.createWriteStream(path.join(output, "editor.log"));
  const backend = spawn("python", ["backend_launcher.py"], {
    cwd: path.join(root, "backend"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_DATA_DIR: data,
      DATABASE_PATH: path.join(data, "vn_engine.db"), AGENTVN_BACKEND_PORT: String(backendPort),
      AGENTVN_LEGACY_DATABASE_PATHS: "" },
  });
  const editor = spawn("cmd.exe", ["/d", "/s", "/c",
    `npm run dev -- --host 127.0.0.1 --port ${editorPort} --strictPort`], {
    cwd: path.join(root, "editor"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VITE_BACKEND_URL: backendUrl },
  });
  backend.stdout.pipe(backendLog); backend.stderr.pipe(backendLog);
  editor.stdout.pipe(editorLog); editor.stderr.pipe(editorLog);
  let browser, page, timer;
  try {
    await ready(`${backendUrl}/api/health`); await ready(editorUrl);
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // Playwright's Browser interface does not expose its OS PID. Chromium is
    // a descendant of this diagnostic Node process, so sample that tree.
    const browserLauncherPid = process.pid;
    report.pids = { backend: backend.pid, editor: editor.pid, browserLauncher: browserLauncherPid };
    browser.on("disconnected", () => record("browser-disconnected"));
    page.on("crash", () => record("page-crash"));
    page.on("close", () => record("page-close"));
    page.on("pageerror", (error) => record("pageerror", { message: String(error) }));
    page.on("request", (request) => {
      if (request.url().includes("/api/project/")) record("request", { method: request.method(), url: request.url() });
    });
    page.on("response", (response) => {
      if (response.url().includes("/api/project/")) record("response", { status: response.status(), url: response.url() });
    });
    page.on("requestfailed", (request) => record("requestfailed", { url: request.url(), failure: request.failure() }));
    // The source project records the normal editor backend port. Redirect
    // only its asset requests to this run's isolated backend, preserving the
    // real response/status/body rather than mocking a successful image.
    // Install routing AFTER import: Chromium request interception buffers
    // upload bodies even for unmatched URLs and can itself exhaust memory.
    async function routeAssets() {
      await page.route("http://127.0.0.1:8278/api/project/assets/**", async (route) => {
        const actual = route.request().url().replace("http://127.0.0.1:8278", backendUrl);
        const response = await route.fetch({ url: actual });
        report.assetResponses.push({ url: actual, status: response.status() });
        await route.fulfill({ response });
      });
    }
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    const file = page.locator(".project-import-button input").first();
    await file.waitFor({ state: "attached" });
    await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some((item) => !item.disabled));
    record("file-selection-start");
    timer = setInterval(() => {
      report.samples.push({ at: new Date().toISOString(),
        processes: sample([browserLauncherPid]) });
    }, 5000);
    await file.setInputFiles(input);
    record("file-selection-complete");
    await Promise.race([
      page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 300000 })
        .then(() => { report.imported = true; record("editor-ready"); }),
      page.locator(".project-home-status").filter({ hasText: /失败|错误|无法/ })
        .waitFor({ state: "visible", timeout: 300000 }).then(async () => {
          throw new Error(`Import error: ${await page.locator(".project-home-status").innerText()}`);
        }),
    ]);
    if (report.imported) {
      await routeAssets();
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await page.locator(".runtime-layout-stage").waitFor({ state: "visible", timeout: 60000 });
      await page.waitForTimeout(2000);
      report.layoutOpened = true;
      assert(report.assetResponses.length > 0, "Large project preview made no real asset requests.");
      assert(report.assetResponses.every((item) => item.status === 200),
        `Real project asset requests failed: ${JSON.stringify(report.assetResponses.filter((item) => item.status !== 200))}`);
      record("layout-ready");
      if (process.env.AGENTVN_LARGE_IMPORT_ONLY !== "1") {
        await verifyLayoutRoundTrip(page);
      }
    }
  } catch (error) {
    report.error = String(error.stack || error);
    record("diagnostic-error", { message: String(error) });
  } finally {
    clearInterval(timer);
    if (page && !page.isClosed()) {
      report.lastUi = await page.locator("body").innerText({ timeout: 5000 }).then((text) => text.slice(0, 3000)).catch(() => "");
      await page.screenshot({ path: path.join(output, report.error ? "failure.png" : "final.png") }).catch(() => {});
    }
    await browser?.close().catch(() => {});
    stop(editor); stop(backend);
    report.inputSha256After = await hash(input);
    report.sourcePreserved = report.inputSha256Before === report.inputSha256After;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
  if (report.error || !report.imported || !report.layoutOpened || !report.sourcePreserved) {
    throw new Error(report.error || "Large project import/layout failed.");
  }
}

async function verifyLayoutRoundTrip(page) {
  const source = loadProjectContainerSync(input).project;
  const projectUrl = `${backendUrl}/api/project/projects/${encodeURIComponent(source.project_id)}`;
  const loadSaved = async () => {
    const response = await page.request.get(projectUrl);
    assert(response.ok(), `Project read failed: ${response.status()}`);
    return (await response.json()).data;
  };
  const before = await loadSaved();
  assert.equal(before.title, "隐忍的成长");
  report.project = { id: before.project_id, title: before.title,
    nodes: before.nodes.length, edges: before.edges.length, assets: before.asset_manifest.length };
  assert.equal(before.nodes.length, source.nodes.length, "Real graph node count changed on import.");
  assert.equal(before.edges.length, source.edges.length, "Real graph edge count changed on import.");
  assert.equal(before.asset_manifest.length, source.asset_manifest.length, "Real project lost assets on import.");
  const titleTab = () => page.locator(".runtime-layout-screen-list button").getByText("标题主页", { exact: true });
  const component = () => page.locator('.runtime-layout-component-list button[data-component-id="title_start_button"]');
  const fields = () => page.locator(".runtime-layout-inspector details").first().locator('input[type="number"]');
  await titleTab().click();
  await component().click();
  const oldX = Number(await fields().nth(0).inputValue());
  const nextX = oldX > 50 ? oldX - 1 : oldX + 1;
  await fields().nth(0).fill(String(nextX));
  await page.locator('[data-help-key="layout.save"]').click();
  await page.locator(".runtime-layout-save-feedback.is-saved").waitFor({ timeout: 60000 });
  const saved = await loadSaved();
  const layout = saved.editor_settings.runtimeUILayout;
  assert.equal(layout.screens.find((screen) => screen.screen_id === "title").components
    .find((item) => item.component_id === "title_start_button").rect.x, nextX);
  // React Flow remeasures DOM card height when a project is opened. This is
  // a render cache, not authored scene data or authored node coordinates.
  const authoredNodes = (nodes) => nodes.map(({ measured, ...node }) => node);
  report.nodeMeasurementChanges = saved.nodes.flatMap((node, index) =>
    JSON.stringify(node.measured) === JSON.stringify(before.nodes[index]?.measured) ? [] : [{
      id: node.id, before: before.nodes[index]?.measured, after: node.measured,
    }]);
  assert.deepEqual(authoredNodes(saved.nodes), authoredNodes(before.nodes), "Layout edit changed the real story graph.");
  assert.deepEqual(saved.edges, before.edges, "Layout edit changed story connections.");
  assert.deepEqual(saved.asset_manifest, before.asset_manifest, "Layout edit changed the asset manifest.");
  fs.writeFileSync(path.join(output, "saved-layout.json"), JSON.stringify(layout, null, 2));
  report.layoutSave = { oldX, nextX, graphAndAssetsPreserved: true };
  record("layout-saved");

  await page.reload();
  await page.waitForFunction(() => document.querySelector(".editor-toolbar")
    || [...document.querySelectorAll(".recent-project-open:not(:disabled)")].some((node) => node.textContent.includes("隐忍的成长")));
  if (!await page.locator(".editor-toolbar").isVisible()) {
    await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: "隐忍的成长" }).first().click();
  }
  await page.locator(".editor-toolbar").waitFor();
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await titleTab().click();
  await component().click();
  assert.equal(Number(await fields().nth(0).inputValue()), nextX, "Saved layout was lost after reopening.");
  report.reopened = true;
  record("layout-reopened");
  await page.screenshot({ path: path.join(output, "saved-reopened-layout.png") });

  await page.locator('[data-workspace-surface="publish"]:visible').click();
  await page.locator(".cartridge-export-panel").waitFor();
  await page.locator('button[data-help-key="package.mode"]').click();
  await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
  await page.locator('[data-package-stage="checks"]').click();
  const warnings = page.locator('input[data-help-key="package.confirmWarnings"]');
  if (await warnings.count()) await warnings.check();
  await page.locator('[data-package-stage="settings"]').click();
  const exportButton = page.locator('[data-help-key="package.export"]');
  await exportButton.waitFor();
  assert(await exportButton.isEnabled(), "Real project cartridge export is disabled.");
  const downloaded = page.waitForEvent("download", { timeout: 300000 });
  await exportButton.click();
  const download = await downloaded;
  const cartridge = path.join(output, "隐忍的成长-layout-acceptance.vncart");
  await download.saveAs(cartridge);
  assert.equal(await download.failure(), null, "Cartridge download failed.");
  const packed = JSON.parse(readZipEntrySync(cartridge, "ui/layout.json").toString("utf8"));
  assert.equal(packed.screens.find((screen) => screen.screen_id === "title").components
    .find((item) => item.component_id === "title_start_button").rect.x, nextX,
    "Real cartridge export lost the saved layout edit.");
  report.cartridge = { path: cartridge, bytes: fs.statSync(cartridge).size,
    sha256: await hash(cartridge), generatedAt: fs.statSync(cartridge).mtime.toISOString(),
    layoutSha256: crypto.createHash("sha256").update(readZipEntrySync(cartridge, "ui/layout.json")).digest("hex") };
  record("cartridge-exported", report.cartridge);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
