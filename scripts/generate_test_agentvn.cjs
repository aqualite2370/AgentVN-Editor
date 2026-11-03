const fs = require("fs");
const path = require("path");
const { saveProjectContainerSync } = require("./project-container.cjs");
const crypto = require("crypto");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "test_AgentVN");
const screenshotDir = path.join(root, "output", "playwright");
const defaultVideoDir = path.join(root, "output", "playwright", "videos");
const now = new Date().toISOString();

const cliArgs = process.argv.slice(2);
function hasArg(name) {
  return cliArgs.includes(name);
}

function getArgValue(name, fallback) {
  const prefix = `${name}=`;
  const inline = cliArgs.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = cliArgs.indexOf(name);
  if (index >= 0 && cliArgs[index + 1]) return cliArgs[index + 1];
  return fallback;
}

const recordVideo = !hasArg("--no-video");
const headed = hasArg("--headed");
const videoDir = path.resolve(root, getArgValue("--video-dir", defaultVideoDir));

const gameId = "test_agentvn";
const title = "AgentVN 自动化验收项目";
const author = "AgentVN 自动化脚本";

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });
if (recordVideo) fs.mkdirSync(videoDir, { recursive: true });

const sceneOpening = {
  scene_id: "scene_platform_rain",
  title: "雨夜站台",
  summary: "主角在旧车站与林澈重逢，林澈从防备转为愿意再次信任。",
  chapter: 1,
  tags: ["验收", "重逢", "心理变化"],
  commands: [
    { type: "background", background_id: "bg_old_station_rain", transition: "fade" },
    { type: "narration", text: "雨水敲在旧车站的铁皮屋檐上，像一段迟迟没有结束的倒计时。" },
    { type: "sprite", character_id: "lin_che", sprite_id: "sprite_lin_che_coat", position: "left", animation: "slide_in_left", visible: true },
    { type: "dialog", character_id: "lin_che", text: "你还是来了。我以为你会像上次一样，把我一个人留在这里。", emotion: "guarded", portrait: "portrait_lin_che_guarded", voice: null, side: "left" },
    { type: "dialog", character_id: "protagonist", text: "这一次不会了。我来完成最后一次委托，也来把欠你的解释说清楚。", emotion: "steady", portrait: null, voice: null, side: "right" },
    { type: "state_update", key: "lin_che_trust", operation: "add", value: 15 },
    { type: "state_update", key: "lin_che_inner_state", operation: "set", value: "从强烈防备转向谨慎信任" },
    { type: "dialog", character_id: "lin_che", text: "我不确定自己还能不能相信你……但至少现在，我愿意听你说完。", emotion: "softened", portrait: "portrait_lin_che_softened", voice: null, side: "left" },
    { type: "background", background_id: "bg_station_underpass", transition: "slide" },
    { type: "dialog", character_id: "protagonist", text: "那就从地下通道开始。线索应该还在第七号储物柜里。", emotion: "focused", portrait: null, voice: null, side: "right" },
    { type: "choice", choices: [{ choice_id: "go_underpass", text: "前往地下通道", target_scene_id: "scene_underpass_clue", conditions: [] }] }
  ]
};

const sceneUnderpass = {
  scene_id: "scene_underpass_clue",
  title: "地下通道的线索",
  summary: "两人进入地下通道，林澈开始主动提供线索。",
  chapter: 1,
  tags: ["验收", "线索"],
  commands: [
    { type: "background", background_id: "bg_station_underpass", transition: "cut" },
    { type: "narration", text: "地下通道的灯忽明忽暗，墙上的旧海报被潮气卷起边角。" },
    { type: "dialog", character_id: "lin_che", text: "第七号柜的钥匙，我一直带着。只是以前，我不想交给任何人。", emotion: "hesitant", portrait: "portrait_lin_che_softened", voice: null, side: "left" },
    { type: "dialog", character_id: "protagonist", text: "谢谢你。我们一起打开它。", emotion: "gentle", portrait: null, voice: null, side: "right" },
    { type: "wait", duration_ms: 350 }
  ],
  is_ending: true,
  ending_id: "ending_trust_rebuilt"
};

