const fs = require("fs");
const path = require("path");
const { saveProjectContainerSync } = require("./project-container.cjs");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_URL = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const OUT_DIR = path.join(ROOT, "output", "playwright", "editor-ui-perf");
const REPORT_PATH = path.join(OUT_DIR, "editor-ui-perf-audit.json");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const thresholds = {
  "import-large-project": { maxLongTaskMs: 150, maxFrameGapMs: 180 },
  "focus-imported-route": { maxLongTaskMs: 50, maxFrameGapMs: 120 },
  "select-far-imported-node": { maxLongTaskMs: 50, maxFrameGapMs: 90 },
  "select-scene-node": { maxLongTaskMs: 50, maxFrameGapMs: 90 },
  "canvas-pan-and-zoom": { maxLongTaskMs: 50, maxFrameGapMs: 120 },
  "open-advanced-tools": { maxLongTaskMs: 80, maxFrameGapMs: 120 },
};
const thresholdToleranceMs = 5;

fs.mkdirSync(OUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSceneNode(index) {
  const id = `perf_scene_${String(index).padStart(3, "0")}`;
  return {
    id,
    type: "sceneNode",
    position: { x: 260 + (index % 12) * 300, y: 120 + Math.floor(index / 12) * 210 },
    data: {
      nodeKind: "scene",
      memoryMode: "hybrid",
      aiSettings: {
        authorGoal: "Keep the scene coherent.",
        generationOutline: "",
        autoExtractMemory: true,
        autoApplyMemory: false,
      },
      previewState: { currentCommandIndex: 0, isPlaying: false },
      editorMeta: { collapsedInspectorSections: [], source: "perf_fixture" },
      label: `Performance Scene ${index}`,
      description: `Fixture scene ${index}`,
      scene: {
        scene_id: id,
        title: `Performance Scene ${index}`,
        summary: `A deterministic scene used for editor UI performance checks ${index}.`,
        commands: [
          { type: "background", background_id: `bg_${index % 8}`, background_fit: "stretch", transition: "fade" },
          { type: "dialog", character_id: `character_${index % 16}`, text: `Line ${index} keeps the inspector and preview realistic.`, side: index % 2 === 0 ? "left" : "right" },
          {
            type: "choice",
            prompt: "Choose the next route.",
            choices: [
              { choice_id: `choice_${index}_a`, text: "Continue", target_scene_id: `perf_scene_${String(Math.min(index + 1, 180)).padStart(3, "0")}` },
              { choice_id: `choice_${index}_b`, text: "Pause", target_scene_id: `perf_scene_${String(Math.min(index + 2, 180)).padStart(3, "0")}` },
            ],
          },
        ],
        tags: ["perf"],
        chapter: Math.ceil(index / 10),
      },
    },
  };
}

function buildProjectFixture() {
  const nodes = [
    {
      id: "start",
      type: "startNode",
      position: { x: 40, y: 220 },
      data: {
        nodeKind: "start",
        memoryMode: "hybrid",
        aiSettings: {
          authorGoal: "Keep the story coherent.",
          generationOutline: "",
          autoExtractMemory: true,
          autoApplyMemory: false,
        },
        previewState: { currentCommandIndex: 0, isPlaying: false },
        editorMeta: { collapsedInspectorSections: [], source: "perf_fixture" },
        label: "Start",
        description: "Performance fixture entry.",
      },
    },
  ];
  for (let index = 1; index <= 180; index += 1) nodes.push(createSceneNode(index));
  const edges = [{ id: "edge_start_perf_scene_001", source: "start", target: "perf_scene_001", sourceHandle: "default" }];
  for (let index = 1; index < 180; index += 1) {
    edges.push({
      id: `edge_perf_${String(index).padStart(3, "0")}_${String(index + 1).padStart(3, "0")}`,
      source: `perf_scene_${String(index).padStart(3, "0")}`,
      target: `perf_scene_${String(index + 1).padStart(3, "0")}`,
      sourceHandle: "default",
    });
  }
  const assetManifest = Array.from({ length: 80 }, (_, index) => ({
    asset_id: `bg_${index}`,
    asset_type: "background",
    metadata: { filename: `background_${index}.png`, path: `assets/background_${index}.png`, display_name: `Background ${index}` },
  }));
  return {
    schema_version: "1.0.0",
    project_id: "agentvn_editor_perf_fixture",
    title: "AgentVN Editor UI Performance Fixture",
    author: "AgentVN Perf Audit",
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.45 },
    memory_mode: "hybrid",
    asset_manifest: assetManifest,
    editor_settings: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function isListening(url) {
  try {
    const response = await fetch(url);
    return response.status < 500;
  } catch {
    return false;
  }
}

function startService(report) {
  const logFile = path.join(OUT_DIR, "editor-ui-perf-editor.log");
  const child = spawn(NPM, ["run", "dev"], {
    cwd: path.join(ROOT, "editor"),
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => fs.appendFileSync(logFile, chunk));
  child.stderr.on("data", (chunk) => fs.appendFileSync(logFile, chunk));
  report.logs.push(logFile);
  return child;
}

async function ensureEditor(report) {
  const started = [];
  if (!(await isListening(EDITOR_URL))) started.push(startService(report));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await isListening(EDITOR_URL)) return started;
    await sleep(700);
  }
  throw new Error(`Editor did not become ready: ${EDITOR_URL}`);
}

function stopServices(started) {
  for (const child of started) {
    if (!child.pid) continue;
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // Already stopped.
    }
  }
}

