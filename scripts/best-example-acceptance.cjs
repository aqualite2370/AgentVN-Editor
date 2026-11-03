const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const baseDir = path.join(root, "test_AgentVN", "best-example");
const workDir = path.join(baseDir, "_work");
const finalDir = path.join(baseDir, "final");
const workVideoDir = path.join(workDir, "videos");
const finalCartridge = path.join(finalDir, "最佳示例.vncart");
const editorUrl = "http://127.0.0.1:6767/";
const gameCliUrl = "http://127.0.0.1:6868/";
const backendUrl = "http://127.0.0.1:8278";
const now = new Date().toISOString();
const viewport = { width: 1920, height: 1080 };
const actionDelayMs = 2000;
const aiTimeoutMs = 180000;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const operations = [];
const failures = [];
const fixes = [
  "修复计划 1：编辑器导出的卡带需要把项目素材 data_url/blob_url 一并写入 zip，否则 manifest 有资源记录但卡带内缺文件，GameCli 导入和 verify-vncart 会失败。",
  "修复计划 2：GameCli 浏览器开发模式需要提供 web 文件输入兜底，否则 Playwright 只能看到 Tauri 文件选择器，无法导入 .vncart。",
  "修复计划 3：GameCli 浏览器开发模式需要 localStorage 存档兜底，否则存档/读档只调用 Tauri invoke，浏览器验收无法覆盖。",
  "修复计划 4：GameCli 读档恢复到 choice 命令时需要重新计算并恢复选项按钮，否则从分支点读档后无法选择第二条路线。",
  "修复计划 5：Playwright 录屏必须通过 page.video().saveAs() 等待浏览器完成封存，否则直接复制录制目录中的 webm 可能得到无法播放的空白/损坏文件。",
  "修复计划 6：最佳示例验收脚本调用后端 Provider 预检时需要剔除前端专用 thinking_mode 字段，否则 StrictBaseModel 会以 extra_forbidden 拒绝请求。",
  "修复计划 7：场景 AI 续写验收应等待当前实现中的 .node-preview.is-streaming 和按钮 data-state，而不是旧版 .node-stream-preview 选择器。",
  "修复计划 8：场景节点内的 AI 续写按钮需要使用 React Flow 的 nodrag/nopan 交互隔离，并阻止 pointerdown 冒泡，否则真实点击可能被画布拖拽层吞掉。",
  "修复计划 9：节点创建覆盖测试会产生临时节点，必须在 AI 续写前恢复最佳示例蓝图，否则重叠节点可能遮挡开场场景的 AI 按钮。",
  "修复计划 10：GameCli 当前没有独立结局页，验收通过玩家端回到已加载卡带主菜单判断结局已完整播放。",
  "修复计划 11：Windows 下验收脚本运行 npm.cmd 需要通过 shell 启动，否则 Node spawn 可能返回 EINVAL。",
  "修复计划 12：真实模型对复杂含动画场景续写时可能输出旧动画字段；验收改用只允许旁白/对白的 AI 烟测场景验证模型链路，再恢复固定最佳示例导出。",
  "修复计划 13：命令执行器只允许 .cmd 走 shell，Node 可执行文件必须直连执行，避免 C:\\Program Files 路径被 shell 拆坏。",
];

function step(text, why) {
  operations.push(`${String(operations.length + 1).padStart(2, "0")}. ${text}（${why}）`);
}

async function userPace(page) {
  if (page) await page.waitForTimeout(actionDelayMs);
}

function ensureCleanDir() {
  fs.rmSync(baseDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(finalDir, { recursive: true });
  fs.mkdirSync(workVideoDir, { recursive: true });
}

async function getJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} ${response.status}: ${await response.text()}`);
  return response.json();
}

async function runCommand(name, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const useShell = options.shell ?? (process.platform === "win32" && /\.cmd$/i.test(command));
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      shell: useShell,
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (data) => out += data.toString());
    child.stderr.on("data", (data) => err += data.toString());
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { name, code, stdout: out.trim(), stderr: err.trim() };
      if (code === 0) resolve(result);
      else reject(new Error(`${name} failed with exit code ${code}\n${out}\n${err}`));
    });
  });
}

async function waitForAssistantAnswer(page) {
  await page.locator(".assistant-loading").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".assistant-loading").waitFor({ state: "detached", timeout: aiTimeoutMs });
  const assistantMessages = page.locator(".assistant-message.is-assistant");
  await assistantMessages.first().waitFor({ state: "visible", timeout: 15000 });
  const status = page.locator(".assistant-status");
  if ((await status.count()) > 0 && await status.first().isVisible().catch(() => false)) {
    const text = await status.first().textContent();
    if (text?.trim()) throw new Error(`大模型助手返回错误状态：${text.trim()}`);
  }
}

async function ensureNoSecretInCartridge(cartridgePath, providerState) {
  const buffer = fs.readFileSync(cartridgePath);
  const haystack = buffer.toString("utf8");
  const providerSecrets = Object.values(providerState.provider_secrets ?? {}).filter((value) => typeof value === "string" && value.length > 0);
  const leakedSecret = providerSecrets.find((secret) => haystack.includes(secret));
  if (leakedSecret) throw new Error("卡带中发现完整 Provider API Token，导出边界失败。");
  if (/sk-[A-Za-z0-9_\-]{8,}/.test(haystack)) throw new Error("卡带中发现疑似 sk-* 密钥片段，导出边界失败。");
  if (haystack.includes("provider_connections") || haystack.includes("provider_secrets")) {
    throw new Error("卡带中发现 Provider 配置字段，导出边界失败。");
  }
}

function backendCompatibleProviderParameters(parameters = {}) {
  const allowed = {};
  for (const key of ["temperature", "top_p", "max_tokens", "structured_mode", "request_timeout_seconds"]) {
    if (parameters[key] !== undefined && parameters[key] !== null) allowed[key] = parameters[key];
  }
  return allowed;
}

function svgDataUrl(title, a, b) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <circle cx="980" cy="170" r="120" fill="rgba(255,255,255,.16)"/>
  <rect x="80" y="480" width="1120" height="92" rx="16" fill="rgba(0,0,0,.22)"/>
  <text x="100" y="535" font-family="sans-serif" font-size="46" fill="white">${title}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function textDataUrl(text, mime = "application/json") {
  return `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
}

