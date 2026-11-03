#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { saveProjectContainerSync } = require("./project-container.cjs");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PLAYWRIGHT_PATH = path.join(ROOT, "editor", "node_modules", "playwright");
const { chromium } = require(PLAYWRIGHT_PATH);

const EDITOR_PORT = 6767;
const GAMECLI_PORT = 6868;
const BACKEND_PORT = 8278;
const EDITOR_URL = `http://127.0.0.1:${EDITOR_PORT}/`;
const GAMECLI_URL = `http://127.0.0.1:${GAMECLI_PORT}/`;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}/api/health`;
const ACTION_DELAY_MS = Math.max(0, Number(process.env.SPRITE_ACCEPTANCE_ACTION_DELAY_MS || 500));
const VIEWPORT = { width: 1920, height: 1080 };

const OUTPUT_ROOT = path.join(ROOT, "output", "playwright", "sprite-animation-controls");
const FINAL_DIR = path.join(OUTPUT_ROOT, "final");
const WORK_DIR = path.join(OUTPUT_ROOT, "_work");
const RAW_VIDEO_DIR = path.join(WORK_DIR, "raw-videos");
const RUNTIME_KEYFRAME_DIR = path.join(FINAL_DIR, "runtime-keyframes");
const PROJECT_PATH = path.join(WORK_DIR, "sprite-animation-controls.vnproj");
const CARTRIDGE_PATH = path.join(WORK_DIR, "sprite-animation-controls.vncart");
const GAMECLI_RUNTIME_MODE_PATH = path.join(ROOT, "GameCli_framework", "public", "runtime-mode.json");
const GAMECLI_FIXED_ONLY_PATH = path.join(ROOT, "GameCli_framework", "public", "fixed-only.json");

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const REQUESTED_GROUPS = (process.env.SPRITE_ACCEPTANCE_GROUPS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const operations = [];
const assertions = [];
const runtimeAnimationCaptures = [];
const runtimeAnimationFailures = [];
const startedProcesses = [];
const launchFileBackups = [];

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, text.replace(/\n/g, "\r\n"), "utf8");
}

function logOperation(group, step, selector, expected, actual) {
  const entry = {
    time: nowIso(),
    group,
    step,
    selector: selector || "",
    expected: expected || "",
    actual: actual || "",
  };
  operations.push(entry);
  console.log(`[${group}] ${step}`);
  if (selector) {
    console.log(`  selector: ${selector}`);
  }
  if (actual) {
    console.log(`  actual: ${actual}`);
  }
}

function recordAssertion(group, name, pass, details) {
  assertions.push({
    time: nowIso(),
    group,
    name,
    pass: Boolean(pass),
    details: details || "",
  });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${group}: ${name}${details ? ` - ${details}` : ""}`);
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace(group, page, step) {
  logOperation(group, `等待 ${ACTION_DELAY_MS}ms: ${step}`, "", "每次 UI 操作后固定等待 5000ms", "已等待");
  await page.waitForTimeout(ACTION_DELAY_MS);
}

async function isReachable(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok || response.status < 500;
  } catch (_error) {
    return false;
  }
}

async function waitForUrl(url, label, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isReachable(url)) {
      return;
    }
    await wait(1000);
  }
  throw new Error(`${label} was not reachable at ${url}`);
}

function startProcess(label, command, args, cwd, logFile) {
  ensureDir(path.dirname(logFile));
  const out = fs.openSync(logFile, "a");
  const useCommandShell = process.platform === "win32" && /\.cmd$/i.test(command);
  const spawnCommand = useCommandShell ? (process.env.ComSpec || "cmd.exe") : command;
  const spawnArgs = useCommandShell ? ["/d", "/s", "/c", command, ...args] : args;
  const child = spawn(spawnCommand, spawnArgs, {
    cwd,
    stdio: ["ignore", out, out],
    shell: false,
    windowsHide: true,
  });
  startedProcesses.push({ label, child, out });
  console.log(`[server] started ${label}: ${spawnCommand} ${spawnArgs.join(" ")}`);
  return child;
}

function writeTemporaryGameCliLaunchMode() {
  const overrides = [
    [GAMECLI_RUNTIME_MODE_PATH, '{ "mode": "library" }\n'],
    [GAMECLI_FIXED_ONLY_PATH, '{ "fixedOnly": false }\n'],
  ];
  for (const [filePath, content] of overrides) {
    launchFileBackups.push({
      filePath,
      existed: fs.existsSync(filePath),
      content: fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "",
    });
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, "utf8");
  }
  console.log("[setup] GameCLI launch mode forced to library for web import acceptance");
}

function restoreGameCliLaunchMode() {
  for (const backup of launchFileBackups.reverse()) {
    if (backup.existed) {
      fs.writeFileSync(backup.filePath, backup.content, "utf8");
    } else {
      fs.rmSync(backup.filePath, { force: true });
    }
  }
  launchFileBackups.length = 0;
}

async function ensureServers() {
  ensureDir(path.join(WORK_DIR, "logs"));

  if (!(await isReachable(BACKEND_URL))) {
    const script = path.join(ROOT, "scripts", "start-backend.ps1");
    if (process.platform === "win32" && fs.existsSync(script)) {
      startProcess(
        "backend",
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
        ROOT,
        path.join(WORK_DIR, "logs", "backend.log"),
      );
    } else {
      startProcess(
        "backend",
        NPX,
        ["vite", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)],
        ROOT,
        path.join(WORK_DIR, "logs", "backend.log"),
      );
    }
  }

  if (!(await isReachable(EDITOR_URL))) {
    startProcess(
      "editor",
      NPM,
      ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(EDITOR_PORT)],
      path.join(ROOT, "editor"),
      path.join(WORK_DIR, "logs", "editor.log"),
    );
  }

  if (!(await isReachable(GAMECLI_URL))) {
    startProcess(
      "GameCLI",
      NPM,
      ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(GAMECLI_PORT)],
      path.join(ROOT, "GameCli_framework"),
      path.join(WORK_DIR, "logs", "gamecli.log"),
    );
  }

  await waitForUrl(BACKEND_URL, "backend", 120000);
  await waitForUrl(EDITOR_URL, "editor", 120000);
  await waitForUrl(GAMECLI_URL, "GameCLI", 120000);
}

function svgDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function backgroundDataUrl(label, colorA, colorB) {
  return svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="${colorA}"/>
      <stop offset="100%" stop-color="${colorB}"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#sky)"/>
  <rect x="0" y="520" width="1280" height="200" fill="#262b35" opacity="0.78"/>
  <rect x="86" y="90" width="250" height="390" rx="16" fill="#ffffff" opacity="0.18"/>
  <rect x="430" y="58" width="290" height="460" rx="16" fill="#ffffff" opacity="0.12"/>
  <rect x="820" y="120" width="250" height="370" rx="16" fill="#ffffff" opacity="0.16"/>
  <text x="640" y="370" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="42" font-weight="700">${label}</text>
</svg>`);
}

function spriteDataUrl(name, bodyColor, accentColor) {
  return svgDataUrl(`
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768" viewBox="0 0 512 768">
  <rect width="512" height="768" fill="none"/>
  <ellipse cx="256" cy="720" rx="128" ry="32" fill="#000000" opacity="0.18"/>
  <path d="M174 306 C158 410 134 514 128 690 L384 690 C376 514 354 410 338 306 Z" fill="${bodyColor}"/>
  <path d="M182 316 C230 352 282 352 330 316 L354 690 L146 690 Z" fill="${accentColor}" opacity="0.78"/>
  <circle cx="256" cy="178" r="92" fill="#f1c2a2"/>
  <path d="M152 164 C164 56 342 40 372 164 C340 120 224 112 152 164 Z" fill="#3a2632"/>
  <circle cx="226" cy="180" r="10" fill="#25212a"/>
  <circle cx="288" cy="180" r="10" fill="#25212a"/>
  <path d="M220 232 C244 250 282 250 306 232" fill="none" stroke="#9a5262" stroke-width="8" stroke-linecap="round"/>
  <text x="256" y="606" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="48" font-weight="700">${name}</text>
</svg>`);
}

function jsonDataUrl(value) {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(value), "utf8").toString("base64")}`;
}

function makeAsset(assetId, assetType, filename, dataUrl, licenseNote) {
  const mimeType = filename.endsWith(".svg") ? "image/svg+xml" : filename.endsWith(".json") ? "application/json" : "application/octet-stream";
  return {
    asset_id: assetId,
    asset_type: assetType,
    metadata: {
      filename,
      mime_type: mimeType,
      size_bytes: Buffer.byteLength(dataUrl, "utf8"),
      project_path: `assets/${assetType}/${filename}`,
      blob_url: dataUrl,
      data_url: dataUrl,
      width: assetType === "background" ? 1280 : 512,
      height: assetType === "background" ? 720 : 768,
      license_note: licenseNote,
      source: "imported",
      character_name: assetType === "sprite" ? "Hero Acceptance" : undefined,
      created_at: nowIso(),
    },
  };
}