async function openEditor(page) {
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const stage = document.querySelector(".app-transition-stage");
    return !stage || !stage.classList.contains("is-home-hydrating");
  }, null, { timeout: 30_000 }).catch(() => {});

  async function clickFirstReady(selector) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false) && await item.isEnabled().catch(() => false)) {
        await item.click({ force: true });
        return true;
      }
    }
    return false;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await page.locator(".editor-toolbar").isVisible({ timeout: 800 }).catch(() => false)) return;
    if (!(await clickFirstReady('[data-help-key="home.openDraft"]'))) {
      await clickFirstReady('[data-help-key="home.createProject"]');
    }
    if (await page.locator(".editor-toolbar").isVisible({ timeout: 12_000 }).catch(() => false)) return;
  }
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 30_000 });
}

async function installProjectStateWriteGuard(page, report) {
  let interceptedWrites = 0;
  await page.route("**/api/project/state", async (route) => {
    const request = route.request();
    if (request.method().toUpperCase() !== "POST") {
      await route.continue();
      return;
    }
    interceptedWrites += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          project_graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, memoryMode: "hybrid" },
          project_metadata: {},
          recent_projects: [],
          provider_connections: [],
          provider_models: [],
          provider_selections: {},
          provider_secrets: {},
        },
      }),
    });
  });
  report.projectStateWriteGuard = {
    enabled: true,
    get interceptedWrites() {
      return interceptedWrites;
    },
  };
}

