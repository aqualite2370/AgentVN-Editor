const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outDir = path.join(root, "output", "playwright", "android-gamecli-layout");
const testPort = Number(process.env.AGENTVN_GAMECLI_TEST_PORT || 6868);
const baseUrl = `http://127.0.0.1:${testPort}/?mode=preview`;

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

function fixture() {
  const now = new Date().toISOString();
  const titleTypes = [
    "main_menu_continue_button",
    "main_menu_start_button",
    "main_menu_save_load_button",
    "main_menu_gallery_button",
    "main_menu_settings_button",
    "main_menu_about_button",
  ];
  return {
    manifest: {
      manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.2.0",
      game_id: "android-layout", title: "Android Layout Options", author: "AgentVN QA", version: "1.0.0",
      description: "Android layout safety fixture", language: "zh-CN", entry_script: "script.json", entry_scene_id: "scene_main",
      assets: [], created_at: now, updated_at: now,
    },
    script: {
      schema_version: "1.0.0", game_id: "android-layout", title: "Android Layout Options", entry_scene_id: "scene_main",
      characters: [{ character_id: "tester", name: "Tester" }],
      scenes: [{ scene_id: "scene_main", title: "Main", chapter: 1, tags: [], commands: [
        { type: "dialog", character_id: "tester", speaker: "Tester", text: "这是一段用于 Android 横屏安全区测试的长对白。文字必须完整换行并保持可滚动，不能被说话人名牌、继续提示、底部手势区域或快捷菜单裁切。SupercalifragilisticexpialidociousWithoutSpacesShouldWrapCorrectly。" },
      ] }],
    },
    uiSkin: {
      ui_layout_version: "1.2.0", name: "Android responsive stress skin", target_runtime: "0.2.0", assets: [],
      tokens: { colorBackground: "#060812", colorSurface: "#111827", colorSurfaceStrong: "#1f2937", colorInk: "#f8fafc", colorMuted: "#94a3b8", colorAccent: "#60a5fa", colorAccent2: "#f59e0b", colorLine: "#64748b", colorPanel: "#111827", colorPanelText: "#f8fafc", colorControl: "#1e293b", colorControlHover: "#334155", colorControlActive: "#2563eb", colorControlText: "#f8fafc", colorDialog: "#020617", colorDialogText: "#f8fafc", colorSpeakerPlate: "#1e3a8a", colorSpeakerText: "#f8fafc", colorChoice: "#1e293b", colorChoiceText: "#f8fafc", colorQuickMenu: "#ffffff", colorFocus: "#93c5fd", radius: 10, fontScale: 1.15 },
      screens: [
        { screen_id: "title", components: [
          { component_id: "title_hero", component_type: "main_menu_hero", rect: { x: 6, y: 12, width: 62, height: 50 }, style: { fontSize: 32 } },
          { component_id: "title_default_action_mask", component_type: "mask", rect: { x: 77, y: 27, width: 20, height: 57 }, mobileRect: { x: 71, y: 27, width: 27, height: 57 }, zIndex: 20, style: { maskMode: "blur", backgroundColor: "rgba(8, 13, 22, 0.62)", backdropBlur: 12, opacity: 1, borderWidth: 0, borderRadius: 0 } },
          ...titleTypes.map((component_type, index) => ({
            component_id: `title_${component_type}`,
            component_type,
            rect: { x: 78, y: 28 + index * 8, width: 18, height: 7 },
            mobileRect: { x: 72, y: 28 + index * 8, width: 25, height: 7 },
            style: { fontSize: 18, borderRadius: 10 },
            zIndex: 20 + index,
          })),
        ] },
        { screen_id: "preferences", components: [{ component_id: "settings_group", component_type: "settings_group", rect: { x: 4, y: 14, width: 92, height: 78 }, style: { fontSize: 24 } }] },
        { screen_id: "player", components: [
          { component_id: "stage_background", component_type: "stage_background", rect: { x: 0, y: 0, width: 100, height: 100 } },
          { component_id: "dialog_panel", component_type: "dialog_panel", rect: { x: 4, y: 68, width: 92, height: 26 }, style: { padding: 0, fontSize: 28 } },
          { component_id: "speaker_label", component_type: "speaker_label", rect: { x: 8, y: 69, width: 22, height: 5 }, style: { fontSize: 28 } },
          { component_id: "dialog_text", component_type: "dialog_text", rect: { x: 8, y: 77, width: 80, height: 12 }, style: { fontSize: 34 } },
          { component_id: "continue_indicator", component_type: "continue_indicator", rect: { x: 80, y: 87, width: 14, height: 6 }, style: { fontSize: 18 } },
          { component_id: "quick_menu", component_type: "quick_menu", rect: { x: 98, y: 2, width: 42, height: 9, anchor: "top_right" }, mobileRect: { x: 98, y: 2, width: 50, height: 10, anchor: "top_right" }, style: { padding: 4, gap: 3 } },
        ] },
      ],
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

async function sample(page, selectors) {
  return page.evaluate((items) => {
    const rect = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const scope = document.querySelector(".ui-skin-scope");
    const frame = document.querySelector(".runtime-layout-frame");
    const resolveLength = (name, axis) => {
      const probe = document.createElement("div");
      probe.style.position = "absolute"; probe.style.visibility = "hidden"; probe.style.pointerEvents = "none";
      if (axis === "width") probe.style.width = `var(${name})`; else probe.style.height = `var(${name})`;
      scope.appendChild(probe); const value = axis === "width" ? probe.getBoundingClientRect().width : probe.getBoundingClientRect().height; probe.remove(); return value;
    };
    const values = Object.fromEntries(items.map((selector) => [selector, [...document.querySelectorAll(selector)].filter((node) => getComputedStyle(node).display !== "none").map(rect)]));
    return {
      breakpoint: scope?.getAttribute("data-ui-breakpoint"), formFactor: scope?.getAttribute("data-ui-form-factor"), platform: scope?.getAttribute("data-runtime-platform"),
      frame: rect(frame), safe: { top: resolveLength("--runtime-safe-top", "height"), right: resolveLength("--runtime-safe-right", "width"), bottom: resolveLength("--runtime-safe-bottom", "height"), left: resolveLength("--runtime-safe-left", "width") }, values,
    };
  }, selectors);
}

function overlap(a, b) { return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)); }
function inside(rect, bounds, tolerance = 2) { return rect.left >= bounds.left - tolerance && rect.top >= bounds.top - tolerance && rect.right <= bounds.right + tolerance && rect.bottom <= bounds.bottom + tolerance; }
function sameRect(a, b, tolerance = 0.2) {
  return ["left", "top", "width", "height"].every((key) => Math.abs(a[key] - b[key]) < tolerance);
}
function sameCenterY(a, b, tolerance = 0.2) {
  return Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < tolerance;
}
function safeBounds(sampled) { return { left: sampled.frame.left + sampled.safe.left, top: sampled.frame.top + sampled.safe.top, right: sampled.frame.right - sampled.safe.right, bottom: sampled.frame.bottom - sampled.safe.bottom }; }
function assertPng(filePath) {
  const bytes = fs.readFileSync(filePath);
  const magic = [137, 80, 78, 71, 13, 10, 26, 10];
  assert(bytes.length > 8 && magic.every((value, index) => bytes[index] === value), "SCREENSHOT_CAPTURE_INVALID", { filePath, bytes: bytes.length });
}

async function capturePng(page, fileName) {
  const filePath = path.join(outDir, fileName);
  await page.screenshot({ path: filePath });
  assertPng(filePath);
  return filePath;
}

async function inspectVisibleControls(page, selector) {
  return page.locator(selector).evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const scrollContainer = node.closest(".settings-content");
    const clipRect = scrollContainer?.getBoundingClientRect();
    const centerInsideClip = !clipRect
      || (centerX >= clipRect.left && centerX <= clipRect.right && centerY >= clipRect.top && centerY <= clipRect.bottom);
    const inViewport = rect.width > 0
      && rect.height > 0
      && rect.left >= 0
      && rect.top >= 0
      && rect.right <= innerWidth
      && rect.bottom <= innerHeight
      && centerInsideClip;
    const hit = document.elementFromPoint(centerX, centerY);
    return {
      testId: node.getAttribute("data-testid"),
      ariaHidden: node.closest(".quick-menu-surface")?.getAttribute("aria-hidden"),
      text: node.textContent?.trim().replace(/\s+/g, " ").slice(0, 120),
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      display: style.display,
      visibility: style.visibility,
      opacity: Number(style.opacity || 1),
      pointerEvents: style.pointerEvents,
      inViewport,
      centerHitTag: hit?.tagName,
      centerHitClass: typeof hit?.className === "string" ? hit.className : "",
      centerHit: hit === node
        || node.contains(hit)
        || Boolean(hit?.closest("button") === node)
        || Boolean(node.closest("label")?.contains(hit))
        || Boolean(node instanceof HTMLInputElement && node.type === "checkbox" && node.closest("label")),
    };
  }));
}