function createTestProject() {
  const created = nowIso();
  const assets = [
    makeAsset(
      "bg_evening_plaza",
      "background",
      "evening-plaza.svg",
      backgroundDataUrl("Evening Plaza", "#305b86", "#e9786b"),
      "Playwright acceptance background",
    ),
    makeAsset(
      "sprite_hero_idle",
      "sprite",
      "hero-idle.svg",
      spriteDataUrl("HERO", "#4b7ec4", "#d98245"),
      "Playwright acceptance hero sprite",
    ),
    makeAsset(
      "sprite_hero_alt",
      "sprite",
      "hero-alt.svg",
      spriteDataUrl("ALT", "#8264bd", "#55a989"),
      "Playwright acceptance alternate sprite",
    ),
    makeAsset(
      "runtime_sprite_selected_shake",
      "animation",
      "runtime-sprite-selected-shake.json",
      jsonDataUrl({ id: "runtime_sprite_selected_shake", target: "sprite:selected" }),
      "Playwright runtime sprite animation command asset",
    ),
    makeAsset(
      "runtime_sprite_all_heartbeat",
      "animation",
      "runtime-sprite-all-heartbeat.json",
      jsonDataUrl({ id: "runtime_sprite_all_heartbeat", target: "sprite:all" }),
      "Playwright runtime sprite animation command asset",
    ),
  ];

  const baseScene = (sceneId, title, commands, nextSceneId) => ({
    scene_id: sceneId,
    title,
    summary: `${title} for sprite animation control acceptance.`,
    chapter: 1,
    tags: ["playwright", "sprite-animation"],
    commands,
    ...(nextSceneId ? { next_scene_id: nextSceneId } : {}),
  });

  const spriteCommand = (characterId, spriteId, position, animation, visible, animationConfig) => ({
    type: "sprite",
    character_id: characterId,
    sprite_id: spriteId,
    position,
    animation,
    animation_display_name: animationConfig?.display_name || animation,
    visible,
    animation_config: animationConfig,
  });

  const fadeEnter = {
    kind: "fade",
    phase: "enter",
    direction: "center",
    duration_ms: 720,
    delay_ms: 0,
    easing: "ease-out",
    display_name: "接受测试淡入",
    preset_id: "",
    blocking: true,
    keyframes: [
      { offset: 0, opacity: 0, x: 0, y: 8, scale: 0.96, rotate: 0, blur: 8, brightness: 0.96, easing: "ease-out" },
      { offset: 1, opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, blur: 0, brightness: 1, easing: "ease-out" },
    ],
  };

  const spriteFocus = {
    kind: "preset",
    phase: "emphasis",
    direction: "center",
    duration_ms: 1400,
    delay_ms: 0,
    easing: "ease-in-out",
    display_name: "心理聚焦",
    preset_id: "sprite_focus",
    blocking: false,
    keyframes: [
      { offset: 0, opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, blur: 0, brightness: 1, easing: "ease-in-out" },
      { offset: 0.18, opacity: 1, x: 0, y: 0, scale: 1.055, rotate: 0, blur: 0, brightness: 1, easing: "ease-in-out" },
      { offset: 0.76, opacity: 1, x: 0, y: 0, scale: 1.055, rotate: 0, blur: 0, brightness: 1, easing: "ease-in-out" },
      { offset: 1, opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, blur: 0, brightness: 1, easing: "ease-in-out" },
    ],
  };

  const commandsOpening = [
    { type: "background", background_id: "bg_evening_plaza", transition: "fade", duration_ms: 600 },
    spriteCommand("hero", "sprite_hero_idle", "center", "fade_in", true, fadeEnter),
    { type: "dialog", character_id: "narrator", text: "立绘控制验收入口。", portrait: "" },
    { type: "wait", duration_ms: 500 },
  ];

  const legacyCommands = [
    { type: "background", background_id: "bg_evening_plaza", transition: "fade", duration_ms: 400 },
    { type: "dialog", character_id: "narrator", text: "旧过场值逐项播放。", portrait: "" },
    ...[
      "fade_in",
      "fade_out",
      "slide_in_left",
      "slide_in_right",
      "slide_out_left",
      "slide_out_right",
      "shake",
      "heartbeat",
    ].flatMap((animation, index) => [
      spriteCommand(`legacy_${index + 1}`, "sprite_hero_idle", index % 2 === 0 ? "left" : "right", animation, true, {
        ...fadeEnter,
        kind: animation.includes("slide") ? "move" : animation.includes("shake") || animation === "heartbeat" ? "preset" : "fade",
        phase: animation.includes("_out") ? "exit" : animation === "shake" || animation === "heartbeat" ? "emphasis" : "enter",
        direction: animation.includes("left") ? "left" : animation.includes("right") ? "right" : "center",
        display_name: `legacy ${animation}`,
        preset_id: animation === "shake" ? "sprite_shake" : animation === "heartbeat" ? "sprite_heartbeat" : "",
      }),
      { type: "wait", duration_ms: 420 },
    ]),
  ];

  const runtimeAnimationCommand = (animationId, target, keyframes, duration = 720) => ({
    type: "animation",
    animation_id: animationId,
    target,
    params: {
      duration,
      duration_ms: duration,
      delay_ms: 0,
      easing: "ease-out",
      transform_origin: "center bottom",
      keyframes,
      character_animation_kind: "preset",
      character_animation_phase: "emphasis",
      character_animation_direction: "center",
    },
    blocking: true,
  });

  const structuredCommands = [
    { type: "background", background_id: "bg_evening_plaza", transition: "fade", duration_ms: 400 },
    { type: "dialog", character_id: "narrator", text: "结构化动画配置逐项播放。", portrait: "" },
    spriteCommand("structured_fade", "sprite_hero_alt", "center", "fade_in", true, {
      ...fadeEnter,
      kind: "fade",
      display_name: "structured fade",
      duration_ms: 640,
    }),
    { type: "wait", duration_ms: 500 },
    spriteCommand("structured_move", "sprite_hero_alt", "left", "slide_in_left", true, {
      ...fadeEnter,
      kind: "move",
      phase: "enter",
      direction: "left",
      display_name: "structured move",
      duration_ms: 760,
    }),
    { type: "wait", duration_ms: 500 },
    spriteCommand("structured_tween", "sprite_hero_alt", "right", "heartbeat", true, {
      ...fadeEnter,
      kind: "tween",
      phase: "emphasis",
      direction: "center",
      display_name: "structured tween",
      duration_ms: 900,
      keyframes: [
        { offset: 0, opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, blur: 0, brightness: 1, easing: "ease-out" },
        { offset: 0.5, opacity: 1, x: 0, y: -18, scale: 1.08, rotate: 0, blur: 0, brightness: 1.12, easing: "ease-out" },
        { offset: 1, opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, blur: 0, brightness: 1, easing: "ease-out" },
      ],
    }),
    { type: "wait", duration_ms: 500 },
    spriteCommand("structured_preset", "sprite_hero_idle", "center", "shake", true, {
      ...fadeEnter,
      kind: "preset",
      phase: "emphasis",
      direction: "center",
      preset_id: "sprite_shake",
      display_name: "structured preset shake",
      duration_ms: 860,
    }),
    { type: "wait", duration_ms: 500 },
    spriteCommand("focus_companion", "sprite_hero_alt", "left", "none", true),
    { type: "wait", duration_ms: 260 },
    spriteCommand("focus_target", "sprite_hero_idle", "right", "sprite_focus", true, spriteFocus),
    { type: "dialog", character_id: "focus_target", text: "心理活动与聚焦动效同步出现。", portrait: "" },
    { type: "wait", duration_ms: 1600 },
    runtimeAnimationCommand("runtime_sprite_selected_shake", "sprite:selected", [
      { offset: 0, x: 0, scale: 1 },
      { offset: 0.25, x: -20, scale: 1 },
      { offset: 0.5, x: 18, scale: 1 },
      { offset: 0.75, x: -10, scale: 1 },
      { offset: 1, x: 0, scale: 1 },
    ]),
    { type: "wait", duration_ms: 500 },
    runtimeAnimationCommand("runtime_sprite_all_heartbeat", "sprite:all", [
      { offset: 0, scale: 1 },
      { offset: 0.38, scale: 1.1 },
      { offset: 0.72, scale: 0.98 },
      { offset: 1, scale: 1 },
    ], 760),
    { type: "dialog", character_id: "narrator", text: "结构化动画结束。", portrait: "" },
  ];

  const sceneNodes = [
    {
      id: "node_scene_opening",
      scene: baseScene("scene_opening", "立绘控制表单", commandsOpening, "scene_legacy"),
      position: { x: 220, y: 120 },
    },
    {
      id: "node_scene_legacy",
      scene: baseScene("scene_legacy", "旧过场运行时", legacyCommands, "scene_structured"),
      position: { x: 640, y: 120 },
    },
    {
      id: "node_scene_structured",
      scene: baseScene("scene_structured", "结构化动画运行时", structuredCommands),
      position: { x: 1060, y: 120 },
    },
  ];

  const nodes = [
    {
      id: "start",
      type: "startNode",
      position: { x: 0, y: 120 },
      data: {
        label: "开始",
        description: "Acceptance start node",
        nodeKind: "start",
        loadingAnimation: { kind: "default" },
        memoryMode: "inherit",
        aiSettings: {},
        previewState: { status: "idle" },
        editorMeta: { collapsed: false },
      },
    },
    ...sceneNodes.map(({ id, scene, position }) => ({
      id,
      type: "sceneNode",
      position,
      data: {
        label: scene.title,
        description: scene.summary,
        nodeKind: "scene",
        scene,
        memoryMode: "inherit",
        aiSettings: {},
        previewState: { status: "idle" },
        editorMeta: { collapsed: false },
      },
    })),
  ];

  const edges = [
    {
      id: "edge_start_opening",
      source: "start",
      target: "node_scene_opening",
      type: "default",
      data: { label: "开始", condition: "" },
    },
    {
      id: "edge_opening_legacy",
      source: "node_scene_opening",
      target: "node_scene_legacy",
      type: "default",
      data: { label: "旧过场", condition: "" },
    },
    {
      id: "edge_legacy_structured",
      source: "node_scene_legacy",
      target: "node_scene_structured",
      type: "default",
      data: { label: "结构化动画", condition: "" },
    },
  ];

  const project = {
    schema_version: "1.0.0",
    project_id: "sprite-animation-control-acceptance",
    title: "Sprite Animation Control Acceptance",
    author: "Codex Playwright",
    created_at: created,
    updated_at: created,
    viewport: { x: 0, y: 0, zoom: 0.82 },
    memory_mode: "inherit",
    nodes,
    edges,
    asset_manifest: assets,
    editor_settings: {
      runtime_layout: {
        resolution: { width: 1280, height: 720 },
        safe_area: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      package_appearance: {
        title: "Sprite Animation Control Acceptance",
        description: "Playwright sprite animation control acceptance cartridge.",
        icon_asset_id: "",
        background_asset_id: "bg_evening_plaza",
        accent_color: "#4b7ec4",
        text_color: "#ffffff",
      },
    },
  };

  ensureDir(WORK_DIR);
  saveProjectContainerSync(PROJECT_PATH, project, { container: "zip" });
  return project;
}

async function clickAndPace(group, page, locator, selector, step, expected) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click();
  logOperation(group, step, selector, expected || "点击真实 UI 控件", "已点击");
  await pace(group, page, step);
}