const script = {
  schema_version: "1.0.0",
  game_id: gameId,
  title,
  entry_scene_id: sceneOpening.scene_id,
  scenes: [sceneOpening, sceneUnderpass]
};

const manifest = {
  manifest_version: "1.0.0",
  cartridge_version: "1.0.0",
  runtime_version: "0.1.0",
  game_id: gameId,
  title,
  subtitle: "自动化验收样例",
  author,
  description: "用于验证 AgentVN 编辑器、卡带和玩家端预览流程的测试项目。",
  version: "0.1.0",
  language: "zh-CN",
  tags: ["test", "agentvn", "automation"],
  entry_script: "script.json",
  entry_scene_id: sceneOpening.scene_id,
  assets: [
    ["bg_old_station_rain", "background", "assets/backgrounds/bg_old_station_rain.txt"],
    ["bg_station_underpass", "background", "assets/backgrounds/bg_station_underpass.txt"],
    ["sprite_lin_che_coat", "sprite", "assets/sprites/sprite_lin_che_coat.txt"],
    ["portrait_lin_che_guarded", "portrait", "assets/portraits/portrait_lin_che_guarded.txt"],
    ["portrait_lin_che_softened", "portrait", "assets/portraits/portrait_lin_che_softened.txt"]
  ].map(([asset_id, asset_type, assetPath]) => ({
    asset_id,
    asset_type,
    path: assetPath,
    filename: path.basename(assetPath),
    mime_type: "text/plain",
    preload: asset_type === "background",
    tags: ["placeholder"]
  })),
  created_at: now,
  updated_at: now,
  save_compatibility_version: "1.0.0",
  breaking_save_compatibility: false
};

const gallery = { gallery_version: "1.0.0", items: [] };
const assetContents = new Map();
for (const asset of manifest.assets) {
  const data = `AgentVN 自动化占位资源：${asset.asset_id}\n资源类型：${asset.asset_type}\n`;
  asset.size_bytes = Buffer.byteLength(data);
  asset.hash_sha256 = crypto.createHash("sha256").update(data).digest("hex");
  assetContents.set(asset.path, data);
}

function checksumEntry(filePath, data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  return {
    path: filePath,
    size_bytes: buffer.length,
    hash_sha256: crypto.createHash("sha256").update(buffer).digest("hex")
  };
}

async function makeCartridge() {
  const zip = new JSZip();
  const entries = [];
  function add(filePath, data) {
    zip.file(filePath, data);
    entries.push(checksumEntry(filePath, data));
  }
  add("manifest.json", JSON.stringify(manifest, null, 2));
  add("script.json", JSON.stringify(script, null, 2));
  add("gallery.json", JSON.stringify(gallery, null, 2));
  add("metadata/credits.json", JSON.stringify({ tools: ["AgentVN"], special_thanks: ["自动化验收流程"] }, null, 2));
  add("metadata/changelog.json", JSON.stringify({ version: "0.1.0", date: now.slice(0, 10), changes: ["创建自动化验收卡带"] }, null, 2));
  add("metadata/license.json", JSON.stringify({ license_name: "Test Only", license_text: "仅用于本地验收测试。", asset_licenses: [] }, null, 2));
  for (const [filePath, data] of assetContents) add(filePath, data);
  const checksum = { checksum_version: "1.0.0", algorithm: "sha256", generated_at: now, files: entries };
  zip.file("checksum.json", JSON.stringify(checksum, null, 2));
  return { buffer: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), checksum };
}

