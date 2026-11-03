const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");
const { stopOwnedTestProcess } = require('./owned-test-process.cjs');

const root = path.resolve(__dirname, "..");
const exe = process.env.AGENTVN_TEST_PLAYER_EXE || path.join(root, "editor", "src-tauri", "binaries", "agentvn-player.exe");
const outDir = path.join(root, "output", "automated", "gamecli-preview-directory");
const previewBase = path.join(outDir, "gamecli-preview");
const currentDir = path.join(previewBase, "current");
const resultsDir = path.join(outDir, "results");
const portBase = Number(process.env.AGENTVN_PLAYER_CDP_PORT || 9341);
const editorExe = process.env.AGENTVN_TEST_EDITOR_EXE || path.join(root, "AgentVN Dev.exe");
const editorPort = Number(process.env.AGENTVN_EDITOR_CDP_PORT || 9477);
const editorPreviewCache = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"), "com.agentvn.editor", "gamecli-preview");
const desktopHostLog = path.join(root, "error_log", "editor-desktop.log");

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function writeJson(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8"); }
function shaFile(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }
function listFiles(dir, base = dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(full, base));
    else result.push(path.relative(base, full).replace(/\\/g, "/"));
  }
  return result;
}
function writeSparseFile(filePath, sizeBytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, "w");
  try {
    fs.writeSync(fd, Buffer.from([0]), 0, 1, Math.max(0, sizeBytes - 1));
  } finally {
    fs.closeSync(fd);
  }
}
function readTail(filePath, maxChars = 12000) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return text.length > maxChars ? text.slice(text.length - maxChars) : text;
  } catch {
    return "";
  }
}
function previewCacheSnapshot() {
  const exists = fs.existsSync(editorPreviewCache);
  const entries = exists ? fs.readdirSync(editorPreviewCache) : [];
  const files = exists ? listFiles(editorPreviewCache) : [];
  return {
    editorPreviewCache,
    exists,
    entries,
    files,
    vncartFiles: files.filter((file) => file.endsWith(".vncart")),
    currentHasRequired: ["manifest.json", "script.json", "checksum.json"].every((file) => fs.existsSync(path.join(editorPreviewCache, "current", file))),
    incomingExists: fs.existsSync(path.join(editorPreviewCache, "incoming")),
    incomingVncartExists: fs.existsSync(path.join(editorPreviewCache, "incoming.vncart")),
  };
}
async function waitForEditorDirectoryPreviewCache(timeoutMs = 180000) {
  const started = Date.now();
  let last = previewCacheSnapshot();
  while (Date.now() - started < timeoutMs) {
    last = previewCacheSnapshot();
    if (last.entries.includes("current") && last.currentHasRequired && !last.incomingExists && !last.incomingVncartExists && last.vncartFiles.length === 0) {
      return { ok: true, durationMs: Date.now() - started, snapshot: last };
    }
    await sleep(500);
  }
  return { ok: false, durationMs: Date.now() - started, snapshot: last };
}
function makeSvg(label, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${color}"/><circle cx="400" cy="280" r="160" fill="#fff" fill-opacity=".35"/><text x="80" y="540" font-size="54" fill="#fff">${label}</text></svg>`;
}
function createFixture(extraBytes) {
  fs.rmSync(previewBase, { recursive: true, force: true });
  fs.mkdirSync(path.join(currentDir, "assets", "background"), { recursive: true });
  fs.mkdirSync(path.join(currentDir, "assets", "sprite"), { recursive: true });
  fs.mkdirSync(path.join(currentDir, "assets", "other"), { recursive: true });
  fs.mkdirSync(path.join(currentDir, "ui"), { recursive: true });
  fs.writeFileSync(path.join(currentDir, "assets/background/bg.svg"), makeSvg("DIRECTORY BACKGROUND", "#123c69"));
  fs.writeFileSync(path.join(currentDir, "assets/sprite/hero.svg"), makeSvg("HERO SPRITE", "#7c2d12"));
  if (extraBytes > 0) writeSparseFile(path.join(currentDir, "assets/other/pad.bin"), extraBytes);
  const now = new Date().toISOString();
  const assets = [
    { asset_id: "bg", asset_type: "background", path: "assets/background/bg.svg", filename: "bg.svg", mime_type: "image/svg+xml", preload: true },
    { asset_id: "hero_sprite", asset_type: "sprite", path: "assets/sprite/hero.svg", filename: "hero.svg", mime_type: "image/svg+xml", preload: true },
  ];
  if (extraBytes > 0) assets.push({ asset_id: "large_padding", asset_type: "other", path: "assets/other/pad.bin", filename: "pad.bin", mime_type: "application/octet-stream", size_bytes: extraBytes });
  const manifest = {
    manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.2.0", game_id: "directory-preview-acceptance",
    title: "Directory Preview Acceptance", author: "Codex", description: "Directory preview real acceptance fixture", version: "1.0.0", language: "zh-CN",
    tags: ["automation"], shell: { background: "bg", background_fit: "cover" }, entry_script: "script.json", entry_scene_id: "scene_main", assets,
    ui_skin: { path: "ui/layout.json", version: "1.0.0", name: "Acceptance Skin" }, created_at: now, updated_at: now,
  };
  const script = { schema_version: "1.0.0", game_id: manifest.game_id, title: manifest.title, entry_scene_id: "scene_main", characters: [{ character_id: "hero", name: "Hero" }], scenes: [{ scene_id: "scene_main", title: "Main", summary: "", chapter: 1, tags: [], commands: [
    { type: "background", background_id: "bg", background_fit: "cover" },
    { type: "sprite", character_id: "hero", sprite_id: "hero_sprite", position: "center", visible: true },
    { type: "dialog", character_id: "hero", speaker: "Hero", text: "Directory preview loaded assets without a vncart upload." },
  ] }] };
  const ui = { ui_layout_version: "1.0.0", name: "Acceptance Skin", target_runtime: "0.2.0", tokens: { colorBackground: "#08111f", colorSurface: "#111827", colorInk: "#f8fafc", colorAccent: "#60a5fa", colorDialog: "#020617e8", colorDialogText: "#f8fafc", colorSpeakerPlate: "#1e3a8a", colorSpeakerText: "#fff", radius: 8, motionScale: 1, fontScale: 1 }, assets: [], screens: [{ screen_id: "player", label: "Player", components: [
    { component_id: "stage_background", component_type: "stage_background", required: true, rect: { x: 0, y: 0, width: 100, height: 100 }, style: {}, zIndex: 0 },
    { component_id: "dialog_panel", component_type: "dialog_panel", required: true, rect: { x: 4.8, y: 70.6, width: 91.2, height: 23.6 }, style: { backgroundColor: "#020617", padding: 0 }, zIndex: 30 },
    { component_id: "speaker_label", component_type: "speaker_label", rect: { x: 5.7, y: 72.2, width: 10.8, height: 4.8 }, style: { fontSize: 18, padding: 0 }, zIndex: 34 },
    { component_id: "dialog_text", component_type: "dialog_text", rect: { x: 6.6, y: 78.4, width: 82.2, height: 13.8 }, style: { fontSize: 24, lineHeight: 1.5, padding: 0 }, zIndex: 35 },
    { component_id: "continue_indicator", component_type: "continue_indicator", rect: { x: 84.9, y: 89, width: 7.4, height: 4 }, style: { fontSize: 13 }, zIndex: 36 },
  ] }] };
  writeJson(path.join(currentDir, "manifest.json"), manifest);
  writeJson(path.join(currentDir, "script.json"), script);
  writeJson(path.join(currentDir, "gallery.json"), { gallery_version: "1.0.0", items: [] });
  writeJson(path.join(currentDir, "ui/layout.json"), ui);
  const files = listFiles(currentDir).filter((file) => file !== "checksum.json");
  writeJson(path.join(currentDir, "checksum.json"), { checksum_version: "1.0.0", algorithm: "sha256", generated_at: now, files: files.map((relativePath) => ({ path: relativePath, size_bytes: fs.statSync(path.join(currentDir, relativePath)).size, hash_sha256: shaFile(path.join(currentDir, relativePath)) })) });
}
function createEditorDraft() {
  const now = new Date().toISOString();
  const baseNodeData = (nodeKind, label, description = "") => ({
    nodeKind,
    label,
    description,
    memoryMode: "hybrid",
    aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
    previewState: { currentCommandIndex: 0, isPlaying: false },
    editorMeta: { collapsedInspectorSections: [], source: "gamecli-preview-directory-real-acceptance" },
  });
  const scene = {
    scene_id: "scene_main",
    title: "目录预览入口场景",
    summary: "目录预览验收",
    chapter: 1,
    tags: [],
    commands: [{ type: "narration", text: "Editor button directory preview acceptance." }]
  };
  return {
    schema_version: "1.0.0",
    project_id: "directory_preview_editor_acceptance",
    title: "Directory Preview Editor Acceptance",
    author: "Codex",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 40, y: 180 },
        data: baseNodeData("start", "入口"),
      },
      {
        id: "node_scene_main",
        type: "sceneNode",
        position: { x: 340, y: 160 },
        data: { ...baseNodeData("scene", scene.title, scene.summary), scene },
      },
    ],
    edges: [{ id: "edge_start_scene_main", source: "start", target: "node_scene_main", sourceHandle: "default" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: [],
    editor_settings: {},
    created_at: now,
    updated_at: now,
  };
}
async function fetchJson(url) { const response = await fetch(url); if (!response.ok) throw new Error(`${url} ${response.status}`); return response.json(); }
async function waitForTarget(port) { const started = Date.now(); let last; while (Date.now() - started < 25000) { try { const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`); const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl) || targets.find((item) => item.webSocketDebuggerUrl); if (target) return target; } catch (error) { last = error; } await sleep(250); } throw new Error("CDP target not available: " + (last && last.message)); }
class CDP { constructor(url) { this.ws = new WebSocket(url); this.nextId = 1; this.pending = new Map(); } async open() { await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("websocket open timeout")), 10000); this.ws.onopen = () => { clearTimeout(timer); resolve(); }; this.ws.onerror = () => { clearTimeout(timer); reject(new Error("websocket error")); }; this.ws.onmessage = (event) => { const message = JSON.parse(event.data); if (!message.id || !this.pending.has(message.id)) return; const handlers = this.pending.get(message.id); this.pending.delete(message.id); if (message.error) handlers.reject(new Error(JSON.stringify(message.error))); else handlers.resolve(message.result); }; }); } send(method, params = {}, timeout = 15000) { const id = this.nextId++; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); setTimeout(() => { if (!this.pending.has(id)) return; this.pending.delete(id); reject(new Error(method + " timeout")); }, timeout); }); } close() { try { this.ws.close(); } catch {} } }
function directoryStats(dir) {
  const files = listFiles(dir);
  return {
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + fs.statSync(path.join(dir, file)).size, 0),
  };
}
async function runPlayer(label, port, requiredAliveMs = 0) {
  const args = ["--mode", "preview", "--preview-root", currentDir];
  const webviewUserData = path.join(outDir, `.webview2-${label}`);
  fs.rmSync(webviewUserData, { recursive: true, force: true });
  fs.mkdirSync(webviewUserData, { recursive: true });
  const startedAt = Date.now();
  const child = spawn(exe, args, { env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: webviewUserData, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*` }, windowsHide: false, stdio: ["ignore", "pipe", "pipe"] });
  let cdp;
  try {
    const target = await waitForTarget(port);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.open(); await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
    const evalv = async (expression, timeout = 15000) => { const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout }, timeout + 1000); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
    const waitFor = async (expression, name, timeout = 30000) => { const started = Date.now(); let last; while (Date.now() - started < timeout) { try { last = await evalv(expression); if (last === true || (last && typeof last !== "object")) return last; } catch (e) { last = e.message; } await sleep(200); } throw new Error(`wait ${name} failed: ${JSON.stringify(last)}`); };
    const clickSelector = async (selector) => { const p = await evalv(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};})()`); if (!p) throw new Error("missing " + selector); await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none" }); await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 }); await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 }); };
    await waitFor("!!document.querySelector('[data-testid=\"start-new-game\"]') && !document.querySelector('.boot-overlay')", "title");
    await clickSelector('[data-testid="start-new-game"]');
    await waitFor("!!document.querySelector('[data-testid=\"game-state-playing\"]')", "playing");
    await sleep(1200);
    const sample = await evalv(`(()=>{const bg=document.querySelector('.background-layer'); const sprite=document.querySelector('.sprite-visual'); const text=document.querySelector('.dialog-text'); const bgImage=bg?.querySelector('img'); const candidates=Array.from(document.querySelectorAll('[class*="background"], [class*="Background"]')).slice(0,8).map((e)=>({className:String(e.className),backgroundImage:getComputedStyle(e).backgroundImage,html:e.outerHTML.slice(0,240)})); const classes=document.body.innerHTML.match(/is-adaptive-layout|is-flow-text|is-density|is-extra-long/g)||[]; return { backgroundImage:getComputedStyle(bg).backgroundImage, backgroundSrc:bgImage?.src||'', candidates, spriteSrc:sprite?.src||'', text:text?.textContent||'', forbiddenClasses:classes, body:document.body.innerText.slice(0,300), href:location.href };})()`);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(resultsDir, `${label}.png`), Buffer.from(screenshot.data, "base64"));
    if (!sample.backgroundImage.includes("bg.svg") && !sample.backgroundSrc.includes("bg.svg") && !sample.candidates.some((candidate) => candidate.backgroundImage.includes("bg.svg"))) throw new Error(label + " background did not load from preview root: " + JSON.stringify(sample));
    if (!sample.spriteSrc.includes("hero.svg")) throw new Error(label + " sprite did not load from preview root: " + sample.spriteSrc);
    if (sample.forbiddenClasses.length) throw new Error(label + " forbidden layout classes: " + sample.forbiddenClasses.join(","));
    if (requiredAliveMs > 0) {
      const remaining = requiredAliveMs - (Date.now() - startedAt);
      if (remaining > 0) await sleep(remaining);
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`${label} GameCLI exited before ${requiredAliveMs} ms: exit=${child.exitCode} signal=${child.signalCode}`);
      }
    }
    return { ok: true, sample, pid: child.pid, args, aliveMs: Date.now() - startedAt, requiredAliveMs, previewStats: directoryStats(currentDir) };
  } finally { cdp?.close(); await stopOwnedTestProcess(child); }
}
async function runEditorButtonFlow() {
  if (!fs.existsSync(editorExe)) return { ok: false, skipped: true, reason: "Missing AgentVN Dev.exe" };
  fs.rmSync(editorPreviewCache, { recursive: true, force: true });
  const editor = spawn(editorExe, [], {
    cwd: root,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${editorPort} --remote-allow-origins=*`, AGENTVN_GAMECLI_PREVIEW_CDP_PORT: String(editorPort + 1) },
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let cdp;
  try {
    const target = await waitForTarget(editorPort);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.open(); await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
    const evalv = async (expression, timeout = 15000) => { const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout }, timeout + 1000); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
    const waitFor = async (expression, name, timeout = 90000) => { const started = Date.now(); let last; while (Date.now() - started < timeout) { try { last = await evalv(expression); if (last === true || (last && typeof last !== "object")) return last; } catch (e) { last = e.message; } await sleep(500); } throw new Error(`wait editor ${name} failed: ${JSON.stringify(last)}`); };
    const click = async (selector) => { const p = await evalv(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};})()`); if (!p) throw new Error("missing " + selector); await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none" }); await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 }); await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 }); };
    const draft = createEditorDraft();
    await waitFor(`(()=>{ try { void window.localStorage; return location.href !== 'about:blank' && document.readyState !== 'loading'; } catch { return false; } })()`, "localStorage-ready", 30000);
    await evalv(`(async()=>{
      const draft = ${JSON.stringify(draft)};
      localStorage.clear();
      localStorage.setItem('agentvn.currentProjectDraft', JSON.stringify(draft));
      localStorage.setItem('agentvn.recentProjects', JSON.stringify([{
        project_id: draft.project_id,
        title: draft.title,
        author: draft.author,
        created_at: draft.created_at,
        updated_at: draft.updated_at,
        node_count: draft.nodes.length,
        edge_count: draft.edges.length,
        schema_version: draft.schema_version,
        has_detail: true,
        project: draft
      }]));
      const state = {
        project_graph: {
          nodes: draft.nodes,
          edges: draft.edges,
          viewport: draft.viewport,
          memoryMode: draft.memory_mode
        },
        project_metadata: {
          projectId: draft.project_id,
          title: draft.title,
          author: draft.author,
          createdAt: draft.created_at,
          updatedAt: draft.updated_at,
          assetManifest: draft.asset_manifest,
          settings: draft.editor_settings,
          schemaVersion: draft.schema_version
        },
        recent_projects: [draft]
      };
      await fetch('http://127.0.0.1:8278/api/project/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      }).catch(() => null);
      await fetch('http://127.0.0.1:8278/api/project/projects/' + encodeURIComponent(draft.project_id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      }).catch(() => null);
      location.reload();
      return true;
    })();`, 30000);
    await waitFor("!!document.querySelector('button[data-help-key=\"home.openDraft\"], button[data-help-key=\"home.recentProject\"], .editor-toolbar')", "editor ready");
    if (await evalv("!!document.querySelector('.editor-toolbar')")) {
      // Already opened through a persisted backend draft.
    } else if (await evalv("!!document.querySelector('button[data-help-key=\"home.openDraft\"]')")) {
      await waitFor(`(()=>{const b=document.querySelector('button[data-help-key="home.openDraft"]'); return !!b && !b.disabled && !document.querySelector('.project-entry-loading-overlay');})()`, "open draft enabled");
      await click('button[data-help-key="home.openDraft"]');
    } else if (await evalv("!!document.querySelector('button[data-help-key=\"home.recentProject\"]')")) {
      await waitFor(`(()=>{const b=document.querySelector('button[data-help-key="home.recentProject"]'); return !!b && !b.disabled && !document.querySelector('.project-entry-loading-overlay');})()`, "recent project enabled");
      await click('button[data-help-key="home.recentProject"]');
    } else {
      throw new Error("Injected acceptance project was not visible on the editor home screen.");
    }
    await waitFor("!!document.querySelector('[data-workspace-surface=\"preview\"]')", "workspace navigation");
    const { chromium } = require('../editor/node_modules/playwright');
    const editorBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${editorPort}`);
    try {
      const editorPage = editorBrowser.contexts()[0].pages()[0];
      await editorPage.locator('.project-entry-loading-overlay').waitFor({ state: 'hidden', timeout: 90000 });
      await editorPage.locator('[data-workspace-surface="preview"]:visible').click({ timeout: 90000 });
    } finally { await editorBrowser.close(); }
    await waitFor("!!document.querySelector('[data-testid=\"preview-launch-panel\"]')", "preview confirmation");
    if (await evalv("document.querySelectorAll('iframe').length")) throw new Error('Top preview mounted an embedded iframe');
    await waitFor("!!document.querySelector('button[data-help-key=\"preview.open\"]')", "preview open");
    await waitFor(`(()=>{const b=document.querySelector('button[data-help-key="preview.open"]');if(!b||b.disabled)return false;const r=b.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>0&&r.height>0&&b.contains(hit);})()`, "launch button clickable");
    await click('button[data-help-key="preview.open"]');
    const cacheResult = await waitForEditorDirectoryPreviewCache(180000);
    let body = "";
    try {
      body = await evalv("document.body.innerText", 5000);
    } catch {
      body = "";
    }
    if (body.includes("预览失败")) throw new Error("Editor button preview failed: " + body.slice(-2000));
    if (!cacheResult.ok) {
      let screenshotPath;
      try {
        const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, 10000);
        screenshotPath = path.join(resultsDir, "editor-button-flow-failure.png");
        fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
      } catch {}
      throw new Error("Editor button directory preview cache invariant failed: " + JSON.stringify({
        cache: cacheResult.snapshot,
        bodyTail: body.slice(-2000),
        desktopHostLogTail: readTail(desktopHostLog),
        screenshotPath,
      }, null, 2));
    }
    return {
      ok: true,
      editorPreviewCache,
      cacheEntries: cacheResult.snapshot.entries,
      currentHasRequired: cacheResult.snapshot.currentHasRequired,
      durationMs: cacheResult.durationMs,
      commandPath: "directory-preview-ui-button",
      usedVncartUpload: cacheResult.snapshot.vncartFiles.length > 0,
      desktopHostLogTail: readTail(desktopHostLog, 4000),
    };
  } finally {
    cdp?.close();
    await stopOwnedTestProcess(editor);
  }
}
(async () => {
  if (!fs.existsSync(exe)) throw new Error("Missing player exe: " + exe);
  fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(resultsDir, { recursive: true });
  const editorButtonFlow = await runEditorButtonFlow();
  const runs = [];
  createFixture(20 * 1024 * 1024); runs.push(await runPlayer("small-20mb", portBase));
  createFixture(445 * 1024 * 1024); runs.push(await runPlayer("large-445mb", portBase, 20000));
  createFixture(20 * 1024 * 1024); runs.push(await runPlayer("second-run", portBase));
  const entries = fs.readdirSync(previewBase);
  const vncartFiles = listFiles(previewBase).filter((file) => file.endsWith(".vncart"));
  const result = { ok: editorButtonFlow.ok !== false && entries.length === 1 && entries[0] === "current" && vncartFiles.length === 0 && runs.every((run) => run.ok), editorButtonFlow, previewBase, currentDir, entries, vncartFiles, runs };
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
})().catch((error) => { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, "error.txt"), String(error.stack || error)); console.error(error.stack || error); process.exit(1); });