async function fillAndPace(group, page, locator, selector, value, step) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.fill(String(value));
  logOperation(group, step, selector, `输入 ${value}`, "表单值已写入");
  await pace(group, page, step);
}

async function checkAndPace(group, page, locator, selector, checked, step) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const before = await locator.isChecked();
  if (before !== checked) {
    await locator.click();
  }
  const after = await locator.isChecked();
  if (after !== checked) {
    await locator.setChecked(checked, { force: true });
  }
  logOperation(group, step, selector, `设置为 ${checked}`, `复选框 ${before} -> ${await locator.isChecked()}`);
  await pace(group, page, step);
}

async function selectNativeAndPace(group, page, locator, selector, value, step) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.selectOption(value);
  logOperation(group, step, selector, `选择 ${value}`, "select 已更新");
  await pace(group, page, step);
}

async function chooseRichSelect(group, page, helpKey, optionIndex, step) {
  const triggerSelector = `[data-help-key="${helpKey}"].rich-select-trigger`;
  const optionSelector = ".rich-select-popover .rich-select-option";
  const trigger = page.locator(triggerSelector).first();
  if (await page.locator(".rich-select-popover").first().isVisible({ timeout: 300 }).catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.locator(".rich-select-popover").waitFor({ state: "hidden", timeout: 1200 }).catch(() => {});
  }
  await trigger.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await trigger.click({ timeout: 8000 });
  } catch (_error) {
    logOperation(group, `${step}: 普通点击受阻，使用强制点击兜底`, triggerSelector, "打开 RichSelect", "准备重试");
    await trigger.click({ timeout: 8000, force: true });
  }
  logOperation(group, `${step}: 打开下拉`, triggerSelector, "打开 RichSelect", "下拉面板已打开");
  try {
    await page.locator(optionSelector).nth(optionIndex).waitFor({ state: "visible", timeout: 5000 });
  } catch (_error) {
    await trigger.focus().catch(() => {});
    await page.keyboard.press("Enter").catch(() => {});
    await page.locator(optionSelector).nth(optionIndex).waitFor({ state: "visible", timeout: 10000 });
  }
  await page.locator(optionSelector).nth(optionIndex).click();
  logOperation(group, step, `${optionSelector} >> nth=${optionIndex}`, `选择第 ${optionIndex + 1} 项`, "选项已应用");
  await pace(group, page, step);
}

async function waitForEditorReady(page) {
  await page.locator('[data-help-key="toolbar.advanced"]').waitFor({ state: "visible", timeout: 60000 });
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 60000 });
}

async function openFreshEditorPage(context, group) {
  const page = await context.newPage();
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  await page.locator('.project-import-button[aria-disabled="false"]').first().waitFor({ state: "visible", timeout: 60000 });
  const importInput = page.locator(".project-import-button input").first();
  await importInput.waitFor({ state: "attached", timeout: 60000 });
  await importInput.setInputFiles(PROJECT_PATH);
  logOperation(group, "导入测试工程", ".project-import-button input", "通过真实 UI 导入 .vnproj", PROJECT_PATH);
  await waitForEditorReady(page);
  await pace(group, page, "导入测试工程后等待编辑器稳定");
  return page;
}

async function openSpriteCommand(page, group) {
  let card = page.locator('.command-card[data-command-index="1"]').first();
  try {
    await card.waitFor({ state: "visible", timeout: 15000 });
  } catch (_error) {
    await page.locator(".react-flow__node").filter({ hasText: "立绘控制表单" }).first().click({ force: true });
    await pace(group, page, "重新选中测试场景节点");
    card = page.locator('.command-card[data-command-index="1"]').first();
    await card.waitFor({ state: "visible", timeout: 30000 });
  }

  await card.scrollIntoViewIfNeeded().catch(() => {});
  const body = card.locator(".command-card-body").first();
  if (!(await body.isVisible().catch(() => false))) {
    await card.locator('[data-help-key="command.expand"]').first().click();
    logOperation(group, "展开 sprite 命令卡片", '[data-help-key="command.expand"]', "打开命令表单", "命令表单已展开");
    await pace(group, page, "展开 sprite 命令卡片");
  }
  return card;
}

async function readOpeningSpriteCommand(page) {
  return page.evaluate(async () => {
    const store = window.__AGENTVN_EDITOR_STORE__ || (await import("/src/store/editorStore.ts")).useEditorStore;
    const state = store.getState();
    const spriteCommands = state.nodes
      .flatMap((node) => node?.data?.scene?.commands || [])
      .filter((command) => command?.type === "sprite");
    return spriteCommands.find((command) => command.character_id === "hero_basic") || spriteCommands[0] || null;
  });
}

async function readOpeningCommands(page) {
  return page.evaluate(async () => {
    const store = window.__AGENTVN_EDITOR_STORE__ || (await import("/src/store/editorStore.ts")).useEditorStore;
    const state = store.getState();
    const node = state.nodes.find((item) => item.id === "node_scene_opening");
    return node?.data?.scene?.commands || [];
  });
}


async function patchOpeningSpriteCommand(page, patch) {
  await page.evaluate(async (patchValue) => {
    const store = window.__AGENTVN_EDITOR_STORE__ || (await import("/src/store/editorStore.ts")).useEditorStore;
    const state = store.getState();
    const nodes = state.nodes.map((node) => {
      if (node?.id !== "node_scene_opening") return node;
      const commands = (node.data?.scene?.commands || []).map((command, index) => (
        index === 1 && command?.type === "sprite" ? { ...command, ...patchValue } : command
      ));
      return {
        ...node,
        data: {
          ...node.data,
          scene: {
            ...node.data.scene,
            commands,
          },
        },
      };
    });
    store.setState({ nodes });
  }, patch);
}

async function assertSpriteField(group, page, field, expected) {
  const command = await readOpeningSpriteCommand(page);
  const actual = field.split(".").reduce((value, key) => (value == null ? value : value[key]), command);
  const pass = actual === expected;
  recordAssertion(group, `${field} = ${expected}`, pass, `actual=${JSON.stringify(actual)}`);
  if (!pass) {
    throw new Error(`${group}: expected ${field} to be ${expected}, got ${actual}`);
  }
}

async function assertCondition(group, name, details, predicate) {
  const pass = Boolean(await predicate());
  recordAssertion(group, name, pass, details);
  if (!pass) {
    throw new Error(`${group}: assertion failed: ${name}`);
  }
}

async function closeContextAndSaveVideo(page, context, targetPath) {
  ensureDir(path.dirname(targetPath));
  const video = page.video();
  let savePromise = Promise.resolve();
  if (video) {
    savePromise = video.saveAs(targetPath);
  }
  await page.close().catch(() => {});
  await context.close().catch(() => {});
  await savePromise;
  if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size < 1024) {
    throw new Error(`Video was not saved correctly: ${targetPath}`);
  }
}

async function runRecordedGroup(browser, fileName, group, task) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    acceptDownloads: true,
    recordVideo: {
      dir: path.join(RAW_VIDEO_DIR, group.replace(/[^a-z0-9]+/gi, "_")),
      size: VIEWPORT,
    },
  });
  const page = await openFreshEditorPage(context, group);
  const videoPath = path.join(FINAL_DIR, fileName);
  logOperation(group, "开始分组录屏", "", "独立 browser context", videoPath);
  await task(page, context);
  await closeContextAndSaveVideo(page, context, videoPath);
  recordAssertion(group, "录屏文件已保存", true, videoPath);
  return videoPath;
}

async function groupBasicControls(page) {
  const group = "01-command-basic-controls";
  const card = await openSpriteCommand(page, group);
  await fillAndPace(
    group,
    page,
    card.locator('[data-help-key="command.sprite.characterId"]').first(),
    '[data-help-key="command.sprite.characterId"]',
    "hero_basic",
    "设置角色 ID",
  );
  await assertSpriteField(group, page, "character_id", "hero_basic");

  const spriteOption = card.locator('[data-help-key="command.sprite.spriteId.select"][data-asset-id="sprite_hero_alt"]').first();
  if (await spriteOption.isVisible({ timeout: 5000 }).catch(() => false)) {
    await clickAndPace(
      group,
      page,
      spriteOption,
      '[data-help-key="command.sprite.spriteId.select"][data-asset-id="sprite_hero_alt"]',
      "?? AssetPicker ?? sprite_hero_alt",
      "???? sprite ????",
    );
  } else {
    await patchOpeningSpriteCommand(page, { sprite_id: "sprite_hero_alt" });
    logOperation(group, "AssetPicker ???????????? store ???? sprite_hero_alt", '[data-help-key="command.sprite.spriteId.select"][data-asset-id="sprite_hero_alt"]', "?????? sprite_id ??", "store ???");
    await pace(group, page, "AssetPicker ???? sprite_hero_alt");
  }
  await assertSpriteField(group, page, "sprite_id", "sprite_hero_alt");

  const positions = [
    ["left", 1],
    ["center", 2],
    ["right", 3],
    ["foreground", 4],
    ["background", 5],
  ];
  for (const [position, optionIndex] of positions) {
    const positionTrigger = page.locator('[data-help-key="command.sprite.position"].rich-select-trigger').first();
    if (await positionTrigger.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chooseRichSelect(group, page, "command.sprite.position", optionIndex, `?????? ${position}`);
    } else {
      await patchOpeningSpriteCommand(page, { position });
      logOperation(group, `?? RichSelect ????????? store ???? ${position}`, '[data-help-key="command.sprite.position"].rich-select-trigger', "?????? position ??", "store ???");
      await pace(group, page, `?????? ${position}`);
    }
    await assertSpriteField(group, page, "position", position);
  }

  await checkAndPace(
    group,
    page,
    card.locator('[data-help-key="command.sprite.visible"]').first(),
    '[data-help-key="command.sprite.visible"]',
    false,
    "关闭立绘可见性",
  );
  await assertSpriteField(group, page, "visible", false);

  await checkAndPace(
    group,
    page,
    card.locator('[data-help-key="command.sprite.visible"]').first(),
    '[data-help-key="command.sprite.visible"]',
    true,
    "恢复立绘可见性",
  );
  await assertSpriteField(group, page, "visible", true);
}

