#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const outputDir = path.join(root, "output", "playwright", "editor-capsule-slider");
const port = 6994;
const baseUrl = `http://127.0.0.1:${port}/`;

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Editor Vite server did not become ready");
}

async function installFixture(page, theme) {
  await page.evaluate((nextTheme) => {
    document.documentElement.dataset.theme = nextTheme;
    document.body.innerHTML = `
      <main style="display:grid;place-items:center;min-height:100vh;background:var(--workspace-bg);padding:48px">
        <section style="width:min(720px,80vw);padding:32px;border:1px solid var(--line);border-radius:12px;background:var(--panel-bg)">
          <span class="range-control" data-testid="slider" style="--range-progress:56%">
            <span class="range-control-track" aria-hidden="true">
              <span class="range-control-fill"></span>
            </span>
            <input class="range-control-input" type="range" aria-label="测试滑块" min="0" max="100" value="56">
          </span>
        </section>
      </main>
    `;
  }, theme);
}

async function sample(page) {
  return page.evaluate(() => {
    const slider = document.querySelector('[data-testid="slider"]');
    const track = slider?.querySelector(".range-control-track");
    const fill = slider?.querySelector(".range-control-fill");
    const input = slider?.querySelector(".range-control-input");
    if (!(slider instanceof HTMLElement) || !(track instanceof HTMLElement) || !(fill instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
      throw new Error("editor slider fixture is incomplete");
    }
    const sliderRect = slider.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const fillRect = fill.getBoundingClientRect();
    const sliderStyle = getComputedStyle(slider);
    const trackStyle = getComputedStyle(track);
    const inputStyle = getComputedStyle(input);
    return {
      sliderRect: { left: sliderRect.left, top: sliderRect.top, width: sliderRect.width, height: sliderRect.height },
      trackRect: { left: trackRect.left, top: trackRect.top, width: trackRect.width, height: trackRect.height },
      fillWidth: fillRect.width,
      sliderBorderWidth: sliderStyle.borderWidth,
      sliderBoxShadow: sliderStyle.boxShadow,
      sliderTransform: sliderStyle.transform,
      trackOpacity: Number(trackStyle.opacity),
      trackBoxShadow: trackStyle.boxShadow,
      trackBackground: trackStyle.backgroundImage,
      inputOutline: inputStyle.outlineStyle,
      inputBoxShadow: inputStyle.boxShadow,
      inputBackground: inputStyle.backgroundColor,
      transitionProperty: trackStyle.transitionProperty,
    };
  });
}

function sameRect(a, b) {
  return ["left", "top", "width", "height"].every((key) => Math.abs(a[key] - b[key]) < 0.2);
}

function sameCenterY(a, b) {
  return Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 0.2;
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | % { if ($_ -gt 0) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }`,
    ], { windowsHide: true, stdio: "ignore" });
  } catch {}

  const vite = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev -- --host 127.0.0.1 --port 6994"], {
    cwd: editorRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let viteLog = "";
  vite.stdout.on("data", (chunk) => { viteLog += chunk; });
  vite.stderr.on("data", (chunk) => { viteLog += chunk; });

  const browser = await chromium.launch({ headless: true });
  const pageErrors = [];
  try {
    await waitForServer();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    await installFixture(page, "blue_gray");
    const input = page.locator(".range-control-input");
    const idle = await sample(page);
    assert(Math.abs(idle.trackRect.height - 10) < 0.2, "dark-theme track must be 10px", idle);
    assert(idle.sliderBorderWidth === "0px" && idle.sliderBoxShadow === "none" && idle.sliderTransform === "none", "idle slider has an outer frame or geometry transform", idle);

    await input.hover();
    await page.waitForTimeout(180);
    const hovered = await sample(page);
    assert(sameRect(idle.sliderRect, hovered.sliderRect) && sameRect(idle.trackRect, hovered.trackRect), "slider geometry changed on hover", { idle, hovered });
    assert(hovered.sliderBorderWidth === "0px" && hovered.sliderBoxShadow === "none" && hovered.sliderTransform === "none", "hover added an outer frame", hovered);
    assert(hovered.trackOpacity > idle.trackOpacity, "hover did not apply paint-only emphasis", { idle: idle.trackOpacity, hovered: hovered.trackOpacity });

    const box = await input.boundingBox();
    assert(box, "slider input has no bounding box");
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(540);
    const active = await sample(page);
    assert(
      sameRect(hovered.sliderRect, active.sliderRect)
        && Math.abs(active.trackRect.width - hovered.trackRect.width) < 0.2
        && sameCenterY(hovered.trackRect, active.trackRect)
        && Math.abs(active.trackRect.height - hovered.trackRect.height * 1.22) < 0.25,
      "holding the slider did not slowly enlarge the capsule around its center",
      { hovered, active },
    );
    await page.mouse.up();
    await page.waitForTimeout(420);
    const settled = await sample(page);
    assert(sameRect(hovered.trackRect, settled.trackRect), "slider did not return to its idle thickness after release", { hovered, settled });

    await input.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    assert(await input.evaluate((element) => element.matches(":focus-visible")), "keyboard navigation did not produce focus-visible");
    const focused = await sample(page);
    assert(focused.inputOutline === "none" && focused.inputBoxShadow === "none", "focus restored the rectangular input frame", focused);
    assert(focused.trackBoxShadow !== idle.trackBoxShadow, "focus ring did not move to the capsule track", { idle: idle.trackBoxShadow, focused: focused.trackBoxShadow });

    await page.locator('[data-testid="slider"]').evaluate((element) => element.style.setProperty("--range-progress", "78%"));
    const progressed = await sample(page);
    assert(progressed.fillWidth > idle.fillWidth, "controlled progress did not resize the capsule fill", { idle: idle.fillWidth, progressed: progressed.fillWidth });
    await page.screenshot({ path: path.join(outputDir, "dark.png") });

    await installFixture(page, "white_gray");
    const light = await sample(page);
    assert(Math.abs(light.trackRect.height - 10) < 0.2 && light.trackBackground !== "none", "light-theme capsule styling is missing", light);
    await page.screenshot({ path: path.join(outputDir, "light.png") });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(100);
    const reducedBox = await input.boundingBox();
    assert(reducedBox, "reduced-motion slider input has no bounding box");
    await page.mouse.move(reducedBox.x + reducedBox.width * 0.7, reducedBox.y + reducedBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(280);
    const reduced = await sample(page);
    assert(reduced.transitionProperty.split(",").map((value) => value.trim()).every((value) => value === "opacity"), "reduced motion must retain only opacity feedback", reduced);
    assert(Math.abs(reduced.trackRect.height - 10) < 0.2, "reduced motion must suppress hold enlargement", reduced);
    await page.mouse.up();
    assert(pageErrors.length === 0, "editor slider browser run raised page errors", pageErrors);

    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify({ ok: true, idle, hovered, active, settled, focused, progressed, light, reduced, pageErrors }, null, 2));
    console.log(`editor-capsule-slider-playwright: PASS (${outputDir})`);
  } finally {
    await browser.close();
    try {
      execFileSync("taskkill.exe", ["/PID", String(vite.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      vite.kill();
    }
    fs.writeFileSync(path.join(outputDir, "vite.log"), viteLog);
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error));
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
