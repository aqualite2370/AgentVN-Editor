#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outputDir = path.join(root, "output", "playwright", "quick-menu-direction");
const baseUrl = "http://127.0.0.1:6868/?mode=preview";

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
  }
}

function fixture(direction) {
  const now = new Date().toISOString();
  // Direction is retained here as a legacy authored input.  The shipped
  // runtime deliberately ignores it: the quick menu is fixed outside the
  // dialogue, above its top-right corner, and must not drift with the old
  // up/down placement model.
  const quickMenuRect = { x: 98, y: 2, width: 48, height: 8, anchor: "top_right" };
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.6.0",
      game_id: "quick-menu-direction",
      title: "Quick Menu Direction",
      author: "AgentVN QA",
      version: "1.0.0",
      description: "Quick menu direction acceptance",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene_main",
      assets: [],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.5.0",
      game_id: "quick-menu-direction",
      title: "Quick Menu Direction",
      entry_scene_id: "scene_main",
      characters: [],
      scenes: [{
        scene_id: "scene_main",
        title: "Main",
        chapter: 1,
        tags: [],
        commands: [
          { type: "narration", text: "方向布局测试。" },
          { type: "narration", text: "关闭按钮必须保持可点击。" },
        ],
      }],
    },
    uiSkin: {
      ui_layout_version: "1.3.0",
      name: "Quick menu direction skin",
      target_runtime: "0.6.0",
      assets: [],
      tokens: {
        colorBackground: "#060812",
        colorSurface: "#0d121f",
        colorSurfaceStrong: "#192234",
        colorInk: "#f6f8ff",
        colorMuted: "#aeb9cc",
        colorAccent: "#82b6ff",
        colorAccent2: "#f2a0c4",
        colorLine: "#d8e2ff",
        colorControl: "#192234",
        colorControlHover: "#24324d",
        colorControlActive: "#82b6ff",
        colorControlText: "#f6f8ff",
        colorQuickMenu: "#0d121f",
        colorFocus: "#82b6ff",
        radius: 10,
      },
      screens: [{
        screen_id: "player",
        components: [
          { component_id: "dialog_panel", component_type: "dialog_panel", required: true, rect: { x: 6, y: 76, width: 88, height: 18 } },
          { component_id: "choice_list", component_type: "choice_list", required: true, rect: { x: 50, y: 44, width: 34, height: 32, anchor: "center" } },
          {
            component_id: "quick_menu",
            component_type: "quick_menu",
            required: true,
            rect: quickMenuRect,
            mobileRect: quickMenuRect,
            style: { quickMenuDirection: direction, opacity: 0.72, padding: 4, gap: 3 },
          },
        ],
      }],
    },
  };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("GameCLI Vite server did not become ready");
}

async function initPage(page, direction, id) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ payload, sessionId }) => {
    window.postMessage({
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId,
      revision: 1,
      requestId: `${sessionId}-init`,
      runId: `${sessionId}-run`,
      manifest: payload.manifest,
      script: payload.script,
      uiSkin: payload.uiSkin,
      assetUrls: {},
      start: {
        requestId: `${sessionId}-start`,
        target: { sceneId: "scene_main", commandIndex: 0 },
        entryPath: [],
        mode: "stable_frame",
        playbackRate: 1,
        reducedMotion: true,
      },
      screen: "playing",
    }, "*");
  }, { payload: fixture(direction), sessionId: `quick-menu-direction-${id}` });
  const toggle = page.getByTestId("quick-menu-toggle");
  await toggle.waitFor({ state: "visible", timeout: 20_000 });
  await toggle.click();
  await page.waitForFunction(() => (
    document.querySelector(".quick-menu-surface")?.getAttribute("aria-hidden") === "false"
  ));
  await page.waitForTimeout(520);
}