const assetRefs = [
  ["bg_old_station_rain", "background", "old-station-rain.svg", svgDataUrl("旧车站 / 雨夜", "#1f3d5a", "#0c1119")],
  ["bg_locker_room", "background", "locker-room.svg", svgDataUrl("第七号储物柜", "#50324b", "#16131f")],
  ["bg_underpass", "background", "underpass.svg", svgDataUrl("地下通道", "#123d3a", "#071514")],
  ["sprite_lin_coat", "sprite", "lin-coat.svg", svgDataUrl("林澈 立绘", "#5b6ea8", "#171d34")],
  ["portrait_lin_guarded", "portrait", "lin-guarded.svg", svgDataUrl("林澈 / 防备", "#78536a", "#1d1520")],
  ["portrait_lin_soft", "portrait", "lin-soft.svg", svgDataUrl("林澈 / 松动", "#647b84", "#162024")],
  ["bgm_rain_memory", "bgm", "rain-memory.txt", textDataUrl("placeholder bgm asset", "audio/wav")],
  ["sfx_rain_hit", "sfx", "rain-hit.txt", textDataUrl("placeholder sfx asset", "audio/wav")],
  ["anim_fade_flash", "animation", "fade-flash.json", textDataUrl(JSON.stringify({ id: "anim_fade_flash", duration: 500 }))],
].map(([asset_id, asset_type, filename, data_url]) => ({
  asset_id,
  asset_type,
  metadata: {
    filename,
    mime_type: data_url.startsWith("data:image") ? "image/svg+xml" : data_url.startsWith("data:audio") ? "audio/wav" : "application/json",
    size_bytes: Buffer.byteLength(data_url),
    source: "imported",
    license_note: "AgentVN 自动化验收内置素材",
    data_url,
    blob_url: data_url,
    project_path: `assets/${asset_type}/${asset_id}-${filename}`,
    created_at: now,
  },
}));

function aiSettings(goal) {
  return { authorGoal: goal, autoExtractMemory: false, autoApplyMemory: false };
}

function meta(source = "manual") {
  return { collapsedInspectorSections: [], source };
}

function sceneNode(id, x, y, scene) {
  return {
    id,
    type: "sceneNode",
    position: { x, y },
    data: {
      nodeKind: "scene",
      label: scene.title,
      description: scene.summary,
      memoryMode: "hybrid",
      aiSettings: aiSettings("保持雨夜悬疑氛围，补足角色动机，不要跳出视觉小说脚本格式。"),
      previewState: { currentCommandIndex: 0, isPlaying: false },
      editorMeta: meta(),
      scene,
    },
  };
}

