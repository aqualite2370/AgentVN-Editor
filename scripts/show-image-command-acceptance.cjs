const fs = require("fs");
const path = require("path");
const { loadProjectContainerSync, saveProjectContainerSync } = require("./project-container.cjs");
const { spawn, spawnSync } = require("child_process");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const testDir = path.join(root, "test_AgentVN", "show-image-command");
const outputDir = path.join(root, "output", "playwright", "show-image-command");
const editorUrl = "http://127.0.0.1:6767/";
const gameCliUrl = "http://127.0.0.1:6868/";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const headed = process.argv.includes("--headed");
const runtimeMarkerPaths = [
  path.join(root, "GameCli_framework", "public", "fixed-only.json"),
  path.join(root, "GameCli_framework", "public", "runtime-mode.json"),
];

function isolateLibraryRuntime() {
  const backup = runtimeMarkerPaths.map((markerPath) => ({
    markerPath,
    existed: fs.existsSync(markerPath),
    content: fs.existsSync(markerPath) ? fs.readFileSync(markerPath) : undefined,
  }));
  for (const { markerPath } of backup) {
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
  }
  return () => {
    for (const { markerPath, existed, content } of backup) {
      if (existed && content) fs.writeFileSync(markerPath, content);
      else if (fs.existsSync(markerPath)) fs.rmSync(markerPath, { force: true });
    }
  };
}

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Refusing to operate outside workspace: ${resolved}`);
  }
  return resolved;
}

function resetOutput() {
  for (const dir of [testDir, outputDir]) {
    fs.rmSync(assertInsideRoot(dir), { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
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

function startServer(name, cwd) {
  const child = spawn(npmCommand, ["run", "dev"], {
    cwd,
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logPath = path.join(outputDir, `${name}.log`);
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

async function ensureServer(name, url, cwd) {
  if (await isListening(url)) return undefined;
  const child = startServer(name, cwd);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await isListening(url)) return child;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`${name} did not start at ${url}.`);
}

function svgData(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function asset(assetId, assetType, filename, svg, now) {
  const dataUrl = svgData(svg);
  return {
    asset_id: assetId,
    asset_type: assetType,
    metadata: {
      display_name: assetId === "clue_photo" ? "沾血的钥匙" : "验收背景",
      filename,
      mime_type: "image/svg+xml",
      size_bytes: Buffer.byteLength(svg, "utf8"),
      source: "bundled",
      license_note: "Generated only for show_image acceptance.",
      data_url: dataUrl,
      blob_url: dataUrl,
      project_path: `assets/${assetType}/${filename}`,
      created_at: now,
    },
  };
}

function buildProject() {
  const now = new Date().toISOString();
  const backgroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#17324d"/><circle cx="180" cy="140" r="90" fill="#e5b85c"/><text x="70" y="650" fill="#fff" font-size="52" font-family="sans-serif">SHOW IMAGE BACKDROP</text></svg>`;
  const clueSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620"><rect width="900" height="620" fill="#f7f0df"/><rect x="40" y="40" width="820" height="540" fill="#2a2724"/><circle cx="345" cy="300" r="118" fill="none" stroke="#d9b65f" stroke-width="42"/><path d="M455 300h300v62h-78v72h-72v-72h-150z" fill="#d9b65f"/><path d="M220 160c95-70 260-68 355 8" fill="none" stroke="#8f1723" stroke-width="22"/><text x="250" y="535" fill="#f7f0df" font-size="42" font-family="sans-serif">DORM 07</text></svg>`;
  const scene = {
    scene_id: "show_image_scene",
    title: "Show Image Acceptance Scene",
    summary: "Creates show_image through the real editor and verifies GameCli rendering.",
    chapter: 1,
    tags: ["show-image", "acceptance"],
    commands: [
      { type: "background", background_id: "show_image_bg", background_fit: "cover", transition: "fade" },
      { type: "narration", text: "桌上的旧钥匙忽然映入眼帘。" },
      { type: "narration", text: "我把钥匙收进口袋，继续向旧宿舍走去。" },
      { type: "dialog", character_id: "keeper", text: "这张照片不该出现在这里。" },
      { type: "dialog", character_id: "keeper", text: "把它收好，别让其他人看见。" },
    ],
  };
  const followupScene = {
    scene_id: "show_image_followup",
    title: "Follow-up Scene",
    summary: "Verifies that narration appearance applies across scene nodes.",
    chapter: 1,
    tags: ["narration-style", "acceptance"],
    commands: [
      { type: "narration", text: "走廊尽头的灯随即熄灭。" },
    ],
  };
  return {
    schema_version: "1.0.0",
    project_id: `show_image_acceptance_${Date.now()}`,
    title: "Show Image Command Acceptance",
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
        id: "show_image_scene_node",
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
      {
        id: "show_image_followup_node",
        type: "sceneNode",
        position: { x: 700, y: 180 },
        data: {
          nodeKind: "scene",
          label: followupScene.title,
          description: followupScene.summary,
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
          scene: followupScene,
        },
      },
    ],
    edges: [
      { id: "edge_start_show_image", source: "start", target: "show_image_scene_node", sourceHandle: "default" },
      { id: "edge_show_image_followup", source: "show_image_scene_node", target: "show_image_followup_node", sourceHandle: "default" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: [
      asset("show_image_bg", "background", "show-image-bg.svg", backgroundSvg, now),
      asset("clue_photo", "ui", "clue-photo.svg", clueSvg, now),
    ],
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
    const hasReadyEntry = await page.waitForFunction(() => {
      const stage = document.querySelector(".app-transition-stage");
      const entry = Array.from(document.querySelectorAll('[data-help-key="home.openDraft"], [data-help-key="home.recentProject"]'))
        .find((element) => {
          if (!(element instanceof HTMLButtonElement) || element.disabled) return false;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0
            && rect.height > 0
            && style.visibility !== "hidden"
            && style.display !== "none"
            && Number.parseFloat(style.opacity || "1") > 0.01;
        });
      return Boolean(entry)
        && !document.querySelector(".project-entry-loading-overlay")
        && !stage?.classList.contains("is-home-hydrating");
    }, null, { timeout: 30000 }).then(() => true).catch(() => false);
    if (hasReadyEntry) {
      const resumableEntry = page.locator(
        '[data-help-key="home.openDraft"]:visible:not(:disabled), [data-help-key="home.recentProject"]:visible:not(:disabled)',
      ).first();
      await resumableEntry.click({ force: true });
    } else {
      await page.waitForFunction(() => {
        const input = document.querySelector(".project-import-button input");
        const button = document.querySelector(".project-import-button");
        return input && !input.disabled && button?.getAttribute("aria-disabled") !== "true";
      }, null, { timeout: 20000 });
      await page.locator(".project-import-button input").first().setInputFiles(projectPath);
      const importedEntry = page.locator(
        '[data-help-key="home.openDraft"]:visible:not(:disabled), [data-help-key="home.recentProject"]:visible:not(:disabled)',
      ).first();
      await importedEntry.waitFor({ state: "visible", timeout: 20000 });
      await importedEntry.click({ force: true });
    }
  }
  try {
    await toolbar.waitFor({ state: "visible", timeout: 20000 });
  } catch (error) {
    fs.writeFileSync(path.join(outputDir, "editor-import-dom.html"), await page.content());
    await page.screenshot({ path: path.join(outputDir, "editor-import-failure.png"), fullPage: true });
    throw error;
  }
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => {
    const stage = document.querySelector(".app-transition-stage");
    return !document.querySelector(".project-entry-loading-overlay") &&
      !stage?.classList.contains("is-switching") &&
      !stage?.classList.contains("is-enter-cartridge") &&
      !stage?.classList.contains("is-project-entry-loading");
  }, null, { timeout: 30000 });
  await page.locator(".app-view-editor.is-active .react-flow__node").first().waitFor({
    state: "visible",
    timeout: 30000,
  });
}

