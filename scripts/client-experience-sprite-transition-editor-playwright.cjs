#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { saveProjectContainerSync } = require("./project-container.cjs");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../Editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const testDir = path.join(root, "test_AgentVN", "sprite-transition-editor");
const outputDir = path.join(root, "output", "playwright", "client-experience-enhancement", "sprite-transition-editor");
const editorUrl = "http://127.0.0.1:6767/";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const headed = process.argv.includes("--headed");

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSeparator)) {
    throw new Error(`Refusing to operate outside workspace: ${resolved}`);
  }
  return resolved;
}

function resetDirectories() {
  for (const directory of [testDir, outputDir]) {
    fs.rmSync(assertInsideRoot(directory), { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: true });
  }
}

async function isListening(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

function startServer() {
  const child = spawn(npmCommand, ["run", "dev"], {
    cwd: path.join(root, "Editor"),
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logPath = path.join(outputDir, "editor.log");
  child.stdout.on("data", (data) => fs.appendFileSync(logPath, data));
  child.stderr.on("data", (data) => fs.appendFileSync(logPath, data));
  return child;
}

function stopServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function ensureServer() {
  if (await isListening(editorUrl)) return undefined;
  const child = startServer();
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await isListening(editorUrl)) return child;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  stopServer(child);
  throw new Error(`Editor did not start at ${editorUrl}.`);
}

function buildProject() {
  const now = new Date().toISOString();
  const scene = {
    scene_id: "sprite_transition_editor_scene",
    title: "立绘替换过场编辑验收",
    summary: "验证替换过场与角色出入场动画互不覆盖。",
    chapter: 1,
    tags: ["sprite", "transition", "acceptance"],
    commands: [
      {
        type: "sprite",
        character_id: "hero",
        sprite_id: "hero_smile",
        position: "left",
        animation: "fade_in",
        animation_display_name: "Legacy enter sentinel",
        animation_config: {
          kind: "move",
          phase: "enter",
          direction: "left",
          duration_ms: 520,
          easing: "ease-out",
          blocking: false,
        },
        switch_transition: {
          kind: "crossfade",
          duration_ms: 600,
          easing: "ease-out",
        },
        scale: 1.1,
        visible: true,
      },
      {
        type: "sprite",
        character_id: "",
        sprite_id: "",
        position: "center",
        animation_config: {
          kind: "fade",
          phase: "enter",
          duration_ms: 480,
          easing: "ease-in-out",
          blocking: false,
        },
        visible: true,
      },
      {
        type: "sprite",
        character_id: "hero",
        sprite_id: "hero_hidden",
        position: "right",
        animation_config: {
          kind: "fade",
          phase: "exit",
          duration_ms: 360,
          easing: "ease-in",
          blocking: false,
        },
        switch_transition: {
          kind: "blur",
          duration_ms: 700,
          easing: "ease-in-out",
        },
        scale: 0.95,
        visible: false,
      },
    ],
    is_ending: true,
  };
  return {
    schema_version: "1.0.0",
    project_id: `sprite_transition_editor_${Date.now()}`,
    title: "立绘替换过场编辑器验收",
    author: "AgentVN QA",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 40, y: 220 },
        data: {
          nodeKind: "start",
          label: "入口",
          description: "",
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
        },
      },
      {
        id: "sprite_transition_editor_scene_node",
        type: "sceneNode",
        position: { x: 330, y: 180 },
        data: {
          nodeKind: "scene",
          label: scene.title,
          description: scene.summary,
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
          scene,
        },
      },
    ],
    edges: [{
      id: "edge_start_sprite_transition",
      source: "start",
      target: "sprite_transition_editor_scene_node",
      sourceHandle: "default",
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: [],
    editor_settings: {},
    created_at: now,
    updated_at: now,
  };
}

async function openProject(page, project, projectPath) {
  await page.addInitScript((draft) => {
    localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(draft));
    localStorage.setItem("agentvn.recentProjects", JSON.stringify([{
      project_id: draft.project_id,
      title: draft.title,
      author: draft.author,
      updated_at: draft.updated_at,
      project: draft,
    }]));
  }, project);
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  const toolbar = page.locator(".editor-toolbar");
  if (!(await toolbar.isVisible({ timeout: 3000 }).catch(() => false))) {
    const importInput = page.locator(".project-import-button input").first();
    await importInput.waitFor({ state: "attached", timeout: 20_000 });
    await page.waitForFunction(() => {
      const input = document.querySelector(".project-import-button input");
      const button = document.querySelector(".project-import-button");
      return Boolean(input && !input.disabled && button?.getAttribute("aria-disabled") !== "true");
    }, null, { timeout: 20_000 });
    await importInput.setInputFiles(projectPath);
    const openDraft = page.locator(
      '[data-help-key="home.openDraft"]:visible, [data-help-key="home.recentProject"]:visible',
    ).first();
    await openDraft.waitFor({ state: "visible", timeout: 20_000 });
    await openDraft.click({ force: true });
    if (!(await toolbar.isVisible({ timeout: 10_000 }).catch(() => false))) {
      await page.evaluate(() => {
        document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
          if (element instanceof HTMLElement) element.style.pointerEvents = "none";
        });
        const entry = Array.from(document.querySelectorAll(
          '[data-help-key="home.openDraft"], [data-help-key="home.recentProject"]',
        )).find((element) => element instanceof HTMLElement && element.offsetParent !== null);
        if (entry instanceof HTMLElement) entry.click();
      });
    }
  }
  await toolbar.waitFor({ state: "visible", timeout: 20_000 });
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
  await page.evaluate((snapshot) => {
    window.__AGENTVN_EDITOR_STORE__?.getState?.().importProject(snapshot);
    window.__AGENTVN_PROJECT_STORE__?.getState?.().loadProjectMetadata(snapshot);
  }, project);
  await page.waitForFunction(() => (
    window.__AGENTVN_EDITOR_STORE__?.getState?.().nodes
      ?.some((node) => node.id === "sprite_transition_editor_scene_node")
  ), null, { timeout: 10_000 });
}