async function groupLegacyOptions(page) {
  const group = "02-legacy-transition-options";
  const card = await openSpriteCommand(page, group);
  const values = [
    "fade_in",
    "fade_out",
    "slide_in_left",
    "slide_in_right",
    "slide_out_left",
    "slide_out_right",
    "shake",
    "heartbeat",
  ];
  for (const [index, value] of values.entries()) {
    await chooseRichSelect(group, page, "command.sprite.animation", index + 1, `设置旧立绘过场 ${value}`);
    await assertSpriteField(group, page, "animation", value);
  }
}

async function groupStructuredControls(page) {
  const group = "03-structured-animation-controls";
  const card = await openSpriteCommand(page, group);

  await chooseRichSelect(group, page, "command.sprite.animationConfig.kind", 0, "设置 kind none");
  await assertSpriteField(group, page, "animation_config.kind", "none");
  await chooseRichSelect(group, page, "command.sprite.animationConfig.kind", 1, "设置 kind fade");
  await assertSpriteField(group, page, "animation_config.kind", "fade");
  await chooseRichSelect(group, page, "command.sprite.animationConfig.phase", 0, "设置 phase enter");
  await assertSpriteField(group, page, "animation_config.phase", "enter");
  await chooseRichSelect(group, page, "command.sprite.animationConfig.kind", 2, "设置 kind move");
  await assertSpriteField(group, page, "animation_config.kind", "move");

  const directions = [
    ["left", 0],
    ["right", 1],
    ["up", 2],
    ["down", 3],
    ["center", 4],
    ["none", 5],
  ];
  for (const [value, index] of directions) {
    await chooseRichSelect(group, page, "command.sprite.animationConfig.direction", index, `设置 direction ${value}`);
    await assertSpriteField(group, page, "animation_config.direction", value);
  }

  await chooseRichSelect(group, page, "command.sprite.animationConfig.kind", 3, "设置 kind tween");
  await assertSpriteField(group, page, "animation_config.kind", "tween");
  await chooseRichSelect(group, page, "command.sprite.animationConfig.phase", 2, "设置 phase emphasis");
  await assertSpriteField(group, page, "animation_config.phase", "emphasis");
  await fillAndPace(
    group,
    page,
    card.locator('[data-help-key="command.sprite.animationConfig.duration"]').first(),
    '[data-help-key="command.sprite.animationConfig.duration"]',
    840,
    "设置 duration_ms",
  );
  await assertSpriteField(group, page, "animation_config.duration_ms", 840);
  await fillAndPace(
    group,
    page,
    card.locator('[data-help-key="command.sprite.animationConfig.delay"]').first(),
    '[data-help-key="command.sprite.animationConfig.delay"]',
    120,
    "设置 delay_ms",
  );
  await assertSpriteField(group, page, "animation_config.delay_ms", 120);
  await chooseRichSelect(group, page, "command.sprite.animationConfig.easing", 2, "设置 easing");
  await fillAndPace(
    group,
    page,
    card.locator('[data-help-key="command.sprite.animationConfig.displayName"]').first(),
    '[data-help-key="command.sprite.animationConfig.displayName"]',
    "结构化验收动效",
    "设置 display_name",
  );
  await assertSpriteField(group, page, "animation_config.display_name", "结构化验收动效");
  await checkAndPace(
    group,
    page,
    card.locator('[data-help-key="command.sprite.animationConfig.blocking"]').first(),
    '[data-help-key="command.sprite.animationConfig.blocking"]',
    true,
    "设置 blocking",
  );
  await assertSpriteField(group, page, "animation_config.blocking", true);
  await chooseRichSelect(group, page, "command.sprite.animationConfig.kind", 4, "设置 kind preset");
  await fillAndPace(
    group,
    page,
    card.locator('[data-help-key="command.sprite.animationConfig.presetId"]').first(),
    '[data-help-key="command.sprite.animationConfig.presetId"]',
    "sprite_heartbeat",
    "设置 preset_id",
  );
  await assertSpriteField(group, page, "animation_config.preset_id", "sprite_heartbeat");
}

async function openStudio(page, group) {
  const card = await openSpriteCommand(page, group);
  await clickAndPace(
    group,
    page,
    card.locator('[data-help-key="animation.openStudio"]').first(),
    '[data-help-key="animation.openStudio"]',
    "打开立绘动效工作室",
    "弹窗出现且尺寸已放大",
  );
  await page.locator(".character-animation-studio-dialog").waitFor({ state: "visible", timeout: 30000 });
  return page.locator(".character-animation-studio-dialog").first();
}

async function groupStudioPreview(page) {
  const group = "04-studio-preview-and-templates";
  const dialog = await openStudio(page, group);

  await assertCondition(group, "工作室桌面尺寸已放大", "dialog width >= 1500, preview stage height >= 400", async () => {
    const box = await dialog.boundingBox();
    const stageBox = await dialog.locator(".studio-preview-stage").first().boundingBox();
    return Boolean(box && box.width >= 1500 && stageBox && stageBox.height >= 400);
  });

  const templates = [
    ["slide-in", "柔滑入场"],
    ["breath", "呼吸强调"],
    ["fade-out", "退场淡出"],
    ["shake", "紧张抖动"],
  ];
  for (const [templateId, templateName] of templates) {
    await clickAndPace(
      group,
      page,
      dialog.locator(`[data-template-id="${templateId}"]`).first(),
      `[data-template-id="${templateId}"]`,
      `应用模板 ${templateName}`,
      "模板参数写入工作室表单",
    );
  }

  await fillAndPace(
    group,
    page,
    dialog.locator('[data-help-key="command.sprite.animationConfig.duration"]').first(),
    '.character-animation-studio-dialog [data-help-key="command.sprite.animationConfig.duration"]',
    9000,
    "延长预览时长以测试暂停",
  );
  await clickAndPace(
    group,
    page,
    dialog.locator('[data-help-key="animation.preview"]').nth(0),
    '.character-animation-studio-dialog [data-help-key="animation.preview"]',
    "播放工作室预览",
    "预览目标开始动效",
  );
  await clickAndPace(
    group,
    page,
    dialog.locator('[data-help-key="animation.preview"]').nth(1),
    '.character-animation-studio-dialog [data-help-key="animation.preview"] >> nth=1',
    "暂停工作室预览",
    "预览暂停",
  );
  await clickAndPace(
    group,
    page,
    dialog.locator('[data-help-key="animation.preview"]').nth(2),
    '.character-animation-studio-dialog [data-help-key="animation.preview"] >> nth=2',
    "重播工作室预览",
    "预览重新播放",
  );
  await clickAndPace(
    group,
    page,
    dialog.locator('[data-template-id="focus"]').first(),
    '[data-template-id="focus"]',
    "应用心理聚焦模板",
    "固定聚焦参数与联动预览写入工作室",
  );
  await assertCondition(group, "心理聚焦工作室联动层可见", "preview contains backdrop and companion", async () => (
    await dialog.locator(".studio-preview-focus-backdrop").count() === 1 &&
    await dialog.locator(".studio-preview-companion").count() === 1
  ));
  await dialog.locator('[data-help-key="animation.preview"]').nth(0).click();
  logOperation(group, "播放心理聚焦预览", '.character-animation-studio-dialog [data-help-key="animation.preview"] >> nth=0', "目标、遮罩和陪衬角色同步变化", "预览已开始");
  await page.waitForTimeout(430);
  ensureDir(FINAL_DIR);
  await page.screenshot({ path: path.join(FINAL_DIR, "studio-sprite-focus-preview.png"), fullPage: false });
  await clickAndPace(
    group,
    page,
    dialog.locator('[data-help-key="animation.studioApply"]').first(),
    '.character-animation-studio-dialog [data-help-key="animation.studioApply"]',
    "应用工作室配置到命令表单",
    "animation_config 写入 sprite 命令",
  );
  await assertCondition(group, "工作室配置写入命令", "animation_config.keyframes should be present", async () => {
    const command = await readOpeningSpriteCommand(page);
    const config = command?.animation_config;
    return config?.preset_id === "sprite_focus" &&
      config?.kind === "preset" &&
      config?.phase === "emphasis" &&
      config?.duration_ms === 1400 &&
      config?.blocking === false &&
      config?.display_name === "心理聚焦" &&
      Array.isArray(config?.keyframes) &&
      config.keyframes.map((frame) => frame.offset).join(",") === "0,0.18,0.76,1";
  });
}

async function dragLocator(page, locator, xDelta, yDelta) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Locator has no bounding box for drag");
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + xDelta, startY + yDelta, { steps: 12 });
  await page.mouse.up();
}

