const fs = require("fs");
const path = require("path");
const { loadProjectContainerSync, saveProjectContainerSync } = require("./project-container.cjs");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const testDir = path.join(root, "test_AgentVN", "client-layout-real-preview");
const outputDir = path.join(root, "output", "playwright", "client-layout-real-preview");
const editorUrl = "http://127.0.0.1:6767/";
const gameCliUrl = "http://127.0.0.1:6868/?preview=1&embedded=1";
const runtimeOrigin = "http://127.0.0.1:6868";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const headed = process.argv.includes("--headed");
const glassOnly = process.argv.includes("--glass-only");
const layoutOnly = process.argv.includes("--layout-only");
const skipGlass = process.argv.includes("--skip-glass");

const aboutCopy = {
  title: "AUTO About Title",
  kicker: "AUTO Kicker",
  heading: "AUTO Main Heading",
  description: "AUTO description text from user override settings.",
  fields: [
    { label: "AUTO Field", value: "Field Value 123" },
    { label: "Release Batch", value: "RealPreview-2026" },
  ],
  note: "AUTO Footer Note",
};

const screens = [
  { id: "title_menu", selector: "[data-testid='start-new-game']", screenshot: "screen-title.png" },
  { id: "playing", selector: "[data-testid='game-state-playing']", screenshot: "screen-playing.png" },
  { id: "settings", selector: ".settings-renpy.has-settings-panel-background", screenshot: "screen-settings.png" },
  { id: "save_load", selector: ".save-grid", screenshot: "screen-save-load.png" },
  { id: "history", selector: ".history-list", screenshot: "screen-history.png" },
  { id: "gallery", selector: "[data-testid='gallery-screen']", screenshot: "screen-gallery.png" },
  { id: "about", selector: "[data-testid='about-screen']", screenshot: "screen-about.png" },
];

function rgbToHex(rgb) {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(rgb ?? "");
  if (!match) return rgb;
  return `#${match.slice(1, 4).map((value) => Number(value).toString(16).padStart(2, "0")).join("")}`;
}

function colorNear(rgb, expectedHex, tolerance = 3) {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(rgb ?? "");
  const expected = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(expectedHex);
  if (!match || !expected) return false;
  return [0, 1, 2].every((index) => Math.abs(Number(match[index + 1]) - parseInt(expected[index + 1], 16)) <= tolerance);
}

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) throw new Error(`Refusing outside-root path: ${resolved}`);
  return resolved;
}

function resetOutputDirs() {
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
  return child;
}

function stopDevServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