async function sample(page) {
  return page.evaluate(() => {
    const compact = (rect) => rect
      ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
      : null;
    const intersects = (a, b) => Boolean(
      a && b
      && a.left < b.right
      && a.right > b.left
      && a.top < b.bottom
      && a.bottom > b.top,
    );
    const controls = document.querySelector(".playback-controls");
    const surface = document.querySelector(".quick-menu-surface");
    const actionLayer = document.querySelector(".quick-menu-action-layer");
    const toggle = document.querySelector('[data-testid="quick-menu-toggle"]');
    const buttons = [...document.querySelectorAll(".quick-menu-button")];
    const labels = buttons.map((button) => button.querySelector(".quick-menu-button-label"));
    if (!controls || !surface || !toggle || buttons.length === 0) throw new Error("quick-menu DOM is incomplete");
    const toggleRect = compact(toggle.getBoundingClientRect());
    const buttonRects = buttons.map((button) => compact(button.getBoundingClientRect()));
    const surfaceRect = compact(surface.getBoundingClientRect());
    const dialogRect = compact(document.querySelector(".dialog-box")?.getBoundingClientRect());
    const viewport = { width: innerWidth, height: innerHeight };
    const frameRect = compact(document.querySelector(".runtime-layout-frame")?.getBoundingClientRect());
    const hit = document.elementFromPoint(
      toggleRect.left + toggleRect.width / 2,
      toggleRect.top + toggleRect.height / 2,
    );
    const toggleStyle = getComputedStyle(toggle);
    const firstStyle = getComputedStyle(buttons[0]);
    return {
      direction: controls.getAttribute("data-quick-menu-direction"),
      variant: controls.getAttribute("data-quick-menu-variant"),
      expanded: surface.getAttribute("aria-hidden") === "false",
      viewport,
      frameRect,
      surfaceRect,
      dialogRect,
      toggleRect,
      buttonRects,
      buttonCount: buttons.length,
      visibleLabels: buttons.map((button) => button.querySelector(".quick-menu-button-label")?.textContent?.trim() ?? ""),
      ariaLabels: buttons.map((button) => button.getAttribute("aria-label") ?? ""),
      titles: buttons.map((button) => button.getAttribute("title") ?? ""),
      clippedLabelIndexes: labels.flatMap((label, index) => (
        label && label.scrollWidth <= label.clientWidth + 1 && label.scrollHeight <= label.clientHeight + 1 ? [] : [index]
      )),
      toggleHit: Boolean(hit && (hit === toggle || toggle.contains(hit))),
      buttonOverlapsToggle: buttonRects.map((rect) => intersects(rect, toggleRect)),
      buttonOverlaps: buttonRects.flatMap((left, index) => buttonRects.slice(index + 1).map((right, rightIndex) => ({
        left: index,
        right: index + rightIndex + 1,
        overlap: intersects(left, right),
      }))).filter((item) => item.overlap),
      style: {
        toggleWidth: toggleRect.width,
        toggleHeight: toggleRect.height,
        toggleRadius: toggleStyle.borderRadius,
        toggleBackground: toggleStyle.backgroundColor,
        toggleBorder: toggleStyle.borderWidth,
        toggleShadow: toggleStyle.boxShadow,
        buttonWidth: buttonRects[0].width,
        buttonHeight: buttonRects[0].height,
        buttonRadius: firstStyle.borderRadius,
        buttonBackground: firstStyle.backgroundColor,
        buttonBorder: firstStyle.borderWidth,
        actionLayerPaddingTop: actionLayer ? getComputedStyle(actionLayer).paddingTop : "",
        actionLayerPaddingBottom: actionLayer ? getComputedStyle(actionLayer).paddingBottom : "",
      },
    };
  });
}

function assertLayout(sample, expectedDirection, label) {
  assert(sample.direction === expectedDirection, `${label} resolved direction mismatch`, sample);
  assert(sample.variant === "C", `${label} must use the C drawer variant`, sample);
  assert(sample.expanded, `${label} menu did not expand`, sample);
  assert(sample.buttonCount === 7, `${label} must render seven action buttons`, sample);
  assert(
    JSON.stringify(sample.visibleLabels) === JSON.stringify(["回退", "自动", "快进", "存档", "历史", "隐藏", "菜单"]),
    `${label} visible quick-menu labels must be two-character shortcuts`,
    sample,
  );
  assert(sample.ariaLabels[1] === "开启自动播放" && sample.ariaLabels[2] === "开启快进", `${label} full state labels must remain accessible`, sample);
  assert(sample.ariaLabels[3] === "打开存档读档" && sample.ariaLabels[4] === "打开历史记录", `${label} action semantics must remain accessible`, sample);
  assert(sample.clippedLabelIndexes.length === 0, `${label} visible quick-menu label was clipped`, sample);
  assert(sample.toggleHit, `${label} close button center is not clickable`, sample);
  assert(!sample.buttonOverlapsToggle.some(Boolean), `${label} close button overlaps an action button`, sample);
  assert(sample.buttonOverlaps.length === 0, `${label} action buttons overlap each other`, sample);
  for (const [index, rect] of sample.buttonRects.entries()) {
    assert(
      rect.left >= 0 && rect.top >= 0 && rect.right <= sample.viewport.width && rect.bottom <= sample.viewport.height,
      `${label} action button ${index} leaves the viewport`,
      sample,
    );
  }
  assert(
    sample.surfaceRect.left >= 0
      && sample.surfaceRect.top >= 0
      && sample.surfaceRect.right <= sample.viewport.width
      && sample.surfaceRect.bottom <= sample.viewport.height,
    `${label} surface leaves the viewport`,
    sample,
  );
  assert(sample.dialogRect, `${label} dialogue box is missing`, sample);
  assert(
    sample.surfaceRect.bottom <= sample.dialogRect.top + 1
      && sample.toggleRect.bottom <= sample.dialogRect.top + 1,
    `${label} quick menu must remain outside and above the dialogue box`,
    sample,
  );
  if (expectedDirection === "down") {
    const firstTop = Math.min(...sample.buttonRects.map((rect) => rect.top));
    if (sample.columns === 1) {
      assert(firstTop >= sample.toggleRect.bottom - 0.5, `${label} down actions must be below the close button`, sample);
    }
  } else {
    const lastBottom = Math.max(...sample.buttonRects.map((rect) => rect.bottom));
    if (sample.columns === 1) {
      assert(lastBottom <= sample.toggleRect.top + 0.5, `${label} up actions must stay above the close button`, sample);
    }
  }
}