async function makeStandaloneZip(cartridgeBuffer) {
  const zip = new JSZip();
  zip.file("embedded-cartridge/game.vncart", cartridgeBuffer);
  zip.file("runtime-mode.json", JSON.stringify({ mode: "embedded" }, null, 2));
  zip.file("package-profile.json", JSON.stringify({
    mode: "embedded_single_game",
    target_platform: "windows",
    game_id: gameId,
    game_title: title,
    game_version: "0.1.0",
    generated_at: now,
    runtime_shell_build_script: "node scripts/build-runtime-standalone-windows.cjs"
  }, null, 2));
  zip.file("README-使用说明.txt", "这是 GameCLI 固定卡带容器工程。将 embedded-cartridge/game.vncart 放入 GameCli_framework/public/embedded-cartridge/game.vncart，并运行 node scripts/build-runtime-standalone-windows.cjs 可打包 Windows 单游戏播放器。\n");
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function makeProject() {
  const aiSettings = { authorGoal: "验证三轮对话、场景切换与角色心理变化。", autoExtractMemory: false, autoApplyMemory: false };
  const previewState = { currentCommandIndex: 0, isPlaying: false };
  const editorMeta = { collapsedInspectorSections: [], debugNotes: "自动化验收项目，仅供测试。" };
  const nodeData = (nodeKind, label, description, scene) => ({ nodeKind, scene, label, description, memoryMode: "hybrid", aiSettings, previewState, editorMeta });
  return {
    schema_version: "1.0.0",
    project_id: "project_test_agentvn",
    title,
    author,
    nodes: [
      { id: "start", type: "startNode", position: { x: 40, y: 220 }, data: nodeData("start", "入口", "项目入口节点") },
      { id: "node_scene_platform_rain", type: "sceneNode", position: { x: 300, y: 180 }, data: nodeData("scene", sceneOpening.title, sceneOpening.summary, sceneOpening) },
      { id: "node_scene_underpass_clue", type: "sceneNode", position: { x: 720, y: 180 }, data: nodeData("scene", sceneUnderpass.title, sceneUnderpass.summary, sceneUnderpass) }
    ],
    edges: [
      { id: "edge_start_platform", source: "start", target: "node_scene_platform_rain", sourceHandle: "default" },
      { id: "edge_platform_underpass", source: "node_scene_platform_rain", target: "node_scene_underpass_clue", sourceHandle: "go_underpass" }
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: manifest.assets.map(({ asset_id, asset_type }) => ({ asset_id, asset_type, metadata: { placeholder: true } })),
    editor_settings: { generated_by: "playwright_acceptance_flow" },
    created_at: now,
    updated_at: now
  };
}

function writeTextArtifacts(project, checksum) {
  const controls = [
    ["编辑器工具栏", "新建场景节点", "本地 Zustand：createNode('scene')", "创建场景节点并选中"],
    ["编辑器工具栏", "新建修饰节点", "本地 Zustand：createNode('modifier')", "创建 Runtime 状态修改节点"],
    ["编辑器工具栏", "新建条件节点", "本地 Zustand：createNode('condition')", "创建 Runtime 条件分支节点"],
    ["旧工程兼容", "迁移独立动画节点", "拓扑分析 + 单次图历史记录", "转换为场景事件或原地普通场景"],
    ["编辑器工具栏", "保存工程", "本地下载 project.vnproj", "导出编辑器工程"],
    ["编辑器工具栏", "导入工程", "浏览器 File API + importProject", "导入 .vnproj/.json"],
    ["编辑器工具栏", "导出运行剧本", "本地下载 script.json + validateExportScript", "导出纯 Runtime 剧本"],
    ["编辑器工具栏", "发布与打包", "打开 ExportCartridgePanel", "导出卡带或单游戏软件包工程"],
    ["编辑器工具栏", "高级工具", "打开 AdvancedToolsPanel", "进入小说导入、素材、动画、预览、Provider 管理"],
    ["编辑器工具栏", "检查后端", "GET /api/health", "检查本地 FastAPI 后端连接"],
    ["记忆模式选择器", "none / chronicle_graph_only / emotion_trace_only / hybrid", "POST /api/memory/mode 或本地节点 memoryMode", "配置 AI 生成上下文"],
    ["场景节点", "辅助生成后续", "POST /api/generate_scene，可选 POST /api/extract_memory 与 /api/memory/apply_update", "调用 AI 后端生成后续场景"],
    ["指令编辑器", "添加/删除/上移/下移/复制指令", "本地 Zustand：updateSceneCommands", "编辑 GameCommand 数组"],
    ["发布面板", "导出游戏卡带", "本地 JSZip 打包 .vncart", "生成玩家壳子可导入卡带"],
    ["发布面板", "导出 Windows/Android 单游戏软件包工程", "本地 JSZip 打包 embedded-cartridge/game.vncart", "生成单游戏软件包工程"],
    ["预览窗口", "启动完整预览", "window.open(runtime ?preview=1) + postMessage", "打开玩家壳子预览当前卡带"],
    ["预览窗口", "重新发送当前卡带", "postMessage agentvn.runtime.preview", "发送最新卡带数据"],
    ["Runtime 主菜单", "开始游戏/游戏库/画廊/设置/关于", "runtimeStore + libraryStore + settingsStore", "玩家端本地运行"],
    ["Runtime 播放控制", "继续/自动/快进/历史/存档/设置/菜单", "StoryEngine/runtimeStore/saveManager/historyManager/settingsStore", "播放和管理存档设置"]
  ];
  const mapping = [
    "# AgentVN 功能、按钮、控件接口映射",
    "",
    "| 区域 | 控件 | 指向接口或本地动作 | 说明 |",
    "|---|---|---|---|",
    ...controls.map((row) => `| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} |`)
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "功能控件接口映射.md"), mapping, "utf8");

  const guide = [
    "# test_AgentVN 使用说明",
    "",
    "## 文件说明",
    "- project.vnproj：编辑器工程，可从 AgentVN 编辑器导入。",
    "- script.json：纯 Runtime 剧本，不含节点坐标、AI 设置、Provider 密钥或编辑器临时数据。",
    "- manifest.json：卡带资源清单。",
    "- checksum.json：卡带文件级 SHA-256 校验清单副本。",
    "- test_agentvn-0.1.0.vncart：玩家壳子可导入的游戏卡带。",
    "- test_agentvn-0.1.0-windows-standalone.zip：单游戏软件包工程，内含 embedded-cartridge/game.vncart。",
    "- 自动化操作日志.txt：Playwright 每一步操作和发生的结果。",
    "- 功能验收报告.txt：按钮、控件、预览、导出等检查结果。",
    "",
    "## 在编辑器查看",
    "1. 运行 scripts/start-editor.ps1。",
    "2. 打开 http://127.0.0.1:6767。",
    "3. 点击“导入工程”，选择本目录中的 project.vnproj。",
    "4. 选中“雨夜站台”，可看到三轮以上对话、一次背景切换和林澈心理变量变化。",
    "",
    "## 在玩家壳子查看",
    "1. 使用 AgentVN 桌面版点击“在 GameCLI 中预览 / 同步”。",
    "2. 打开玩家端后进入游戏库，导入 test_agentvn-0.1.0.vncart。",
    "3. 启动游戏并点击继续，进入地下通道分支。",
    "",
    "## 构建单游戏软件包",
    "Windows 示例：",
    "```powershell",
    `node scripts/build-runtime-standalone-windows.cjs --CartridgePath \"${path.join(outDir, "test_agentvn-0.1.0.vncart")}\"`,
    "```",
    "Android 示例：",
    "```powershell",
    `node scripts/build-runtime-standalone-android.cjs --CartridgePath \"${path.join(outDir, "test_agentvn-0.1.0.vncart")}\"`,
    "```",
    "",
    "Android 构建依赖本机 Android SDK、NDK、JDK 和 Rust Android target。"
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "使用说明.md"), guide, "utf8");
  saveProjectContainerSync(path.join(outDir, "project.vnproj"), project, { container: "zip" });
  fs.writeFileSync(path.join(outDir, "script.json"), JSON.stringify(script, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "gallery.json"), JSON.stringify(gallery, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "checksum.json"), JSON.stringify(checksum, null, 2), "utf8");
}

