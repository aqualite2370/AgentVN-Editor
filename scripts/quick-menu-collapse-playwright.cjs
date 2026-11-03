#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outputDir = path.join(root, "output", "playwright", "quick-menu-collapse");
const baseUrl = "http://127.0.0.1:6868/?mode=preview";

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

function fixture(anchor = "top_right", direction = "auto") {
  const now = new Date().toISOString();
  const rectByAnchor = {
    top_right: { x: 92, y: 8, width: 40, height: 10, anchor: "top_right" },
    center: { x: 50, y: 50, width: 40, height: 10, anchor: "center" },
    bottom_center: { x: 50, y: 90, width: 40, height: 10, anchor: "bottom_center" },
  };
  const baseQuickMenuRect = rectByAnchor[anchor];
  if (!baseQuickMenuRect) throw new Error(`unsupported quick-menu anchor fixture: ${anchor}`);
  const quickMenuRect = { ...baseQuickMenuRect };
  const quickMenuButtonIds = [
    "quick_rollback_button",
    "quick_auto_button",
    "quick_skip_button",
    "quick_save_load_button",
    "quick_history_button",
    "quick_hide_ui_button",
    "quick_main_menu_button",
  ];
  const defaultActionStyle = {
    backgroundColor: "#74797e",
    color: "#f5f5f5",
    borderColor: "#9aa1a6",
    borderWidth: 1,
    borderRadius: 10,
    opacity: 0.72,
    fontSize: 16,
    fontWeight: 800,
    shadow: "none",
    backdropBlur: 6,
  };
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.6.0",
      game_id: "quick-menu-collapse",
      title: "Quick Menu Collapse",
      author: "AgentVN QA",
      version: "1.0.0",
      description: "Quick menu collapse acceptance",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "scene_main",
      assets: [],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.5.0",
      game_id: "quick-menu-collapse",
      title: "Quick Menu Collapse",
      entry_scene_id: "scene_main",
      characters: [],
      scenes: [{
        scene_id: "scene_main",
        title: "Main",
        chapter: 1,
        tags: [],
        commands: [
          { type: "narration", text: "第一段剧情用于验证快捷菜单收回。" },
          { type: "narration", text: "第二段剧情用于保持播放器仍在运行。" },
        ],
      }],
    },
    uiSkin: {
      ui_layout_version: "1.0.0",
      name: "Quick menu collapse skin",
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
            mobileRect: { ...quickMenuRect, width: 50, height: 10 },
            style: {
              backgroundColor: "#686d72",
              color: "#f5f5f5",
              borderColor: "#92999e",
              borderWidth: 1,
              borderRadius: 16,
              opacity: 0.66,
              padding: 6,
              gap: 6,
              quickMenuDirection: direction,
              quickMenuVariant: "C",
              shadow: "soft",
              backdropBlur: 12,
            },
          },
          ...quickMenuButtonIds.map((component_id) => ({
            component_id,
            component_type: "quick_button",
            required: true,
            style: { ...defaultActionStyle },
          })),
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

async function initialize(page, anchor = "top_right", direction = "auto") {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate((payload) => {
    window.postMessage({
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: "quick-menu-collapse-session",
      revision: 1,
      requestId: "quick-menu-collapse-init",
      runId: "quick-menu-collapse-run",
      manifest: payload.manifest,
      script: payload.script,
      uiSkin: payload.uiSkin,
      assetUrls: {},
      start: {
        requestId: "quick-menu-collapse-start",
        target: { sceneId: "scene_main", commandIndex: 0 },
        entryPath: [],
        mode: "stable_frame",
        playbackRate: 1,
        reducedMotion: false,
      },
      screen: "playing",
    }, "*");
  }, fixture(anchor, direction));
  await page.getByTestId("quick-menu-toggle").waitFor({ state: "visible", timeout: 20_000 });
}

