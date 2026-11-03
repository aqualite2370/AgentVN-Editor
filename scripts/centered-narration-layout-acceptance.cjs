#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.AGENTVN_CENTERED_NARRATION_PORT || 6994);
const url = `http://127.0.0.1:${port}/`;
const vite = path.join(
  root,
  "GameCli_framework",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);
const outputDir = path.join(root, "output", "playwright", "centered-narration-layout");
const reportPath = path.join(outputDir, "report.json");

let server;
let serverOutput;

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function killPort(targetPort) {
  if (process.platform !== "win32") return;
  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${targetPort} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { if ($_ -gt 0) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }`,
      ],
      { windowsHide: true, stdio: "ignore" },
    );
  } catch {}
}

function startServer() {
  ensureDirectory(outputDir);
  const logPath = path.join(outputDir, "vite.log");
  serverOutput = fs.openSync(logPath, "a");
  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : vite;
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", vite, "--host", "127.0.0.1", "--port", String(port)]
    : ["--host", "127.0.0.1", "--port", String(port)];
  server = spawn(command, args, {
    cwd: path.join(root, "GameCli_framework"),
    stdio: ["ignore", serverOutput, serverOutput],
    shell: false,
    windowsHide: true,
  });
}

function stopServer() {
  try {
    server?.kill();
  } catch {}
  try {
    if (serverOutput !== undefined) fs.closeSync(serverOutput);
  } catch {}
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Vite server did not become reachable: ${url}`);
}

async function installFixture(page) {
  await page.evaluate(async () => {
    const { assetResolver } = await import("/src/engine/assetResolver.ts");
    const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
    const { useSettingsStore } = await import("/src/store/settingsStore.ts");
    const shortText = "心理诊疗室的窗帘半拉着，阳光在地板上切成一道明晃晃的条纹。";
    const longText = "心理诊疗室的窗帘半拉着，阳光在地板上切成一道明晃晃的条纹。墙上的时钟滴答作响，米色的沙发、浅绿色的墙面、茶几上的一盒纸巾——一切都布置得温和而克制，仿佛是刻意要抚平每一个走进这间屋子的人的神经。";
    const manifest = {
      game_id: "centered-narration-layout",
      title: "Centered Narration Layout",
      version: "1.0.0",
      locale: "zh-CN",
      assets: [],
      entry_scene_id: "scene",
    };
    const script = {
      schema_version: "1.4.0",
      game_id: "centered-narration-layout",
      entry_scene_id: "scene",
      characters: [],
      scenes: [{
        scene_id: "scene",
        title: "Centered narration",
        commands: [
          { type: "narration", text: shortText, narration_style: "centered" },
          { type: "narration", text: longText, narration_style: "centered" },
          {
            type: "narration",
            text: shortText,
            narration_style: "centered",
            dialog_style_mode: "manual",
            dialog_style: { font_size: 16 },
          },
        ],
      }],
    };
    assetResolver.configure(manifest, "", {});
    const runtime = useRuntimeStore.getState();
    runtime.engine.loadScript(script, manifest);
    useRuntimeStore.setState({
      currentGame: {
        install_id: "centered-narration-layout",
        game_id: "centered-narration-layout",
        title: "Centered Narration Layout",
        manifest,
        script,
        assetUrls: {},
      },
      screen: "playing",
      engineState: runtime.engine.state,
      isUiHidden: false,
      skipToggleActive: false,
      skipHoldActive: false,
    });
    useSettingsStore.getState().updateSettings({
      textSpeed: 18,
      skipUnread: true,
      autoSpeed: 1200,
      fullscreen: false,
    });
    useRuntimeStore.getState().startNewGame();
  });
}

async function sample(page) {
  return page.evaluate(() => {
    const box = document.querySelector(".dialog-box.is-centered-narration");
    const text = box?.querySelector(".dialog-text");
    const indicator = box?.querySelector(".continue-indicator");
    if (!(box instanceof HTMLElement) || !(text instanceof HTMLElement) || !(indicator instanceof HTMLElement)) {
      return null;
    }
    const boxRect = box.getBoundingClientRect();
    const textRect = text.getBoundingClientRect();
    const indicatorRect = indicator.getBoundingClientRect();
    const textStyle = getComputedStyle(text);
    return {
      elapsed: performance.now(),
      visibleText: text.textContent || "",
      fontSize: Number.parseFloat(textStyle.fontSize),
      textTop: textRect.top,
      textHeight: textRect.height,
      textScrollHeight: text.scrollHeight,
      indicatorTop: indicatorRect.top,
      indicatorBottomGap: boxRect.bottom - indicatorRect.bottom,
      boxHeight: boxRect.height,
      fontMode: box.dataset.dialogFontMode || "",
      adaptiveFontSize: box.dataset.dialogFontSize || "",
      uiTextScale: Number(box.dataset.uiTextScale || 1),
    };
  });
}

