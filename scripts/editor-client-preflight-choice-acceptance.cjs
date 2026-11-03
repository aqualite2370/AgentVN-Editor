const { chromium } = require("../editor/node_modules/playwright");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const editorUrl = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const outputDir = path.join(root, "output", "playwright", "editor-client-preflight-choice");
const videoDir = path.join(outputDir, "videos");
const reportPath = path.join(outputDir, "report.json");

fs.mkdirSync(outputDir, { recursive: true });

function statusText(status) {
  if (status === "passed") return "通过";
  if (status === "failed") return "失败";
  if (status === "running") return "运行中";
  return String(status);
}

function makeNode(id, nodeKind, position, data) {
  const typeByKind = {
    start: "startNode",
    scene: "sceneNode",
    choice: "choiceNode",
    modifier: "modifierNode",
    condition: "conditionNode",
    loop: "loopNode",
    animation: "animationNode",
    end: "endNode",
  };
  return {
    id,
    type: typeByKind[nodeKind] || nodeKind,
    position,
    data: {
      nodeKind,
      label: data.label || id,
      description: data.description || "",
      aiSettings: { authorGoal: "", generationOutline: "", autoExtractMemory: true, autoApplyMemory: false },
      previewState: { currentCommandIndex: 0, isPlaying: false },
      editorMeta: { collapsedInspectorSections: [], source: "manual" },
      ...data,
    },
  };
}

function projectStateFixture() {
  const start = makeNode("start", "start", { x: 40, y: 220 }, {
    label: "开始",
    loadingAnimation: { kind: "default" },
  });
  const scene = makeNode("node_scene_missing_assets", "scene", { x: 320, y: 160 }, {
    label: "开场卡片",
    description: "用于发布预检定位的测试场景",
    scene: {
      scene_id: "scene_missing_assets",
      scene_display_name: "夜王森林",
      title: "夜王森林",
      summary: "缺失素材定位测试",
      chapter: 1,
      tags: ["test"],
      commands: [
        { type: "background", background_id: "missing_bg", background_fit: "stretch", transition: "fade" },
        { type: "dialog", character_id: "hero", text: "这片森林没有回应。", portrait: "missing_portrait", voice: "missing_voice", font_asset_id: "missing_font", side: "left" },
        { type: "sprite", character_id: "hero", sprite_id: "missing_sprite", position: "center", visible: true },
        { type: "show_image", image_id: "missing_clue", image_fit: "contain" },
        { type: "bgm", bgm_id: "missing_bgm", action: "play" },
        { type: "sfx", sfx_id: "missing_sfx" },
        {
          type: "choice",
          choices: [
            { choice_id: "empty_choice", choice_display_name: null, text: "", target_scene_id: "scene_after", conditions: [] },
            { choice_id: "named_choice", choice_display_name: "查看树影", text: "", target_scene_id: "scene_after", conditions: [] },
          ],
        },
      ],
    },
  });
  const after = makeNode("node_scene_after", "scene", { x: 680, y: 160 }, {
    label: "后续卡片",
    scene: {
      scene_id: "scene_after",
      scene_display_name: "后续",
      title: "后续",
      summary: "后续场景",
      chapter: 1,
      tags: ["test"],
      commands: [{ type: "narration", text: "树影微微一动。" }],
    },
  });
  const choiceNode = makeNode("node_choice_empty", "choice", { x: 320, y: 460 }, {
    label: "空选项卡片",
    description: "空选项应显示灰色提示",
    choice: {
      type: "choice",
      choices: [
        { choice_id: "choice_blank", choice_display_name: null, text: "", target_scene_id: "scene_after", conditions: [] },
      ],
    },
  });
  return {
    provider_connections: [],
    provider_models: [],
    provider_selections: {},
    provider_secrets: {},
    recent_projects: [],
    project_metadata: {},
    project_graph: {
      nodes: [start, scene, after, choiceNode],
      edges: [
        { id: "edge_start_scene", source: "start", target: "node_scene_missing_assets", sourceHandle: "default" },
        { id: "edge_scene_after", source: "node_scene_missing_assets", target: "node_scene_after", sourceHandle: "default" },
        { id: "edge_empty_choice", source: "node_scene_missing_assets", target: "node_scene_after", sourceHandle: "empty_choice" },
        { id: "edge_named_choice", source: "node_scene_missing_assets", target: "node_scene_after", sourceHandle: "named_choice" },
      ],
      viewport: { x: 0, y: 0, zoom: 0.8 },
      memoryMode: "hybrid",
    },
    project_metadata_full: {},
  };
}

