const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outDir = path.join(root, "output", "choice-bgm-acceptance", "playwright");
const port = 6874;
const baseUrl = `http://127.0.0.1:${port}/?mode=preview`;

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

function fixture() {
  const now = new Date().toISOString();
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.2.0",
      game_id: "bgm-menu-continuity",
      title: "BGM Menu Continuity",
      author: "AgentVN QA",
      version: "1.0.0",
      description: "BGM must survive shell navigation.",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene_main",
      assets: [{
        asset_id: "bgm_test",
        asset_type: "bgm",
        path: "assets/bgm/test.wav",
        filename: "test.wav",
        mime_type: "audio/wav",
        size_bytes: 1,
        hash_sha256: "0".repeat(64),
        preload: true,
        tags: ["test"],
      }],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.1.0",
      game_id: "bgm-menu-continuity",
      title: "BGM Menu Continuity",
      entry_scene_id: "scene_main",
      scenes: [{
        scene_id: "scene_main",
        title: "Main",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [
          { type: "bgm", bgm_id: "bgm_test", action: "play", volume: 0.7, fade_ms: 0 },
          { type: "narration", text: "保持在这里测试菜单切换。" },
        ],
      }],
    },
    uiSkin: {
      ui_layout_version: "1.0.0",
      name: "BGM continuity",
      target_runtime: "0.2.0",
      assets: [],
      tokens: {
        colorBackground: "#060812",
        colorSurface: "#111827",
        colorSurfaceStrong: "#1f2937",
        colorInk: "#f8fafc",
        colorMuted: "#94a3b8",
        colorAccent: "#60a5fa",
        colorAccent2: "#f59e0b",
        colorLine: "#64748b",
        colorPanel: "#111827",
        colorPanelText: "#f8fafc",
        colorControl: "#1e293b",
        colorControlHover: "#334155",
        colorControlActive: "#2563eb",
        colorControlText: "#f8fafc",
        colorDialog: "#020617",
        colorDialogText: "#f8fafc",
        colorSpeakerPlate: "#1e3a8a",
        colorSpeakerText: "#f8fafc",
        colorChoice: "#1e293b",
        colorChoiceText: "#f8fafc",
        colorQuickMenu: "#ffffff",
        colorFocus: "#93c5fd",
        radius: 10,
        fontScale: 1,
      },
      screens: [],
    },
    assetUrls: { bgm_test: "memory://bgm-test" },
  };
}