async function selectAsset(page, scope, helpKey, assetId, assetType) {
  await scope.locator(`button[data-help-key="${helpKey}.openPicker"]`).click({ force: true });
  if (assetType) {
    const typeTab = page.locator(`button[data-help-key="${helpKey}.type"][data-asset-type="${assetType}"]`);
    if (await typeTab.isVisible().catch(() => false)) await typeTab.click({ force: true });
  }
  const option = page.locator(`button[data-help-key="${helpKey}.select"][data-asset-id="${assetId}"]`);
  await option.waitFor({ state: "visible", timeout: 10000 });
  await option.click({ force: true });
}

async function ensureCommandCardBody(page, card, debugName) {
  await card.waitFor({ state: "visible", timeout: 10000 });
  await card.locator(".command-card-header").scrollIntoViewIfNeeded().catch(() => {});
  const body = card.locator(".command-card-body");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await body.isVisible().catch(() => false)) return body;
    await page.waitForTimeout(240);
    if (await body.isVisible().catch(() => false)) return body;
    await card.evaluate((element) => {
      if (!element.classList.contains("is-collapsed")) return;
      const button = element.querySelector('button[data-help-key="command.expand"]');
      if (button instanceof HTMLElement) button.click();
    }).catch(() => {});
  }
  if (!(await body.isVisible().catch(() => false))) {
    const safeName = String(debugName || "command-card").replace(/[^A-Za-z0-9._-]+/g, "-");
    fs.writeFileSync(path.join(outputDir, safeName + "-dom.html"), await page.content(), "utf8");
    await page.screenshot({ path: path.join(outputDir, safeName + "-collapsed.png"), fullPage: true }).catch(() => {});
  }
  await body.waitFor({ state: "visible", timeout: 10000 });
  return body;
}