function assertVisibleControls(items, label) {
  const visible = items.filter((item) => item.inViewport);
  assert(visible.every((item) => item.display !== "none"
    && item.visibility !== "hidden"
    && item.opacity > 0.15
    && (item.centerHit || item.centerHitClass.includes("settings-select-trigger"))), "VISUAL_CONTROL_HIDDEN", { label, controls: visible });
  return visible;
}

async function inspectQuickMenuLabels(page) {
  return page.locator(".quick-menu-surface.is-expanded .quick-menu-button").evaluateAll((nodes) => nodes.map((node) => {
    const buttonStyle = getComputedStyle(node);
    const label = node.querySelector(".quick-menu-button-label");
    const labelStyle = label ? getComputedStyle(label) : null;
    const rect = node.getBoundingClientRect();
    const labelRect = label?.getBoundingClientRect();
    const icon = node.querySelector(".precision-icon");
    const iconRect = icon?.getBoundingClientRect();
    return {
      text: label?.textContent?.trim().replace(/\s+/g, " ") || "",
      ariaLabel: node.getAttribute("aria-label") || "",
      title: node.getAttribute("title") || "",
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      labelRect: labelRect ? { left: labelRect.left, top: labelRect.top, right: labelRect.right, bottom: labelRect.bottom, width: labelRect.width, height: labelRect.height } : null,
      iconRect: iconRect ? { left: iconRect.left, top: iconRect.top, right: iconRect.right, bottom: iconRect.bottom, width: iconRect.width, height: iconRect.height } : null,
      display: buttonStyle.display,
      visibility: buttonStyle.visibility,
      opacity: Number(buttonStyle.opacity || 1),
      pointerEvents: buttonStyle.pointerEvents,
      labelDisplay: labelStyle?.display || "missing",
      labelVisibility: labelStyle?.visibility || "missing",
      labelOpacity: labelStyle ? Number(labelStyle.opacity || 1) : 0,
      labelScrollWidth: label?.scrollWidth ?? 0,
      labelClientWidth: label?.clientWidth ?? 0,
      labelScrollHeight: label?.scrollHeight ?? 0,
      labelClientHeight: label?.clientHeight ?? 0,
    };
  }));
}

function assertQuickMenuLabels(items, frame, label) {
  assert(items.length === 7, "QUICK_MENU_ACTION_COUNT_INVALID", { label, items });
  for (const item of items) {
    assert(item.text.length > 0, "MOBILE_TEXT_MISSING", { label, item });
    assert(item.ariaLabel.trim().length > 0 && item.title.trim().length > 0, "MOBILE_ACCESSIBLE_LABEL_MISSING", { label, item });
    assert(item.display !== "none" && item.visibility !== "hidden" && item.opacity >= 0.95 && item.pointerEvents === "auto", "MOBILE_CONTROL_HIDDEN", { label, item });
    assert(item.labelDisplay !== "none" && item.labelVisibility !== "hidden" && item.labelOpacity >= 0.95, "MOBILE_TEXT_HIDDEN", { label, item });
    assert(item.labelRect && inside(item.labelRect, item.rect, 1), "MOBILE_TEXT_OUT_OF_BOUNDS", { label, item });
    assert(item.labelScrollWidth <= item.labelClientWidth + 1 && item.labelScrollHeight <= item.labelClientHeight + 1, "MOBILE_TEXT_CLIPPED", { label, item });
    assert(item.iconRect && item.labelRect && overlap(item.iconRect, item.labelRect) < 1, "MOBILE_ICON_TEXT_OVERLAP", { label, item });
    assert(inside(item.rect, frame, 2), "QUICK_MENU_ACTION_NOT_CLICKABLE", { label, frame, item });
  }
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      assert(overlap(items[leftIndex].rect, items[rightIndex].rect) < 2, "MOBILE_CONTROL_OVERLAP", {
        label,
        left: items[leftIndex],
        right: items[rightIndex],
      });
    }
  }
}

async function exerciseTitleResumeRecovery(page, viewport, label) {
  const compressedHeight = Math.max(180, Math.round(viewport.height * 0.42));
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.setViewportSize({ width: viewport.width, height: compressedHeight });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(80);
  await page.setViewportSize(viewport);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new CustomEvent("agentvn:android-resume"));
  });
  await page.waitForFunction(
    () => !document.querySelector(".runtime-screen-transition.is-active"),
    null,
    { timeout: 8_000 },
  );
  await page.waitForTimeout(520);

  const sampled = await sample(page, [".menu-action-button", ".menu-hero"]);
  const expectedWidth = Math.min(viewport.width, viewport.height * (16 / 9));
  const expectedHeight = expectedWidth * (9 / 16);
  const frameRatio = sampled.frame.width / sampled.frame.height;
  assert(
    Math.abs(frameRatio - (16 / 9)) < 0.01
      && Math.abs(sampled.frame.width - expectedWidth) <= 2
      && Math.abs(sampled.frame.height - expectedHeight) <= 2,
    "LOCK_RESUME_FRAME_COMPRESSED",
    { label, viewport, compressedHeight, expectedWidth, expectedHeight, frame: sampled.frame, frameRatio },
  );

  const controls = await inspectVisibleControls(page, ".menu-action-button");
  assert(
    controls.length > 0
      && controls.every((item) => item.inViewport
        && item.display !== "none"
        && item.visibility !== "hidden"
        && item.opacity > 0.15
        && item.centerHit
        && item.rect.width > 0
        && item.rect.height > 0),
    "LOCK_RESUME_CONTROL_NOT_CLICKABLE",
    { label, viewport, controls },
  );
  const buttons = sampled.values[".menu-action-button"];
  assert(
    buttons.every((button) => inside(button, sampled.frame)),
    "LOCK_RESUME_CONTROL_OUT_OF_BOUNDS",
    { label, viewport, frame: sampled.frame, buttons },
  );
  for (let leftIndex = 0; leftIndex < buttons.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < buttons.length; rightIndex += 1) {
      assert(
        overlap(buttons[leftIndex], buttons[rightIndex]) < 2,
        "LOCK_RESUME_CONTROLS_OVERLAP",
        { label, viewport, left: buttons[leftIndex], right: buttons[rightIndex] },
      );
    }
  }
  const fit = await page.locator(".menu-action-button").evaluateAll((elements) => elements.map((element) => ({
    testId: element.getAttribute("data-testid"),
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
  })));
  assert(
    fit.every((item) => item.scrollWidth <= item.clientWidth + 1 && item.scrollHeight <= item.clientHeight + 1),
    "LOCK_RESUME_CONTROL_CLIPPED",
    { label, viewport, fit },
  );
  return { label, viewport, compressedHeight, frame: sampled.frame, controls, fit };
}

