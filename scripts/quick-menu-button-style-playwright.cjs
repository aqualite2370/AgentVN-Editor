#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outputDir = path.join(root, "output", "playwright", "quick-menu-button-style");
const baseUrl = "http://127.0.0.1:6868/?mode=preview";
const imageData = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="18" fill="#7c3aed"/><path d="M24 48h48M48 24v48" stroke="#fff" stroke-width="9" stroke-linecap="round"/></svg>',
);

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

function colorAlpha(value) {
  if (!value || value === "transparent") return 0;
  const rgba = value.match(/^rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([0-9.]+))?\)$/);
  if (rgba) return rgba[1] === undefined ? 1 : Number(rgba[1]);
  const modern = value.match(/\/\s*([0-9.]+)\s*\)?$/);
  return modern ? Number(modern[1]) : 1;
}

function fixture() {
  const now = new Date().toISOString();
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.6.0",
      game_id: "quick-menu-button-style",
      title: "Quick Menu Style",
      author: "AgentVN QA",
      version: "1.0.0",
      description: "Quick menu style acceptance",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene_main",
      assets: [{
        asset_id: "quick_button_art",
        asset_type: "ui",
        path: "assets/ui/quick-button.svg",
        filename: "quick-button.svg",
        mime_type: "image/svg+xml",
      }],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.5.0",
      game_id: "quick-menu-button-style",
      title: "Quick Menu Style",
      entry_scene_id: "scene_main",
      characters: [],
      scenes: [{
        scene_id: "scene_main",
        title: "Main",
        chapter: 1,
        tags: [],
        commands: [{
          type: "choice",
          choices: [
            { choice_id: "choice_default", text: "默认选项", target_scene_id: "scene_main", conditions: [] },
            {
              choice_id: "choice_color",
              text: "自定义颜色",
              target_scene_id: "scene_main",
              conditions: [],
              button_style: {
                backgroundColor: "#7c3aed",
                color: "#f8fafc",
                borderColor: "#c4b5fd",
                opacity: 0.22,
                shadow: "soft",
              },
            },
            {
              choice_id: "choice_image",
              text: "图片按钮",
              target_scene_id: "scene_main",
              conditions: [],
              button_style: {
                backgroundImage: "asset:quick_button_art",
                backgroundFit: "cover",
                backgroundColor: "#ef4444",
                borderColor: "#fef2f2",
                borderWidth: 4,
                opacity: 0.25,
                shadow: "strong",
              },
            },
          ],
        }],
      }],
    },
    uiSkin: {
      ui_layout_version: "1.2.0",
      name: "Quick menu acceptance skin",
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
          { component_id: "choice_list", component_type: "choice_list", required: true, rect: { x: 50, y: 44, width: 34, height: 32, anchor: "center" }, mobileRect: { x: 40.37, y: 42.63, width: 54.12, height: 23.15, anchor: "center" }, style: { opacity: 0.35 } },
          { component_id: "quick_menu", component_type: "quick_menu", required: true, rect: { x: 98, y: 2, width: 42, height: 9, anchor: "top_right" }, mobileRect: { x: 98, y: 2, width: 50, height: 10, anchor: "top_right" }, style: { backgroundColor: "#0d121f", borderRadius: 16, opacity: 0.64, padding: 4, gap: 3 } },
          { component_id: "quick_hide_ui_button", component_type: "quick_button", label: "隐藏界面按钮", style: { backgroundImage: "asset:quick_button_art", backgroundFit: "cover", backgroundColor: "#ef4444", borderColor: "#fef2f2", borderWidth: 4, borderRadius: 18, opacity: 0.58, shadow: "strong" } },
          { component_id: "quick_auto_button", component_type: "quick_button", label: "自动播放按钮", style: { backgroundColor: "#14532d", color: "#dcfce7", borderColor: "#22c55e", borderWidth: 2, borderRadius: 7, opacity: 0.52 } },
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
  try {
    await waitForServer();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const data = fixture();
    await page.evaluate(({ payload, assetUrl }) => {
      window.postMessage({
        type: "agentvn.live-preview.init",
        protocolVersion: 2,
        sessionId: "quick-menu-style-session",
        revision: 1,
        requestId: "quick-menu-style-init",
        runId: "quick-menu-style-run",
        manifest: payload.manifest,
        script: payload.script,
        uiSkin: payload.uiSkin,
        assetUrls: { quick_button_art: assetUrl, "assets/ui/quick-button.svg": assetUrl },
        start: {
          requestId: "quick-menu-style-init",
          target: { sceneId: "scene_main", commandIndex: 0 },
          entryPath: [],
          mode: "stable_frame",
          playbackRate: 1,
          reducedMotion: true,
        },
        screen: "playing",
      }, "*");
    }, { payload: data, assetUrl: imageData });

    const toggle = page.getByTestId("quick-menu-toggle");
    await toggle.waitFor({ state: "visible", timeout: 20_000 });
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    await page.waitForTimeout(520);
    await page.waitForFunction(() => {
      const choices = [...document.querySelectorAll(".choice-panel .choice-option")];
      return choices.length >= 3 && choices.every((choice) => {
        const style = getComputedStyle(choice);
        return (
          Number(style.opacity) >= 0.999
          && style.filter === "none"
          && (style.transform === "none" || style.transform === "matrix(1, 0, 0, 1, 0, 0)")
          && choice.getAnimations().every((animation) => animation.playState === "finished")
        );
      });
    }, undefined, { timeout: 10_000 });

    await page.waitForSelector('[data-ui-component-id="quick_rollback_button"]', { timeout: 20_000 });
    const imageButton = page.locator('[data-ui-component-id="quick_hide_ui_button"]');
    const auto = page.locator('[data-ui-component-id="quick_auto_button"]');
    const materialButton = page.locator('[data-ui-component-id="quick_history_button"]');
    const disabledButton = page.locator('[data-ui-component-id="quick_rollback_button"]');
    const choicePanel = page.locator(".choice-panel");
    const choiceButton = page.locator(".choice-panel .choice-option").first();
    const customColorChoice = page.locator(".choice-panel .choice-option").nth(1);
    const imageOwnedChoice = page.locator(".choice-panel .choice-option").nth(2);
    const menu = page.locator(".quick-menu-surface");
    const before = await page.evaluate(() => {
      const canonicalColor = (value) => {
        const probe = document.createElement("span");
        probe.style.color = value;
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      const sample = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const visual = getComputedStyle(element, "::before");
        const actionBackground = style.getPropertyValue("--runtime-quick-menu-action-background").trim();
        return {
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          opacity: Number(style.opacity),
          transform: style.transform,
          backgroundImage: style.backgroundImage,
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          borderWidth: style.borderWidth,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          cursor: style.cursor,
          filter: style.filter,
          actionBackgroundColor: canonicalColor(actionBackground || "transparent"),
          visual: {
            content: visual.content,
            opacity: visual.opacity,
            backgroundColor: visual.backgroundColor,
            backgroundImage: visual.backgroundImage,
            borderColor: visual.borderColor,
            borderWidth: visual.borderWidth,
            borderRadius: visual.borderRadius,
            boxShadow: visual.boxShadow,
            filter: visual.filter,
          },
          inlineStyle: element.getAttribute("style"),
        };
      };
      const expandIcon = document.querySelector('[data-testid="quick-menu-toggle"] [data-precision-icon="expand"]');
      const expandIconLayer = expandIcon?.closest(".quick-menu-toggle-icon");
      const dots = Array.from(expandIcon?.querySelectorAll("circle") ?? []).map((circle) => ({
        cx: Number(circle.getAttribute("cx")),
        cy: Number(circle.getAttribute("cy")),
        r: Number(circle.getAttribute("r")),
        fill: circle.getAttribute("fill"),
        stroke: circle.getAttribute("stroke"),
      }));
      return {
        menu: sample(document.querySelector(".quick-menu-surface")),
        toggle: sample(document.querySelector('[data-testid="quick-menu-toggle"]')),
        imageButton: sample(document.querySelector('[data-ui-component-id="quick_hide_ui_button"]')),
        auto: sample(document.querySelector('[data-ui-component-id="quick_auto_button"]')),
        materialButton: sample(document.querySelector('[data-ui-component-id="quick_history_button"]')),
        disabledButton: sample(document.querySelector('[data-ui-component-id="quick_rollback_button"]')),
        expectedAutoBackground: canonicalColor("rgb(20, 83, 45)"),
        expectedTransparent: canonicalColor("transparent"),
          dots,
          expandIconOpacity: expandIconLayer ? Number(getComputedStyle(expandIconLayer).opacity) : 1,
          toggleIcon: document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("data-quick-menu-icon"),
          variant: document.querySelector(".playback-controls")?.getAttribute("data-quick-menu-variant"),
        direction: document.querySelector(".playback-controls")?.getAttribute("data-quick-menu-direction"),
        toggleSurfaceCount: document.querySelectorAll(".quick-menu-toggle-surface").length,
        toggleVisualPseudo: getComputedStyle(document.querySelector('[data-testid="quick-menu-toggle"]'), "::before").backgroundColor,
        togglePseudoContent: getComputedStyle(document.querySelector('[data-testid="quick-menu-toggle"]'), "::before").content,
      };
    });
    const choiceBefore = await choiceButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        hovered: element.matches(":hover"),
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        opacity: style.opacity,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
        filter: style.filter,
        transform: style.transform,
        borderRadius: style.borderRadius,
      };
    });
    const choicePanelOpacity = await choicePanel.evaluate((element) => getComputedStyle(element).opacity);
    const customColorChoiceStyle = await customColorChoice.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        opacity: style.opacity,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
      };
    });
    const imageOwnedChoiceStyle = await imageOwnedChoice.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        frameMode: element.getAttribute("data-ui-frame-mode"),
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderWidth: style.borderWidth,
        boxShadow: style.boxShadow,
      };
    });
    await choiceButton.hover();
    await page.waitForTimeout(650);
    const choiceAfter = await choiceButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        hovered: element.matches(":hover"),
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        opacity: style.opacity,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
        filter: style.filter,
        transform: style.transform,
        borderRadius: style.borderRadius,
      };
    });
    const autoCenter = await auto.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(autoCenter.x, autoCenter.y);
    await page.waitForTimeout(650);
    const afterAuto = await auto.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        opacity: Number(style.opacity),
        transform: style.transform,
        hovered: element.matches(":hover"),
        disabled: element.disabled,
        inlineStyle: element.getAttribute("style"),
      };
    });
    await page.mouse.move(640, 360);
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    const imageButtonCenter = await imageButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(imageButtonCenter.x, imageButtonCenter.y);
    await page.waitForTimeout(650);
    const afterImageButton = await imageButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        className: element.className,
        focused: document.activeElement === element,
        focusVisible: element.matches(":focus-visible"),
        hovered: element.matches(":hover"),
        opacity: Number(style.opacity),
        transform: style.transform,
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderWidth,
        boxShadow: style.boxShadow,
      };
    });
    await page.mouse.move(640, 360);
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    const materialCenter = await materialButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(materialCenter.x, materialCenter.y);
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    await page.waitForTimeout(180);
    const materialHover = await materialButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visual = getComputedStyle(element, "::before");
      return {
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderColor: style.borderColor,
        borderWidth: style.borderWidth,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        filter: style.filter,
        transform: style.transform,
        visual: {
          backgroundColor: visual.backgroundColor,
          backgroundImage: visual.backgroundImage,
          borderColor: visual.borderColor,
          borderWidth: visual.borderWidth,
          borderRadius: visual.borderRadius,
          boxShadow: visual.boxShadow,
          filter: visual.filter,
        },
      };
    });
    await page.mouse.down();
    await page.waitForTimeout(30);
    const materialPressed = await materialButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visual = getComputedStyle(element, "::before");
      return {
        active: element.matches(":active"),
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderColor: style.borderColor,
        borderWidth: style.borderWidth,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        filter: style.filter,
        transform: style.transform,
        visual: {
          backgroundColor: visual.backgroundColor,
          backgroundImage: visual.backgroundImage,
          borderColor: visual.borderColor,
          borderWidth: visual.borderWidth,
          borderRadius: visual.borderRadius,
          boxShadow: visual.boxShadow,
          filter: visual.filter,
        },
      };
    });
    await page.mouse.move(640, 360);
    await page.mouse.up();
    await materialButton.focus();
    for (let tabIndex = 0; tabIndex < 16; tabIndex += 1) {
      if (await materialButton.evaluate((element) => document.activeElement === element)) break;
      await page.keyboard.press("Tab");
    }
    const materialFocus = await materialButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        focused: document.activeElement === element,
        focusVisible: element.matches(":focus-visible"),
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
      };
    });
    const disabledState = await disabledButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        disabled: element.disabled,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        opacity: Number(style.opacity),
        backgroundColor: style.backgroundColor,
        color: style.color,
        cursor: style.cursor,
        filter: style.filter,
        ariaLabel: element.getAttribute("aria-label"),
        title: element.getAttribute("title"),
      };
    });
    await page.mouse.move(640, 360);
    const toggleCenter = await toggle.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(toggleCenter.x, toggleCenter.y);
    await page.waitForTimeout(180);
    const afterToggle = await toggle.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        opacity: Number(style.opacity),
        transform: style.transform,
        boxShadow: style.boxShadow,
      };
    });

    const sameRect = (a, b) => ["left", "top", "width", "height"].every((key) => Math.abs(a[key] - b[key]) < 0.2);
    const isIdentityTransform = (value) => value === "none" || value === "matrix(1, 0, 0, 1, 0, 0)";
    assert(before.menu.borderRadius !== "999px", "expanded quick menu surface still renders as a pill", before.menu);
    assert(before.menu.opacity === 1 && isIdentityTransform(before.menu.transform), "expanded quick menu surface did not settle", before.menu);
    assert(before.variant === "C", "formal quick menu must default to C", before);
    assert(before.direction === "up", "formal quick menu auto direction must resolve upward", before);
    assert(before.menu.rect.width >= 196, "expanded C quick menu must use the responsive width", before);
    assert(await page.locator(".quick-menu-surface .preview-badge").count() === 0, "preview mode must not inject a synthetic quick-menu button");
    assert(before.menu.rect.height >= 400, "expanded C quick menu must use the fixed 1 × 8 drawer height", before.menu);
    assert(await page.locator('[data-ui-component-id="quick_settings_button"]').count() === 0, "playback quick menu still exposes settings");
    assert(Math.abs(before.toggle.rect.width - (before.menu.rect.width - 12)) < 2, "expanded quick-menu X must fill the single drawer track", before.toggle);
    assert(before.toggle.rect.height >= 44 && before.toggle.rect.height <= 52, "expanded quick-menu X must fill the eighth drawer row", before.toggle);
    assert(before.toggle.borderRadius !== "50%", "expanded quick-menu X must not remain a detached circle", before.toggle);
    assert(before.toggleIcon === "close" && before.dots.length === 3 && before.expandIconOpacity === 0, "expanded quick-menu toggle must crossfade away from the three dots without removing their centered layer", before);
    assert(before.toggleSurfaceCount === 0, "quick-menu toggle contains a redundant nested visual container", before);
    assert(before.togglePseudoContent === "none" && before.toggleVisualPseudo === "rgba(0, 0, 0, 0)", "quick-menu toggle retained a pseudo background or arc", before);
    assert(sameRect(before.auto.rect, afterAuto.rect), "quick button geometry changed on hover", { before: before.auto, after: afterAuto });
    assert(afterAuto.opacity >= before.auto.opacity, "quick button hover unexpectedly reduced opacity", { before: before.auto.opacity, after: afterAuto.opacity });
    assert(isIdentityTransform(afterAuto.transform), "quick button hover introduced a transform", afterAuto);
    assert(before.materialButton.visual.content === "none" && colorAlpha(before.materialButton.backgroundColor) >= 0.6, "quick button material is not owned by the real button", before.materialButton);
    assert(sameRect(before.materialButton.rect, materialHover.rect), "Material hover changed quick-button geometry", { before: before.materialButton, materialHover });
    for (const key of ["backgroundColor", "backgroundImage", "borderColor", "borderWidth", "borderRadius", "boxShadow", "filter"]) {
      assert(materialHover[key] === before.materialButton[key], `quick-menu hover changed visual ${key}`, { before: before.materialButton, materialHover });
    }
    assert(isIdentityTransform(materialHover.transform), "Material hover must not move the quick button", materialHover);
    assert(materialPressed.active, "Material pressed sample did not reach the active state", materialPressed);
    assert(sameRect(before.materialButton.rect, materialPressed.rect), "Material pressed state changed quick-button geometry", { before: before.materialButton, materialPressed });
    assert(
      materialPressed.filter !== materialHover.filter
        || materialPressed.boxShadow !== materialHover.boxShadow
        || materialPressed.backgroundColor !== materialHover.backgroundColor,
      "Material pressed state has no visible feedback",
      { materialHover, materialPressed },
    );
    assert(isIdentityTransform(materialPressed.transform), "Material pressed state must not move the quick button", materialPressed);
    assert(materialFocus.focused, "keyboard focus did not reach the Material quick button", materialFocus);
    assert(materialFocus.outlineStyle !== "none" && Number.parseFloat(materialFocus.outlineWidth) >= 2, "Material focus-visible ring is missing", materialFocus);
    assert(sameRect(before.materialButton.rect, materialFocus.rect), "focus-visible changed quick-button geometry", { before: before.materialButton, materialFocus });
    assert(disabledState.disabled, "disabled quick-menu fixture did not expose a disabled action", disabledState);
    assert(disabledState.opacity >= 0.99 && colorAlpha(disabledState.backgroundColor) >= 0.35 && disabledState.cursor === "not-allowed", "disabled quick-menu action must use a muted material without reducing element opacity", { before: before.materialButton, disabledState });
    assert(disabledState.rect.height >= 48 && disabledState.rect.width >= 48, "disabled quick-menu action lost its minimum hit target", disabledState);
    assert(disabledState.ariaLabel && disabledState.title, "disabled quick-menu action lost accessible text", disabledState);
    assert(
      before.auto.actionBackgroundColor === before.expectedAutoBackground
        && colorAlpha(before.auto.backgroundColor) >= 0.35
        && before.auto.backgroundColor !== before.expectedTransparent
        && before.auto.visual.content === "none",
      "per-button skin background did not reach the real button element",
      before.auto,
    );
    assert(before.imageButton.backgroundImage !== "none", "image-owned quick button did not resolve its image", before.imageButton);
    assert(before.imageButton.backgroundColor === before.expectedTransparent, "image-owned quick button kept its original background", before.imageButton);
    assert(before.imageButton.borderWidth === "0px", "image-owned quick button kept its original border", before.imageButton);
    assert(before.imageButton.boxShadow === "none", "image-owned quick button kept its original shadow", before.imageButton);
    assert(sameRect(before.imageButton.rect, afterImageButton.rect), "image-owned quick button geometry changed on hover", { before: before.imageButton, after: afterImageButton });
    assert(afterImageButton.backgroundImage === before.imageButton.backgroundImage, "image-owned quick button lost its image on hover", { before: before.imageButton, after: afterImageButton });
    assert(afterImageButton.backgroundColor === before.expectedTransparent && afterImageButton.borderWidth === "0px" && afterImageButton.boxShadow === "none", "image-owned hover restored the original frame", afterImageButton);
    assert(sameRect(before.toggle.rect, afterToggle.rect), "quick-menu toggle geometry changed on hover", { before: before.toggle, after: afterToggle });
    assert(isIdentityTransform(afterToggle.transform), "quick-menu toggle hover introduced a transform", afterToggle);
    assert(sameRect(choiceBefore.rect, choiceAfter.rect), "choice option geometry changed on hover", { before: choiceBefore, after: choiceAfter });
    assert(choiceAfter.hovered, "choice option hover sample did not reach :hover", choiceAfter);
    assert(Number(choicePanelOpacity) >= 0.99, "choice_list opacity must not fade the Choice container or its buttons", { choicePanelOpacity });
    assert(Number(choiceBefore.opacity) >= 0.99 && colorAlpha(choiceBefore.backgroundColor) >= 0.99, "default choice option must start with an opaque frame", choiceBefore);
    assert(
      Number(customColorChoiceStyle.opacity) >= 0.99 && colorAlpha(customColorChoiceStyle.backgroundColor) >= 0.99,
      "custom-color Choice must stay opaque even when legacy style opacity is low",
      customColorChoiceStyle,
    );
    assert(
      imageOwnedChoiceStyle.frameMode === "image_owned"
        && imageOwnedChoiceStyle.backgroundImage !== "none"
        && colorAlpha(imageOwnedChoiceStyle.backgroundColor) === 0
        && imageOwnedChoiceStyle.borderWidth === "0px"
        && imageOwnedChoiceStyle.boxShadow === "none",
      "image-owned Choice must preserve its image and suppress the default frame",
      imageOwnedChoiceStyle,
    );
    for (const key of ["opacity", "backgroundColor", "backgroundImage", "borderColor", "boxShadow", "filter", "transform", "borderRadius"]) {
      assert(choiceAfter[key] === choiceBefore[key], `choice option hover changed ${key}`, { before: choiceBefore, after: choiceAfter });
    }
    assert(pageErrors.length === 0, "runtime raised page errors", pageErrors);

    const mobileContext = await browser.newContext({
      viewport: { width: 932, height: 430 },
      screen: { width: 932, height: 430 },
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    });
    let mobile;
    try {
      const mobilePage = await mobileContext.newPage();
      const mobileErrors = [];
      mobilePage.on("pageerror", (error) => mobileErrors.push(error.stack || error.message));
      await mobilePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await mobilePage.evaluate((payload) => {
        window.postMessage({
          type: "agentvn.live-preview.init",
          protocolVersion: 2,
          sessionId: "quick-menu-style-mobile-session",
          revision: 1,
          requestId: "quick-menu-style-mobile-init",
          runId: "quick-menu-style-mobile-run",
          manifest: payload.manifest,
          script: payload.script,
          uiSkin: payload.uiSkin,
          assetUrls: {},
          start: {
            requestId: "quick-menu-style-mobile-init",
            target: { sceneId: "scene_main", commandIndex: 0 },
            entryPath: [],
            mode: "stable_frame",
            playbackRate: 1,
            reducedMotion: true,
          },
          screen: "playing",
        }, "*");
      }, fixture());
      const mobileToggle = mobilePage.getByTestId("quick-menu-toggle");
      await mobileToggle.waitFor({ state: "visible", timeout: 20_000 });
      await mobilePage.locator(".choice-panel").waitFor({ state: "visible", timeout: 20_000 });
      const mobileChoice = mobilePage.locator(".choice-panel .choice-option").first();
      const sampleMobileChoice = () => mobileChoice.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          hovered: element.matches(":hover"),
          rect: {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
          },
          opacity: style.opacity,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderColor: style.borderColor,
          boxShadow: style.boxShadow,
          filter: style.filter,
          transform: style.transform,
          borderRadius: style.borderRadius,
        };
      });
      const mobileChoiceBefore = await sampleMobileChoice();
      await mobileChoice.hover();
      await mobilePage.waitForTimeout(650);
      const mobileChoiceAfter = await sampleMobileChoice();
      mobile = await mobilePage.evaluate(() => {
        const rect = (selector) => {
          const bounds = document.querySelector(selector).getBoundingClientRect();
          return {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
            width: bounds.width,
            height: bounds.height,
            centerX: bounds.left + bounds.width / 2,
            centerY: bounds.top + bounds.height / 2,
          };
        };
        const scope = document.querySelector(".ui-skin-scope");
        const toggle = document.querySelector('[data-testid="quick-menu-toggle"]');
        const toggleStyle = getComputedStyle(toggle);
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          frame: rect(".runtime-layout-frame"),
          toggle: rect('[data-testid="quick-menu-toggle"]'),
          choicePanel: rect(".choice-panel"),
          breakpoint: scope?.getAttribute("data-ui-breakpoint"),
          formFactor: scope?.getAttribute("data-ui-form-factor"),
          platform: scope?.getAttribute("data-runtime-platform"),
          layoutSource: document.querySelector(".playback-controls")?.getAttribute("data-ui-layout-source"),
          toggleOpacity: Number(toggleStyle.opacity),
          controlOpacity: Number(getComputedStyle(document.querySelector(".playback-controls")).opacity),
        };
      });
      mobile.errors = mobileErrors;
      const expectedQuickMenuRight = mobile.frame.left + mobile.frame.width * 0.98;
      assert(mobile.breakpoint === "desktop" && mobile.formFactor === "handheld", "mobile acceptance did not keep the PC design breakpoint", mobile);
      assert(Math.abs(mobile.toggle.right - expectedQuickMenuRight) < 1, "mobile top-right quick-menu anchor drifted away from its configured position", mobile);
      assert(Math.abs(mobile.choicePanel.centerX - (mobile.frame.left + mobile.frame.width / 2)) < 1, "mobile centered choice list is horizontally offset", mobile);
      assert(mobile.toggleOpacity >= 0.88 && mobile.toggleOpacity <= 1, "mobile quick-menu dots must use a high-visibility default", mobile);
      assert(mobile.controlOpacity >= 0.88 && mobile.controlOpacity <= 1, "mobile quick-menu dots must remain clearly visible", mobile);
      const shortLandscapeTouchTarget = mobile.viewport.width > mobile.viewport.height && mobile.viewport.height < 520;
      const expectedTouchTarget = shortLandscapeTouchTarget ? 18 : 18;
      assert(mobile.toggle.width >= expectedTouchTarget && mobile.toggle.height >= expectedTouchTarget, "mobile quick-menu toggle disappeared or became unhittable", mobile);
      assert(
        Number(mobileChoiceBefore.opacity) >= 0.99 && colorAlpha(mobileChoiceBefore.backgroundColor) >= 0.99,
        "Android/handheld default Choice must start with an opaque frame",
        mobileChoiceBefore,
      );
      assert(mobileChoiceAfter.hovered, "Android/handheld Choice hover sample did not reach :hover", mobileChoiceAfter);
      assert(sameRect(mobileChoiceBefore.rect, mobileChoiceAfter.rect), "Android/handheld Choice geometry changed on hover", { before: mobileChoiceBefore, after: mobileChoiceAfter });
      for (const key of ["opacity", "backgroundColor", "backgroundImage", "borderColor", "boxShadow", "filter", "transform", "borderRadius"]) {
        assert(mobileChoiceAfter[key] === mobileChoiceBefore[key], `Android/handheld Choice hover changed ${key}`, { before: mobileChoiceBefore, after: mobileChoiceAfter });
      }
      mobile.choiceBefore = mobileChoiceBefore;
      mobile.choiceAfter = mobileChoiceAfter;
      assert(mobile.errors.length === 0, "mobile runtime raised page errors", mobile.errors);
      await mobilePage.screenshot({ path: path.join(outputDir, "quick-menu-style-mobile.png") });
    } finally {
      await mobileContext.close();
    }

    const report = { ok: true, before, afterAuto, materialHover, materialPressed, materialFocus, disabledState, afterImageButton, afterToggle, choiceBefore, choiceAfter, mobile, pageErrors };
    const staleErrorPath = path.join(outputDir, "error.txt");
    if (fs.existsSync(staleErrorPath)) fs.unlinkSync(staleErrorPath);
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    await page.screenshot({ path: path.join(outputDir, "quick-menu-style.png") });
    console.log(`quick-menu-button-style-playwright: PASS (${outputDir})`);
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