async function sampleSequence(page, durationMs = 1100, intervalMs = 55) {
  const samples = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt <= durationMs) {
    const value = await sample(page);
    if (value) samples.push(value);
    await page.waitForTimeout(intervalMs);
  }
  return samples;
}

function range(samples, key) {
  const values = samples.map((sample) => sample[key]).filter(Number.isFinite);
  return values.length ? Math.max(...values) - Math.min(...values) : Number.POSITIVE_INFINITY;
}

function finalValue(samples, key) {
  return samples.at(-1)?.[key];
}

async function advance(page) {
  await page.evaluate(async () => {
    const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
    useRuntimeStore.getState().next();
    await new Promise((resolve) => setTimeout(resolve, 30));
    useRuntimeStore.getState().next();
  });
}

async function main() {
  killPort(port);
  ensureDirectory(outputDir);
  startServer();
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#root", { timeout: 30_000 });
    await page.waitForTimeout(900);
    await installFixture(page);
    await page.waitForSelector(".dialog-box.is-centered-narration", { timeout: 20_000 });

    const shortSamples = await sampleSequence(page);
    await page.screenshot({ path: path.join(outputDir, "short-narration.png") });

    await advance(page);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-command-index") === "1",
      null,
      { timeout: 10_000 },
    );
    const longSamples = await sampleSequence(page, 1600);
    await page.screenshot({ path: path.join(outputDir, "long-narration.png") });
    await page.evaluate(async () => {
      const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
      useRuntimeStore.getState().next();
    });
    await page.waitForTimeout(120);
    const longCompleteSample = await sample(page);
    if (longCompleteSample) longSamples.push(longCompleteSample);
    await page.screenshot({ path: path.join(outputDir, "long-narration-complete.png") });
    await page.waitForFunction(
      () => (document.querySelector(".dialog-text")?.textContent?.length || 0) >= 90,
      null,
      { timeout: 10_000 },
    );
    await page.evaluate(async () => {
      const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
      useRuntimeStore.getState().next();
    });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-current-command-index") === "2",
      null,
      { timeout: 10_000 },
    );
    const manualSamples = await sampleSequence(page, 500);
    await page.screenshot({ path: path.join(outputDir, "manual-font-size-16.png") });

    const assertions = {
      defaultFontIsSmaller: Number(finalValue(shortSamples, "fontSize")) <= 22,
      shortFontStable: range(shortSamples, "fontSize") <= 0.75,
      longFontStable: range(longSamples, "fontSize") <= 0.75,
      longFontDoesNotGrowBeyondShort:
        Number(finalValue(longSamples, "fontSize")) <= Number(finalValue(shortSamples, "fontSize")) + 0.75,
      shortTextBoxStable: range(shortSamples, "textHeight") <= 1,
      longTextBoxStable: range(longSamples, "textHeight") <= 1,
      shortIndicatorStable: range(shortSamples, "indicatorTop") <= 1,
      longIndicatorStable: range(longSamples, "indicatorTop") <= 1,
      shortIndicatorAnchored:
        Number(finalValue(shortSamples, "indicatorBottomGap")) <= Math.max(48, Number(finalValue(shortSamples, "boxHeight")) * 0.14),
      longIndicatorAnchored:
        Number(finalValue(longSamples, "indicatorBottomGap")) <= Math.max(48, Number(finalValue(longSamples, "boxHeight")) * 0.14),
      longFullyRevealed: Number(finalValue(longSamples, "visibleText")?.length) >= 90,
      longFitsTextArea:
        Number(finalValue(longSamples, "textScrollHeight")) <= Number(finalValue(longSamples, "textHeight")) + 1,
      manualNarrationFontSync:
        Math.abs(
          Number(finalValue(manualSamples, "fontSize"))
          - Math.round(16 * Number(finalValue(manualSamples, "uiTextScale"))),
        ) <= 0.5,
    };
    const passed = Object.values(assertions).every(Boolean);
    const report = {
      status: passed ? "passed" : "failed",
      viewport: { width: 844, height: 390 },
      assertions,
      ranges: {
        shortFontSize: range(shortSamples, "fontSize"),
        longFontSize: range(longSamples, "fontSize"),
        shortTextHeight: range(shortSamples, "textHeight"),
        longTextHeight: range(longSamples, "textHeight"),
        shortIndicatorTop: range(shortSamples, "indicatorTop"),
        longIndicatorTop: range(longSamples, "indicatorTop"),
        manualFontSize: range(manualSamples, "fontSize"),
      },
      shortSamples,
      longSamples,
      manualSamples,
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    if (!passed) process.exitCode = 2;
  } finally {
    await browser?.close().catch(() => {});
    stopServer();
    killPort(port);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  stopServer();
  killPort(port);
  process.exit(1);
});