async function ensureServer(name, url, cwd) {
  if (await isListening(url)) return undefined;
  const child = startDevServer(name, cwd);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await isListening(url)) return child;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} did not start at ${url}`);
}

function svgDataUrl(label, colorA, colorB) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colorA}"/><stop offset="1" stop-color="${colorB}"/></linearGradient></defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <circle cx="520" cy="92" r="58" fill="#fff" fill-opacity=".22"/>
  <text x="48" y="190" font-family="sans-serif" font-size="42" font-weight="800" fill="#ffffff">${label}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const settingsBgDataUrl = svgDataUrl("SETTINGS_BG", "#123456", "#c039ff");
const titleBgDataUrl = svgDataUrl("TITLE_BG", "#06121f", "#0fb9b1");

function buildAssetRef(assetId, filename, dataUrl) {
  return {
    asset_id: assetId,
    asset_type: "background",
    metadata: {
      display_name: assetId,
      filename,
      mime_type: "image/svg+xml",
      size_bytes: Buffer.byteLength(dataUrl, "utf8"),
      source: "acceptance",
      data_url: dataUrl,
      blob_url: dataUrl,
      project_path: `assets/background/${assetId}-${filename}`,
      created_at: new Date().toISOString(),
    },
  };
}

function buildRuntimeScript() {
  return {
    schema_version: "1.0.0",
    game_id: "client_layout_real_preview",
    title: "Client Layout Real Preview",
    entry_scene_id: "real_preview_scene",
    characters: [{ character_id: "tester", name: "Auto Tester", aliases: [] }],
    scenes: [{
      scene_id: "real_preview_scene",
      title: "Real Preview Scene",
      summary: "Real GameCLI preview acceptance.",
      chapter: 1,
      tags: ["acceptance"],
      commands: [
        { type: "narration", text: "Real GameCLI playing page is loaded." },
        { type: "dialog", character_id: "tester", text: "Settings background, about copy, and page switching must render for real.", side: "left" },
      ],
    }],
  };
}

function buildProjectFile() {
  const now = new Date().toISOString();
  const scene = buildRuntimeScript().scenes[0];
  const assets = [
    buildAssetRef("settings_panel_bg", "settings-panel.svg", settingsBgDataUrl),
    buildAssetRef("title_bg", "title-bg.svg", titleBgDataUrl),
  ];
  return {
    schema_version: "1.0.0",
    project_id: `client_layout_real_preview_${Date.now()}`,
    title: "Client Layout Real Preview",
    author: "AgentVN QA",
    nodes: [
      { id: "start", type: "startNode", position: { x: 40, y: 220 }, data: { nodeKind: "start", label: "入口", description: "", memoryMode: "hybrid", aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false }, previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: { collapsedInspectorSections: [], source: "manual" } } },
      { id: "scene", type: "sceneNode", position: { x: 320, y: 180 }, data: { nodeKind: "scene", label: scene.title, description: scene.summary, memoryMode: "hybrid", aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false }, previewState: { currentCommandIndex: 0, isPlaying: false }, editorMeta: { collapsedInspectorSections: [], source: "manual" }, scene } },
    ],
    edges: [{ id: "edge_start_scene", source: "start", target: "scene", sourceHandle: "default" }],
    viewport: { x: 0, y: 0, zoom: 1 },
    memory_mode: "hybrid",
    asset_manifest: assets,
    editor_settings: {
      packageAppearance: {
        titleBackgroundAssetId: "title_bg",
        titleBackgroundFit: "cover",
        titleBackgroundDimming: 0.12,
        settingsPanelBackgroundAssetId: "settings_panel_bg",
        settingsPanelBackgroundFit: "contain",
        settingsPanelBackgroundDimming: 0.18,
        about: aboutCopy,
      },
      runtimeUILayout: {
        ui_layout_version: "1.0.0",
        name: "Auto Tester",
        target_runtime: "0.1.0",
        tokens: { colorBackground: "#050812", colorAccent: "#ff4fd8", colorInk: "#ffffff", colorSurface: "#101827" },
        assets: [],
        screens: [
          { screen_id: "title", components: [
            { component_id: "title_start_button", component_type: "main_menu_start_button", required: true, rect: { x: 74, y: 34, width: 22, height: 8 }, style: { backgroundColor: "#ff4fd8", color: "#ffffff", borderRadius: 14 } },
            { component_id: "title_continue_button", component_type: "main_menu_continue_button", required: true, rect: { x: 74, y: 24, width: 22, height: 8 } },
            { component_id: "title_save_load_button", component_type: "main_menu_save_load_button", required: true, rect: { x: 74, y: 44, width: 22, height: 8 } },
            { component_id: "title_library_button", component_type: "main_menu_library_button", required: true, rect: { x: 74, y: 54, width: 22, height: 8 } },
            { component_id: "title_gallery_button", component_type: "main_menu_gallery_button", required: true, rect: { x: 74, y: 64, width: 22, height: 8 } },
            { component_id: "title_settings_button", component_type: "main_menu_settings_button", required: true, rect: { x: 74, y: 74, width: 22, height: 8 } },
            { component_id: "title_about_button", component_type: "main_menu_about_button", required: true, rect: { x: 74, y: 84, width: 22, height: 8 } },
          ] },
          { screen_id: "player", components: [{ component_id: "dialog_panel", component_type: "dialog_panel", required: true, rect: { x: 6, y: 76, width: 88, height: 18 } }, { component_id: "choice_list", component_type: "choice_list", required: true, rect: { x: 50, y: 44, width: 34, height: 32, anchor: "center" } }, { component_id: "quick_menu", component_type: "quick_menu", required: true, rect: { x: 98, y: 2, width: 48, height: 8, anchor: "top_right" } }] },
          { screen_id: "save_load", components: [{ component_id: "save_grid", component_type: "save_slot_grid", required: true, rect: { x: 4, y: 18, width: 92, height: 72 } }] },
          { screen_id: "preferences", components: [{ component_id: "settings_group", component_type: "settings_group", required: true, rect: { x: 5, y: 18, width: 62, height: 70 }, style: { backgroundColor: "#000000", backgroundImage: "assets/background/title_bg-title-bg.svg", backgroundFit: "cover" } }] },
          { screen_id: "history", components: [{ component_id: "history_list", component_type: "history_list", required: true, rect: { x: 5, y: 18, width: 90, height: 72 } }] },
          { screen_id: "gallery", components: [{ component_id: "gallery_grid", component_type: "gallery_grid", required: true, rect: { x: 5, y: 18, width: 90, height: 72 } }] },
          { screen_id: "about", components: [{ component_id: "about_panel", component_type: "about_panel", required: true, rect: { x: 5, y: 18, width: 58, height: 48 } }] },
        ],
      },
      defaultMemoryMode: "hybrid",
      defaultSpriteScale: 0.82,
      characterDisplayNames: {},
      characterDialogStyles: {},
      assetLibrary: { folders: [], assetLocations: {} },
      editorAppearance: {},
    },
    created_at: now,
    updated_at: now,
  };
}

function manifestAssetFromRef(asset) {
  return {
    asset_id: asset.asset_id,
    asset_type: asset.asset_type,
    path: asset.metadata.project_path,
    filename: asset.metadata.filename,
    mime_type: asset.metadata.mime_type,
    size_bytes: asset.metadata.size_bytes,
    preload: true,
  };
}

function dataUrlToBuffer(dataUrl) {
  const [, meta, data] = /^data:([^,]*),(.*)$/.exec(dataUrl) || [];
  if (!data) throw new Error(`Invalid data URL: ${dataUrl.slice(0, 48)}`);
  return /;base64/i.test(meta) ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data));
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function packRuntimeCartridge(projectPath) {
  const project = loadProjectContainerSync(projectPath).project;
  const projectZip = await JSZip.loadAsync(fs.readFileSync(projectPath));
  const script = buildRuntimeScript();
  const assets = project.asset_manifest.map(manifestAssetFromRef);
  const manifest = {
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: "0.2.0",
    game_id: script.game_id,
    title: script.title,
    author: project.author,
    description: aboutCopy.description,
    version: "0.1.0-preview",
    language: "zh-CN",
    tags: [],
    shell: {
      background: "title_bg",
      background_fit: "cover",
      title_background_dimming: 0.12,
      settings_panel_background: "settings_panel_bg",
      settings_panel_background_fit: "contain",
      settings_panel_background_dimming: 0.18,
      about: aboutCopy,
    },
    entry_script: "script.json",
    entry_scene_id: script.entry_scene_id,
    assets,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ui_skin: { path: "ui/layout.json", version: "1.0.0", name: "Auto Tester" },
  };
  const gallery = { gallery_version: "1.0.0", items: [] };
  const uiSkin = project.editor_settings.runtimeUILayout;
  const files = [
    { path: "manifest.json", data: JSON.stringify(manifest, null, 2) },
    { path: "script.json", data: JSON.stringify(script, null, 2) },
    { path: "gallery.json", data: JSON.stringify(gallery, null, 2) },
    { path: "ui/layout.json", data: JSON.stringify(uiSkin, null, 2) },
  ];
  for (const assetRef of project.asset_manifest) {
    const embedded = projectZip.file(assetRef.metadata.project_path);
    const data = typeof assetRef.metadata.data_url === "string"
      ? dataUrlToBuffer(assetRef.metadata.data_url)
      : embedded
        ? await embedded.async("nodebuffer")
        : undefined;
    if (!data) throw new Error(`Missing project asset: ${assetRef.metadata.project_path}`);
    files.push({ path: assetRef.metadata.project_path, data });
  }
  const checksum = {
    checksum_version: "1.0.0",
    algorithm: "sha256",
    generated_at: new Date().toISOString(),
    files: files.map((file) => ({ path: file.path, size_bytes: Buffer.byteLength(file.data), hash_sha256: sha256(file.data) })).sort((a, b) => a.path.localeCompare(b.path)),
  };
  const zip = new JSZip();
  for (const file of files) zip.file(file.path, file.data);
  zip.file("checksum.json", JSON.stringify(checksum, null, 2));
  const cartridgePath = path.join(testDir, "client-layout-real-preview.vncart");
  fs.writeFileSync(cartridgePath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return cartridgePath;
}

async function importProject(page, projectPath) {
  /*
   * Import the actual bundle instead of opening a browser-storage draft.
   * Browser drafts intentionally strip embedded asset payloads, so opening
   * one here would make the live preview manifest point at title/settings
  * assets that no longer have a usable URL.
  */
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("client-layout-real-preview:import-started")) return;
    window.sessionStorage.setItem("client-layout-real-preview:import-started", "1");
    window.localStorage.removeItem("agentvn.currentProjectDraft");
    window.localStorage.removeItem("agentvn.recentProjects");
  });
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const input = document.querySelector(".project-import-button input");
    const button = document.querySelector(".project-import-button");
    return input && !input.disabled && button?.getAttribute("aria-disabled") !== "true";
  }, null, { timeout: 20000 });
  await page.locator(".project-import-button input").first().setInputFiles(projectPath);
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(800);
}

async function loadRuntimePreview(page, cartridgePath, screen = "title_menu") {
  const bytes = fs.readFileSync(cartridgePath);
  await page.addInitScript(() => window.localStorage.removeItem("agentvn.gamecli.webLibrary"));
  await page.goto(gameCliUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ base64, screen }) => {
    window.postMessage({ type: "agentvn.runtime.preview", cartridgeBase64: base64, filename: "Auto Tester", previewNonce: `${Date.now()}-${Math.random()}`, screen }, window.location.origin);
  }, { base64: bytes.toString("base64"), screen });
  await page.locator("[data-testid='start-new-game']").waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector(".boot-overlay"), null, { timeout: 60000 }).catch(() => {});
}

async function selectRuntimeScreen(page, screen) {
  await page.waitForFunction(() => {
    const seam = document.querySelector("[data-runtime-screen-transition]");
    return (
      seam?.getAttribute("data-runtime-screen-transition") === "idle"
      && !document.querySelector('[data-testid="game-launch-blackout"]')
    );
  }, null, { timeout: 30000 });
  await page.evaluate((screen) => {
    window.postMessage({ type: "agentvn.runtime.screen", screen }, window.location.origin);
  }, screen);
  await page.waitForFunction((target) => {
    const seam = document.querySelector("[data-runtime-screen-transition]");
    return (
      seam?.getAttribute("data-runtime-transition-to") === target
      || seam?.getAttribute("data-runtime-committed-screen") === target
    );
  }, screen, { timeout: 10000 });
  await page.waitForFunction((target) => {
    const seam = document.querySelector("[data-runtime-screen-transition]");
    return (
      seam?.getAttribute("data-runtime-screen-transition") === "idle"
      && seam?.getAttribute("data-runtime-committed-screen") === target
      && !document.querySelector('[data-testid="game-launch-blackout"]')
    );
  }, screen, { timeout: 30000 });
}

async function verifySettingsBackground(page, report, prefix) {
  await page.waitForFunction(() => {
    const node = document.querySelector(".settings-renpy.has-settings-panel-background");
    return node && getComputedStyle(node).backgroundImage.includes("url(");
  }, null, { timeout: 30000 }).catch(() => {});
  const metrics = await page.locator(".settings-renpy.has-settings-panel-background").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      backgroundImage: style.backgroundImage,
      backgroundSize: style.backgroundSize,
      backgroundRepeat: style.backgroundRepeat,
      backgroundPosition: style.backgroundPosition,
      className: node.className,
    };
  });
  if (!/url\(/.test(metrics.backgroundImage)) throw new Error(`${prefix}: settings backgroundImage was not applied: ${JSON.stringify(metrics)}`);
  if (!metrics.backgroundSize.includes("contain")) throw new Error(`${prefix}: expected contain backgroundSize, got ${metrics.backgroundSize}`);
  if (!metrics.backgroundRepeat.split(",").every((item) => item.trim() === "no-repeat")) throw new Error(`${prefix}: expected no-repeat layers, got ${metrics.backgroundRepeat}`);
  report.checks.push({ id: `${prefix}:settingsBackground`, ok: true, metrics });
}

async function verifyTitleVisuals(page, report, prefix) {
  const metrics = await page.locator("[data-testid='game-state-title']").evaluate((node) => {
    const rootStyle = getComputedStyle(node);
    const button = document.querySelector("[data-testid='start-new-game']");
    const exitButton = document.querySelector("[data-testid='open-exit-confirmation']");
    const settingsButton = document.querySelector("[data-testid='open-settings']");
    const libraryButton = document.querySelector("[data-testid='open-library']");
    const buttonStyle = button ? getComputedStyle(button) : null;
    const rect = button instanceof HTMLElement ? button.getBoundingClientRect() : null;
    return {
      rootBackgroundImage: rootStyle.backgroundImage,
      rootBackgroundSize: rootStyle.backgroundSize,
      rootBackgroundRepeat: rootStyle.backgroundRepeat,
      buttonBackgroundColor: buttonStyle?.backgroundColor ?? null,
      buttonColor: buttonStyle?.color ?? null,
      buttonBorderRadius: buttonStyle?.borderRadius ?? null,
      buttonRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      buttonComponentId: button?.getAttribute("data-ui-component-id") ?? null,
      hasExitButton: Boolean(exitButton),
      settingsLabel: settingsButton?.textContent?.trim() ?? null,
      hasLibraryButton: Boolean(libraryButton),
    };
  });
  if (!/url\(/.test(metrics.rootBackgroundImage)) throw new Error(`${prefix}: title backgroundImage was not applied: ${JSON.stringify(metrics)}`);
  if (!metrics.rootBackgroundSize.includes("cover")) throw new Error(`${prefix}: expected cover title backgroundSize, got ${metrics.rootBackgroundSize}`);
  if (!metrics.rootBackgroundRepeat.split(",").every((item) => item.trim() === "no-repeat")) throw new Error(`${prefix}: expected no-repeat title background layers, got ${metrics.rootBackgroundRepeat}`);
  // Default title actions are intentionally pure text. A project may replace
  // this style later from Client Layout, but the generated/default layout must
  // not silently restore a filled card or gradient button.
  if (!/^rgba?\(\s*0,\s*0,\s*0(?:,\s*0(?:\.0+)?)?\s*\)$/.test(metrics.buttonBackgroundColor)
    && metrics.buttonBackgroundColor !== "transparent") {
    throw new Error(`${prefix}: default title start button must be text-only: ${JSON.stringify(metrics)}`);
  }
  if (metrics.buttonBorderRadius !== "0px") {
    throw new Error(`${prefix}: default title start button must not have a filled-card radius: ${JSON.stringify(metrics)}`);
  }
  if (!metrics.buttonColor || /^rgba?\(\s*0,\s*0,\s*0(?:,\s*0(?:\.0+)?)?\s*\)$/.test(metrics.buttonColor)) {
    throw new Error(`${prefix}: title start button text color must remain visible: ${JSON.stringify(metrics)}`);
  }
  if (metrics.buttonComponentId !== "title_start_button") throw new Error(`${prefix}: title start button component id mismatch: ${JSON.stringify(metrics)}`);
  if (metrics.hasExitButton) throw new Error(`${prefix}: title menu still exposes an exit button: ${JSON.stringify(metrics)}`);
  if (metrics.settingsLabel !== "选项") throw new Error(`${prefix}: title settings entry was not renamed to options: ${JSON.stringify(metrics)}`);
  if (metrics.hasLibraryButton) throw new Error(`${prefix}: migrated title still exposes the removed library button`);
  const embedded = prefix === "editorIframe";
  const expectedLeft = metrics.viewport.width * (embedded ? 0.5 : 0.68);
  const expectedWidth = metrics.viewport.width * (embedded ? 0.06 : 0.14);
  if (!metrics.buttonRect
    || metrics.buttonRect.left < expectedLeft
    || metrics.buttonRect.width < expectedWidth
    || metrics.buttonRect.left + metrics.buttonRect.width > metrics.viewport.width) {
    throw new Error(`${prefix}: title start button layout did not render in expected area: ${JSON.stringify(metrics)}`);
  }
  report.checks.push({ id: `${prefix}:titleVisuals`, ok: true, metrics });
}

async function verifyAboutCopy(page, report, prefix) {
  const text = await page.locator("[data-testid='about-screen']").innerText({ timeout: 10000 });
  const normalizedText = text.toLowerCase();
  for (const expected of [aboutCopy.title, aboutCopy.kicker, aboutCopy.heading, aboutCopy.description, aboutCopy.fields[0].label, aboutCopy.fields[0].value, aboutCopy.fields[1].label, aboutCopy.fields[1].value, aboutCopy.note]) {
    if (!normalizedText.includes(expected.toLowerCase())) throw new Error(`${prefix}: about copy missing ${expected}; actual=${text}`);
  }
  if (text.includes("由编辑器发起的 GameCLI 完整运行预览")) throw new Error(`${prefix}: stale hard-coded preview text is still visible`);
  report.checks.push({ id: `${prefix}:aboutCopy`, ok: true });
}

async function runRuntimeAcceptance(browser, cartridgePath, report) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await loadRuntimePreview(page, cartridgePath);
    for (const screen of screens) {
      await selectRuntimeScreen(page, screen.id);
      await page.locator(screen.selector).first().waitFor({ state: "visible", timeout: 20000 });
      await page.screenshot({ path: path.join(outputDir, `runtime-${screen.screenshot}`), fullPage: false });
      report.checks.push({ id: `runtime:screen:${screen.id}`, ok: true });
      if (screen.id === "title_menu") await verifyTitleVisuals(page, report, "runtime");
      if (screen.id === "settings") await verifySettingsBackground(page, report, "runtime");
      if (screen.id === "about") await verifyAboutCopy(page, report, "runtime");
    }
  } finally {
    await page.close().catch(() => {});
  }
}

async function waitForPreviewFrame(page) {
  await page.locator(".preview-panel.is-expanded").waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".embedded-runtime-preview-frame iframe").waitFor({ state: "visible", timeout: 15000 });
  const iframeElement = await page.locator(".embedded-runtime-preview-frame iframe").elementHandle();
  const frame = await iframeElement.contentFrame();
  if (!frame) throw new Error("Preview iframe did not expose a content frame");
  await page.locator(".embedded-runtime-preview-status.is-ready").waitFor({ state: "visible", timeout: 30000 });
  await frame.locator("[data-testid='game-state-playing'], [data-testid='game-state-title']").first().waitFor({ state: "visible", timeout: 90000 });
  await frame.waitForFunction(() => !document.querySelector(".boot-overlay"), null, { timeout: 60000 }).catch(() => {});
  return frame;
}

async function waitForSplitValue(page, expected, tolerance = 0) {
  try {
    await page.waitForFunction(({ value, tolerance: allowed }) => {
      const splitter = document.querySelector(".preview-splitter");
      return Math.abs(Number(splitter?.getAttribute("aria-valuenow")) - value) <= allowed;
    }, { value: expected, tolerance }, { timeout: 5000 });
  } catch (error) {
    const actual = await page.locator(".preview-splitter").getAttribute("aria-valuenow").catch(() => null);
    const stored = await page.evaluate(() => window.localStorage.getItem("agentvn.previewSplitRatio")).catch(() => null);
    throw new Error(`Preview split value did not reach ${expected}±${tolerance}; actual=${actual} stored=${stored}; ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function dragPreviewSplitterTo(page, clientY) {
  const splitter = page.locator(".preview-splitter");
  const rect = await splitter.boundingBox();
  if (!rect) throw new Error("Preview splitter is not measurable for pointer drag");
  const clientX = rect.x + rect.width / 2;
  const startY = rect.y + rect.height / 2;
  await page.mouse.move(clientX, startY);
  await page.mouse.down();
  await page.mouse.move(clientX, clientY, { steps: 4 });
  await page.mouse.up();
}

