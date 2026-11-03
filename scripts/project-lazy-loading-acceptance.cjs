const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "output", "playwright", "project-lazy-loading");
const testDir = path.join(root, "test_AgentVN", "project-lazy-loading");
const headed = process.argv.includes("--headed");
const pythonCommand = process.platform === "win32" ? "python.exe" : "python";
const viteCommand = path.join(root, "editor", "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error("Refusing to operate outside root workspace: " + resolved);
  }
  return resolved;
}

function resetOutputDirs() {
  for (const dir of [outputDir, testDir]) {
    const resolved = assertInsideRoot(dir);
    fs.rmSync(resolved, { recursive: true, force: true });
    fs.mkdirSync(resolved, { recursive: true });
  }
}

function stopDevServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

function spawnLogged(name, command, args, options) {
  const logFile = path.join(outputDir, name + ".log");
  const child = spawn(command, args, {
    ...options,
    shell: options?.shell ?? (process.platform === "win32" && /\.cmd$/i.test(command)),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const writeLog = (data) => fs.appendFileSync(logFile, data.toString());
  child.stdout.on("data", writeLog);
  child.stderr.on("data", writeLog);
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) writeLog("\n" + name + " exited with code " + code + "\n");
  });
  return child;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close(() => port ? resolve(port) : reject(new Error("Could not allocate a local port.")));
    });
  });
}

async function waitForHttp(url, label, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok || response.status < 500) return;
      lastError = new Error(label + " returned HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(label + " did not become ready at " + url + ": " + (lastError?.message || lastError || "timeout"));
}

function buildProject(projectId, title, nodeCount = 24) {
  const now = new Date().toISOString();
  const nodes = [
    {
      id: "start",
      type: "startNode",
      position: { x: 0, y: 0 },
      data: {
        nodeKind: "start",
        label: "Start",
        description: "Acceptance start node.",
        memoryMode: "hybrid",
        aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
        previewState: { currentCommandIndex: 0, isPlaying: false },
        editorMeta: { collapsedInspectorSections: [], source: "manual" },
      },
    },
  ];
  for (let index = 1; index < nodeCount; index += 1) {
    nodes.push({
      id: "scene_" + index,
      type: "sceneNode",
      position: { x: 220 + index * 20, y: 100 + (index % 6) * 80 },
      data: {
        nodeKind: "scene",
        label: "Scene " + index,
        description: "Lazy loading acceptance scene " + index,
        memoryMode: "hybrid",
        aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
        previewState: { currentCommandIndex: 0, isPlaying: false },
        editorMeta: { collapsedInspectorSections: [], source: "manual" },
        scene: {
          scene_id: "scene_" + index,
          title: "Scene " + index,
          summary: "Acceptance scene " + index,
          chapter: 1,
          tags: ["acceptance"],
          commands: [
            { type: "narration", text: "This scene proves the full project detail was hydrated on demand." },
          ],
        },
      },
    });
  }
  const edges = nodes.slice(1).map((node, index) => ({
    id: "edge_" + index,
    source: index === 0 ? "start" : "scene_" + index,
    target: node.id,
    sourceHandle: "default",
  }));
  return {
    schema_version: "1.0.0",
    project_id: projectId,
    title,
    author: "Automation QA",
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.82 },
    memory_mode: "hybrid",
    asset_manifest: [],
    editor_settings: {},
    created_at: now,
    updated_at: now,
  };
}

async function startBackend(port, dbPath) {
  const child = spawnLogged("backend-dev", pythonCommand, ["backend_launcher.py"], {
    cwd: path.join(root, "backend"),
    env: {
      ...process.env,
      AGENTVN_BACKEND_HOST: "127.0.0.1",
      AGENTVN_BACKEND_PORT: String(port),
      DATABASE_PATH: dbPath,
    },
  });
  await waitForHttp("http://127.0.0.1:" + port + "/api/health", "backend");
  return child;
}

async function startEditor(port) {
  const child = spawnLogged("editor-dev", viteCommand, ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: path.join(root, "editor"),
    env: process.env,
  });
  await waitForHttp("http://127.0.0.1:" + port + "/", "editor");
  return child;
}

async function seedBackend(backendPort, project) {
  const response = await fetch("http://127.0.0.1:" + backendPort + "/api/project/projects/" + encodeURIComponent(project.project_id), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!response.ok) throw new Error("Failed to seed backend project: HTTP " + response.status + " " + await response.text());
}