async function exercisePlayingResumeRecovery(page, viewport, label) {
  await page.waitForFunction(
    () => !document.querySelector(".game-launch-blackout"),
    null,
    { timeout: 8_000 },
  );
  const selectors = [
    ".dialog-box",
    ".speaker",
    ".dialog-text",
    ".continue-indicator",
    ".playback-controls",
    '[data-testid="quick-menu-toggle"]',
  ];
  const before = await sample(page, selectors);
  const compressedHeight = Math.max(180, Math.round(viewport.height * 0.42));
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.setViewportSize({ width: viewport.width, height: compressedHeight });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(80);
  await page.setViewportSize(viewport);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new CustomEvent("agentvn:android-resume"));
  });
  await page.waitForTimeout(520);

  const sampled = await sample(page, selectors);
  const expectedWidth = Math.min(viewport.width, viewport.height * (16 / 9));
  const expectedHeight = expectedWidth * (9 / 16);
  const frameRatio = sampled.frame.width / sampled.frame.height;
  assert(
    Math.abs(frameRatio - (16 / 9)) < 0.01
      && Math.abs(sampled.frame.width - expectedWidth) <= 2
      && Math.abs(sampled.frame.height - expectedHeight) <= 2,
    "LOCK_RESUME_PLAYING_FRAME_COMPRESSED",
    { label, viewport, compressedHeight, expectedWidth, expectedHeight, frame: sampled.frame, frameRatio },
  );

  const playerSafeBounds = safeBounds(sampled);
  for (const selector of [".dialog-box", ".playback-controls", '[data-testid="quick-menu-toggle"]']) {
    assert(
      sampled.values[selector].every((rect) => inside(rect, playerSafeBounds)),
      "LOCK_RESUME_PLAYING_CONTROL_OUT_OF_BOUNDS",
      { label, viewport, selector, playerSafeBounds, rects: sampled.values[selector] },
    );
  }
  const speaker = sampled.values[".speaker"][0];
  const dialogText = sampled.values[".dialog-text"][0];
  const indicator = sampled.values[".continue-indicator"][0];
  const beforeSpeaker = before.values[".speaker"][0];
  const beforeDialogText = before.values[".dialog-text"][0];
  const beforeIndicator = before.values[".continue-indicator"][0];
  const beforeSpeakerOverlap = beforeSpeaker && beforeDialogText ? overlap(beforeSpeaker, beforeDialogText) : 0;
  const afterSpeakerOverlap = speaker && dialogText ? overlap(speaker, dialogText) : 0;
  const beforeIndicatorOverlap = beforeIndicator && beforeDialogText ? overlap(beforeIndicator, beforeDialogText) : 0;
  const afterIndicatorOverlap = indicator && dialogText ? overlap(indicator, dialogText) : 0;
  assert(
    afterSpeakerOverlap <= beforeSpeakerOverlap + 2,
    "LOCK_RESUME_SPEAKER_OVERLAP_INCREASED",
    { label, viewport, beforeSpeaker, beforeDialogText, speaker, dialogText, beforeSpeakerOverlap, afterSpeakerOverlap },
  );
  assert(
    afterIndicatorOverlap <= beforeIndicatorOverlap + 2,
    "LOCK_RESUME_INDICATOR_OVERLAP_INCREASED",
    { label, viewport, beforeIndicator, beforeDialogText, indicator, dialogText, beforeIndicatorOverlap, afterIndicatorOverlap },
  );
  for (const selector of selectors) {
    const beforeRects = before.values[selector];
    const afterRects = sampled.values[selector];
    assert(
      beforeRects.length === afterRects.length
        && beforeRects.every((rect, index) => sameRect(rect, afterRects[index], 2)),
      "LOCK_RESUME_PLAYING_CONTROL_COMPRESSED",
      { label, viewport, selector, beforeRects, afterRects },
    );
  }

  const dialogOverflow = await page.locator(".dialog-text").evaluate((element) => ({
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    overflowX: getComputedStyle(element).overflowX,
    overflowY: getComputedStyle(element).overflowY,
  }));
  assert(
    (dialogOverflow.scrollWidth <= dialogOverflow.clientWidth + 1 || ["auto", "scroll"].includes(dialogOverflow.overflowX))
      && (dialogOverflow.scrollHeight <= dialogOverflow.clientHeight + 1 || ["auto", "scroll"].includes(dialogOverflow.overflowY)),
    "LOCK_RESUME_DIALOG_CLIPPED",
    { label, viewport, dialogOverflow },
  );

  const toggle = page.locator('[data-testid="quick-menu-toggle"]');
  const toggleControls = await inspectVisibleControls(page, '[data-testid="quick-menu-toggle"]');
  assert(
    toggleControls.length === 1 && toggleControls[0].inViewport && toggleControls[0].centerHit,
    "LOCK_RESUME_QUICK_MENU_TOGGLE_NOT_CLICKABLE",
    { label, viewport, toggleControls },
  );
  await toggle.click();
  await page.waitForSelector(".quick-menu-surface.is-expanded");
  await page.waitForTimeout(520);
  const quickMenuControls = await inspectVisibleControls(page, ".quick-menu-surface.is-expanded button");
  assert(
    quickMenuControls.length > 0
      && quickMenuControls.every((item) => item.inViewport
        && item.display !== "none"
        && item.visibility !== "hidden"
        && item.opacity > 0.15
        && item.centerHit
        && inside(item.rect, sampled.frame)),
    "LOCK_RESUME_QUICK_MENU_CONTROL_NOT_CLICKABLE",
    { label, viewport, frame: sampled.frame, quickMenuControls },
  );
  const quickMenuLabels = await inspectQuickMenuLabels(page);
  assertQuickMenuLabels(quickMenuLabels, sampled.frame, label);
  for (let leftIndex = 0; leftIndex < quickMenuControls.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < quickMenuControls.length; rightIndex += 1) {
      assert(
        overlap(quickMenuControls[leftIndex].rect, quickMenuControls[rightIndex].rect) < 2,
        "LOCK_RESUME_QUICK_MENU_CONTROLS_OVERLAP",
        { label, viewport, left: quickMenuControls[leftIndex], right: quickMenuControls[rightIndex] },
      );
    }
  }
  await toggle.click();
  await page.waitForSelector(".quick-menu-surface.is-collapsed");
  await page.waitForTimeout(260);
  const collapsedSurface = await page.locator(".quick-menu-surface.is-collapsed").evaluate((element) => {
    const style = getComputedStyle(element);
    const before = getComputedStyle(element, "::before");
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderWidth: style.borderWidth,
      boxShadow: style.boxShadow,
      opacity: Number(style.opacity || 1),
      pointerEvents: style.pointerEvents,
      pseudoOpacity: Number(before.opacity || 1),
      pseudoDisplay: before.display,
      pseudoBackgroundColor: before.backgroundColor,
      pseudoBorderColor: before.borderColor,
      pseudoBoxShadow: before.boxShadow,
    };
  });
  assert(
    collapsedSurface.backgroundColor === "rgba(0, 0, 0, 0)"
      && collapsedSurface.borderWidth === "0px"
      && collapsedSurface.boxShadow === "none"
      && (collapsedSurface.pseudoDisplay === "none" || collapsedSurface.pseudoOpacity < 0.05)
      && collapsedSurface.pseudoBackgroundColor === "rgba(0, 0, 0, 0)"
      && collapsedSurface.pseudoBoxShadow === "none",
    "MOBILE_QUICK_MENU_COLLAPSED_RESIDUAL_SURFACE",
    { label, viewport, collapsedSurface },
  );
  return {
    label,
    viewport,
    compressedHeight,
    frame: sampled.frame,
    beforeFrame: before.frame,
    playerSafeBounds,
    dialogOverflow,
    toggleControls,
    quickMenuControls,
    quickMenuLabels,
    collapsedSurface,
  };
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const useExternalServer = process.env.AGENTVN_GAMECLI_EXTERNAL_SERVER === "1";
  const vite = useExternalServer
    ? null
    : spawn("cmd.exe", ["/d", "/s", "/c", `npm run dev -- --port ${testPort}`], { cwd: runtimeRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let viteLog = "";
  if (vite) {
    vite.stdout.on("data", (chunk) => { viteLog += chunk; });
    vite.stderr.on("data", (chunk) => { viteLog += chunk; });
  }
  try {
    await waitForServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 15; AgentVN QA) AppleWebKit/537.36 Chrome/138 Mobile Safari/537.36",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => { viteLog += `\nPAGEERROR ${error.stack || error.message}\n`; });
    page.on("console", (message) => { if (message.type() === "error") viteLog += `\nCONSOLE ${message.text()}\n`; });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    // Android WebView can briefly keep the document root at the pre-immersive
    // height even though the visual viewport has already expanded to the
    // landscape window.  This reproduces that first-frame state before the
    // runtime cartridge mounts.
    const staleRootStyle = await page.addStyleTag({
      content: "html, body, #root { height: 380px !important; min-height: 380px !important; }",
    });
    const initMessage = {
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: "android-layout-session",
      revision: 1,
      requestId: "android-layout-init",
      runId: "android-layout-run",
      ...fixture(),
      assetUrls: {},
      start: {
        requestId: "android-layout-start",
        target: { sceneId: "scene_main", commandIndex: 0 },
        entryPath: [],
        mode: "stable_frame",
        playbackRate: 1,
        reducedMotion: true,
      },
      screen: "title_menu",
    };
    await page.evaluate((serialized) => window.postMessage(JSON.parse(serialized), "*"), JSON.stringify(initMessage));
    await page.waitForSelector('[data-testid="start-new-game"]', { timeout: 20_000 });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("agentvn:android-insets", { detail: { top: 64, right: 0, bottom: 24, left: 0, revision: 7 } })));
    // Live-preview initialization may enter the same launch state machine as a
    // real game entry.  Wait for that transition to finish before taking the
    // title-page visual/geometry sample; otherwise the intentional blackout
    // overlay is the expected center hit target and the controls appear
    // "hidden" to the visual contract.
    await page.waitForFunction(
      () => !document.querySelector(".game-launch-blackout"),
      null,
      { timeout: 8_000 },
    );
    await page.waitForFunction(
      () => !document.querySelector(".runtime-screen-transition.is-active"),
      null,
      { timeout: 8_000 },
    );
    await page.waitForTimeout(150);

    const screenshots = {};
    const visibleControls = {};
    const title = await sample(page, [".menu-action-button", ".menu-hero"]);
    const firstFrameExpected = {
      width: 1280,
      height: 720,
    };
    assert(
      Math.abs(title.frame.width - firstFrameExpected.width) <= 2
        && Math.abs(title.frame.height - firstFrameExpected.height) <= 2,
      "Android first frame must follow the visual viewport instead of stale document-root height",
      { firstFrameExpected, title },
    );
    await staleRootStyle.evaluate((element) => element.remove());
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForTimeout(80);
    assert(title.breakpoint === "desktop" && title.formFactor === "handheld" && title.platform === "android", "high-DPR Android viewport did not keep the PC design breakpoint", title);
    const titleSafe = safeBounds(title); const buttons = title.values[".menu-action-button"];
    assert(buttons.every((rect) => inside(rect, titleSafe)), "title action escaped Android safe bounds", { titleSafe, buttons });
    for (let i = 0; i < buttons.length; i += 1) for (let j = i + 1; j < buttons.length; j += 1) assert(overlap(buttons[i], buttons[j]) < 2, "title actions overlap", { a: buttons[i], b: buttons[j] });
    const titleButtonFit = await page.locator(".menu-action-button").evaluateAll((elements) => elements.map((element) => ({
      testId: element.getAttribute("data-testid"),
      text: element.textContent?.trim().replace(/\s+/g, " "),
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
    })));
    assert(
      titleButtonFit.every((item) => item.scrollWidth <= item.clientWidth + 1 && item.scrollHeight <= item.clientHeight + 1),
      "mobile title action text is clipped",
      titleButtonFit,
    );
    visibleControls.title = await inspectVisibleControls(page, ".menu-action-button");
    assertVisibleControls(visibleControls.title, "title");
    const titleLayering = await page.evaluate(() => {
      const hero = document.querySelector(".menu-hero");
      const mask = document.querySelector(".main-menu-title-mask");
      const actions = document.querySelector(".main-menu-title-actions-layer");
      if (!(hero instanceof HTMLElement) || !(mask instanceof HTMLElement) || !(actions instanceof HTMLElement)) return null;
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
      };
      return {
        heroZ: Number(getComputedStyle(hero).zIndex),
        maskZ: Number(getComputedStyle(mask).zIndex),
        actionsZ: Number(getComputedStyle(actions).zIndex),
        heroRect: rect(hero),
        maskRect: rect(mask),
      };
    });
    assert(titleLayering
      && titleLayering.heroZ < titleLayering.maskZ
      && titleLayering.maskZ < titleLayering.actionsZ
      && buttons.every((button) => inside(button, titleLayering.maskRect, 3)),
    "title mask stacking order is invalid", titleLayering);
    assert(await page.locator('[data-testid="open-exit-confirmation"]').count() === 0, "title menu must not expose an exit action");
    const titleIconScale = await page.locator(".menu-action-button").evaluateAll((buttons) => buttons.map((button) => {
      const icon = button.querySelector(".precision-icon, .settings-entry-image");
      const buttonStyle = getComputedStyle(button);
      const iconRect = icon?.getBoundingClientRect();
      return {
        testId: button.getAttribute("data-testid"),
        fontSize: Number.parseFloat(buttonStyle.fontSize),
        iconWidth: iconRect?.width ?? 0,
        iconHeight: iconRect?.height ?? 0,
      };
    }));
    assert(
      titleIconScale.every((item) => Math.abs(item.iconWidth - item.fontSize) <= 0.75 && Math.abs(item.iconHeight - item.fontSize) <= 0.75),
      "title action icons must track the button font size",
      titleIconScale,
    );
    screenshots.title = await capturePng(page, "title.png");
    const reportedViewportResume = await exerciseTitleResumeRecovery(page, { width: 1280, height: 720 }, "reported-android-1280x720");
    screenshots.titleAfterResume = await capturePng(page, "title-after-resume.png");

    // Some Android WebViews briefly report an oversized document root after
    // immersive landscape enters (for example 1280x976 while the visual
    // viewport is already 1280x576).  The visual frame must follow the
    // compositor viewport instead of being vertically centered below the
    // captured window.
    const oversizedRootContext = await browser.newContext({
      viewport: { width: 1280, height: 576 },
      screen: { width: 1280, height: 576 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 15; AgentVN Oversized Root QA) AppleWebKit/537.36 Chrome/138 Mobile Safari/537.36",
    });
    const oversizedRootPage = await oversizedRootContext.newPage();
    await oversizedRootPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await oversizedRootPage.addStyleTag({
      content: "html, body, #root { height: 976px !important; min-height: 976px !important; }",
    });
    await oversizedRootPage.evaluate(
      (serialized) => window.postMessage(JSON.parse(serialized), "*"),
      JSON.stringify({
        ...initMessage,
        sessionId: "android-layout-oversized-root-session",
        requestId: "android-layout-oversized-root-init",
        runId: "android-layout-oversized-root-run",
        start: { ...initMessage.start, requestId: "android-layout-oversized-root-start" },
      }),
    );
    await oversizedRootPage.waitForSelector('[data-testid="start-new-game"]', { timeout: 20_000 });
    await oversizedRootPage.waitForFunction(() => !document.querySelector(".game-launch-blackout"), null, { timeout: 8_000 });
    await oversizedRootPage.waitForFunction(() => !document.querySelector(".runtime-screen-transition.is-active"), null, { timeout: 8_000 });
    await oversizedRootPage.waitForTimeout(120);
    const oversizedRoot = await sample(oversizedRootPage, [".menu-action-button"]);
    const oversizedControls = await inspectVisibleControls(oversizedRootPage, ".menu-action-button");
    const oversizedExpected = { width: 1024, height: 576, top: 0, bottom: 576 };
    assert(
      Math.abs(oversizedRoot.frame.width - oversizedExpected.width) <= 2
        && Math.abs(oversizedRoot.frame.height - oversizedExpected.height) <= 2
        && Math.abs(oversizedRoot.frame.top - oversizedExpected.top) <= 2
        && Math.abs(oversizedRoot.frame.bottom - oversizedExpected.bottom) <= 2,
      "Android oversized-root frame must follow the 1280x576 visual viewport",
      { oversizedExpected, oversizedRoot },
    );
    assert(
      oversizedControls.length > 0
        && oversizedControls.every((item) => item.inViewport && item.centerHit),
      "Android oversized-root title controls must remain visible and clickable",
      { oversizedControls, frame: oversizedRoot.frame },
    );
    screenshots.oversizedRoot = await capturePng(oversizedRootPage, "title-oversized-root-1280x576.png");
    await oversizedRootContext.close();

    const compactTitleContext = await browser.newContext({
      viewport: { width: 812, height: 375 },
      screen: { width: 812, height: 375 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 15; AgentVN Compact QA) AppleWebKit/537.36 Chrome/138 Mobile Safari/537.36",
    });
    const compactTitlePage = await compactTitleContext.newPage();
    await compactTitlePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await compactTitlePage.evaluate(
      (serialized) => window.postMessage(JSON.parse(serialized), "*"),
      JSON.stringify({
        ...initMessage,
        sessionId: "android-layout-compact-title-session",
        requestId: "android-layout-compact-title-init",
        runId: "android-layout-compact-title-run",
        start: { ...initMessage.start, requestId: "android-layout-compact-title-start" },
      }),
    );
    await compactTitlePage.waitForSelector('[data-testid="start-new-game"]', { timeout: 20_000 });
    await compactTitlePage.waitForFunction(() => !document.querySelector(".game-launch-blackout"), null, { timeout: 8_000 });
    const compactTitleButtonFit = await compactTitlePage.locator(".menu-action-button").evaluateAll((elements) => elements.map((element) => ({
      testId: element.getAttribute("data-testid"),
      text: element.textContent?.trim().replace(/\s+/g, " "),
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
    })));
    assert(
      compactTitleButtonFit.every((item) => item.scrollWidth <= item.clientWidth + 1 && item.scrollHeight <= item.clientHeight + 1),
      "compact mobile title action text is clipped",
      compactTitleButtonFit,
    );
    screenshots.compactTitle = await capturePng(compactTitlePage, "title-compact.png");
    const compactViewportResume = await exerciseTitleResumeRecovery(compactTitlePage, { width: 812, height: 375 }, "compact-android-812x375");
    screenshots.compactTitleAfterResume = await capturePng(compactTitlePage, "title-compact-after-resume.png");
    await compactTitlePage.locator('[data-testid="start-new-game"]').click();
    await compactTitlePage.waitForSelector(".dialog-box .dialog-text");
    const compactPlayingResume = await exercisePlayingResumeRecovery(compactTitlePage, { width: 812, height: 375 }, "compact-playing-812x375");
    screenshots.compactPlayingAfterResume = await capturePng(compactTitlePage, "playing-compact-after-resume.png");
    await compactTitleContext.close();

    await page.locator('[data-testid="open-settings"]').click();
    await page.waitForSelector(".settings-renpy");
    await page.waitForSelector(".settings-row");
    const optionsExit = page.locator('[data-testid="open-exit-confirmation"]');
    await optionsExit.waitFor({ state: "visible" });
    const optionsExitVisual = await optionsExit.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const normal = document.querySelector(".settings-tabs button");
      return {
        borderWidth: style.borderWidth,
        backgroundColor: style.backgroundColor,
        fontSize: Number.parseFloat(style.fontSize),
        normalFontSize: normal ? Number.parseFloat(getComputedStyle(normal).fontSize) : 0,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    assert(optionsExitVisual.borderWidth === "1px", "options exit link must keep the shared PC control border", optionsExitVisual);
    assert(optionsExitVisual.fontSize < optionsExitVisual.normalFontSize, "options exit link must be smaller than normal controls", optionsExitVisual);
    assert(
      optionsExitVisual.rect.left >= 0
        && optionsExitVisual.rect.top >= 0
        && optionsExitVisual.rect.right <= optionsExitVisual.viewport.width
        && optionsExitVisual.rect.bottom <= optionsExitVisual.viewport.height,
      "options exit link must remain inside the viewport",
      optionsExitVisual,
    );
    await optionsExit.click();
    await page.locator('[data-runtime-modal="true"]').waitFor({ state: "visible" });
    screenshots.exitConfirmation = await capturePng(page, "exit-confirmation.png");
    await page.keyboard.press("Escape");
    await page.locator('[data-runtime-modal="true"]').waitFor({ state: "hidden" });

    const settings = await sample(page, [".settings-renpy", ".settings-row", ".settings-row > span:first-child", ".settings-slider", ".settings-row output", ".settings-footer .ui-button"]);
    const settingsSafe = safeBounds(settings);
    assert(settings.values[".settings-renpy"].every((rect) => inside(rect, settingsSafe)), "settings panel escaped Android safe bounds", { settingsSafe, panel: settings.values[".settings-renpy"] });
    const labels = settings.values[".settings-row > span:first-child"], sliders = settings.values[".settings-slider"], outputs = settings.values[".settings-row output"];
    for (let i = 0; i < Math.min(labels.length, sliders.length); i += 1) assert(overlap(labels[i], sliders[i]) < 2 && (!outputs[i] || overlap(outputs[i], sliders[i]) < 2), "settings label/value overlaps slider", { label: labels[i], slider: sliders[i], output: outputs[i] });
    visibleControls.settingsDisplay = await inspectVisibleControls(page, ".settings-tabs button, .settings-content button, .settings-content input, .settings-footer button, .settings-screen > header button");
    assertVisibleControls(visibleControls.settingsDisplay, "settings-display");
    screenshots.settingsDisplay = await capturePng(page, "settings-display.png");

    await page.locator(".settings-tabs button").nth(2).click();
    await page.waitForSelector('input[aria-label="Background music volume"]');
    const audioRows = await sample(page, [".settings-row", ".settings-row > span:first-child", ".settings-slider", ".settings-check", ".settings-footer .ui-button"]);
    const audioPairing = await page.locator(".settings-row").evaluateAll((rows) => rows.map((row) => {
      const rect = (element) => {
        const r = element.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        label: row.querySelector(":scope > span:first-child") ? rect(row.querySelector(":scope > span:first-child")) : null,
        slider: row.querySelector(".settings-slider") ? rect(row.querySelector(".settings-slider")) : null,
        check: row.querySelector(".settings-check") ? rect(row.querySelector(".settings-check")) : null,
      };
    }));
    for (const pair of audioPairing) {
      if (pair.label && pair.slider) assert(overlap(pair.label, pair.slider) < 2, "settings audio label overlaps slider", pair);
      if (pair.check && pair.slider) assert(overlap(pair.check, pair.slider) < 2, "settings audio mute control overlaps slider", pair);
    }
    const audioSliders = page.locator(".settings-slider");
    const masterSliderWidth = await audioSliders.first().evaluate((element) => element.getBoundingClientRect().width);
    const channelSliderWidths = await audioSliders.evaluateAll((elements) =>
      elements.slice(1).map((element) => element.getBoundingClientRect().width),
    );
    assert(
      channelSliderWidths.every((width) => width >= masterSliderWidth * 0.72),
      "audio channel sliders must retain most of the master slider width",
      { masterSliderWidth, channelSliderWidths },
    );
    const backgroundSlider = page.locator('input[aria-label="Background music volume"]');
    const backgroundSliderBox = await backgroundSlider.boundingBox();
    assert(backgroundSliderBox, "background volume slider has no bounding box");
    await backgroundSlider.hover({ position: { x: backgroundSliderBox.width * 0.58, y: backgroundSliderBox.height / 2 } });
    const hoveredSlider = await backgroundSlider.evaluate((input) => {
      const slider = input.closest(".settings-slider");
      const track = slider?.querySelector(".settings-slider-track");
      if (!(slider instanceof HTMLElement) || !(track instanceof HTMLElement)) return null;
      const sliderStyle = getComputedStyle(slider);
      const trackStyle = getComputedStyle(track);
      return {
        borderWidth: sliderStyle.borderWidth,
        boxShadow: sliderStyle.boxShadow,
        outlineStyle: sliderStyle.outlineStyle,
        transform: sliderStyle.transform,
        trackTop: track.getBoundingClientRect().top,
        trackHeight: track.getBoundingClientRect().height,
        trackOpacity: Number(trackStyle.opacity),
      };
    });
    assert(
      hoveredSlider
        && hoveredSlider.borderWidth === "0px"
        && hoveredSlider.boxShadow === "none"
        && hoveredSlider.outlineStyle === "none"
        && hoveredSlider.transform === "none"
        && hoveredSlider.trackHeight >= 10
        && hoveredSlider.trackOpacity >= 0.88,
      "hovered slider must keep stable geometry without an outer frame",
      hoveredSlider,
    );
    await page.mouse.down();
    await page.waitForTimeout(540);
    const activeSlider = await backgroundSlider.evaluate((input) => {
      const slider = input.closest(".settings-slider");
      const track = slider?.querySelector(".settings-slider-track");
      if (!(slider instanceof HTMLElement) || !(track instanceof HTMLElement)) return null;
      const pseudo = getComputedStyle(slider, "::after");
      return {
        interacting: slider.classList.contains("is-interacting"),
        transform: getComputedStyle(track).transform,
        trackTop: track.getBoundingClientRect().top,
        trackHeight: track.getBoundingClientRect().height,
        labelOpacity: Number(pseudo.opacity),
        labelContent: pseudo.content,
      };
    });
    assert(
      activeSlider
        && activeSlider.interacting
        && /^matrix\(1, 0, 0, 1\.22, 0, -[\d.]+\)$/.test(activeSlider.transform)
        && Math.abs(activeSlider.trackHeight - hoveredSlider.trackHeight * 1.22) < 0.25
        && Math.abs(
          (activeSlider.trackTop + activeSlider.trackHeight / 2)
            - (hoveredSlider.trackTop + hoveredSlider.trackHeight / 2),
        ) < 0.2
        && activeSlider.labelOpacity > 0.95
        && /%/.test(activeSlider.labelContent),
      "active slider must slowly enlarge around its center and show a transient percentage",
      activeSlider,
    );
    screenshots.settingsAudioActive = await capturePng(page, "settings-audio-active.png");
    await page.mouse.up();
    await page.waitForTimeout(420);
    const settledSlider = await backgroundSlider.evaluate((input) => {
      const slider = input.closest(".settings-slider");
      const track = slider?.querySelector(".settings-slider-track");
      if (!(slider instanceof HTMLElement) || !(track instanceof HTMLElement)) return null;
      return {
        interacting: slider.classList.contains("is-interacting"),
        transform: getComputedStyle(track).transform,
        trackTop: track.getBoundingClientRect().top,
        trackHeight: track.getBoundingClientRect().height,
        labelOpacity: Number(getComputedStyle(slider, "::after").opacity),
      };
    });
    assert(
      settledSlider
        && !settledSlider.interacting
        && /^matrix\(1, 0, 0, 1, 0, -[\d.]+\)$/.test(settledSlider.transform)
        && Math.abs(settledSlider.trackHeight - hoveredSlider.trackHeight) < 0.2
        && settledSlider.labelOpacity < 0.05,
      "slider must restore its idle thickness and hide the value bubble after release",
      settledSlider,
    );
    visibleControls.settingsAudio = await inspectVisibleControls(page, ".settings-tabs button, .settings-content input, .settings-footer button, .settings-screen > header button");
    assertVisibleControls(visibleControls.settingsAudio, "settings-audio");
    screenshots.settingsAudio = await capturePng(page, "settings-audio.png");

    await page.locator(".settings-tabs button").nth(4).click();
    await page.waitForSelector('input[aria-label="自动存档"]');
    visibleControls.settingsSystem = await inspectVisibleControls(page, ".settings-tabs button, .settings-content button, .settings-content input, .settings-footer button, .settings-screen > header button");
    assertVisibleControls(visibleControls.settingsSystem, "settings-system");
    const systemScroll = await page.locator(".settings-content").evaluate((element) => {
      const before = { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
      element.scrollTop = element.scrollHeight;
      return { before, after: { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight } };
    });
    assert(systemScroll.after.scrollHeight <= systemScroll.after.clientHeight + 1 || systemScroll.after.scrollTop > 0, "settings system content is not scrollable", systemScroll);
    const systemBottomControls = await inspectVisibleControls(page, ".settings-content button, .settings-content input");
    assertVisibleControls(systemBottomControls, "settings-system-bottom");
    screenshots.settingsSystem = await capturePng(page, "settings-system.png");

    await page.locator('.settings-footer button').last().click();
    await page.waitForSelector('[data-testid="open-about"]');
    await page.locator('[data-testid="open-about"]').click();
    await page.waitForSelector('[data-testid="about-screen"]');
    await page.waitForFunction(() => !document.querySelector(".runtime-screen-transition.is-active"), null, { timeout: 8_000 });
    await page.waitForTimeout(120);
    visibleControls.about = await inspectVisibleControls(page, '[data-testid="about-screen"] button');
    assertVisibleControls(visibleControls.about, "about");
    screenshots.about = await capturePng(page, "about.png");
    await page.locator('[data-testid="back-to-main-menu"]').click();
    await page.waitForSelector('[data-testid="start-new-game"]');

    await page.locator('[data-testid="start-new-game"]').click();
    await page.waitForSelector(".dialog-box .dialog-text");
    await page.waitForTimeout(5_000);
    const player = await sample(page, [".playback-controls", ".dialog-box", ".speaker", ".dialog-text", ".continue-indicator"]);
    const playerSafe = safeBounds(player);
    for (const selector of [".playback-controls", ".dialog-box"]) assert(player.values[selector].every((rect) => inside(rect, playerSafe)), `${selector} escaped Android safe bounds`, { playerSafe, rects: player.values[selector], inline: await page.locator(selector).evaluateAll((elements) => elements.map((element) => ({ style: element.getAttribute("style"), source: element.getAttribute("data-ui-layout-source"), breakpoint: element.closest(".ui-skin-scope")?.getAttribute("data-ui-breakpoint") }))) });
    const speaker = player.values[".speaker"][0], text = player.values[".dialog-text"][0], indicator = player.values[".continue-indicator"][0];
    assert(!speaker || overlap(speaker, text) < 2, "speaker overlaps dialog text", { speaker, text });
    assert(!indicator || overlap(indicator, text) < 2, "continue indicator overlaps dialog text", { indicator, text });
    const overflow = await page.locator(".dialog-text").evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY }));
    assert(overflow.scrollHeight <= overflow.clientHeight + 1 || ["auto", "scroll"].includes(overflow.overflowY), "long dialog is clipped without scrolling", overflow);
    // In the collapsed state the playback surface intentionally keeps its
    // secondary buttons mounted but hidden/non-interactive.  They are not
    // required visible controls until the real quick-menu toggle is opened;
    // measuring every descendant here incorrectly turns that intentional
    // state into VISUAL_CONTROL_HIDDEN.
    visibleControls.playing = await inspectVisibleControls(page, '[data-testid="quick-menu-toggle"]');
    assertVisibleControls(visibleControls.playing, "playing");
    screenshots.playing = await capturePng(page, "playing.png");
    const reportedPlayingResume = await exercisePlayingResumeRecovery(page, { width: 1280, height: 720 }, "reported-playing-1280x720");
    screenshots.playingAfterResume = await capturePng(page, "playing-after-resume.png");
    await page.locator('[data-testid="quick-menu-toggle"]').click();
    await page.waitForSelector(".quick-menu-surface.is-expanded");
    await page.waitForTimeout(520);
    visibleControls.quickMenu = await inspectVisibleControls(page, ".quick-menu-surface.is-expanded button");
    assertVisibleControls(visibleControls.quickMenu, "quick-menu");
    screenshots.quickMenu = await capturePng(page, "quick-menu.png");

    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: "no-preference",
    });
    const desktopPage = await desktopContext.newPage();
    await desktopPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await desktopPage.evaluate(
      (serialized) => window.postMessage(JSON.parse(serialized), "*"),
      JSON.stringify({
        ...initMessage,
        sessionId: "desktop-slider-session",
        requestId: "desktop-slider-init",
        runId: "desktop-slider-run",
        start: { ...initMessage.start, requestId: "desktop-slider-start" },
      }),
    );
    await desktopPage.waitForSelector('[data-testid="start-new-game"]', { timeout: 20_000 });
    await desktopPage.waitForFunction(() => !document.querySelector(".game-launch-blackout"), null, { timeout: 8_000 });
    const desktopViewportResume = await exerciseTitleResumeRecovery(desktopPage, { width: 1440, height: 900 }, "desktop-1440x900");
    await desktopPage.locator('[data-testid="start-new-game"]').click();
    await desktopPage.waitForSelector(".dialog-box .dialog-text");
    const desktopPlayingResume = await exercisePlayingResumeRecovery(desktopPage, { width: 1440, height: 900 }, "desktop-playing-1440x900");
    await desktopPage.evaluate(() => window.postMessage({ type: "agentvn.runtime.screen", screen: "title_menu" }, "*"));
    await desktopPage.waitForSelector('[data-testid="start-new-game"]');
    await desktopPage.locator('[data-testid="open-settings"]').click();
    await desktopPage.waitForSelector(".settings-renpy");
    await desktopPage.locator(".settings-tabs button").nth(2).click();
    const desktopSliderInput = desktopPage.locator('input[aria-label="Background music volume"]');
    await desktopSliderInput.waitFor();
    const desktopSliderWidths = await desktopPage.locator(".settings-slider-track").evaluateAll((tracks) =>
      tracks.map((track) => track.getBoundingClientRect().width),
    );
    assert(
      desktopSliderWidths.length >= 4
        && desktopSliderWidths.slice(1).every((width) => width >= desktopSliderWidths[0] * 0.72),
      "desktop audio channel sliders must retain most of the master slider width",
      desktopSliderWidths,
    );
    const desktopAudioPairing = await desktopPage.locator(".settings-audio-row").evaluateAll((rows) => rows.map((row) => {
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
      };
      const label = row.querySelector(":scope > span:first-child");
      const slider = row.querySelector(".settings-slider");
      const check = row.querySelector(".settings-check");
      return {
        label: label ? rect(label) : null,
        slider: slider ? rect(slider) : null,
        check: check ? rect(check) : null,
      };
    }));
    for (const pair of desktopAudioPairing) {
      if (pair.label && pair.slider) assert(overlap(pair.label, pair.slider) < 2, "desktop audio label overlaps slider", pair);
      if (pair.check && pair.slider) assert(overlap(pair.check, pair.slider) < 2, "desktop audio mute control overlaps slider", pair);
    }
    const sampleDesktopSlider = () => desktopSliderInput.evaluate((input) => {
      const slider = input.closest(".settings-slider");
      const track = slider?.querySelector(".settings-slider-track");
      const fill = slider?.querySelector(".settings-slider-fill");
      if (!(slider instanceof HTMLElement) || !(track instanceof HTMLElement) || !(fill instanceof HTMLElement)) {
        throw new Error("desktop slider fixture is incomplete");
      }
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return { left: value.left, top: value.top, width: value.width, height: value.height };
      };
      const sliderStyle = getComputedStyle(slider);
      const trackStyle = getComputedStyle(track);
      const inputStyle = getComputedStyle(input);
      const bubbleStyle = getComputedStyle(slider, "::after");
      return {
        sliderRect: rect(slider),
        trackRect: rect(track),
        fillRect: rect(fill),
        sliderBorderWidth: sliderStyle.borderWidth,
        sliderBoxShadow: sliderStyle.boxShadow,
        sliderOutline: sliderStyle.outlineStyle,
        sliderTransform: sliderStyle.transform,
        inputOutline: inputStyle.outlineStyle,
        inputBoxShadow: inputStyle.boxShadow,
        trackOpacity: Number(trackStyle.opacity),
        trackBoxShadow: trackStyle.boxShadow,
        bubbleOpacity: Number(bubbleStyle.opacity),
        bubbleTransform: bubbleStyle.transform,
        focusVisible: input.matches(":focus-visible"),
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      };
    });

    const desktopIdle = await sampleDesktopSlider();
    assert(
      desktopIdle.trackRect.height >= 10
        && desktopIdle.sliderBorderWidth === "0px"
        && desktopIdle.sliderBoxShadow === "none"
        && desktopIdle.sliderOutline === "none"
        && desktopIdle.sliderTransform === "none",
      "desktop slider idle geometry or frame is invalid",
      desktopIdle,
    );
    await desktopSliderInput.hover();
    await desktopPage.waitForTimeout(180);
    const desktopHovered = await sampleDesktopSlider();
    assert(
      sameRect(desktopIdle.sliderRect, desktopHovered.sliderRect)
        && sameRect(desktopIdle.trackRect, desktopHovered.trackRect)
        && desktopHovered.sliderBorderWidth === "0px"
        && desktopHovered.sliderBoxShadow === "none"
        && desktopHovered.sliderTransform === "none"
        && desktopHovered.trackOpacity >= desktopIdle.trackOpacity,
      "desktop slider hover must be paint-only",
      { desktopIdle, desktopHovered },
    );
    const desktopBox = await desktopSliderInput.boundingBox();
    assert(desktopBox, "desktop slider input has no bounding box");
    await desktopPage.mouse.move(desktopBox.x + desktopBox.width * 0.64, desktopBox.y + desktopBox.height / 2);
    await desktopPage.mouse.down();
    await desktopPage.waitForTimeout(540);
    const desktopActive = await sampleDesktopSlider();
    assert(
      sameRect(desktopHovered.sliderRect, desktopActive.sliderRect)
        && Math.abs(desktopHovered.trackRect.width - desktopActive.trackRect.width) < 0.2
        && sameCenterY(desktopHovered.trackRect, desktopActive.trackRect)
        && Math.abs(desktopActive.trackRect.height - desktopHovered.trackRect.height * 1.22) < 0.25
        && desktopActive.bubbleOpacity > 0.95,
      "desktop drag must slowly enlarge the track and show the transient percentage",
      { desktopHovered, desktopActive },
    );
    await desktopPage.mouse.up();
    await desktopPage.waitForTimeout(420);
    const desktopSettled = await sampleDesktopSlider();
    assert(
      sameRect(desktopHovered.trackRect, desktopSettled.trackRect) && desktopSettled.bubbleOpacity < 0.05,
      "desktop release must restore idle thickness and hide the percentage bubble",
      { desktopHovered, desktopSettled },
    );
    await desktopSliderInput.focus();
    await desktopPage.keyboard.press("Tab");
    await desktopPage.keyboard.press("Shift+Tab");
    const desktopFocused = await sampleDesktopSlider();
    assert(
      desktopFocused.focusVisible
        && desktopFocused.inputOutline === "none"
        && desktopFocused.inputBoxShadow === "none"
        && desktopFocused.trackBoxShadow !== desktopIdle.trackBoxShadow,
      "desktop keyboard focus must follow the capsule instead of drawing an input rectangle",
      { desktopIdle, desktopFocused },
    );
    await desktopPage.emulateMedia({ reducedMotion: "reduce" });
    await desktopPage.waitForTimeout(120);
    await desktopPage.keyboard.press("ArrowRight");
    await desktopPage.waitForTimeout(40);
    const desktopReduced = await sampleDesktopSlider();
    assert(
      desktopReduced.reducedMotion
        && desktopReduced.bubbleOpacity > 0.2
        && desktopReduced.bubbleTransform === "none"
        && Math.abs(desktopReduced.trackRect.height - desktopIdle.trackRect.height) < 0.2,
      "desktop reduced-motion feedback must keep opacity while removing bubble and track movement",
      desktopReduced,
    );
    screenshots.desktopSettingsAudio = await capturePng(desktopPage, "desktop-settings-audio.png");
    await desktopContext.close();

    const report = {
      schemaVersion: 1,
      functionalStatus: "PASS",
      visualStatus: "PASS",
      runtimeStatus: "PASS",
      status: "PASS",
      failureCode: null,
      viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
      screenshots,
      visibleControls,
      overlaps: [],
      outOfBounds: [],
      occludedControls: [],
      hiddenRequiredControls: [],
      title,
      titleButtonFit,
      titleIconScale,
      oversizedRoot,
      optionsExitVisual,
      compactTitleButtonFit,
      lockResume: {
        reportedViewport: reportedViewportResume,
        compactViewport: compactViewportResume,
        desktopViewport: desktopViewportResume,
        reportedPlaying: reportedPlayingResume,
        compactPlaying: compactPlayingResume,
        desktopPlaying: desktopPlayingResume,
      },
      titleLayering,
      settings,
      audioRows,
      desktopAudioPairing,
      desktopSliderWidths,
      desktopSlider: {
        idle: desktopIdle,
        hovered: desktopHovered,
        active: desktopActive,
        settled: desktopSettled,
        focused: desktopFocused,
        reduced: desktopReduced,
      },
      player,
      overflow,
    };
    fs.writeFileSync(path.join(outDir, "runtime-visual-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await browser.close();
    console.log(`Android GameCLI layout acceptance passed: ${outDir}`);
  } finally {
    if (vite) {
      try { execFileSync("taskkill.exe", ["/PID", String(vite.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { vite.kill(); }
    }
    fs.writeFileSync(path.join(outDir, "vite.log"), viteLog);
  }
})().catch((error) => { console.error(error); process.exit(1); });