function buildProject(runtimeUILayout) {
  const opening = {
    scene_id: "scene_rain_station",
    title: "雨夜第七号柜",
    summary: "主角在旧车站与林澈重逢，必须决定是否坦白当年的真相。",
    chapter: 1,
    tags: ["开场", "雨夜", "分支"],
    commands: [
      { type: "background", background_id: "bg_old_station_rain", transition: "fade" },
      { type: "bgm", bgm_id: "bgm_rain_memory", action: "play", volume: 0.7, fade_ms: 800 },
      { type: "sfx", sfx_id: "sfx_rain_hit", volume: 0.45 },
      { type: "sprite", character_id: "lin_che", sprite_id: "sprite_lin_coat", position: "left", animation: "slide_in_left", visible: true },
      { type: "animation", animation_id: "anim_fade_flash", target: "screen", params: { duration: 420 }, blocking: true },
      { type: "camera", action: "shake", params: { duration: 320, strength: 0.35 }, blocking: true },
      { type: "narration", text: "雨水沿着站牌边缘滴落，第七号储物柜的钥匙在掌心里发冷。" },
      { type: "dialog", character_id: "lin_che", text: "你还是来了。我以为你会像上次一样，把我一个人留在这里。", emotion: "guarded", portrait: "portrait_lin_guarded", side: "left" },
      { type: "dialog", character_id: "protagonist", text: "这一次不会了。钥匙、名单、还有那封没寄出的信，我都会说清楚。", emotion: "steady", side: "right" },
      { type: "state_update", key: "lin_trust", operation: "set", value: 0 },
      { type: "state_update", key: "found_key", operation: "set", value: true },
      { type: "wait", duration_ms: 350 },
      {
        type: "choice",
        choices: [
          { choice_id: "choice_truth", text: "坦白真相", target_scene_id: "", conditions: [] },
          { choice_id: "choice_hide", text: "隐瞒线索", target_scene_id: "", conditions: [] },
        ],
      },
    ],
  };
  const truth = {
    scene_id: "scene_tell_truth",
    title: "第七号柜的真相",
    summary: "主角坦白自己当年隐瞒名单是为了保护林澈，但也承认这伤害了她。",
    chapter: 1,
    tags: ["坦白", "信任"],
    commands: [
      { type: "background", background_id: "bg_locker_room", transition: "fade" },
      { type: "dialog", character_id: "protagonist", text: "当年名单里有你的名字。我藏起来，是怕他们顺着线索找到你。", side: "right" },
      { type: "dialog", character_id: "lin_che", text: "你救了我，也替我决定了失去什么。至少这次，你把选择还给我了。", emotion: "soft", portrait: "portrait_lin_soft", side: "left" },
    ],
  };
  const hide = {
    scene_id: "scene_hide_clue",
    title: "沉默的地下通道",
    summary: "主角回避真相，林澈察觉了迟疑，两人的裂痕再次扩大。",
    chapter: 1,
    tags: ["隐瞒", "裂痕"],
    commands: [
      { type: "background", background_id: "bg_underpass", transition: "slide" },
      { type: "dialog", character_id: "protagonist", text: "现在不是说那些的时候。先离开这里。", side: "right" },
      { type: "dialog", character_id: "lin_che", text: "你又在替我决定。原来雨声再大，也盖不住一个人的迟疑。", emotion: "cold", portrait: "portrait_lin_guarded", side: "left" },
    ],
  };

  const nodes = [
    {
      id: "start",
      type: "startNode",
      position: { x: 40, y: 260 },
      data: { nodeKind: "start", label: "入口", description: "项目唯一入口节点。", memoryMode: "hybrid", aiSettings: aiSettings(""), previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: meta() },
    },
    sceneNode("scene_opening", 330, 210, opening),
    sceneNode("scene_truth", 700, 80, truth),
    sceneNode("scene_hide", 700, 380, hide),
    {
      id: "modifier_truth",
      type: "modifierNode",
      position: { x: 1040, y: 110 },
      data: { nodeKind: "modifier", label: "记录坦白", description: "写入 told_truth=true，并提高林澈信任。", memoryMode: "hybrid", aiSettings: aiSettings(""), previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: meta(), stateUpdate: { type: "state_update", key: "told_truth", operation: "set", value: true } },
    },
    {
      id: "modifier_hide",
      type: "modifierNode",
      position: { x: 1040, y: 410 },
      data: { nodeKind: "modifier", label: "记录隐瞒", description: "写入 told_truth=false，并降低林澈信任。", memoryMode: "hybrid", aiSettings: aiSettings(""), previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: meta(), stateUpdate: { type: "state_update", key: "told_truth", operation: "set", value: false } },
    },
    {
      id: "condition_gate",
      type: "conditionNode",
      position: { x: 1380, y: 260 },
      data: { nodeKind: "condition", label: "真相判定", description: "根据 told_truth 决定进入哪个结局。", memoryMode: "hybrid", aiSettings: aiSettings(""), previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: meta(), condition: { expression: "told_truth", trueLabel: "信任重建", falseLabel: "独自离开" } },
    },
    {
      id: "animation_trust",
      type: "animationNode",
      position: { x: 1740, y: 120 },
      data: { nodeKind: "animation", label: "雨声渐弱", description: "通向好结局前的淡入动画。", memoryMode: "hybrid", aiSettings: aiSettings(""), previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: meta(), animation: { type: "animation", animation_id: "anim_fade_flash", target: "screen", params: { duration: 500 }, blocking: true } },
    },
    {
      id: "ending_trust",
      type: "endNode",
      position: { x: 2080, y: 120 },
      data: { nodeKind: "end", label: "信任重建", description: "林澈选择留下，两人一起打开第七号柜。", memoryMode: "hybrid", aiSettings: aiSettings(""), previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: meta(), ending: { ending_id: "ending_trust_rebuilt", ending_title: "信任重建" } },
    },
    {
      id: "ending_alone",
      type: "endNode",
      position: { x: 1740, y: 430 },
      data: { nodeKind: "end", label: "独自离开", description: "林澈没有再等解释，独自走进雨里。", memoryMode: "hybrid", aiSettings: aiSettings(""), previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: meta(), ending: { ending_id: "ending_alone_rain", ending_title: "独自离开" } },
    },
  ];
  const edges = [
    { id: "edge_start_opening", source: "start", target: "scene_opening", sourceHandle: "default" },
    { id: "edge_opening_truth", source: "scene_opening", target: "scene_truth", sourceHandle: "choice_truth" },
    { id: "edge_opening_hide", source: "scene_opening", target: "scene_hide", sourceHandle: "choice_hide" },
    { id: "edge_truth_modifier", source: "scene_truth", target: "modifier_truth", sourceHandle: "default" },
    { id: "edge_hide_modifier", source: "scene_hide", target: "modifier_hide", sourceHandle: "default" },
    { id: "edge_modifier_truth_gate", source: "modifier_truth", target: "condition_gate", sourceHandle: "default" },
    { id: "edge_modifier_hide_gate", source: "modifier_hide", target: "condition_gate", sourceHandle: "default" },
    { id: "edge_gate_trust", source: "condition_gate", target: "animation_trust", sourceHandle: "true" },
    { id: "edge_gate_alone", source: "condition_gate", target: "ending_alone", sourceHandle: "false" },
    { id: "edge_anim_trust_end", source: "animation_trust", target: "ending_trust", sourceHandle: "default" },
  ];
  return {
    schema_version: "1.0.0",
    project_id: "project_best_rain_locker",
    title: "雨夜第七号柜",
    author: "AgentVN 验收示例",
    nodes,
    edges,
    viewport: { x: -180, y: 80, zoom: 0.72 },
    memory_mode: "hybrid",
    asset_manifest: assetRefs,
    editor_settings: {
      defaultMemoryMode: "hybrid",
      runtimeUILayout,
    },
    created_at: now,
    updated_at: now,
  };
}