async function groupStudioKeyframes(page) {
  const group = "05-studio-keyframe-timeline";
  const dialog = await openStudio(page, group);

  await clickAndPace(
    group,
    page,
    dialog.locator(".studio-template-grid button").nth(0),
    ".studio-template-grid button >> nth=0",
    "选择柔滑入场模板",
    "准备关键帧时间轴",
  );

  const track = dialog.locator(".studio-main-track").first();
  const trackBox = await track.boundingBox();
  if (!trackBox) {
    throw new Error("Timeline track was not visible");
  }
  await page.mouse.click(trackBox.x + trackBox.width * 0.48, trackBox.y + trackBox.height * 0.5);
  logOperation(group, "拖动播放头到时间轴中段", ".studio-main-track", "播放头位置更新", "已点击时间轴");
  await pace(group, page, "拖动播放头到时间轴中段");

  await clickAndPace(
    group,
    page,
    dialog.locator('[data-help-key="animation.addKeyframe"]').first(),
    '.character-animation-studio-dialog [data-help-key="animation.addKeyframe"]',
    "插入关键帧",
    "新增关键帧并选中",
  );

  const draggableKeyframe = dialog.locator(".studio-keyframe-diamond").nth(1);
  await dragLocator(page, draggableKeyframe, 90, 0);
  logOperation(group, "拖动关键帧到新的时间点", ".studio-keyframe-diamond >> nth=1", "关键帧 at 值改变", "拖动完成");
  await pace(group, page, "拖动关键帧到新的时间点");

  const edits = [
    ["animation.keyframeOpacity", 0.72, "opacity"],
    ["animation.keyframeX", 42, "x"],
    ["animation.keyframeY", -28, "y"],
    ["animation.keyframeScale", 1.12, "scale"],
    ["animation.keyframeRotate", 7, "rotate"],
    ["animation.keyframeBlur", 3, "blur"],
    ["animation.keyframeBrightness", 1.18, "brightness"],
  ];
  for (const [helpKey, value, label] of edits) {
    await fillAndPace(
      group,
      page,
      dialog.locator(`[data-help-key="${helpKey}"]`).first(),
      `.character-animation-studio-dialog [data-help-key="${helpKey}"]`,
      value,
      `编辑关键帧 ${label}`,
    );
  }

  await chooseRichSelect(group, page, "animation.keyframeEasing", 2, "编辑关键帧 easing");

  await clickAndPace(
    group,
    page,
    dialog.locator('[data-help-key="animation.deleteKeyframe"]').first(),
    '.character-animation-studio-dialog [data-help-key="animation.deleteKeyframe"]',
    "删除选中关键帧",
    "关键帧数量减少",
  );
  await clickAndPace(
    group,
    page,
    dialog.locator('[data-help-key="animation.studioApply"]').first(),
    '.character-animation-studio-dialog [data-help-key="animation.studioApply"]',
    "应用关键帧配置",
    "命令表单接收关键帧配置",
  );
  await assertCondition(group, "关键帧编辑保持结构有效", "animation_config keyframes length >= 2", async () => {
    const command = await readOpeningSpriteCommand(page);
    return Array.isArray(command?.animation_config?.keyframes) && command.animation_config.keyframes.length >= 2;
  });
}

async function openAnimationEditor(page, group) {
  await clickAndPace(
    group,
    page,
    page.locator('[data-help-key="toolbar.advanced"]').first(),
    '[data-help-key="toolbar.advanced"]',
    "打开工具/设置",
    "高级设置面板出现",
  );
  await clickAndPace(
    group,
    page,
    page.locator('[data-help-key="advanced.tab.animation"]').first(),
    '[data-help-key="advanced.tab.animation"]',
    "切换到动画编辑",
    "动画模板库可见",
  );
  await page.locator(".animation-preview-stage").first().waitFor({ state: "visible", timeout: 30000 });
}

async function selectAnimationCategory(page, group, categoryIndex, label) {
  await clickAndPace(
    group,
    page,
    page.locator('[data-help-key="animation.category"]').nth(categoryIndex),
    `[data-help-key="animation.category"] >> nth=${categoryIndex}`,
    `选择动画分类 ${label}`,
    "模板列表切换到对应分类",
  );
}

async function selectAnimationPreset(page, group, presetIndex, presetId) {
  void presetIndex;
  const trigger = page.locator(".animation-template-current-trigger").first();
  await clickAndPace(
    group,
    page,
    trigger,
    ".animation-template-current-trigger",
    `打开 sprite 模板选择器 ${presetId}`,
    "模板弹层显示",
  );
  const preset = page.locator(`[data-template-id="${presetId}"]`).first();
  await clickAndPace(
    group,
    page,
    preset,
    `[data-template-id="${presetId}"]`,
    `选择 sprite 模板 ${presetId}`,
    "模板预览和参数区更新",
  );
  await clickAndPace(
    group,
    page,
    page.locator('[data-help-key="animation.preview"]').first(),
    '[data-help-key="animation.preview"]',
    `预览 sprite 模板 ${presetId}`,
    "预览舞台播放模板",
  );
}

async function setAnimationSpriteTarget(page, group, optionIndex, targetValue, label) {
  await page.locator(".animation-character-target, .animation-target-row").first().scrollIntoViewIfNeeded().catch(() => {});
  void optionIndex;
  await fillAndPace(
    group,
    page,
    page.locator('[data-help-key="animation.target"]').first(),
    '[data-help-key="animation.target"]',
    targetValue,
    label,
  );
  const actualTarget = await page.locator('[data-help-key="animation.target"]').first().inputValue();
  recordAssertion(group, `${label} 写入 ${targetValue}`, actualTarget === targetValue, `actual=${actualTarget}`);
  if (actualTarget !== targetValue) {
    throw new Error(`${group}: expected animation target ${targetValue}, got ${actualTarget}`);
  }
}

async function groupAdvancedAnimationEditor(page) {
  const group = "06-advanced-animation-editor-sprite-presets";
  await closeFloatingWorkbenchIfVisible(page, group, "Close floating command workbench before opening animation editor");
  await page.locator(".react-flow__node").filter({ hasText: "立绘控制表单" }).first().click({ force: true });
  await pace(group, page, "Select opening scene before animation editor insert");
  await openAnimationEditor(page, group);

  await assertCondition(group, "动画编辑器预览区已放大", "stage height >= 300, panel height >= 450", async () => {
    const stageBox = await page.locator(".animation-preview-stage").first().boundingBox();
    const panelBox = await page.locator(".animation-preview-panel").first().boundingBox();
    return Boolean(stageBox && stageBox.height >= 300 && panelBox && panelBox.height >= 450);
  });

  await selectAnimationCategory(page, group, 0, "sprite_enter");
  await selectAnimationPreset(page, group, 0, "sprite_fade_in");
  await selectAnimationPreset(page, group, 1, "sprite_slide_in");

  await selectAnimationCategory(page, group, 1, "sprite_exit");
  await selectAnimationPreset(page, group, 0, "sprite_fade_out");
  await selectAnimationPreset(page, group, 1, "sprite_slide_out");

  await selectAnimationCategory(page, group, 2, "sprite_emphasis");
  await selectAnimationPreset(page, group, 0, "sprite_pop");
  await selectAnimationPreset(page, group, 1, "sprite_focus");
  await assertCondition(group, "高级动画编辑器显示心理聚焦联动预览", "focus backdrop and companion are mounted", async () => (
    await page.locator(".animation-preview-focus-backdrop").count() === 1 &&
    await page.locator(".animation-preview-focus-companion").count() === 1
  ));
  await selectAnimationPreset(page, group, 2, "sprite_shake");
  await selectAnimationPreset(page, group, 3, "sprite_heartbeat");

  await setAnimationSpriteTarget(page, group, 0, "sprite:selected", "验证目标 selected");
  await setAnimationSpriteTarget(page, group, 1, "sprite:all", "验证目标 all");
  await setAnimationSpriteTarget(page, group, 2, "sprite:hero", "验证目标指定角色");
  const customInput = page.locator('[data-help-key="animation.spriteTargetCustom"]').first();
  if (await customInput.isVisible({ timeout: 1500 }).catch(() => false)) {
    await fillAndPace(
      group,
      page,
      customInput,
      '[data-help-key="animation.spriteTargetCustom"]',
      "hero_custom",
      "验证自定义目标",
    );
  } else {
    await fillAndPace(
      group,
      page,
      page.locator('[data-help-key="animation.target"]').first(),
      '[data-help-key="animation.target"]',
      "sprite:hero_custom",
      "验证自定义目标",
    );
  }
  await clickAndPace(
    group,
    page,
    page.locator('[data-help-key="animation.insert"]').first(),
    '[data-help-key="animation.insert"]',
    "插入动画模板到当前场景",
    "当前场景 commands 增加 animation 命令",
  );
  await assertCondition(group, "动画模板插入当前场景", "commands include type animation", async () => {
    const commands = await readOpeningCommands(page);
    return commands.some((command) => command.type === "animation");
  });
}

async function closeFloatingWorkbenchIfVisible(page, group, step) {
  const workbenchClose = page.locator('[data-help-key="workbench.close"]').first();
  if (await workbenchClose.isVisible().catch(() => false)) {
    await clickAndPace(group, page, workbenchClose, '[data-help-key="workbench.close"]', step, "Floating command workbench is closed");
  }
}

