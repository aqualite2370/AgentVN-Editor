#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const { chromium } = require(path.join(ROOT, "editor", "node_modules", "playwright"));
const PORT = Number(process.env.AGENTVN_CUSTOM_BUTTON_LINK_PORT || 6994);
const URL = `http://127.0.0.1:${PORT}/`;
const VITE = path.join(
  ROOT,
  "GameCli_framework",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);
const OUT = path.join(
  ROOT,
  "output",
  "playwright",
  "client-experience-enhancement",
  "custom-button-runtime-link",
);
const REPORT = path.join(OUT, "report.json");
const SHARED_UI_SKIN_MODULE = `/@fs/${path.join(ROOT, "shared", "cartridge", "uiSkin.ts").replace(/\\/g, "/")}`;

let server;
let serverOutput;
const checks = [];
const consoleErrors = [];
const pageErrors = [];

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeReport(payload) {
  ensureDirectory(path.dirname(REPORT));
  fs.writeFileSync(REPORT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function expect(condition, assertion, value) {
  if (!condition) throw new Error(`${assertion}; ${JSON.stringify(value)}`);
  checks.push({
    assertion,
    value,
    file: "GameCli_framework/src/utils/openExternalUrl.ts",
  });
}

function killPort(port) {
  if (process.platform !== "win32") return;
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | `
        + "Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | "
        + "% { if ($_ -gt 0) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }",
    ], { windowsHide: true, stdio: "ignore" });
  } catch (_) {}
}

async function reachable(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok || response.status < 500;
  } catch (_) {
    return false;
  }
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 90000) {
    if (await reachable(URL)) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`GameCli dev server did not become reachable: ${URL}`);
}

function startServer() {
  ensureDirectory(path.join(OUT, "logs"));
  serverOutput = fs.openSync(path.join(OUT, "logs", "gamecli-vite.log"), "a");
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : VITE;
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", VITE, "--host", "127.0.0.1", "--port", String(PORT)]
    : ["--host", "127.0.0.1", "--port", String(PORT)];
  server = spawn(command, args, {
    cwd: path.join(ROOT, "GameCli_framework"),
    stdio: ["ignore", serverOutput, serverOutput],
    windowsHide: true,
    shell: false,
  });
}

function stopServer() {
  try { server?.kill(); } catch (_) {}
  try {
    if (serverOutput !== undefined) fs.closeSync(serverOutput);
  } catch (_) {}
}

function customButton(id, label, x, y, action) {
  return {
    component_id: id,
    component_type: "main_menu_custom_button",
    label,
    visible: true,
    rect: { x, y, width: 15, height: 7 },
    mobileRect: { x, y, width: 23, height: 6 },
    style: {
      backgroundColor: "#26334c",
      color: "#f5f7ff",
      borderColor: "#7fa4ff",
      borderWidth: 1,
      borderRadius: 8,
      textAlign: "center",
    },
    action,
  };
}

async function installFixture(page) {
  await page.evaluate(async ({ uiSkinModule }) => {
    const [{ useRuntimeStore }, { getDefaultUISkinLayout }] = await Promise.all([
      import("/src/store/runtimeStore.ts"),
      import(uiSkinModule),
    ]);
    const uiSkin = getDefaultUISkinLayout();
    const title = uiSkin.screens.find((screen) => screen.screen_id === "title");
    if (!title) throw new Error("Default UI skin is missing title screen.");
    title.components.push(
      {
        component_id: "runtime_link_valid",
        component_type: "main_menu_custom_button",
        label: "安全官网",
        visible: true,
        rect: { x: 3, y: 72, width: 15, height: 7 },
        mobileRect: { x: 3, y: 72, width: 23, height: 6 },
        style: { backgroundColor: "#26334c", color: "#f5f7ff", borderColor: "#7fa4ff", borderWidth: 1, borderRadius: 8, textAlign: "center" },
        action: { kind: "external_url", url: "  https://example.com/docs?q=1  ", open_mode: "system_browser" },
      },
      {
        component_id: "runtime_link_javascript",
        component_type: "main_menu_custom_button",
        label: "阻止脚本链接",
        visible: true,
        rect: { x: 20, y: 72, width: 15, height: 7 },
        mobileRect: { x: 27, y: 72, width: 23, height: 6 },
        style: { backgroundColor: "#26334c", color: "#f5f7ff", borderColor: "#7fa4ff", borderWidth: 1, borderRadius: 8, textAlign: "center" },
        action: { kind: "external_url", url: "javascript:alert(1)" },
      },
      {
        component_id: "runtime_link_file",
        component_type: "main_menu_custom_button",
        label: "阻止文件链接",
        visible: true,
        rect: { x: 37, y: 72, width: 15, height: 7 },
        mobileRect: { x: 51, y: 72, width: 23, height: 6 },
        style: { backgroundColor: "#26334c", color: "#f5f7ff", borderColor: "#7fa4ff", borderWidth: 1, borderRadius: 8, textAlign: "center" },
        action: { kind: "external_url", url: "file:///C:/unsafe.txt" },
      },
      {
        component_id: "runtime_link_empty",
        component_type: "main_menu_custom_button",
        label: "阻止空链接",
        visible: true,
        rect: { x: 54, y: 72, width: 15, height: 7 },
        mobileRect: { x: 75, y: 72, width: 23, height: 6 },
        style: { backgroundColor: "#26334c", color: "#f5f7ff", borderColor: "#7fa4ff", borderWidth: 1, borderRadius: 8, textAlign: "center" },
        action: { kind: "external_url", url: "   " },
      },
      {
        component_id: "runtime_link_none",
        component_type: "main_menu_custom_button",
        label: "无操作按钮",
        visible: true,
        rect: { x: 3, y: 82, width: 15, height: 7 },
        mobileRect: { x: 3, y: 82, width: 23, height: 6 },
        style: { backgroundColor: "#26334c", color: "#f5f7ff", borderColor: "#7fa4ff", borderWidth: 1, borderRadius: 8, textAlign: "center" },
        action: { kind: "none" },
      },
      {
        component_id: "runtime_link_unknown",
        component_type: "main_menu_custom_button",
        label: "未知操作",
        visible: true,
        rect: { x: 20, y: 82, width: 15, height: 7 },
        mobileRect: { x: 27, y: 82, width: 23, height: 6 },
        style: { backgroundColor: "#26334c", color: "#f5f7ff", borderColor: "#7fa4ff", borderWidth: 1, borderRadius: 8, textAlign: "center" },
        action: { kind: "run_script", url: "https://example.com/should-not-open" },
      },
    );
    const script = {
      schema_version: "1.0.0",
      game_id: "custom_button_runtime_link",
      title: "自定义按钮安全外链验收",
      entry_scene_id: "start",
      characters: [],
      scenes: [{
        scene_id: "start",
        title: "Start",
        summary: "Runtime link acceptance.",
        chapter: 1,
        tags: ["acceptance"],
        commands: [{ type: "narration", text: "Runtime link acceptance." }],
        is_ending: true,
      }],
    };
    const manifest = {
      manifest_version: "1.0.0",
      game_id: script.game_id,
      title: script.title,
      author: "AgentVN QA",
      description: "安全外链浏览器验收。",
      version: "1.0.0",
      language: "zh-CN",
      tags: ["acceptance"],
      entry_script: "script.json",
      entry_scene_id: "start",
      runtime_version: "0.2.0",
      assets: [],
    };
    window.__AGENTVN_OPEN_CALLS__ = [];
    window.__AGENTVN_POPUP_MODE__ = "success";
    window.__AGENTVN_LAST_POPUP__ = null;
    window.open = (url, target, features) => {
      window.__AGENTVN_OPEN_CALLS__.push({ url: String(url), target, features });
      if (window.__AGENTVN_POPUP_MODE__ === "blocked") return null;
      const popup = { opener: "unsafe-parent" };
      window.__AGENTVN_LAST_POPUP__ = popup;
      return popup;
    };
    window.__AGENTVN_RESET_OPEN_CALLS__ = (mode = "success") => {
      window.__AGENTVN_OPEN_CALLS__ = [];
      window.__AGENTVN_POPUP_MODE__ = mode;
      window.__AGENTVN_LAST_POPUP__ = null;
    };
    useRuntimeStore.setState({
      currentGame: {
        install_id: "custom_button_runtime_link",
        game_id: manifest.game_id,
        title: manifest.title,
        author: manifest.author,
        version: manifest.version,
        description: manifest.description,
        language: manifest.language,
        manifest,
        script,
        gallery: [],
        uiSkin,
        assetUrls: {},
        uiAssetUrls: {},
        imported_at: "2026-07-10T00:00:00.000Z",
        updated_at: "2026-07-10T00:00:00.000Z",
        source_file_name: "runtime-link-acceptance.vncart",
        cartridge_path: "",
      },
      screen: "title_menu",
      runtimeMode: "fixed",
      saves: [],
    });
  }, { uiSkinModule: SHARED_UI_SKIN_MODULE });
}

async function openState(page) {
  return page.evaluate(() => ({
    calls: [...window.__AGENTVN_OPEN_CALLS__],
    popupOpener: window.__AGENTVN_LAST_POPUP__?.opener ?? null,
    runtimeState: document.querySelector('[data-testid="game-state-title"]')?.getAttribute("data-runtime-state"),
    status: document.querySelector('[data-testid="custom-title-action-status"]')?.textContent?.trim() ?? "",
  }));
}

async function resetOpenCalls(page, mode = "success") {
  await page.evaluate((nextMode) => window.__AGENTVN_RESET_OPEN_CALLS__(nextMode), mode);
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  ensureDirectory(OUT);
  killPort(PORT);
  startServer();

  const browser = await chromium.launch({ headless: true });
  let context;
  try {
    await waitForServer();
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#root", { timeout: 30000 });
    await page.waitForTimeout(700);
    await installFixture(page);
    await page.waitForSelector('[data-ui-component-id="runtime_link_valid"]', { timeout: 30000 });

    await page.locator('[data-ui-component-id="runtime_link_valid"]').click();
    await page.waitForTimeout(80);
    let state = await openState(page);
    expect(state.calls.length === 1, "valid HTTPS click calls the opener exactly once", state);
    expect(
      state.calls[0]?.url === "https://example.com/docs?q=1"
        && state.calls[0]?.target === "_blank"
        && state.calls[0]?.features === "noopener,noreferrer",
      "web opener receives normalized URL, _blank, noopener and noreferrer",
      state.calls[0],
    );
    expect(state.popupOpener === null, "opened web window has its opener cleared", state);

    for (const componentId of ["runtime_link_javascript", "runtime_link_file", "runtime_link_empty"]) {
      await resetOpenCalls(page);
      await page.locator(`[data-ui-component-id="${componentId}"]`).click();
      await page.waitForTimeout(50);
      state = await openState(page);
      expect(state.calls.length === 0, `${componentId} does not call the underlying opener`, state);
      expect(state.status.includes("链接无效"), `${componentId} exposes non-crashing invalid-link feedback`, state.status);
    }

    await resetOpenCalls(page);
    await page.locator('[data-ui-component-id="runtime_link_none"]').click();
    await page.waitForTimeout(40);
    state = await openState(page);
    expect(state.calls.length === 0, "none action produces no opener side effect", state);

    await resetOpenCalls(page);
    await page.locator('[data-ui-component-id="runtime_link_unknown"]').click();
    await page.waitForTimeout(40);
    state = await openState(page);
    expect(state.calls.length === 0, "unknown action kind produces no opener side effect", state);
    expect(state.status.includes("暂不受支持"), "unknown action kind returns accessible feedback instead of throwing", state.status);

    await resetOpenCalls(page, "blocked");
    await page.locator('[data-ui-component-id="runtime_link_valid"]').click();
    await page.waitForTimeout(50);
    state = await openState(page);
    expect(state.calls.length === 1, "popup-blocked path attempts only one validated web open", state);
    expect(state.status.includes("阻止了新窗口"), "popup-blocked path returns accessible feedback", state.status);
    expect(state.runtimeState === "title_menu", "popup-blocked path leaves the title menu stable", state.runtimeState);

    await resetOpenCalls(page);
    await page.locator('[data-ui-component-id="runtime_link_valid"]').focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(50);
    state = await openState(page);
    expect(state.calls.length === 1, "keyboard Enter activates the standard button once", state.calls);
    await page.keyboard.press("Space");
    await page.waitForTimeout(50);
    state = await openState(page);
    expect(state.calls.length === 2, "keyboard Space activates the standard button once", state.calls);
    expect(
      state.calls.every((call) => call.features === "noopener,noreferrer"),
      "keyboard activation keeps the same secure web opener features",
      state.calls,
    );

    const actionKinds = await page.locator('[data-testid="custom-title-button"]').evaluateAll((nodes) => (
      Object.fromEntries(nodes.map((node) => [
        node.getAttribute("data-ui-component-id"),
        node.getAttribute("data-ui-action-kind"),
      ]))
    ));
    expect(
      actionKinds.runtime_link_valid === "external_url"
        && actionKinds.runtime_link_none === "none"
        && actionKinds.runtime_link_unknown === "run_script",
      "runtime exposes action kinds for deterministic testing without changing button semantics",
      actionKinds,
    );
    expect(consoleErrors.length === 0, "browser console remains free of errors", consoleErrors);
    expect(pageErrors.length === 0, "browser page-error stream remains clean", pageErrors);

    await page.screenshot({
      path: path.join(OUT, "01-safe-external-link-buttons.png"),
      fullPage: true,
    });
    const report = {
      ok: true,
      checks,
      consoleErrors,
      pageErrors,
      outputDir: OUT,
    };
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    writeReport({
      ok: false,
      checks,
      consoleErrors,
      pageErrors,
      error: String(error?.stack || error),
      outputDir: OUT,
    });
    throw error;
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    stopServer();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  stopServer();
  process.exit(1);
});
