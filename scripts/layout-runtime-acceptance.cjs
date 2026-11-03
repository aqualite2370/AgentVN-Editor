const fs = require("fs");
const path = require("path");
const { loadProjectContainerSync, saveProjectContainerSync } = require("./project-container.cjs");
const { spawn, spawnSync } = require("child_process");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const testDir = path.join(root, "test_AgentVN", "layout-runtime");
const outputDir = path.join(root, "output", "playwright", "layout-runtime");
const editorUrl = "http://127.0.0.1:6767/";
const gameCliUrl = "http://127.0.0.1:6868/";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const headed = process.argv.includes("--headed");

const expectedRects = {
  unified: {
    dialog_panel: { x: 6, y: 76, width: 88, height: 18 },
    dialog_text: { x: 8, y: 80, width: 84, height: 9.5 },
    choice_list: { x: 50, y: 44, width: 34, height: 32, anchor: "center" },
  },
  quickMenuAnchor: "top_right",
};

const viewports = [
  { name: "desktop-1920x1080", width: 1920, height: 1080, breakpoint: "desktop" },
  { name: "desktop-1280x480", width: 1280, height: 480, breakpoint: "desktop" },
  { name: "desktop-1366x768", width: 1366, height: 768, breakpoint: "desktop" },
  { name: "desktop-1280x720", width: 1280, height: 720, breakpoint: "desktop" },
  { name: "desktop-1024x768", width: 1024, height: 768, breakpoint: "desktop" },
  { name: "ultrawide-2560x1080", width: 2560, height: 1080, breakpoint: "desktop" },
  { name: "mobile-390x844", width: 390, height: 844, breakpoint: "mobile" },
  { name: "mobile-430x932", width: 430, height: 932, breakpoint: "mobile" },
  { name: "mobile-landscape-844x390", width: 844, height: 390, breakpoint: "mobile" },
];

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Refusing to operate outside root workspace: ${resolved}`);
  }
  return resolved;
}

function resetOutputDirs() {
  for (const dir of [testDir, outputDir]) {
    const resolved = assertInsideRoot(dir);
    fs.rmSync(resolved, { recursive: true, force: true });
    fs.mkdirSync(resolved, { recursive: true });
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

function startDevServer(name, cwd) {
  const child = spawn(npmCommand, ["run", "dev"], {
    cwd,
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logFile = path.join(outputDir, `${name}.log`);
  const writeLog = (data) => fs.appendFileSync(logFile, data.toString());
  child.stdout.on("data", writeLog);
  child.stderr.on("data", writeLog);
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) writeLog(`\n${name} exited with code ${code}\n`);
  });
  return child;
}

function stopDevServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

async function ensureServer(name, url, cwd) {
  if (await isListening(url)) return undefined;
  const child = startDevServer(name, cwd);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await isListening(url)) return child;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} did not start at ${url}. See ${path.join(outputDir, `${name}.log`)}`);
}