async function installProbe(page) {
  await page.evaluate(() => {
    window.__agentvnEditorUiPerf = {
      running: false,
      start: 0,
      lastFrame: 0,
      frameGaps: [],
      longTasks: [],
      mutationCount: 0,
    };
    try {
      const observer = new PerformanceObserver((list) => {
        const state = window.__agentvnEditorUiPerf;
        for (const entry of list.getEntries()) {
          if (entry.startTime >= state.start) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Long task is diagnostic only.
    }
    try {
      const mutationObserver = new MutationObserver((records) => {
        const state = window.__agentvnEditorUiPerf;
        if (state.running) state.mutationCount += records.length;
      });
      mutationObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"] });
    } catch {
      // Mutation details are diagnostic only.
    }
  });
}

async function startProbe(page) {
  return page.evaluate(() => {
    const state = window.__agentvnEditorUiPerf;
    state.running = true;
    state.start = performance.now();
    state.lastFrame = state.start;
    state.frameGaps = [];
    state.longTasks = [];
    state.mutationCount = 0;
    const step = (time) => {
      if (!state.running) return;
      state.frameGaps.push(time - state.lastFrame);
      state.lastFrame = time;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return state.start;
  });
}

async function stopProbe(page, startedAt) {
  return page.evaluate((start) => {
    const state = window.__agentvnEditorUiPerf;
    state.running = false;
    const resources = performance.getEntriesByType("resource")
      .filter((entry) => entry.startTime >= start)
      .filter((entry) => ["script", "fetch", "xmlhttprequest"].includes(entry.initiatorType))
      .map((entry) => ({ name: entry.name, initiatorType: entry.initiatorType, duration: entry.duration, transferSize: entry.transferSize }));
    return {
      elapsedMs: performance.now() - start,
      maxFrameGapMs: Math.max(0, ...state.frameGaps),
      maxLongTaskMs: Math.max(0, ...state.longTasks.map((entry) => entry.duration)),
      longTaskCount: state.longTasks.length,
      mutationCount: state.mutationCount,
      resourceCount: resources.length,
      resources: resources.slice(0, 12),
      renderedNodeCount: document.querySelectorAll(".react-flow__node").length,
      nodeCount: window.__AGENTVN_EDITOR_STORE__?.getState?.().nodes?.length ?? document.querySelectorAll(".react-flow__node").length,
    };
  }, startedAt);
}

async function measure(page, label, action, waitFor) {
  const startedAt = await startProbe(page);
  await action();
  await waitFor();
  await page.waitForTimeout(80);
  const metrics = await stopProbe(page, startedAt);
  return { label, ...metrics };
}

function evaluateThreshold(action) {
  const threshold = thresholds[action.label];
  if (!threshold) return [];
  const failures = [];
  if (action.maxLongTaskMs > threshold.maxLongTaskMs + thresholdToleranceMs) {
    failures.push(`long task ${Math.round(action.maxLongTaskMs)}ms > ${threshold.maxLongTaskMs}ms`);
  }
  if (action.maxFrameGapMs > threshold.maxFrameGapMs + thresholdToleranceMs) {
    failures.push(`frame gap ${Math.round(action.maxFrameGapMs)}ms > ${threshold.maxFrameGapMs}ms`);
  }
  return failures;
}

async function selectVisibleSceneNode(page) {
  const target = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".react-flow__node")]
      .filter((node) => node instanceof HTMLElement)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const visible = rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < window.innerWidth &&
          rect.top < window.innerHeight;
        return { node, rect, visible };
      })
      .filter((item) => item.visible);
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const target = nodes
      .filter((item) => !item.node.classList.contains("selected"))
      .sort((a, b) => {
        const aDistance = Math.abs(a.rect.left + a.rect.width / 2 - centerX) + Math.abs(a.rect.top + a.rect.height / 2 - centerY);
        const bDistance = Math.abs(b.rect.left + b.rect.width / 2 - centerX) + Math.abs(b.rect.top + b.rect.height / 2 - centerY);
        return aDistance - bDistance;
      })[0] ?? nodes[0];
    if (!target) return undefined;
    return {
      id: target.node.getAttribute("data-id") ?? target.node.getAttribute("data-testid") ?? "",
      x: target.rect.left + target.rect.width / 2,
      y: target.rect.top + target.rect.height / 2,
    };
  });
  if (!target) return undefined;
  await page.mouse.click(target.x, target.y);
  return target.id;
}

