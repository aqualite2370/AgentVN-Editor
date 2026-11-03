#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const { chromium } = require(path.join(ROOT, "editor", "node_modules", "playwright"));
const PORT = Number(process.env.AGENTVN_CUSTOM_BUTTON_RUNTIME_PORT || 6993);
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
  "custom-button-runtime-render",
);
const REPORT = path.join(OUT, "report.json");
const SHARED_UI_SKIN_MODULE = `/@fs/${path.join(ROOT, "shared", "cartridge", "uiSkin.ts").replace(/\\/g, "/")}`;

let server;
let serverOutput;
const checks = [];
const consoleErrors = [];
const pageErrors = [];
const unsafeRemoteRequests = [];

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
    file: "GameCli_framework/src/components/shell/MainMenu.tsx",
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

async function installFixtureController(page) {
  await page.evaluate(async ({ uiSkinModule }) => {
    const [{ useRuntimeStore }, { getDefaultUISkinLayout }] = await Promise.all([
      import("/src/store/runtimeStore.ts"),
      import(uiSkinModule),
    ]);
    const script = {
      schema_version: "1.0.0",
      game_id: "custom_button_runtime_render",
      title: "自定义按钮运行时验收",
      entry_scene_id: "start",
      characters: [],
      scenes: [{
        scene_id: "start",
        title: "Start",
        summary: "Runtime custom button acceptance.",
        chapter: 1,
        tags: ["acceptance"],
        commands: [{ type: "narration", text: "Runtime custom button acceptance." }],
        is_ending: true,
      }],
    };
    const manifest = {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.2.0",
      game_id: script.game_id,
      title: script.title,
      author: "AgentVN QA",
      description: "自定义标题按钮运行时浏览器验收。",
      version: "1.0.0",
      language: "zh-CN",
      tags: ["acceptance"],
      entry_script: "script.json",
      entry_scene_id: "start",
      assets: [],
      created_at: "2026-07-10T00:00:00.000Z",
      updated_at: "2026-07-10T00:00:00.000Z",
    };
    const setButtons = ({
      buttons,
      manifestAssets = [],
      assetUrls = {},
      uiAssetUrls = {},
    }) => {
      const uiSkin = getDefaultUISkinLayout();
      const title = uiSkin.screens.find((screen) => screen.screen_id === "title");
      if (!title) throw new Error("Default UI skin is missing title screen.");
      title.components.push(...buttons);
      const runtimeManifest = { ...manifest, assets: manifestAssets };
      useRuntimeStore.setState({
        currentGame: {
          install_id: "custom_button_runtime_render",
          game_id: manifest.game_id,
          title: manifest.title,
          author: manifest.author,
          version: manifest.version,
          description: manifest.description,
          language: manifest.language,
          manifest: runtimeManifest,
          script,
          gallery: [],
          uiSkin,
          assetUrls,
          uiAssetUrls,
          imported_at: "2026-07-10T00:00:00.000Z",
          updated_at: "2026-07-10T00:00:00.000Z",
          source_file_name: "runtime-render-acceptance.vncart",
          cartridge_path: "",
        },
        screen: "title_menu",
        runtimeMode: "fixed",
        saves: [],
      });
    };
    window.__AGENTVN_SET_CUSTOM_TITLE_BUTTONS__ = setButtons;
    setButtons({ buttons: [] });
  }, { uiSkinModule: SHARED_UI_SKIN_MODULE });
}

async function setButtons(page, buttons, runtimeAssets = {}) {
  await page.evaluate((fixture) => {
    window.__AGENTVN_SET_CUSTOM_TITLE_BUTTONS__(fixture);
  }, { buttons, ...runtimeAssets });
  await page.waitForTimeout(100);
}