async function sampleMenu(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".playback-controls");
    const toggle = document.querySelector('[data-testid="quick-menu-toggle"]');
    const surface = document.querySelector(".quick-menu-surface");
    const firstButton = document.querySelector(".quick-menu-button");
    if (!root || !toggle || !surface || !firstButton) throw new Error("quick menu DOM is incomplete");
    const rootStyle = getComputedStyle(root);
    const toggleStyle = getComputedStyle(toggle);
    const surfaceStyle = getComputedStyle(surface);
    const surfaceVisualStyle = getComputedStyle(surface, "::before");
    const toggleBeforeStyle = getComputedStyle(toggle, "::before");
    const toggleAfterStyle = getComputedStyle(toggle, "::after");
    const rootRect = root.getBoundingClientRect();
    const toggleRect = toggle.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const frameRect = document.querySelector(".runtime-layout-frame")?.getBoundingClientRect();
    const dialogRect = document.querySelector(".dialog-box")?.getBoundingClientRect();
    const buttonRect = firstButton.getBoundingClientRect();
    const toggleIconRect = toggle.querySelector("svg")?.getBoundingClientRect();
    const buttonIconRect = firstButton.querySelector("svg")?.getBoundingClientRect();
    const compactRect = (rect) => rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    return {
      expanded: toggle.getAttribute("aria-expanded"),
      hidden: surface.getAttribute("aria-hidden"),
      buttonCount: document.querySelectorAll(".quick-menu-button").length,
      rootOpacity: Number(rootStyle.opacity),
      surfaceOpacity: Number(surfaceStyle.opacity),
      surfaceTransform: surfaceStyle.transform,
      surfaceTransitionProperty: surfaceStyle.transitionProperty,
      surfaceTransitionDuration: surfaceStyle.transitionDuration,
      surfaceTransitionTimingFunction: surfaceStyle.transitionTimingFunction,
      surfaceMatchedRules: [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules]
            .filter((rule) => rule.cssText.includes("quick-menu-surface") && rule.cssText.includes("transition"))
            .map((rule) => rule.cssText)
            .slice(-8);
        } catch {
          return [];
        }
      }).slice(-16),
      surfaceClipPath: surfaceStyle.clipPath,
      surfaceVisibility: surfaceStyle.visibility,
      actionLayerPointerEvents: getComputedStyle(surface.querySelector(".quick-menu-action-layer") ?? surface).pointerEvents,
      actionButtonOpacities: [...surface.querySelectorAll(".quick-menu-button")].map((element) => Number.parseFloat(getComputedStyle(element).opacity || "0")),
      visibleLabels: [...surface.querySelectorAll(".quick-menu-button-label")].map((element) => element.textContent?.trim() ?? ""),
      labelStyle: firstButton.querySelector(".quick-menu-button-label")
        ? (() => {
            const label = getComputedStyle(firstButton.querySelector(".quick-menu-button-label"));
            return { fontSize: label.fontSize, fontWeight: label.fontWeight, lineHeight: label.lineHeight };
          })()
        : null,
      actionButtonVisibleCount: [...surface.querySelectorAll(".quick-menu-button")].filter((element) => {
        const style = getComputedStyle(element);
        return style.visibility !== "hidden" && Number.parseFloat(style.opacity) > 0.2;
      }).length,
      toggleExpandOpacity: Number.parseFloat(getComputedStyle(toggle.querySelector(".quick-menu-toggle-icon-expand") ?? toggle).opacity || "0"),
      toggleCloseOpacity: Number.parseFloat(getComputedStyle(toggle.querySelector(".quick-menu-toggle-icon-close") ?? toggle).opacity || "0"),
      previewBadgeCount: document.querySelectorAll(".quick-menu-surface .preview-badge").length,
      toggleIconName: toggle.getAttribute("data-quick-menu-icon") ?? null,
      rootRect: compactRect(rootRect),
      handheld: document.querySelector('.ui-skin-scope')?.getAttribute('data-ui-form-factor') === 'handheld',
      rootStyle: {
        left: rootStyle.left,
        right: rootStyle.right,
        top: rootStyle.top,
        bottom: rootStyle.bottom,
        transform: rootStyle.transform,
        position: rootStyle.position,
       drawerWidth: rootStyle.getPropertyValue("--runtime-quick-menu-drawer-width"),
       drawerHeight: rootStyle.getPropertyValue("--runtime-quick-menu-drawer-height"),
       contentHeight: root.getAttribute("data-quick-menu-content-height"),
       scrollable: root.getAttribute("data-quick-menu-scrollable"),
       skinOpacity: rootStyle.getPropertyValue("--runtime-quick-menu-opacity"),
       materialAlpha: rootStyle.getPropertyValue("--runtime-quick-menu-material-alpha"),
       surfacePadding: rootStyle.getPropertyValue("--runtime-quick-menu-padding"),
       toggleGap: rootStyle.getPropertyValue("--runtime-quick-menu-toggle-gap"),
      matchingRules: [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules]
            .filter((rule) => rule.cssText.includes("quick-menu-surface") && (rule.cssText.includes("drawer-height") || rule.cssText.includes("drawer-width")))
            .map((rule) => rule.cssText);
        } catch {
          return [];
        }
      }),
      },
      toggleRect: compactRect(toggleRect),
      surfaceRect: compactRect(surfaceRect),
      surfaceRight: surfaceStyle.right,
      surfaceStyle: {
        position: surfaceStyle.position,
        left: surfaceStyle.left,
        right: surfaceStyle.right,
        top: surfaceStyle.top,
        bottom: surfaceStyle.bottom,
        transform: surfaceStyle.transform,
        width: surfaceStyle.width,
        height: surfaceStyle.height,
        minWidth: surfaceStyle.minWidth,
        minHeight: surfaceStyle.minHeight,
        maxWidth: surfaceStyle.maxWidth,
        maxHeight: surfaceStyle.maxHeight,
        flexDirection: surfaceStyle.flexDirection,
      },
      innerViewport: { width: window.innerWidth, height: window.innerHeight, media700: matchMedia("(max-width: 700px)").matches },
      prefersReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      runtimePlatform: document.querySelector(".ui-skin-scope")?.getAttribute("data-runtime-platform"),
      frameRect: frameRect ? { left: frameRect.left, top: frameRect.top, width: frameRect.width, height: frameRect.height } : null,
      dialogRect: dialogRect ? compactRect(dialogRect) : null,
      anchor: root.getAttribute("data-quick-menu-anchor"),
      authoredAnchor: root.getAttribute("data-quick-menu-authored-anchor"),
      variant: root.getAttribute("data-quick-menu-variant"),
      fixedGeometry: root.getAttribute("data-quick-menu-fixed") === "true",
      direction: root.getAttribute("data-quick-menu-direction"),
      columns: Number.parseInt(root.getAttribute("data-quick-menu-columns") || "1", 10),
      rows: Number.parseInt(root.getAttribute("data-quick-menu-rows") || "1", 10),
      buttonWidth: buttonRect.width,
      buttonHeight: buttonRect.height,
      toggleRadius: toggleStyle.borderRadius,
      toggleOpacity: Number(toggleStyle.opacity),
      toggleOwnBackground: toggleStyle.backgroundColor,
      toggleOwnBorderColor: toggleStyle.borderColor,
      toggleOwnBackdropFilter: toggleStyle.backdropFilter || toggleStyle.webkitBackdropFilter,
      toggleOwnFilter: toggleStyle.filter,
      surfaceRadius: surfaceStyle.borderRadius,
      toggleBackdropFilter: getComputedStyle(toggle, "::before").backdropFilter || getComputedStyle(toggle, "::before").webkitBackdropFilter,
      surfaceBackdropFilter: surfaceVisualStyle.backdropFilter || surfaceVisualStyle.webkitBackdropFilter,
      toggleShadow: getComputedStyle(toggle, "::before").boxShadow,
      toggleBeforeContent: toggleBeforeStyle.content,
      toggleAfterContent: toggleAfterStyle.content,
      toggleCloseAccentCount: toggle.querySelector(".quick-menu-toggle-icon-close .precision-icon__accent") ? 1 : 0,
      surfaceOwnBackground: surfaceStyle.backgroundColor,
      surfaceOwnBorderWidth: surfaceStyle.borderWidth,
      surfaceOwnShadow: surfaceStyle.boxShadow,
      surfaceOwnBackdropFilter: surfaceStyle.backdropFilter || surfaceStyle.webkitBackdropFilter,
      surfaceVisualOpacity: Number(surfaceVisualStyle.opacity || 1),
      surfaceShadow: surfaceVisualStyle.boxShadow,
      surfaceBackground: surfaceVisualStyle.backgroundColor,
      surfacePseudoDisplay: surfaceVisualStyle.display,
      surfacePseudoFilter: surfaceVisualStyle.filter,
      rootBackground: rootStyle.backgroundColor,
      rootBackdropFilter: rootStyle.backdropFilter || rootStyle.webkitBackdropFilter,
      rootPointerEvents: rootStyle.pointerEvents,
      actionFilters: [...surface.querySelectorAll(".quick-menu-button")].map((element) => {
        const style = getComputedStyle(element);
        return {
          opacity: Number(style.opacity),
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          filter: style.filter,
          backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
          pointerEvents: style.pointerEvents,
        };
      }),
      layerCounts: {
        surface: root.querySelectorAll(":scope > .quick-menu-surface").length,
        action: root.querySelectorAll(":scope > .quick-menu-surface > .quick-menu-action-layer").length,
        toggle: root.querySelectorAll(":scope > .quick-menu-toggle-layer").length,
      },
      toggleIconWidth: toggleIconRect?.width ?? 0,
      toggleIconHeight: toggleIconRect?.height ?? 0,
      toggleVisualWidth: Number.parseFloat(getComputedStyle(toggle).getPropertyValue("--runtime-quick-menu-toggle-visual-width")) || 0,
      toggleVisualHeight: Number.parseFloat(getComputedStyle(toggle).getPropertyValue("--runtime-quick-menu-toggle-visual-height")) || 0,
      buttonIconWidth: buttonIconRect?.width ?? 0,
      buttonIconHeight: buttonIconRect?.height ?? 0,
    };
  });
}

