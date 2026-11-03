#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadProjectContainerSync, saveProjectContainerSync } = require("./project-container.cjs");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../Editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const testDir = path.join(root, "test_AgentVN", "background-transition-editor");
const outputDir = path.join(root, "output", "playwright", "client-experience-enhancement", "background-transition-editor");
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
    scene_id: "transition_editor_scene",
    title: "背景转场编辑验收",
    summary: "验证结构化转场、旧版映射与安全缓动输入。",
    chapter: 1,
    tags: ["transition", "acceptance"],
    commands: [
      {
        type: "background",
        background_id: "bg_structured",
        background_fit: "cover",
        transition: "fade",
        transition_display_name: "Legacy sentinel",
        transition_config: {
          kind: "crossfade",
          duration_ms: 420,
          easing: "ease-in-out",
        },
      },
      {
        type: "background",
        background_id: "bg_legacy",
        background_fit: "contain",
        transition: "wipe_rtl",
        transition_display_name: "Legacy mapped",
      },
    ],
    is_ending: true,
  };
  return {
    schema_version: "1.0.0",
    project_id: `background_transition_editor_${Date.now()}`,
    title: "背景转场编辑器验收",
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
        id: "transition_editor_scene_node",
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
      id: "edge_start_transition",
      source: "start",
      target: "transition_editor_scene_node",
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

async function importProject(page, projectPath) {
  const project = loadProjectContainerSync(projectPath).project;
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
    await page.waitForFunction(() => {
      const input = document.querySelector(".project-import-button input");
      const button = document.querySelector(".project-import-button");
      return input && !input.disabled && button?.getAttribute("aria-disabled") !== "true";
    }, null, { timeout: 20_000 });
    await page.locator(".project-import-button input").first().setInputFiles(projectPath);
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
  await page.waitForFunction(() => {
    const stage = document.querySelector(".app-transition-stage");
    return !document.querySelector(".project-entry-loading-overlay")
      && !stage?.classList.contains("is-switching")
      && !stage?.classList.contains("is-enter-cartridge")
      && !stage?.classList.contains("is-project-entry-loading");
  }, null, { timeout: 30_000 });
  await page.evaluate((snapshot) => {
    window.__AGENTVN_EDITOR_STORE__?.getState?.().importProject(snapshot);
    window.__AGENTVN_PROJECT_STORE__?.getState?.().loadProjectMetadata(snapshot);
  }, project);
  await page.waitForFunction(() => (
    window.__AGENTVN_EDITOR_STORE__?.getState?.().nodes
      ?.some((node) => node.id === "transition_editor_scene_node")
  ), null, { timeout: 10_000 });
}

async function selectScene(page) {
  const sceneNode = page.locator('.react-flow__node[data-id="transition_editor_scene_node"]').first();
  await sceneNode.waitFor({ state: "visible", timeout: 15_000 });
  await sceneNode.click({ position: { x: 44, y: 34 } });
  if (!(await page.locator(".command-card").first().isVisible({ timeout: 3000 }).catch(() => false))) {
    await sceneNode.focus();
    await page.keyboard.press("Enter");
  }
  await page.locator(".command-card").first().waitFor({ state: "visible", timeout: 15_000 });
}

async function ensureCommandCardBody(page, index) {
  const card = page.locator(`.command-card[data-command-index="${index}"]`);
  await card.waitFor({ state: "visible", timeout: 10_000 });
  const body = card.locator(".command-card-body");
  if (!(await body.isVisible().catch(() => false))) {
    await card.locator('button[data-help-key="command.expand"]').click({ force: true });
  }
  await body.waitFor({ state: "visible", timeout: 10_000 });
  return { card, body };
}

async function selectRichOption(page, scope, helpKey, optionName) {
  await scope.locator(`button[data-help-key="${helpKey}"]`).click();
  const option = page.getByRole("option", { name: optionName }).first();
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
}

async function readCommand(page, index) {
  return page.evaluate((commandIndex) => {
    const store = window.__AGENTVN_EDITOR_STORE__;
    const nodes = store?.getState?.().nodes ?? [];
    const node = nodes.find((candidate) => candidate.id === "transition_editor_scene_node");
    return node?.data?.scene?.commands?.[commandIndex] ?? null;
  }, index);
}

function expect(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `: ${details}` : ""}`);
}

async function waitForCommand(page, index, predicateSource, argument) {
  await page.waitForFunction(
    ({ commandIndex, source, value }) => {
      const store = window.__AGENTVN_EDITOR_STORE__;
      const nodes = store?.getState?.().nodes ?? [];
      const node = nodes.find((candidate) => candidate.id === "transition_editor_scene_node");
      const command = node?.data?.scene?.commands?.[commandIndex];
      if (!command) return false;
      return Function("command", "value", `return (${source})(command, value);`)(command, value);
    },
    { commandIndex: index, source: predicateSource, value: argument },
    { timeout: 5000 },
  );
}

async function main() {
  resetDirectories();
  const projectPath = path.join(testDir, "background-transition-editor.agentvn");
  const fixtureProject = buildProject();
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

  function pass(assertion, file = "Editor/src/components/command-editors/VisualTransitionControls.tsx") {
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
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: [] }),
        });
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
          body: JSON.stringify({
            ok: true,
            data: request.method() === "GET" ? fixtureProject : body,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: {} }),
      });
    });
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.stack || error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });

    await importProject(page, projectPath);
    await selectScene(page);

    const explicit = await ensureCommandCardBody(page, 0);
    const explicitControls = explicit.body.locator('[data-testid="visual-transition-controls"]');
    await explicitControls.waitFor({ state: "visible", timeout: 10_000 });
    pass("背景命令卡显示可复用的精细转场控件");

    expect(await explicitControls.getAttribute("data-transition-source") === "explicit", "结构化配置未标记为已自定义");
    pass("结构化 transition_config 显示为已自定义来源");
    expect(
      await explicitControls.locator('button[data-help-key="command.visualTransition.kind"]').innerText()
        .then((text) => text.includes("交叉淡化")),
      "初始转场类型不是交叉淡化",
    );
    expect(await explicitControls.locator('[data-testid="visual-transition-duration"]').inputValue() === "420", "初始时长不是 420ms");
    expect(await explicitControls.locator('[data-testid="visual-transition-easing"]').inputValue() === "ease-in-out", "初始缓动不正确");
    pass("结构化类型、时长和缓动值正确回显");

    await selectRichOption(page, explicitControls, "command.visualTransition.kind", /中心展开/);
    await waitForCommand(page, 0, "(command) => command.transition_config?.kind === 'reveal_center'");
    pass("可将背景切换类型改为中心展开");

    const duration = explicitControls.locator('[data-testid="visual-transition-duration"]');
    await duration.fill("12000");
    await waitForCommand(page, 0, "(command) => command.transition_config?.duration_ms === 10000");
    expect(await duration.inputValue() === "10000", "时长没有钳制到 10000ms");
    pass("时长输入使用共享规则钳制到 80–10000ms");

    const easing = explicitControls.locator('[data-testid="visual-transition-easing"]');
    await easing.fill("ease-out");
    await waitForCommand(page, 0, "(command) => command.transition_config?.easing === 'ease-out'");
    pass("合法缓动值写入 transition_config");

    const preserved = await readCommand(page, 0);
    expect(preserved.background_id === "bg_structured", "背景素材字段被意外修改");
    expect(preserved.background_fit === "cover", "背景显示模式被意外修改");
    expect(preserved.transition === "fade", "旧版 transition 被意外修改");
    expect(preserved.transition_display_name === "Legacy sentinel", "旧版代称被意外修改");
    pass("编辑精细转场不会覆盖背景素材、显示模式或旧版字段");

    await easing.fill("url(evil)");
    await explicitControls.locator('[data-testid="visual-transition-easing-error"]').waitFor({ state: "visible" });
    expect((await readCommand(page, 0)).transition_config.easing === "ease-out", "非法缓动值写入了命令");
    pass("不安全缓动值显示错误且不会污染已保存配置");

    await easing.fill("ease-out");
    await selectRichOption(page, explicitControls, "command.visualTransition.kind", /^瞬时切换/);
    await waitForCommand(page, 0, "(command) => command.transition_config?.kind === 'none'");
    expect(await duration.isDisabled(), "瞬时切换时长输入未禁用");
    expect(await easing.isDisabled(), "瞬时切换缓动输入未禁用");
    pass("瞬时切换会禁用无意义的时长与缓动控件");

    await explicitControls.locator('[data-testid="visual-transition-reset"]').click();
    await waitForCommand(page, 0, "(command) => command.transition_config === null");
    const resetCommand = await readCommand(page, 0);
    expect(resetCommand.background_id === "bg_structured" && resetCommand.transition === "fade", "重置删除了无关字段");
    pass("重置仅清空 transition_config 并保留其他命令字段");

    const legacy = await ensureCommandCardBody(page, 1);
    const legacyControls = legacy.body.locator('[data-testid="visual-transition-controls"]');
    expect(await legacyControls.getAttribute("data-transition-source") === "legacy", "旧版配置未标记为兼容来源");
    expect(
      await legacyControls.locator('button[data-help-key="command.visualTransition.kind"]').innerText()
        .then((text) => text.includes("从右向左擦除")),
      "wipe_rtl 未映射为从右向左擦除",
    );
    pass("旧版 wipe_rtl 自动映射为从右向左擦除");

    await legacyControls.locator('[data-testid="visual-transition-duration"]').fill("680");
    await waitForCommand(
      page,
      1,
      "(command) => command.transition_config?.kind === 'wipe_right_to_left' && command.transition_config?.duration_ms === value",
      680,
    );
    const legacyEdited = await readCommand(page, 1);
    expect(legacyEdited.transition === "wipe_rtl", "首次精细编辑删除了旧版 transition");
    expect(legacyEdited.background_id === "bg_legacy" && legacyEdited.background_fit === "contain", "首次精细编辑修改了背景字段");
    pass("首次编辑旧版映射会写入结构化配置并保留旧字段");

    await explicitControls.scrollIntoViewIfNeeded();
    await selectRichOption(page, explicitControls, "command.visualTransition.kind", /中心展开/);
    await explicitControls.locator('[data-testid="visual-transition-duration"]').fill("860");
    await explicitControls.locator('[data-testid="visual-transition-easing"]').fill("ease-out");
    await waitForCommand(
      page,
      0,
      "(command) => command.transition_config?.kind === 'reveal_center' && command.transition_config?.duration_ms === value",
      860,
    );
    const screenshotPath = path.join(outputDir, "01-background-transition-editor.png");
    await explicit.card.screenshot({ path: screenshotPath });
    report.artifacts.screenshot = screenshotPath;
    pass("真实编辑器完成一轮结构化转场编辑并生成视觉验收截图", "scripts/client-experience-background-transition-editor-playwright.cjs");

    expect(browserErrors.length === 0, "浏览器控制台出现错误", browserErrors.join("\n"));
    pass("真实浏览器交互过程中无 pageerror 或 console error", "scripts/client-experience-background-transition-editor-playwright.cjs");

    const finalCommand = await readCommand(page, 0);
    expect(
      finalCommand.transition_config.kind === "reveal_center"
        && finalCommand.transition_config.duration_ms === 860
        && finalCommand.transition_config.easing === "ease-out",
      "最终结构化转场配置与编辑结果不一致",
      JSON.stringify(finalCommand),
    );
    pass("最终编辑状态通过公开编辑器数据流写回场景命令");

    report.ok = true;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Background transition editor acceptance passed: ${report.checks.length} checks.`);
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