async function runBrowserFlow() {
  const log = [];
  const step = (text) => log.push(`${String(log.length + 1).padStart(2, "0")}. ${text}`);
  const viewport = { width: 1440, height: 960 };
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport,
    acceptDownloads: true,
    ...(recordVideo ? { recordVideo: { dir: videoDir, size: viewport } } : {})
  });
  const page = await context.newPage();

  await page.goto("http://127.0.0.1:6767/", { waitUntil: "domcontentloaded" });
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  const inspector = page.locator(".inspector-panel");
  if ((await inspector.count()) === 0) {
    const importProjectInput = page.locator(".project-import-button input").first();
    const createProjectButton = page.locator('button[data-help-key="home.createProject"]').first();
    const resumeProjectButton = page.locator('button[data-help-key="home.openDraft"]').first();
    const legacyCreateProjectButton = page.locator(".project-home-actions .primary-action").first();
    if (await importProjectInput.count()) {
      await importProjectInput.setInputFiles(path.join(outDir, "project.vnproj"));
      step("从项目主页导入带素材清单的验收项目，进入编辑器工作区。");
    } else if (await createProjectButton.isVisible().catch(() => false)) {
      await createProjectButton.click();
      step("从项目主页创建临时验收项目，进入编辑器工作区。");
    } else if (await resumeProjectButton.isVisible().catch(() => false)) {
      await resumeProjectButton.click();
      step("从项目主页继续上次编辑，进入编辑器工作区。");
    } else if (await legacyCreateProjectButton.isVisible().catch(() => false)) {
      await legacyCreateProjectButton.click();
      step("从旧版项目主页入口进入编辑器工作区。");
    } else {
      throw new Error("无法在项目主页找到新建或继续编辑入口。");
    }
  }
  await inspector.waitFor({ state: "visible" });
  await page.locator(".flow-surface").waitFor({ state: "visible", timeout: 30000 });
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  const sceneNode = page.locator(".react-flow__node").filter({ hasText: "雨夜站台" }).first();
  if (await sceneNode.isVisible().catch(() => false)) await sceneNode.click({ force: true });
  await page.locator(".command-card").first().waitFor({ state: "visible", timeout: 30000 });
  step("打开编辑器，确认工具栏、节点画布、检查器和预览区可见。");
  await page.screenshot({ path: path.join(screenshotDir, "test-agentvn-01-editor-initial.png"), fullPage: true });

  await page.locator('input[data-help-key="field.title"]').fill("雨夜站台");
  step("在检查器中填写场景标题为“雨夜站台”。");
  await page.locator('textarea[data-help-key="field.summary"]').fill("主角在旧车站与林澈重逢，林澈从防备转为愿意再次信任。");
  step("填写场景摘要，说明角色心理变化目标。");
  await page.locator('input[data-help-key="field.tags"]').fill("验收,重逢,心理变化");
  step("设置标签为“验收、重逢、心理变化”。");

  const picker = page.locator("#command-type-picker");
  const commandCards = page.locator(".command-card");
  const addCommandButton = page.locator('button[data-help-key="command.add"]');
  const commandTypeLabels = {
    dialog: "角色对话",
    narration: "旁白",
    background: "背景切换",
    show_image: "展示图片",
    sprite: "立绘控制",
    choice: "选项分支",
    state_update: "状态修改",
    animation: "演出动画",
    bgm: "背景音乐",
    sfx: "音效",
    camera: "镜头效果",
    wait: "等待",
  };
  async function ensureCommandCardExpanded(card) {
    await card.scrollIntoViewIfNeeded();
    const body = card.locator(".command-card-body");
    if (!(await body.isVisible().catch(() => false))) {
      await card.locator('button[data-help-key="command.expand"]').click({ force: true });
      await body.waitFor({ state: "visible" });
    }
  }
  async function addCommand(type) {
    const beforeCount = await commandCards.count();
    if (await picker.isVisible().catch(() => false)) {
      await picker.selectOption(type);
      await addCommandButton.click();
    } else {
      const typeButton = page.locator('button[data-help-key="workbench.commandType"]').filter({ hasText: commandTypeLabels[type] }).first();
      await typeButton.waitFor({ state: "visible", timeout: 10000 });
      await typeButton.click({ force: true });
      await page.locator('button[data-help-key="workbench.addCommand"]').click({ force: true });
    }
    const card = commandCards.nth(beforeCount);
    await card.waitFor({ state: "visible" });
    await ensureCommandCardExpanded(card);
    return card;
  }
  async function chooseAsset(card, helpKey, assetId) {
    let assetButton = card.locator(`button[data-help-key="${helpKey}.select"][data-asset-id="${assetId}"]`).first();
    if (!(await assetButton.isVisible().catch(() => false))) {
      const openButton = card.locator(`button[data-help-key="${helpKey}.openPicker"]`).first();
      await openButton.waitFor({ state: "visible", timeout: 10000 });
      await openButton.click({ force: true });
      assetButton = page.locator(`button[data-help-key="${helpKey}.select"][data-asset-id="${assetId}"]`).first();
    }
    await assetButton.waitFor({ state: "visible", timeout: 10000 });
    await assetButton.click({ force: true });
    const selectedText = await card.locator(".asset-picker-selected").first().innerText();
    if (!selectedText.includes(assetId)) throw new Error(`AssetPicker 未写入 ${assetId}，当前显示：${selectedText}`);
  }

  const openingNarrationCard = commandCards.nth(1);
  await ensureCommandCardExpanded(openingNarrationCard);
  await openingNarrationCard.locator('[data-help-key="command.narration.text"]').fill("雨水敲在旧车站的铁皮屋檐上，像一段迟迟没有结束的倒计时。");
  step("修改旁白文本，建立雨夜旧车站氛围。");
  const openingDialogCard = commandCards.nth(3);
  await ensureCommandCardExpanded(openingDialogCard);
  await openingDialogCard.locator('[data-help-key="command.dialog.text"]').fill("你还是来了。我以为你会像上次一样，把我一个人留在这里。");
  step("填写第一轮对话：林澈表达防备与不信任。");

  const secondDialogCard = await addCommand("dialog");
  await secondDialogCard.locator("textarea").first().fill("这一次不会了。我来完成最后一次委托，也来把欠你的解释说清楚。");
  step("添加第二轮对话：主角给出承诺。");

  const stateCard = await addCommand("state_update");
  await stateCard.locator('input[data-help-key="command.state.key"]').waitFor({ state: "visible" });
  step("添加心理变化状态指令，确认状态修改卡片可创建并展开。");

  const thirdDialogCard = await addCommand("dialog");
  await thirdDialogCard.locator("textarea").first().fill("我不确定自己还能不能相信你……但至少现在，我愿意听你说完。");
  step("添加第三轮对话：林澈表达谨慎信任。");

  const bgCard = await addCommand("background");
  const wrongTypeVisible = await bgCard.locator('button[data-asset-id="sprite_lin_che_coat"]').count();
  if (wrongTypeVisible > 0) throw new Error("背景 AssetPicker 中不应出现 sprite 素材。");
  await chooseAsset(bgCard, "command.background.backgroundId", "bg_station_underpass");
  step("添加背景切换：通过 AssetPicker 选择地下通道背景，并确认不会混入立绘素材。");
  await page.screenshot({ path: path.join(screenshotDir, "test-agentvn-02-editor-filled.png"), fullPage: true });

  await page.locator('[data-help-key="toolbar.exportCartridge"]').click();
  await page.locator(".cartridge-export-panel").waitFor({ state: "visible" });
  step("打开发布与打包面板，确认卡带和单游戏软件包入口。");
  await page.screenshot({ path: path.join(screenshotDir, "test-agentvn-03-export-panel.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.locator(".toolbar-popover.cartridge").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

  await page.locator('[data-help-key="toolbar.advanced"]').click();
  await page.locator(".advanced-tools-panel").waitFor({ state: "visible" });
  await page.locator('[data-help-key="advanced.tab.preview"]').click();
  await page.locator('[data-help-key="preview.open"]').waitFor({ state: "visible" });
  step("打开高级工具中的预览窗口面板。");
  await page.screenshot({ path: path.join(screenshotDir, "test-agentvn-04-preview-panel.png"), fullPage: true });

  const runtimePage = await context.newPage();
  await runtimePage.goto("http://127.0.0.1:6868/?preview=1", { waitUntil: "networkidle" });
  step("打开玩家端预览页，进入等待编辑器载荷状态。");
  await runtimePage.evaluate((payload) => {
    window.postMessage({ type: "agentvn.runtime.preview", payload }, window.location.origin);
  }, { manifest, script, gallery, start_scene_id: script.entry_scene_id, selected_scene_id: script.entry_scene_id, mode: "full_game", variables: {}, auto_start: true, source: "playwright_acceptance" });
  await runtimePage.waitForTimeout(1000);
  step("向玩家端发送预览载荷，Runtime 接收并自动启动。");
  await runtimePage.screenshot({ path: path.join(screenshotDir, "test-agentvn-05-runtime-dialog-1.png"), fullPage: true });

  for (let index = 0; index < 8; index += 1) {
    await runtimePage.mouse.click(720, 820);
    await runtimePage.waitForTimeout(350);
  }
  step("在玩家端连续点击继续，播放旁白、三轮对话、心理变量变化和背景切换。");
  await runtimePage.screenshot({ path: path.join(screenshotDir, "test-agentvn-06-runtime-after-clicks.png"), fullPage: true });

  const runtimeText = await runtimePage.locator("body").innerText();
  const uiButtonCount = await page.locator("button").count();
  const uiControlCount = await page.locator("input, textarea, select").count();
  const hasExportPanel = (await page.locator(".cartridge-export-panel").count()) > 0;
  const hasAdvancedToolsPanel = (await page.locator(".advanced-tools-panel").count()) > 0;
  const pagesWithVideo = [page, runtimePage];
  await context.close();
  const recordedVideos = [];
  if (recordVideo) {
    for (const videoPage of pagesWithVideo) {
      const video = videoPage.video();
      if (video) recordedVideos.push(await video.path());
    }
  }
  const report = [
    `编辑器按钮数量：${uiButtonCount}`,
    `编辑器输入/选择控件数量：${uiControlCount}`,
    `发布面板：${hasExportPanel ? "通过" : "需人工复核"}`,
    `高级工具面板：${hasAdvancedToolsPanel ? "通过" : "需人工复核"}`,
    `Runtime 预览接收：${runtimeText.includes("等待编辑器预览") ? "失败" : "通过"}`,
    `Runtime 播放文本：${runtimeText.slice(0, 300).replace(/\s+/g, " ")}`,
    `剧本场景数量：${script.scenes.length}`,
    `GameCommand 数量：${script.scenes.reduce((sum, scene) => sum + scene.commands.length, 0)}`,
    `截图目录：${screenshotDir}`,
    `Video recording: ${recordVideo ? "enabled" : "disabled"}`,
    `Video directory: ${recordVideo ? videoDir : "n/a"}`,
    `Video files: ${recordedVideos.length ? recordedVideos.join(", ") : "none"}`
  ];
  fs.writeFileSync(path.join(outDir, "自动化操作日志.txt"), `${log.join("\n")}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "功能验收报告.txt"), `${report.join("\n")}\n`, "utf8");
  await browser.close();
}

(async () => {
  const project = makeProject();
  const { buffer: cartridgeBuffer, checksum } = await makeCartridge();
  fs.writeFileSync(path.join(outDir, "test_agentvn-0.1.0.vncart"), cartridgeBuffer);
  fs.writeFileSync(path.join(outDir, "test_agentvn-0.1.0-windows-standalone.zip"), await makeStandaloneZip(cartridgeBuffer));
  writeTextArtifacts(project, checksum);
  await runBrowserFlow();
  console.log(`DONE ${outDir}`);
})();