async function captureToggleTimeline(page, toggle) {
  await page.evaluate(() => {
    const history = [];
    let running = true;
    const sample = () => {
      const surface = document.querySelector(".quick-menu-surface");
      const action = document.querySelector(".quick-menu-action-layer");
      const button = document.querySelector(".quick-menu-button");
      const expand = document.querySelector(".quick-menu-toggle-icon-expand");
      const close = document.querySelector(".quick-menu-toggle-icon-close");
      const style = (node) => node ? getComputedStyle(node) : null;
      history.push({
        at: performance.now(),
        surfaceOpacity: Number(style(surface)?.opacity ?? 0),
        surfaceClipPath: style(surface)?.clipPath ?? "",
        actionOpacity: Number(style(action)?.opacity ?? 0),
        buttonOpacity: Number(style(button)?.opacity ?? 0),
        expandOpacity: Number(style(expand)?.opacity ?? 0),
        closeOpacity: Number(style(close)?.opacity ?? 0),
      });
      if (running && history.length < 120) requestAnimationFrame(sample);
    };
    window.__quickMenuToggleTimeline = {
      history,
      stop: () => { running = false; },
    };
    requestAnimationFrame(sample);
  });
  await toggle.click();
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    window.__quickMenuToggleTimeline?.stop();
    return window.__quickMenuToggleTimeline?.history ?? [];
  });
}

function isTransparentColor(value) {
  return value === "transparent" || value === "rgba(0, 0, 0, 0)" || /\/\s*0(?:\.0+)?\)?$/.test(value);
}

function parseCssColor(value) {
  const srgb = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/i);
  if (srgb) {
    return {
      r: Number(srgb[1]),
      g: Number(srgb[2]),
      b: Number(srgb[3]),
      a: srgb[4] === undefined ? 1 : Number(srgb[4]),
    };
  }
  const oklab = value.match(/^oklab\(\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i);
  if (oklab) {
    const L = Number(oklab[1]), a = Number(oklab[2]), b = Number(oklab[3]);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const linear = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    const gamma = channel => channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
    return { r: gamma(linear[0]), g: gamma(linear[1]), b: gamma(linear[2]), a: oklab[4] === undefined ? 1 : Number(oklab[4]) };
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)(?:\s+|,\s*)([\d.]+)(?:\s+|,\s*)([\d.]+)(?:\s*\/\s*|,\s*)?([\d.]+)?\s*\)$/i);
  if (!rgb) return null;
  return {
    r: Number(rgb[1]) / 255,
    g: Number(rgb[2]) / 255,
    b: Number(rgb[3]) / 255,
    a: rgb[4] === undefined ? 1 : Number(rgb[4]),
  };
}

function colorSaturation(color) {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const delta = max - min;
  if (delta === 0) return 0;
  const lightness = (max + min) / 2;
  return delta / (1 - Math.abs(2 * lightness - 1));
}

function assertGrayGlassMaterial(value, alphaRange, label, sample) {
  const color = parseCssColor(value);
  assert(color, `${label} did not resolve to a measurable color`, { value, sample });
  assert(colorSaturation(color) <= 0.08, `${label} retained a saturated theme color`, { value, color, saturation: colorSaturation(color), sample });
  assert(color.a >= alphaRange[0] && color.a <= alphaRange[1], `${label} alpha is outside the authored glass range`, { value, color, alphaRange, sample });
}

function assertCollapsedSurfaceClean(sample, label) {
  assert(
    isTransparentColor(sample.surfaceOwnBackground)
      && sample.surfaceOwnBorderWidth === "0px"
      && sample.surfaceOwnShadow === "none"
      && (sample.surfaceOwnBackdropFilter === "none" || sample.surfaceOwnBackdropFilter === ""),
    `${label} left a visible quick-menu surface after collapse`,
    sample,
  );
  assert(sample.surfacePseudoDisplay === "none", `${label} left a pseudo-element glass layer`, sample);
  assert(sample.rootBackdropFilter === "none" || sample.rootBackdropFilter === "", `${label} root retained a blur layer`, sample);
  assert(sample.rootPointerEvents === "none", `${label} root remained a transparent click shield`, sample);
}

function numericRadius(value) {
  return Number.parseFloat(value);
}

function isIdentityTransform(value) {
  return value === "none" || value === "matrix(1, 0, 0, 1, 0, 0)";
}

