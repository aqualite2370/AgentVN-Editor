const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const exe = process.env.AGENTVN_TEST_PLAYER_EXE || path.join(repoRoot, "editor", "src-tauri", "binaries", "agentvn-player.exe");
const port = Number(process.env.AGENTVN_PLAYER_CDP_PORT || 9341);
const previewRoot = path.join(repoRoot, "output", "automated", "dialog-layout-preview");
const outDir = path.join(previewRoot, "results");

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function writeJson(filePath, value) { fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8"); }
function sha(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }

function createFixture() {
  fs.rmSync(previewRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(previewRoot, "ui"), { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const now = new Date().toISOString();
  const uiSkin = {
    ui_layout_version: "1.0.0",
    name: "Dialog Layout Automation",
    target_runtime: "0.2.0",
    tokens: {
      colorBackground: "#08101d", colorSurface: "#111827", colorSurfaceStrong: "#1f2937", colorInk: "#f8fafc", colorMuted: "#94a3b8",
      colorAccent: "#60a5fa", colorAccent2: "#f59e0b", colorLine: "#334155", colorPanel: "#111827", colorPanelText: "#f8fafc",
      colorControl: "#1e293b", colorControlHover: "#334155", colorControlActive: "#2563eb", colorControlText: "#f8fafc",
      colorSliderTrack: "#334155", colorSliderActive: "#60a5fa", colorSliderThumb: "#f8fafc",
      colorDialog: "#020617e8", colorDialogText: "#f8fafc", colorSpeakerPlate: "#1e3a8a", colorSpeakerText: "#f8fafc",
      colorChoice: "#1e293b", colorChoiceText: "#f8fafc", colorQuickMenu: "#020617cc", colorFocus: "#93c5fd",
      colorDanger: "#ef4444", colorWarning: "#f59e0b", colorSuccess: "#22c55e", radius: 8, motionScale: 1, fontScale: 1
    },
    assets: [],
    screens: [
      { screen_id: "title", label: "Title", components: [
        { component_id: "title_hero", component_type: "main_menu_hero", required: true, rect: { x: 8, y: 18, width: 52, height: 34 }, style: { color: "#f8fafc", fontSize: 44, fontWeight: 800 }, zIndex: 1 },
        { component_id: "title_start_button", component_type: "main_menu_start_button", required: true, rect: { x: 70, y: 38, width: 22, height: 8 }, style: { backgroundColor: "#1d4ed8", color: "#fff", borderRadius: 10, fontSize: 18 }, zIndex: 2 },
        { component_id: "title_continue_button", component_type: "main_menu_continue_button", required: true, rect: { x: 70, y: 28, width: 22, height: 8 }, style: { backgroundColor: "#1e293b", color: "#fff", borderRadius: 10, fontSize: 18 }, zIndex: 2 }
      ]},
      { screen_id: "player", label: "Player", components: [
        { component_id: "stage_background", component_type: "stage_background", required: true, rect: { x: 0, y: 0, width: 100, height: 100 }, style: { backgroundColor: "#07111f" }, zIndex: 0 },
        { component_id: "dialog_panel", component_type: "dialog_panel", required: true, rect: { x: 10, y: 66, width: 80, height: 24 }, style: { backgroundColor: "#020617", borderColor: "#60a5fa", borderWidth: 2, borderRadius: 14, padding: 0 }, zIndex: 30 },
        { component_id: "speaker_label", component_type: "speaker_label", rect: { x: 13, y: 68, width: 16, height: 5 }, style: { backgroundColor: "#1d4ed8", color: "#fff", borderRadius: 999, padding: 2, fontSize: 18, fontWeight: 700 }, zIndex: 34 },
        { component_id: "dialog_text", component_type: "dialog_text", rect: { x: 14, y: 75, width: 68, height: 10 }, style: { color: "#f8fafc", fontSize: 24, lineHeight: 1.5, padding: 0, fontWeight: 500, textAlign: "left" }, zIndex: 35 },
        { component_id: "continue_indicator", component_type: "continue_indicator", rect: { x: 76, y: 84, width: 10, height: 4 }, style: { color: "#93c5fd", fontSize: 13, textAlign: "right" }, zIndex: 36 },
        { component_id: "quick_menu", component_type: "quick_menu", required: true, rect: { x: 78, y: 3, width: 18, height: 6 }, style: { backgroundColor: "#020617cc", color: "#fff" }, zIndex: 50 }
      ]}
    ],
    assetStateSets: {}
  };
  const manifest = {
    manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.2.0", game_id: "dialog-layout-automation",
    title: "Dialog Layout Automation", author: "Codex", description: "Dialog fixed layout fixture", version: "1.0.0", language: "zh-CN",
    tags: ["automation"], entry_script: "script.json", entry_scene_id: "scene_main", assets: [], ui_skin: { path: "ui/layout.json" }, created_at: now, updated_at: now
  };
  const adaptiveText = "This is a deliberately long line for the second dialog. The runtime should first measure the complete text, reduce the configured font size only as much as necessary, and keep the complete message on one page when the safe minimum still fits. ".repeat(3);
  const extremeText = "This is an intentionally extreme dialog used to verify the final fallback. The runtime may reduce the font to the safe minimum, then split the message into measured pages without introducing an internal scrolling text box or clipping the visible page. ".repeat(14);
  const script = {
    schema_version: "1.0.0", game_id: "dialog-layout-automation", title: "Dialog Layout Automation", entry_scene_id: "scene_main",
    characters: [{ character_id: "hero", name: "Hero" }], scenes: [{ scene_id: "scene_main", title: "Main", chapter: 1, tags: [], commands: [
      { type: "dialog", character_id: "hero", speaker: "Hero", text: "Short dialog." },
      { type: "dialog", character_id: "hero", speaker: "Hero", text: adaptiveText },
      { type: "dialog", character_id: "hero", speaker: "Hero", text: extremeText }
    ] }]
  };
  writeJson(path.join(previewRoot, "manifest.json"), manifest);
  writeJson(path.join(previewRoot, "script.json"), script);
  writeJson(path.join(previewRoot, "gallery.json"), { gallery_version: "1.0.0", items: [] });
  writeJson(path.join(previewRoot, "ui", "layout.json"), uiSkin);
  const rels = ["manifest.json", "script.json", "gallery.json", "ui/layout.json"];
  writeJson(path.join(previewRoot, "checksum.json"), { checksum_version: "1.0.0", algorithm: "sha256", generated_at: now, files: rels.map((relativePath) => ({ path: relativePath, size_bytes: fs.statSync(path.join(previewRoot, relativePath)).size, hash_sha256: sha(path.join(previewRoot, relativePath)) })) });
}

async function fetchJson(url) { const response = await fetch(url); if (!response.ok) throw new Error(url + " " + response.status); return response.json(); }
async function waitForTarget() {
  const started = Date.now(); let lastError;
  while (Date.now() - started < 20000) {
    try { const targets = await fetchJson("http://127.0.0.1:" + port + "/json/list"); const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl) || targets.find((item) => item.webSocketDebuggerUrl); if (target) return target; }
    catch (error) { lastError = error; }
    await sleep(250);
  }
  throw new Error("CDP target not available: " + (lastError && lastError.message));
}
class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.nextId = 1; this.pending = new Map(); }
  async open() { await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("websocket open timeout")), 10000); this.ws.onopen = () => { clearTimeout(timer); resolve(); }; this.ws.onerror = () => { clearTimeout(timer); reject(new Error("websocket error")); }; this.ws.onmessage = (event) => { const message = JSON.parse(event.data); if (!message.id || !this.pending.has(message.id)) return; const handlers = this.pending.get(message.id); this.pending.delete(message.id); if (message.error) handlers.reject(new Error(JSON.stringify(message.error))); else handlers.resolve(message.result); }; }); }
  send(method, params = {}, timeout = 15000) { const id = this.nextId++; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); setTimeout(() => { if (!this.pending.has(id)) return; this.pending.delete(id); reject(new Error(method + " timeout")); }, timeout); }); }
  close() { try { this.ws.close(); } catch {} }
}