async function verifyEditorPreviewLayout(page, report) {
  const workspaceRect = await page.locator(".editor-workspace").boundingBox();
  const flowRect = await page.locator(".flow-surface").boundingBox();
  const scenePaneRect = await page.locator(".scene-editor-pane").boundingBox();
  const panelRect = await page.locator(".preview-panel.is-expanded").boundingBox();
  const splitterRect = await page.locator(".preview-splitter").boundingBox();
  const configuredSplitValue = Number(await page.locator(".preview-splitter").getAttribute("aria-valuenow"));
  const inspectorRect = await page.locator(".inspector-panel").boundingBox();
  const iframeRect = await page.locator(".embedded-runtime-preview-frame iframe").boundingBox();
  if (!workspaceRect || !flowRect || !scenePaneRect || !panelRect || !splitterRect || !inspectorRect || !iframeRect) {
    throw new Error("Editor preview layout is not fully measurable");
  }
  const paneHeight = panelRect.height + inspectorRect.height;
  const previewRatio = paneHeight > 0 ? panelRect.height / paneHeight : 0;
  if (Math.abs(panelRect.width - scenePaneRect.width) > 3) {
    throw new Error(`Preview does not span the right scene editor pane: scenePane=${JSON.stringify(scenePaneRect)} panel=${JSON.stringify(panelRect)}`);
  }
  if (scenePaneRect.x < flowRect.x + flowRect.width) {
    throw new Error(`Preview pane must stay to the right of the story canvas: flow=${JSON.stringify(flowRect)} scenePane=${JSON.stringify(scenePaneRect)}`);
  }
  const configuredSplitRatio = configuredSplitValue / 100;
  if (!Number.isFinite(configuredSplitRatio) || Math.abs(previewRatio - configuredSplitRatio) > 0.03) {
    throw new Error(`Default right scene pane split does not match the configured value: configured=${configuredSplitRatio} actual=${previewRatio}`);
  }
  if (inspectorRect.y < splitterRect.y + splitterRect.height - 1) {
    throw new Error(`Scene inspector overlaps the splitter: splitter=${JSON.stringify(splitterRect)} inspector=${JSON.stringify(inspectorRect)}`);
  }
  if (iframeRect.width < scenePaneRect.width * 0.85 || iframeRect.height > panelRect.height + 2) {
    throw new Error(`Right-pane iframe geometry is invalid: scenePane=${JSON.stringify(scenePaneRect)} panel=${JSON.stringify(panelRect)} iframe=${JSON.stringify(iframeRect)}`);
  }
  report.checks.push({
    id: "editor:rightScenePaneSplit",
    ok: true,
    workspaceRect,
    flowRect,
    scenePaneRect,
    panelRect,
    splitterRect,
    inspectorRect,
    iframeRect,
    previewRatio,
    configuredSplitRatio,
  });
}