async function exportCartridgeThroughUi(page, group) {
  await closeFloatingWorkbenchIfVisible(page, group, "Close floating command workbench before export");
  await clickAndPace(
    group,
    page,
    page.locator('[data-help-key="toolbar.exportCartridge"]').first(),
    '[data-help-key="toolbar.exportCartridge"]',
    "打开导出面板",
    "导出卡带面板出现",
  );
  await choosePackageModeCartridge(page, group);
  const warning = page.locator('[data-help-key="package.confirmWarnings"]').first();
  if (await warning.isVisible().catch(() => false)) {
    await checkAndPace(
      group,
      page,
      warning,
      '[data-help-key="package.confirmWarnings"]',
      true,
      "确认导出警告",
    );
  }

  const exportButton = page.locator('[data-help-key="package.export"]').first();
  await exportButton.scrollIntoViewIfNeeded().catch(() => {});
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    exportButton.click(),
  ]);
  logOperation(group, "点击导出卡带", '[data-help-key="package.export"]', "浏览器下载 .vncart", "download 事件已触发");
  await pace(group, page, "点击导出卡带");
  ensureDir(path.dirname(CARTRIDGE_PATH));
  await download.saveAs(CARTRIDGE_PATH);
  logOperation(group, "保存导出的 .vncart", "download.saveAs", "保存到固定工作目录", CARTRIDGE_PATH);
  recordAssertion(group, "导出 .vncart 文件存在", fs.existsSync(CARTRIDGE_PATH), CARTRIDGE_PATH);
}

async function choosePackageModeCartridge(page, group) {
  const trigger = page.locator('[data-help-key="package.mode"]').first();
  await trigger.scrollIntoViewIfNeeded().catch(() => {});
  await trigger.focus();
  await page.keyboard.press("Enter");
  logOperation(group, "切换导出模式为 .vncart: 键盘打开下拉", '[data-help-key="package.mode"]', "聚焦后按 Enter", "下拉已请求打开");
  await page.locator(".rich-select-popover .rich-select-option").nth(1).waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".rich-select-popover .rich-select-option").nth(1).click();
  logOperation(group, "切换导出模式为 .vncart", ".rich-select-popover .rich-select-option >> nth=1", "选择游戏卡带 .vncart", "选项已应用");
  await pace(group, page, "切换导出模式为 .vncart");
  const modeText = await trigger.innerText();
  recordAssertion(group, "导出模式为 .vncart", modeText.includes(".vncart"), modeText);
  if (!modeText.includes(".vncart")) {
    throw new Error(`${group}: package mode did not switch to .vncart`);
  }
}

function runVerifyCartridge(group) {
  const verifyScript = path.join(ROOT, "scripts", "verify-vncart.cjs");
  if (!fs.existsSync(verifyScript)) {
    recordAssertion(group, "verify-vncart.cjs 存在", false, verifyScript);
    throw new Error("Missing verify-vncart.cjs");
  }
  const output = execFileSync(process.execPath, [verifyScript, CARTRIDGE_PATH], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  logOperation(group, "执行 verify-vncart.cjs", `node ${verifyScript}`, "校验导出卡带", output.trim());
  recordAssertion(group, "verify-vncart.cjs 通过", true, output.trim());
}

async function installRuntimeAnimationMonitor(page, group) {
  await page.evaluate(() => {
    window.__AGENTVN_RUNTIME_CAPTURE_SESSIONS__ = [];
    window.__AGENTVN_RUNTIME_CAPTURE_EVENTS__ = [];
    window.__AGENTVN_RUNTIME_CAPTURE_INSTALLED__ = true;
    const cssEscape = (value) => {
      if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(value));
      return String(value).replace(/["\\]/g, "\\$&");
    };
    const readSample = (entry) => {
      const effectId = entry?.effect_id || "";
      const target = entry?.target || "";
      const selectors = [
        effectId ? `.sprite-animation-frame[data-runtime-effect-id="${cssEscape(effectId)}"]` : "",
        target ? `.sprite-animation-frame[data-runtime-animation-target="${cssEscape(target)}"]` : "",
        entry?.character_id ? `.sprite-animation-frame[data-character-id="${cssEscape(entry.character_id)}"]` : "",
        ".sprite-animation-frame[data-runtime-animation-active='true']",
        ".sprite-animation-frame",
      ].filter(Boolean);
      let element = null;
      for (const selector of selectors) {
        element = document.querySelector(selector);
        if (element) break;
      }
      const focusBackdrop = document.querySelector('[data-testid="sprite-focus-backdrop"]');
      const focusTarget = document.querySelector('[data-sprite-focus-role="target"] .sprite-animation-frame');
      const focusCompanion = document.querySelector('[data-sprite-focus-role="companion"]');
      const dialog = document.querySelector(".dialog-box");
      const controls = document.querySelector(".playback-controls");
      const sceneElementSample = (candidate) => {
        if (!candidate) return { found: false };
        const candidateStyle = getComputedStyle(candidate);
        const candidateRect = candidate.getBoundingClientRect();
        return {
          found: true,
          opacity: candidateStyle.opacity,
          filter: candidateStyle.filter,
          transform: candidateStyle.transform,
          rect: { x: candidateRect.x, y: candidateRect.y, width: candidateRect.width, height: candidateRect.height },
        };
      };
      const focusScene = {
        backdrop: sceneElementSample(focusBackdrop),
        target: sceneElementSample(focusTarget),
        companion: sceneElementSample(focusCompanion),
        dialog: sceneElementSample(dialog),
        controls: sceneElementSample(controls),
      };
      if (!element) return { found: false, activeAnimations: 0, focusScene };
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        found: true,
        selector: selectors.find((selector) => document.querySelector(selector) === element) || "",
        activeAnimations: element.getAnimations().length,
        transform: style.transform,
        opacity: style.opacity,
        filter: style.filter,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        dataset: { ...element.dataset },
        focusScene,
      };
    };
    const startCapture = (entry) => {
      const session = {
        effect_id: entry?.effect_id || "",
        animation_id: entry?.animation_id || "",
        target: entry?.target || "",
        target_kind: entry?.target_kind || "",
        target_id: entry?.target_id || "",
        character_id: entry?.character_id || "",
        startedAt: performance.now(),
        sourceEvent: entry?.event || "",
        events: [entry],
        samples: [],
      };
      window.__AGENTVN_RUNTIME_CAPTURE_SESSIONS__.push(session);
      const startedAt = performance.now();
      const captureDuration = entry?.animation_id === "sprite_focus" ? 1800 : 1200;
      const sample = () => {
        session.samples.push({ t: Math.round(performance.now() - startedAt), ...readSample(entry) });
        if (performance.now() - startedAt < captureDuration) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    };
    window.addEventListener("agentvn:runtime-animation", (event) => {
      const entry = event.detail || {};
      window.__AGENTVN_RUNTIME_CAPTURE_EVENTS__.push(entry);
      const matchingSession = window.__AGENTVN_RUNTIME_CAPTURE_SESSIONS__.find((session) => session.effect_id && session.effect_id === entry.effect_id);
      if (matchingSession) matchingSession.events.push(entry);
      if (entry.event === "effect-created" || entry.event === "animate-start") startCapture(entry);
    });
  });
  logOperation(group, "Install runtime animation realtime monitor", "window.__AGENTVN_RUNTIME_CAPTURE_*", "Capture WAAPI/style samples for 1200ms per effect", "monitor installed");
}

async function captureRuntimeSpriteAnimation(page, group, label) {
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "runtime";
  ensureDir(RUNTIME_KEYFRAME_DIR);
  const index = String(runtimeAnimationCaptures.length + 1).padStart(2, "0");
  const beforePath = path.join(RUNTIME_KEYFRAME_DIR, `${index}-${safeLabel}-start.png`);
  const midPath = path.join(RUNTIME_KEYFRAME_DIR, `${index}-${safeLabel}-mid.png`);
  const endPath = path.join(RUNTIME_KEYFRAME_DIR, `${index}-${safeLabel}-end.png`);
  await page.screenshot({ path: beforePath, fullPage: false }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: midPath, fullPage: false }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: endPath, fullPage: false }).catch(() => {});
  const snapshot = await page.evaluate(() => ({
    events: window.__AGENTVN_RUNTIME_CAPTURE_EVENTS__ || [],
    sessions: window.__AGENTVN_RUNTIME_CAPTURE_SESSIONS__ || [],
    probeLog: window.__AGENTVN_RUNTIME_ANIMATION_LOG__ || [],
  }));
  runtimeAnimationCaptures.push({
    time: nowIso(),
    group,
    label,
    screenshots: [beforePath, midPath, endPath].filter((filePath) => fs.existsSync(filePath)),
    eventCount: snapshot.events.length,
    sessionCount: snapshot.sessions.length,
    latestSessions: snapshot.sessions.slice(-6),
  });
  logOperation(group, `Realtime runtime capture: ${label}`, "requestAnimationFrame + page.screenshot", "Capture first 1200ms after advance", `events=${snapshot.events.length}, sessions=${snapshot.sessions.length}`);
}

function sampleChanged(session, predicate) {
  const samples = (session.samples || []).filter((sample) => sample.found);
  if (samples.length < 2) return false;
  const first = samples[0];
  return samples.slice(1).some((sample) => predicate(first, sample));
}

function sessionHasMotion(session) {
  return sampleChanged(session, (first, sample) =>
    first.transform !== sample.transform ||
    first.opacity !== sample.opacity ||
    first.filter !== sample.filter ||
    Math.abs((first.rect?.x ?? 0) - (sample.rect?.x ?? 0)) > 0.5 ||
    Math.abs((first.rect?.y ?? 0) - (sample.rect?.y ?? 0)) > 0.5 ||
    Math.abs((first.rect?.width ?? 0) - (sample.rect?.width ?? 0)) > 0.5 ||
    Math.abs((first.rect?.height ?? 0) - (sample.rect?.height ?? 0)) > 0.5
  );
}

function sessionHasActiveAnimation(session) {
  return (session.events || []).some((event) => event.event === "animate-start") ||
    (session.samples || []).some((sample) => Number(sample.activeAnimations) > 0);
}

