const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const baseUrl = process.env.AGENTVN_NAMEPLATE_ACCEPTANCE_URL || "http://127.0.0.1:6868/?mode=preview";
const outDir = path.join(root, "output", "playwright", "speaker-nameplate-clipping");

function assert(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function isListening() {
  try {
    const response = await fetch(baseUrl, { method: "HEAD" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isListening()) return undefined;
  const child = process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], { cwd: runtimeRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    : spawn("npm", ["run", "dev"], { cwd: runtimeRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const logPath = path.join(outDir, "gamecli.log");
  const appendLog = (data) => fs.appendFileSync(logPath, data.toString());
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isListening()) return child;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("GameCLI Vite server did not become ready");
}

function stopServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function fixture() {
  const now = new Date().toISOString();
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.2.0",
      game_id: "speaker-nameplate-clipping",
      title: "Speaker Nameplate Clipping QA",
      author: "AgentVN QA",
      version: "1.0.0",
      description: "Speaker label intentionally straddles the dialog panel.",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene_main",
      assets: [],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.0.0",
      game_id: "speaker-nameplate-clipping",
      title: "Speaker Nameplate Clipping QA",
      entry_scene_id: "scene_main",
      characters: [{ character_id: "hero", name: "测试角色姓名" }],
      scenes: [{
        scene_id: "scene_main",
        title: "Nameplate",
        chapter: 1,
        tags: [],
        commands: [{ type: "dialog", character_id: "hero", text: "姓名牌应完整显示在对话框上沿。" }],
      }],
    },
    uiSkin: {
      ui_layout_version: "1.0.0",
      name: "Straddled nameplate",
      target_runtime: "0.2.0",
      tokens: {
        colorBackground: "#060812",
        colorSurface: "#111827",
        colorSurfaceStrong: "#1f2937",
        colorInk: "#f8fafc",
        colorMuted: "#94a3b8",
        colorAccent: "#60a5fa",
        colorAccent2: "#f59e0b",
        colorLine: "#64748b",
        colorDialog: "#111827ee",
        colorDialogText: "#f8fafc",
        colorSpeakerPlate: "#1d4ed8",
        colorSpeakerText: "#ffffff",
        colorChoice: "#1e293b",
        colorChoiceText: "#ffffff",
        colorQuickMenu: "#111827",
        radius: 10,
        motionScale: 0,
        fontScale: 1,
      },
      assets: [],
      screens: [{
        screen_id: "player",
        label: "Player",
        components: [
          {
            component_id: "dialog_panel",
            component_type: "dialog_panel",
            required: true,
            rect: { x: 9, y: 72, width: 82, height: 20 },
            style: { backgroundColor: "#111827ee", borderColor: "#60a5fa", borderWidth: 1, borderRadius: 12, padding: 0 },
            zIndex: 30,
          },
          {
            component_id: "speaker_label",
            component_type: "speaker_label",
            rect: { x: 12, y: 68, width: 24, height: 8 },
            style: { backgroundColor: "#1d4ed8", color: "#fff", borderRadius: 10, padding: 6, fontSize: 20, fontWeight: 700 },
            zIndex: 34,
          },
          {
            component_id: "dialog_text",
            component_type: "dialog_text",
            rect: { x: 13, y: 78, width: 70, height: 9 },
            style: { color: "#f8fafc", fontSize: 24, lineHeight: 1.5, padding: 0 },
            zIndex: 35,
          },
        ],
      }],
      assetStateSets: {},
    },
    assetUrls: {},
    screen: "playing",
  };
}

async function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const server = await ensureServer();
  let browser;
  const consoleErrors = [];
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    await page.evaluate((payload) => window.postMessage({
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: "speaker-nameplate-session",
      revision: 1,
      requestId: "speaker-nameplate-init",
      runId: "speaker-nameplate-run",
      start: {
        requestId: "speaker-nameplate-init",
        target: { sceneId: "scene_main", commandIndex: 0 },
        entryPath: [],
        mode: "stable_frame",
        playbackRate: 1,
      },
      ...payload,
    }, "*"), fixture());
    await page.locator(".dialog-box.has-child-layout .speaker.ui-layouted").waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForTimeout(250);

    const geometry = await page.evaluate(() => {
      const box = document.querySelector(".dialog-box.has-child-layout");
      const speaker = document.querySelector(".dialog-box.has-child-layout .speaker.ui-layouted");
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
      };
      const boxRect = rect(box);
      const speakerRect = rect(speaker);
      const probeX = speakerRect.left + speakerRect.width / 2;
      const probeY = speakerRect.top + Math.min(4, speakerRect.height / 3);
      return {
        box: boxRect,
        speaker: speakerRect,
        boxOverflow: getComputedStyle(box).overflow,
        speakerVisibility: getComputedStyle(speaker).visibility,
        speakerOpacity: getComputedStyle(speaker).opacity,
        speakerText: speaker.textContent?.trim() ?? "",
        upperProbeHitsSpeaker: document.elementsFromPoint(probeX, probeY).some((element) => element === speaker || speaker.contains(element)),
      };
    });

    assert(geometry.speaker.top < geometry.box.top, "Fixture did not place the nameplate above the dialog panel.", geometry);
    assert(geometry.speaker.bottom > geometry.box.top, "Fixture nameplate does not straddle the dialog panel.", geometry);
    assert(geometry.boxOverflow === "visible", "Dialog panel still clips custom child layouts.", geometry);
    assert(geometry.speakerVisibility === "visible" && Number(geometry.speakerOpacity) > 0, "Speaker nameplate is hidden.", geometry);
    assert(geometry.upperProbeHitsSpeaker, "The portion of the nameplate above the panel is clipped from hit testing.", geometry);
    assert(geometry.speakerText === "测试角色姓名", "Speaker text was not rendered.", geometry);
    assert(consoleErrors.length === 0, "Browser console reported errors.", consoleErrors);

    const screenshotPath = path.join(outDir, "speaker-nameplate-visible.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const report = { ok: true, geometry, consoleErrors, screenshotPath };
    fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    stopServer(server);
  }
}

main().catch((error) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "error.txt"), `${error.stack || error}\n${JSON.stringify(error.details ?? null, null, 2)}\n`, "utf8");
  console.error(error.stack || error);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
});