async function verifyEditorPreviewSplitter(page, projectPath, report) {
  const splitter = page.locator(".preview-splitter");
  const initialValue = Number(await splitter.getAttribute("aria-valuenow"));
  const keyboardValue = Math.min(65, initialValue + 2);
  await splitter.focus();
  await page.keyboard.press("ArrowDown");
  await waitForSplitValue(page, keyboardValue);
  const keyboardStoredRatio = Number(await page.evaluate(() => window.localStorage.getItem("agentvn.previewSplitRatio")));
  if (Math.abs(keyboardStoredRatio - (keyboardValue / 100)) > 0.001) {
    throw new Error(`Keyboard split ratio was not persisted: ${keyboardStoredRatio}`);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  const toolbar = page.locator(".editor-toolbar");
  if (!(await toolbar.isVisible({ timeout: 3000 }).catch(() => false))) {
    const openDraft = page.locator('[data-help-key="home.openDraft"]:visible, [data-help-key="home.recentProject"]:visible').first();
    await openDraft.waitFor({ state: "visible", timeout: 20000 });
    await openDraft.click({ force: true });
  }
  if (!(await toolbar.isVisible({ timeout: 8000 }).catch(() => false))) {
    await page.evaluate(() => {
      document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
        element.style.pointerEvents = "none";
      });
      const entries = Array.from(document.querySelectorAll('[data-help-key="home.openDraft"], [data-help-key="home.recentProject"]'));
      const entry = entries.find((element) => element instanceof HTMLElement && element.offsetParent !== null);
      if (entry instanceof HTMLElement) entry.click();
    });
  }
  if (!(await toolbar.isVisible({ timeout: 3000 }).catch(() => false))) {
    await importProject(page, projectPath);
  }
  await toolbar.waitFor({ state: "visible", timeout: 20000 });
  await waitForPreviewFrame(page);
  await waitForSplitValue(page, keyboardValue);

  const restoredSplitValue = Number(await splitter.getAttribute("aria-valuenow"));
  if (!Number.isFinite(restoredSplitValue) || restoredSplitValue < 35 || restoredSplitValue > 65) {
    throw new Error(`Preview split ratio was restored outside its supported range: ${restoredSplitValue}`);
  }
  const restoredWorkspaceRect = await page.locator(".scene-editor-pane").boundingBox();
  const restoredInspectorRect = await page.locator(".inspector-panel").boundingBox();
  if (!restoredWorkspaceRect || !restoredInspectorRect || restoredInspectorRect.top < restoredWorkspaceRect.top) {
    throw new Error(`Preview splitter restore produced invalid editor geometry: workspace=${JSON.stringify(restoredWorkspaceRect)} inspector=${JSON.stringify(restoredInspectorRect)}`);
  }

  await page.locator(".preview-collapse-button").click();
  await page.locator(".preview-panel.is-collapsed").waitFor({ state: "visible", timeout: 5000 });
  await page.waitForFunction(() => {
    const splitter = document.querySelector(".preview-splitter");
    if (!(splitter instanceof HTMLElement)) return false;
    const style = getComputedStyle(splitter);
    return style.visibility === "hidden" && splitter.getBoundingClientRect().height === 0;
  });
  await page.waitForTimeout(400);
  const collapsedLower = await page.locator(".inspector-panel").boundingBox();
  if (!collapsedLower || !restoredInspectorRect || collapsedLower.height < restoredInspectorRect.height + 100) {
    const collapsedDebug = await page.evaluate(() => {
      const workspace = document.querySelector(".scene-editor-pane");
      const preview = document.querySelector(".preview-panel");
      const lower = document.querySelector(".inspector-panel");
      const read = (element) => {
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          className: element.className,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          display: style.display,
          position: style.position,
          height: style.height,
          minHeight: style.minHeight,
          gridTemplateRows: style.gridTemplateRows,
          transform: style.transform,
        };
      };
      return { workspace: read(workspace), preview: read(preview), lower: read(lower) };
    });
    throw new Error(`Scene inspector did not expand after preview collapse: before=${JSON.stringify(restoredInspectorRect)} after=${JSON.stringify(collapsedLower)} debug=${JSON.stringify(collapsedDebug)}`);
  }

  await page.locator(".preview-panel.is-collapsed .preview-rail-button").click();
  await page.locator(".preview-panel.is-expanded").waitFor({ state: "visible", timeout: 5000 });
  report.checks.push({
    id: "editor:previewSplitter",
    ok: true,
    initialValue,
    keyboardValue,
    keyboardStoredRatio,
    restoredSplitValue,
    restoredWorkspaceRect,
    restoredInspectorRect,
    collapsedLower,
  });
}

async function clickPreviewToolbarButton(page, index) {
  await page.evaluate((index) => {
    const buttons = Array.from(document.querySelectorAll(".embedded-runtime-preview-toolbar button:not(.embedded-runtime-refresh)"));
    const button = buttons[index];
    if (button instanceof HTMLElement) button.click();
  }, index);
  await page.waitForFunction((index) => {
    const buttons = Array.from(document.querySelectorAll(".embedded-runtime-preview-toolbar button:not(.embedded-runtime-refresh)"));
    return buttons[index]?.classList.contains("is-active");
  }, index, { timeout: 5000 });
}