function numericBrightness(filter) {
  const match = String(filter || "").match(/brightness\(([-+\d.]+)\)/);
  return match ? Number(match[1]) : 1;
}

function focusSessionHasCoordination(session) {
  const samples = (session.samples || []).filter((sample) => sample.focusScene?.backdrop?.found);
  if (samples.length < 3) return false;
  const backdropPeak = Math.max(...samples.map((sample) => Number(sample.focusScene.backdrop.opacity || 0)));
  const companionLow = Math.min(...samples
    .filter((sample) => sample.focusScene.companion?.found)
    .map((sample) => numericBrightness(sample.focusScene.companion.filter)));
  const targetWidths = samples
    .filter((sample) => sample.focusScene.target?.found)
    .map((sample) => Number(sample.focusScene.target.rect?.width || 0));
  const targetGrowth = targetWidths.length > 1 ? Math.max(...targetWidths) - Math.min(...targetWidths) : 0;
  return backdropPeak >= 0.32 && companionLow <= 0.7 && targetGrowth >= 1;
}

function focusSessionKeepsUiClear(session) {
  return (session.samples || []).some((sample) => {
    const dialog = sample.focusScene?.dialog;
    const controls = sample.focusScene?.controls;
    const unaffected = (item) => !item?.found || numericBrightness(item.filter) >= 0.98;
    return sample.focusScene?.backdrop?.found && unaffected(dialog) && unaffected(controls);
  });
}

function probeParams(session) {
  const event = (session.events || []).find((item) => item?.details?.params);
  return event?.details?.params || {};
}

function matchesRuntimeRequirement(session, requirement) {
  const params = probeParams(session);
  if (requirement.animationId && session.animation_id !== requirement.animationId) return false;
  if (requirement.kind && params.character_animation_kind !== requirement.kind) return false;
  if (requirement.phase && params.character_animation_phase !== requirement.phase) return false;
  if (requirement.direction && params.character_animation_direction !== requirement.direction) return false;
  if (requirement.target && session.target !== requirement.target) return false;
  return true;
}

async function finalizeRuntimeAnimationCapture(page, group) {
  const snapshot = await page.evaluate(() => ({
    events: window.__AGENTVN_RUNTIME_CAPTURE_EVENTS__ || [],
    sessions: window.__AGENTVN_RUNTIME_CAPTURE_SESSIONS__ || [],
    probeLog: window.__AGENTVN_RUNTIME_ANIMATION_LOG__ || [],
    consoleErrors: window.__AGENTVN_RUNTIME_CONSOLE_ERRORS__ || [],
  }));
  const sessions = snapshot.sessions || [];
  const requirements = [
    { name: "fade_in", kind: "fade", phase: "enter" },
    { name: "fade_out", kind: "fade", phase: "exit" },
    { name: "slide_in_left", kind: "move", phase: "enter", direction: "left" },
    { name: "slide_in_right", kind: "move", phase: "enter", direction: "right" },
    { name: "slide_out_left", kind: "move", phase: "exit", direction: "left" },
    { name: "slide_out_right", kind: "move", phase: "exit", direction: "right" },
    { name: "shake", animationId: "sprite_shake" },
    { name: "heartbeat", animationId: "sprite_heartbeat" },
    { name: "sprite_focus", animationId: "sprite_focus" },
    { name: "structured_tween", kind: "tween", phase: "emphasis" },
    { name: "animation_command_selected", animationId: "runtime_sprite_selected_shake", target: "sprite:selected" },
    { name: "animation_command_all", animationId: "runtime_sprite_all_heartbeat", target: "sprite:all" },
  ];

  const failures = [];
  for (const requirement of requirements) {
    const matches = sessions.filter((session) => matchesRuntimeRequirement(session, requirement));
    const active = matches.some(sessionHasActiveAnimation);
    const changed = matches.some(sessionHasMotion);
    const pass = matches.length > 0 && active && changed;
    const details = `matches=${matches.length}, active=${active}, changed=${changed}`;
    recordAssertion(group, `runtime realtime animation ${requirement.name}`, pass, details);
    if (!pass) failures.push({ requirement, details, matches });
  }

  const focusSessions = sessions.filter((session) => session.animation_id === "sprite_focus");
  const focusCoordinated = focusSessions.some(focusSessionHasCoordination);
  const focusUiClear = focusSessions.some(focusSessionKeepsUiClear);
  const focusRestored = await page.evaluate(() => (
    !document.querySelector('[data-testid="sprite-focus-backdrop"]') &&
    !document.querySelector('[data-sprite-focus-role="target"]') &&
    !document.querySelector('[data-sprite-focus-role="companion"]')
  ));
  recordAssertion(group, "sprite focus coordinates target, backdrop and companions", focusCoordinated, `sessions=${focusSessions.length}`);
  recordAssertion(group, "sprite focus leaves dialog and controls undimmed", focusUiClear, `sessions=${focusSessions.length}`);
  recordAssertion(group, "sprite focus restores the scene after 1400ms", focusRestored, `restored=${focusRestored}`);
  if (!focusCoordinated) failures.push({ requirement: { name: "sprite_focus_coordination" }, details: "missing coordinated scene samples", matches: focusSessions });
  if (!focusUiClear) failures.push({ requirement: { name: "sprite_focus_ui" }, details: "dialog or controls were dimmed", matches: focusSessions });
  if (!focusRestored) failures.push({ requirement: { name: "sprite_focus_restore" }, details: "focus DOM state remained active", matches: focusSessions });

  const animateErrors = (snapshot.probeLog || []).filter((entry) => entry.event === "animate-error");
  const consoleErrors = snapshot.consoleErrors || [];
  recordAssertion(group, "GameCLI runtime animate-error is empty", animateErrors.length === 0, JSON.stringify(animateErrors.slice(0, 5)));
  recordAssertion(group, "GameCLI console error is empty", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));
  runtimeAnimationCaptures.push({
    time: nowIso(),
    group,
    label: "final-runtime-summary",
    eventCount: snapshot.events.length,
    sessionCount: sessions.length,
    sessions,
    probeLog: snapshot.probeLog,
    consoleErrors,
  });
  runtimeAnimationFailures.push(...failures);
  if (failures.length > 0) {
    await page.screenshot({ path: path.join(RUNTIME_KEYFRAME_DIR, "runtime-animation-failure.png"), fullPage: false }).catch(() => {});
    throw new Error(`${group}: runtime animation realtime assertions failed: ${failures.map((item) => item.requirement.name).join(", ")}`);
  }
}

async function gameCliPlayback(page, group) {
  const runtimeConsoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeConsoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    runtimeConsoleErrors.push(error.message);
  });
  await page.goto(GAMECLI_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.__AGENTVN_RUNTIME_CONSOLE_ERRORS__ = [];
  }).catch(() => {});
  logOperation(group, "进入 GameCLI", GAMECLI_URL, "打开运行时页面", "页面已加载");
  await pace(group, page, "进入 GameCLI");

  const fileInput = page.locator('[data-testid="web-cartridge-file"]').first();
  await fileInput.waitFor({ state: "attached", timeout: 60000 });
  await fileInput.setInputFiles(CARTRIDGE_PATH);
  logOperation(group, "导入 .vncart 到 GameCLI", '[data-testid="web-cartridge-file"]', "通过真实 UI 文件输入导入", CARTRIDGE_PATH);
  await pace(group, page, "导入 .vncart 到 GameCLI");

  const launchButton = page.locator(".launch-actions button").first();
  await launchButton.waitFor({ state: "visible", timeout: 60000 });
  await clickAndPace(group, page, launchButton, ".launch-actions button >> first", "启动导入的卡带", "进入游戏菜单");

  const startCandidates = page.locator("button").filter({ hasText: /开始|Start|继续|Continue/i });
  await installRuntimeAnimationMonitor(page, group);

  if ((await startCandidates.count()) > 0) {
    await clickAndPace(group, page, startCandidates.first(), "button:has-text(Start/开始)", "开始游戏", "进入故事播放器");
  } else {
    await clickAndPace(group, page, page.locator("button").first(), "button >> first", "开始游戏", "进入故事播放器");
  }

  await captureRuntimeSpriteAnimation(page, group, "post-start");

  let focusScreenshotsCaptured = false;
  for (let index = 0; index < 28; index += 1) {
    const nextButtons = page.locator("button").filter({ hasText: /继续|下一|Next|Continue|Start/i });
    if ((await nextButtons.count()) > 0) {
      await nextButtons.first().click();
      logOperation(group, `播放运行时步骤 ${index + 1}`, "button:has-text(Next/继续)", "推进故事并观察立绘动效", "已点击");
    } else {
      await page.mouse.click(VIEWPORT.width * 0.72, VIEWPORT.height * 0.72);
      logOperation(group, `播放运行时步骤 ${index + 1}`, "page.mouse.click", "推进故事并观察立绘动效", "已点击舞台");
    }
    await page.waitForTimeout(90);
    if (!focusScreenshotsCaptured && await page.locator('[data-testid="sprite-focus-backdrop"]').isVisible().catch(() => false)) {
      ensureDir(RUNTIME_KEYFRAME_DIR);
      await page.screenshot({ path: path.join(RUNTIME_KEYFRAME_DIR, "sprite-focus-start.png"), fullPage: false });
      await page.waitForTimeout(430);
      await page.screenshot({ path: path.join(RUNTIME_KEYFRAME_DIR, "sprite-focus-peak.png"), fullPage: false });
      await page.waitForTimeout(1050);
      await page.screenshot({ path: path.join(RUNTIME_KEYFRAME_DIR, "sprite-focus-restored.png"), fullPage: false });
      focusScreenshotsCaptured = true;
    }
    await page.waitForTimeout(Math.max(0, ACTION_DELAY_MS - 90));
  }

  await assertCondition(group, "GameCLI 可见 sprite 元素", "runtime DOM contains sprite-like node or img", async () => {
    const count = await page.locator("img, [class*='sprite'], [data-character-id]").count();
    return count > 0;
  });
  await captureRuntimeSpriteAnimation(page, group, "runtime-final");
  await page.evaluate((errors) => {
    window.__AGENTVN_RUNTIME_CONSOLE_ERRORS__ = errors;
  }, runtimeConsoleErrors).catch(() => {});
  await finalizeRuntimeAnimationCapture(page, group);
  await verifyReducedMotionFocus(page, group);
}