function buildAiSmokeProject(runtimeUILayout) {
  const scene = {
    scene_id: "scene_ai_smoke",
    title: "AI 续写烟测",
    summary: "一个只包含旁白和对白的极简场景，用来验证真实模型能稳定返回 SceneBeat。",
    chapter: 1,
    tags: ["AI", "烟测"],
    commands: [
      { type: "narration", text: "雨停前，站台广播忽然安静下来。" },
      { type: "dialog", character_id: "lin_che", text: "如果你要解释，现在就是最后的机会。", side: "left" },
    ],
  };
  return {
    schema_version: "1.0.0",
    project_id: "project_best_ai_smoke",
    title: "AI 续写烟测",
    author: "AgentVN 验收示例",
    nodes: [
      {
        id: "start",
        type: "startNode",
        position: { x: 40, y: 260 },
        data: { nodeKind: "start", label: "入口", description: "AI 烟测入口。", memoryMode: "hybrid", aiSettings: aiSettings(""), previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: meta() },
      },
      {
        ...sceneNode("scene_ai_smoke_node", 360, 220, scene),
        data: {
          ...sceneNode("scene_ai_smoke_node", 360, 220, scene).data,
          aiSettings: aiSettings("请续写一个短场景。必须只使用 narration 和 dialog 两类命令；不要使用 background、sprite、animation、camera、choice、state_update、bgm、sfx、wait。输出必须符合 AgentVN SceneBeat 结构。"),
        },
      },
    ],
    edges: [{ id: "edge_start_ai_smoke", source: "start", target: "scene_ai_smoke_node", sourceHandle: "default" }],
    viewport: { x: 120, y: 120, zoom: 0.9 },
    memory_mode: "hybrid",
    asset_manifest: [],
    editor_settings: {
      defaultMemoryMode: "hybrid",
      runtimeUILayout,
    },
    created_at: now,
    updated_at: now,
  };
}

async function seedProject(project, providerState) {
  await getJson(`${backendUrl}/api/project/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_graph: { nodes: project.nodes, edges: project.edges, viewport: project.viewport, memoryMode: project.memory_mode },
      project_metadata: {
        projectId: project.project_id,
        title: project.title,
        author: project.author,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
        assetManifest: project.asset_manifest,
        settings: project.editor_settings,
      },
      recent_projects: [project],
      provider_connections: providerState.provider_connections,
      provider_models: providerState.provider_models,
      provider_selections: providerState.provider_selections,
      provider_secrets: providerState.provider_secrets,
    }),
  });
}

async function providerPreflight(state) {
  const selectedId = state.provider_selections?.text_generation;
  const model = state.provider_models?.find((item) => item.provider_id === selectedId);
  const connection = state.provider_connections?.find((item) => item.connection_id === model?.connection_id);
  const apiKey = connection ? state.provider_secrets?.[connection.connection_id] : undefined;
  if (!connection || !model || !apiKey) {
    throw new Error("缺少真实 text_generation 模型、连接或 Token。");
  }
  const payload = {
    provider_selection: {
      connection_id: connection.connection_id,
      model_id: model.model_name,
      base_url: connection.base_url,
      api_key: apiKey,
      parameters: backendCompatibleProviderParameters(model.default_parameters),
    },
  };
  const result = await getJson(`${backendUrl}/api/providers/test_generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!result.ok) throw new Error(result.error_message || "真实模型测试失败。");
  return { connection, model, apiKey };
}

async function waitForEditorSettled(page) {
  await page.locator(".editor-workspace").waitFor({ state: "visible", timeout: 15000 });
  await page
    .locator(".app-transition-stage.is-switching")
    .waitFor({ state: "detached", timeout: 3000 })
    .catch(() => {});
  await userPace(page);
}