async function installBackendProxy(page, backendPort, requestLog) {
  await page.route("http://127.0.0.1:8278/**", async (route) => {
    const request = route.request();
    const sourceUrl = new URL(request.url());
    const pathAndQuery = sourceUrl.pathname + sourceUrl.search;
    const entry = {
      method: request.method(),
      path: sourceUrl.pathname,
      query: sourceUrl.search,
      url: request.url(),
      postDataSize: request.postDataBuffer()?.length || 0,
    };
    requestLog.push(entry);
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type,authorization",
        },
        body: "",
      });
      return;
    }
    const targetUrl = "http://127.0.0.1:" + backendPort + pathAndQuery;
    const headers = { ...request.headers() };
    delete headers.host;
    const response = await fetch(targetUrl, {
      method: request.method(),
      headers,
      body: ["GET", "HEAD"].includes(request.method()) ? undefined : request.postDataBuffer(),
    });
    const body = Buffer.from(await response.arrayBuffer());
    entry.status = response.status;
    entry.responseSize = body.length;
    entry.responseJson = response.headers.get("content-type")?.includes("application/json")
      ? JSON.parse(body.toString("utf8"))
      : undefined;
    const responseHeaders = Object.fromEntries(response.headers.entries());
    responseHeaders["access-control-allow-origin"] = "*";
    await route.fulfill({
      status: response.status,
      headers: responseHeaders,
      body,
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findRequest(log, method, path) {
  return log.find((entry) => entry.method === method && entry.path === path);
}

async function installBrowserDefaults(page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    const nativeMatchMedia = window.matchMedia?.bind(window);
    window.matchMedia = (query) => {
      if (String(query).includes("prefers-reduced-motion")) {
        return {
          matches: true,
          media: String(query),
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        };
      }
      return nativeMatchMedia
        ? nativeMatchMedia(query)
        : {
          matches: false,
          media: String(query),
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        };
    };
  });
}

async function waitForHomeReady(page) {
  await page.locator('[data-help-key="home.recentProject"]').first().waitFor({ state: "visible", timeout: 20000 });
  await waitForOverlayGone(page);
}

async function waitForOverlayGone(page) {
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"), null, { timeout: 20000 });
}

async function runEditorLazyLoadingCheck(page, editorUrl, project) {
  const requestLog = [];
  await installBackendProxy(page, globalThis.__backendPortForAcceptance, requestLog);
  await installBrowserDefaults(page);
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await waitForHomeReady(page);
  await page.screenshot({ path: path.join(outputDir, "home-catalog.png"), fullPage: true });

  const stateRequest = requestLog.find((entry) => entry.method === "GET" && entry.path === "/api/project/state");
  assert(stateRequest, "Editor did not request /api/project/state on startup.");
  assert(
    stateRequest.query.includes("include_project=false") && stateRequest.query.includes("include_recent_projects=false"),
    "Startup state request did not disable project/recent project payloads: " + stateRequest.query
  );
  assert(findRequest(requestLog, "GET", "/api/project/catalog"), "Editor did not request /api/project/catalog on startup.");
  assert(
    !requestLog.some((entry) => entry.method === "GET" && entry.path.startsWith("/api/project/projects/")),
    "Editor requested full project detail before the user selected a project."
  );
  const catalogResponse = findRequest(requestLog, "GET", "/api/project/catalog")?.responseJson;
  assert(Array.isArray(catalogResponse?.data), "Catalog response did not contain data array.");
  assert(!("project" in catalogResponse.data[0]), "Catalog leaked full project detail in the summary response.");
  assert(catalogResponse.data[0].node_count === project.nodes.length, "Catalog node_count did not come from summary storage.");
  const homeText = await page.locator(".recent-project-item").first().innerText();
  assert(homeText.includes(project.title), "Home page did not render catalog project title.");
  assert(homeText.includes(String(project.nodes.length)), "Home page did not render catalog node count.");

  await page.locator('[data-help-key="home.recentProject"]').first().click();
  try {
    await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 25000 });
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, "editor-toolbar-timeout.png"), fullPage: true }).catch(() => undefined);
    const diagnostics = await page.evaluate(() => ({
      bodyText: document.body.innerText.slice(0, 1000),
      overlay: Boolean(document.querySelector(".project-entry-loading-overlay")),
      recentCount: document.querySelectorAll('[data-help-key="home.recentProject"]').length,
      toolbarCount: document.querySelectorAll(".editor-toolbar").length,
      route: location.href,
    })).catch(() => undefined);
    throw new Error("Editor toolbar did not appear after opening project. Diagnostics: " + JSON.stringify(diagnostics) + ". " + (error instanceof Error ? error.message : String(error)));
  }
  await waitForOverlayGone(page);
  await page.screenshot({ path: path.join(outputDir, "editor-after-detail-load.png"), fullPage: true });
  const detailGets = requestLog.filter((entry) => entry.method === "GET" && entry.path === "/api/project/projects/" + project.project_id);
  assert(detailGets.length === 1, "Expected exactly one detail GET after opening the project, got " + detailGets.length + ".");
  assert(Array.isArray(detailGets[0].responseJson?.data?.nodes), "Detail GET did not return full project nodes.");
  return requestLog;
}

