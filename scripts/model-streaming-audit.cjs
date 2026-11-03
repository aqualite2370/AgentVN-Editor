const { chromium } = require("../editor/node_modules/playwright");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const editorDir = path.join(root, "editor");
const outRoot = path.join(root, "output", "playwright", "model-streaming-audit");
const resultPath = path.join(outRoot, "model-streaming-audit.json");
const fixturePath = path.join(outRoot, "streaming-fixture.txt");

function parseArgs(argv) {
  const args = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const eq = item.indexOf("=");
    if (eq >= 0) {
      args.set(item.slice(0, eq), item.slice(eq + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args.set(item, next);
      index += 1;
    } else {
      flags.add(item);
    }
  }
  return { args, flags };
}

const { args, flags } = parseArgs(process.argv.slice(2));
const headed = flags.has("--headed");
const keepServers = flags.has("--keep-servers");

fs.mkdirSync(outRoot, { recursive: true });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function sharedState(mockBaseUrl) {
  const now = new Date().toISOString();
  return {
    provider_connections: [
      {
        connection_id: "mock_stream_conn",
        provider_type: "openai_compatible",
        display_name: "Mock streaming backend",
        base_url: mockBaseUrl,
        api_key_storage: "local",
        enabled: true,
        supports_model_discovery: false,
        created_at: now,
        updated_at: now,
      },
    ],
    provider_models: [
      {
        provider_id: "mock_stream_text",
        connection_id: "mock_stream_conn",
        model_id: "mock-stream-model",
        model_name: "mock-stream-model",
        display_name: "Mock Stream Model",
        enabled: true,
        capabilities: ["text_generation", "prompt_rewrite"],
        default_parameters: {
          temperature: 0.2,
          top_p: 0.9,
          max_tokens: 4096,
          structured_mode: "json_object",
          request_timeout_seconds: 300,
          context_budget_tokens: 24000,
          thinking_mode: false,
        },
        created_at: now,
        updated_at: now,
      },
    ],
    provider_selections: {
      text_generation: "mock_stream_text",
      prompt_rewrite: "mock_stream_text",
    },
    provider_secrets: {
      mock_stream_conn: "sk-test-streaming",
    },
    project_graph: {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      memoryMode: "hybrid",
    },
    project_metadata: {
      title: "Streaming Audit Project",
      author: "AgentVN",
      assetManifest: [],
      settings: {},
    },
    recent_projects: [],
  };
}

function openApiPaths() {
  const paths = {};
  for (const route of [
    "/api/novel/import/ai_scan_chunk",
    "/api/novel/import/ai_scan_chunk_stream",
    "/api/novel/import/ai_build_outline",
    "/api/novel/import/ai_build_outline_stream",
    "/api/novel/import/ai_plan_chapter",
    "/api/novel/import/ai_plan_chapter_stream",
    "/api/novel/import/ai_adapt_scene",
    "/api/novel/import/ai_adapt_scene_stream",
  ]) {
    paths[route] = { post: {} };
  }
  return { openapi: "3.0.0", info: { title: "AgentVN streaming mock", version: "0.1.0" }, paths };
}

function character(id, name) {
  return {
    character_id: id,
    name,
    aliases: [],
    first_seen_offset: 0,
    description: `${name} is part of the streaming audit fixture.`,
    speaking_style_hint: null,
    confidence: 0.95,
  };
}

function chapter(endOffset) {
  return {
    chapter_id: "chapter_streaming",
    title: "Streaming Chapter",
    index: 0,
    start_offset: 0,
    end_offset: endOffset,
    summary: "Alice and Bob meet during a rainstorm.",
    confidence: 0.95,
  };
}

function sceneCandidate(endOffset) {
  return {
    scene_candidate_id: "scene_candidate_streaming",
    chapter_id: "chapter_streaming",
    title: "Station Promise",
    display_name: "Station Promise",
    index: 0,
    start_offset: 0,
    end_offset: endOffset,
    location_hint: "station",
    time_hint: "night",
    characters: ["alice", "bob"],
    source_span: { start_offset: 0, end_offset: endOffset },
    source_excerpt: "Alice meets Bob at the station. They choose whether to reveal the clue.",
    summary: "Alice and Bob decide whether to reveal a hidden clue.",
    commands: [
      { type: "background", background_id: "bg_station", transition: "fade" },
      { type: "narration", text: "Rain taps on the old station roof." },
      { type: "dialog", character_id: "alice", text: "We should decide before the last train leaves.", emotion: "focused" },
    ],
    confidence: 0.95,
  };
}

function sceneBeat() {
  return {
    scene_id: "scene_streaming_station",
    scene_display_name: "Station Promise",
    title: "Station Promise",
    summary: "Alice and Bob choose a careful mainline path.",
    chapter: 1,
    commands: [
      { type: "background", background_id: "bg_station", transition: "fade" },
      { type: "narration", text: "Rain taps on the old station roof." },
      { type: "dialog", character_id: "alice", text: "We should decide before the last train leaves.", emotion: "focused" },
      { type: "dialog", character_id: "bob", text: "Then we tell the truth, but only to the right person.", emotion: "steady" },
    ],
    tags: ["novel_import", "streaming_audit"],
  };
}

async function streamSequence(res, events, endpoint, steps) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  events.push({ endpoint, type: "start-sent", at: Date.now() });
  sse(res, "start", { ok: true });
  for (const step of steps) {
    await delay(step.delayMs ?? 0);
    events.push({ endpoint, type: `${step.event}-sent`, text: typeof step.data === "string" ? step.data : undefined, at: Date.now() });
    sse(res, step.event, step.data);
  }
  await delay(50);
  events.push({ endpoint, type: "done-sent", at: Date.now() });
  sse(res, "done", { ok: true });
  res.end();
}

