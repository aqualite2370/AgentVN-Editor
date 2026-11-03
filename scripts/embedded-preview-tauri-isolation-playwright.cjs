const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const outDir = path.join(root, "output", "playwright", "embedded-preview-tauri-isolation");
const editorUrl = "http://127.0.0.1:6767/";

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
  }
}

async function serverReady() {
  try {
    const response = await fetch(editorUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await serverReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Editor Vite server did not become ready.");
}

function fixture() {
  const now = new Date().toISOString();
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.2.0",
      game_id: "embedded-tauri-isolation",
      title: "Embedded Tauri Isolation",
      author: "AgentVN QA",
      version: "1.0.0",
      description: "Embedded preview must not call the editor Tauri host.",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene_main",
      assets: [],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.0.0",
      game_id: "embedded-tauri-isolation",
      title: "Embedded Tauri Isolation",
      entry_scene_id: "scene_main",
      characters: [],
      scenes: [{
        scene_id: "scene_main",
        title: "Main",
        chapter: 1,
        tags: [],
        commands: [{ type: "narration", text: "嵌入预览隔离测试。" }],
      }],
    },
  };
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  let vite;
  let viteLog = "";
  if (!(await serverReady())) {
    vite = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], {
      cwd: editorRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    vite.stdout.on("data", (chunk) => { viteLog += chunk; });
    vite.stderr.on("data", (chunk) => { viteLog += chunk; });
  }

  const browser = await chromium.launch({ headless: true });
  try {
    await waitForServer();
    const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    await context.addInitScript(() => {
      if (window.parent === window && new URLSearchParams(window.location.search).get("embedded") !== "1") return;
      window.__AGENTVN_FAKE_TAURI_INVOKES__ = [];
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {
          invoke(command) {
            window.__AGENTVN_FAKE_TAURI_INVOKES__.push(command);
            return Promise.reject(new Error(`Unexpected embedded Tauri command: ${command}`));
          },
        },
      });
    });

    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.body.replaceChildren();
      const iframe = document.createElement("iframe");
      iframe.id = "runtime";
      iframe.src = "/gamecli-preview/?preview=1&embedded=1";
      iframe.style.cssText = "width:100vw;height:100vh;border:0";
      document.body.appendChild(iframe);
    });

    const iframeHandle = await page.waitForSelector("#runtime");
    const runtimeFrame = await iframeHandle.contentFrame();
    assert(runtimeFrame, "Embedded GameCLI frame was not created.");
    await runtimeFrame.waitForLoadState("domcontentloaded");
    await runtimeFrame.waitForURL(/\/gamecli-preview\//);

    const sessionId = "embedded-isolation-session";
    const requestId = "embedded-isolation-init";
    const runId = "embedded-isolation-run";
    const data = fixture();
    await page.evaluate(({ sessionId, requestId, runId, data }) => {
      const iframe = document.querySelector("#runtime");
      iframe.contentWindow.postMessage({
        type: "agentvn.live-preview.init",
        protocolVersion: 2,
        sessionId,
        revision: 1,
        requestId,
        runId,
        manifest: data.manifest,
        script: data.script,
        assetUrls: {},
        start: {
          requestId,
          target: { sceneId: "scene_main", commandIndex: 0 },
          entryPath: [],
          mode: "stable_frame",
          playbackRate: 1,
          reducedMotion: true,
        },
        screen: "save_load",
      }, window.location.origin);
    }, { sessionId, requestId, runId, data });

    await runtimeFrame.waitForSelector(".save-load-screen", { timeout: 20_000 });
    await runtimeFrame.waitForTimeout(250);
    const probe = await runtimeFrame.evaluate(() => ({
      invokes: window.__AGENTVN_FAKE_TAURI_INVOKES__ ?? [],
      bodyText: document.body.innerText,
      platform: document.querySelector(".ui-skin-scope")?.getAttribute("data-runtime-platform"),
    }));

    await page.screenshot({
      path: path.join(outDir, "embedded-save-load.png"),
      fullPage: true,
    });
    const result = {
      ok: probe.invokes.length === 0
        && !probe.bodyText.includes("Command list_saves not found")
        && pageErrors.length === 0,
      probe,
      pageErrors,
      consoleErrors,
    };
    fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));

    assert(probe.invokes.length === 0, "Embedded runtime invoked Tauri commands from the editor host.", probe);
    assert(!probe.bodyText.includes("Command list_saves not found"), "Embedded save screen exposed the editor-host list_saves failure.", probe);
    assert(pageErrors.length === 0, "Embedded runtime raised page errors.", { pageErrors, consoleErrors });
    console.log("PASS embedded GameCLI ignores inherited Tauri bridge");
  } finally {
    await browser.close();
    if (vite) {
      try {
        execFileSync("taskkill.exe", ["/PID", String(vite.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {
        vite.kill();
      }
    }
    if (viteLog) fs.writeFileSync(path.join(outDir, "vite.log"), viteLog);
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