async function verifyGlassSelectionGroup(page, report) {
  const toolbar = page.locator(".embedded-runtime-preview-toolbar");
  await toolbar.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForFunction(() => {
    const indicator = document.querySelector(".embedded-runtime-preview-toolbar .glass-selection-indicator");
    return indicator?.getAttribute("data-glass-visible") === "true"
      && indicator?.getAttribute("data-glass-moving") === "false";
  }, undefined, { timeout: 5000 });

  const initial = await toolbar.evaluate((element) => {
    const indicator = element.querySelector(".glass-selection-indicator");
    const viewport = element.querySelector(".glass-selection-viewport");
    const selected = element.querySelector('[data-glass-selected="true"]');
    if (
      !(indicator instanceof HTMLElement)
      || !(viewport instanceof HTMLElement)
      || !(selected instanceof HTMLElement)
    ) return null;
    const groupRect = element.getBoundingClientRect();
    const indicatorRect = indicator.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const groupStyle = getComputedStyle(element);
    const indicatorStyle = getComputedStyle(indicator);
    const viewportStyle = getComputedStyle(viewport);
    return {
      groupRect: { x: groupRect.x, y: groupRect.y, width: groupRect.width, height: groupRect.height },
      indicatorRect: { x: indicatorRect.x, y: indicatorRect.y, width: indicatorRect.width, height: indicatorRect.height },
      selectedRect: { x: selectedRect.x, y: selectedRect.y, width: selectedRect.width, height: selectedRect.height },
      viewportRect: { x: viewportRect.x, y: viewportRect.y, width: viewportRect.width, height: viewportRect.height },
      groupClientWidth: element.clientWidth,
      viewportClientWidth: viewport.clientWidth,
      viewportScrollWidth: viewport.scrollWidth,
      rootOverflowX: groupStyle.overflowX,
      rootOverflowY: groupStyle.overflowY,
      viewportOverflowX: viewportStyle.overflowX,
      viewportOverflowY: viewportStyle.overflowY,
      indicatorOutsideViewport: !viewport.contains(indicator),
      indicatorOverflow: indicatorStyle.overflow,
      indicatorClipPath: indicatorStyle.clipPath,
      indicatorFilter: indicatorStyle.filter,
      visible: indicator.dataset.glassVisible,
      moving: indicator.dataset.glassMoving,
    };
  });
  if (!initial) throw new Error("Glass selection geometry is not measurable");
  const geometryDelta = Math.max(
    Math.abs(initial.indicatorRect.x - initial.selectedRect.x),
    Math.abs(initial.indicatorRect.y - initial.selectedRect.y),
    Math.abs(initial.indicatorRect.width - initial.selectedRect.width),
    Math.abs(initial.indicatorRect.height - initial.selectedRect.height),
  );
  if (geometryDelta > 1) {
    throw new Error(`Glass indicator does not align with selected button: ${JSON.stringify(initial)}`);
  }
  if (initial.groupClientWidth < 180) {
    throw new Error(`Preview toolbar was compressed instead of moving to its own row: ${JSON.stringify(initial)}`);
  }
  if (
    initial.rootOverflowX !== "visible"
    || initial.rootOverflowY !== "visible"
    || initial.viewportOverflowX !== "auto"
    || initial.viewportOverflowY !== "hidden"
    || !initial.indicatorOutsideViewport
  ) {
    throw new Error(`Glass scroll viewport does not isolate clipping from the exterior surface: ${JSON.stringify(initial)}`);
  }
  const verticalSafeInset = Math.min(
    initial.indicatorRect.y - initial.groupRect.y,
    initial.groupRect.y + initial.groupRect.height - (initial.indicatorRect.y + initial.indicatorRect.height),
  );
  if (verticalSafeInset < 8) {
    throw new Error(`Glass indicator does not have enough vertical overflow safety space: ${JSON.stringify(initial)}`);
  }
  if (initial.indicatorOverflow !== "visible" || initial.indicatorClipPath !== "none") {
    throw new Error(`Glass indicator still clips its exterior effect: ${JSON.stringify(initial)}`);
  }
  if (!initial.indicatorFilter.includes("drop-shadow")) {
    throw new Error(`Glass indicator is missing the exterior depth effect: ${JSON.stringify(initial)}`);
  }

  const motion = await page.evaluate(async () => {
    const buttons = Array.from(document.querySelectorAll(".embedded-runtime-preview-toolbar button:not(.embedded-runtime-refresh)"));
    const indicator = document.querySelector(".embedded-runtime-preview-toolbar .glass-selection-indicator");
    const targetButton = buttons[5];
    if (!(indicator instanceof HTMLElement) || !(targetButton instanceof HTMLElement)) return null;
    const startRect = indicator.getBoundingClientRect();
    const startCenter = startRect.x + (startRect.width / 2);
    targetButton.click();
    return await new Promise((resolve) => {
      const startedAt = performance.now();
      let movingSeen = false;
      let maxStretchRatio = 1;
      let maxOvershoot = 0;
      let samples = 0;
      const sample = () => {
        samples += 1;
        const selected = document.querySelector(".embedded-runtime-preview-toolbar [data-glass-selected='true']");
        if (selected instanceof HTMLElement && selected === targetButton) {
          const indicatorRect = indicator.getBoundingClientRect();
          const targetRect = selected.getBoundingClientRect();
          const targetCenter = targetRect.x + (targetRect.width / 2);
          const indicatorCenter = indicatorRect.x + (indicatorRect.width / 2);
          const direction = Math.sign(targetCenter - startCenter) || 1;
          movingSeen ||= indicator.dataset.glassMoving === "true";
          maxStretchRatio = Math.max(maxStretchRatio, indicatorRect.width / targetRect.width);
          maxOvershoot = Math.max(maxOvershoot, (indicatorCenter - targetCenter) * direction);
          if (movingSeen && indicator.dataset.glassMoving === "false") {
            resolve({ movingSeen, maxStretchRatio, maxOvershoot, samples });
            return;
          }
        }
        if (performance.now() - startedAt > 1200) {
          resolve({ movingSeen, maxStretchRatio, maxOvershoot, samples });
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  });
  if (!motion) throw new Error("Glass motion could not be sampled");
  if (!motion.movingSeen || motion.maxStretchRatio < 1.08 || motion.maxOvershoot < 0.5) {
    throw new Error(`Glass motion is not visibly elastic enough: ${JSON.stringify(motion)}`);
  }
  await clickPreviewToolbarButton(page, 0);
  await page.waitForFunction(() => {
    const indicator = document.querySelector(".embedded-runtime-preview-toolbar .glass-selection-indicator");
    const selected = document.querySelector(".embedded-runtime-preview-toolbar [data-glass-selected='true']");
    if (!(indicator instanceof HTMLElement) || !(selected instanceof HTMLElement)) return false;
    const indicatorRect = indicator.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    return indicator.dataset.glassMoving === "false"
      && Math.abs(indicatorRect.x - selectedRect.x) <= 1
      && Math.abs(indicatorRect.width - selectedRect.width) <= 1;
  }, undefined, { timeout: 5000 });

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll(".embedded-runtime-preview-toolbar button:not(.embedded-runtime-refresh)"));
    [4, 0, 6, 2, 1].forEach((index, step) => {
      window.setTimeout(() => {
        if (buttons[index] instanceof HTMLElement) buttons[index].click();
      }, step * 34);
    });
  });
  await page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll(".embedded-runtime-preview-toolbar button:not(.embedded-runtime-refresh)"));
    const indicator = document.querySelector(".embedded-runtime-preview-toolbar .glass-selection-indicator");
    const selected = document.querySelector(".embedded-runtime-preview-toolbar [data-glass-selected='true']");
    if (
      !buttons[1]?.classList.contains("is-active")
      || !(indicator instanceof HTMLElement)
      || !(selected instanceof HTMLElement)
    ) return false;
    const indicatorRect = indicator.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    return indicator.getAttribute("data-glass-moving") === "false"
      && Math.max(
        Math.abs(indicatorRect.x - selectedRect.x),
        Math.abs(indicatorRect.y - selectedRect.y),
        Math.abs(indicatorRect.width - selectedRect.width),
        Math.abs(indicatorRect.height - selectedRect.height),
      ) <= 1;
  }, undefined, { timeout: 5000 });

  const interrupted = await toolbar.evaluate((element) => {
    const indicator = element.querySelector(".glass-selection-indicator");
    const selected = element.querySelector('[data-glass-selected="true"]');
    if (!(indicator instanceof HTMLElement) || !(selected instanceof HTMLElement)) return null;
    const indicatorRect = indicator.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    return {
      indicatorRect: { x: indicatorRect.x, y: indicatorRect.y, width: indicatorRect.width, height: indicatorRect.height },
      selectedRect: { x: selectedRect.x, y: selectedRect.y, width: selectedRect.width, height: selectedRect.height },
      visible: indicator.dataset.glassVisible,
      moving: indicator.dataset.glassMoving,
    };
  });
  if (!interrupted) throw new Error("Interrupted glass selection geometry is not measurable");
  const interruptedDelta = Math.max(
    Math.abs(interrupted.indicatorRect.x - interrupted.selectedRect.x),
    Math.abs(interrupted.indicatorRect.y - interrupted.selectedRect.y),
    Math.abs(interrupted.indicatorRect.width - interrupted.selectedRect.width),
    Math.abs(interrupted.indicatorRect.height - interrupted.selectedRect.height),
  );
  if (interruptedDelta > 1 || interrupted.visible !== "true" || interrupted.moving !== "false") {
    throw new Error(`Glass selection did not settle after rapid retargeting: ${JSON.stringify(interrupted)}`);
  }

  await toolbar.evaluate((element) => {
    element.style.width = "220px";
    element.style.maxWidth = "220px";
  });
  await page.waitForFunction(() => {
    const viewport = document.querySelector(".embedded-runtime-preview-toolbar .glass-selection-viewport");
    return viewport instanceof HTMLElement && viewport.scrollWidth - viewport.clientWidth > 40;
  }, undefined, { timeout: 5000 });
  await clickPreviewToolbarButton(page, 6);
  await page.waitForFunction(() => {
    const indicator = document.querySelector(".embedded-runtime-preview-toolbar .glass-selection-indicator");
    const selected = document.querySelector(".embedded-runtime-preview-toolbar [data-glass-selected='true']");
    if (!(indicator instanceof HTMLElement) || !(selected instanceof HTMLElement)) return false;
    const indicatorRect = indicator.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    return indicator.getAttribute("data-glass-moving") === "false"
      && Math.max(
        Math.abs(indicatorRect.x - selectedRect.x),
        Math.abs(indicatorRect.y - selectedRect.y),
        Math.abs(indicatorRect.width - selectedRect.width),
        Math.abs(indicatorRect.height - selectedRect.height),
      ) <= 1;
  }, undefined, { timeout: 5000 });
  const scrolled = await toolbar.evaluate((element) => {
    const indicator = element.querySelector(".glass-selection-indicator");
    const viewport = element.querySelector(".glass-selection-viewport");
    const selected = element.querySelector('[data-glass-selected="true"]');
    if (
      !(indicator instanceof HTMLElement)
      || !(viewport instanceof HTMLElement)
      || !(selected instanceof HTMLElement)
    ) return null;
    const indicatorRect = indicator.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    return {
      indicatorRect: { x: indicatorRect.x, y: indicatorRect.y, width: indicatorRect.width, height: indicatorRect.height },
      selectedRect: { x: selectedRect.x, y: selectedRect.y, width: selectedRect.width, height: selectedRect.height },
      scrollLeft: viewport.scrollLeft,
      maxScrollLeft: viewport.scrollWidth - viewport.clientWidth,
      visible: indicator.dataset.glassVisible,
      moving: indicator.dataset.glassMoving,
    };
  });
  if (!scrolled) throw new Error("Scrolled glass selection geometry is not measurable");
  const scrolledDelta = Math.max(
    Math.abs(scrolled.indicatorRect.x - scrolled.selectedRect.x),
    Math.abs(scrolled.indicatorRect.y - scrolled.selectedRect.y),
    Math.abs(scrolled.indicatorRect.width - scrolled.selectedRect.width),
    Math.abs(scrolled.indicatorRect.height - scrolled.selectedRect.height),
  );
  if (
    scrolledDelta > 1
    || scrolled.visible !== "true"
    || scrolled.moving !== "false"
    || (scrolled.maxScrollLeft > 1 && scrolled.scrollLeft <= 0)
  ) {
    throw new Error(`Glass selection did not remain aligned after safe scrolling: ${JSON.stringify(scrolled)}`);
  }
  await toolbar.evaluate((element) => {
    element.style.removeProperty("width");
    element.style.removeProperty("max-width");
  });
  await page.waitForTimeout(80);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await clickPreviewToolbarButton(page, 3);
  await page.waitForTimeout(160);
  const reducedMotion = await toolbar.evaluate((element) => {
    const indicator = element.querySelector(".glass-selection-indicator");
    const selected = element.querySelector('[data-glass-selected="true"]');
    if (!(indicator instanceof HTMLElement) || !(selected instanceof HTMLElement)) return null;
    const indicatorRect = indicator.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    return {
      indicatorRect: { x: indicatorRect.x, y: indicatorRect.y, width: indicatorRect.width, height: indicatorRect.height },
      selectedRect: { x: selectedRect.x, y: selectedRect.y, width: selectedRect.width, height: selectedRect.height },
      moving: indicator.dataset.glassMoving,
    };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (!reducedMotion) throw new Error("Reduced-motion glass geometry is not measurable");
  const reducedMotionDelta = Math.max(
    Math.abs(reducedMotion.indicatorRect.x - reducedMotion.selectedRect.x),
    Math.abs(reducedMotion.indicatorRect.y - reducedMotion.selectedRect.y),
    Math.abs(reducedMotion.indicatorRect.width - reducedMotion.selectedRect.width),
    Math.abs(reducedMotion.indicatorRect.height - reducedMotion.selectedRect.height),
  );
  if (reducedMotionDelta > 1 || reducedMotion.moving !== "false") {
    throw new Error(`Reduced motion did not settle the glass immediately: ${JSON.stringify(reducedMotion)}`);
  }

  const keyboardTarget = toolbar.locator("button:not(.embedded-runtime-refresh)").nth(2);
  await keyboardTarget.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(120);
  const keyboard = await toolbar.evaluate((element) => {
    const indicator = element.querySelector(".glass-selection-indicator");
    const selected = element.querySelector('[data-glass-selected="true"]');
    if (!(indicator instanceof HTMLElement) || !(selected instanceof HTMLElement)) return null;
    const indicatorRect = indicator.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    return {
      indicatorRect: { x: indicatorRect.x, y: indicatorRect.y, width: indicatorRect.width, height: indicatorRect.height },
      selectedRect: { x: selectedRect.x, y: selectedRect.y, width: selectedRect.width, height: selectedRect.height },
      moving: indicator.dataset.glassMoving,
    };
  });
  if (!keyboard) throw new Error("Keyboard glass geometry is not measurable");
  const keyboardDelta = Math.max(
    Math.abs(keyboard.indicatorRect.x - keyboard.selectedRect.x),
    Math.abs(keyboard.indicatorRect.y - keyboard.selectedRect.y),
    Math.abs(keyboard.indicatorRect.width - keyboard.selectedRect.width),
    Math.abs(keyboard.indicatorRect.height - keyboard.selectedRect.height),
  );
  if (keyboardDelta > 1 || keyboard.moving !== "false") {
    throw new Error(`Keyboard selection should settle without spring motion: ${JSON.stringify(keyboard)}`);
  }

  report.checks.push({
    id: "editor:glassSelectionGroup",
    ok: true,
    initial,
    motion,
    interrupted,
    scrolled,
    reducedMotion,
    keyboard,
  });
}

async function waitForFrameSelector(frame, selector, context) {
  try {
    await frame.locator(selector).first().waitFor({ state: "visible", timeout: 30000 });
  } catch (error) {
    const debug = await frame.evaluate(() => ({
      bodyText: document.body.innerText.slice(0, 1200),
      testIds: Array.from(document.querySelectorAll("[data-testid]")).map((node) => ({
        testId: node.getAttribute("data-testid"),
        visibleText: node.textContent?.trim().slice(0, 120),
      })),
      runtimeScreen: document.querySelector("[data-runtime-screen]")?.getAttribute("data-runtime-screen") ?? null,
    })).catch((debugError) => ({ debugError: String(debugError) }));
    throw new Error(`${context}: ${error instanceof Error ? error.message : String(error)}\nFrame debug: ${JSON.stringify(debug, null, 2)}`);
  }
}

async function openLayoutDesigner(page) {
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    document.querySelectorAll(".project-entry-loading-overlay").forEach((element) => {
      element.style.pointerEvents = "none";
    });
  });
  await page.evaluate(() => {
    const advanced = document.querySelector('[data-help-key="toolbar.advanced"]');
    if (advanced instanceof HTMLElement) advanced.click();
  });
  await page.waitForTimeout(300);
  if (!(await page.locator(".toolbar-popover.advanced").isVisible().catch(() => false))) {
    await page.locator('[data-help-key="toolbar.advanced"]').click({ force: true });
  }
  await page.locator(".toolbar-popover.advanced.is-open").waitFor({ state: "visible", timeout: 30000 });
  const layoutTab = page.locator('[data-help-key="advanced.tab.layout"]:visible').first();
  await layoutTab.waitFor({ state: "visible", timeout: 30000 });
  await layoutTab.click();
  try {
    await page.waitForFunction(() => (
      document.querySelector('[data-help-key="advanced.tab.layout"][data-glass-selected="true"]')
      && document.querySelector('.advanced-tab-content.is-active[data-tab="layout"]')
      && !document.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving")
      && document.querySelector(".runtime-layout-stage")
    ), undefined, { timeout: 30000 });
  } catch (error) {
    const debug = await page.evaluate(() => ({
      selectedTab: document.querySelector("[data-glass-selected='true']")?.getAttribute("data-help-key") ?? null,
      activeTab: document.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab") ?? null,
      layers: [...document.querySelectorAll(".advanced-tab-content")].map((node) => ({
        tab: node.getAttribute("data-tab"),
        className: node.className,
        hidden: node.hidden,
        opacity: getComputedStyle(node).opacity,
      })),
      bodyText: document.body.innerText.slice(0, 1200),
    }));
    await page.screenshot({ path: path.join(outputDir, "layout-designer-open-error.png"), fullPage: false }).catch(() => {});
    throw new Error(`Layout designer did not settle after a real tab click: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(debug, null, 2)}`);
  }
  await page.locator(".runtime-layout-stage").waitFor({ state: "visible", timeout: 30000 });
}