async function getImportedRouteDiagnostics(page) {
  return page.evaluate(() => {
    const state = window.__AGENTVN_EDITOR_STORE__?.getState?.();
    const nodes = state?.nodes ?? [];
    const importedNodes = nodes.filter((node) => node?.data?.editorMeta?.source === "imported");
    const farNode = importedNodes.reduce((best, node) => {
      if (!best) return node;
      const bestDistance = Math.abs(best.position?.x ?? 0) + Math.abs(best.position?.y ?? 0);
      const nextDistance = Math.abs(node.position?.x ?? 0) + Math.abs(node.position?.y ?? 0);
      return nextDistance > bestDistance ? node : best;
    }, undefined);
    const selectedNodeId = state?.selectedNodeId;
    const selectedNode = nodes.find((node) => node.id === selectedNodeId);
    const renderedIds = [...document.querySelectorAll(".react-flow__node")]
      .map((node) => node.getAttribute("data-id"))
      .filter(Boolean);
    return {
      nodeCount: nodes.length,
      renderedNodeCount: renderedIds.length,
      importedNodeCount: importedNodes.length,
      importedFirstNodeId: importedNodes[0]?.id,
      selectedNodeId,
      selectedNodeSource: selectedNode?.data?.editorMeta?.source,
      farNodeId: farNode?.id,
      farNodeRendered: farNode ? renderedIds.includes(farNode.id) : false,
      miniMapVisible: Boolean(document.querySelector(".story-minimap, .react-flow__minimap")),
    };
  });
}

