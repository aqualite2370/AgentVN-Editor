const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_EXE = process.env.AGENTVN_TEST_EDITOR_EXE || path.join(ROOT, "AgentVN Dev.exe");
const EDITOR_CDP_URL = process.env.AGENTVN_EDITOR_CDP_URL || "http://127.0.0.1:9333";
const PLAYER_CDP_URL = process.env.AGENTVN_PLAYER_CDP_URL || "http://127.0.0.1:9444";
const PLAYER_CDP_PORT = new URL(PLAYER_CDP_URL).port || "9444";
const PREVIEW_DIR = path.join(process.env.LOCALAPPDATA || "", "com.agentvn.editor", "gamecli-preview");
const OUTPUT_DIR = path.join(ROOT, "output", "playwright");

function assert(condition, message, context) {
  if (!condition) {
    const detail = context ? "\n" + JSON.stringify(context, null, 2) : "";
    throw new Error(message + detail);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execPowerShell(command) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout);
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json().catch(() => ({}));
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || "no response"}`);
}

async function getProcesses(pattern) {
  const stdout = await execPowerShell(`
    Get-CimInstance Win32_Process |
      Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -like '*${pattern}*' -or $_.CommandLine -like '*${pattern}*') } |
      Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate |
      ConvertTo-Json -Depth 4
  `);
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function cleanupBeforeRun() {
  await execPowerShell(`
    Get-Process 'AgentVN Dev','agentvn-editor','agentvn-player' -ErrorAction SilentlyContinue |
      Stop-Process -Force -ErrorAction SilentlyContinue
  `).catch(() => undefined);
  if (fs.existsSync(PREVIEW_DIR)) {
    fs.rmSync(PREVIEW_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function startEditor() {
  assert(fs.existsSync(EDITOR_EXE), `Missing editor executable: ${EDITOR_EXE}`);
  return spawn(EDITOR_EXE, [], {
    cwd: ROOT,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9333",
      AGENTVN_GAMECLI_PREVIEW_CDP_PORT: PLAYER_CDP_PORT,
    },
    windowsHide: true,
    stdio: "ignore",
  });
}

async function ensureAdvancedPreviewPanel(page) {
  await page.waitForSelector('button[data-help-key="home.recentProject"], .editor-toolbar', { timeout: 90_000 });
  if (await page.locator('button[data-help-key="home.recentProject"]').first().isVisible().catch(() => false)) {
    await page.evaluate(() => {
      const recent = document.querySelector('button[data-help-key="home.recentProject"]');
      if (recent instanceof HTMLButtonElement) recent.click();
    });
    await page.waitForSelector(".editor-toolbar", { timeout: 90_000 }).catch(() => undefined);
  }

  if (await page.locator(".editor-toolbar").first().isVisible().catch(() => false)) {
    await page.waitForFunction(() => {
      const text = document.body.innerText || "";
      const stageClass = document.querySelector(".app-transition-stage")?.className || "";
      return text.includes("未选择节点") && !stageClass.includes("is-project-entry-loading");
    }, null, { timeout: 90_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("agentvn:open-advanced-tools", {
          detail: {
            id: "playwright_" + Date.now(),
            tab: "preview",
            title: "Playwright 预览验收",
            message: "正在通过真实 GameCLI 预览验证剧情推进。",
          },
        }));
      });
      if (await page.waitForSelector('button[data-help-key="preview.open"]', { timeout: 3_000 }).then(() => true).catch(() => false)) return;
      await page.waitForTimeout(700);
    }
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const previewTab = page.locator('button[data-help-key="advanced.tab.preview"]').first();
    if (await previewTab.isVisible().catch(() => false)) {
      await previewTab.click({ force: true }).catch(() => undefined);
      if (await page.waitForSelector('button[data-help-key="preview.open"]', { timeout: 10_000 }).then(() => true).catch(() => false)) return;
    }

    const hasToolbar = await page.waitForSelector('button[data-help-key="toolbar.advanced"]', { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (!hasToolbar) break;
    const advancedButton = page.locator('button[data-help-key="toolbar.advanced"]').first();
    if ((await advancedButton.getAttribute("aria-expanded").catch(() => null)) !== "true") {
      await advancedButton.click({ force: true });
    }
    await page.waitForTimeout(400);
  }

  const state = await page.evaluate(() => ({
    url: location.href,
    text: (document.body.innerText || "").slice(0, 1200),
    html: document.body.innerHTML.slice(0, 2000),
    buttons: Array.from(document.querySelectorAll("button")).map((button) => ({
      help: button.getAttribute("data-help-key"),
      testid: button.getAttribute("data-testid"),
      text: (button.innerText || "").trim().slice(0, 80),
      disabled: button.disabled,
    })),
  }));
  throw new Error("Could not open preview panel\n" + JSON.stringify(state, null, 2));
}

async function waitForDiskPreview(page) {
  const deadline = Date.now() + 360_000;
  let lastState = {};
  while (Date.now() < deadline) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const currentDir = path.join(PREVIEW_DIR, "current");
    const state = {
      bodyText: bodyText.slice(0, 1200),
      hasCurrent: fs.existsSync(currentDir),
      hasManifest: fs.existsSync(path.join(currentDir, "manifest.json")),
      hasScript: fs.existsSync(path.join(currentDir, "script.json")),
      hasIncoming: fs.existsSync(path.join(PREVIEW_DIR, "incoming")),
      hasIncomingCart: fs.existsSync(path.join(PREVIEW_DIR, "incoming.vncart")),
      entries: fs.existsSync(PREVIEW_DIR) ? fs.readdirSync(PREVIEW_DIR) : [],
    };
    lastState = state;
    assert(!bodyText.includes("Preview cartridge contains an unsafe path segment"), "Preview rejected a normal zip directory entry", state);
    assert(!bodyText.includes("Asset fetch failed"), "Preview asset fetch failed", state);
    assert(!bodyText.includes("Command begin_gamecli_preview_disk_upload not found"), "Disk upload command missing", state);
    assert(!bodyText.includes("Maximum call stack size exceeded"), "Preview hit stack overflow", state);
    assert(!bodyText.includes("Invalid array length"), "Preview hit invalid array length", state);

    const players = await getProcesses("agentvn-player.exe");
    const diskPlayers = players.filter((process) => String(process.CommandLine || "").includes("--preview-root"));
    if (state.hasManifest && state.hasScript && diskPlayers.length > 0) {
      return { currentDir, players: diskPlayers, previewEntries: state.entries };
    }
    await sleep(1500);
  }
  throw new Error("Timed out waiting for disk preview\n" + JSON.stringify(lastState, null, 2));
}

async function connectToFirstPage(cdpUrl, timeoutMs) {
  await waitForHttp(new URL("/json/version", cdpUrl).toString(), timeoutMs);
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages()[0] || await context.newPage();
  return { browser, page };
}

async function playPreview(page) {
  await page.waitForSelector('[data-testid="game-state-title"], [data-testid="main-menu"], [data-testid="start-new-game"]', { timeout: 120_000 });
  const titleText = await page.locator("body").innerText().catch(() => "");
  const startButton = page.locator('[data-testid="start-new-game"]').first();
  await startButton.waitFor({ state: "visible", timeout: 60_000 });
  await startButton.click({ force: true });
  await page.waitForSelector('[data-testid="game-state-playing"]', { timeout: 120_000 });
  await page.waitForTimeout(1500);

  const initial = await page.locator('[data-testid="game-state-playing"]').first().evaluate((element) => ({
    scene: element.getAttribute("data-current-scene-id"),
    index: Number(element.getAttribute("data-current-command-index") || "0"),
    commandType: element.getAttribute("data-current-command-type"),
    text: document.body.innerText.slice(0, 1000),
    isTyping: element.getAttribute("data-is-typing"),
  }));

  for (let reveal = 0; reveal < 4; reveal += 1) {
    const current = await page.locator('[data-testid="game-state-playing"]').first().evaluate((element) => ({
      isTyping: element.getAttribute("data-is-typing"),
    }));
    if (current.isTyping !== "true") break;
    const dialog = page.locator(".dialog-box").first();
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.click({ force: true }).catch(() => undefined);
    } else {
      await page.locator('[data-testid="game-state-playing"]').first().click({ position: { x: 900, y: 520 }, force: true }).catch(() => undefined);
    }
    await page.waitForTimeout(700);
  }

  const readyToAdvance = await page.locator('[data-testid="game-state-playing"]').first().evaluate((element) => ({
    scene: element.getAttribute("data-current-scene-id"),
    index: Number(element.getAttribute("data-current-command-index") || "0"),
    commandType: element.getAttribute("data-current-command-type"),
    text: document.body.innerText.slice(0, 1000),
    isTyping: element.getAttribute("data-is-typing"),
  }));

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const dialog = page.locator(".dialog-box").first();
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.click({ force: true }).catch(() => undefined);
    } else {
      await page.locator('[data-testid="game-state-playing"]').first().click({ position: { x: 900, y: 520 }, force: true }).catch(() => undefined);
    }
    await page.waitForTimeout(900);
    const current = await page.locator('[data-testid="game-state-playing"]').first().evaluate((element) => ({
      scene: element.getAttribute("data-current-scene-id"),
      index: Number(element.getAttribute("data-current-command-index") || "0"),
      commandType: element.getAttribute("data-current-command-type"),
      isTyping: element.getAttribute("data-is-typing"),
      waitingChoice: element.getAttribute("data-waiting-choice"),
      ended: element.getAttribute("data-ended"),
      text: document.body.innerText.slice(0, 1000),
    }));
    if (current.scene !== readyToAdvance.scene || current.index > readyToAdvance.index || current.waitingChoice === "true" || current.ended === "true") {
      return { titleText: titleText.slice(0, 1000), initial, readyToAdvance, after: current, clicks: attempt + 1 };
    }
  }

  const finalState = await page.locator('[data-testid="game-state-playing"]').first().evaluate((element) => ({
    scene: element.getAttribute("data-current-scene-id"),
    index: Number(element.getAttribute("data-current-command-index") || "0"),
    commandType: element.getAttribute("data-current-command-type"),
    text: document.body.innerText.slice(0, 1000),
  }));
  throw new Error("Preview entered playing state but did not advance after clicks\n" + JSON.stringify({ initial, readyToAdvance, finalState }, null, 2));
}

(async () => {
  await cleanupBeforeRun();
  const editorProcess = startEditor();
  let editorBrowser;
  let playerBrowser;
  try {
    const editor = await connectToFirstPage(EDITOR_CDP_URL, 120_000);
    editorBrowser = editor.browser;
    const editorPage = editor.page;
    await ensureAdvancedPreviewPanel(editorPage);

    await editorPage.waitForSelector('button[data-help-key="preview.open"]', { timeout: 60_000 });
    await editorPage.locator('button[data-help-key="preview.open"]').first().click({ force: true });
    const diskPreview = await waitForDiskPreview(editorPage);

    const player = await connectToFirstPage(PLAYER_CDP_URL, 120_000);
    playerBrowser = player.browser;
    const playthrough = await playPreview(player.page);

    const screenshotPath = path.join(OUTPUT_DIR, "gamecli-disk-preview-playthrough.png");
    await player.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

    const previewEntries = fs.readdirSync(PREVIEW_DIR);
    const result = {
      ok: true,
      currentDir: diskPreview.currentDir,
      previewEntries,
      playerProcesses: diskPreview.players,
      playthrough,
      screenshotPath,
    };
    assert(previewEntries.includes("current"), "Preview directory should contain current/", result);
    assert(!previewEntries.includes("incoming"), "Preview directory should not leave incoming/", result);
    assert(!previewEntries.includes("incoming.vncart"), "Preview directory should not leave incoming.vncart", result);
    assert(!previewEntries.some((entry) => entry.endsWith(".vncart")), "Disk preview should not leave temporary .vncart files", result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await playerBrowser?.close().catch(() => undefined);
    await editorBrowser?.close().catch(() => undefined);
    if (!editorProcess.killed) editorProcess.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