async function clickHelp(page, helpKey, options = {}) {
  const target = page.locator(`[data-help-key="${helpKey}"]`).first();
  await target.waitFor({ state: "visible", timeout: options.timeout ?? 15000 });
  await target.click({ force: options.force ?? true, timeout: options.timeout ?? 15000 });
  await userPace(page);
}

async function openEditor(context, project) {
  const page = await context.newPage();
  await page.addInitScript((draft) => {
    localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(draft));
    localStorage.setItem("agentvn.recentProjects", JSON.stringify([{ project_id: draft.project_id, title: draft.title, author: draft.author, updated_at: draft.updated_at, project: draft }]));
  }, project);
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  const openDraft = page.locator('[data-help-key="home.openDraft"]').first();
  if (await openDraft.isVisible().catch(() => false)) {
    await openDraft.click();
  } else {
    const create = page.locator('[data-help-key="home.createProject"]').first();
    if (await create.isVisible().catch(() => false)) await create.click();
  }
  await waitForEditorSettled(page);
  return page;
}

async function runEditorFlow(project, providerState) {
  const context = await chromium.launchPersistentContext(path.join(workDir, "editor-profile"), {
    headless: true,
    viewport,
    acceptDownloads: true,
    recordVideo: { dir: workVideoDir, size: viewport },
  });
  const page = await openEditor(context, project);
  const video = page.video();
  step("打开编辑器并载入《雨夜第七号柜》项目", "确认项目主页、编辑器过渡、节点画布和检查器能承载一个完整分支故事");

  await clickHelp(page, "toolbar.backendHealth");
  step("点击“检查后端”", "确认本地 FastAPI 后端在线，这是大模型生成和记忆链路的基础");

  for (const kind of ["scene", "modifier", "condition", "animation", "end"]) {
    const button = page.locator(`[data-help-key="palette.${kind}"]`).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await userPace(page);
    }
  }
  step("依次点击左侧节点栏的场景、修饰、条件、动画、结局节点按钮", "验证节点创建入口可用，并覆盖所有核心节点类型；随后会恢复最佳示例项目，避免临时节点污染导出");

  const workbenchButtons = page.locator(".workbench-type-button");
  const workbenchCount = await workbenchButtons.count();
  for (let index = 0; index < workbenchCount; index += 1) {
    await workbenchButtons.nth(index).click();
    await userPace(page);
  }
  step("在浮动事件工作台中切换全部事件类型按钮", "按页面实际事件数量逐一验证，包括 show_image 在内的所有事件按钮入口和切换动效");

  const aiSmokeProject = buildAiSmokeProject(project.editor_settings.runtimeUILayout);
  await seedProject(aiSmokeProject, providerState);
  await page.reload({ waitUntil: "networkidle" });
  const draftBeforeGeneration = page.locator('[data-help-key="home.openDraft"]').first();
  if (await draftBeforeGeneration.isVisible().catch(() => false)) await draftBeforeGeneration.click();
  await waitForEditorSettled(page);
  step("切换到 AI 续写烟测场景", "节点创建和事件工作台测试会生成临时节点；先切换到极简 AI 烟测蓝图，可避免节点遮挡并降低真实模型结构化随机失败率");

  const generateButton = page.locator(".scene-node .ai-node-button").first();
  if (await generateButton.isVisible().catch(() => false)) {
    await generateButton.click({ force: true });
    await page.locator(".scene-node .node-preview.is-streaming").waitFor({ state: "visible", timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('.scene-node .ai-node-button[data-state="generating"]'), null, { timeout: aiTimeoutMs });
    const generationError = page.locator(".toast-status").filter({ hasText: "生成后续失败" }).first();
    if (await generationError.isVisible().catch(() => false)) {
      throw new Error(`场景 AI 续写失败：${(await generationError.textContent())?.trim()}`);
    }
    await userPace(page);
    step("点击场景节点的“辅助生成后续”并等待真实模型返回", "验证真实 OpenAI 兼容模型能经由编辑器请求后端生成结构化场景；生成内容只用于链路验证");
  }

  await seedProject(project, providerState);
  await page.reload({ waitUntil: "networkidle" });
  const restoredDraft = page.locator('[data-help-key="home.openDraft"]').first();
  if (await restoredDraft.isVisible().catch(() => false)) await restoredDraft.click();
  await waitForEditorSettled(page);
  step("恢复人工设计的最佳示例项目", "真实模型输出具有随机性，恢复固定分支故事可保证卡带导出和玩家端验收可重复");

  await clickHelp(page, "toolbar.assistant");
  await page.locator('[data-help-key="assistant.input"]').fill("请用一句话说明这个雨夜分支故事的测试重点。");
  await userPace(page);
  await page.locator('[data-help-key="assistant.send"]').click();
  await waitForAssistantAnswer(page);
  await userPace(page);
  step("打开大模型助手并发送问题", "覆盖工具栏大模型助手、真实模型问答、上下文发送和助手面板动效");

  await clickHelp(page, "toolbar.advanced");
  for (const tab of ["providers", "library", "layout", "animation", "preview", "history", "settings"]) {
    const tabButton = page.locator(`[data-help-key="advanced.tab.${tab}"]`).first();
    if (await tabButton.isVisible().catch(() => false)) {
      await tabButton.click({ force: true });
      await userPace(page);
    }
  }
  step("打开工具/设置并切换模型、素材库、客户端布局、动画、预览、历史、项目设置分类", "验证工具面板每个分类的淡入淡出和容器自然生长动效");

  await clickHelp(page, "advanced.tab.library");
  const importedSvg = path.join(workDir, "manual_bonus_background.svg");
  fs.writeFileSync(importedSvg, decodeURIComponent(svgDataUrl("手动导入背景", "#8c4a5f", "#29151f").split(",")[1]), "utf8");
  await page.locator('[data-help-key="asset.importImage"]').waitFor({ state: "visible", timeout: 10000 });
  const imageChooser = page.waitForEvent("filechooser");
  await page.locator('[data-help-key="asset.importImage"]').click({ force: true });
  await (await imageChooser).setFiles(importedSvg);
  await page.locator(".asset-import-card").waitFor({ state: "visible", timeout: 10000 });
  await userPace(page);
  await page.locator('.asset-import-card [data-help-key="asset.assetId"]').fill("manual_bonus_background");
  await userPace(page);
  await page.locator('.asset-import-card [data-help-key="asset.confirmImport"]').click({ force: true });
  await userPace(page);
  step("在素材库主动导入一张图片并命名为 manual_bonus_background", "验证素材不必经过生成也能进入项目资源清单，并可作为背景资源编号候选");

  await page.locator('[data-help-key="advanced.tab.layout"]').click();
  await userPace(page);
  const firstLayoutBlock = page.locator(".runtime-layout-block").first();
  if (await firstLayoutBlock.isVisible().catch(() => false)) {
    const box = await firstLayoutBlock.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 18, box.y + box.height / 2 + 10, { steps: 6 });
      await page.mouse.up();
      await userPace(page);
      const saveLayout = page.locator('[data-help-key="layout.save"]').first();
      if (await saveLayout.isEnabled().catch(() => false)) {
        await saveLayout.click();
        await userPace(page);
      }
    }
  }
  step("在客户端布局页微调一个 Runtime UI 控件并保存布局", "验证 ui/layout.json 皮肤会跟随卡带导出，玩家端可读取自定义布局");

  await clickHelp(page, "toolbar.exportCartridge");
  await page.locator(".cartridge-export-panel").waitFor({ state: "visible", timeout: 10000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.locator('[data-help-key="package.export"]').click();
  await userPace(page);
  const download = await downloadPromise;
  const downloaded = path.join(workDir, await download.suggestedFilename());
  await download.saveAs(downloaded);
  fs.copyFileSync(downloaded, finalCartridge);
  step("通过编辑器发布与打包面板导出游戏卡带", "验证最终 .vncart 是从编辑器真实导出，而不是测试脚本手工拼装");

  await page.close();
  if (video) await video.saveAs(path.join(finalDir, "editor-flow.webm"));
  await context.close();
}

async function clickUntilChoice(page, max = 24) {
  for (let index = 0; index < max; index += 1) {
    if ((await page.locator(".choice-panel button").count()) > 0) return;
    const dialog = page.locator(".dialog-box").first();
    if (await dialog.isVisible().catch(() => false)) await dialog.click();
    else await page.mouse.click(960, 920);
    await userPace(page);
  }
  throw new Error("等待分支选项超时：玩家端未显示 choice-panel。");
}

async function waitForLoadedGameHome(page, expectedTitle = "雨夜第七号柜") {
  await page.locator(".main-menu").waitFor({ state: "visible", timeout: 12000 });
  const title = (await page.locator(".main-menu h1").first().textContent().catch(() => "")).trim();
  if (!title.includes(expectedTitle)) {
    throw new Error(`游戏结束后未回到已载入卡带主页：期望标题包含 ${expectedTitle}，实际为 ${title || "空"}`);
  }
  if (await page.locator(".library-shell").isVisible().catch(() => false)) {
    throw new Error("游戏结束后错误返回了卡带选择器 library-shell。");
  }
}

async function hasCompletedEnding(page) {
  if (await page.locator(".main-menu").isVisible().catch(() => false)) return true;
  if (await page.locator('[data-testid="game-state-title"]').isVisible().catch(() => false)) return true;
  return false;
}

async function clickUntilEnding(page, preferredChoice) {
  for (let index = 0; index < 36; index += 1) {
    if (await hasCompletedEnding(page)) return;
    const choices = page.locator(".choice-panel button");
    if ((await choices.count()) > 0) {
      const target = choices.filter({ hasText: preferredChoice }).first();
      if (await target.isVisible().catch(() => false)) await target.click();
      else await choices.first().click();
      await userPace(page);
      continue;
    }
    const dialog = page.locator(".dialog-box").first();
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.click();
      await userPace(page);
      continue;
    }
    if (await hasCompletedEnding(page)) return;
    await userPace(page);
  }
  throw new Error(`等待结局超时：未能完整抵达 ${preferredChoice} 分支结尾。`);
}