async function startMockBackend(port) {
  const events = [];
  let state = sharedState(`http://127.0.0.1:${port}`);
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (req.method === "GET" && url.pathname === "/openapi.json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(openApiPaths()));
      return;
    }
    if (url.pathname === "/api/health") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/api/project/state") {
      if (req.method === "POST") {
        const patch = await readJsonBody(req);
        state = { ...state, ...patch };
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, data: state }));
      return;
    }
    if (url.pathname === "/api/project/catalog") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, data: [] }));
      return;
    }
    if (url.pathname.startsWith("/api/project/projects/")) {
      if (req.method === "PUT") {
        const project = await readJsonBody(req);
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true, data: project }));
        return;
      }
      if (req.method === "DELETE") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true, deleted: true }));
        return;
      }
    }
    if (req.method !== "POST") {
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: "not found" }));
      return;
    }
    const body = await readJsonBody(req);
    const endOffset = Number(body.end_offset ?? body.total_chars ?? body.chapter?.end_offset ?? 180) || 180;
    if (url.pathname === "/api/novel/import/ai_scan_chunk_stream") {
      const analysis = {
        chunk_id: body.chunk_id || "chunk_streaming",
        index: Number(body.index ?? 0),
        summary: "Mock scan completed for the station chapter.",
        chapter_candidates: [chapter(endOffset)],
        characters: [character("alice", "Alice"), character("bob", "Bob")],
        locations: ["station"],
        timeline: ["night rain", "final train"],
        foreshadowing: ["Alice can reveal or hide the clue."],
        warnings: [],
        confidence: 0.96,
      };
      await streamSequence(res, events, "scan", [
        { event: "status", data: "Scanning chunk with mock streaming model.", delayMs: 20 },
        { event: "delta", data: "scan-delta-1: reading station setup...\n", delayMs: 120 },
        { event: "delta", data: "scan-delta-2: extracting characters and timeline...\n", delayMs: 120 },
        { event: "checkpoint", data: { stage: "summary", payload: { chunk_id: analysis.chunk_id, index: analysis.index, summary: analysis.summary, confidence: 0.96, warnings: [] } }, delayMs: 120 },
        { event: "final", data: analysis, delayMs: 1400 },
      ]);
      return;
    }
    if (url.pathname === "/api/novel/import/ai_build_outline_stream") {
      const outline = {
        document_id: body.document_id || "doc_streaming",
        title: body.title || "Streaming Fixture",
        summary: "A short mystery about choosing whether to reveal a clue.",
        main_plot: "Alice and Bob meet at a station and keep the mainline focused on a careful truth reveal.",
        chapters: [chapter(endOffset)],
        characters: [character("alice", "Alice"), character("bob", "Bob")],
        timeline: ["Alice arrives", "Bob confirms the clue", "They choose a mainline path"],
        locations: ["station"],
        branch_or_foreshadowing: ["Optional branch: hide the clue temporarily."],
        conflict_points: [],
        warnings: [],
        needs_review: false,
        coverage_confidence: 0.96,
      };
      await streamSequence(res, events, "outline", [
        { event: "status", data: "Building full outline with mock streaming model.", delayMs: 20 },
        { event: "delta", data: "outline-delta-1: composing mainline...\n", delayMs: 120 },
        { event: "delta", data: "outline-delta-2: indexing characters...\n", delayMs: 120 },
        { event: "checkpoint", data: { stage: "mainline", payload: { document_id: outline.document_id, title: outline.title, summary: outline.summary, main_plot: outline.main_plot, needs_review: false, coverage_confidence: 0.96, warnings: [] } }, delayMs: 120 },
        { event: "final", data: outline, delayMs: 1400 },
      ]);
      return;
    }
    if (url.pathname === "/api/novel/import/ai_plan_chapter_stream") {
      const candidate = sceneCandidate(endOffset);
      const response = {
        chapter_id: "chapter_streaming",
        scenes: [candidate],
        conflict_points: [
          {
            conflict_id: "conflict_reveal_clue",
            source_scene_id: candidate.scene_candidate_id,
            source_scene_display_name: candidate.display_name,
            conflict_type: "branch_opportunity",
            description: "Alice can reveal the clue now or delay the reveal.",
            mainline_resolution: "Reveal carefully on the mainline.",
            suggests_branch: true,
            confidence: 0.8,
            branch_suggestion_ids: ["branch_hide_clue"],
          },
        ],
        branch_suggestions: [
          {
            suggestion_id: "branch_hide_clue",
            source_scene_id: candidate.scene_candidate_id,
            source_scene_display_name: candidate.display_name,
            choice_display_name: "Hide the clue",
            choice_text: "Keep the clue secret for now.",
            branch_summary: "Alice delays the reveal, creating a later trust repair scene.",
            confidence: 0.82,
            enabled_by_default: false,
          },
        ],
        warnings: [],
        needs_review: false,
      };
      await streamSequence(res, events, "plan", [
        { event: "status", data: "Planning chapter scenes with mock streaming model.", delayMs: 20 },
        { event: "delta", data: "plan-delta-1: splitting source span...\n", delayMs: 120 },
        { event: "delta", data: "plan-delta-2: drafting branch suggestion...\n", delayMs: 120 },
        { event: "checkpoint", data: { stage: "scene_plan", payload: { chapter_id: response.chapter_id, scenes: response.scenes, warnings: [], needs_review: false } }, delayMs: 120 },
        { event: "final", data: response, delayMs: 1400 },
      ]);
      return;
    }
    if (url.pathname === "/api/novel/import/ai_adapt_scene_stream") {
      const beat = sceneBeat();
      const response = {
        adapted_scene: {
          adapted_scene_id: "adapted_scene_candidate_streaming",
          source_scene_candidate_id: body.scene_candidate?.scene_candidate_id || "scene_candidate_streaming",
          scene_beat: beat,
          source_mapping: {
            document_id: body.scene_candidate?.chapter_id || "chapter_streaming",
            start_offset: 0,
            end_offset: endOffset,
            source_excerpt: "Alice meets Bob at the station. They choose whether to reveal the clue.",
            adapted_command_ids: ["cmd_1", "cmd_2", "cmd_3", "cmd_4"],
          },
          warnings: [],
          needs_review: false,
        },
        character_updates: [character("alice", "Alice"), character("bob", "Bob")],
        asset_suggestions: [],
        branch_suggestions: [],
        conflict_points: [],
        warnings: [],
      };
      await streamSequence(res, events, "adapt", [
        { event: "status", data: "Adapting scene with mock streaming model.", delayMs: 20 },
        { event: "delta", data: "adapt-delta-public-1: preparing public adaptation notes...\n", delayMs: 120 },
        { event: "delta", data: "adapt-delta-public-2: writing dialogue commands...\n", delayMs: 120 },
        { event: "checkpoint", data: { stage: "scene_beat", payload: beat }, delayMs: 120 },
        { event: "final", data: response, delayMs: 1400 },
      ]);
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ detail: `No mock route for ${url.pathname}` }));
  });
  await new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return { server, sockets, events, getState: () => state };
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || "no response"}`);
}

async function startEditor(port, mockBaseUrl) {
  const viteJs = path.join(editorDir, "node_modules", "vite", "bin", "vite.js");
  const command = process.execPath;
  const spawnArgs = [viteJs, "--host", "127.0.0.1", "--port", String(port)];
  const child = spawn(command, spawnArgs, {
    cwd: editorDir,
    env: { ...process.env, VITE_BACKEND_URL: mockBaseUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  const url = `http://127.0.0.1:${port}/`;
  await waitForHttp(url, 45000).catch((error) => {
    child.kill();
    error.message += `\nVite logs:\n${logs.join("")}`;
    throw error;
  });
  return { child, url, logs };
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function closeMockBackend(mock) {
  mock.server.closeAllConnections?.();
  for (const socket of mock.sockets) socket.destroy();
  await Promise.race([
    new Promise((resolve) => mock.server.close(resolve)),
    delay(1000),
  ]);
}