function assertSharedGlassGeometry(sample, viewport, label) {
  // Handheld playback uses the same PC-authored quick-menu metrics. The
  // physical viewport may be narrow, but the surface is uniformly scaled
  // rather than switching to a separate mobile drawer design.
  const mobile = Boolean(sample.handheld);
  const baseToggleSize = mobile ? 56 : 56;
  const baseSurfaceWidth = mobile ? 420 : 320;
  const baseSurfaceHeight = 7 * 56 + baseToggleSize + 7 * 8 + 2 * 8;
  const expectedIconMin = viewport.height < 420 ? 10 : (viewport.width < 900 ? 20 : 22);
  const expectedIconMax = 28;
  if (sample.variant === "C") {
    assert(sample.columns === 1, `${label} C drawer must use one column`, sample);
    assert(sample.rows === 8, `${label} C drawer must use eight rows`, sample);
    const logicalSurfaceWidth = Number.parseFloat(sample.rootStyle.drawerWidth);
    const logicalSurfaceHeight = Number.parseFloat(sample.rootStyle.drawerHeight);
    const logicalContentHeight = Number.parseFloat(sample.rootStyle.contentHeight);
    const scale = logicalSurfaceWidth / baseSurfaceWidth;
    assert(scale > 0 && scale <= 1.001, `${label} C drawer scale is invalid`, { scale, sample });
    assert(Math.abs(logicalContentHeight / baseSurfaceHeight - scale) <= 0.002, `${label} C drawer content did not scale uniformly`, { scale, sample });
    assert(logicalSurfaceHeight <= logicalContentHeight + 0.6, `${label} C visible surface exceeds its scroll content`, { scale, sample });
    assert(
      sample.rootStyle.scrollable === "false" && Math.abs(logicalSurfaceHeight - logicalContentHeight) <= 0.6,
      `${label} C drawer must fit every row without scrolling`,
      { scale, sample },
    );
    const expectedToggleRow = baseToggleSize * scale;
    const observedToggleTrack = sample.toggleRect.width;
    const observedToggleRow = sample.toggleRect.height;
    if (sample.fixedGeometry) {
      assert(Math.abs(observedToggleTrack - expectedToggleRow) <= 0.6, `${label} fixed C toggle must remain circular`, sample);
      assert(Math.abs(observedToggleRow - expectedToggleRow) <= 0.6, `${label} fixed C toggle height is incorrect`, sample);
      assert(sample.toggleRadius === "50%", `${label} fixed C toggle is not circular`, sample);
    } else {
      const expectedTrack = (baseSurfaceWidth - 16) * scale;
      assert(Math.abs(observedToggleTrack - expectedTrack) <= 0.6, `${label} integrated X width does not fill the single grid track`, sample);
      assert(Math.abs(observedToggleRow - expectedToggleRow) <= 0.6, `${label} integrated X height does not fill the eighth row`, sample);
      assert(sample.toggleRadius !== "50%", `${label} integrated X is still a detached circle`, sample);
    }
    if (!sample.fixedGeometry) {
      assert(sample.toggleBeforeContent === "none" && sample.toggleAfterContent === "none", `${label} integrated X retained a pseudo background or decorative arc`, sample);
    }
  } else {
    const expectedToggleSize = baseToggleSize;
    assert(Math.abs(sample.toggleRect.height - expectedToggleSize) <= 0.2, `${label} toggle height is incorrect`, sample);
    assert(Math.abs(sample.toggleRect.width - expectedToggleSize) <= 0.2, `${label} toggle width is incorrect`, sample);
    assert(sample.surfaceRect.width >= (mobile ? 168 : 196), `${label} A surface width is below the responsive minimum`, sample);
    assert(sample.surfaceRect.height >= (mobile ? 64 : 72), `${label} A surface height is below the responsive minimum`, sample);
    assert(sample.toggleRadius === "50%", `${label} A toggle must remain circular`, sample);
  }
  const expectedSurfaceRadius = sample.variant === "C"
    ? 16 * (Number.parseFloat(sample.rootStyle.drawerWidth) / baseSurfaceWidth)
    : 16;
  assert(
    Math.abs(numericRadius(sample.surfaceRadius) - expectedSurfaceRadius) <= 0.6
      && numericRadius(sample.surfaceRadius) < sample.surfaceRect.height / 2,
    `${label} surface radius did not follow the uniform drawer scale`,
    { expectedSurfaceRadius, sample },
  );
  assert(sample.surfaceOwnBackdropFilter.includes("blur("), `${label} expanded surface blur contract is missing`, sample);
  assertGrayGlassMaterial(sample.surfaceOwnBackground, [0.55, 0.8], `${label} surface`, sample);
  assert(Math.abs(sample.surfaceOpacity - 1) <= 0.01, `${label} surface used element opacity instead of material alpha`, sample);
  assert(sample.surfaceOwnShadow !== "none", `${label} surface static glass glow is missing`, sample);
  if (sample.variant === "C") {
    if (sample.fixedGeometry) {
      assert(sample.toggleShadow !== "none", `${label} fixed C toggle lost its visual elevation`, sample);
      assert(sample.toggleBeforeContent !== "none", `${label} fixed C toggle lost its visual surface`, sample);
    } else {
      assert(sample.toggleShadow === "none", `${label} integrated X retained a detached shadow`, sample);
      assertGrayGlassMaterial(sample.toggleOwnBackground, [0.6, 0.85], `${label} integrated X`, sample);
      assert(Math.abs(sample.toggleOpacity - 1) <= 0.01, `${label} integrated X used element opacity`, sample);
      assert(sample.toggleOwnFilter === "none" && sample.toggleOwnBackdropFilter.includes("blur("), `${label} integrated X must use backdrop blur without blurring its icon`, sample);
    }
  }
  assert(sample.surfacePseudoDisplay === "none", `${label} retained a duplicate pseudo-element glass layer`, sample);
  assert(sample.rootBackdropFilter === "none" || sample.rootBackdropFilter === "", `${label} root retained a duplicate blur layer`, sample);
  assert(sample.actionFilters.every((item) => item.filter === "none" && item.backdropFilter.includes("blur(")), `${label} action buttons must use backdrop blur without filter blur`, sample);
  for (const [index, item] of sample.actionFilters.entries()) {
    assert(Math.abs(item.opacity - 1) <= 0.01, `${label} action ${index + 1} used element opacity`, sample);
    assertGrayGlassMaterial(item.backgroundColor, [0.6, 0.85], `${label} action ${index + 1}`, sample);
  }
  const expectedToggleIconSize = sample.variant === "C"
    ? 33 * (Number.parseFloat(sample.rootStyle.drawerWidth) / baseSurfaceWidth)
    : 33;
  assert(Math.abs(sample.toggleIconWidth - expectedToggleIconSize) <= 0.2 && Math.abs(sample.toggleIconHeight - expectedToggleIconSize) <= 0.2, `${label} ellipsis glyph size is incorrect`, sample);
  const actionDimension = sample.buttonHeight;
  const ratio = sample.toggleVisualHeight / actionDimension;
  assert(ratio > 0.72 && ratio < 0.88, `${label} enlarged toggle/action ratio is outside the 1.5x visual scale`, { ratio, sample });
  assert(sample.buttonWidth <= sample.surfaceRect.width + 1 && sample.buttonHeight <= sample.surfaceRect.height + 1, `${label} action button escaped the responsive surface`, sample);
  const expectedButtonIconSize = sample.variant === "C"
    ? 27 * (Number.parseFloat(sample.rootStyle.drawerWidth) / baseSurfaceWidth)
    : 22;
  assert(
      Math.abs(sample.buttonIconWidth - expectedButtonIconSize) <= 0.6
        && Math.abs(sample.buttonIconHeight - expectedButtonIconSize) <= 0.6
       && sample.buttonIconWidth >= Math.min(expectedIconMin, expectedButtonIconSize) - 0.6
      && sample.buttonIconWidth <= expectedIconMax,
    `${label} action glyph size is incorrect`,
    { expectedButtonIconSize, sample },
  );
}