async function waitForRenderedNode(page, nodeId, timeout = 10_000) {
  await page.waitForFunction((id) => {
    const node = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
    if (!(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
  }, nodeId, { timeout });
}

async function clickRenderedNode(page, nodeId) {
  // React Flow can complete the focus event before its virtualized node DOM
  // finishes the follow-up layout pass. Re-check the actual rendered node at
  // the click boundary so the audit does not race that legitimate repaint.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await waitForRenderedNode(page, nodeId, 2_000).catch(() => {});
    const point = await page.evaluate((id) => {
      const node = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
      if (!(node instanceof HTMLElement)) return undefined;
      const rect = node.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
      return visible ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
    }, nodeId);
    if (point) {
      await page.mouse.click(point.x, point.y);
      return;
    }
    await sleep(80);
  }
  throw new Error(`Rendered node was not found after layout retries: ${nodeId}`);
}

async function run() {
  const report = {
    ok: true,
    at: new Date().toISOString(),
    editorUrl: EDITOR_URL,
    logs: [],
    actions: [],
    screenshots: [],
  };
  let browser;
  let started = [];
  try {
    started = await ensureEditor(report);
    const fixturePath = path.join(OUT_DIR, "large-editor-project.vnproj");
    // The fixture measures graph rendering and interaction, not ZIP asset
    // packaging. Keep it as JSON so synthetic asset metadata cannot trigger
    // the production container path-safety checks.
    saveProjectContainerSync(fixturePath, buildProjectFixture(), { container: "json" });

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await installProjectStateWriteGuard(page, report);
    await openEditor(page);
    await installProbe(page);
    await page.evaluate(() => window.__AGENTVN_EDITOR_STORE__?.getState?.().resetGraph?.());
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length <= 3, null, { timeout: 30_000 }).catch(() => {});

    report.actions.push(await measure(
      page,
      "import-large-project",
      () => page.locator('[data-help-key="toolbar.importProject"] input[type="file"]').first().setInputFiles(fixturePath),
      async () => {
        await page.waitForFunction(() => window.__AGENTVN_EDITOR_STORE__?.getState?.().nodes?.length >= 180, null, { timeout: 60_000 });
      },
    ));
    await page.waitForFunction(
      () => Boolean(document.querySelector(".story-minimap, .react-flow__minimap")),
      null,
      { timeout: 8_000 },
    ).catch(() => {});
    const routeDiagnostics = await getImportedRouteDiagnostics(page);
    report.importedRoute = routeDiagnostics;
    if (!routeDiagnostics.importedNodeCount || !routeDiagnostics.farNodeId) {
      throw new Error(`Imported route diagnostics did not find imported nodes: ${JSON.stringify(routeDiagnostics)}`);
    }

    report.actions.push(await measure(
      page,
      "focus-imported-route",
      async () => {
        await page.evaluate((nodeId) => {
          window.dispatchEvent(new CustomEvent("agentvn:focus-canvas-node", {
            detail: { nodeId, select: true, zoom: 0.82, duration: 0 },
          }));
        }, routeDiagnostics.farNodeId);
      },
      async () => {
        await waitForRenderedNode(page, routeDiagnostics.farNodeId);
      },
    ));

    report.actions.push(await measure(
      page,
      "select-far-imported-node",
      async () => {
        await clickRenderedNode(page, routeDiagnostics.farNodeId);
      },
      async () => {
        await page.waitForFunction((nodeId) => window.__AGENTVN_EDITOR_STORE__?.getState?.().selectedNodeId === nodeId, routeDiagnostics.farNodeId, { timeout: 10_000 });
      },
    ));
    report.virtualization = await getImportedRouteDiagnostics(page);

    report.actions.push(await measure(
      page,
      "select-scene-node",
      async () => {
        const selected = await selectVisibleSceneNode(page);
        if (!selected) throw new Error("No visible scene node was available for selection.");
      },
      () => page.locator(".inspector-panel").waitFor({ state: "visible", timeout: 30_000 }),
    ));

    report.actions.push(await measure(
      page,
      "canvas-pan-and-zoom",
      async () => {
        const box = await page.locator(".flow-surface").boundingBox();
        const x = box ? box.x + box.width / 2 : 720;
        const y = box ? box.y + box.height / 2 : 500;
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, -480);
        await page.mouse.down();
        await page.mouse.move(x + 160, y + 90, { steps: 12 });
        await page.mouse.up();
      },
      () => page.waitForTimeout(420),
    ));

    report.actions.push(await measure(
      page,
      "open-advanced-tools",
      async () => {
        await page.keyboard.press("Escape").catch(() => {});
        await page.locator('.toolbar-settings-tools [data-help-key="toolbar.advanced"]').first().click({ force: true });
        if (!(await page.locator(".advanced-tools-panel").isVisible({ timeout: 2_000 }).catch(() => false))) {
          await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent("agentvn:open-advanced-tools", {
              detail: { id: `perf_editor_${Date.now()}`, tab: "settings" },
            }));
          });
        }
      },
      () => page.locator(".advanced-tools-panel").waitFor({ state: "visible", timeout: 30_000 }),
    ));

    const screenshot = path.join(OUT_DIR, "editor-ui-perf.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    report.screenshots.push(screenshot);
    await context.close();
    report.thresholds = thresholds;
    report.thresholdToleranceMs = thresholdToleranceMs;
    for (const action of report.actions) {
      action.thresholdFailures = evaluateThreshold(action);
      if (action.thresholdFailures.length > 0) report.ok = false;
    }
    const virtualizationFailures = [];
    if (!report.importedRoute?.miniMapVisible) virtualizationFailures.push("MiniMap did not appear after delayed large-project import.");
    if (!report.virtualization?.farNodeRendered) virtualizationFailures.push("Far imported node did not render after focus.");
    if (report.virtualization?.selectedNodeId !== report.importedRoute?.farNodeId) virtualizationFailures.push("Far imported node was not selectable after focus.");
    if (virtualizationFailures.length > 0) {
      report.ok = false;
      report.virtualizationFailures = virtualizationFailures;
    }
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopServices(started);
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
    console.table(report.actions.map((item) => ({
      label: item.label,
      ok: item.thresholdFailures?.length ? false : true,
      elapsedMs: Math.round(item.elapsedMs),
      maxLongTaskMs: Math.round(item.maxLongTaskMs),
      maxFrameGapMs: Math.round(item.maxFrameGapMs),
      nodeCount: item.nodeCount,
      renderedNodeCount: item.renderedNodeCount,
      mutationCount: item.mutationCount,
      resourceCount: item.resourceCount,
      thresholdFailures: item.thresholdFailures?.join("; ") ?? "",
    })));
    console.log(JSON.stringify({ ok: report.ok, reportPath: REPORT_PATH, screenshots: report.screenshots, error: report.error }, null, 2));
  }
  if (!report.ok) process.exit(1);
}

void run();
