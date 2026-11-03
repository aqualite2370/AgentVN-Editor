#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_DIR = path.join(ROOT, "editor");
const OUTPUT_DIR = path.join(ROOT, "output", "playwright", "unified-game-client-layout");
const PORT = 6774;
const EDITOR_URL = `http://127.0.0.1:${PORT}/`;
const VITE_BIN = path.join(EDITOR_DIR, "node_modules", "vite", "bin", "vite.js");
const VIEWPORTS = [
  { name: "regular-1024x768", width: 1024, height: 768 },
  { name: "wide-1440x900", width: 1440, height: 900 },
  { name: "narrow-390x844", width: 390, height: 844 },
];

function assert(condition, message, details) {
  if (condition) return;
  throw new Error(details === undefined ? message : `${message}: ${JSON.stringify(details)}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isListening() {
  try {
    const response = await fetch(EDITOR_URL, { method: "HEAD" });
    return response.status < 500;
  } catch {
    return false;
  }
}

function startEditor() {
  const child = spawn(process.execPath, [
    VITE_BIN,
    "--host",
    "127.0.0.1",
    "--port",
    String(PORT),
    "--strictPort",
  ], {
    cwd: EDITOR_DIR,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logPath = path.join(OUTPUT_DIR, "editor-vite.log");
  const append = (chunk) => fs.appendFileSync(logPath, chunk.toString());
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return { child, logPath };
}

function stopEditor(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}

async function waitForEditor() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isListening()) return;
    await sleep(300);
  }
  throw new Error(`Editor did not start at ${EDITOR_URL}`);
}

function buildProject() {
  const timestamp = "2026-09-01T00:00:00.000Z";
  const scene = {
    scene_id: "unified_game_client_scene",
    title: "统一游戏客户端布局",
    summary: "验证编辑器只提供一套游戏客户端坐标。",
    chapter: 1,
    tags: ["layout", "regression"],
    commands: [{ type: "narration", text: "统一游戏客户端布局验收。" }],
    is_ending: true,
  };
  return {
    schema_version: "1.0.0",
    project_id: "unified_game_client_layout_test",
    title: "统一游戏客户端布局验收",
    author: "AgentVN QA",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 40, y: 180 },
        data: {
          nodeKind: "start",
          label: "入口",
          description: "",
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
        },
      },
      {
        id: "scene",
        type: "sceneNode",
        position: { x: 320, y: 160 },
        data: {
          nodeKind: "scene",
          label: scene.title,
          description: scene.summary,
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
          scene,
        },
      },
    ],
    edges: [{ id: "edge_start_scene", source: "start", target: "scene", sourceHandle: "default" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: [],
    editor_settings: {},
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function toSharedProjectState(project) {
  return {
    project_graph: {
      nodes: project.nodes,
      edges: project.edges,
      viewport: project.viewport,
      memoryMode: project.memory_mode,
    },
    project_metadata: {
      projectId: project.project_id,
      title: project.title,
      author: project.author,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      assetManifest: project.asset_manifest,
      settings: project.editor_settings,
      schemaVersion: project.schema_version,
    },
    recent_projects: [],
    provider_connections: [],
    provider_models: [],
    provider_selections: {},
    provider_secrets: {},
  };
}

async function installFixture(page) {
  const project = buildProject();
  const sharedState = toSharedProjectState(project);
  await page.addInitScript((fixture) => {
    localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(fixture));
    localStorage.setItem("agentvn.recentProjects", JSON.stringify([{
      project_id: fixture.project_id,
      title: fixture.title,
      author: fixture.author,
      created_at: fixture.created_at,
      updated_at: fixture.updated_at,
      node_count: fixture.nodes.length,
      edge_count: fixture.edges.length,
      schema_version: fixture.schema_version,
      has_detail: true,
      project: fixture,
    }]));
  }, project);
  await page.route("http://127.0.0.1:8278/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    if (url.pathname === "/api/project/state") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: sharedState }),
      });
      return;
    }
    if (url.pathname === "/api/project/catalog") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: [] }),
      });
      return;
    }
    if (url.pathname.startsWith("/api/project/projects/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: method === "GET" ? project : (request.postDataJSON?.() ?? project) }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: {} }),
    });
  });
}

async function openProjectAndDesigner(page) {
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const stage = document.querySelector(".app-transition-stage");
    return !document.querySelector(".project-entry-loading-overlay")
      && (!stage
        || (!stage.classList.contains("is-home-hydrating")
          && !stage.classList.contains("is-switching")
          && !stage.classList.contains("is-enter-cartridge")
          && !stage.classList.contains("is-project-entry-loading")));
  }, null, { timeout: 12_000 }).catch(() => {});
  const toolbar = page.locator(".editor-toolbar");
  if (!(await toolbar.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await page.waitForFunction(() => {
      const candidates = [...document.querySelectorAll(
        '[data-help-key="home.recentProject"], [data-help-key="home.openDraft"], [data-help-key="home.createProject"]',
      )];
      return candidates.some((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && !element.disabled;
      });
    }, null, { timeout: 30_000 });
    await page.evaluate(() => {
      document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
        if (element instanceof HTMLElement) element.style.pointerEvents = "none";
      });
      const candidates = [...document.querySelectorAll(
        '[data-help-key="home.recentProject"], [data-help-key="home.openDraft"], [data-help-key="home.createProject"]',
      )];
      const entry = candidates.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !element.disabled;
      });
      if (!(entry instanceof HTMLElement)) throw new Error("No visible project entry action.");
      entry.click();
    });
  }
  await toolbar.waitFor({ state: "visible", timeout: 30_000 });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("agentvn:open-advanced-tools", {
      detail: {
        id: `unified-layout-${Date.now()}`,
        tab: "layout",
      },
    }));
  });
  await page.locator(".advanced-tools-panel").waitFor({ state: "visible", timeout: 15_000 });
  const layoutTab = page.locator(
    '.advanced-tools-panel:visible [data-help-key="advanced.tab.layout"]:visible',
  ).first();
  await layoutTab.waitFor({ state: "visible", timeout: 15_000 });
  await page.locator(".runtime-layout-designer").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(".runtime-layout-stage").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(".project-entry-loading-overlay").waitFor({
    state: "hidden",
    timeout: 30_000,
  }).catch(() => {});
}

async function verifyViewport(page, viewport) {
  await installFixture(page);
  await openProjectAndDesigner(page);

  const designer = page.locator(".runtime-layout-designer:visible").first();
  const layoutTab = page.locator(
    '.advanced-tools-panel:visible [data-help-key="advanced.tab.layout"]:visible',
  ).first();
  const heading = designer.locator(".runtime-layout-header h3").first();
  assert((await layoutTab.textContent())?.trim() === "游戏客户端", `${viewport.name}: layout tab label is not unified`);
  assert((await heading.textContent())?.trim() === "游戏客户端", `${viewport.name}: layout heading is not unified`);

  for (const selector of [
    '[data-help-key="layout.desktop"]',
    '[data-help-key="layout.mobile"]',
    '[data-help-key="layout.copyBreakpoint"]',
    '[data-layout-mode="pc"]',
  ]) {
    assert(await page.locator(selector).count() === 0, `${viewport.name}: forbidden split-layout control exists`, selector);
  }

  const designerText = (await designer.textContent()) ?? "";
  for (const label of ["应用统一布局坐标", "应用到桌面", "应用到手机", "同步两端", "手机横屏布局"]) {
    assert(!designerText.includes(label), `${viewport.name}: forbidden split-layout label exists`, label);
  }

  const geometry = await page.evaluate(() => {
    const rectOf = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      bodyWidth: document.body.scrollWidth,
      bodyHeight: document.body.scrollHeight,
      designer: rectOf(".runtime-layout-designer"),
      stage: rectOf(".runtime-layout-stage"),
      sidebar: rectOf(".runtime-layout-sidebar"),
      inspector: rectOf(".runtime-layout-inspector"),
      verticalScrollContainers: [...document.querySelectorAll(".runtime-layout-designer, .advanced-tab-scroll, .advanced-tab-viewport, .toolbar-popover.advanced")]
        .filter((element) => element instanceof HTMLElement)
        .map((element) => {
          const style = getComputedStyle(element);
          return {
            className: element.className,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            overflowY: style.overflowY,
          };
        })
        .filter((item) => item.scrollHeight > item.clientHeight + 1 && ["auto", "scroll"].includes(item.overflowY)),
    };
  });
  assert(geometry.documentWidth <= geometry.viewport.width + 1, `${viewport.name}: document has horizontal overflow`, geometry);
  assert(geometry.bodyWidth <= geometry.viewport.width + 1, `${viewport.name}: body has horizontal overflow`, geometry);
  for (const [name, rect] of Object.entries({
    designer: geometry.designer,
    stage: geometry.stage,
    sidebar: geometry.sidebar,
    inspector: geometry.inspector,
  })) {
    assert(rect?.visible, `${viewport.name}: ${name} is not visible`, rect);
    assert(rect.left >= -1 && rect.right <= geometry.viewport.width + 1, `${viewport.name}: ${name} escapes viewport`, rect);
    if (viewport.width > 640) {
      assert(rect.top >= -1 && rect.bottom <= geometry.viewport.height + 1, `${viewport.name}: ${name} is clipped vertically`, rect);
    }
  }
  if (viewport.width <= 640) {
    const documentScrollable = Math.max(geometry.documentHeight, geometry.bodyHeight) > geometry.viewport.height + 1;
    assert(
      documentScrollable || geometry.verticalScrollContainers.length > 0,
      `${viewport.name}: long designer content has no vertical scroll path`,
      geometry,
    );
  }

  const componentButton = designer.locator(
    '.runtime-layout-component-list button[data-component-id="dialog_panel"]',
  ).first();
  await componentButton.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error("Dialog panel selector is not a button.");
    element.click();
  });
  const xInput = designer.locator(".runtime-layout-fieldset").first().locator('input[type="number"]').first();
  await page.waitForFunction(() => {
    const visibleDesigner = [...document.querySelectorAll(".runtime-layout-designer")]
      .find((element) => element instanceof HTMLElement && element.offsetParent !== null);
    const input = visibleDesigner?.querySelector(".runtime-layout-fieldset input[type='number']");
    return input instanceof HTMLInputElement && !input.disabled;
  }, null, { timeout: 5_000 });
  await xInput.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) throw new Error("Layout x control is not an input.");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, "13");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(120);
  const blockLeft = await designer.locator(
    '.runtime-layout-stage .runtime-layout-block[data-component-id="dialog_panel"]',
  ).evaluate((element) => element.style.left);
  assert(blockLeft === "13%", `${viewport.name}: coordinate edit did not apply directly`, { blockLeft });

  const saveButton = designer.locator('[data-help-key="layout.save"]').first();
  assert(await saveButton.isVisible(), `${viewport.name}: save action is not visible`);
  assert(await saveButton.isEnabled(), `${viewport.name}: save action is not enabled`);

  const screenshot = path.join(OUTPUT_DIR, `${viewport.name}.png`);
  await page.screenshot({ path: screenshot });
  return { viewport, geometry, blockLeft, screenshot };
}

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const report = {
    ok: true,
    at: new Date().toISOString(),
    editorUrl: EDITOR_URL,
    results: [],
  };
  let browser;
  let server;
  try {
    assert(!await isListening(), `Dedicated test port ${PORT} is already in use`);
    server = startEditor();
    report.editorLog = server.logPath;
    await waitForEditor();
    browser = await chromium.launch({ headless: true });
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const browserMessages = [];
      page.on("console", (message) => {
        if (message.type() === "error") browserMessages.push(message.text());
      });
      page.on("pageerror", (error) => browserMessages.push(error.message));
      try {
        report.results.push(await verifyViewport(page, viewport));
      } catch (error) {
        const failureScreenshot = path.join(OUTPUT_DIR, `${viewport.name}-failure.png`);
        await page.screenshot({ path: failureScreenshot, fullPage: true }).catch(() => {});
        if (error instanceof Error) {
          error.message = `${error.message}; screenshot=${failureScreenshot}; browserErrors=${JSON.stringify(browserMessages)}`;
        }
        throw error;
      } finally {
        await page.close();
      }
    }
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error) };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) stopEditor(server.child);
    const reportPath = path.join(OUTPUT_DIR, "report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify({
      ok: report.ok,
      reportPath,
      results: report.results.map((result) => ({
        viewport: result.viewport.name,
        blockLeft: result.blockLeft,
        screenshot: result.screenshot,
      })),
      error: report.error,
    }, null, 2));
  }
  if (!report.ok) process.exit(1);
})();
