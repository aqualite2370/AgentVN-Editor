#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const root = path.resolve(__dirname, ".."), port = Number(process.env.RENPY_TEST_PORT || 6894);
const output = process.env.AGENTVN_QA_OUTPUT
  ? path.resolve(process.env.AGENTVN_QA_OUTPUT)
  : path.join(root, "output/playwright/renpy-title", new Date().toISOString().replace(/[:.]/g, "-"));
assert(!fs.existsSync(output), `Preserve prior evidence: ${output}`);
const report = { status: "RUNNING", cases: [] };
const mod = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts",
    contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin"; export { assistantCreationDefaultRect } from "./editor/src/assistant/creationPlacement";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(mod, mod.exports);
function fixture(renpy = true) {
  const uiSkin = renpy ? mod.exports.createRenpyUILayout() : mod.exports.getDefaultUISkinLayout();
  if (renpy) {
    const title = uiSkin.screens.find((screen) => screen.screen_id === "title");
    title.components.push({
      component_id: "qa_generated_title_component",
      component_type: "custom_component",
      label: "创作组件",
      rect: mod.exports.assistantCreationDefaultRect(0, 1, "title"),
      mobileRect: mod.exports.assistantCreationDefaultRect(0, 1, "title"),
      zIndex: 80,
      customComponent: {
        schemaVersion: 1,
        root: {
          tag: "div",
          className: "root",
          children: [{
            tag: "button",
            className: "button",
            ariaLabel: "打开关于",
            action: "open_about",
            text: "关于",
            children: [],
          }],
        },
        styles: {
          ".root": { display: "flex", "align-items": "center", "justify-content": "center", padding: "8px" },
          ".button": { display: "block", color: "#ffffff", "background-color": "#1c1c1c", padding: "8px 12px", "border-radius": "2px" },
        },
      },
    });
  }
  return {
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: renpy ? "0.8.0" : "0.2.0",
      game_id: "renpy-title-acceptance", title: "隐忍的成长 · 界面夹具", author: "QA", version: "1.0.0",
      language: "zh-CN", entry_script: "script.json", entry_scene_id: "main",
      shell: { background: "title-art", background_fit: "contain", title_background_dimming: 0.25 },
      assets: [{ asset_id: "title-art", asset_type: "background", path: "assets/title.svg",
        filename: "title.svg", mime_type: "image/svg+xml", size_bytes: 1, preload: true }],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    script: { schema_version: "1.1.0", game_id: "renpy-title-acceptance", title: "界面夹具", entry_scene_id: "main",
      characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "标题页点击后，进入真实 Runtime 剧情。" }] }] },
    uiSkin,
    assetUrls: { "title-art": "data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#16303a"/></svg>') },
  };
}
async function ready(url) {
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error("Runtime server timed out");
}
async function initialize(page, renpy = true) {
  await page.goto(`http://127.0.0.1:${port}/?mode=preview`);
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
  await page.evaluate((payload) => {
    window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
      sessionId: `renpy-${Date.now()}`, revision: 1, requestId: "title", runId: "title",
      ...payload, screen: "title_menu" }, "*");
  }, fixture(renpy));
  await page.locator('[data-testid="game-state-title"]').waitFor();
}
async function geometry(page) {
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
  const data = await page.locator('[data-testid="renpy-title-view"]').evaluate((view) => {
    const bounds = view.getBoundingClientRect().toJSON();
    const actions = [...view.querySelectorAll("button")].map((button) => {
      const r = button.getBoundingClientRect(), c = getComputedStyle(button);
      return { testId: button.dataset.testid, text: button.textContent, rect: r.toJSON(), clipped: button.scrollWidth > button.clientWidth + 1,
        hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        color: c.color, background: c.backgroundColor };
    });
    return { bounds, actions, overflow: document.documentElement.scrollWidth - innerWidth,
      scroll: view.scrollHeight - view.clientHeight };
  });
  assert(data.overflow <= 1 && data.scroll <= 1, "标题页出现溢出或内部裁切");
  for (const a of data.actions) {
    assert(a.rect.width > 0 && a.rect.height > 0 && a.hit && !a.clipped, `按钮不可点击/裁切: ${a.text}`);
    assert(a.rect.left >= data.bounds.left - 1 && a.rect.right <= data.bounds.right + 1
      && a.rect.top >= data.bounds.top - 1 && a.rect.bottom <= data.bounds.bottom + 1, `越界: ${a.text}`);
  }
  for (let i = 1; i < data.actions.length; i++)
    assert(data.actions[i].rect.top >= data.actions[i - 1].rect.bottom - 1, "标题按钮重叠");
  return data;
}
async function assertGeneratedComponentClearance(page) {
  const result = await page.evaluate(() => {
    const component = document.querySelector('[data-component-id="qa_generated_title_component"]');
    const navigation = document.querySelector('[data-testid="main-menu-actions"]');
    const componentButton = component?.querySelector("button");
    if (!component || !navigation || !componentButton) return { present: false };
    const rect = (node) => node.getBoundingClientRect().toJSON();
    const overlaps = (left, right) => Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
      * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    const componentRect = rect(component);
    const actionRects = [...navigation.querySelectorAll("button")].map(rect);
    return {
      present: true,
      componentRect,
      componentButtonRect: rect(componentButton),
      actionRects,
      overlaps: actionRects.map((action) => overlaps(componentRect, action)),
      componentButtonHit: document.elementFromPoint(
        componentButton.getBoundingClientRect().x + componentButton.getBoundingClientRect().width / 2,
        componentButton.getBoundingClientRect().y + componentButton.getBoundingClientRect().height / 2,
      ) === componentButton,
    };
  });
  assert(result.present, "标题页必须渲染创造模式生成的自定义组件");
  assert(result.overlaps.every((value) => value <= 1),
    `生成组件不得遮挡 Ren’Py 标题导航：${JSON.stringify(result)}`);
  assert(result.componentButtonHit, `生成组件内部按钮必须真实可点击：${JSON.stringify(result)}`);
  return result;
}
(async () => {
  await new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject);
    s.listen(port, "127.0.0.1", () => s.close(resolve));
  });
  fs.mkdirSync(output, { recursive: true });
  const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "vite.config.cjs",
    "--configLoader", "native", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: path.join(root, "GameCli_framework"), windowsHide: true, stdio: "pipe" });
  const log = fs.createWriteStream(path.join(output, "server.log"));
  server.stdout.pipe(log); server.stderr.pipe(log);
  let browser, page;
  try {
    await ready(`http://127.0.0.1:${port}`);
    browser = await chromium.launch();
    const viewports = [[1920,1080],[2560,1440],[3840,2160],[1920,864],[1440,900],[1356,610],[915,412],[757,299],[640,360],[390,844]];
    const selectedViewports = process.env.RENPY_TITLE_FAST === "1"
      ? viewports.slice(0, 1)
      : process.env.RENPY_TITLE_MAIN_MATRIX === "1"
        ? viewports.slice(0, 3)
        : viewports;
    for (const [width, height] of selectedViewports) {
      page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(process.env.PROFILE_DPR || 1),
        hasTouch: width <= 915 });
      const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
      await initialize(page);
      await page.locator('[data-testid="renpy-title-view"]').waitFor({ timeout: 5000 });
      const background = await page.locator(".renpy-title-background img").evaluate((img) => ({
        fit: getComputedStyle(img).objectFit,
        dimming: getComputedStyle(img.closest(".renpy-title-background"), "::after").backgroundColor,
      }));
      assert.equal(background.fit, "contain", "标题背景必须沿用工程的适应方式");
      assert.equal(background.dimming, "rgba(0, 0, 0, 0.25)", "标题背景必须沿用工程压暗");
      assert.equal(await page.locator('[data-testid="open-gallery"]').count(), 0, "无内容时不显示空画廊");
      const before = await geometry(page);
      const generated = await assertGeneratedComponentClearance(page);
      await page.locator('[data-component-id="qa_generated_title_component"] button').click();
      await page.locator('[data-ui-screen="about"]').waitFor();
      await page.keyboard.press("Escape");
      await page.getByTestId("renpy-title-view").waitFor();
      const settings = page.getByTestId("open-settings");
      await settings.focus();
      await page.waitForFunction((idle) => {
        const button = document.querySelector('[data-testid="open-settings"]');
        return button === document.activeElement && getComputedStyle(button).color !== idle;
      }, before.actions.find((a) => a.testId === "open-settings").color);
      const focusColor = await settings.evaluate((e) => getComputedStyle(e).color);
      assert.notEqual(focusColor, before.actions.find((a) => a.testId === "open-settings").color, "焦点态未区分");
      await settings.click();
      await page.locator('[data-ui-screen="preferences"]').waitFor();
      await page.keyboard.press("Escape");
      await page.getByTestId("renpy-title-view").waitFor();
      await page.getByTestId("open-about").click();
      await page.locator('[data-ui-screen="about"]').waitFor();
      await page.keyboard.press("Escape");
      await page.getByTestId("renpy-title-view").waitFor();
      await page.getByTestId("open-save-load").click();
      await page.locator('[data-ui-screen="save_load"]').waitFor();
      await page.keyboard.press("Escape");
      await page.getByTestId("renpy-title-view").waitFor();
      await geometry(page);
      await page.mouse.move(0,0);
      await page.screenshot({ path: path.join(output, `${width}x${height}.png`) });
      await page.getByTestId("start-new-game").click();
      await page.locator('[data-ui-screen="player"]').waitFor();
      const renpyDialog = page.locator(".dialog-box");
      await renpyDialog.waitFor();
      assert.equal(await renpyDialog.getAttribute("data-runtime-layout-type"), "renpy",
        "Ren’Py 剧情对白必须带有布局类型标识");
      assert.equal(await renpyDialog.getAttribute("data-dialog-presentation"), "renpy",
        "Ren’Py 普通对白必须切换专用呈现");
      await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
        ?.getAttribute("data-runtime-screen-transition") === "idle");
      const dialogRect = await renpyDialog.evaluate((node) => node.getBoundingClientRect().toJSON());
      const frameRect = await page.locator('[data-ui-screen="player"] .runtime-layout-frame')
        .evaluate((node) => node.getBoundingClientRect().toJSON());
      assert(dialogRect && frameRect && dialogRect.bottom <= frameRect.bottom + 1
        && dialogRect.top >= frameRect.top - 1 && dialogRect.left >= frameRect.left - 1
        && dialogRect.right <= frameRect.right + 1,
      `Ren’Py 对白框必须留在 Runtime 画面内: ${JSON.stringify({ dialogRect, frameRect })}`);
      assert.equal(await renpyDialog.evaluate((node) => getComputedStyle(node).borderRadius), "0px",
        "Ren’Py 默认对白框不应沿用 AgentVN 圆角卡片");
      await page.screenshot({ path: path.join(output, `${width}x${height}-dialog.png`) });
      assert.deepEqual(errors, []);
      report.cases.push({ width, height, status: "PASS", geometry: before, generated, dialogRect, frameRect });
      await initialize(page, false);
      assert.equal(await page.getByTestId("renpy-title-view").count(), 0, "AgentVN 不得使用 Ren’Py 页面");
      await page.close(); page = null;
      console.log(`PASS title/dialog ${width}x${height} DPR=${process.env.PROFILE_DPR || 1}`);
    }
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    if (server.pid) spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
