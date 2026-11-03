const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outDir = path.join(root, "output", "playwright", "android-flash");
const baseUrl = "http://127.0.0.1:6868/?mode=preview";

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

function fixture() {
  const now = new Date().toISOString();
  return {
    manifest: {
      manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.2.0",
      game_id: "android-flash", title: "Android Flash QA", author: "AgentVN QA", version: "1.0.0",
      description: "Android click and story-advance stability fixture", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "scene_main", assets: [], created_at: now, updated_at: now,
    },
    script: {
      schema_version: "1.0.0", game_id: "android-flash", title: "Android Flash QA", entry_scene_id: "scene_main",
      characters: [{ character_id: "tester", name: "Tester" }],
      scenes: [{ scene_id: "scene_main", title: "Main", chapter: 1, tags: [], commands: [
        { type: "dialog", character_id: "tester", speaker: "Tester", text: "第一句，用于验证触控推进只发生一次。" },
        { type: "dialog", character_id: "tester", speaker: "Tester", text: "第二句，用于验证没有空白帧。" },
        { type: "choice", choices: [
          { choice_id: "stay", text: "留在这里", target_scene_id: "scene_end", conditions: [] },
          { choice_id: "leave", text: "继续前进", target_scene_id: "scene_end", conditions: [] },
        ] },
      ] }, { scene_id: "scene_end", title: "End", chapter: 1, tags: [], commands: [
        { type: "dialog", character_id: "tester", speaker: "Tester", text: "选择完成。" },
      ] }],
    },
    uiSkin: {
      ui_layout_version: "1.0.0", name: "Android flash fixture", target_runtime: "0.2.0", assets: [],
      tokens: {
        colorBackground: "#060812", colorSurface: "#111827", colorSurfaceStrong: "#1f2937", colorInk: "#f8fafc",
        colorMuted: "#94a3b8", colorAccent: "#60a5fa", colorAccent2: "#f59e0b", colorLine: "#64748b",
        colorPanel: "#111827", colorPanelText: "#f8fafc", colorControl: "#1e293b", colorControlHover: "#334155",
        colorControlActive: "#2563eb", colorControlText: "#f8fafc", colorDialog: "#020617", colorDialogText: "#f8fafc",
        colorSpeakerPlate: "#1e3a8a", colorSpeakerText: "#f8fafc", colorChoice: "#1e293b", colorChoiceText: "#f8fafc",
        colorQuickMenu: "#ffffff", colorFocus: "#93c5fd", radius: 10, fontScale: 1,
      },
      screens: [],
    },
  };
}

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try { const response = await fetch(baseUrl); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("GameCLI Vite server did not become ready");
}

async function pressAndMeasure(page, locator, cycles = 50) {
  const initial = await locator.boundingBox();
  assert(initial, "control has no initial geometry");
  let maximumDelta = 0;
  let activeTransform = "none";
  for (let i = 0; i < cycles; i += 1) {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const during = await locator.boundingBox();
    const style = await locator.evaluate((element) => ({
      transform: getComputedStyle(element).transform,
      webkitTapHighlightColor: getComputedStyle(element).webkitTapHighlightColor,
    }));
    activeTransform = style.transform;
    maximumDelta = Math.max(maximumDelta, Math.abs(during.width - initial.width), Math.abs(during.height - initial.height));
    // Release outside the control so a navigation button is not activated; this
    // still exercises the browser's real :active/pointer capture path.
    await page.mouse.move(1, 1);
    await page.mouse.up();
  }
  return { initial, maximumDelta, activeTransform };
}