async function runTimelineCheck(page, editorUrl, project, timelineProject) {
  const requestLog = [];
  const ipcEntry = {
    file_name: "lazy-project-restore.vnproj",
    project_id: project.project_id,
    title: "Timeline Metadata Only",
    created_at: timelineProject.created_at,
    updated_at: timelineProject.updated_at,
    timestamp_ms: Date.now(),
    node_count: null,
    edge_count: null,
    trigger: "manual_save",
    content_hash: "acceptance-hash",
  };
  await installBackendProxy(page, globalThis.__backendPortForAcceptance, requestLog);
  await installBrowserDefaults(page);
  await page.addInitScript(({ ipcEntry, timelineProject }) => {
    window.__PROJECT_LAZY_ACCEPTANCE_IPC_CALLS__ = [];
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        window.__PROJECT_LAZY_ACCEPTANCE_IPC_CALLS__.push({ cmd, args });
        if (cmd === "list_project_backups") return [ipcEntry];
        if (cmd === "read_project_backup") return JSON.stringify(timelineProject);
        if (cmd === "write_project_backup") return { ...ipcEntry, trigger: args?.trigger || "write_project_backup" };
        throw new Error("Unexpected Tauri command in acceptance test: " + cmd);
      },
      transformCallback: () => Math.floor(Math.random() * 1000000),
      unregisterCallback: () => {},
      runCallback: () => {},
      convertFileSrc: (value) => value,
    };
  }, { ipcEntry, timelineProject });
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await waitForHomeReady(page);
  await page.locator('[data-help-key="home.recentProject"]').first().click();
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 25000 });
  await waitForOverlayGone(page);

  await page.locator('[data-help-key="toolbar.timeline"]').click({ force: true });
  await page.locator(".project-timeline-panel").waitFor({ state: "visible", timeout: 10000 });
  await page.locator('[data-help-key="timeline.entry"]').first().waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: path.join(outputDir, "timeline-list.png"), fullPage: true });
  let ipcCalls = await page.evaluate(() => window.__PROJECT_LAZY_ACCEPTANCE_IPC_CALLS__);
  assert(ipcCalls.filter((call) => call.cmd === "list_project_backups").length >= 1, "Timeline list did not call list_project_backups.");
  assert(!ipcCalls.some((call) => call.cmd === "read_project_backup"), "Timeline list read a full backup before restore confirmation.");
  const timelineText = await page.locator('[data-help-key="timeline.entry"]').first().innerText();
  assert(timelineText.includes("?"), "Timeline metadata fallback did not show unknown node/edge counts.");

  await page.locator('[data-help-key="timeline.entry"]').first().click({ force: true });
  await page.locator('[data-help-key="timeline.restoreConfirm"]').click({ force: true });
  await page.waitForFunction(() => {
    return window.__PROJECT_LAZY_ACCEPTANCE_IPC_CALLS__.some((call) => call.cmd === "read_project_backup");
  }, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll(".editor-toolbar")).length > 0;
  }, null, { timeout: 10000 });
  ipcCalls = await page.evaluate(() => window.__PROJECT_LAZY_ACCEPTANCE_IPC_CALLS__);
  assert(ipcCalls.some((call) => call.cmd === "read_project_backup"), "Restore confirmation did not read the selected backup detail.");
  const restorePuts = requestLog.filter((entry) => entry.method === "PUT" && entry.path === "/api/project/projects/" + timelineProject.project_id);
  assert(restorePuts.length >= 1, "Restore did not persist through the project detail API.");
  const restoredDetail = await fetch("http://127.0.0.1:" + globalThis.__backendPortForAcceptance + "/api/project/projects/" + encodeURIComponent(timelineProject.project_id)).then((res) => res.json());
  assert(restoredDetail.data?.title === timelineProject.title, "Restored backend project title did not match timeline backup detail.");
  await page.screenshot({ path: path.join(outputDir, "timeline-restored.png"), fullPage: true });
  return { requestLog, ipcCalls };
}

async function main() {
  resetOutputDirs();
  const backendPort = await getFreePort();
  const editorPort = await getFreePort();
  globalThis.__backendPortForAcceptance = backendPort;
  const dbPath = path.join(testDir, "project-lazy-loading.sqlite");
  const project = buildProject("lazy_acceptance_project", "Huge Catalog Project", 123);
  const timelineProject = buildProject("lazy_acceptance_project", "Restored Timeline Detail", 42);
  const report = {
    startedAt: new Date().toISOString(),
    backendPort,
    editorPort,
    dbPath,
    checks: [],
    artifacts: { outputDir, testDir },
  };
  const children = [];
  try {
    children.push(await startBackend(backendPort, dbPath));
    await seedBackend(backendPort, project);
    report.checks.push("seeded real FastAPI backend project detail and catalog summary");
    children.push(await startEditor(editorPort));

    const browser = await chromium.launch({ headless: !headed });
    try {
      const editorUrl = "http://127.0.0.1:" + editorPort + "/";
      const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
      report.lazyLoading = await runEditorLazyLoadingCheck(page, editorUrl, project);
      report.checks.push("editor home requested lightweight state/catalog and deferred project detail until user click");
      await page.close();

      const timelinePage = await browser.newPage({ viewport: { width: 1440, height: 920 } });
      report.timeline = await runTimelineCheck(timelinePage, editorUrl, project, timelineProject);
      report.checks.push("timeline listed metadata only, read backup detail only after restore confirmation, and saved via detail API");
      await timelinePage.close();
    } finally {
      await browser.close();
    }
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "project-lazy-loading-report.json"), JSON.stringify(report, null, 2), "utf8");
    for (const child of children.reverse()) stopDevServer(child);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