async function run() {
  if (!fs.existsSync(exe)) throw new Error("Missing player exe: " + exe);
  createFixture();
  const webviewUserData = path.join(previewRoot, ".webview2");
  fs.mkdirSync(webviewUserData, { recursive: true });
  try { execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Process agentvn-player -ErrorAction SilentlyContinue | Stop-Process -Force; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'agentvn-player.exe|AgentVN\\\\output' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: "ignore" }); } catch {}
  const child = spawn(exe, ["--mode", "preview", "--preview-root", previewRoot], { env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: webviewUserData, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=" + port + " --remote-allow-origins=*" }, windowsHide: false, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const target = await waitForTarget();
  const cdp = new CDP(target.webSocketDebuggerUrl);
  try {
    await cdp.open();
    await cdp.send("Runtime.enable"); await cdp.send("Page.enable"); await cdp.send("DOM.enable");
    async function evaluate(expression, timeout = 15000) { const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout }, timeout + 1000); if (result.exceptionDetails) throw new Error("Eval failed: " + JSON.stringify(result.exceptionDetails)); return result.result.value; }
    async function waitFor(expression, label, timeout = 25000) { const started = Date.now(); let last; while (Date.now() - started < timeout) { try { last = await evaluate(expression); if (last === true || (last && typeof last !== "object")) return last; } catch (error) { last = error.message; } await sleep(150); } throw new Error("Timed out waiting for " + label + "; last=" + JSON.stringify(last)); }
    async function clickSelector(selector) { const rect = await evaluate("(() => { const element = document.querySelector(" + JSON.stringify(selector) + "); if (!element) return null; const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()"); if (!rect) throw new Error("Cannot find selector " + selector); await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y, button: "none" }); await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 }); await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 }); }
    async function pressEnter() { await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: "Enter", code: "Enter" }); await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: "Enter", code: "Enter" }); }
    async function advanceUntilCommand(index, maxPresses = 120) {
      for (let attempt = 0; attempt < maxPresses; attempt += 1) {
        const current = await evaluate("Number(document.querySelector('[data-testid=\"game-state-playing\"]')?.getAttribute('data-current-command-index') ?? -1)");
        if (current === index) return;
        await clickSelector(".dialog-box");
        await sleep(220);
      }
      throw new Error(`Could not advance to command ${index}`);
    }
    async function capture(name) { const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); fs.writeFileSync(path.join(outDir, name), Buffer.from(shot.data, "base64")); }
    const sampleExpr = "(() => { const box = document.querySelector('.dialog-box'); const text = document.querySelector('.dialog-text'); const speaker = document.querySelector('.speaker'); const cont = document.querySelector('.continue-indicator'); const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }; const css = getComputedStyle(text); return { boxClass: box?.className || '', textClass: text?.className || '', speakerClass: speaker?.className || '', continueClass: cont?.className || '', boxRect: rect(box), textRect: rect(text), fontSize: css.fontSize, lineHeight: css.lineHeight, padding: css.padding, text: text?.textContent || '', textScrollWidth: text?.scrollWidth || 0, textScrollHeight: text?.scrollHeight || 0, textClientWidth: text?.clientWidth || 0, textClientHeight: text?.clientHeight || 0, commandIndex: document.querySelector('[data-testid=\"game-state-playing\"]')?.getAttribute('data-current-command-index'), pages: Number(box?.dataset.dialogPages || 0), page: Number(box?.dataset.dialogPage || 0), layoutMode: box?.dataset.dialogLayoutMode || '', fontMode: box?.dataset.dialogFontMode || '', fontScale: Number(box?.dataset.dialogFontScale || 1), overflow: box?.dataset.dialogOverflow || '' }; })()";
    const stable = (a, b, path) => Math.abs(path.split('.').reduce((o, k) => o[k], a) - path.split('.').reduce((o, k) => o[k], b)) <= 1;

    await waitFor("document.readyState === 'complete' || document.readyState === 'interactive'", "document ready");
    await waitFor("Boolean(document.querySelector('[data-testid=\"start-new-game\"]')) && !document.querySelector('.boot-overlay')", "title menu ready", 30000);

    let windowCheck = { supported: false };
    try {
      const info = await cdp.send("Browser.getWindowForTarget", { targetId: target.id });
      const initial = await cdp.send("Browser.getWindowBounds", { windowId: info.windowId });
      const moveScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WinMove {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, UInt32 uFlags);
}
"@
$process = Get-Process -Id ${child.pid} -ErrorAction Stop
$deadline = [DateTime]::UtcNow.AddSeconds(10)
while ($process.MainWindowHandle -eq 0 -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100; $process.Refresh() }
if ($process.MainWindowHandle -eq 0) { throw "MainWindowHandle not ready" }
[WinMove]::SetWindowPos($process.MainWindowHandle, [IntPtr]::Zero, 80, 80, 900, 540, 0x0040) | Out-Null
`;
      execFileSync("powershell.exe", ["-NoProfile", "-Command", moveScript], { stdio: "pipe" });
      await sleep(1800);
      const restored = await cdp.send("Browser.getWindowBounds", { windowId: info.windowId });
      windowCheck = { supported: true, initial, restored, ok: restored.bounds.windowState === "maximized" || restored.bounds.windowState === "fullscreen" || (restored.bounds.width >= Math.floor((initial.bounds.width || 1000) * 0.9) && restored.bounds.height >= Math.floor((initial.bounds.height || 700) * 0.9)) };
    } catch (error) {
      windowCheck = { supported: false, ok: false, error: String(error.message || error) };
    }

    await clickSelector('[data-testid="start-new-game"]');
    await waitFor("Boolean(document.querySelector('[data-testid=\"game-state-playing\"][data-current-command-index=\"0\"] .dialog-text'))", "first dialog", 20000);
    await sleep(900);
    const shortSample = await evaluate(sampleExpr);
    await capture("01-short-dialog.png");
    await advanceUntilCommand(1);
    await waitFor("Boolean(document.querySelector('[data-testid=\"game-state-playing\"][data-current-command-index=\"1\"] .dialog-text'))", "adaptive dialog", 15000);
    await sleep(900);
    const adaptiveSample = await evaluate(sampleExpr);
    await capture("02-adaptive-dialog.png");
    await sleep(350);
    const adaptiveSampleLater = await evaluate(sampleExpr);
    await advanceUntilCommand(2);
    await waitFor("Boolean(document.querySelector('[data-testid=\"game-state-playing\"][data-current-command-index=\"2\"] .dialog-text'))", "extreme dialog", 15000);
    await sleep(900);
    const extremeSample = await evaluate(sampleExpr);
    await capture("03-extreme-dialog.png");
    await sleep(350);
    const extremeSampleLater = await evaluate(sampleExpr);

    const result = {
      ok: windowCheck.ok !== false
        && shortSample.layoutMode === "fixed"
        && shortSample.fontMode === "configured"
        && shortSample.pages === 1
        && adaptiveSample.layoutMode === "fixed"
        && adaptiveSample.fontMode === "adaptive"
        && adaptiveSample.pages === 1
        && Number.parseFloat(adaptiveSample.fontSize) < Number.parseFloat(shortSample.fontSize)
        && adaptiveSample.fontScale < 1
        && extremeSample.layoutMode === "fixed"
        && extremeSample.fontMode === "adaptive"
        && extremeSample.pages > 1
        && Number.parseFloat(extremeSample.fontSize) <= Number.parseFloat(adaptiveSample.fontSize) + 0.01
        && extremeSample.textScrollWidth <= extremeSample.textClientWidth + 1
        && extremeSample.textScrollHeight <= extremeSample.textClientHeight + 1
        && stable(shortSample, adaptiveSample, "boxRect.width")
        && stable(shortSample, adaptiveSample, "boxRect.height")
        && stable(shortSample, adaptiveSample, "textRect.width")
        && stable(shortSample, adaptiveSample, "textRect.height")
        && stable(shortSample, extremeSample, "boxRect.width")
        && stable(shortSample, extremeSample, "boxRect.height")
        && stable(shortSample, extremeSample, "textRect.width")
        && stable(shortSample, extremeSample, "textRect.height")
        && adaptiveSample.fontSize === adaptiveSampleLater.fontSize
        && extremeSample.fontSize === extremeSampleLater.fontSize,
      windowCheck, shortSample, adaptiveSample, adaptiveSampleLater, extremeSample, extremeSampleLater, stderrTail: stderr.slice(-4000), outDir
    };
    fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 2;
  } finally {
    cdp.close();
    child.kill();
  }
}
run().catch((error) => { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, "error.txt"), String(error.stack || error) + "\n", "utf8"); console.error(error.stack || error); process.exit(1); });