function assertSharedVisualSpec(up, down, label) {
  for (const key of ["toggleWidth", "toggleHeight", "buttonWidth", "buttonHeight"]) {
    assert(Math.abs(up.style[key] - down.style[key]) <= 0.5, `${label} ${key} changed with legacy direction input`, { up, down });
  }
  for (const key of ["toggleBackground", "toggleBorder", "buttonRadius", "buttonBorder"]) {
    assert(up.style[key] === down.style[key], `${label} ${key} changed with legacy direction input`, { up, down });
  }
  assert(up.style.toggleRadius === down.style.toggleRadius, `${label} close-button geometry changed with legacy direction input`, { up, down });
  assert(up.style.toggleShadow === down.style.toggleShadow, `${label} close-button shadow changed with legacy direction input`, { up, down });
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const vite = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], {
    cwd: runtimeRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let viteLog = "";
  vite.stdout.on("data", (chunk) => { viteLog += chunk; });
  vite.stderr.on("data", (chunk) => { viteLog += chunk; });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const viewports = [
    { name: "reported-757x299", width: 757, height: 299 },
    { name: "wide-desktop", width: 1440, height: 900 },
    { name: "narrow-mobile", width: 932, height: 430 },
  ];
  try {
    await waitForServer();
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        screen: { width: viewport.width, height: viewport.height },
        isMobile: viewport.width <= 932,
        hasTouch: viewport.width <= 932,
        userAgent: viewport.width <= 932
          ? "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
          : undefined,
      });
      try {
        const upPage = await context.newPage();
        await initPage(upPage, "up", `${viewport.name}-up`);
        const up = await sample(upPage);
        assertLayout(up, "up", `${viewport.name} up`);
        await upPage.locator('[data-ui-component-id="quick_auto_button"]').click();
        await upPage.locator('[data-ui-component-id="quick_skip_button"]').click();
        await upPage.waitForFunction(() => {
          const auto = document.querySelector('[data-ui-component-id="quick_auto_button"]');
          const skip = document.querySelector('[data-ui-component-id="quick_skip_button"]');
          return auto?.getAttribute("aria-label") === "关闭自动播放"
            && auto?.getAttribute("title") === "关闭自动播放"
            && skip?.getAttribute("aria-label") === "关闭快进"
            && skip?.getAttribute("title") === "关闭快进";
        });
        const activeState = await sample(upPage);
        assert(activeState.visibleLabels[1] === "自动" && activeState.visibleLabels[2] === "快进", `${viewport.name} state changes altered visible shortcuts`, activeState);
        await upPage.screenshot({ path: path.join(outputDir, `${viewport.name}-up.png`) });

        const downPage = await context.newPage();
        await initPage(downPage, "down", `${viewport.name}-down`);
        const down = await sample(downPage);
        assertLayout(down, "up", `${viewport.name} legacy down input`);
        assertSharedVisualSpec(up, down, `${viewport.name} fixed placement`);
        await downPage.screenshot({ path: path.join(outputDir, `${viewport.name}-down.png`) });
        results.push({ viewport, up, activeState, down });
        await upPage.close();
        await downPage.close();
      } finally {
        await context.close();
      }
    }
    const staleErrorPath = path.join(outputDir, "error.txt");
    if (fs.existsSync(staleErrorPath)) fs.unlinkSync(staleErrorPath);
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify({ ok: true, results }, null, 2)}\n`, "utf8");
    console.log(`quick-menu-direction-playwright: PASS (${outputDir})`);
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