function customButton(id, label, x, visible = true, image = {}) {
  return {
    component_id: id,
    component_type: "main_menu_custom_button",
    label,
    visible,
    rect: { x, y: 88, width: 18, height: 7 },
    mobileRect: { x, y: 89, width: 26, height: 6 },
    style: {
      backgroundColor: "#26334c",
      ...(image.reference ? {
        backgroundImage: image.reference,
        backgroundFit: image.fit ?? "cover",
      } : {}),
      color: "#f5f7ff",
      borderColor: "#7fa4ff",
      borderWidth: 1,
      borderRadius: 8,
      textAlign: "center",
    },
    action: { kind: "none" },
  };
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
    page.on("request", (request) => {
      if (request.url().startsWith("https://remote.invalid/")) unsafeRemoteRequests.push(request.url());
    });
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#root", { timeout: 30000 });
    await page.waitForTimeout(700);
    await installFixtureController(page);
    await page.waitForSelector('[data-testid="game-state-title"]', { timeout: 30000 });

    await setButtons(page, [
      customButton("runtime_custom_only", "单个自定义按钮", 6),
    ]);
    let customButtons = page.locator('[data-testid="custom-title-button"]');
    await customButtons.first().waitFor({ state: "visible" });
    expect(await customButtons.count() === 1, "one configured custom button renders exactly once", await customButtons.count());
    expect(
      await customButtons.first().getAttribute("data-ui-component-id") === "runtime_custom_only",
      "single custom button keeps its component id",
      await customButtons.first().getAttribute("data-ui-component-id"),
    );

    await setButtons(page, [
      customButton("runtime_custom_first", "官方网站", 6),
      customButton("runtime_custom_second", "红P主页", 28),
      customButton("runtime_custom_hidden", "不可见按钮", 50, false),
      customButton("runtime_custom_fallback", "   ", 72),
    ]);
    customButtons = page.locator('[data-testid="custom-title-button"]');
    await page.locator('[data-ui-component-id="runtime_custom_first"]').waitFor({ state: "visible" });
    const snapshot = await customButtons.evaluateAll((nodes) => nodes.map((node) => ({
      id: node.getAttribute("data-ui-component-id"),
      text: node.textContent?.trim(),
      ariaLabel: node.getAttribute("aria-label"),
      left: getComputedStyle(node).left,
      top: getComputedStyle(node).top,
    })));
    expect(
      JSON.stringify(snapshot.map((item) => item.id)) === JSON.stringify([
        "runtime_custom_first",
        "runtime_custom_second",
        "runtime_custom_fallback",
      ]),
      "visible custom buttons preserve UI layout array order",
      snapshot,
    );
    expect(
      snapshot[0]?.text === "官方网站" && snapshot[1]?.text === "红P主页",
      "custom button labels render unchanged",
      snapshot,
    );
    expect(
      snapshot[0]?.left !== snapshot[1]?.left && snapshot.every((item) => item.top),
      "each custom button resolves its own layout rect",
      snapshot,
    );
    expect(
      await page.locator('[data-ui-component-id="runtime_custom_hidden"]').count() === 0,
      "visible=false custom button is excluded from the DOM",
      await page.locator('[data-ui-component-id="runtime_custom_hidden"]').count(),
    );
    expect(
      Boolean(snapshot[2]?.ariaLabel?.trim()) && snapshot[2]?.text === snapshot[2]?.ariaLabel,
      "missing label receives a visible accessible fallback name",
      snapshot[2],
    );

    const fixedButtonIds = [
      "title_start_button",
      "title_save_load_button",
      "title_gallery_button",
      "title_settings_button",
      "title_about_button",
    ];
    const fixedButtonsPresent = await page.evaluate((ids) => (
      ids.every((id) => Boolean(document.querySelector(`[data-ui-component-id="${id}"]`)))
    ), fixedButtonIds);
    expect(fixedButtonsPresent, "all fixed title menu buttons remain present", fixedButtonIds);

    const beforeClickState = await page.locator('[data-testid="game-state-title"]').getAttribute("data-runtime-state");
    await page.locator('[data-ui-component-id="runtime_custom_first"]').click();
    const afterClickState = await page.locator('[data-testid="game-state-title"]').getAttribute("data-runtime-state");
    expect(
      beforeClickState === "title_menu" && afterClickState === beforeClickState,
      "button with no action has no navigation side effect",
      { beforeClickState, afterClickState },
    );

    await page.screenshot({
      path: path.join(OUT, "01-multiple-custom-title-buttons.png"),
      fullPage: true,
    });

    const imageDataUrl = `data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120">'
        + '<defs><linearGradient id="g"><stop stop-color="#315ea8"/><stop offset="1" stop-color="#713c8d"/></linearGradient></defs>'
        + '<rect width="480" height="120" rx="18" fill="url(#g)"/>'
        + '<circle cx="420" cy="32" r="45" fill="#fff" opacity=".14"/>'
        + "</svg>",
      "utf8",
    ).toString("base64")}`;
    await setButtons(page, [
      customButton("runtime_image_asset_id", "素材 ID 图片", 3, true, {
        reference: "asset:button_art",
        fit: "cover",
      }),
      customButton("runtime_image_legacy_path", "旧路径图片", 23, true, {
        reference: "assets/ui/legacy-art.svg",
        fit: "contain",
      }),
      customButton("runtime_image_missing", "缺图仍显示文字", 43, true, {
        reference: "asset:missing_art",
        fit: "cover",
      }),
      customButton("runtime_image_broken", "加载失败仍可用", 63, true, {
        reference: "asset:broken_art",
        fit: "cover",
      }),
      customButton("runtime_image_remote_blocked", "远程引用被阻止", 83, true, {
        reference: "https://remote.invalid/tracker.png",
        fit: "cover",
      }),
    ], {
      manifestAssets: [
        { asset_id: "button_art", asset_type: "ui", path: "assets/ui/button-art.svg", filename: "button-art.svg", mime_type: "image/svg+xml" },
        { asset_id: "legacy_art", asset_type: "ui", path: "assets/ui/legacy-art.svg", filename: "legacy-art.svg", mime_type: "image/svg+xml" },
        { asset_id: "broken_art", asset_type: "ui", path: "assets/ui/broken-art.png", filename: "broken-art.png", mime_type: "image/png" },
      ],
      assetUrls: {
        button_art: imageDataUrl,
        "assets/ui/legacy-art.svg": imageDataUrl,
        broken_art: "data:image/png;base64,AA==",
      },
      uiAssetUrls: {},
    });
    const imageSnapshot = await page.locator('[data-testid="custom-title-button"]').evaluateAll((nodes) => (
      nodes.map((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          id: node.getAttribute("data-ui-component-id"),
          imageState: node.getAttribute("data-ui-image-state"),
          ariaLabel: node.getAttribute("aria-label"),
          text: node.textContent?.trim(),
          backgroundImage: style.backgroundImage,
          backgroundSize: style.backgroundSize,
          backgroundColor: style.backgroundColor,
          borderWidth: style.borderWidth,
          boxShadow: style.boxShadow,
          frameMode: node.getAttribute("data-ui-frame-mode"),
          labelDisplay: getComputedStyle(node.querySelector(".custom-title-button-label")).display,
          overlay: getComputedStyle(node, "::before").backgroundImage,
          width: rect.width,
          height: rect.height,
        };
      })
    ));
    const imageById = Object.fromEntries(imageSnapshot.map((item) => [item.id, item]));
    expect(
      imageById.runtime_image_asset_id?.backgroundImage.includes("data:image/svg+xml"),
      "asset:<id> resolves through the runtime asset map",
      imageById.runtime_image_asset_id,
    );
    expect(
      imageById.runtime_image_asset_id?.backgroundSize === "cover",
      "cover image fit is applied explicitly",
      imageById.runtime_image_asset_id,
    );
    expect(
      imageById.runtime_image_legacy_path?.backgroundImage.includes("data:image/svg+xml")
        && imageById.runtime_image_legacy_path?.backgroundSize === "contain",
      "legacy packaged asset path resolves with contain fit",
      imageById.runtime_image_legacy_path,
    );
    expect(
      ["runtime_image_asset_id", "runtime_image_legacy_path"].every((id) => {
        const item = imageById[id];
        return item?.frameMode === "image_owned"
          && item.backgroundColor === "rgba(0, 0, 0, 0)"
          && item.borderWidth === "0px"
          && item.boxShadow === "none"
          && item.labelDisplay === "none"
          && item.overlay === "none";
      }),
      "resolved image buttons must render only their artwork with a transparent frame",
      imageById,
    );
    expect(
      imageById.runtime_image_missing?.backgroundImage === "none"
        && imageById.runtime_image_missing?.imageState === "missing"
        && imageById.runtime_image_missing?.text === "缺图仍显示文字",
      "missing image keeps the text button and does not create an invalid CSS URL",
      imageById.runtime_image_missing,
    );
    expect(
      imageById.runtime_image_broken?.width > 0
        && imageById.runtime_image_broken?.height > 0
        && imageById.runtime_image_broken?.text === "加载失败仍可用",
      "failed image load preserves text and clickable dimensions",
      imageById.runtime_image_broken,
    );
    expect(
      imageById.runtime_image_remote_blocked?.backgroundImage === "none"
        && imageById.runtime_image_remote_blocked?.imageState === "missing"
        && unsafeRemoteRequests.length === 0,
      "direct remote UI reference is never emitted into CSS or requested",
      { button: imageById.runtime_image_remote_blocked, unsafeRemoteRequests },
    );
    expect(
      imageSnapshot.every((item) => Boolean(item.ariaLabel?.trim()) && item.text === item.ariaLabel),
      "all image and missing-image buttons retain accessible names",
      imageSnapshot,
    );
    expect(
      imageById.runtime_image_asset_id?.overlay === "none",
      "image-owned button must not add a tint over imported artwork",
      imageById.runtime_image_asset_id,
    );
    const imageButton = page.locator('[data-ui-component-id="runtime_image_asset_id"]');
    const beforeHover = await imageButton.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderWidth,
        transform: style.transform,
      };
    });
    await imageButton.hover();
    const afterHover = await imageButton.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderWidth,
        transform: style.transform,
      };
    });
    expect(
      afterHover.backgroundImage === beforeHover.backgroundImage
        && afterHover.backgroundImage !== "none"
        && afterHover.backgroundColor === "rgba(0, 0, 0, 0)"
        && afterHover.borderWidth === "0px"
        && afterHover.transform === "none",
      "hover must preserve image-owned artwork and its transparent frame",
      { beforeHover, afterHover },
    );
    await page.mouse.move(1, 1);
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    let focusedComponentId = "";
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("Tab");
      focusedComponentId = await page.evaluate(() => (
        document.activeElement?.getAttribute("data-ui-component-id") ?? ""
      ));
      if (focusedComponentId === "runtime_image_asset_id") break;
    }
    const focusStyle = await page.locator('[data-ui-component-id="runtime_image_asset_id"]').evaluate((node) => {
      const style = getComputedStyle(node);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
    });
    expect(
      focusedComponentId === "runtime_image_asset_id"
        && focusStyle.outlineStyle !== "none"
        && focusStyle.outlineWidth !== "0px",
      "focus ring remains visible above the button image",
      { focusedComponentId, ...focusStyle },
    );
    await page.screenshot({
      path: path.join(OUT, "02-image-resolution-and-fallback.png"),
      fullPage: true,
    });
    expect(consoleErrors.length === 0, "browser console remains free of errors", consoleErrors);
    expect(pageErrors.length === 0, "browser page-error stream remains clean", pageErrors);

    const report = {
      ok: true,
      checks,
      consoleErrors,
      pageErrors,
      unsafeRemoteRequests,
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
      unsafeRemoteRequests,
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
