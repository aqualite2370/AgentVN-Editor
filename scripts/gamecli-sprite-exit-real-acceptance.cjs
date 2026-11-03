const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const exe = process.env.AGENTVN_TEST_PLAYER_EXE || path.join(repoRoot, "editor", "src-tauri", "binaries", "agentvn-player.exe");
const port = Number(process.env.AGENTVN_PLAYER_CDP_PORT || 9341);
const mode = process.env.AGENTVN_SPRITE_EXIT_MODE || "sprite-command";
const previewRoot = path.join(repoRoot, "output", "automated", "sprite-exit-preview", mode);
const outDir = path.join(previewRoot, "results");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createFixture() {
  fs.rmSync(previewRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(previewRoot, "assets", "sprite"), { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="760" viewBox="0 0 420 760">',
    '  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff77aa"/><stop offset="1" stop-color="#7657ff"/></linearGradient></defs>',
    '  <rect width="420" height="760" fill="none"/>',
    '  <ellipse cx="210" cy="180" rx="92" ry="105" fill="url(#g)" stroke="#fff" stroke-width="10"/>',
    '  <rect x="96" y="285" width="228" height="370" rx="82" fill="url(#g)" stroke="#fff" stroke-width="10"/>',
    '  <circle cx="175" cy="165" r="13" fill="#fff"/><circle cx="245" cy="165" r="13" fill="#fff"/>',
    '  <path d="M175 225 Q210 255 245 225" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round"/>',
    '  <text x="210" y="700" text-anchor="middle" font-family="Arial" font-size="42" fill="#fff">EXIT TEST</text>',
    '</svg>'
  ].join("\n");
  fs.writeFileSync(path.join(previewRoot, "assets", "sprite", "hero.svg"), svg, "utf8");

  const now = new Date().toISOString();
  const exitCommand = mode === "animation-command"
    ? {
      type: "animation",
      animation_id: "sprite_fade_out",
      animation_display_name: "立绘退场",
      target: "sprite:hero",
      params: {
        duration_ms: 520,
        duration: 520,
        easing: "ease-in",
        keyframes: [
          { offset: 0, opacity: 1 },
          { offset: 1, opacity: 0 }
        ]
      },
      blocking: false
    }
    : { type: "sprite", character_id: "hero", sprite_id: "hero_sprite", position: "center", animation: "fade_out", scale: 1, visible: false };
  const manifest = {
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: "0.2.0",
    game_id: "sprite-exit-automation",
    title: "Sprite Exit Automation",
    author: "Codex",
    description: "Automated fixture for sprite exit disappearance",
    version: "1.0.0",
    language: "zh-CN",
    tags: ["automation"],
    entry_script: "script.json",
    entry_scene_id: "scene_main",
    assets: [{
      asset_id: "hero_sprite",
      asset_type: "sprite",
      path: "assets/sprite/hero.svg",
      filename: "hero.svg",
      mime_type: "image/svg+xml",
      size_bytes: Buffer.byteLength(svg, "utf8")
    }],
    created_at: now,
    updated_at: now
  };
  const script = {
    schema_version: "1.0.0",
    game_id: "sprite-exit-automation",
    title: "Sprite Exit Automation",
    entry_scene_id: "scene_main",
    default_sprite_scale: 1,
    characters: [{ character_id: "hero", name: "测试角色" }],
    scenes: [{
      scene_id: "scene_main",
      title: "Main",
      summary: "Sprite exits",
      chapter: 1,
      tags: [],
      commands: [
        { type: "sprite", character_id: "hero", sprite_id: "hero_sprite", position: "center", animation: "fade_in", scale: 1, visible: true },
        { type: "dialog", character_id: "hero", text: "第一句：现在应该能看到立绘。" },
        exitCommand,
        { type: "wait", duration_ms: 850 },
        { type: "narration", text: "退场后：这里不应该再看到角色立绘。" }
      ]
    }]
  };
  const gallery = { gallery_version: "1.0.0", items: [] };
  writeJson(path.join(previewRoot, "manifest.json"), manifest);
  writeJson(path.join(previewRoot, "script.json"), script);
  writeJson(path.join(previewRoot, "gallery.json"), gallery);

  const files = ["manifest.json", "script.json", "gallery.json", "assets/sprite/hero.svg"].map((relativePath) => {
    const data = fs.readFileSync(path.join(previewRoot, relativePath));
    return {
      path: relativePath,
      size_bytes: data.length,
      hash_sha256: crypto.createHash("sha256").update(data).digest("hex")
    };
  });
  writeJson(path.join(previewRoot, "checksum.json"), {
    checksum_version: "1.0.0",
    algorithm: "sha256",
    generated_at: now,
    files: files
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url + " " + response.status);
  return response.json();
}

async function waitForTarget() {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 20000) {
    try {
      const targets = await fetchJson("http://127.0.0.1:" + port + "/json/list");
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl) || targets.find((item) => item.webSocketDebuggerUrl);
      if (target) return target;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error("CDP target not available: " + (lastError && lastError.message));
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("websocket open timeout")), 10000);
      this.ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("websocket error"));
      };
      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (!message.id || !this.pending.has(message.id)) return;
        const handlers = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) handlers.reject(new Error(JSON.stringify(message.error)));
        else handlers.resolve(message.result);
      };
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id: id, method: method, params: params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve, reject: reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(method + " timeout"));
      }, 15000);
    });
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function run() {
  createFixture();

  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Process agentvn-player -ErrorAction SilentlyContinue | Stop-Process -Force; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'agentvn-player.exe|AgentVN\\\\output' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: "ignore" });
  } catch {}

  const webviewUserData = path.join(previewRoot, ".webview2");
  fs.mkdirSync(webviewUserData, { recursive: true });
  const child = spawn(exe, ["--mode", "preview", "--preview-root", previewRoot], {
    env: Object.assign({}, process.env, {
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=" + port + " --remote-allow-origins=*"
      ,WEBVIEW2_USER_DATA_FOLDER: webviewUserData
    }),
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const cdp = new CDP((await waitForTarget()).webSocketDebuggerUrl);
  try {
    await cdp.open();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");

    async function evaluate(expression, timeout = 15000) {
      const result = await cdp.send("Runtime.evaluate", {
        expression: expression,
        awaitPromise: true,
        returnByValue: true,
        timeout: timeout
      });
      if (result.exceptionDetails) throw new Error("Eval failed: " + JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }

    async function waitFor(expression, label, timeout = 20000) {
      const started = Date.now();
      let last;
      while (Date.now() - started < timeout) {
        try {
          last = await evaluate(expression);
          if (last === true || (last && typeof last !== "object")) return last;
        } catch (error) {
          last = error.message;
        }
        await sleep(150);
      }
      throw new Error("Timed out waiting for " + label + "; last=" + JSON.stringify(last));
    }

    async function screenshot(name) {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(outDir, name), Buffer.from(shot.data, "base64"));
    }

    async function clickSelector(selector) {
      const rect = await evaluate("(() => { const element = document.querySelector(" + JSON.stringify(selector) + "); if (!element) return null; const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()");
      if (!rect) throw new Error("Cannot find selector " + selector);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y, button: "none" });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    }

    async function pressEnter() {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: "Enter", code: "Enter" });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: "Enter", code: "Enter" });
    }

    await waitFor("document.readyState === 'complete' || document.readyState === 'interactive'", "document ready");
    await waitFor("Boolean(document.querySelector('[data-testid=\"start-new-game\"]')) && !document.querySelector('.boot-overlay')", "title menu ready", 30000);
    await screenshot("01-title.png");
    await clickSelector('[data-testid="start-new-game"]');

    await waitFor("Boolean(document.querySelector('[data-testid=\"game-state-playing\"][data-current-command-index=\"1\"]'))", "first dialog with sprite", 20000);
    await sleep(700);
    const visibleState = await evaluate("(() => { const slots = [...document.querySelectorAll('.sprite-slot[data-character-id=\"hero\"]')]; return { count: slots.length, phases: slots.map((element) => element.getAttribute('data-sprite-phase')), opacity: slots.map((element) => getComputedStyle(element).opacity), commandIndex: document.querySelector('[data-testid=\"game-state-playing\"]')?.getAttribute('data-current-command-index'), commandType: document.querySelector('[data-testid=\"game-state-playing\"]')?.getAttribute('data-current-command-type'), text: document.querySelector('.dialog-text')?.textContent || document.body.innerText.slice(0, 500), log: (window.__AGENTVN_RUNTIME_ANIMATION_LOG__ || []).slice(-20) }; })()");
    await screenshot("02-sprite-visible.png");

    await pressEnter();
    await sleep(250);
    await pressEnter();

    await waitFor("(() => { const player = document.querySelector('[data-testid=\"game-state-playing\"]'); return Boolean(player && Number(player.getAttribute('data-current-command-index') || 0) >= 4); })()", "post-exit narration/wait", 15000);
    await sleep(900);
    const afterState = await evaluate("(() => { const slots = [...document.querySelectorAll('.sprite-slot[data-character-id=\"hero\"]')]; const player = document.querySelector('[data-testid=\"game-state-playing\"]'); return { count: slots.length, phases: slots.map((element) => element.getAttribute('data-sprite-phase')), active: slots.map((element) => element.getAttribute('data-runtime-animation-active')), commandIndex: player?.getAttribute('data-current-command-index'), commandType: player?.getAttribute('data-current-command-type'), bodyText: document.body.innerText.slice(0, 500), log: (window.__AGENTVN_RUNTIME_ANIMATION_LOG__ || []).slice(-40) }; })()");
    await screenshot("03-after-exit.png");

    const result = {
      ok: visibleState.count === 1 && afterState.count === 0,
      mode: mode,
      visibleState: visibleState,
      afterState: afterState,
      stderrTail: stderr.slice(-4000),
      outDir: outDir
    };
    fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 2;
  } finally {
    cdp.close();
    child.kill();
  }
}

run().catch((error) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "error.txt"), String(error.stack || error) + "\n", "utf8");
  console.error(error.stack || error);
  process.exit(1);
});