function buildProjectFile() {
  const now = new Date().toISOString();
  const backgroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#14213d"/><stop offset="1" stop-color="#0b1020"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><text x="84" y="104" font-family="sans-serif" font-size="44" fill="#dbeafe">AgentVN Layout Runtime Acceptance</text></svg>`;
  const backgroundDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(backgroundSvg)}`;
  const scene = {
    scene_id: "layout_runtime_opening",
    title: "布局验收开场",
    summary: "用于验证 GameCLI 是否消费编辑器保存的运行端 UI 布局。",
    chapter: 1,
    tags: ["layout", "acceptance"],
    commands: [
      { type: "background", background_id: "layout_test_bg", transition: "fade" },
      { type: "narration", text: "这是一段用于布局验收的旁白。对话框应出现在设计器指定的位置。" },
      { type: "dialog", character_id: "tester_with_a_very_long_display_name_for_layout", text: "如果布局生效，快捷菜单、对话框和选项列表会在不同分辨率下保持相对位置。这里故意放入一段超过一百五十字的长对白，用来验证自动生成项目里的文字不会被直接裁切；即使用户把对白框调得很矮，玩家端也应该优先保持正文可读，必要时在正文区域内部滚动。SupercalifragilisticexpialidociousWithoutSpacesShouldStillWrapCorrectly，最后再补上一串无空格中文测试文本用于模拟模型连续输出：雨夜旧车站第七号储物柜钥匙仍在掌心发烫而角色必须继续说完这句话。", side: "left" },
      {
        type: "choice",
        choices: [
          { choice_id: "choice_a", text: "确认布局 A", target_scene_id: "layout_runtime_opening", conditions: [] },
          { choice_id: "choice_b", text: "确认布局 B", target_scene_id: "layout_runtime_opening", conditions: [] },
        ],
      },
    ],
  };
  scene.commands[2].text += Array.from({ length: 6 }, (_, index) =>
    " Pagination stress " + (index + 1) + ": this deliberately extends the dialog so the runtime must split it into readable pages instead of exposing a scrollbar."
  ).join("");
  return {
    schema_version: "1.0.0",
    project_id: `layout_runtime_${Date.now()}`,
    title: "AgentVN Layout Runtime Acceptance",
    author: "AgentVN QA",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 40, y: 220 },
        data: {
          nodeKind: "start",
          label: "入口",
          description: "布局验收入口。",
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
        },
      },
      {
        id: "node_layout_runtime_opening",
        type: "sceneNode",
        position: { x: 300, y: 180 },
        data: {
          nodeKind: "scene",
          label: scene.title,
          description: scene.summary,
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "布局验收用固定场景。", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
          scene,
        },
      },
    ],
    edges: [{ id: "edge_start_layout", source: "start", target: "node_layout_runtime_opening", sourceHandle: "default" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: [{
      asset_id: "layout_test_bg",
      asset_type: "background",
      metadata: {
        filename: "layout-test-bg.svg",
        mime_type: "image/svg+xml",
        size_bytes: Buffer.byteLength(backgroundSvg, "utf8"),
        source: "bundled",
        license_note: "AgentVN layout acceptance generated fixture.",
        data_url: backgroundDataUrl,
        blob_url: backgroundDataUrl,
        project_path: "assets/background/layout_test_bg-layout-test-bg.svg",
        created_at: now,
      },
    }],
    editor_settings: {},
    created_at: now,
    updated_at: now,
  };
}

async function importProject(page, projectPath) {
  const project = loadProjectContainerSync(projectPath).project;
  await page.addInitScript((draft) => {
    window.localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(draft));
    window.localStorage.setItem("agentvn.recentProjects", JSON.stringify([{
      project_id: draft.project_id,
      title: draft.title,
      author: draft.author,
      updated_at: draft.updated_at,
      project: draft,
    }]));
  }, project);
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  const toolbar = page.locator(".editor-toolbar");
  if (await toolbar.isVisible({ timeout: 3000 }).catch(() => false)) return;

  await page.waitForFunction(() => {
    const input = document.querySelector(".project-import-button input");
    const button = document.querySelector(".project-import-button");
    return input && !input.disabled && button?.getAttribute("aria-disabled") !== "true";
  }, null, { timeout: 20000 });
  await page.locator(".project-import-button input").first().setInputFiles(projectPath);
  const openDraft = page.locator('[data-help-key="home.openDraft"], [data-help-key="home.recentProject"]').first();
  await openDraft.waitFor({ state: "visible", timeout: 20000 });
  await openDraft.click({ force: true });
  if (!(await toolbar.isVisible({ timeout: 12000 }).catch(() => false))) {
    await page.evaluate(() => {
      document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
        element.style.pointerEvents = "none";
      });
      const entry = document.querySelector('[data-help-key="home.openDraft"], [data-help-key="home.recentProject"]');
      if (entry instanceof HTMLElement) entry.click();
    });
  }
  await toolbar.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1400);
}

async function openLayoutDesigner(page) {
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
      element.style.pointerEvents = "none";
    });
  });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("agentvn:open-advanced-tools", {
      detail: {
        id: "layout-runtime-acceptance",
        tab: "layout",
        title: "Runtime layout acceptance",
      },
    }));
  });
  await page.locator(".advanced-tools-panel").waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".runtime-layout-stage").waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "播放页", exact: true }).click();
  await page.waitForTimeout(400);
}

async function dragElement(page, locator, dx, dy) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Cannot drag element without a bounding box.");
  const x = box.x + Math.min(Math.max(10, box.width * 0.18), box.width - 4);
  const y = box.y + Math.min(Math.max(10, box.height * 0.18), box.height - 4);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(180);
}

async function setSelectedRect(page, rect) {
  const numberInputs = page.locator(".runtime-layout-fieldset").first().locator('input[type="number"]');
  if (rect.anchor) {
    const anchorOrder = ["", "top_left", "top_center", "top_right", "center", "bottom_left", "bottom_center", "bottom_right"];
    const optionIndex = anchorOrder.indexOf(rect.anchor);
    if (optionIndex < 0) throw new Error(`Unknown layout anchor: ${rect.anchor}`);
    await selectRichOptionByIndex(page, "布局锚点", optionIndex);
  }
  for (const [index, value] of [rect.x, rect.y, rect.width, rect.height].entries()) {
    const input = numberInputs.nth(index);
    await input.fill(String(value));
    await input.press("Tab").catch(() => {});
    await page.waitForTimeout(90);
  }
}

async function selectRichOptionByIndex(page, helpKey, optionIndex) {
  const trigger = helpKey.includes(".")
    ? page.locator(`button[data-help-key="${helpKey}"]`).first()
    : page.locator(".runtime-layout-inspector > details.runtime-layout-fieldset").first().getByRole("combobox");
  if (await trigger.count() === 0) {
    throw new Error(`Missing rich select ${helpKey}: ${JSON.stringify(await page.evaluate(() => ({
      selected: document.querySelector(".runtime-layout-inspector header")?.textContent,
      fieldsets: Array.from(document.querySelectorAll(".runtime-layout-fieldset")).map((node) => node.outerHTML.slice(0, 500)),
      inspector: document.querySelector(".runtime-layout-inspector")?.outerHTML.slice(0, 2500),
    })))}`);
  }
  await trigger.click();
  const option = page.getByRole("listbox").getByRole("option").nth(optionIndex);
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
  await page.waitForTimeout(160);
}

async function editComponent(page, componentId, rect, options = {}) {
  const componentSelector = `[data-component-id="${componentId}"]`;
  await page.locator(`.runtime-layout-component-list button${componentSelector}`).click({ force: true });
  const block = page.locator(`.runtime-layout-stage .runtime-layout-block${componentSelector}`);
  if (componentId !== "quick_menu") {
    await block.click({ force: true });
    await dragElement(page, block, options.dragX ?? 36, options.dragY ?? -24);
    await page.locator(`.runtime-layout-component-list button${componentSelector}`).click({ force: true });
    await block.click({ force: true });
    const handle = block.locator(".runtime-layout-resize-handle");
    if (await handle.isVisible().catch(() => false)) await dragElement(page, handle, options.resizeX ?? 24, options.resizeY ?? 16);
  }
  await setSelectedRect(page, rect);
}

async function designAndSaveLayout(page) {
  await openLayoutDesigner(page);
  await page.locator('[data-help-key="layout.save"]').click();
  await page.waitForTimeout(500);
}

async function exportCartridge(page) {
  await page.locator('[data-workspace-surface="publish"]:visible').click({ force: true });
  try {
    await page.locator(".cartridge-export-panel").waitFor({ state: "visible", timeout: 10000 });
  } catch (error) {
    const screenshotPath = path.join(outputDir, "export-panel-timeout.png");
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    const diagnostics = await page.evaluate(() => Array.from(document.querySelectorAll("[data-help-key]"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          key: element.getAttribute("data-help-key"),
          text: element.textContent?.trim().slice(0, 80) || "",
          visible: rect.width > 0 && rect.height > 0,
          disabled: element instanceof HTMLButtonElement ? element.disabled : element.getAttribute("aria-disabled"),
        };
      })
      .filter((item) => item.visible)
      .slice(0, 80));
    throw new Error(`Cartridge export panel did not open. Screenshot: ${screenshotPath}. Visible help keys: ${JSON.stringify(diagnostics)}. ${error instanceof Error ? error.message : String(error)}`);
  }
  await selectRichOptionByIndex(page, "package.mode", 1);
  await page.waitForTimeout(700);
  let warningConfirm = page.locator('input[data-help-key="package.confirmWarnings"]');
  if (await warningConfirm.count() === 0) {
    const openWarnings = page.getByRole("button", { name: /查看并确认警告/ });
    if (await openWarnings.count()) {
      await openWarnings.click();
      await page.waitForTimeout(180);
      warningConfirm = page.locator('input[data-help-key="package.confirmWarnings"]');
    }
  }
  if (await warningConfirm.count()) await warningConfirm.check({ force: true });
  await page.locator('[data-help-key="package.export"]').waitFor({ state: "visible", timeout: 10000 });
  try {
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-help-key="package.export"]');
      return button && !button.disabled;
    }, null, { timeout: 10000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      exportDisabled: document.querySelector('[data-help-key="package.export"]')?.getAttribute("disabled") ?? null,
      exportDisabledProperty: document.querySelector('[data-help-key="package.export"]')?.disabled ?? null,
      exportOuter: document.querySelector('[data-help-key="package.export"]')?.outerHTML ?? "",
      panelText: document.querySelector(".cartridge-export-panel")?.textContent?.slice(0, 8000) ?? "",
      preflight: document.querySelector(".preflight-panel")?.textContent?.slice(0, 5000) ?? "",
      blockers: Array.from(document.querySelectorAll(".preflight-panel .is-blocked, .preflight-check-row.is-blocked")).map((node) => node.textContent?.trim()),
      errors: Array.from(document.querySelectorAll(".preflight-panel .is-error")).map((node) => node.textContent?.trim()),
    }));
    throw new Error(`Cartridge export remained blocked: ${JSON.stringify(diagnostics)}; ${error instanceof Error ? error.message : String(error)}`);
  }
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.locator('[data-help-key="package.export"]').click();
  const download = await downloadPromise;
  const cartridgePath = path.join(testDir, "layout-runtime.vncart");
  await download.saveAs(cartridgePath);
  return cartridgePath;
}

function expectClose(actual, expected, label, failures) {
  const delta = Math.abs(actual - expected);
  const tolerance = Math.max(16, Math.abs(expected) * 0.03);
  if (delta > tolerance) failures.push(`${label}: expected ${expected.toFixed(1)}, got ${actual.toFixed(1)}, tolerance ${tolerance.toFixed(1)}`);
}

function expectedBox(frame, rect) {
  const width = frame.width * rect.width / 100;
  const height = frame.height * rect.height / 100;
  let left = frame.x + frame.width * rect.x / 100;
  let top = frame.y + frame.height * rect.y / 100;
  if (rect.anchor === "top_center" || rect.anchor === "bottom_center") left -= width / 2;
  if (rect.anchor === "top_right" || rect.anchor === "bottom_right") left -= width;
  if (rect.anchor === "center") {
    left -= width / 2;
    top -= height / 2;
  }
  if (rect.anchor === "bottom_left" || rect.anchor === "bottom_center" || rect.anchor === "bottom_right") top -= height;
  return { left, top, width, height };
}

function overlap(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

async function measurePlayer(page, viewport, screenshotName) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.waitForTimeout(360);
  await page.screenshot({ path: path.join(outputDir, `${screenshotName}.png`), fullPage: true });
  return page.evaluate(() => {
    const rectOf = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return undefined;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        text: node.textContent ?? "",
        display: style.display,
        visibility: style.visibility,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clientWidth: node.clientWidth,
        clientHeight: node.clientHeight,
        scrollWidth: node.scrollWidth,
        scrollHeight: node.scrollHeight,
        fontSize: Number.parseFloat(style.fontSize) || 0,
        lineHeight: Number.parseFloat(style.lineHeight) || 0,
      };
    };
    const frame = document.querySelector(".runtime-layout-frame")?.getBoundingClientRect();
    return {
      breakpoint: document.querySelector(".ui-skin-scope")?.getAttribute("data-ui-breakpoint"),
      frame: frame ? { x: frame.left, y: frame.top, width: frame.width, height: frame.height, right: frame.right, bottom: frame.bottom } : undefined,
      dialog_panel: rectOf(".dialog-box"),
      speaker_label: rectOf(".dialog-box .speaker"),
      dialog_text: rectOf(".dialog-text"),
      dialog_pages: Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-pages") ?? "1"),
      dialog_page: Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-page") ?? "1"),
      dialog_overflow: document.querySelector(".dialog-box")?.getAttribute("data-dialog-overflow"),
      dialog_font_mode: document.querySelector(".dialog-box")?.getAttribute("data-dialog-font-mode"),
      choice_list: rectOf(".choice-panel"),
      quick_menu: rectOf(".playback-controls"),
      quick_buttons: Array.from(document.querySelectorAll(".quick-menu-surface.is-expanded .quick-menu-button")).map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          clientWidth: node.clientWidth,
          clientHeight: node.clientHeight,
          scrollWidth: node.scrollWidth,
          scrollHeight: node.scrollHeight,
        };
      }),
      safeInsets: (() => {
        const scope = document.querySelector(".ui-skin-scope");
        const style = scope ? getComputedStyle(scope) : undefined;
        const read = (name) => Number.parseFloat(style?.getPropertyValue(name) || "0") || 0;
        return { top: read("--runtime-safe-top"), right: read("--runtime-safe-right"), bottom: read("--runtime-safe-bottom"), left: read("--runtime-safe-left") };
      })(),
      hasHorizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

async function verifyCartridge(cartridgePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridgePath));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  if (!manifest.ui_skin?.path) throw new Error("manifest.json is missing ui_skin.path");
  if (layout.ui_layout_version !== "2.0.0") {
    throw new Error(`ui/layout.json must use unified layout version 2.0.0, got ${layout.ui_layout_version}`);
  }
  const player = layout.screens.find((screen) => screen.screen_id === "player");
  if (!player) throw new Error("ui/layout.json is missing the player screen.");
  const failures = [];
  for (const [componentType, expected] of Object.entries(expectedRects.unified)) {
    const component = player.components.find((item) => item.component_type === componentType);
    if (!component) {
      failures.push(`Missing component ${componentType}`);
      continue;
    }
    if (!component.rect) {
      failures.push(`Missing unified rect for ${componentType}`);
      continue;
    }
    for (const field of ["x", "y", "width", "height"]) {
      if (Math.abs(component.rect[field] - expected[field]) > 0.01) failures.push(`${componentType}.rect.${field} expected ${expected[field]}, got ${component.rect[field]}`);
    }
    if (expected.anchor && component.rect.anchor !== expected.anchor) failures.push(`${componentType}.rect.anchor expected ${expected.anchor}, got ${component.rect.anchor}`);
  }
  const quickMenu = player.components.find((item) => item.component_type === "quick_menu");
  if (!quickMenu?.rect) {
    failures.push("Missing unified rect for quick_menu");
  } else {
    for (const field of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(quickMenu.rect[field])) failures.push(`quick_menu.rect.${field} is not finite`);
    }
    if (quickMenu.rect.width <= 0 || quickMenu.rect.height <= 0) failures.push("quick_menu rect has a non-positive size");
    if (quickMenu.rect.anchor !== expectedRects.quickMenuAnchor) {
      failures.push(`quick_menu.rect.anchor expected ${expectedRects.quickMenuAnchor}, got ${quickMenu.rect.anchor}`);
    }
  }
  for (const screen of layout.screens) {
    for (const component of screen.components) {
      if (component.mobileRect !== undefined) {
        failures.push(`${screen.screen_id}.${component.component_id} exported deprecated mobileRect`);
      }
    }
  }
  if (failures.length) throw new Error(`Cartridge layout mismatch:\n${failures.join("\n")}`);
  return { manifest, layout };
}

async function importAndLaunchGameCli(page, cartridgePath) {
  await page.route("**/runtime-mode.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ mode: "library" }),
  }));
  await page.route("**/fixed-only.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ fixedOnly: false }),
  }));
  await page.addInitScript(() => window.localStorage.removeItem("agentvn.gamecli.webLibrary"));
  await page.goto(gameCliUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    if (document.querySelector('[data-testid="web-cartridge-file"]')) return true;
    const library = document.querySelector('[data-testid="open-library"]');
    if (!(library instanceof HTMLElement)) return false;
    const rect = library.getBoundingClientRect();
    const style = getComputedStyle(library);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }, null, { timeout: 30_000 });
  if (!(await page.locator('[data-testid="web-cartridge-file"]').count())) {
    await page.locator('[data-testid="open-library"]').click();
  }
  await page.locator('[data-testid="web-cartridge-file"]').setInputFiles(cartridgePath);
  await page.locator(".cartridge-spine").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".launch-actions button").first().click();
  await page.locator('[data-testid="start-new-game"]').click();
  await page.locator(".dialog-box").waitFor({ state: "visible", timeout: 10000 });
  let observedDialogPages = 1;
  let clicks = 0;
  for (; clicks < 140; clicks += 1) {
    if (await page.locator(".choice-panel").isVisible().catch(() => false)) {
      return { clicks, observedDialogPages };
    }
    const state = await page.evaluate(() => {
      const dialog = document.querySelector(".dialog-box");
      if (!(dialog instanceof HTMLElement)) return null;
      return {
        page: Number(dialog.dataset.dialogPage || "1"),
        pages: Number(dialog.dataset.dialogPages || "1"),
        done: dialog.dataset.dialogPageDone === "true",
      };
    });
    observedDialogPages = Math.max(observedDialogPages, state?.pages || 1);
    await page.locator(".dialog-box").click();
    if (state?.pages && state.pages > 1 && !state.done) {
      await page.waitForFunction(() => {
        const dialog = document.querySelector(".dialog-box");
        const choice = document.querySelector(".choice-panel");
        return choice || (dialog instanceof HTMLElement && dialog.dataset.dialogPageDone === "true");
      }, null, { timeout: 1200 }).catch(() => undefined);
    } else if (state?.pages && state.page < state.pages) {
      await page.waitForFunction((previousPage) => {
        const dialog = document.querySelector(".dialog-box");
        const choice = document.querySelector(".choice-panel");
        return choice || (dialog instanceof HTMLElement && Number(dialog.dataset.dialogPage || "1") !== previousPage);
      }, state.page, { timeout: 1200 }).catch(() => undefined);
    } else {
      await page.waitForTimeout(150);
    }
  }
  const finalState = await page.locator(".dialog-box").evaluate((dialog) => ({
    page: Number(dialog.getAttribute("data-dialog-page") || "1"),
    pages: Number(dialog.getAttribute("data-dialog-pages") || "1"),
    done: dialog.getAttribute("data-dialog-page-done") === "true",
    text: dialog.textContent?.slice(0, 220) || "",
  })).catch(() => null);
  throw new Error(`Choice panel did not appear after ${clicks} dialog clicks. Last dialog state: ${JSON.stringify(finalState)}`);
}

async function verifyGameCliLayout(page) {
  const measurements = [];
  const failures = [];
  const quickMenuToggle = page.locator('[data-testid="quick-menu-toggle"]');
  if (await quickMenuToggle.getAttribute("aria-expanded") !== "true") {
    await quickMenuToggle.click();
    await page.waitForTimeout(180);
  }
  for (const viewport of viewports) {
    const measurement = await measurePlayer(page, viewport, viewport.name);
    measurements.push({ viewport, measurement });
    if (!measurement.frame) {
      failures.push(`${viewport.name}: missing runtime frame`);
      continue;
    }
    if (!["desktop", "mobile"].includes(measurement.breakpoint)) {
      failures.push(`${viewport.name}: unexpected breakpoint ${measurement.breakpoint}`);
    }
    for (const [componentType, selectorRect] of Object.entries({
      speaker_label: measurement.speaker_label,
      choice_list: measurement.choice_list,
      quick_menu: measurement.quick_menu,
    })) {
      if (!selectorRect) {
        failures.push(`${viewport.name}: missing ${componentType}`);
        continue;
      }
      const minComponentSize = componentType === "speaker_label" ? 12 : componentType === "quick_menu" ? 24 : 40;
      if (selectorRect.width < minComponentSize || selectorRect.height < minComponentSize) {
        failures.push(`${viewport.name}: ${componentType} rendered too small`);
      }
      const frameTolerance = 24;
      if (selectorRect.left < measurement.frame.x - frameTolerance || selectorRect.top < measurement.frame.y - frameTolerance ||
        selectorRect.right > measurement.frame.right + frameTolerance || selectorRect.bottom > measurement.frame.bottom + frameTolerance) {
        failures.push(`${viewport.name}: ${componentType} is outside the runtime frame`);
      }
    }
    for (const [componentType, rect] of Object.entries({
      dialog_panel: expectedRects.unified.dialog_panel,
      dialog_text: expectedRects.unified.dialog_text,
    })) {
      const selectorRect = measurement[componentType];
      if (!selectorRect) {
        failures.push(`${viewport.name}: missing ${componentType}`);
        continue;
      }
      const expected = expectedBox(measurement.frame, rect);
      expectClose(selectorRect.left, expected.left, `${viewport.name}: ${componentType}.left`, failures);
      expectClose(selectorRect.top, expected.top, `${viewport.name}: ${componentType}.top`, failures);
      expectClose(selectorRect.width, expected.width, `${viewport.name}: ${componentType}.width`, failures);
      expectClose(selectorRect.height, expected.height, `${viewport.name}: ${componentType}.height`, failures);
    }
    if (measurement.hasHorizontalScroll) failures.push(`${viewport.name}: document has horizontal scroll`);
    if (measurement.dialog_panel && measurement.choice_list && overlap(measurement.dialog_panel, measurement.choice_list) > 250) {
      failures.push(`${viewport.name}: dialog_panel overlaps choice_list`);
    }
    if (measurement.speaker_label && measurement.dialog_text && overlap(measurement.speaker_label, measurement.dialog_text) > 2) {
      failures.push(`${viewport.name}: speaker_label overlaps dialog_text`);
    }
    if (measurement.speaker_label && measurement.dialog_panel && overlap(measurement.speaker_label, measurement.dialog_panel) < measurement.speaker_label.width * measurement.speaker_label.height * 0.12) {
      failures.push(`${viewport.name}: speaker_label is outside dialog_panel`);
    }
    if (viewport.breakpoint === "mobile" && measurement.quick_menu) {
      const safe = measurement.safeInsets;
      const safeLeft = measurement.frame.x + safe.left;
      const safeTop = measurement.frame.y + safe.top;
      const safeRight = measurement.frame.right - safe.right;
      const safeBottom = measurement.frame.bottom - safe.bottom;
      if (measurement.quick_menu.left < safeLeft - 2 || measurement.quick_menu.right > safeRight + 2
        || measurement.quick_menu.top < safeTop - 2 || measurement.quick_menu.bottom > safeBottom + 2) {
        failures.push(`${viewport.name}: quick_menu leaves the mobile safe area`);
      }
    }
    for (let leftIndex = 0; leftIndex < measurement.quick_buttons.length; leftIndex += 1) {
      const left = measurement.quick_buttons[leftIndex];
      if (left.scrollWidth > left.clientWidth + 2 || left.scrollHeight > left.clientHeight + 2) {
        failures.push(`${viewport.name}: quick-menu button is clipped`);
      }
      for (let rightIndex = leftIndex + 1; rightIndex < measurement.quick_buttons.length; rightIndex += 1) {
        if (overlap(left, measurement.quick_buttons[rightIndex]) > 2) failures.push(`${viewport.name}: quick-menu buttons overlap`);
      }
    }
    if (!measurement.dialog_text) {
      failures.push(`${viewport.name}: missing dialog_text`);
    } else {
      const clippedX = measurement.dialog_text.scrollWidth > measurement.dialog_text.clientWidth + 2;
      const scrollableX = ["auto", "scroll"].includes(measurement.dialog_text.overflowX);
      if (scrollableX) failures.push(`${viewport.name}: dialog_text uses horizontal scrolling`);
      if (clippedX) failures.push(`${viewport.name}: dialog_text is horizontally clipped`);
      if (measurement.dialog_text.clientHeight + 1 < measurement.dialog_text.lineHeight) {
        failures.push(`${viewport.name}: dialog_text cannot display one complete line`);
      }
      const verticallyOverflowing = measurement.dialog_text.scrollHeight > measurement.dialog_text.clientHeight + 2;
      if (verticallyOverflowing && !["auto", "scroll"].includes(measurement.dialog_text.overflowY)) {
        failures.push(`${viewport.name}: overflowing dialog_text is not vertically accessible`);
      }
      if (verticallyOverflowing && measurement.dialog_overflow !== "scroll") {
        failures.push(`${viewport.name}: dialog overflow state is not reported as scroll`);
      }
      if (verticallyOverflowing && measurement.dialog_pages < 2) {
        failures.push(`${viewport.name}: overflowing dialog_text did not expose measured pages`);
      }
    }
  }

  const maxDialogPages = Math.max(...measurements.map((item) => item.measurement.dialog_pages || 1));
  if (maxDialogPages < 2) failures.push("long dialog did not expose runtime pagination");

  await page.setViewportSize({ width: 1920, height: 1080 });
  const beforeResize = await measurePlayer(page, { width: 1920, height: 1080 }, "resize-before");
  await page.setViewportSize({ width: 390, height: 844 });
  const afterResize = await measurePlayer(page, { width: 390, height: 844 }, "resize-after");
  if (beforeResize.breakpoint === afterResize.breakpoint) failures.push("resize verification did not switch breakpoints without reload");

  return { measurements, failures };
}

async function main() {
  resetOutputDirs();
  const projectPath = path.join(testDir, "layout-runtime.vnproj");
  saveProjectContainerSync(projectPath, buildProjectFile(), { container: "zip" });

  const children = [];
  const report = {
    startedAt: new Date().toISOString(),
    projectPath,
    expectedRects,
    viewports,
    artifacts: { outputDir, testDir },
    checks: [],
  };

  try {
    const editorServer = await ensureServer("editor-dev", editorUrl, path.join(root, "editor"));
    const gameCliServer = await ensureServer("gamecli-dev", gameCliUrl, path.join(root, "GameCli_framework"));
    if (editorServer) children.push(editorServer);
    if (gameCliServer) children.push(gameCliServer);

    const browser = await chromium.launch({ headless: !headed });
    try {
      const editorPage = await browser.newPage({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
      await importProject(editorPage, projectPath);
      await designAndSaveLayout(editorPage);
      const cartridgePath = await exportCartridge(editorPage);
      report.cartridgePath = cartridgePath;
      report.cartridge = await verifyCartridge(cartridgePath);
      report.checks.push("editor layout saved and exported to ui/layout.json");

      const gamePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      report.runtimeLaunch = await importAndLaunchGameCli(gamePage, cartridgePath);
      const runtimeResult = await verifyGameCliLayout(gamePage);
      report.runtime = runtimeResult;
      if (runtimeResult.failures.length > 0) throw new Error(`GameCLI layout assertions failed:\n${runtimeResult.failures.join("\n")}`);
      report.checks.push("GameCLI consumed desktop/mobile runtime layout across viewport matrix");
    } finally {
      await browser.close();
    }
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? error.stack ?? error.message : String(error);
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "layout-runtime-report.json"), JSON.stringify(report, null, 2), "utf8");
    for (const child of children) stopDevServer(child);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
