#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const { chromium } = require(path.join(ROOT, "editor", "node_modules", "playwright"));
const PORT = Number(process.env.AGENTVN_CUSTOM_BUTTON_RESPONSIVE_PORT || 6995);
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
  "custom-button-responsive",
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
    file: "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
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

async function installFixture(page) {
  const imageDataUrl = `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120">'
      + '<rect width="480" height="120" rx="18" fill="#315ea8"/>'
      + '<circle cx="420" cy="30" r="48" fill="#fff" opacity=".16"/>'
      + "</svg>",
    "utf8",
  ).toString("base64")}`;
  await page.evaluate(async ({ uiSkinModule, imageUrl }) => {
    const [{ useRuntimeStore }, { getDefaultUISkinLayout }] = await Promise.all([
      import("/src/store/runtimeStore.ts"),
      import(uiSkinModule),
    ]);
    const uiSkin = getDefaultUISkinLayout();
    const title = uiSkin.screens.find((screen) => screen.screen_id === "title");
    if (!title) throw new Error("Default UI skin is missing title screen.");
    const fixedButtonRects = {
      title_continue_button: { desktop: [78, 20, 18, 7], mobile: [68, 10, 27, 7] },
      title_start_button: { desktop: [78, 28, 18, 7], mobile: [68, 18, 27, 7] },
      title_save_load_button: { desktop: [78, 36, 18, 7], mobile: [68, 26, 27, 7] },
      title_library_button: { desktop: [78, 44, 18, 7], mobile: [68, 34, 27, 7] },
      title_gallery_button: { desktop: [78, 52, 18, 7], mobile: [68, 34, 27, 7] },
      title_settings_button: { desktop: [78, 60, 18, 7], mobile: [68, 42, 27, 7] },
      title_about_button: { desktop: [78, 68, 18, 7], mobile: [68, 50, 27, 7] },
    };
    for (const component of title.components) {
      const rects = fixedButtonRects[component.component_id];
      if (!rects) continue;
      component.rect = {
        x: rects.desktop[0],
        y: rects.desktop[1],
        width: rects.desktop[2],
        height: rects.desktop[3],
      };
      component.mobileRect = {
        x: rects.mobile[0],
        y: rects.mobile[1],
        width: rects.mobile[2],
        height: rects.mobile[3],
      };
    }
    const positions = [
      { id: "responsive_custom_1", label: "响应按钮一", desktop: [4, 82, 14, 7], mobile: [5, 64, 27, 6], image: true },
      { id: "responsive_custom_2", label: "响应按钮二", desktop: [20, 82, 14, 7], mobile: [36, 64, 27, 6] },
      { id: "responsive_custom_3", label: "响应按钮三", desktop: [36, 82, 14, 7], mobile: [67, 64, 27, 6] },
      { id: "responsive_custom_4", label: "响应按钮四", desktop: [52, 82, 14, 7], mobile: [5, 78, 27, 6] },
      { id: "responsive_custom_5", label: "响应按钮五", desktop: [68, 82, 14, 7], mobile: [36, 78, 27, 6] },
      { id: "responsive_custom_6", label: "响应按钮六", desktop: [84, 82, 12, 7], mobile: [67, 78, 27, 6] },
      { id: "responsive_custom_hidden", label: "隐藏按钮", desktop: [4, 92, 14, 7], mobile: [5, 92, 27, 6], hidden: true },
    ];
    for (const item of positions) {
      title.components.push({
        component_id: item.id,
        component_type: "main_menu_custom_button",
        label: item.label,
        visible: !item.hidden,
        rect: { x: item.desktop[0], y: item.desktop[1], width: item.desktop[2], height: item.desktop[3] },
        mobileRect: { x: item.mobile[0], y: item.mobile[1], width: item.mobile[2], height: item.mobile[3] },
        style: {
          backgroundColor: "#26334c",
          ...(item.image ? { backgroundImage: "asset:responsive_art", backgroundFit: "cover" } : {}),
          color: "#f5f7ff",
          borderColor: "#7fa4ff",
          borderWidth: 1,
          borderRadius: 8,
          textAlign: "center",
        },
        action: { kind: "none" },
      });
    }
    const script = {
      schema_version: "1.0.0",
      game_id: "custom_button_responsive",
      title: "按钮响应验收",
      entry_scene_id: "start",
      characters: [],
      scenes: [{
        scene_id: "start",
        title: "Start",
        summary: "Responsive acceptance.",
        chapter: 1,
        tags: ["acceptance"],
        commands: [{ type: "narration", text: "Responsive acceptance." }],
        is_ending: true,
      }],
    };
    const manifest = {
      manifest_version: "1.0.0",
      game_id: script.game_id,
      title: script.title,
      author: "AgentVN QA",
      description: "桌面与移动布局、触摸目标和焦点顺序验收。",
      version: "1.0.0",
      language: "zh-CN",
      tags: ["acceptance"],
      entry_script: "script.json",
      entry_scene_id: "start",
      runtime_version: "0.2.0",
      assets: [{
        asset_id: "responsive_art",
        asset_type: "ui",
        path: "assets/ui/responsive-art.svg",
        filename: "responsive-art.svg",
        mime_type: "image/svg+xml",
      }],
    };
    useRuntimeStore.setState({
      currentGame: {
        install_id: "custom_button_responsive",
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
        assetUrls: { responsive_art: imageUrl },
        uiAssetUrls: {},
        imported_at: "2026-07-10T00:00:00.000Z",
        updated_at: "2026-07-10T00:00:00.000Z",
        source_file_name: "responsive-acceptance.vncart",
        cartridge_path: "",
      },
      screen: "title_menu",
      runtimeMode: "fixed",
      saves: [],
    });
  }, { uiSkinModule: SHARED_UI_SKIN_MODULE, imageUrl: imageDataUrl });
}