async function addWorkbenchCommand(page, typeLabel) {
  const cards = page.locator(".command-card");
  const before = await cards.count();
  const workbench = page.locator(".floating-command-workbench");
  const typeButton = workbench.locator('button[data-help-key="workbench.commandType"]').filter({ hasText: typeLabel }).first();
  await typeButton.waitFor({ state: "visible", timeout: 10000 });
  await typeButton.click({ force: true });
  await page.waitForTimeout(280);
  return {
    workbench,
    cards,
    before,
    async commit() {
      await workbench.locator('button[data-help-key="workbench.addCommand"]').click({ force: true });
      const card = cards.nth(before);
      await ensureCommandCardBody(page, card, "command-card-" + before);
      return card;
    },
  };
}

async function createCommandsThroughEditor(page) {
  const sceneNode = page.locator('.react-flow__node[data-id="show_image_scene_node"]').first();
  await sceneNode.waitFor({ state: "visible", timeout: 15000 });
  await sceneNode.click({ position: { x: 44, y: 34 } });
  if (!(await sceneNode.locator(".scene-node.is-selected").count())) {
    await sceneNode.focus();
    await page.keyboard.press("Enter");
  }
  try {
    await page.locator(".command-card").first().waitFor({ state: "visible", timeout: 15000 });
  } catch (error) {
    fs.writeFileSync(path.join(outputDir, "editor-scene-selection-dom.html"), await page.content());
    await page.screenshot({ path: path.join(outputDir, "editor-scene-selection-failure.png"), fullPage: true });
    throw error;
  }
  if (!(await page.locator(".floating-command-workbench").isVisible().catch(() => false))) {
    await page.locator('.command-workbench-launcher button[data-help-key="workbench.commandType"]').click({ force: true });
    await page.locator(".floating-command-workbench").waitFor({ state: "visible", timeout: 10000 });
  }

  const firstNarrationCard = page.locator(".command-card").nth(1);
  const firstNarrationBody = await ensureCommandCardBody(page, firstNarrationCard, "first-narration-card");
  const narrationEditorCopy = await firstNarrationBody.innerText();
  if (/\\u[0-9a-f]{4}/i.test(narrationEditorCopy)) {
    throw new Error(`Narration editor contains literal Unicode escapes: ${narrationEditorCopy}`);
  }
  const narrationFitTrigger = firstNarrationBody.locator('button[data-help-key="command.narration.style.backgroundFit"]');
  await narrationFitTrigger.click();
  await page.locator('.rich-select-popover[role="listbox"] .rich-select-option').filter({ hasText: "完整显示" }).click();
  if (!(await narrationFitTrigger.innerText()).includes("完整显示")) {
    throw new Error(`Narration background fit did not apply before selecting an asset: ${await narrationFitTrigger.innerText()}`);
  }
  await selectAsset(page, firstNarrationBody, "command.narration.style.background", "clue_photo", "ui");
  if (!(await narrationFitTrigger.innerText()).includes("完整显示")) {
    throw new Error(`Narration background fit was lost after selecting an asset: ${await narrationFitTrigger.innerText()}`);
  }
  await firstNarrationBody.locator('button[data-help-key="command.narration.style.applyAll"]').click();
  const firstDialogCard = page.locator(".command-card").nth(3);
  const firstDialogBody = await ensureCommandCardBody(page, firstDialogCard, "first-dialog-card");
  const dialogFitTrigger = firstDialogBody.locator('button[data-help-key="command.dialog.style.backgroundFit"]');
  await dialogFitTrigger.click();
  await page.locator('.rich-select-popover[role="listbox"] .rich-select-option').filter({ hasText: "完整显示" }).click();
  if (!(await dialogFitTrigger.innerText()).includes("完整显示")) {
    throw new Error(`Dialog background fit did not apply before selecting an asset: ${await dialogFitTrigger.innerText()}`);
  }
  await selectAsset(page, firstDialogBody, "command.dialog.style.background", "clue_photo", "ui");
  if (!(await dialogFitTrigger.innerText()).includes("完整显示")) {
    throw new Error(`Dialog background fit was lost after selecting an asset: ${await dialogFitTrigger.innerText()}`);
  }
  await dialogFitTrigger.click();
  await page.locator('.rich-select-popover[role="listbox"] .rich-select-option').filter({ hasText: "裁切铺满" }).click();
  await firstDialogBody.locator('button[data-help-key="command.dialog.style.saveDefault"]').click();
  await firstDialogBody.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outputDir, "editor-dialog-background-fit.png"), fullPage: true });

  const showImage = await addWorkbenchCommand(page, "展示图片");
  await selectAsset(page, showImage.workbench, "command.showImage.imageId", "clue_photo", "ui");
  const showImageCard = await showImage.commit();
  await showImageCard.locator('[data-help-key="command.showImage.displayName"]').fill("沾血的钥匙");
  await showImageCard.locator('[data-help-key="command.showImage.caption"]').fill("钥匙背面刻着旧宿舍编号。");
  await showImageCard.locator('[data-help-key="command.showImage.alt"]').fill("一把带有 DORM 07 编号的旧钥匙");
  await showImageCard.locator('[data-help-key="command.showImage.backdropOpacity"]').fill("0.62");
  await showImageCard.locator('[data-help-key="command.showImage.backdropBlur"]').fill("12");

  const cards = page.locator(".command-card");
  const dragHandle = showImageCard.locator('[data-help-key="command.drag"]');
  await cards.nth(2).locator(".command-card-header").scrollIntoViewIfNeeded();
  await dragHandle.scrollIntoViewIfNeeded();
  const source = await dragHandle.boundingBox();
  const target = await cards.nth(2).locator(".command-card-header").boundingBox();
  if (!source || !target) throw new Error("Cannot measure command cards for show_image reorder.");
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height * 0.25, { steps: 12 });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(450);
  const reorderedLabel = await cards.nth(2).locator(".command-card-summary strong").innerText();
  if (!reorderedLabel.includes("展示图片")) throw new Error(`show_image reorder failed: ${reorderedLabel}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, "editor-show-image-command.png"), fullPage: true });
}

async function selectRichOptionByIndex(page, helpKey, optionIndex) {
  await page.locator(`button[data-help-key="${helpKey}"]`).first().click();
  const option = page.locator('.rich-select-popover[role="listbox"] .rich-select-option').nth(optionIndex);
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
}

async function exportCartridge(page) {
  await page.locator('[data-workspace-surface="publish"]:visible').click({ force: true });
  await page.locator(".cartridge-export-panel").waitFor({ state: "visible", timeout: 10000 });
  const modeTrigger = page.locator('button[data-help-key="package.mode"]');
  await modeTrigger.click();
  await page.locator('.rich-select-popover[role="listbox"] .rich-select-option')
    .filter({ hasText: "游戏卡带 .vncart" })
    .click();
  await page.waitForFunction(() => {
    const trigger = document.querySelector('button[data-help-key="package.mode"]');
    return trigger?.textContent?.includes("游戏卡带 .vncart");
  }, null, { timeout: 5000 });
  const checksStage = page.locator('[data-package-stage="checks"]');
  if (await checksStage.count()) {
    await checksStage.click({ force: true });
  }
  const warningConfirm = page.locator('input[data-help-key="package.confirmWarnings"]');
  if (await warningConfirm.count()) {
    await warningConfirm.check({ force: true });
  }
  await page.locator('[data-package-stage="settings"]').click({ force: true }).catch(() => {});
  const exportButton = page.locator('[data-help-key="package.export"]');
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-help-key="package.export"]');
    return button && !button.disabled;
  }, null, { timeout: 15000 }).catch(async (error) => {
    const diagnostics = await page.evaluate(() => ({
      mode: document.querySelector('button[data-help-key="package.mode"]')?.textContent ?? "",
      exportDisabled: document.querySelector('[data-help-key="package.export"]')?.disabled ?? true,
      exportText: document.querySelector('[data-help-key="package.export"]')?.textContent ?? "",
      environmentStatus: document.querySelector('[data-help-key="package.export"]')?.getAttribute("data-environment-status") ?? "",
      overview: document.querySelector(".package-stage-overview")?.textContent ?? "",
      checks: [...document.querySelectorAll(".preflight-check")].map((element) => element.textContent?.trim() ?? ""),
      warnings: document.querySelector('input[data-help-key="package.confirmWarnings"]')?.outerHTML ?? "",
      body: document.querySelector(".cartridge-export-panel")?.innerText.slice(-1800) ?? "",
    }));
    fs.writeFileSync(path.join(outputDir, "export-timeout-diagnostics.json"), JSON.stringify(diagnostics, null, 2), "utf8");
    throw error;
  });
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await exportButton.click();
  const download = await downloadPromise;
  const cartridgePath = path.join(testDir, "show-image-command.vncart");
  await download.saveAs(cartridgePath);
  return cartridgePath;
}

async function inspectCartridge(cartridgePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridgePath));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  const command = script.scenes.flatMap((scene) => scene.commands).find((item) => item.type === "show_image");
  if (!command) throw new Error("Exported script.json does not contain show_image.");
  const expected = {
    image_id: "clue_photo",
    image_fit: "contain",
    image_display_name: "沾血的钥匙",
    caption: "钥匙背面刻着旧宿舍编号。",
    alt: "一把带有 DORM 07 编号的旧钥匙",
    backdrop_opacity: 0.62,
    backdrop_blur_px: 12,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (command[key] !== value) throw new Error(`Exported show_image.${key} expected ${value}, got ${command[key]}.`);
  }
  const narration = script.scenes
    .flatMap((scene) => scene.commands)
    .find((item) => item.type === "narration" && item.text === "桌上的旧钥匙忽然映入眼帘。");
  if (
    narration?.dialog_style_mode !== "manual"
    || narration.dialog_style?.background_asset_id !== "clue_photo"
    || narration.dialog_style?.background_fit !== "contain"
  ) {
    throw new Error(`Exported narration did not retain its dialog background: ${JSON.stringify(narration)}.`);
  }
  const secondNarration = script.scenes
    .flatMap((scene) => scene.commands)
    .find((item) => item.type === "narration" && item.text === "我把钥匙收进口袋，继续向旧宿舍走去。");
  if (
    secondNarration?.dialog_style_mode !== "manual"
    || secondNarration.dialog_style?.background_asset_id !== "clue_photo"
    || secondNarration.dialog_style?.background_fit !== "contain"
  ) {
    throw new Error(`Apply-all did not update the second narration style: ${JSON.stringify(secondNarration)}.`);
  }
  const crossSceneNarration = script.scenes
    .flatMap((scene) => scene.commands)
    .find((item) => item.type === "narration" && item.text === "走廊尽头的灯随即熄灭。");
  if (
    crossSceneNarration?.dialog_style_mode !== "manual"
    || crossSceneNarration.dialog_style?.background_asset_id !== "clue_photo"
    || crossSceneNarration.dialog_style?.background_fit !== "contain"
  ) {
    throw new Error(`Apply-all did not update narration in another scene: ${JSON.stringify(crossSceneNarration)}.`);
  }
  const keeper = script.characters?.find((character) => character.character_id === "keeper");
  if (keeper?.dialog_style?.background_asset_id !== "clue_photo" || keeper.dialog_style.background_fit !== "cover") {
    throw new Error(`Exported character default did not retain its dialog background fit: ${JSON.stringify(keeper)}.`);
  }
  const keeperDialogs = script.scenes
    .flatMap((scene) => scene.commands)
    .filter((item) => item.type === "dialog" && item.character_id === "keeper");
  if (
    keeperDialogs[0]?.dialog_style_mode !== "manual"
    || keeperDialogs[0]?.dialog_style?.background_fit !== "cover"
    || keeperDialogs[1]?.dialog_style_mode === "manual"
  ) {
    throw new Error(`Exported keeper dialogs do not preserve manual/default priority: ${JSON.stringify(keeperDialogs)}.`);
  }
  const assetEntry = manifest.assets.find((item) => item.asset_id === "clue_photo");
  if (!assetEntry || !zip.file(assetEntry.path)) throw new Error("clue_photo was not packaged into the cartridge.");
  return { command, narration, secondNarration, crossSceneNarration, keeper, keeperDialogs, asset: assetEntry };
}

async function seedRuntimeStorage(page) {
  await page.addInitScript(() => {
    localStorage.removeItem("agentvn.gamecli.webLibrary");
    localStorage.setItem("vn.runtime.settings", JSON.stringify({
      schemaVersion: 5,
      textSpeed: 0,
      autoSpeed: 1200,
      skipUnread: true,
      volumeBgm: 0.8,
      volumeSfx: 0.9,
      volumeVoice: 0.9,
      fullscreen: false,
      language: "zh-CN",
      theme: { mode: "cartridge", presetId: "default", customTokens: {} },
    }));
  });
}

async function launchCartridge(page, cartridgePath) {
  await seedRuntimeStorage(page);
  await page.goto(gameCliUrl, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="web-cartridge-file"]').setInputFiles(cartridgePath);
  await page.locator(".cartridge-spine").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".launch-actions button").first().click();
  await page.locator('[data-testid="start-new-game"]').waitFor({ state: "visible", timeout: 10000 });
  await page.locator('[data-testid="start-new-game"]').click();
  await page.locator(".story-player").waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".dialog-box").waitFor({ state: "visible", timeout: 10000 });
  const narrationDialogBackground = await page.locator(".dialog-box").evaluate((element) => getComputedStyle(element).backgroundImage);
  if (!narrationDialogBackground || narrationDialogBackground === "none") {
    throw new Error(`GameCLI did not render the narration dialog background: ${narrationDialogBackground}.`);
  }
  const narrationDialogBackgroundSize = await page.locator(".dialog-box").evaluate((element) => getComputedStyle(element).backgroundSize);
  if (narrationDialogBackgroundSize !== "contain") {
    throw new Error(`GameCLI narration dialog background size should be contain, got ${narrationDialogBackgroundSize}.`);
  }
  const viewport = page.viewportSize();
  await page.screenshot({
    path: path.join(outputDir, `narration-background-${viewport?.width ?? 0}x${viewport?.height ?? 0}.png`),
    fullPage: true,
  });
}

async function advanceToFocusedImage(page, enableFastModes) {
  if (enableFastModes) {
    const quickMenu = page.locator(".playback-controls");
    const toggle = quickMenu.locator('[data-testid="quick-menu-toggle"]');
    await toggle.waitFor({ state: "visible", timeout: 10000 });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click({ force: true });
    }
    const autoButton = quickMenu.locator('[data-ui-component-id="quick_auto_button"]');
    const skipButton = quickMenu.locator('[data-ui-component-id="quick_skip_button"]');
    await autoButton.waitFor({ state: "visible", timeout: 10000 });
    await skipButton.waitFor({ state: "visible", timeout: 10000 });
    for (const index of [0, 1]) {
      await page.evaluate((buttonIndex) => {
        const ids = ["quick_auto_button", "quick_skip_button"];
        const button = document.querySelector(`[data-ui-component-id="${ids[buttonIndex]}"]`);
        if (button?.getAttribute("aria-pressed") !== "true" && button instanceof HTMLElement) button.click();
      }, index);
      await page.waitForFunction((buttonIndex) => {
        const ids = ["quick_auto_button", "quick_skip_button"];
        const button = document.querySelector(`[data-ui-component-id="${ids[buttonIndex]}"]`);
        return button?.getAttribute("aria-pressed") === "true" || Boolean(document.querySelector('[data-testid="focused-image-overlay"]'));
      }, index, { timeout: 3000 });
    }
    // Auto/skip can reach the blocking image while the old dialog node is
    // still mounted behind the overlay. Clicking it with force would dismiss
    // the very overlay this assertion is waiting for.
    const overlay = page.locator('[data-testid="focused-image-overlay"]');
    await overlay.waitFor({ state: "visible", timeout: 8000 });
    return;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const dialog = page.locator(".dialog-box");
    if (await dialog.isVisible().catch(() => false)) await dialog.click({ force: true });
    else await page.locator(".story-player").click({ position: { x: 420, y: 180 }, force: true });
    if (await page.locator('[data-testid="focused-image-overlay"]').isVisible({ timeout: 700 }).catch(() => false)) return;
    await page.waitForTimeout(120);
  }
  await page.locator('[data-testid="focused-image-overlay"]').waitFor({ state: "visible", timeout: 8000 });
}

async function measureOverlay(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector("[data-testid='focused-image-overlay']");
    const backdrop = document.querySelector("[data-testid='focused-image-backdrop']");
    const image = document.querySelector("[data-testid='focused-image']");
    const media = document.querySelector(".focused-image-media");
    const figure = document.querySelector(".focused-image-figure");
    const caption = document.querySelector(".focused-image-figure figcaption");
    const frame = document.querySelector(".runtime-layout-frame");
    const player = document.querySelector(".story-player");
    const control = document.querySelector('[data-ui-component-id="quick_auto_button"]');
    if (!(overlay instanceof HTMLElement) || !(backdrop instanceof HTMLElement) || !(image instanceof HTMLImageElement) || !(media instanceof HTMLElement) || !(figure instanceof HTMLElement) || !(frame instanceof HTMLElement) || !(player instanceof HTMLElement)) {
      throw new Error("Focused image overlay DOM is incomplete.");
    }
    const overlayRect = overlay.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    const mediaRect = media.getBoundingClientRect();
    const figureRect = figure.getBoundingClientRect();
    const captionRect = caption?.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const playerRect = player.getBoundingClientRect();
    const overlayStyle = getComputedStyle(overlay);
    const backdropStyle = getComputedStyle(backdrop);
    let controlIntercepted = false;
    if (control instanceof HTMLElement) {
      const rect = control.getBoundingClientRect();
      controlIntercepted = Boolean(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest("[data-testid='focused-image-overlay']"));
    }
    return {
      phase: overlay.dataset.phase,
      imageId: overlay.dataset.imageId,
      objectFit: getComputedStyle(image).objectFit,
      backdropColor: backdropStyle.backgroundColor,
      backdropFilter: backdropStyle.backdropFilter || backdropStyle.webkitBackdropFilter,
      imageComplete: image.complete && image.naturalWidth > 0,
      overlayRect: { left: overlayRect.left, top: overlayRect.top, width: overlayRect.width, height: overlayRect.height },
      playerRect: { left: playerRect.left, top: playerRect.top, width: playerRect.width, height: playerRect.height },
      figureRect: { left: figureRect.left, top: figureRect.top, width: figureRect.width, height: figureRect.height },
      imageRect: { left: imageRect.left, top: imageRect.top, width: imageRect.width, height: imageRect.height },
      mediaRect: { left: mediaRect.left, top: mediaRect.top, width: mediaRect.width, height: mediaRect.height },
      captionRect: captionRect ? { left: captionRect.left, top: captionRect.top, width: captionRect.width, height: captionRect.height } : null,
      frameRect: { left: frameRect.left, top: frameRect.top, width: frameRect.width, height: frameRect.height },
      overlayLayout: { padding: overlayStyle.padding, alignItems: overlayStyle.alignItems, justifyItems: overlayStyle.justifyItems },
      controlIntercepted,
      autoActive: Boolean(document.querySelector('[data-ui-component-id="quick_auto_button"].active, [data-ui-component-id="quick_auto_button"][aria-pressed="true"]')),
      skipActive: Boolean(document.querySelector('[data-ui-component-id="quick_skip_button"].active, [data-ui-component-id="quick_skip_button"][aria-pressed="true"]')),
    };
  });
}

function assertOverlayMeasurement(measurement, label) {
  if (measurement.phase !== "visible") throw new Error(`${label}: overlay phase is ${measurement.phase}.`);
  if (measurement.imageId !== "clue_photo") throw new Error(`${label}: wrong image id ${measurement.imageId}.`);
  if (measurement.objectFit !== "contain") throw new Error(`${label}: object-fit is ${measurement.objectFit}.`);
  if (!measurement.imageComplete) throw new Error(`${label}: focused image did not finish loading.`);
  if (!/0\.62\)/.test(measurement.backdropColor)) throw new Error(`${label}: backdrop opacity is not 0.62 (${measurement.backdropColor}).`);
  if (!/blur\(12px\)/.test(measurement.backdropFilter)) throw new Error(`${label}: backdrop blur is not 12px (${measurement.backdropFilter}).`);
  if (!measurement.controlIntercepted) throw new Error(`${label}: overlay does not intercept playback controls.`);
  const centerX = measurement.imageRect.left + measurement.imageRect.width / 2;
  const centerY = measurement.imageRect.top + measurement.imageRect.height / 2;
  const frameCenterX = measurement.frameRect.left + measurement.frameRect.width / 2;
  const frameCenterY = measurement.frameRect.top + measurement.frameRect.height / 2;
  if (Math.abs(centerX - frameCenterX) > measurement.frameRect.width * 0.08) {
    throw new Error(`${label}: image is not horizontally centered (${centerX.toFixed(1)} vs ${frameCenterX.toFixed(1)}).`);
  }
  if (Math.abs(centerY - frameCenterY) > measurement.frameRect.height * 0.12) {
    throw new Error(`${label}: image is not vertically centered (${centerY.toFixed(1)} vs ${frameCenterY.toFixed(1)}). Measurement: ${JSON.stringify(measurement)}`);
  }
}

async function dismissAndVerify(page, method, screenshotPrefix) {
  const overlay = page.locator('[data-testid="focused-image-overlay"]');
  const started = Date.now();
  if (method === "click") await overlay.click({ position: { x: 12, y: 12 } });
  else await page.keyboard.press(method);
  await page.locator('[data-testid="focused-image-overlay"][data-phase="exiting"]').waitFor({ state: "visible", timeout: 1000 });
  await page.screenshot({ path: path.join(outputDir, `${screenshotPrefix}-exiting.png`), fullPage: true });
  try {
    await overlay.waitFor({ state: "detached", timeout: 1500 });
  } catch (error) {
    const probe = await page.evaluate(() => window.__AGENTVN_FOCUSED_IMAGE_LOG__ ?? []);
    throw new Error(`Focused image did not finish dismissing. Probe: ${JSON.stringify(probe)}. ${error.message}`);
  }
  const elapsedMs = Date.now() - started;
  await page.locator(".dialog-text").filter({ hasText: "我把钥匙收进口袋" }).waitFor({ state: "visible", timeout: 3000 });
  if (elapsedMs < 120 || elapsedMs > 800) throw new Error(`${screenshotPrefix}: fade duration ${elapsedMs}ms is outside expected range.`);
  return elapsedMs;
}

async function verifyKeeperDialogBackgroundFit(page, screenshotPrefix) {
  const quickMenu = page.locator(".playback-controls");
  const toggle = quickMenu.locator('[data-testid="quick-menu-toggle"]');
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click({ force: true });
  }
  const autoButton = quickMenu.locator('[data-ui-component-id="quick_auto_button"]');
  const skipButton = quickMenu.locator('[data-ui-component-id="quick_skip_button"]');
  await autoButton.waitFor({ state: "visible", timeout: 5000 });
  await skipButton.waitFor({ state: "visible", timeout: 5000 });
  if ((await autoButton.getAttribute("aria-pressed")) === "true") await autoButton.click();
  if ((await skipButton.getAttribute("aria-pressed")) === "true") await skipButton.click();

  const dialogBox = page.locator(".dialog-box");
  async function advanceToText(text) {
    const target = page.locator(".dialog-text").filter({ hasText: text });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (await target.isVisible().catch(() => false)) return;
      const visibleDialog = page.locator(".dialog-box:visible").first();
      if (await visibleDialog.isVisible().catch(() => false)) {
        await visibleDialog.click({ force: true });
      } else {
        await page.locator(".story-player").click({ position: { x: 420, y: 180 }, force: true });
      }
      await page.waitForTimeout(160);
    }
    await target.waitFor({ state: "visible", timeout: 3000 });
  }

  await advanceToText("这张照片不该出现在这里");
  const manualBackgroundSize = await dialogBox.evaluate((element) => getComputedStyle(element).backgroundSize);
  if (manualBackgroundSize !== "cover") {
    throw new Error(`${screenshotPrefix}: manual dialog background size should be cover, got ${manualBackgroundSize}.`);
  }

  await advanceToText("把它收好，别让其他人看见");
  const inheritedBackgroundSize = await dialogBox.evaluate((element) => getComputedStyle(element).backgroundSize);
  if (inheritedBackgroundSize !== "cover") {
    throw new Error(`${screenshotPrefix}: inherited character dialog background size should be cover, got ${inheritedBackgroundSize}.`);
  }
  await page.screenshot({ path: path.join(outputDir, `${screenshotPrefix}-dialog-cover.png`), fullPage: true });
  return { manualBackgroundSize, inheritedBackgroundSize };
}

async function runRuntimeViewport(browser, cartridgePath, viewport, name, dismissMethod, enableFastModes) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  await launchCartridge(page, cartridgePath);
  await advanceToFocusedImage(page, enableFastModes);
  await page.waitForFunction(() => {
    const image = document.querySelector("[data-testid='focused-image']");
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  }, null, { timeout: 5000 });
  const measurement = await measureOverlay(page);
  await page.screenshot({ path: path.join(outputDir, `${name}-visible.png`), fullPage: true });
  assertOverlayMeasurement(measurement, name);

  if (enableFastModes) {
    if (!measurement.autoActive || !measurement.skipActive) throw new Error(`${name}: auto/skip modes were not active before the blocking event.`);
    await page.waitForTimeout(1700);
    if (!(await page.locator('[data-testid="focused-image-overlay"]').isVisible())) {
      throw new Error(`${name}: auto/skip advanced past show_image without explicit dismissal.`);
    }
    await page.evaluate(() => {
      for (const componentId of ["quick_auto_button", "quick_skip_button"]) {
        const button = document.querySelector(`[data-ui-component-id="${componentId}"]`);
        if (button instanceof HTMLElement && button.getAttribute("aria-pressed") === "true") button.click();
      }
    });
    await page.waitForFunction(() => (
      ["quick_auto_button", "quick_skip_button"].every((componentId) => (
        document.querySelector(`[data-ui-component-id="${componentId}"]`)?.getAttribute("aria-pressed") !== "true"
      ))
    ), null, { timeout: 3000 });
  }

  const fadeDurationMs = await dismissAndVerify(page, dismissMethod, name);
  const dialogBackgroundFits = await verifyKeeperDialogBackgroundFit(page, name);
  await page.screenshot({ path: path.join(outputDir, `${name}-continued.png`), fullPage: true });
  await context.close();
  return { viewport, measurement, fadeDurationMs, dismissMethod, dialogBackgroundFits };
}

async function main() {
  resetOutput();
  const projectPath = path.join(testDir, "show-image-project.agentvn");
  saveProjectContainerSync(projectPath, buildProject(), { container: "zip" });
  const startedServers = [];
  let browser;
  const restoreRuntimeMarkers = isolateLibraryRuntime();
  const report = { startedAt: new Date().toISOString(), checks: [], artifacts: { outputDir, projectPath } };
  try {
    const editorServer = await ensureServer("editor", editorUrl, path.join(root, "editor"));
    const gameCliServer = await ensureServer("gamecli", gameCliUrl, path.join(root, "GameCli_framework"));
    if (editorServer) startedServers.push(editorServer);
    if (gameCliServer) startedServers.push(gameCliServer);

    browser = await chromium.launch({ headless: !headed });
    const editorContext = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
    const editorPage = await editorContext.newPage();
    await importProject(editorPage, projectPath);
    await createCommandsThroughEditor(editorPage);
    report.checks.push({ id: "editor:dialog-background-fit-before-asset", passed: true });
    report.checks.push({ id: "editor:create-show-image", passed: true });
    const cartridgePath = await exportCartridge(editorPage);
    report.artifacts.cartridgePath = cartridgePath;
    await editorContext.close();

    report.exported = await inspectCartridge(cartridgePath);
    report.checks.push({ id: "export:narration-style-apply-all", passed: true });
    report.checks.push({ id: "export:script-and-asset", passed: true });

    const verify = spawnSync(process.execPath, [path.join(root, "scripts", "verify-vncart.cjs"), cartridgePath], {
      cwd: root,
      encoding: "utf8",
    });
    if (verify.status !== 0) throw new Error(`verify-vncart failed:\n${verify.stdout}\n${verify.stderr}`);
    report.verifyVncart = verify.stdout.trim();
    report.checks.push({ id: "verify:vncart", passed: true });

    report.desktop = await runRuntimeViewport(
      browser,
      cartridgePath,
      { width: 1600, height: 900 },
      "desktop-1600x900",
      "click",
      true,
    );
    report.checks.push({ id: "gamecli:desktop-blocking-fade", passed: true });

    report.mobileLandscape = await runRuntimeViewport(
      browser,
      cartridgePath,
      { width: 844, height: 390 },
      "mobile-landscape-844x390",
      "Escape",
      false,
    );
    report.checks.push({ id: "gamecli:mobile-keyboard-fade", passed: true });
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    for (const child of startedServers.reverse()) stopServer(child);
    restoreRuntimeMarkers();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