function assertSurfaceAligned(sample, label) {
  const { anchor, toggleRect, surfaceRect } = sample;
  if (sample.variant === "C") {
    const horizontalDelta = Math.abs(toggleRect.right - surfaceRect.right);
    assert(horizontalDelta <= 8, `${label} C close control is detached from the rail edge`, sample);
    const edgeDelta = sample.direction === "down" ? Math.abs(toggleRect.top - surfaceRect.top) : Math.abs(toggleRect.bottom - surfaceRect.bottom);
    assert(edgeDelta <= 8, `${label} C close control is detached from its expansion edge`, sample);
    return;
  }
  if (anchor === "top_left" || anchor === "top_right") {
    assert(Math.abs(toggleRect.top - surfaceRect.top) <= 1, `${label} top edges are not aligned`, sample);
    return;
  }
  if (anchor === "bottom_left" || anchor === "bottom_right") {
    assert(Math.abs(toggleRect.bottom - surfaceRect.bottom) <= 1, `${label} bottom edges are not aligned`, sample);
    return;
  }
  const toggleCenter = toggleRect.left + toggleRect.width / 2;
  const surfaceCenter = surfaceRect.left + surfaceRect.width / 2;
  assert(Math.abs(toggleCenter - surfaceCenter) <= 1, `${label} horizontal centers are not aligned`, sample);
}

function anchorFactor(anchor) {
  return {
    x: anchor === "top_right" ? 1 : 0.5,
    y: anchor === "center" ? 0.5 : anchor === "bottom_center" ? 1 : 0,
  };
}

function assertRootAnchor(sample, expectedAnchor, expectedRect, label) {
  assert(sample.frameRect, `${label} is missing the runtime frame`, sample);
  if (sample.innerViewport.width >= sample.innerViewport.height) {
    assert(sample.dialogRect, `${label} is missing the dialog`, sample);
    assert(Math.abs(sample.toggleRect.right - sample.dialogRect.right) <= 1.5,
      `${label} toggle must align to dialog right edge`, sample);
    assert(Math.abs(sample.dialogRect.top - sample.toggleRect.bottom - 8) <= 1.5,
      `${label} toggle must be outside-above dialog, not inside it`, sample);
  }
  assert(sample.anchor === expectedAnchor, `${label} exposed the wrong anchor`, sample);
  const factor = anchorFactor(expectedAnchor);
  // C is one fixed 1 × 8 authored surface. The collapsed hit target and the
  // expanded X use different visual cell widths, so the stable authored
  // anchor is the surface edge/center rather than the toggle's changing
  // bounding box.
  const anchorRect = sample.rootRect;
  const actualX = factor.x === 1
    ? anchorRect.right
    : factor.x === 0.5
      ? anchorRect.left + anchorRect.width / 2
      : anchorRect.left;
  const actualY = anchorRect.top + anchorRect.height * factor.y;
  const expectedX = sample.frameRect.left + sample.frameRect.width * expectedRect.x / 100;
  const expectedY = sample.frameRect.top + sample.frameRect.height * expectedRect.y / 100;
  assert(Math.abs(actualX - expectedX) <= 1.5 && Math.abs(actualY - expectedY) <= 1.5, `${label} did not align its real anchor to configured x/y`, { sample, actualX, actualY, expectedX, expectedY });
}

function assertFixedRootGeometry(sample, label) {
  assert(sample.fixedGeometry === true, `${label} must use runtime-fixed quick-menu geometry`, sample);
  assert(sample.anchor === "dialog-top-right", `${label} must use the dialog top-right anchor`, sample);
  assert(sample.variant === "C", `${label} must use the fixed C drawer`, sample);
  assert(["up", "down"].includes(sample.direction), `${label} must expand vertically`, sample);
  assert(sample.frameRect, `${label} is missing the runtime frame`, sample);
  const frame = {
    left: sample.frameRect.left,
    top: sample.frameRect.top,
    right: sample.frameRect.left + sample.frameRect.width,
    bottom: sample.frameRect.top + sample.frameRect.height,
  };
  const root = sample.rootRect;
  assert(
    root.left >= frame.left - 1
      && root.right <= frame.right + 1
      && root.top >= frame.top - 1
      && root.bottom <= frame.bottom + 1,
    `${label} escaped the authored frame`,
    { sample, frame },
  );
}

function assertSurfaceAnchorStable(before, after, label) {
  if (after.expanded === "false") {
    const collapsedDelta = Math.max(
      Math.abs(before.rootRect.left - after.rootRect.left),
      Math.abs(before.rootRect.top - after.rootRect.top),
      Math.abs(before.rootRect.width - after.rootRect.width),
      Math.abs(before.rootRect.height - after.rootRect.height),
    );
    assert(collapsedDelta <= 0.5, `${label} collapsed entry drifted`, {
      before: before.rootRect,
      after: after.rootRect,
      delta: collapsedDelta,
    });
    return collapsedDelta;
  }
  const delta = Math.max(...["left", "top", "width", "height"].map(key => Math.abs(before.toggleRect[key] - after.toggleRect[key])));
  assert(delta <= 1, `${label} toggle moved while expanding`, { before, after, delta });
  return delta;
}

function assertDialogStable(before, after, label) {
  assert(before.dialogRect && after.dialogRect, `${label} is missing the authored dialog panel`, { before, after });
  const delta = Math.max(
    Math.abs(before.dialogRect.left - after.dialogRect.left),
    Math.abs(before.dialogRect.top - after.dialogRect.top),
    Math.abs(before.dialogRect.width - after.dialogRect.width),
    Math.abs(before.dialogRect.height - after.dialogRect.height),
  );
  assert(delta <= 0.5, `${label} changed the authored dialog geometry while opening the overlay menu`, {
    before: before.dialogRect,
    after: after.dialogRect,
    delta,
  });
}

function assertActionGeometry(page, viewport, label) {
  return page.evaluate(({ viewport, label }) => {
    const surface = document.querySelector(".quick-menu-surface")?.getBoundingClientRect();
    const actionLayerElement = document.querySelector(".quick-menu-action-layer");
    const actionLayer = actionLayerElement?.getBoundingClientRect();
    const controls = [...document.querySelectorAll(".quick-menu-surface .quick-menu-button")];
    const viewportRect = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const rects = controls.map(rectOf);
    const intersects = (left, right) => !(left.right <= right.left || left.left >= right.right || left.bottom <= right.top || left.top >= right.bottom);
    const scrollable = actionLayerElement ? getComputedStyle(actionLayerElement).overflowY === "auto" || getComputedStyle(actionLayerElement).overflowY === "scroll" : false;
    const outsideSurface = surface
      ? rects.filter((rect) => rect.left < surface.left - 1 || rect.right > surface.right + 1 || (!scrollable && (rect.top < surface.top - 1 || rect.bottom > surface.bottom + 1)))
      : rects;
    const horizontalEscapes = surface
      ? rects.filter((rect) => rect.left < surface.left - 1 || rect.right > surface.right + 1)
      : rects;
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < rects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rects.length; rightIndex += 1) {
        if (intersects(rects[leftIndex], rects[rightIndex])) overlaps.push([leftIndex, rightIndex]);
      }
    }
    const outsideViewport = surface && (
      surface.left < viewportRect.left - 1 ||
      surface.right > viewportRect.right + 1 ||
      surface.top < viewportRect.top - 1 ||
      surface.bottom > viewportRect.bottom + 1
    );
    return {
      viewport,
      label,
      innerViewport: { width: window.innerWidth, height: window.innerHeight, media700: matchMedia("(max-width: 700px)").matches },
      buttonCount: controls.length,
      surface: surface ? rectOf({ getBoundingClientRect: () => surface }) : null,
      actionLayer: actionLayer ? rectOf({ getBoundingClientRect: () => actionLayer }) : null,
      actionLayerScrollHeight: actionLayerElement?.scrollHeight ?? null,
      actionLayerClientHeight: actionLayerElement?.clientHeight ?? null,
      actionLayerOverflowY: actionLayerElement ? getComputedStyle(actionLayerElement).overflowY : null,
      rects,
      outsideSurface,
      horizontalEscapes,
      overlaps,
      outsideViewport,
      hiddenButtons: controls.filter((element) => getComputedStyle(element).visibility === "hidden" || Number.parseFloat(getComputedStyle(element).opacity) < 0.98).length,
      previewBadges: document.querySelectorAll(".preview-badge").length,
      scrollWidth: document.documentElement.scrollWidth,
    };
  }, { viewport, label });
}