async function layoutSnapshot(page) {
  return page.locator('[data-testid="custom-title-button"]').evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      id: node.getAttribute("data-ui-component-id"),
      left: node.style.left,
      top: node.style.top,
      width: node.style.width,
      height: node.style.height,
      actualLeft: rect.left,
      actualTop: rect.top,
      actualRight: rect.right,
      actualBottom: rect.bottom,
      actualWidth: rect.width,
      actualHeight: rect.height,
      minWidth: style.minWidth,
      minHeight: style.minHeight,
      ariaLabel: node.getAttribute("aria-label"),
      imageState: node.getAttribute("data-ui-image-state"),
    };
  }));
}

async function visibleTitleButtonOverlaps(page) {
  return page.locator('.menu-actions-individual .menu-action-button').evaluateAll((nodes) => {
    const visible = nodes.filter((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    });
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < visible.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < visible.length; rightIndex += 1) {
        const left = visible[leftIndex];
        const right = visible[rightIndex];
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        const overlapWidth = Math.min(leftRect.right, rightRect.right) - Math.max(leftRect.left, rightRect.left);
        const overlapHeight = Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top);
        if (overlapWidth <= 0 || overlapHeight <= 0) continue;
        overlaps.push([
          left.getAttribute("data-ui-component-id"),
          right.getAttribute("data-ui-component-id"),
        ]);
      }
    }
    return overlaps;
  });
}