async function runLayoutDesignerExpectedPreviewAcceptance(browser, projectPath, report) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
  try {
    await importProject(page, projectPath);
    await openLayoutDesigner(page);
    const stage = page.locator(".runtime-layout-stage:has(.runtime-layout-expected-preview)").first();
    const expectedPreview = stage.locator(".runtime-layout-expected-preview");
    const measuredBoxes = await stage.evaluate((node) => {
      const preview = node.querySelector(".runtime-layout-expected-preview");
      const rectToPlain = (element) => {
        const rect = element?.getBoundingClientRect();
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      };
      return { stage: rectToPlain(node), preview: rectToPlain(preview) };
    });
    const stageBox = measuredBoxes.stage;
    const expectedPreviewBox = measuredBoxes.preview;
    if (!stageBox || !expectedPreviewBox) throw new Error("Layout designer stage/local expected preview is not measurable");
    // The local preview owns a 1px border on each side. Its content box is
    // therefore exactly 2px smaller than the stage while still filling it
    // edge-to-edge; reject only larger gaps that indicate an inset/geometry
    // regression.
    if (Math.abs(expectedPreviewBox.width - stageBox.width) > 2.5 || Math.abs(expectedPreviewBox.height - stageBox.height) > 2.5) {
      const debug = await expectedPreview.evaluate((preview) => {
        const stage = preview.parentElement;
        const wrap = stage?.parentElement;
        const style = getComputedStyle(preview);
        const stageStyle = stage ? getComputedStyle(stage) : null;
        const ancestorChain = [];
        let ancestor = stage;
        for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
          const ancestorStyle = getComputedStyle(ancestor);
          const rect = ancestor.getBoundingClientRect();
          ancestorChain.push({
            tag: ancestor.tagName,
            className: ancestor.className,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            width: ancestorStyle.width,
            zoom: ancestorStyle.zoom,
            transform: ancestorStyle.transform,
            overflow: ancestorStyle.overflow,
          });
        }
        return {
          preview: {
            width: style.width,
            height: style.height,
            inset: style.inset,
            position: style.position,
            transform: style.transform,
          },
          stage: stage ? {
            width: stageStyle?.width,
            height: stageStyle?.height,
            boxSizing: stageStyle?.boxSizing,
            transform: stageStyle?.transform,
            rect: stage?.getBoundingClientRect().toJSON?.() ?? null,
          } : null,
          wrapRect: wrap?.getBoundingClientRect().toJSON?.() ?? null,
          ancestorChain,
        };
      });
      throw new Error(`Layout designer local preview does not fill the stage: stage=${JSON.stringify(stageBox)} preview=${JSON.stringify(expectedPreviewBox)} debug=${JSON.stringify(debug)}`);
    }
    if (await page.locator(".runtime-layout-stage iframe.runtime-layout-real-preview").count() !== 0) {
      throw new Error("Layout designer must not embed the full GameCLI iframe");
    }
    if (await page.locator(".runtime-layout-preview-status").count() !== 0) {
      throw new Error("Layout designer must not show full-preview status text");
    }
    report.checks.push({ id: "layoutDesigner:expectedPreviewOnly", ok: true, stageBox, expectedPreviewBox });

    await page.locator('[data-help-key="layout.screen"]').nth(1).click();
    await page.locator(".runtime-layout-expected-preview.is-player").waitFor({ state: "visible", timeout: 10000 });
    await page.locator('[data-preview-quick-menu-state="expanded"]').click();
    const quickPreview = page.locator(".runtime-layout-expected-preview.is-player .preview-quick-menu-buttons:visible").first();
    await quickPreview.waitFor({ state: "visible", timeout: 10000 });
    const quickPreviewContainer = page.locator(".runtime-layout-expected-preview.is-player .preview-quick-menu-preview:visible").first();
    const quickPreviewCount = Number(await quickPreviewContainer.getAttribute("data-preview-quick-button-count"));
    if (quickPreviewCount !== 7) {
      throw new Error(`Layout designer quick-menu preview must contain 7 fixed actions, got ${quickPreviewCount}`);
    }
    if (await page.locator('[data-preview-component-id="quick_settings_button"]').count()) {
      throw new Error("Layout designer quick-menu preview still exposes settings");
    }
    const quickPreviewStructure = await quickPreviewContainer.evaluate((preview) => {
      const surface = preview.querySelector(".preview-quick-menu-surface");
      const actionLayer = preview.querySelector(".preview-quick-menu-action-layer");
      const toggleLayer = preview.querySelector(".preview-quick-menu-toggle-layer");
      const previewRect = preview.getBoundingClientRect();
      const surfaceRect = surface?.getBoundingClientRect();
      const buttonRects = [...preview.querySelectorAll(".preview-quick-menu-button")].map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
      const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const allInside = Boolean(surfaceRect) && buttonRects.every((button) => button.left >= surfaceRect.left - 1
        && button.right <= surfaceRect.right + 1
        && button.top >= surfaceRect.top - 1
        && button.bottom <= surfaceRect.bottom + 1);
      const overlaps = buttonRects.some((button, index) => buttonRects.slice(index + 1).some((other) => intersects(button, other)));
      const pseudo = getComputedStyle(preview, "::before");
      const surfaceStyle = surface ? getComputedStyle(surface) : null;
      const firstButtonStyle = preview.querySelector(".preview-quick-menu-button")
        ? getComputedStyle(preview.querySelector(".preview-quick-menu-button"))
        : null;
      return {
        surfaceCount: preview.querySelectorAll(":scope > .preview-quick-menu-surface").length,
        actionLayerCount: preview.querySelectorAll(":scope > .preview-quick-menu-surface > .preview-quick-menu-action-layer").length,
        toggleLayerCount: preview.querySelectorAll(":scope > .preview-quick-menu-toggle-layer").length,
        iconNames: [...preview.querySelectorAll(".preview-quick-menu-button [data-precision-icon]")].map((node) => node.getAttribute("data-precision-icon")),
        toggleIconNames: [...preview.querySelectorAll(".preview-quick-menu-toggle [data-precision-icon]")].map((node) => node.getAttribute("data-precision-icon")),
        previewRect: { left: previewRect.left, top: previewRect.top, width: previewRect.width, height: previewRect.height },
        surfaceRect: surfaceRect ? { left: surfaceRect.left, top: surfaceRect.top, width: surfaceRect.width, height: surfaceRect.height } : null,
        metricSurfaceHeight: preview.getAttribute("data-preview-quick-menu-surface-height"),
        metricSurfaceWidth: preview.getAttribute("data-preview-quick-menu-surface-width"),
        metricColumns: preview.getAttribute("data-preview-quick-menu-columns"),
        metricRows: preview.getAttribute("data-preview-quick-menu-rows"),
        buttonRects,
        allInside,
        overlaps,
        pseudoDisplay: pseudo.display,
        pseudoOpacity: pseudo.opacity,
        surfaceCss: surfaceStyle ? {
          width: surfaceStyle.width,
          height: surfaceStyle.height,
          transform: surfaceStyle.transform,
          vars: surfaceStyle.getPropertyValue("--preview-quick-menu-surface-height"),
          cellWidth: Number.parseFloat(surfaceStyle.getPropertyValue("--preview-quick-menu-cell-width") || "0"),
        } : null,
        buttonCss: firstButtonStyle ? {
          width: firstButtonStyle.width,
          height: firstButtonStyle.height,
          minHeight: firstButtonStyle.minHeight,
          gridRow: firstButtonStyle.gridRow,
        } : null,
        ancestorTransforms: (() => {
          const values = [];
          let node = preview.parentElement;
          for (let index = 0; node && index < 5; index += 1, node = node.parentElement) {
            values.push({ className: node.className, transform: getComputedStyle(node).transform, zoom: getComputedStyle(node).zoom });
          }
          return values;
        })(),
      };
    });
    if (quickPreviewStructure.surfaceCount !== 1 || quickPreviewStructure.actionLayerCount !== 1 || quickPreviewStructure.toggleLayerCount !== 1) {
      throw new Error("Layout designer quick-menu preview must have one surface/action/toggle layer: " + JSON.stringify(quickPreviewStructure));
    }
    if (quickPreviewStructure.iconNames.length !== 7 || quickPreviewStructure.iconNames.includes(null)) {
      throw new Error("Layout designer quick-menu preview icons are incomplete: " + JSON.stringify(quickPreviewStructure));
    }
    if (quickPreviewStructure.pseudoDisplay !== "none") {
      throw new Error("Layout designer quick-menu preview still paints a legacy overlay: " + JSON.stringify(quickPreviewStructure));
    }
    if (!quickPreviewStructure.surfaceRect
      || Math.abs(quickPreviewStructure.surfaceRect.width - quickPreviewStructure.previewRect.width) > 2
      || Math.abs(quickPreviewStructure.surfaceRect.height - quickPreviewStructure.previewRect.height) > 2
      || !quickPreviewStructure.allInside
      || quickPreviewStructure.overlaps) {
      throw new Error("Layout designer quick-menu preview has invalid geometry: " + JSON.stringify(quickPreviewStructure));
    }
    const expectedActionWidth = quickPreviewStructure.surfaceCss?.cellWidth
      || quickPreviewStructure.surfaceRect.width - 12;
    if (quickPreviewStructure.buttonRects.some((button) => Math.abs(button.width - expectedActionWidth) > 2)) {
      throw new Error("Layout designer quick-menu actions must fill the single drawer track: " + JSON.stringify(quickPreviewStructure));
    }
    const quickMenuComponent = page.locator("[data-preview-component-id='quick_menu']").first();
    const quickMenuToggle = quickPreviewContainer.locator("[data-testid='preview-quick-menu-toggle']");
    if (await page.locator(".preview-quick-menu-drag-hit").count() !== 0) {
      throw new Error("Layout designer quick-menu preview must not use a transparent drag overlay");
    }
    const quickMenuParity = await quickPreviewContainer.evaluate((preview) => ({
      rootPointerEvents: getComputedStyle(preview).pointerEvents,
      actionLayerPointerEvents: getComputedStyle(preview.querySelector(".preview-quick-menu-action-layer") ?? preview).pointerEvents,
      togglePointerEvents: getComputedStyle(preview.querySelector(".preview-quick-menu-toggle") ?? preview).pointerEvents,
      columns: preview.getAttribute("data-preview-quick-menu-columns"),
      rows: preview.getAttribute("data-preview-quick-menu-rows"),
      uniformScale: Number(preview.getAttribute("data-preview-quick-menu-uniform-scale")),
      actionCount: preview.querySelectorAll(".preview-quick-menu-button").length,
      toggleCell: {
        column: preview.getAttribute("data-preview-quick-menu-toggle-cell-column"),
        row: preview.getAttribute("data-preview-quick-menu-toggle-cell-row"),
      },
    }));
    if (
      quickMenuParity.rootPointerEvents !== "none"
      || quickMenuParity.togglePointerEvents === "none"
      || quickMenuParity.actionLayerPointerEvents === "none"
      || quickMenuParity.columns !== "1"
      || quickMenuParity.rows !== "8"
      || quickMenuParity.toggleCell.column !== "1"
      || quickMenuParity.toggleCell.row !== "8"
      || quickMenuParity.actionCount !== 7
      || !Number.isFinite(quickMenuParity.uniformScale)
      || quickMenuParity.uniformScale <= 0
    ) {
      throw new Error(`Layout designer quick-menu preview pointer/metrics parity is invalid: ${JSON.stringify(quickMenuParity)}`);
    }

    const readQuickMenuPosition = () => quickMenuComponent.evaluate((element) => ({
      x: Number(element.getAttribute("data-preview-authored-x")),
      y: Number(element.getAttribute("data-preview-authored-y")),
      width: Number(element.getAttribute("data-preview-authored-width")),
      height: Number(element.getAttribute("data-preview-authored-height")),
      anchor: element.getAttribute("data-preview-authored-anchor"),
    }));
    // The runtime quick menu is fixed to the dialogue's top-right outside
    // edge.  Its legacy authored rect remains readable for migration
    // compatibility, but expanding/collapsing must never rewrite it.
    await quickMenuToggle.click();
    await page.waitForFunction(() => document.querySelector("[data-testid='preview-quick-menu-toggle']")?.getAttribute("aria-expanded") === "false");
    const collapsedPosition = await readQuickMenuPosition();
    if (await quickMenuToggle.getAttribute("aria-expanded") !== "false") {
      throw new Error("Dragging the collapsed toggle must not expand the quick menu");
    }

    // Re-open at the fixed position and verify the authored rect is stable.
    await quickMenuToggle.click();
    await page.waitForFunction(() => document.querySelector("[data-testid='preview-quick-menu-toggle']")?.getAttribute("aria-expanded") === "true");
    const expandedPosition = await readQuickMenuPosition();
    if (
      Math.abs(expandedPosition.x - collapsedPosition.x) > 0.001
      || Math.abs(expandedPosition.y - collapsedPosition.y) > 0.001
      || Math.abs(expandedPosition.width - collapsedPosition.width) > 0.001
      || Math.abs(expandedPosition.height - collapsedPosition.height) > 0.001
      || expandedPosition.anchor !== collapsedPosition.anchor
    ) {
      throw new Error(`Fixed quick-menu position changed while toggling: ${JSON.stringify({ collapsedPosition, expandedPosition })}`);
    }
    report.checks.push({
      id: "layoutDesigner:quickMenuGeometryParityAndFixedPosition",
      ok: true,
      quickMenuCount: quickPreviewCount,
      quickMenuParity,
      collapsedPosition,
      expandedPosition,
    });

    const screenList = page.locator(".runtime-layout-screen-list");
    await screenList.getByRole("button", { name: "选项", exact: true }).click();
    try {
      await page.waitForFunction(() => {
        const selected = [...document.querySelectorAll(".runtime-layout-screen-list [data-help-key='layout.screen']")]
          .find((node) => node.getAttribute("data-glass-selected") === "true");
        const preview = document.querySelector(".runtime-layout-expected-preview.is-preferences");
        const rect = preview?.getBoundingClientRect();
        return selected?.textContent?.trim() === "选项"
          && rect
          && rect.width > 0
          && rect.height > 0;
      }, undefined, { timeout: 30000 });
    } catch (error) {
      const debug = await page.evaluate(() => {
        const rect = (selector) => {
          const node = document.querySelector(selector);
          const value = node?.getBoundingClientRect();
          return value ? { left: value.left, top: value.top, width: value.width, height: value.height } : null;
        };
        return {
          selected: [...document.querySelectorAll(".runtime-layout-screen-list [data-help-key='layout.screen']")]
            .find((node) => node.getAttribute("data-glass-selected") === "true")?.textContent?.trim() ?? null,
          center: rect(".runtime-layout-center"),
          controls: rect(".runtime-quick-menu-preview-controls"),
          stageWrap: rect(".runtime-layout-stage-wrap"),
          stage: rect(".runtime-layout-stage"),
          preview: rect(".runtime-layout-expected-preview.is-preferences"),
        };
      });
      await page.screenshot({ path: path.join(outputDir, "layout-designer-preferences-error.png"), fullPage: false }).catch(() => {});
      throw new Error(`Layout designer settings preview did not become visible: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(debug, null, 2)}`);
    }
    await page.locator(".runtime-layout-expected-preview.is-preferences .preview-settings-card").waitFor({ state: "visible", timeout: 10000 });
    const settingsPreviewBackground = await page.locator(".runtime-layout-expected-preview.is-preferences .preview-settings-card").evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { backgroundImage: style.backgroundImage, backgroundSize: style.backgroundSize };
    });
    if (!settingsPreviewBackground.backgroundImage || settingsPreviewBackground.backgroundImage === "none") {
      throw new Error(`Layout designer settings preview did not render the settings background image: ${JSON.stringify(settingsPreviewBackground)}`);
    }
    await page.screenshot({ path: path.join(outputDir, "layout-designer-expected-settings.png"), fullPage: false });
    report.checks.push({ id: "layoutDesigner:settingsExpectedPreview", ok: true });

    await screenList.getByRole("button", { name: "关于", exact: true }).click();
    const aboutTitle = page.locator('.runtime-layout-inspector [data-help-key="settings.about.title"]:visible').first();
    await aboutTitle.waitFor({ state: "visible", timeout: 10000 });
    await aboutTitle.fill("Layout Designer Editable About");
    const aboutValue = await aboutTitle.inputValue();
    if (aboutValue !== "Layout Designer Editable About") {
      throw new Error(`Layout designer about copy field was not editable: ${aboutValue}`);
    }
    report.checks.push({ id: "layoutDesigner:aboutCopyEditable", ok: true });
  } finally {
    await page.close().catch(() => {});
  }
}

