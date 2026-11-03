#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "output", "playwright", "recent-projects-retention");
const editorUrl = "http://127.0.0.1:6767/";
const projectStateUrl = "http://127.0.0.1:8278/api/project/state";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Refusing outside-root path: ${resolved}`);
  }
  return resolved;
}

function resetOutputDir() {
  fs.rmSync(assertInsideRoot(outputDir), { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
}

async function isListening(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

function startEditorServer() {
  const child = spawn(npmCommand, ["run", "dev"], {
    cwd: path.join(root, "editor"),
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logFile = path.join(outputDir, "editor-vite.log");
  const writeLog = (data) => fs.appendFileSync(logFile, data.toString());
  child.stdout.on("data", writeLog);
  child.stderr.on("data", writeLog);
  return child;
}

function stopServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function ensureEditorServer() {
  if (await isListening(editorUrl)) return undefined;
  const child = startEditorServer();
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await isListening(editorUrl)) return child;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Editor dev server did not start at ${editorUrl}`);
}

function buildProject(index) {
  const minute = index === "current" ? 59 : index;
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, minute, 0)).toISOString();
  const id = index === "current" ? "project_current" : `project_recent_${String(index).padStart(2, "0")}`;
  const title = index === "current" ? "Current Draft" : `Recent Project ${String(index).padStart(2, "0")}`;
  return {
    schema_version: "1.0.0",
    project_id: id,
    title,
    author: "Retention QA",
    nodes: [
      {
        id: `${id}_start`,
        type: "startNode",
        position: { x: 0, y: 0 },
        data: {
          nodeKind: "start",
          label: "Start",
          description: "",
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: [],
    editor_settings: {},
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function buildSharedState() {
  const current = buildProject("current");
  return {
    project_graph: {
      nodes: current.nodes,
      edges: current.edges,
      viewport: current.viewport,
      memoryMode: current.memory_mode,
    },
    project_metadata: {
      projectId: current.project_id,
      title: current.title,
      author: current.author,
      createdAt: current.created_at,
      updatedAt: current.updated_at,
      assetManifest: current.asset_manifest,
      settings: current.editor_settings,
      schemaVersion: current.schema_version,
      editorVersion: "0.1.0",
    },
    recent_projects: Array.from({ length: 12 }, (_, index) => buildProject(index)),
    provider_connections: [],
    provider_models: [],
    provider_selections: {},
    provider_secrets: {},
  };
}

async function main() {
  resetOutputDir();
  const server = await ensureEditorServer();
  let browser;
  try {
    const sharedState = buildSharedState();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.route(`${projectStateUrl}**`, async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        const payload = JSON.parse(request.postData() || "{}");
        Object.assign(sharedState, payload);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: sharedState }),
      });
    });
    await page.route("**/api/project/catalog", async (route) => {
      const summaries = sharedState.recent_projects.map((project) => ({
        project_id: project.project_id,
        title: project.title,
        author: project.author,
        created_at: project.created_at,
        updated_at: project.updated_at,
        node_count: project.nodes.length,
        edge_count: project.edges.length,
        schema_version: project.schema_version,
        has_detail: true,
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: summaries }),
      });
    });

    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    await page.locator(".project-home").waitFor({ state: "visible", timeout: 20000 });
    await page.locator('[data-help-key="home.recentProject"]').first().waitFor({ state: "attached", timeout: 20000 });

    const titles = await page.locator('[data-help-key="home.recentProject"] strong').evaluateAll((nodes) =>
      nodes.map((node) => node.textContent?.trim()).filter(Boolean)
    );
    const countText = await page.locator(".recent-projects-panel header > span").textContent();
    fs.writeFileSync(
      path.join(outputDir, "recent-projects-retention.json"),
      JSON.stringify({ countText, titles }, null, 2),
      "utf8"
    );

    assert.equal(titles.length, 13, `Expected current draft plus all 12 recent projects to remain visible, got ${titles.length}: ${titles.join(", ")}`);
    for (let index = 0; index < 12; index += 1) {
      assert.ok(titles.includes(`Recent Project ${String(index).padStart(2, "0")}`), `Recent Project ${String(index).padStart(2, "0")} should not be dropped`);
    }
    assert.ok(titles.includes("Current Draft"), "Current draft should remain first-class in the recent-project normalization");
    assert.match(countText || "", /13\s*个项目/, "Recent project header should report the rendered 13 projects");
    console.log("Recent projects retention contract: passed");
  } finally {
    if (browser) await browser.close();
    stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
