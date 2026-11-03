"use strict";
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { startOwnedViteServer } = require("./owned-vite-server.cjs");

const root = path.resolve(__dirname, "../..");
const viewports = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "1440p", width: 2560, height: 1440 },
  { name: "4k", width: 3840, height: 2160 },
  { name: "wide-short", width: 1920, height: 864 },
  { name: "android-logical", width: 915, height: 412 },
  { name: "short", width: 757, height: 299 },
  { name: "narrow", width: 390, height: 844 },
];

function resolveAcceptancePaths(options = {}) {
  const requireExplicit = options.requireExplicit !== false;
  const configuredInput = process.env.AGENTVN_TEST_PROJECT;
  const configuredOutput = process.env.AGENTVN_WORKSPACE_OUTPUT;
  if (requireExplicit && !configuredInput)
    throw new Error("AGENTVN_TEST_PROJECT must point to an isolated temporary .vnproj file.");
  if (requireExplicit && !configuredOutput)
    throw new Error("AGENTVN_WORKSPACE_OUTPUT must point to a new isolated report directory.");

  const input = configuredInput ? path.resolve(configuredInput) : null;
  const output = configuredOutput
    ? path.resolve(configuredOutput)
    : options.output
      ? path.resolve(options.output)
      : null;
  if (!input) throw new Error("Acceptance fixture input is missing.");
  if (!output) throw new Error("Acceptance report output directory is missing.");
  if (path.extname(input).toLowerCase() !== ".vnproj"
    || !fs.existsSync(input)
    || !fs.statSync(input).isFile()) {
    throw new Error(`Acceptance input must be an existing regular .vnproj file: ${input}`);
  }
  if (input === output)
    throw new Error("Acceptance input and report output must be different paths.");
  if (fs.existsSync(output)) {
    if (!fs.statSync(output).isDirectory())
      throw new Error(`Acceptance report output must be a directory: ${output}`);
    if (fs.readdirSync(output).length > 0)
      throw new Error(`Acceptance report output must be a new or empty directory: ${output}`);
  }

  const normalizedInput = input.toLowerCase().replaceAll("\\", "/");
  const forbiddenInput = [
    "/data/backup-timeline/",
    "/output/installer-resources-review",
    "hidden-growth",
    "隐忍的成长",
  ];
  if (forbiddenInput.some(marker => normalizedInput.includes(marker)))
    throw new Error(`Acceptance input appears to be a historical or user project; use an isolated temporary fixture: ${input}`);

  let fixtureProjectId = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(input, "utf8"));
    if (typeof parsed?.project_id === "string" && parsed.project_id.trim())
      fixtureProjectId = parsed.project_id.trim();
  } catch {
    // Binary/ZIP project packages are validated by their own import tests.
  }
  if (!fixtureProjectId)
    throw new Error(`Acceptance .vnproj must contain a non-empty project_id: ${input}`);

  return { input, output, fixtureProjectId, isolated: true };
}

function fixture(id) {
  const common = { description: "", memoryMode: "hybrid",
    aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
    previewState: { currentCommandIndex: 0, isPlaying: false },
    editorMeta: { collapsedInspectorSections: [], source: "manual" } };
  return {
    schema_version: "1.0.0", project_id: id, title: "新 UI 独立验收", author: "QA",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    memory_mode: "hybrid", viewport: { x: 0, y: 0, zoom: 1 }, asset_manifest: [],
    editor_settings: {},
    nodes: [
      { id: "start", type: "startNode", position: { x: 40, y: 200 },
        data: { ...common, nodeKind: "start", label: "入口" } },
      { id: "scene", type: "sceneNode", position: { x: 320, y: 180 },
        data: { ...common, nodeKind: "scene", label: "场景", scene: {
          scene_id: "ui_acceptance", title: "场景", summary: "", chapter: 1, tags: [],
          commands: [{ type: "narration", text: "本轮独立 UI 验收，不影响用户工程。" }],
        } } },
    ],
    edges: [{ id: "edge", source: "start", target: "scene", sourceHandle: "default" }],
  };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function startEditorAcceptance(output, options = {}) {
  const configured = resolveAcceptancePaths({ output });
  output = configured.output;
  fs.mkdirSync(output, { recursive: true });
  const backendPort = await freePort();
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const data = path.join(output, "isolated-data");
  const input = configured.input;
  const backendCwd = options.isolateBackendWorkingDirectory ? output : path.join(root, "backend");
  const backend = spawn(process.env.PYTHON || "python", [path.join(root, "backend/backend_launcher.py")], {
    cwd: backendCwd, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"], env: {
      ...process.env, AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_BACKEND_DATA_DIR: data,
      DATABASE_PATH: path.join(data, "vn_engine.db"),
      AGENTVN_BACKEND_PORT: String(backendPort), AGENTVN_LEGACY_DATABASE_PATHS: "",
    },
  });
  const log = fs.createWriteStream(path.join(output, "backend.log"), { flags: "wx" });
  for (const stream of [backend.stdout, backend.stderr]) stream.pipe(log, { end: false });
  let backendError;
  backend.on("error", error => { backendError = error; });
  let server, stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await server?.stop();
    if (backend.pid && backend.exitCode === null && backend.signalCode === null) {
      if (process.platform === "win32")
        spawnSync("taskkill.exe", ["/PID", String(backend.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" });
      else backend.kill("SIGTERM");
    }
    log.end();
  };
  try {
    const deadline = Date.now() + 90000;
    let healthy = false;
    while (Date.now() < deadline) {
      if (backendError) throw backendError;
      if (backend.exitCode !== null || backend.signalCode !== null)
        throw new Error(`Owned backend exited before readiness: ${backend.exitCode}/${backend.signalCode}`);
      try {
        healthy = (await fetch(`${backendUrl}/api/health`, { signal: AbortSignal.timeout(1000) })).ok;
        if (healthy) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!healthy) throw new Error("Owned backend readiness timed out");
    const previousUrl = process.env.VITE_BACKEND_URL;
    process.env.VITE_BACKEND_URL = backendUrl;
    try {
      server = await startOwnedViteServer({
        root: path.join(root, "editor"), logFile: path.join(output, "editor.log"),
      });
    } finally {
      if (previousUrl === undefined) delete process.env.VITE_BACKEND_URL;
      else process.env.VITE_BACKEND_URL = previousUrl;
    }
    return {
      url: server.url,
      input,
      output,
      fixtureProjectId: configured.fixtureProjectId,
      isolated: configured.isolated,
      backendUrl,
      backendPid: backend.pid,
      backendCwd,
      server,
      stop,
      async open(page) {
        await server.assertAlive();
        await page.goto(server.url, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
          .some(node => node instanceof HTMLInputElement && !node.disabled), undefined, { timeout: 60000 });
        await page.locator(".project-import-button input").first().setInputFiles(input);
        await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 60000 });
        await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

module.exports = { root, viewports, fixture, resolveAcceptancePaths, startEditorAcceptance };