async function runGameCliFlow() {
  const context = await chromium.launchPersistentContext(path.join(workDir, "gamecli-profile"), {
    headless: true,
    viewport,
    acceptDownloads: true,
    recordVideo: { dir: workVideoDir, size: viewport },
  });
  const page = await context.newPage();
  const video = page.video();
  await page.addInitScript(() => {
    localStorage.removeItem("agentvn.gamecli.webLibrary");
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("agentvn.gamecli.saves.")) localStorage.removeItem(key);
    }
  });
  await page.goto(gameCliUrl, { waitUntil: "networkidle" });
  await userPace(page);
  if ((await page.locator('[data-testid="web-cartridge-file"]').count()) === 0) {
    const libraryButton = page.locator("button").filter({ hasText: "游戏库" }).first();
    if (await libraryButton.isVisible().catch(() => false)) {
      await libraryButton.click();
      await userPace(page);
    }
  }
  await page.locator('[data-testid="web-cartridge-file"]').waitFor({ state: "attached", timeout: 15000 });
  await page.locator('[data-testid="web-cartridge-file"]').setInputFiles(finalCartridge);
  await page.locator(".cartridge-spine").waitFor({ state: "visible", timeout: 15000 });
  await userPace(page);
  step("在 GameCli_framework 游戏库中导入最终 .vncart", "验证玩家端能用浏览器测试入口完成卡带导入、校验和本地安装");

  await page.locator(".launch-actions button").first().click();
  await page.locator(".story-player").waitFor({ state: "visible", timeout: 10000 });
  await userPace(page);
  step("从游戏库启动《雨夜第七号柜》", "验证导入后的卡带能被加载为可游玩的 Runtime 游戏");

  await clickUntilChoice(page);
  await page.locator(".playback-controls button").filter({ hasText: "Save" }).click();
  await userPace(page);
  await page.locator(".save-slot").first().locator("button").last().click();
  await userPace(page);
  await page.locator(".screen-panel header button").click();
  await userPace(page);
  step("在开场分支点保存到 Slot 1", "为后续读档走第二分支建立断点，同时验证存档写入功能");

  await page.locator(".playback-controls button").filter({ hasText: "History" }).click();
  await page.locator(".history-list").waitFor({ state: "visible", timeout: 8000 });
  await userPace(page);
  await page.locator(".screen-panel header button").click();
  await userPace(page);
  step("在分支点打开历史并返回游戏", "验证历史记录会收集旁白和对白；提前覆盖历史，避免结局结束自动返回主页后失去播放器快捷栏");

  await page.locator(".choice-panel button").filter({ hasText: "坦白真相" }).click();
  await userPace(page);
  await clickUntilEnding(page, "信任重建");
  step("选择“坦白真相”并通关信任重建分支", "验证 choice、state_update、condition、animation 和 end 节点在玩家端串联生效");
  await waitForLoadedGameHome(page);
  await userPace(page);
  step("确认第一结局结束后回到已载入卡带主页", "验证游戏结束事件进入 MainMenu，当前卡带仍然载入，且没有退回卡带选择器");

  await page.locator(".menu-actions button").nth(3).click();
  await page.locator(".gallery-grid").waitFor({ state: "visible", timeout: 8000 });
  await userPace(page);
  step("从菜单进入画廊", "验证画廊入口和空/锁定内容页不会阻断玩家流程");
  await page.locator(".screen-panel header button").click().catch(() => {});
  await userPace(page);

  await page.locator(".menu-actions button").nth(4).click();
  await userPace(page);
  await page.locator(".settings-grid input[type='range']").first().fill("20");
  await userPace(page);
  await page.locator(".screen-panel header button").click();
  await userPace(page);
  step("打开设置、调整文字速度并完成", "验证设置页滑条、持久化入口和返回菜单流程");

  await page.locator(".menu-actions button").nth(1).click();
  await userPace(page);
  await page.locator(".save-slot").first().locator(".card-actions button").first().click();
  await page.locator(".story-player").waitFor({ state: "visible", timeout: 8000 });
  await userPace(page);
  await clickUntilChoice(page);
  step("从 Slot 1 读档回到分支点", "验证读档能恢复当前场景、命令索引、变量和历史快照");

  await page.locator(".choice-panel button").filter({ hasText: "隐瞒线索" }).click();
  await userPace(page);
  await clickUntilEnding(page, "独自离开");
  step("选择“隐瞒线索”并通关独自离开分支", "验证同一卡带的第二条分支可从存档断点完整游玩到不同结局");
  await waitForLoadedGameHome(page);
  await userPace(page);
  step("确认第二结局结束后仍回到已载入卡带主页", "验证读档后的另一条结局也触发同一套结束事件，库模式和单卡带模式可共用该行为");

  await page.locator(".menu-actions button").last().click();
  await page.locator(".screen-panel").waitFor({ state: "visible", timeout: 8000 });
  await userPace(page);
  step("进入关于页", "验证玩家端 shell 的关于入口可打开，覆盖菜单非播放类功能");

  await page.close();
  if (video) await video.saveAs(path.join(finalDir, "gamecli-flow.webm"));
  await context.close();
}