async function installProjectRoute(page) {
  let state = projectStateFixture();
  await page.route("**/api/project/state", async (route) => {
    if (route.request().method() === "POST") {
      const update = route.request().postDataJSON();
      state = { ...state, ...update };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: state }),
    });
  });
}

async function openEditor(page) {
  await installProjectRoute(page);
  await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  const workspace = page.locator(".editor-workspace");
  if (!(await workspace.isVisible({ timeout: 2500 }).catch(() => false))) {
    await page.waitForFunction(() => {
      if (document.querySelector(".editor-workspace")?.checkVisibility({ checkOpacity: true })) return true;
      const candidates = Array.from(document.querySelectorAll('[data-help-key="home.recentProject"], .home-action-primary, [data-help-key="home.createProject"]'));
      return candidates.some((element) => {
        if (!element.checkVisibility({ checkOpacity: true }) || element.disabled) return false;
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === element || element.contains(hit);
      });
    }, null, { timeout: 30000 });
    if (await workspace.isVisible().catch(() => false)) return;
    const clicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('[data-help-key="home.recentProject"], .home-action-primary, [data-help-key="home.createProject"]'));
      const target = candidates.find((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return element.checkVisibility({ checkOpacity: true })
          && !element.disabled
          && (hit === element || element.contains(hit));
      });
      if (!target) return false;
      target.click();
      return true;
    });
    if (!clicked) throw new Error("无法点击任何可见的首页入口按钮。请确认编辑器首页已正常渲染，或检查最近项目/新建项目入口是否被遮挡。");
  }
  await page.locator(".editor-workspace").waitFor({ state: "visible", timeout: 30000 });
}