async function assertNoBlankFrame(page, action, label) {
  const before = await page.screenshot();
  await action();
  const frames = [];
  for (let i = 0; i < 8; i += 1) {
    frames.push(await page.screenshot());
    await page.waitForTimeout(16);
  }
  const blank = await page.evaluate(() => {
    const root = document.querySelector(".runtime-layout-frame");
    const player = document.querySelector(".story-player");
    if (!root) return true;
    const rootStyle = getComputedStyle(root);
    return rootStyle.visibility === "hidden" || Number(rootStyle.opacity) < 0.05 || (player && getComputedStyle(player).visibility === "hidden");
  });
  assert(!blank, `${label} produced a hidden/blank runtime frame`);
  assert(before.length > 0 && frames.every((frame) => frame.length > 0), `${label} screenshot sampling failed`);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const vite = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], { cwd: runtimeRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let viteLog = "";
  vite.stdout.on("data", (chunk) => { viteLog += chunk; });
  vite.stderr.on("data", (chunk) => { viteLog += chunk; });
  try {
    await waitForServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1304, height: 600 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 15; AgentVN QA) AppleWebKit/537.36 Chrome/138 Mobile Safari/537.36",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => { viteLog += `\nPAGEERROR ${error.stack || error.message}\n`; });
    page.on("console", (message) => { if (message.type() === "error") viteLog += `\nCONSOLE ${message.text()}\n`; });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate((payload) => window.postMessage(payload, "*"), {
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: "android-flash-qa",
      revision: 1,
      requestId: "android-flash-init",
      runId: "android-flash-run",
      ...fixture(),
      assetUrls: {},
      start: {
        requestId: "android-flash-start",
        target: { sceneId: "scene_main", commandIndex: 0 },
        entryPath: [],
        mode: "stable_frame",
        playbackRate: 1,
        reducedMotion: true,
      },
      screen: "title_menu",
    });
    await page.waitForSelector('[data-testid="start-new-game"]', { timeout: 20_000 });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("agentvn:android-insets", { detail: { top: 64, right: 0, bottom: 24, left: 0, revision: 1 } })));
    await page.waitForFunction(
      () => !document.querySelector(".boot-overlay") && !document.querySelector(".game-launch-blackout"),
      null,
      { timeout: 8_000 },
    );
    await page.waitForTimeout(120);

    const titleButton = page.locator('[data-testid="start-new-game"]');
    // The start button intentionally navigates away after release; measure the real
    // Android press once, then continue the 50-cycle stress on non-navigating controls.
    const titlePress = await pressAndMeasure(page, titleButton, 1);
    assert(titlePress.maximumDelta <= 1, "Android button geometry changed while pressed", titlePress);
    assert(titlePress.activeTransform === "none", "Android button press still uses a transform", titlePress);

    await page.evaluate(() => window.postMessage({ type: "agentvn.runtime.screen", screen: "settings" }, "*"));
    await page.waitForFunction(
      () => !document.querySelector(".runtime-screen-transition.is-active"),
      null,
      { timeout: 8_000 },
    );
    await page.waitForSelector(".settings-tabs button", { timeout: 8_000 });
    if (await page.locator(".settings-tabs button").count() === 0) {
      const debugState = await page.evaluate(() => ({
        bodyText: document.body.innerText,
        runtimeScreen: document.querySelector("[data-runtime-screen]")?.getAttribute("data-runtime-screen"),
        runtimeState: document.querySelector("[data-runtime-state]")?.getAttribute("data-runtime-state"),
        titleButtonCount: document.querySelectorAll('[data-testid="start-new-game"]').length,
        storyPlayerCount: document.querySelectorAll(".story-player").length,
        transition: document.querySelector(".runtime-screen-transition")?.className,
      }));
      await page.screenshot({ path: path.join(outDir, "settings-timeout.png") });
      throw new Error(`settings screen did not render after runtime.screen message: ${JSON.stringify(debugState)}`);
    }
    const settingsPress = await pressAndMeasure(page, page.locator(".settings-tabs button").first());
    assert(settingsPress.maximumDelta <= 1 && settingsPress.activeTransform === "none", "Android settings tab changes geometry while pressed", settingsPress);

    await page.evaluate(() => window.postMessage({ type: "agentvn.runtime.screen", screen: "playing" }, "*"));
    await page.waitForFunction(
      () => !document.querySelector(".runtime-screen-transition.is-active"),
      null,
      { timeout: 8_000 },
    );
    await page.waitForSelector(".dialog-box");
    await page.waitForTimeout(700);
    const beforeIndex = Number(await page.locator(".story-player").getAttribute("data-current-command-index"));
    const dispatchTap = (locator) => locator.evaluate((element) => {
      const init = { bubbles: true, cancelable: true, pointerId: 17, pointerType: "touch", button: 0, clientX: 600, clientY: 450 };
      element.dispatchEvent(new PointerEvent("pointerdown", init));
      element.dispatchEvent(new PointerEvent("pointerup", init));
    });
    await assertNoBlankFrame(page, () => dispatchTap(page.locator(".dialog-box")), "dialog advance");
    await page.waitForTimeout(120);
    const afterIndex = Number(await page.locator(".story-player").getAttribute("data-current-command-index"));
    assert(afterIndex === beforeIndex + 1, "one Android tap advanced the story more than once", { beforeIndex, afterIndex });

    await dispatchTap(page.locator(".dialog-box"));
    await page.waitForTimeout(120);
    if (!(await page.locator(".choice-panel button").count())) {
      await dispatchTap(page.locator(".dialog-box"));
    }
    await page.waitForSelector(".choice-panel button", { timeout: 5_000 });
    const choicePress = await pressAndMeasure(page, page.locator(".choice-panel button").first());
    assert(choicePress.maximumDelta <= 1 && choicePress.activeTransform === "none", "Android choice changes geometry while pressed", choicePress);

    await page.screenshot({ path: path.join(outDir, "final.png") });
    const report = { ok: true, titlePress, settingsPress, choicePress, beforeIndex, afterIndex };
    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
    await browser.close();
    console.log(`Android flash acceptance passed: ${outDir}`);
  } finally {
    try { execFileSync("taskkill.exe", ["/PID", String(vite.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { vite.kill(); }
    fs.writeFileSync(path.join(outDir, "vite.log"), viteLog);
  }
})().catch((error) => { console.error(error); process.exit(1); });