async function waitForServer() {
  for (let index = 0; index < 100; index += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("GameCLI dev server did not become ready.");
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const vite = spawn(
    "cmd.exe",
    ["/d", "/s", "/c", `npm run dev -- --port ${port}`],
    { cwd: runtimeRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let viteLog = "";
  vite.stdout.on("data", (chunk) => { viteLog += chunk; });
  vite.stderr.on("data", (chunk) => { viteLog += chunk; });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (error) => { viteLog += `\nPAGEERROR ${error.stack || error.message}\n`; });
    page.on("console", (message) => {
      if (message.type() === "error") viteLog += `\nCONSOLE ${message.text()}\n`;
    });
    await page.addInitScript(() => {
      const records = [];
      class FakeAudio {
        constructor(src = "") {
          this.src = src;
          this.loop = false;
          this.paused = true;
          this.volume = 1;
          this.playCount = 0;
          this.pauseCount = 0;
          this._currentTime = 0;
          this._startedAt = 0;
          records.push(this);
        }
        get currentTime() {
          return this.paused || !this._startedAt
            ? this._currentTime
            : this._currentTime + (performance.now() - this._startedAt) / 1000;
        }
        set currentTime(value) {
          this._currentTime = Number(value) || 0;
          this._startedAt = this.paused ? 0 : performance.now();
        }
        play() {
          if (this.paused) {
            this.paused = false;
            this._startedAt = performance.now();
          }
          this.playCount += 1;
          return Promise.resolve();
        }
        pause() {
          if (!this.paused) this._currentTime = this.currentTime;
          this.paused = true;
          this._startedAt = 0;
          this.pauseCount += 1;
        }
        addEventListener() {}
        removeEventListener() {}
      }
      Object.defineProperty(window, "Audio", { configurable: true, value: FakeAudio });
      window.__AGENTVN_AUDIO_RECORDS__ = records;
    });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const requestId = "bgm-menu-init";
    await page.evaluate((payload) => window.postMessage(payload, "*"), {
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: "bgm-menu-continuity-session",
      revision: 1,
      requestId,
      runId: "bgm-menu-continuity-run",
      ...fixture(),
      start: {
        requestId,
        target: { sceneId: "scene_main", commandIndex: 1 },
        entryPath: [],
        mode: "stable_frame",
        playbackRate: 1,
        reducedMotion: true,
      },
      screen: "title_menu",
    });
    await page.locator('[data-testid="start-new-game"]:not([disabled])').waitFor({ state: "visible", timeout: 20_000 });
    await page.locator('[data-testid="start-new-game"]').click();
    await page.locator('[data-testid="game-state-playing"]').waitFor({ state: "visible" });
    await page.locator('[data-testid="game-launch-blackout"]').waitFor({ state: "detached", timeout: 30_000 });
    await page.waitForTimeout(120);
    const before = await page.evaluate(() => {
      const records = window.__AGENTVN_AUDIO_RECORDS__;
      return {
        count: records.length,
        playCount: records[0]?.playCount,
        pauseCount: records[0]?.pauseCount,
        currentTime: records[0]?.currentTime,
      };
    });
    assert(before.count === 1 && before.playCount === 1 && before.pauseCount === 0, "Initial BGM did not start exactly once.", before);
    const waitForPlayingSettled = async () => {
      await page.locator('[data-testid="game-state-playing"]').waitFor({ state: "visible" });
      await page.locator('[data-testid="game-launch-blackout"]').waitFor({ state: "detached", timeout: 30_000 });
    };

    await page.getByTestId("quick-menu-toggle").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    await page.getByTestId("open-main-menu").click();
    await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition") === "active");
    await page.getByTestId("main-menu").waitFor({ state: "visible" });
    await page.getByTestId("open-settings").click();
    await page.locator(".settings-screen").waitFor({ state: "visible" });
    await page.locator('[data-testid="back-to-main-menu"]').click();
    await page.getByTestId("main-menu").waitFor({ state: "visible" });
    await page.getByTestId("continue-game").click();
    await waitForPlayingSettled();

    await page.getByTestId("quick-menu-toggle").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    await page.locator('[data-ui-component-id="quick_history_button"]').click();
    await page.locator(".history-list").waitFor({ state: "visible" });
    await page.locator('[data-testid="back-to-player"]').click();
    await waitForPlayingSettled();

    await page.getByTestId("quick-menu-toggle").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    await page.locator('[data-ui-component-id="quick_save_load_button"]').click();
    await page.locator(".save-load-screen").waitFor({ state: "visible" });
    await page.locator('[data-testid="back-to-player"]').click();
    await waitForPlayingSettled();

    await page.getByTestId("quick-menu-toggle").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    await page.locator('[data-testid="open-main-menu"]').click();
    await page.locator('[data-testid="continue-game"]').click();
    await waitForPlayingSettled();
    await page.waitForTimeout(650);

    const after = await page.evaluate(() => {
      const records = window.__AGENTVN_AUDIO_RECORDS__;
      return {
        count: records.length,
        playCounts: records.map((item) => item.playCount),
        pauseCounts: records.map((item) => item.pauseCount),
        currentTimes: records.map((item) => item.currentTime),
      };
    });
    assert(after.count === 1, "Menu navigation recreated the BGM Audio element.", { before, after });
    assert(after.playCounts[0] === 1, "Menu navigation replayed the BGM.", { before, after });
    assert(after.pauseCounts[0] === 0, "Menu navigation paused/disposed the BGM.", { before, after });
    assert(after.currentTimes[0] > before.currentTime + 0.5, "BGM playhead did not continue forward.", { before, after });

    await page.screenshot({ path: path.join(outDir, "bgm-menu-continuity.png"), fullPage: true });
    fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ ok: true, before, after }, null, 2));
    console.log(JSON.stringify({ ok: true, before, after }, null, 2));
  } finally {
    await browser?.close().catch(() => {});
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/pid", String(vite.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    } else {
      vite.kill("SIGTERM");
    }
    fs.writeFileSync(path.join(outDir, "vite.log"), viteLog);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