async function clickIfVisible(locator, timeout = 1200) {
  if (await locator.isVisible({ timeout }).catch(() => false)) {
    await locator.click({ force: true });
    return true;
  }
  return false;
}

async function waitForEditorReady(page) {
  await page.waitForFunction(() => {
    const stage = document.querySelector(".app-transition-stage");
    return !document.querySelector(".project-entry-loading-overlay") &&
      !stage?.classList.contains("is-switching") &&
      !stage?.classList.contains("is-enter-cartridge") &&
      !stage?.classList.contains("is-project-entry-loading");
  }, null, { timeout: 30000 });
}

async function openNovelImport(page, editorUrl, state) {
  await page.route("http://127.0.0.1:8278/api/project/state", async (route) => {
    if (route.request().method() === "POST") {
      const patch = route.request().postDataJSON();
      Object.assign(state, patch);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: state }),
    });
  });
  await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator('[data-help-key="home.createProject"]').first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button[data-help-key="home.createProject"]'));
    return buttons.some((button) => !button.disabled && button.getBoundingClientRect().width > 0);
  }, null, { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button[data-help-key="home.createProject"]'))
      .find((item) => !item.disabled && item.getBoundingClientRect().width > 0);
    button?.click();
  });
  await waitForEditorReady(page);
  await page.locator(".editor-workspace").first().waitFor({ state: "visible", timeout: 15000 });
  await page.locator('[data-workspace-surface="assistant"]:visible').first().waitFor({ state: "visible", timeout: 15000 });
  await page.addStyleTag({
    content: ".floating-command-workbench{display:none!important;pointer-events:none!important;}",
  });
  await page.locator('[data-workspace-surface="assistant"]:visible').first().click({ force: true });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("agentvn:open-advanced-tools", {
      detail: {
        id: `streaming-audit-${Date.now()}`,
        tab: "novel",
        title: "Streaming audit",
        message: "Open novel import for model streaming audit.",
        action: "Open novel import",
      },
    }));
  });
  await page.locator('[data-testid="novel-import-workbench"], .toolbar-popover.advanced').first().waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".novel-import-wizard .novel-ai-landing").waitFor({ state: "visible", timeout: 15000 });
}