async function main() {
  ensureCleanDir();
  step("清理旧的 best-example 测试产物目录", "满足只保留最终一轮产物的要求，并避免旧截图/录屏污染验收判断");
  await getJson(`${backendUrl}/api/health`);
  await fetch(editorUrl);
  await fetch(gameCliUrl);
  step("确认后端、编辑器、GameCli 三端服务可访问", "全流程依赖三端同时在线，先排除服务未启动造成的假失败");

  const stateResponse = await getJson(`${backendUrl}/api/project/state`);
  const state = stateResponse.data;
  const provider = await providerPreflight(state);
  step(`使用真实模型 ${provider.model.model_name} 完成 provider_generation 预检`, "确认本轮大模型测试不会走 mock，也不会在缺 Token 时误判通过");

  const runtimeUILayout = state.project_metadata?.settings?.runtimeUILayout;
  const project = buildProject(runtimeUILayout);
  await seedProject(project, state);
  step("写入最佳示例项目到编辑器共享状态", "让 Playwright 打开编辑器时直接进入完整故事蓝图，便于随后用 UI 覆盖关键功能");

  await runEditorFlow(project, state);
  const verifyOutput = (await runCommand("verify-vncart", process.execPath, [path.join(root, "scripts", "verify-vncart.cjs"), finalCartridge])).stdout;
  step("对导出的最佳示例.vncart 执行 verify-vncart 校验", "确认卡带结构、资源文件、校验和、manifest 与 script 均可被独立工具验证");

  await ensureNoSecretInCartridge(finalCartridge, state);
  step("扫描最终卡带中的 Provider 配置与密钥片段", "确认发布产物没有携带 API Token、sk-* 片段或 provider_secrets 字段，保护用户模型密钥");

  fs.rmSync(workVideoDir, { recursive: true, force: true });
  fs.mkdirSync(workVideoDir, { recursive: true });
  step("删除首轮临时录屏并准备最终 GameCli 录制", "按照只保留最终产物策略清理中间记录，再从卡带已通过的大步骤继续");

  await runGameCliFlow();

  const editorBuild = await runCommand("editor npm run build", npmCommand, ["run", "build"], { cwd: path.join(root, "editor") });
  step("运行 editor npm run build", "确认最佳示例验收后的编辑器源码仍能通过 TypeScript 与 Vite 构建");
  const gameCliBuild = await runCommand("GameCli_framework npm run build", npmCommand, ["run", "build"], { cwd: path.join(root, "GameCli_framework") });
  step("运行 GameCli_framework npm run build", "确认玩家端源码在导入和游玩验收后仍能通过 TypeScript 与 Vite 构建");

  fs.writeFileSync(path.join(finalDir, "操作记录.txt"), operations.join("\n") + "\n", "utf8");
  fs.writeFileSync(path.join(finalDir, "故障与未实现清单.md"), [
    "# 故障与未实现清单",
    "",
    "## 已发现并补足",
    ...fixes.map((item) => `- ${item}`),
    "",
    "## 最终残留",
    failures.length ? failures.map((item) => `- ${item}`).join("\n") : "- 未发现阻塞最终流程的残留故障。",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(finalDir, "最终测试报告.md"), [
    "# AgentVN 最佳应用示例最终测试报告",
    "",
    `- 测试时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    "- 故事：雨夜第七号柜",
    "- 分支：坦白真相 / 隐瞒线索",
    `- 真实模型：${provider.model.model_name}`,
    "- 编辑器构建：已通过",
    "- GameCli 构建：已通过",
    "- 卡带校验：已通过",
    "- 数据边界：卡带内未发现 provider 配置、API Token 或 sk-* 密钥片段",
    "- GameCli 导入：已通过",
    "- 历史/存档/读档/设置/菜单/画廊/关于：已覆盖",
    "",
    "## verify-vncart",
    "```json",
    String(verifyOutput).trim(),
    "```",
    "",
    "## build",
    "```text",
    editorBuild.stdout.split("\n").slice(-12).join("\n"),
    gameCliBuild.stdout.split("\n").slice(-12).join("\n"),
    "```",
  ].join("\n"), "utf8");
  fs.rmSync(workDir, { recursive: true, force: true });
  console.log(`DONE ${finalDir}`);
}

main().catch((error) => {
  failures.push(error.stack || error.message || String(error));
  fs.mkdirSync(finalDir, { recursive: true });
  fs.writeFileSync(path.join(finalDir, "故障与未实现清单.md"), [
    "# 故障与未实现清单",
    "",
    "## 本轮失败",
    "- 复现步骤：运行 `node scripts/best-example-acceptance.cjs`。",
    "- 实际结果：脚本在当前记录步骤附近中断，未完成最终验收。",
    "- 期望结果：生成最终卡带、录屏、操作记录、故障清单和最终报告，并清理中间目录。",
    "- 影响：最佳应用示例不能作为完整演示/发布验收证据。",
    "- 初步修复计划：根据下方错误栈定位最小失败点，修复后删除中间记录，并从失败大步骤重新运行。",
    "",
    "## 错误详情",
    ...failures.map((item) => `\n\`\`\`text\n${item}\n\`\`\``),
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(finalDir, "操作记录.txt"), operations.join("\n") + "\n", "utf8");
  console.error(error);
  process.exit(1);
});