async function selectScene(page) {
  const node = page.locator('.react-flow__node[data-id="sprite_transition_editor_scene_node"]').first();
  await node.waitFor({ state: "visible", timeout: 15_000 });
  await node.click({ position: { x: 44, y: 34 } });
  if (!(await page.locator(".command-card").first().isVisible({ timeout: 3000 }).catch(() => false))) {
    await node.focus();
    await page.keyboard.press("Enter");
  }
  await page.locator(".command-card").first().waitFor({ state: "visible", timeout: 15_000 });
}

async function ensureCardBody(page, index) {
  const card = page.locator(`.command-card[data-command-index="${index}"]`);
  await card.waitFor({ state: "visible", timeout: 10_000 });
  await card.locator(".command-card-header").scrollIntoViewIfNeeded().catch(() => {});
  const body = card.locator(".command-card-body");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await body.isVisible().catch(() => false)) return { card, body };
    await page.waitForTimeout(220);
    await card.evaluate((element) => {
      if (!element.classList.contains("is-collapsed")) return;
      const button = element.querySelector('button[data-help-key="command.expand"]');
      if (button instanceof HTMLElement) button.click();
    }).catch(() => {});
  }
  if (!(await body.isVisible().catch(() => false))) {
    fs.writeFileSync(path.join(outputDir, `card-${index}-dom.html`), await page.content(), "utf8");
    await page.screenshot({ path: path.join(outputDir, `card-${index}-failure.png`), fullPage: true }).catch(() => {});
  }
  await body.waitFor({ state: "visible", timeout: 10_000 });
  return { card, body };
}

async function selectRichOption(page, scope, optionName) {
  await scope.locator('button[data-help-key="command.visualTransition.kind"]').click();
  const option = page.getByRole("option", { name: optionName }).first();
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
}

async function readCommand(page, index) {
  return page.evaluate((commandIndex) => {
    const nodes = window.__AGENTVN_EDITOR_STORE__?.getState?.().nodes ?? [];
    const node = nodes.find((candidate) => candidate.id === "sprite_transition_editor_scene_node");
    return node?.data?.scene?.commands?.[commandIndex] ?? null;
  }, index);
}

async function waitForCommand(page, index, expected) {
  await page.waitForFunction(
    ({ commandIndex, match }) => {
      const nodes = window.__AGENTVN_EDITOR_STORE__?.getState?.().nodes ?? [];
      const node = nodes.find((candidate) => candidate.id === "sprite_transition_editor_scene_node");
      const command = node?.data?.scene?.commands?.[commandIndex];
      if (!command) return false;
      return Object.entries(match).every(([pathKey, value]) => {
        const actual = pathKey.split(".").reduce((current, key) => current?.[key], command);
        return actual === value;
      });
    },
    { commandIndex: index, match: expected },
    { timeout: 5000 },
  );
}

function expect(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${details}` : ""}`);
}