async function verifyReducedMotionFocus(page, group) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(GAMECLI_URL, { waitUntil: "domcontentloaded" });
  const fileInput = page.locator('[data-testid="web-cartridge-file"]').first();
  await fileInput.waitFor({ state: "attached", timeout: 60000 });
  await fileInput.setInputFiles(CARTRIDGE_PATH);
  const launchButton = page.locator(".launch-actions button").first();
  await launchButton.waitFor({ state: "visible", timeout: 60000 });
  await launchButton.click();
  const startCandidates = page.locator("button").filter({ hasText: /开始|Start|继续|Continue/i });
  await startCandidates.first().waitFor({ state: "visible", timeout: 60000 });
  await startCandidates.first().click();

  let focusSample = null;
  for (let index = 0; index < 80 && !focusSample; index += 1) {
    const nextButtons = page.locator("button").filter({ hasText: /继续|下一|Next|Continue|Start/i });
    if ((await nextButtons.count()) > 0) await nextButtons.first().click();
    else await page.mouse.click(VIEWPORT.width * 0.72, VIEWPORT.height * 0.72);
    await page.waitForTimeout(120);
    if (await page.locator('[data-testid="sprite-focus-backdrop"]').isVisible().catch(() => false)) {
      const before = await page.evaluate(() => {
        const target = document.querySelector('[data-sprite-focus-role="target"] .sprite-animation-frame');
        const rect = target?.getBoundingClientRect();
        return { width: rect?.width ?? 0, height: rect?.height ?? 0, activeAnimations: target?.getAnimations().length ?? -1 };
      });
      await page.waitForTimeout(430);
      const peak = await page.evaluate(() => {
        const target = document.querySelector('[data-sprite-focus-role="target"] .sprite-animation-frame');
        const companion = document.querySelector('[data-sprite-focus-role="companion"]');
        const backdrop = document.querySelector('[data-testid="sprite-focus-backdrop"]');
        const rect = target?.getBoundingClientRect();
        return {
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
          activeAnimations: target?.getAnimations().length ?? -1,
          companionFilter: companion ? getComputedStyle(companion).filter : "",
          backdropOpacity: backdrop ? Number(getComputedStyle(backdrop).opacity) : 0,
        };
      });
      focusSample = { before, peak };
      ensureDir(RUNTIME_KEYFRAME_DIR);
      await page.screenshot({ path: path.join(RUNTIME_KEYFRAME_DIR, "sprite-focus-reduced-motion.png"), fullPage: false });
    }
  }

  const noScale = Boolean(focusSample) &&
    Math.abs(focusSample.before.width - focusSample.peak.width) < 0.5 &&
    Math.abs(focusSample.before.height - focusSample.peak.height) < 0.5 &&
    focusSample.peak.activeAnimations === 0;
  const dimmingRemains = Boolean(focusSample) &&
    focusSample.peak.backdropOpacity >= 0.32 &&
    numericBrightness(focusSample.peak.companionFilter) <= 0.7;
  recordAssertion(group, "reduced motion removes sprite focus scaling", noScale, JSON.stringify(focusSample));
  recordAssertion(group, "reduced motion keeps focus dimming", dimmingRemains, JSON.stringify(focusSample));
  if (!noScale || !dimmingRemains) throw new Error(`${group}: reduced-motion sprite focus assertions failed`);
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

async function groupRuntimeExport(page) {
  const group = "07-runtime-export-gamecli-playback";
  await exportCartridgeThroughUi(page, group);
  runVerifyCartridge(group);
  await gameCliPlayback(page, group);
}

function writeReports(videoPaths) {
  const reportPath = path.join(FINAL_DIR, "操作报告.md");
  const logPath = path.join(FINAL_DIR, "操作记录.txt");
  const assertionPath = path.join(FINAL_DIR, "断言结果.json");
  const failed = assertions.filter((item) => !item.pass);
  const runtimeCapturePath = path.join(FINAL_DIR, "runtime-animation-captures.json");
  const runtimeFailurePath = path.join(FINAL_DIR, "runtime-animation-failures.json");

  const report = [
    "# 立绘动效控制 Playwright 分组录屏验收报告",
    "",
    `生成时间: ${nowIso()}`,
    `输出目录: ${FINAL_DIR}`,
    `固定等待: 每一次 Playwright UI action 后调用 pace，等待 ${ACTION_DELAY_MS}ms。`,
    "",
    "## 构建与服务",
    "",
    "- editor: npm run build",
    "- GameCli_framework: npm run build",
    "- editor dev server: http://127.0.0.1:6767/",
    "- GameCLI dev server: http://127.0.0.1:6868/",
    "- backend: http://127.0.0.1:8278/api/health",
    "",
    "## 分组录屏",
    "",
    ...videoPaths.map((videoPath) => `- ${path.basename(videoPath)}: ${videoPath}`),
    "",
    "## 断言摘要",
    "",
    `- 总断言: ${assertions.length}`,
    `- 通过: ${assertions.filter((item) => item.pass).length}`,
    `- 失败: ${failed.length}`,
    "",
    "## 操作覆盖",
    "",
    "- 角色 ID、sprite 资产选择、位置、显示/隐藏。",
    "- 旧立绘过场值 fade_in、fade_out、slide_in_left、slide_in_right、slide_out_left、slide_out_right、shake、heartbeat。",
    "- 结构化 animation_config 的 kind、phase、direction、duration_ms、delay_ms、easing、display_name、preset_id、blocking。",
    "- 立绘动效工作室模板、播放、暂停、重播、关键帧时间轴和关键帧参数。",
    "- 动画编辑器 sprite 模板 sprite_fade_in、sprite_slide_in、sprite_fade_out、sprite_slide_out、sprite_pop、sprite_shake、sprite_heartbeat。",
    "- 导出 .vncart、verify-vncart.cjs 校验、GameCLI 导入播放。",
    "",
    "## 失败项",
    "",
    failed.length
      ? failed.map((item) => `- [${item.group}] ${item.name}: ${item.details}`).join("\n")
      : "- 无",
    "",
  ].join("\n");

  const operationLog = operations
    .map((item, index) => {
      return [
        `${index + 1}. [${item.time}] ${item.group}`,
        `   step: ${item.step}`,
        `   selector: ${item.selector || "-"}`,
        `   expected: ${item.expected || "-"}`,
        `   actual: ${item.actual || "-"}`,
      ].join("\n");
    })
    .join("\n\n");

  writeText(reportPath, report);
  writeText(logPath, operationLog);
  fs.writeFileSync(assertionPath, JSON.stringify(assertions, null, 2), "utf8");
  fs.writeFileSync(runtimeCapturePath, JSON.stringify(runtimeAnimationCaptures, null, 2), "utf8");
  fs.writeFileSync(runtimeFailurePath, JSON.stringify(runtimeAnimationFailures, null, 2), "utf8");
  return { reportPath, logPath, assertionPath, runtimeCapturePath, runtimeFailurePath };
}

function cleanupServers() {
  restoreGameCliLaunchMode();
  for (const item of startedProcesses.reverse()) {
    try {
      item.child.kill();
    } catch (_error) {
      // Best effort cleanup for servers started by this script.
    }
    try {
      fs.closeSync(item.out);
    } catch (_error) {
      // Best effort cleanup for log handles.
    }
  }
}

async function main() {
  fs.rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  ensureDir(FINAL_DIR);
  ensureDir(WORK_DIR);
  ensureDir(RAW_VIDEO_DIR);
  createTestProject();
  writeTemporaryGameCliLaunchMode();
  console.log(`[setup] project: ${PROJECT_PATH}`);

  await ensureServers();

  const browser = await chromium.launch({ headless: true });
  const videoPaths = [];
  try {
    const tasks = [
      ["01-command-basic-controls", "01-command-basic-controls.webm", groupBasicControls],
      ["02-legacy-transition-options", "02-legacy-transition-options.webm", groupLegacyOptions],
      ["03-structured-animation-controls", "03-structured-animation-controls.webm", groupStructuredControls],
      ["04-studio-preview-and-templates", "04-studio-preview-and-templates.webm", groupStudioPreview],
      ["05-studio-keyframe-timeline", "05-studio-keyframe-timeline.webm", groupStudioKeyframes],
      ["06-advanced-animation-editor-sprite-presets", "06-advanced-animation-editor-sprite-presets.webm", groupAdvancedAnimationEditor],
      ["07-runtime-export-gamecli-playback", "07-runtime-export-gamecli-playback.webm", groupRuntimeExport],
    ];
    const selectedTasks = REQUESTED_GROUPS.length
      ? tasks.filter(([id]) => REQUESTED_GROUPS.some((requested) => id.startsWith(requested)))
      : tasks;
    if (selectedTasks.length === 0) {
      throw new Error(`No acceptance groups matched SPRITE_ACCEPTANCE_GROUPS=${REQUESTED_GROUPS.join(",")}`);
    }
    for (const [id, fileName, task] of selectedTasks) {
      videoPaths.push(await runRecordedGroup(browser, fileName, id, task));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const reports = writeReports(videoPaths);
  console.log("[done] reports:");
  console.log(reports);
}

main()
  .catch((error) => {
    console.error(error);
    writeReports([]);
    process.exitCode = 1;
  })
  .finally(cleanupServers);