async function collectCustomTabOrder(page) {
  await page.mouse.move(1, 1);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const order = [];
  const focusStyles = [];
  for (let index = 0; index < 24 && order.length < 6; index += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const node = document.activeElement;
      if (!(node instanceof HTMLElement)) return null;
      const id = node.getAttribute("data-ui-component-id");
      const style = getComputedStyle(node);
      return {
        id,
        testId: node.getAttribute("data-testid"),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    if (focused?.testId !== "custom-title-button") continue;
    order.push(focused.id);
    focusStyles.push(focused);
  }
  return { order, focusStyles };
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
    await page.locator(".boot-overlay").waitFor({ state: "hidden", timeout: 30000 });
    await installFixture(page);
    await page.waitForSelector('[data-ui-component-id="responsive_custom_1"]', { timeout: 30000 });
    await page.locator('[data-testid="game-state-title"]').waitFor({ state: "visible", timeout: 30000 });

    const desktopBreakpoint = await page.locator('.ui-skin-scope[data-ui-screen="title"]').getAttribute("data-ui-breakpoint");
    const desktop = await layoutSnapshot(page);
    expect(desktopBreakpoint === "desktop", "1280x720 viewport selects desktop UI layout", desktopBreakpoint);
    expect(
      desktop[0]?.left === "4%" && desktop[0]?.top === "82%" && desktop[0]?.width === "14%" && desktop[0]?.height === "7%",
      "desktop viewport uses the custom button desktop rect",
      desktop[0],
    );
    expect(desktop.length === 6, "more than three visible custom buttons remain rendered", desktop.map((item) => item.id));
    expect(
      await page.locator('[data-ui-component-id="responsive_custom_hidden"]').count() === 0,
      "visible=false custom button is absent from the DOM",
      await page.locator('[data-ui-component-id="responsive_custom_hidden"]').count(),
    );
    const desktopTabs = await collectCustomTabOrder(page);
    const expectedOrder = [
      "responsive_custom_1",
      "responsive_custom_2",
      "responsive_custom_3",
      "responsive_custom_4",
      "responsive_custom_5",
      "responsive_custom_6",
    ];
    expect(
      JSON.stringify(desktopTabs.order) === JSON.stringify(expectedOrder),
      "desktop Tab order follows the UI layout array order",
      desktopTabs,
    );
    expect(
      desktopTabs.focusStyles.every((item) => item.outlineStyle !== "none" && item.outlineWidth !== "0px"),
      "every keyboard-focused custom button has a visible focus ring",
      desktopTabs.focusStyles,
    );
    expect(
      desktop[0]?.imageState === "resolved" && desktop[0]?.ariaLabel === "响应按钮一",
      "background image does not replace the accessible label",
      desktop[0],
    );
    const desktopOverlaps = await visibleTitleButtonOverlaps(page);
    expect(
      desktopOverlaps.length === 0,
      "desktop authored title-button rects remain visually separated",
      desktopOverlaps,
    );
    await page.screenshot({ path: path.join(OUT, "01-desktop-layout-and-focus.png"), fullPage: true });

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => (
      document.querySelector('.ui-skin-scope[data-ui-screen="title"]')?.getAttribute("data-ui-breakpoint") === "mobile"
    ));
    await page.waitForTimeout(120);
    const mobileBreakpoint = await page.locator('.ui-skin-scope[data-ui-screen="title"]').getAttribute("data-ui-breakpoint");
    const mobile = await layoutSnapshot(page);
    expect(mobileBreakpoint === "mobile", "844x390 viewport selects mobile UI layout", mobileBreakpoint);
    expect(
      mobile[0]?.left === "5%" && mobile[0]?.top === "64%" && mobile[0]?.width === "27%" && mobile[0]?.height === "6%",
      "mobile viewport uses the custom button mobileRect",
      mobile[0],
    );
    expect(
      mobile.every((item) => item.actualHeight >= 41.9 && Number.parseFloat(item.minHeight) >= 42),
      "mobile custom buttons honor the runtime touch target minimum",
      mobile,
    );
    expect(
      mobile.every((item) => item.actualWidth >= 42 && Number.parseFloat(item.minWidth) >= 42),
      "mobile custom buttons retain a minimum touch width",
      mobile,
    );
    const mobileTabs = await collectCustomTabOrder(page);
    expect(
      JSON.stringify(mobileTabs.order) === JSON.stringify(expectedOrder),
      "mobile Tab order remains stable and excludes the hidden button",
      mobileTabs,
    );
    expect(
      mobileTabs.focusStyles.every((item) => item.outlineStyle !== "none" && item.outlineWidth !== "0px"),
      "mobile keyboard focus remains visibly indicated",
      mobileTabs.focusStyles,
    );
    const mobileOverlaps = await visibleTitleButtonOverlaps(page);
    expect(
      mobileOverlaps.length === 0,
      "mobile authored title-button rects remain visually separated after touch minimums apply",
      mobileOverlaps,
    );
    await page.screenshot({ path: path.join(OUT, "02-mobile-layout-touch-targets.png"), fullPage: true });

    expect(consoleErrors.length === 0, "browser console remains free of errors", consoleErrors);
    expect(pageErrors.length === 0, "browser page-error stream remains clean", pageErrors);
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