async function installEditorFixture(page) {
  const fixture = projectStateFixture();
  await page.evaluate(({ nodes, edges, viewport, memoryMode }) => {
    const store = window.__AGENTVN_EDITOR_STORE__;
    if (!store) throw new Error("Editor store test bridge is unavailable.");
    store.setState({
      nodes,
      edges,
      viewport,
      memoryMode,
      selectedNodeId: null,
      dirty: false,
    });
  }, fixture.project_graph);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  fs.mkdirSync(videoDir, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(),
    editorUrl,
    status: "running",
    statusText: "运行中",
    assertions: [],
    screenshots: [],
    videos: [],
    sampleCoverage: [
      "缺失素材定位：背景、头像、语音、字体、立绘、展示图片、背景音乐、音效",
      "素材定位字段：场景标题、节点/卡片名称、命令序号、命令字段",
      "选项占位界面：空分支文本显示灰色/斜体提示",
      "选项导出默认值：空文本只在运行边界使用稳定默认显示",
      "选项显示名兜底：玩家文本为空时使用 choice_display_name",
    ],
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 980 } },
  });
  const page = await context.newPage();
  function record(name, passed, detail) {
    report.assertions.push({ name, passed, detail });
    if (!passed) throw new Error(`${name}: ${detail}`);
  }
  function setStatus(status) {
    report.status = status;
    report.statusText = statusText(status);
  }
  async function screenshot(name) {
    const filePath = path.join(outputDir, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    report.screenshots.push(path.relative(root, filePath).replaceAll("\\", "/"));
  }

  try {
    await openEditor(page);
    await installEditorFixture(page);
    await page.waitForFunction(() => document.querySelector(".choice-node .node-preview .is-placeholder")?.textContent?.includes("未填写选项文本"), null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const placeholderProbe = await page.evaluate(() => {
      const element = document.querySelector(".choice-node .node-preview .is-placeholder");
      if (!element) return undefined;
      const style = getComputedStyle(element);
      return { text: element.textContent || "", color: style.color, fontStyle: style.fontStyle, opacity: style.opacity };
    });
    record("客户端节点显示空选项灰色提示", /未填写选项文本/.test(placeholderProbe?.text || ""), JSON.stringify(placeholderProbe));
    record("客户端空选项提示使用灰色/斜体状态", placeholderProbe?.fontStyle === "italic" || Number(placeholderProbe?.opacity ?? 1) < 1, JSON.stringify(placeholderProbe));
    await screenshot("choice-placeholder-ui");

    const exportScript = await page.evaluate(() => window.__AGENTVN_EDITOR_STORE__.getState().exportScript());
    const choiceCommand = exportScript.scenes.find((scene) => scene.scene_id === "scene_missing_assets")?.commands.find((command) => command.type === "choice");
    record("导出运行剧本为空选项写入默认值", choiceCommand?.choices?.[0]?.text === "选项 1", JSON.stringify(choiceCommand?.choices?.[0]));
    record("导出运行剧本优先使用显示名兜底", choiceCommand?.choices?.[1]?.text === "查看树影", JSON.stringify(choiceCommand?.choices?.[1]));

    await page.locator('[data-help-key="toolbar.exportCartridge"]').click();
    await page.locator('[data-package-stage="checks"]').waitFor({ state: "visible", timeout: 10000 });
    await page.locator('[data-package-stage="checks"]').click();
    await page.locator(".preflight-panel").waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(500);
    record(
      "发布工作台按阶段展示检查内容",
      await page.locator(".package-stage-viewport").getAttribute("data-active-stage") === "checks",
      await page.locator(".package-stage-viewport").getAttribute("data-active-stage") || "",
    );
    const preflightText = await page.locator(".preflight-panel").textContent();
    record("发布预检主面板不直接显示诊断正文", !preflightText.includes("问题：") && !preflightText.includes("解决方案："), preflightText);
    const assetDiagnosticTrigger = page.locator('[data-preflight-check-id="asset_references"]');
    await assetDiagnosticTrigger.click();
    const diagnosticDialog = page.locator('[data-testid="package-preflight-detail-dialog"]');
    await diagnosticDialog.waitFor({ state: "visible", timeout: 10000 });
    const diagnosticText = await diagnosticDialog.textContent();
    for (const expected of ["missing_bg", "missing_portrait", "missing_voice", "missing_font", "missing_sprite", "missing_clue", "missing_bgm", "missing_sfx"]) {
      record(`发布诊断弹窗列出缺失素材 ${expected}`, diagnosticText.includes(expected), diagnosticText.slice(0, 1000));
    }
    record("发布诊断弹窗包含具体场景定位", diagnosticText.includes("场景「夜王森林」"), diagnosticText);
    record("发布诊断弹窗包含具体节点定位", diagnosticText.includes("节点「开场卡片」"), diagnosticText);
    record("发布诊断弹窗包含命令序号和字段", /第 1 条 background\.background_id/.test(diagnosticText), diagnosticText);
    record("发布诊断弹窗逐项显示解决方案", diagnosticText.includes("解决方案 1"), diagnosticText);
    record("发布诊断弹窗说明如何替换缺失素材", diagnosticText.includes("导入对应 asset_id 的素材") || diagnosticText.includes("替换为已有素材"), diagnosticText);
    await screenshot("preflight-diagnostic-dialog");
    await diagnosticDialog.locator('button[aria-label="关闭发布前诊断"]').click();
    await page.waitForTimeout(350);
    const triggerFocused = await assetDiagnosticTrigger.evaluate((element) => document.activeElement === element);
    record("关闭发布诊断后焦点返回触发项", triggerFocused, String(triggerFocused));
    await screenshot("preflight-choice-ui");
    setStatus("passed");
  } catch (error) {
    setStatus("failed");
    report.error = error instanceof Error ? error.stack || error.message : String(error);
    await screenshot("failure").catch(() => {});
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    const video = page.video();
    await context.close().catch(() => {});
    if (video) {
      const videoPath = await video.path().catch(() => "");
      if (videoPath) report.videos.push(path.relative(root, videoPath).replaceAll("\\", "/"));
    }
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    await browser.close();
  }
  console.log(JSON.stringify({ status: report.status, statusText: statusText(report.status), report: path.relative(root, reportPath), assertions: report.assertions.length }, null, 2));
}

main().catch((error) => {
  fs.writeFileSync(reportPath, JSON.stringify({ status: "failed", statusText: "失败", error: error instanceof Error ? error.stack || error.message : String(error) }, null, 2), "utf8");
  console.error(error);
  process.exitCode = 1;
});