async function verifyAnchorScenario(browser, viewport, anchor, pageErrors) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  await initialize(page, anchor);
  const collapsed = await sampleMenu(page);
  assertFixedRootGeometry(collapsed, `${viewport.width}x${viewport.height} ${anchor} collapsed`);
  await page.getByTestId("quick-menu-toggle").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
  await page.waitForFunction(() => document.querySelector('.playback-controls')?.getAnimations({ subtree: true }).every(animation => animation.playState === 'finished'));
  const expanded = await sampleMenu(page);
  assertSharedGlassGeometry(expanded, viewport, `${viewport.width}x${viewport.height} ${anchor}`);
  assertSurfaceAligned(expanded, `${viewport.width}x${viewport.height} ${anchor}`);
  assertFixedRootGeometry(expanded, `${viewport.width}x${viewport.height} ${anchor} expanded`);
  assertSurfaceAnchorStable(collapsed, expanded, `${viewport.width}x${viewport.height} ${anchor}`);
  assertDialogStable(collapsed, expanded, `${viewport.width}x${viewport.height} ${anchor}`);
  await page.getByTestId("quick-menu-toggle").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "false");
  await page.waitForFunction(() => document.querySelector('.playback-controls')?.getAnimations({ subtree: true }).every(animation => animation.playState === 'finished'));
  const recollapsed = await sampleMenu(page);
  assertFixedRootGeometry(recollapsed, `${viewport.width}x${viewport.height} ${anchor} recollapsed`);
  assertSurfaceAnchorStable(collapsed, recollapsed, `${viewport.width}x${viewport.height} ${anchor} after collapse`);
  assertDialogStable(collapsed, recollapsed, `${viewport.width}x${viewport.height} ${anchor} after collapse`);
  await page.close();
  return { collapsed, expanded, recollapsed };
}

async function verifyDirectionScenario(browser, direction, pageErrors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  try {
    await initialize(page, "top_right", direction);
    const collapsed = await sampleMenu(page);
    await page.getByTestId("quick-menu-toggle").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    await page.waitForTimeout(260);
    const expanded = await sampleMenu(page);
    const delta = assertSurfaceAnchorStable(collapsed, expanded, `${direction} direction`);
    assert(
      Math.abs(collapsed.toggleRect.right - expanded.surfaceRect.right) <= 8,
      `${direction} direction detached the collapsed entry from the drawer right edge`,
      { collapsed, expanded },
    );
    assert(expanded.variant === "C", `${direction} direction must keep the C client style`, expanded);
    assert(expanded.direction === "up", `${direction}: dialog-anchored menu must expand above the dialog`, expanded);
    return { collapsed, expanded, delta };
  } finally {
    await page.close();
  }
}