async function waitForStreamText(page, endpoint, text, events, timeout = 1400) {
  const started = Date.now();
  await page.waitForFunction(
    (needle) => document.querySelector(".novel-model-stream-body pre")?.textContent?.includes(needle),
    text,
    { timeout },
  );
  const visibleAt = Date.now();
  const delta = events.find((event) => event.endpoint === endpoint && event.type === "delta-sent" && event.text?.includes(text));
  const final = events.find((event) => event.endpoint === endpoint && event.type === "final-sent");
  return {
    endpoint,
    text,
    startedAt: started,
    visibleAt,
    deltaSentAt: delta?.at,
    latencyMs: delta ? visibleAt - delta.at : undefined,
    finalAlreadySent: Boolean(final && final.at <= visibleAt),
    finalSentAt: final?.at,
  };
}

async function main() {
  const mockPort = Number(args.get("--mock-port")) || await getFreePort();
  const editorPort = Number(args.get("--editor-port")) || await getFreePort();
  const mockBaseUrl = `http://127.0.0.1:${mockPort}`;
  const mock = await startMockBackend(mockPort);
  let editor;
  let browser;
  let page;
  const checks = [];
  const failures = [];
  try {
    editor = await startEditor(editorPort, mockBaseUrl);
    fs.writeFileSync(
      fixturePath,
      [
        "Alice meets Bob at the station while rain falls.",
        "",
        "Alice says, \"We should decide before the last train leaves.\"",
        "Bob answers, \"Then we tell the truth, but only to the right person.\"",
      ].join("\n"),
      "utf8",
    );
    browser = await chromium.launch({ headless: !headed });
    page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await openNovelImport(page, editor.url, mock.getState());
    await page.locator('.novel-import-wizard input[type="file"]').first().setInputFiles(fixturePath);
    const importReadyState = await page.waitForFunction(() => {
      const branchOptions = document.querySelector('input[data-help-key="novel.branchSuggestions"]');
      if (branchOptions) return "options-ready";
      const directButton = document.querySelector('button[data-help-key="novel.continueDirect"]');
      if (directButton instanceof HTMLButtonElement && !directButton.disabled && directButton.offsetParent !== null) return "continue-direct";
      return false;
    }, null, { timeout: 15000 });
    const importPath = await importReadyState.jsonValue();
    if (importPath === "continue-direct") {
      const directButton = page.locator('button[data-help-key="novel.continueDirect"]:visible:not(:disabled)').first();
      await directButton.waitFor({ state: "visible", timeout: 10000 });
      await directButton.evaluate((button) => button.click());
    } else {
      await page.locator('input[data-help-key="novel.branchSuggestions"]').waitFor({ state: "attached", timeout: 10000 });
      await page.locator('input[data-help-key="novel.branchSuggestions"]').setChecked(true);
    }
    await page.waitForFunction(() => {
      const button = document.querySelector('button[data-help-key="novel.aiStart"]');
      return button && !button.disabled;
    }, null, { timeout: 10000 });
    await page.locator('button[data-help-key="novel.aiStart"]').evaluate((button) => button.click());
    checks.push(await waitForStreamText(page, "scan", "scan-delta-1", mock.events));
    checks.push(await waitForStreamText(page, "outline", "outline-delta-1", mock.events, 6000));
    await page.locator('button[data-help-key="novel.confirmOutline"]').waitFor({ state: "visible", timeout: 10000 });
    await page.locator('button[data-help-key="novel.confirmOutline"]').evaluate((button) => button.click());
    checks.push(await waitForStreamText(page, "plan", "plan-delta-1", mock.events, 6000));
    checks.push(await waitForStreamText(page, "adapt", "adapt-delta-public-1", mock.events, 8000));
    await delay(1700);
    for (const check of checks) {
      if (typeof check.latencyMs !== "number") failures.push(`${check.endpoint} delta server event was not recorded for ${check.text}.`);
      else if (check.latencyMs > 300) failures.push(`${check.endpoint} delta became visible ${check.latencyMs}ms after server sent it, expected <= 300ms.`);
      if (check.finalAlreadySent) failures.push(`${check.endpoint} final was sent before delta text became visible.`);
    }
    await page.screenshot({ path: path.join(outRoot, "final-streaming-state.png"), fullPage: false }).catch(() => {});
  } catch (error) {
    failures.push(error instanceof Error ? error.stack || error.message : String(error));
    if (page) {
      await page.screenshot({ path: path.join(outRoot, "failure-state.png"), fullPage: false }).catch(() => {});
    }
  } finally {
    const result = {
      ok: failures.length === 0,
      mockBaseUrl,
      editorUrl: editor?.url,
      checks,
      events: mock.events,
      failures,
      artifacts: {
        resultPath,
        fixturePath,
        screenshot: path.join(outRoot, "final-streaming-state.png"),
        failureScreenshot: path.join(outRoot, "failure-state.png"),
      },
    };
    writeJson(resultPath, result);
    if (browser) await browser.close().catch(() => {});
    if (!keepServers) {
      if (editor?.child) stopProcessTree(editor.child);
      await closeMockBackend(mock);
    }
    if (failures.length > 0) {
      console.error(`Model streaming audit failed. Report: ${resultPath}`);
      for (const failure of failures) console.error(`- ${failure}`);
      process.exitCode = 1;
    } else {
      console.log(`Model streaming audit passed. Report: ${resultPath}`);
    }
  }
}

void main();