async function main() {
  resetDirectories();
  const fixtureProject = buildProject();
  const projectPath = path.join(testDir, "sprite-transition-editor.agentvn");
  saveProjectContainerSync(projectPath, fixtureProject, { container: "zip" });
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    checks: [],
    artifacts: { projectPath, outputDir },
  };
  const browserErrors = [];
  let browser;
  let startedServer;

  function pass(assertion, file = "Editor/src/components/command-editors/SpriteCommandEditor.tsx") {
    report.checks.push({ assertion, file });
  }

  try {
    startedServer = await ensureServer();
    browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    await page.route("http://127.0.0.1:8278/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const body = request.postDataJSON?.() ?? {};
      if (url.pathname === "/api/project/catalog") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) });
        return;
      }
      if (url.pathname === "/api/project/state") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: request.method() === "GET" ? null : body }),
        });
        return;
      }
      if (url.pathname.startsWith("/api/project/projects/")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: request.method() === "GET" ? fixtureProject : body }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: {} }) });
    });
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.stack || error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });

    await openProject(page, fixtureProject, projectPath);
    await selectScene(page);

    const explicit = await ensureCardBody(page, 0);
    const guide = explicit.body.locator(".sprite-motion-guide");
    await guide.waitFor({ state: "visible" });
    expect((await guide.innerText()).includes("角色出入场动画"), "动作分工未说明角色出入场动画");
    expect((await guide.innerText()).includes("立绘替换过场"), "动作分工未说明立绘替换过场");
    pass("立绘编辑器明确区分出入场动画与同角色替换过场");

    const characterControls = explicit.body.locator(".character-animation-controls");
    const transitionControls = explicit.body.locator('[data-testid="visual-transition-controls"]');
    await transitionControls.waitFor({ state: "visible" });
    expect(await characterControls.count() === 1 && await transitionControls.count() === 1, "两类动作控件未同时存在");
    pass("animation_config 与 switch_transition 拥有独立可见控件");
    expect(await transitionControls.getAttribute("data-transition-source") === "explicit", "显式替换配置来源不正确");
    expect(await transitionControls.getAttribute("data-transition-disabled") === "false", "可见立绘的替换控件被错误禁用");
    pass("可见立绘的显式 switch_transition 正确回显且可编辑");

    expect(
      await transitionControls.locator('button[data-help-key="command.visualTransition.kind"]').innerText()
        .then((text) => text.includes("交叉淡化")),
      "初始替换类型不是交叉淡化",
    );
    expect(await transitionControls.locator('[data-testid="visual-transition-duration"]').inputValue() === "600", "初始替换时长不是 600ms");
    expect(await transitionControls.locator('[data-testid="visual-transition-easing"]').inputValue() === "ease-out", "初始替换缓动不正确");
    pass("crossfade + 600ms + ease-out 结构化配置正确回显");

    const beforeEdit = await readCommand(page, 0);
    await selectRichOption(page, transitionControls, /模糊过渡/);
    await transitionControls.locator('[data-testid="visual-transition-duration"]').fill("740");
    await transitionControls.locator('[data-testid="visual-transition-easing"]').fill("ease-in-out");
    await waitForCommand(page, 0, {
      "switch_transition.kind": "blur",
      "switch_transition.duration_ms": 740,
      "switch_transition.easing": "ease-in-out",
    });
    const afterEdit = await readCommand(page, 0);
    expect(JSON.stringify(afterEdit.animation_config) === JSON.stringify(beforeEdit.animation_config), "编辑替换过场覆盖了 animation_config");
    pass("编辑替换过场只写 switch_transition，不覆盖 animation_config");
    for (const key of ["character_id", "sprite_id", "position", "animation", "animation_display_name", "scale", "visible"]) {
      expect(JSON.stringify(afterEdit[key]) === JSON.stringify(beforeEdit[key]), `编辑替换过场覆盖了 ${key}`);
    }
    pass("编辑替换过场保持角色、素材、位置、旧动画、缩放和可见性字段");

    await transitionControls.locator('[data-testid="visual-transition-reset"]').click();
    await waitForCommand(page, 0, { switch_transition: null });
    const resetCommand = await readCommand(page, 0);
    expect(JSON.stringify(resetCommand.animation_config) === JSON.stringify(beforeEdit.animation_config), "重置删除了角色动画配置");
    expect(resetCommand.sprite_id === "hero_smile" && resetCommand.scale === 1.1, "重置删除了立绘字段");
    pass("重置仅清空 switch_transition，其他立绘命令字段保持不变");

    const missing = await ensureCardBody(page, 1);
    const missingControls = missing.body.locator('[data-testid="visual-transition-controls"]');
    expect(await missingControls.getAttribute("data-transition-disabled") === "false", "缺少 ID 时替换控件不应禁用");
    const missingHint = await missingControls.locator('[data-testid="visual-transition-context-hint"]').innerText();
    expect(missingHint.includes("角色编号") && missingHint.includes("立绘素材"), "缺少 ID 的上下文提示不完整");
    pass("角色编号和立绘素材为空时仍可编辑并显示明确提示");

    await selectRichOption(page, missingControls, /交叉淡化/);
    await missingControls.locator('[data-testid="visual-transition-duration"]').fill("600");
    await missingControls.locator('[data-testid="visual-transition-easing"]').fill("ease-out");
    await waitForCommand(page, 1, {
      "switch_transition.kind": "crossfade",
      "switch_transition.duration_ms": 600,
      "switch_transition.easing": "ease-out",
    });
    const missingEdited = await readCommand(page, 1);
    expect(missingEdited.character_id === "" && missingEdited.sprite_id === "", "预设替换参数意外补写了 ID");
    expect(missingEdited.animation_config.kind === "fade", "预设替换参数覆盖了角色动画");
    pass("缺少 ID 时仍可预设 crossfade + 600ms + ease-out，且不改写其他字段");

    const hidden = await ensureCardBody(page, 2);
    const hiddenControls = hidden.body.locator('[data-testid="visual-transition-controls"]');
    expect(await hiddenControls.getAttribute("data-transition-disabled") === "true", "visible=false 的替换控件未禁用");
    expect((await hiddenControls.getAttribute("data-disabled-reason") || "").includes("退出效果"), "隐藏态缺少禁用原因");
    expect(await hiddenControls.locator('button[data-help-key="command.visualTransition.kind"]').isDisabled(), "隐藏态类型选择仍可操作");
    expect(await hiddenControls.locator('[data-testid="visual-transition-duration"]').isDisabled(), "隐藏态时长仍可操作");
    expect(await hiddenControls.locator('[data-testid="visual-transition-easing"]').isDisabled(), "隐藏态缓动仍可操作");
    expect(await hiddenControls.locator('[data-testid="visual-transition-reset"]').isDisabled(), "隐藏态重置仍可操作");
    pass("visible=false 时完整禁用替换过场并说明退出由 animation_config 负责");

    const hiddenBefore = await readCommand(page, 2);
    await hidden.body.locator('input[data-help-key="command.sprite.visible"]').check();
    await waitForCommand(page, 2, { visible: true, "animation_config.phase": "enter" });
    expect(await hiddenControls.getAttribute("data-transition-disabled") === "false", "重新显示后替换控件未启用");
    const hiddenAfter = await readCommand(page, 2);
    expect(JSON.stringify(hiddenAfter.switch_transition) === JSON.stringify(hiddenBefore.switch_transition), "切换可见性删除了替换配置");
    pass("重新显示立绘会启用替换控件，同时保留已有 switch_transition");

    await selectRichOption(page, transitionControls, /中心展开/);
    await transitionControls.locator('[data-testid="visual-transition-duration"]').fill("680");
    await transitionControls.locator('[data-testid="visual-transition-easing"]').fill("ease-out");
    await transitionControls.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const screenshotPath = path.join(outputDir, "01-sprite-transition-editor.png");
    const inspectorBox = await page.locator(".inspector-panel").boundingBox();
    if (!inspectorBox) throw new Error("Cannot measure inspector panel for visual acceptance screenshot.");
    await page.screenshot({
      path: screenshotPath,
      clip: {
        x: Math.max(0, inspectorBox.x),
        y: Math.max(0, inspectorBox.y),
        width: Math.min(inspectorBox.width, 1600 - Math.max(0, inspectorBox.x)),
        height: Math.min(inspectorBox.height, 1000 - Math.max(0, inspectorBox.y)),
      },
    });
    await guide.scrollIntoViewIfNeeded();
    await page.waitForTimeout(220);
    const guideScreenshotPath = path.join(outputDir, "02-sprite-motion-responsibility-guide.png");
    await page.screenshot({
      path: guideScreenshotPath,
      clip: {
        x: Math.max(0, inspectorBox.x),
        y: Math.max(0, inspectorBox.y),
        width: Math.min(inspectorBox.width, 1600 - Math.max(0, inspectorBox.x)),
        height: Math.min(inspectorBox.height, 1000 - Math.max(0, inspectorBox.y)),
      },
    });
    report.artifacts.screenshot = screenshotPath;
    report.artifacts.guideScreenshot = guideScreenshotPath;
    pass("真实编辑器完成立绘替换过场编辑并生成视觉验收截图", "scripts/client-experience-sprite-transition-editor-playwright.cjs");

    expect(browserErrors.length === 0, "浏览器控制台出现错误", browserErrors.join("\n"));
    pass("真实浏览器交互过程中无 pageerror 或 console error", "scripts/client-experience-sprite-transition-editor-playwright.cjs");

    const finalCommand = await readCommand(page, 0);
    expect(
      finalCommand.switch_transition.kind === "reveal_center"
        && finalCommand.switch_transition.duration_ms === 680
        && finalCommand.switch_transition.easing === "ease-out",
      "最终 switch_transition 与 UI 编辑结果不一致",
      JSON.stringify(finalCommand),
    );
    pass("最终替换配置通过公开 Editor store 数据流写回场景命令");

    report.ok = true;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Sprite transition editor acceptance passed: ${report.checks.length} checks.`);
    console.log(`Screenshot: ${screenshotPath}`);
    await context.close();
  } catch (error) {
    report.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    report.browserErrors = browserErrors;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
    stopServer(startedServer);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