async function verifyViewportMatrix(browser, viewports, pageErrors) {
  const matrix = {};
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    try {
      await initialize(page, "top_right", "auto");
      const collapsed = await sampleMenu(page);
      if (viewport.height <= viewport.width) {
        assertFixedRootGeometry(collapsed, `${viewport.width}x${viewport.height} matrix collapsed`);
      } else {
        assert(
          collapsed.toggleRect.left >= -1 &&
          collapsed.toggleRect.right <= viewport.width + 1 &&
          collapsed.toggleRect.top >= -1 &&
          collapsed.toggleRect.bottom <= viewport.height + 1,
          "portrait matrix collapsed quick-menu toggle escaped the viewport",
          { viewport, collapsed },
        );
      }
      const logicalDrawerWidth = Number.parseFloat(collapsed.rootStyle.drawerWidth);
      const baseDrawerWidth = 320;
      const expectedLogicalToggle = 56 * logicalDrawerWidth / baseDrawerWidth;
      const observedCollapsedToggle = collapsed.toggleRect.width;
      assert(Math.abs(observedCollapsedToggle - expectedLogicalToggle) <= 0.6, "matrix collapsed toggle size is not uniformly scaled", { viewport, collapsed });
      await page.getByTestId("quick-menu-toggle").click();
      await page.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
      await page.waitForTimeout(260);
      await page.waitForFunction(() => {
        const root = document.querySelector('.playback-controls');
        return root && root.getAnimations({ subtree: true }).every(animation => animation.playState === 'finished');
      });
      const expanded = await sampleMenu(page);
      assertFixedRootGeometry(collapsed, `${viewport.width}x${viewport.height} matrix collapsed`);
      assertFixedRootGeometry(expanded, `${viewport.width}x${viewport.height} matrix expanded`);
      assertSurfaceAnchorStable(collapsed, expanded, `${viewport.width}x${viewport.height} matrix`);
      assertDialogStable(collapsed, expanded, `${viewport.width}x${viewport.height} matrix`);
      assertSharedGlassGeometry(expanded, viewport, `${viewport.width}x${viewport.height} matrix`);
      assertSurfaceAligned(expanded, `${viewport.width}x${viewport.height} matrix`);
      const geometry = await assertActionGeometry(page, viewport, `${viewport.width}x${viewport.height} matrix`);
      assert(geometry.buttonCount === 7, "matrix must expose exactly seven real quick-menu actions", geometry);
      assert(geometry.horizontalEscapes.length === 0, "matrix quick-menu actions escaped their surface horizontally", geometry);
      assert(expanded.rootStyle.scrollable !== "true", "matrix quick menu must never fall back to scrolling", expanded);
      assert(geometry.actionLayerScrollHeight <= geometry.actionLayerClientHeight + 1,
        "matrix quick menu must fit all seven operations without scrolling", geometry);
      assert(geometry.outsideSurface.length === 0, "matrix quick-menu actions escaped their surface", geometry);
      assert(geometry.overlaps.length === 0, "matrix quick-menu actions overlap", geometry);
      assert(!geometry.outsideViewport, "matrix quick-menu surface escaped the viewport", { geometry, expanded });
      assert(geometry.scrollWidth <= viewport.width + 1, "matrix quick-menu caused horizontal overflow", geometry);
      assert(geometry.previewBadges === 0, "matrix preview mode injected a synthetic quick-menu button", geometry);
      matrix[`${viewport.width}x${viewport.height}`] = { collapsed, expanded, geometry };
    } finally {
      await page.close();
    }
  }
  return matrix;
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
  const pageErrors = [];
  try {
    await waitForServer();
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    desktop.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    await initialize(desktop);
    const collapsed = await sampleMenu(desktop);
    assert(collapsed.expanded === "false" && collapsed.hidden === "true", "desktop quick menu must start collapsed", collapsed);
    assert(collapsed.buttonCount === 7, "desktop quick menu must expose seven actions", collapsed);
    assert(collapsed.previewBadgeCount === 0, "preview mode must not inject an extra quick-menu button", collapsed);
    assert(collapsed.toggleIconName === "expand", "collapsed quick-menu toggle must use the three-dot icon", collapsed);

    const toggle = desktop.getByTestId("quick-menu-toggle");
    await toggle.click();
    await desktop.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    await desktop.waitForTimeout(80);
    const expanding = await sampleMenu(desktop);
    assert(
      expanding.surfaceTransitionProperty.split(",").map((value) => value.trim()).some((value) => value === "clip-path"),
      "desktop quick-menu expansion has no observable surface reveal transition",
      expanding,
    );
    assert(expanding.actionButtonOpacities.some((value) => value > 0.05 && value < 0.98), "desktop quick-menu actions appeared instantaneously", expanding);
    assert(expanding.toggleCloseOpacity > 0 && expanding.toggleExpandOpacity > 0, "desktop quick-menu toggle icons did not crossfade", expanding);
    await desktop.waitForTimeout(220);
    const expanded = await sampleMenu(desktop);
    assert(expanded.hidden === "false" && expanded.surfaceOpacity > 0.9, "desktop quick menu did not expand", expanded);
    assert(expanded.buttonCount === 7 && expanded.previewBadgeCount === 0, "expanded preview quick menu must keep only the seven real actions", expanded);
    assert(expanded.surfaceTransitionProperty.split(",").map((value) => value.trim()).includes("clip-path"), "expanded quick menu lost clip-path transition", expanded);
    assert(expanded.actionButtonVisibleCount === 7, "expanded quick menu did not reveal all actions", expanded);
    assert(
      JSON.stringify(expanded.visibleLabels) === JSON.stringify(["回退", "自动", "快进", "存档", "历史", "隐藏", "菜单"]),
      "expanded quick menu labels must use the selected two-character copy",
      expanded,
    );
    assert(
      expanded.labelStyle && Number.parseFloat(expanded.labelStyle.fontSize) >= 15 && Number.parseFloat(expanded.labelStyle.fontWeight) >= 700,
      "expanded quick menu labels must be large and bold",
      expanded,
    );
    assert(
      expanded.layerCounts.surface === 1 && expanded.layerCounts.action === 1 && expanded.layerCounts.toggle === 1,
      "expanded quick menu must expose exactly one surface, action layer and toggle layer",
      expanded,
    );
    assert(expanded.toggleCloseAccentCount === 0, "expanded close icon retained the decorative arc accent", expanded);
    assert(expanded.toggleAfterContent === "none", "expanded toggle retained an after pseudo-element arc", expanded);
    assertSharedGlassGeometry(expanded, { width: 1280, height: 720 }, "desktop expanded");
    assertSurfaceAligned(expanded, "desktop expanded");
    const beforeHover = await desktop.locator(".quick-menu-button").first().evaluate((node) => {
      const style = getComputedStyle(node);
      const pseudo = getComputedStyle(node, "::before");
      const rect = node.getBoundingClientRect();
      return {
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        opacity: style.opacity,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        color: style.color,
        border: style.border,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        filter: style.filter,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
        transform: style.transform,
        pseudoBackground: pseudo.backgroundColor,
        pseudoBorder: pseudo.border,
        pseudoShadow: pseudo.boxShadow,
      };
    });
    const hoverCenter = await desktop.locator(".quick-menu-button").first().evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await desktop.mouse.move(hoverCenter.x, hoverCenter.y);
    const afterHover = await desktop.locator(".quick-menu-button").first().evaluate((node) => {
      const style = getComputedStyle(node);
      const pseudo = getComputedStyle(node, "::before");
      const rect = node.getBoundingClientRect();
      return {
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        opacity: style.opacity,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        color: style.color,
        border: style.border,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        filter: style.filter,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
        transform: style.transform,
        pseudoBackground: pseudo.backgroundColor,
        pseudoBorder: pseudo.border,
        pseudoShadow: pseudo.boxShadow,
      };
    });
    assert(JSON.stringify(beforeHover) === JSON.stringify(afterHover), "quick-menu action hover changed the visual frame", { beforeHover, afterHover });

    const collapseTimeline = await captureToggleTimeline(desktop, toggle);
    const timelineDuration = collapseTimeline.length > 1
      ? collapseTimeline[collapseTimeline.length - 1].at - collapseTimeline[0].at
      : 0;
    assert(collapseTimeline.length >= 4 && timelineDuration >= 64, "quick-menu collapse did not expose four real RAF frames / 64ms", { collapseTimeline, timelineDuration });
    assert(
      collapseTimeline.some((frame) => frame.buttonOpacity > 0.05 && frame.buttonOpacity < 0.98)
        && collapseTimeline.some((frame) => frame.expandOpacity > 0.05 && frame.expandOpacity < 0.98)
        && collapseTimeline.some((frame) => frame.closeOpacity > 0.05 && frame.closeOpacity < 0.98),
      "quick-menu collapse did not continuously fade actions and toggle icons",
      collapseTimeline,
    );
    await desktop.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "false");
    await desktop.waitForTimeout(20);
    const collapsing = await sampleMenu(desktop);
    assert(
      collapsing.surfaceTransitionProperty.split(",").map((value) => value.trim()).some((value) => value === "clip-path"),
      "desktop quick-menu collapse has no observable surface withdrawal transition",
      collapsing,
    );
    assert(
      collapsing.actionButtonOpacities.every((value) => value < 0.1),
      "desktop quick-menu actions did not complete their observed fade before the surface closed",
      { collapseTimeline, collapsing },
    );
    await desktop.waitForTimeout(24);
    await toggle.click();
    await desktop.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    assert((await sampleMenu(desktop)).expanded === "true", "quick menu transition was not interruptible");

    await desktop.locator(".dialog-box").click({ position: { x: 80, y: 40 } });
    await desktop.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "false");
    const afterStory = await sampleMenu(desktop);
    assert(afterStory.hidden === "true", "story interaction did not collapse the quick menu", afterStory);
    await desktop.waitForTimeout(260);
    const afterStorySettled = await sampleMenu(desktop);
    assertCollapsedSurfaceClean(afterStorySettled, "desktop story collapse");

    await desktop.emulateMedia({ reducedMotion: "reduce" });
    const reducedCollapsed = await sampleMenu(desktop);
    await toggle.click();
    await desktop.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    const reducedExpanded = await sampleMenu(desktop);
    assert(reducedExpanded.surfaceTransitionProperty === "opacity", "reduced-motion quick menu must only transition opacity", reducedExpanded);
    assert(isIdentityTransform(reducedExpanded.surfaceTransform), "reduced-motion quick menu must remove transform motion", reducedExpanded);
    assertSurfaceAnchorStable(reducedCollapsed, reducedExpanded, "desktop reduced-motion quick menu");
    await toggle.click();
    await desktop.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "false");
    const reducedRecollapsed = await sampleMenu(desktop);
    assert(reducedRecollapsed.surfaceTransitionProperty === "opacity", "reduced-motion collapse must remain paint-only", reducedRecollapsed);
    assert(isIdentityTransform(reducedRecollapsed.surfaceTransform), "reduced-motion collapse must not translate or scale", reducedRecollapsed);
    assertSurfaceAnchorStable(reducedCollapsed, reducedRecollapsed, "desktop reduced-motion quick menu after collapse");
    await desktop.waitForTimeout(100);
    const reducedRecollapsedSettled = await sampleMenu(desktop);
    assertCollapsedSurfaceClean(reducedRecollapsedSettled, "desktop reduced-motion collapse");
    await desktop.emulateMedia({ reducedMotion: "no-preference" });
    await desktop.screenshot({ path: path.join(outputDir, "desktop-collapsed.png") });

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    mobile.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    await initialize(mobile, "top_right", "auto");
    await mobile.getByTestId("quick-menu-toggle").click();
    await mobile.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    await mobile.waitForTimeout(220);
    const mobileSample = await sampleMenu(mobile);
    assert(Math.abs(mobileSample.rootOpacity - 1) <= 0.02, "mobile quick-menu root must not dim its only toggle", mobileSample);
    assert(Math.abs(Number.parseFloat(mobileSample.rootStyle.skinOpacity) - 0.66) <= 0.02, "mobile quick menu lost the authored skin opacity token", mobileSample);
    assert(Math.abs(Number.parseFloat(mobileSample.rootStyle.materialAlpha) - 66) <= 0.2 && !isTransparentColor(mobileSample.surfaceOwnBackground), "mobile quick-menu surface did not apply the authored opacity to its material", mobileSample);
    assert(mobileSample.previewBadgeCount === 0, "mobile preview mode must not inject an extra quick-menu button", mobileSample);
    assert(mobileSample.buttonWidth <= mobileSample.surfaceRect.width + 1 && mobileSample.buttonHeight <= mobileSample.surfaceRect.height + 1, "mobile C quick-menu rows must remain inside the responsive surface", mobileSample);
    assertSharedGlassGeometry(mobileSample, { width: 390, height: 844 }, "mobile expanded");
    assertSurfaceAligned(mobileSample, "mobile expanded");
    await mobile.screenshot({ path: path.join(outputDir, "mobile-expanded.png") });
    await mobile.close();

    const mobileLandscape = await browser.newPage({
      viewport: { width: 916, height: 442 },
      isMobile: true,
      hasTouch: true,
    });
    mobileLandscape.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    await initialize(mobileLandscape, "top_right", "down");
    const mobileLandscapeCollapsed = await sampleMenu(mobileLandscape);
    await mobileLandscape.getByTestId("quick-menu-toggle").click();
    await mobileLandscape.waitForFunction(() => document.querySelector('[data-testid="quick-menu-toggle"]')?.getAttribute("aria-expanded") === "true");
    await mobileLandscape.waitForTimeout(220);
    const mobileLandscapeExpanded = await sampleMenu(mobileLandscape);
    assertDialogStable(mobileLandscapeCollapsed, mobileLandscapeExpanded, "916x442 touch landscape");
    assertSurfaceAnchorStable(mobileLandscapeCollapsed, mobileLandscapeExpanded, "916x442 touch landscape");
    const mobileLandscapeGeometry = await assertActionGeometry(mobileLandscape, { width: 916, height: 442 }, "916x442 touch landscape");
    assert(mobileLandscapeGeometry.scrollWidth <= 917, "916x442 touch landscape quick menu caused horizontal overflow", mobileLandscapeGeometry);
    assert(mobileLandscapeGeometry.overlaps.length === 0, "916x442 touch landscape quick-menu actions overlap", mobileLandscapeGeometry);
    await mobileLandscape.screenshot({ path: path.join(outputDir, "mobile-landscape-expanded.png") });
    await mobileLandscape.close();

    const viewportMatrix = [
      { width: 1920, height: 1080 },
      { width: 2400, height: 1080 },
      { width: 757, height: 299 },
      { width: 640, height: 360 },
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
      { width: 2560, height: 1440 },
    ];
    const viewportMatrixReport = await verifyViewportMatrix(browser, viewportMatrix, pageErrors);

    const anchorScenarios = {};
    for (const anchor of ["top_right", "center", "bottom_center"]) {
      anchorScenarios[`desktop:${anchor}`] = await verifyAnchorScenario(browser, { width: 1280, height: 720 }, anchor, pageErrors);
    }
    const directionScenarios = {};
    for (const direction of ["up", "down"]) {
      directionScenarios[direction] = await verifyDirectionScenario(browser, direction, pageErrors);
    }

    assert(pageErrors.length === 0, "runtime raised page errors", pageErrors);
    const report = {
      ok: true,
      collapsed,
      expanded,
      afterStory,
      reducedMotion: { collapsed: reducedCollapsed, expanded: reducedExpanded, recollapsed: reducedRecollapsed },
      mobile: mobileSample,
      viewportMatrix: viewportMatrixReport,
      anchorScenarios,
      directionScenarios,
      pageErrors,
    };
    const staleErrorPath = path.join(outputDir, "error.txt");
    if (fs.existsSync(staleErrorPath)) fs.unlinkSync(staleErrorPath);
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(`quick-menu-collapse-playwright: PASS (${outputDir})`);
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