async function runEditorIframeAcceptance(browser, projectPath, report) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
  try {
    await importProject(page, projectPath);
    let frame = await waitForPreviewFrame(page);
    await verifyEditorPreviewLayout(page, report);
    if (!skipGlass) await verifyGlassSelectionGroup(page, report);
    if (glassOnly) return;
    await verifyEditorPreviewSplitter(page, projectPath, report);
    frame = await waitForPreviewFrame(page);
    const iframeSrc = await page.locator(".embedded-runtime-preview-frame iframe").getAttribute("src");
    if (!iframeSrc?.startsWith(`${editorUrl}gamecli-preview/`)) {
      throw new Error(`Editor preview must use the same-origin GameCLI bundle: ${iframeSrc}`);
    }
    report.checks.push({ id: "editor:sameOriginGameCli", ok: true, iframeSrc });
    const panelRect = await page.locator(".preview-panel.is-expanded").boundingBox();
    const iframeRect = await page.locator(".embedded-runtime-preview-frame iframe").boundingBox();
    if (!panelRect || !iframeRect) throw new Error("Preview panel/iframe is not measurable");
    if (iframeRect.width > panelRect.width + 2 || iframeRect.height > panelRect.height + 2) {
      throw new Error(`iframe is not constrained to preview panel: panel=${JSON.stringify(panelRect)} iframe=${JSON.stringify(iframeRect)}`);
    }
    report.checks.push({ id: "editor:iframeConstrained", ok: true, panelRect, iframeRect });

    for (const [index, screen] of screens.entries()) {
      await clickPreviewToolbarButton(page, index);
      report.lastToolbarState = await page.evaluate(() => Array.from(document.querySelectorAll(".embedded-runtime-preview-toolbar button")).map((button, index) => ({
        index,
        text: button.textContent?.trim(),
        className: button.className,
        disabled: button.disabled,
      }))).catch((error) => [{ error: String(error) }]);
      await waitForFrameSelector(frame, screen.selector, `editor iframe screen ${screen.id}`);
      await page.screenshot({ path: path.join(outputDir, `editor-iframe-${screen.screenshot}`), fullPage: false });
      report.checks.push({ id: `editor:iframeScreen:${screen.id}`, ok: true });
      if (screen.id === "title_menu") await verifyTitleVisuals(frame, report, "editorIframe");
      if (screen.id === "settings") await verifySettingsBackground(frame, report, "editorIframe");
      if (screen.id === "about") await verifyAboutCopy(frame, report, "editorIframe");
    }

    await page.setViewportSize({ width: 900, height: 720 });
    await page.waitForTimeout(300);
    const narrowFlowRect = await page.locator(".flow-surface").boundingBox();
    const narrowScenePaneRect = await page.locator(".scene-editor-pane").boundingBox();
    const narrowPreviewRect = await page.locator(".preview-panel.is-expanded").boundingBox();
    const narrowLowerRect = await page.locator(".inspector-panel").boundingBox();
    const narrowSplitterRect = await page.locator(".preview-splitter").boundingBox();
    if (!narrowFlowRect || !narrowScenePaneRect || !narrowPreviewRect || !narrowLowerRect || !narrowSplitterRect) {
      throw new Error("Narrow desktop preview/editor layout is not measurable");
    }
    const usesStackedNarrowLayout = narrowScenePaneRect.x <= narrowFlowRect.x + 1;
    if (usesStackedNarrowLayout) {
      if (narrowScenePaneRect.y < narrowFlowRect.y + narrowFlowRect.height - 1) {
        throw new Error(`Narrow stacked scene pane overlaps the flow surface: flow=${JSON.stringify(narrowFlowRect)} scenePane=${JSON.stringify(narrowScenePaneRect)}`);
      }
    } else if (narrowScenePaneRect.x < narrowFlowRect.x + narrowFlowRect.width) {
      throw new Error(`Narrow desktop preview left the right scene pane: flow=${JSON.stringify(narrowFlowRect)} scenePane=${JSON.stringify(narrowScenePaneRect)}`);
    }
    if (narrowPreviewRect.y + narrowPreviewRect.height > narrowSplitterRect.y + 1
      || narrowLowerRect.y < narrowSplitterRect.y + narrowSplitterRect.height - 1
      || narrowPreviewRect.x < narrowScenePaneRect.x - 1
      || narrowPreviewRect.x + narrowPreviewRect.width > narrowScenePaneRect.x + narrowScenePaneRect.width + 1
      || narrowLowerRect.x < narrowScenePaneRect.x - 1
      || narrowLowerRect.x + narrowLowerRect.width > narrowScenePaneRect.x + narrowScenePaneRect.width + 1) {
      throw new Error(`Narrow desktop panes overlap: preview=${JSON.stringify(narrowPreviewRect)} splitter=${JSON.stringify(narrowSplitterRect)} lower=${JSON.stringify(narrowLowerRect)}`);
    }
    await page.screenshot({ path: path.join(outputDir, "editor-right-scene-preview-narrow.png"), fullPage: false });
    report.checks.push({
      id: usesStackedNarrowLayout ? "editor:narrowStackedScenePaneSplit" : "editor:narrowRightScenePaneSplit",
      ok: true,
      narrowFlowRect,
      narrowScenePaneRect,
      narrowPreviewRect,
      narrowSplitterRect,
      narrowLowerRect,
    });
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  resetOutputDirs();
  const projectPath = path.join(testDir, "client-layout-real-preview.vnproj");
  saveProjectContainerSync(projectPath, buildProjectFile(), { container: "zip" });
  const cartridgePath = await packRuntimeCartridge(projectPath);
  const children = [];
  const report = { startedAt: new Date().toISOString(), checks: [], artifacts: { outputDir, testDir, projectPath, cartridgePath } };
  try {
    const editorServer = await ensureServer("editor-dev", editorUrl, path.join(root, "editor"));
    const gameCliServer = await ensureServer("gamecli-dev", runtimeOrigin, path.join(root, "GameCli_framework"));
    if (editorServer) children.push(editorServer);
    if (gameCliServer) children.push(gameCliServer);
    const browser = await chromium.launch({ headless: !headed });
    try {
      if (!glassOnly && !layoutOnly) await runRuntimeAcceptance(browser, cartridgePath, report);
      if (!layoutOnly) await runEditorIframeAcceptance(browser, projectPath, report);
      if (!glassOnly) await runLayoutDesignerExpectedPreviewAcceptance(browser, projectPath, report);
    } finally {
      await browser.close().catch(() => {});
    }
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? error.stack ?? error.message : String(error);
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, "client-layout-real-preview-acceptance-report.json"), JSON.stringify(report, null, 2), "utf8");
    for (const child of children) stopDevServer(child);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});




