#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { waitForAsyncFunction } = require("./lib/async-readiness.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT
  ? path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT)
  : path.join(root, "output/playwright/renpy-button-frame", runId);
const report = { runId, status: "RUNNING", cases: [], screenshots: [],
  scope: "SOURCE_RUNTIME_BUTTON_REGRESSION_NOT_NATIVE_OR_INSTALLED_ACCEPTANCE" };
const api = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts",
    contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(api, api.exports);
const colors = { normal: "#224466", hover: "#446688", selected: "#6688aa", disabled: "#8899aa" };
const borderValues = [8, 10, 12, 6];

function fixture(mode) {
  const skin = api.exports.createRenpyUILayout();
  skin.renpy = mode === "default-theme" ? undefined : { shared: {
    buttonImages: Object.fromEntries(Object.keys(colors).map(state => [state, `asset:${state}`])),
    ...(mode.includes("frame") ? { buttonBorders: { left: 6, top: 8, right: 10, bottom: 12 } } : {}),
    ...(mode.startsWith("tiled") ? { buttonTile: true } : {}),
  } };
  return {
    manifest: {
      manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.12.0",
      game_id: `button-frame-${mode}`, title: "九宫格按钮交互", author: "QA", version: "1.0.0",
      language: "zh-CN", entry_script: "script.json", entry_scene_id: "main",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      assets: Object.keys(colors).map(asset_id => ({
        asset_id, asset_type: "ui", path: `assets/${asset_id}.svg`, filename: `${asset_id}.svg`,
        mime_type: "image/svg+xml", size_bytes: 100, preload: true,
      })),
    },
    script: {
      schema_version: "1.1.0", game_id: `button-frame-${mode}`, title: "按钮交互", entry_scene_id: "main",
      characters: [], scenes: [
        { scene_id: "main", title: "Main", chapter: 1, tags: [],
          commands: [{ type: "choice", choices: [
            { choice_id: "left", text: "左侧选择", target_scene_id: "left", conditions: [] },
            { choice_id: "right", text: "右侧选择", target_scene_id: "right", conditions: [] },
          ] }] },
        ...["left", "right"].map(id => ({ scene_id: id, title: id, chapter: 1, tags: [],
          commands: [{ type: "narration", text: `${id} 分支已进入` }] })),
      ],
    },
    uiSkin: skin,
    assetUrls: Object.fromEntries(Object.entries(colors).map(([state, color]) => [
      state, "data:image/svg+xml," + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40"><rect width="64" height="40" fill="${color}"/><rect width="6" height="8" fill="#dd5500"/></svg>`),
    ])),
  };
}

async function settle(page) {
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
  await page.waitForFunction(() => !document.querySelector(".game-launch-blackout"));
}

async function waitForStableTitleGeometry(page) {
  await waitForAsyncFunction(page, async () => {
    const read = () => {
      const title = document.querySelector('[data-testid="renpy-title-view"]');
      const button = document.querySelector('[data-testid="start-new-game"]');
      if (!title || !button) return "";
      const titleRect = title.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      return [
        title.dataset.renpyScale,
        titleRect.x, titleRect.y, titleRect.width, titleRect.height,
        buttonRect.x, buttonRect.y, buttonRect.width, buttonRect.height,
      ].join("|");
    };
    const before = read();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return before !== "" && before === read();
  });
}

async function inspectDefaultThemeButton(button, label) {
  await button.page().evaluate(() => document.activeElement?.blur?.());
  await button.evaluate(async node => {
    await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const before = await button.evaluate(node => {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      borderWidth: style.borderTopWidth,
      borderStyle: style.borderTopStyle,
      borderColor: style.borderTopColor,
      backgroundColor: style.backgroundColor,
      color: style.color,
      shadow: style.boxShadow,
      radius: style.borderTopLeftRadius,
      hit: node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
    };
  });
  assert(before.hit, `${label} 默认状态必须真实可点击`);
  assert.equal(before.borderWidth, "0px", `${label} 默认文字按钮不应附加边框`);
  assert.equal(before.shadow, "none", `${label} 默认文字按钮不应附加内阴影`);
  assert.equal(before.radius, "0px", `${label} 默认按钮不应呈胶囊圆角`);
  assert.equal(before.backgroundColor, "rgba(0, 0, 0, 0)", `${label} 默认文字按钮应保持透明底色`);

  const hoverTarget = await button.boundingBox();
  assert(hoverTarget, `${label} 必须具有可命中的真实几何`);
  await button.page().mouse.move(
    hoverTarget.x + hoverTarget.width / 2,
    hoverTarget.y + hoverTarget.height / 2,
  );
  await button.evaluate(async node => {
    await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const hovered = await button.evaluate(node => {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      borderColor: style.borderTopColor,
      backgroundColor: style.backgroundColor,
      color: style.color,
    };
  });
  assert.deepEqual(hovered.rect, before.rect, `${label} hover 状态不能改变按钮几何`);
  assert.notEqual(hovered.color, before.color, `${label} hover 状态必须有可辨文字反馈`);
  assert.equal(hovered.backgroundColor, before.backgroundColor, `${label} hover 不应引入额外底色`);
  return { before, hovered };
}

async function inspect(button, mode, state, scale) {
  await button.evaluate(async node => {
    await Promise.all(node.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
  });
  const data = await button.evaluate(node => {
    const css = getComputedStyle(node), rect = node.getBoundingClientRect();
    const frame = node.closest(".runtime-layout-frame")?.getBoundingClientRect();
    return {
      rect: rect.toJSON(), frame: frame?.toJSON(),
      mode: node.getAttribute("data-renpy-button-frame"),
      borderImageSource: css.borderImageSource, borderImageWidth: css.borderImageWidth,
      borderImageSlice: css.borderImageSlice, borderImageRepeat: css.borderImageRepeat,
      backgroundImage: css.backgroundImage, backgroundSize: css.backgroundSize, backgroundRepeat: css.backgroundRepeat,
      borderWidths: [css.borderTopWidth, css.borderRightWidth, css.borderBottomWidth, css.borderLeftWidth],
      hit: node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
      interaction: { hovered: node.matches(":hover"), focused: node === document.activeElement,
        focusVisible: node.matches(":focus-visible"), selected: node.matches("[aria-current='page']"),
        disabled: node.disabled },
      clipped: node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  assert(data.frame && data.rect.width > 0 && data.rect.height > 0);
  assert(data.hit && !data.clipped && data.overflow <= 1, `按钮被裁切/挡住/溢出：${JSON.stringify(data)}`);
  assert(data.rect.left >= data.frame.left - 1 && data.rect.right <= data.frame.right + 1
    && data.rect.top >= data.frame.top - 1 && data.rect.bottom <= data.frame.bottom + 1,
  `按钮不在实际游戏帧内：${JSON.stringify(data)}`);
  const expectedImage = encodeURIComponent(colors[state]);
  if (mode.includes("frame")) {
    assert.equal(data.mode, "nine-slice");
    assert(data.borderImageSource.includes(expectedImage), `${state} 状态未使用对应九宫格资源: ${JSON.stringify(data)}`);
    assert.equal(data.backgroundImage, "none", "九宫格不能再叠加拉伸整图");
    assert.equal(data.borderImageSlice, "8 10 12 6 fill");
    assert.equal(data.borderImageRepeat, mode.startsWith("tiled") ? "repeat" : "stretch");
    const widths = data.borderImageWidth.split(/\s+/).map(parseFloat);
    assert.equal(widths.length, 4);
    for (let i = 0; i < 4; i++) {
      assert(Math.abs(widths[i] - borderValues[i] * scale) < .02,
        `绘制边缘宽度与实际页面缩放不一致：${JSON.stringify({ scale, ...data })}`);
      assert(Math.abs(parseFloat(data.borderWidths[i]) - widths[i]) < 1.1,
        "框架占用的布局边缘与绘制边缘必须一致（允许 CSS 像素舍入）");
    }
  } else {
    assert.equal(data.mode, null, "旧布局不能自动变成九宫格");
    assert.equal(data.borderImageSource, "none");
    assert(data.backgroundImage.includes(expectedImage), `${state} 状态背景图未显示`);
    assert.equal(data.backgroundRepeat, mode.startsWith("tiled") ? "repeat" : "no-repeat");
    assert.equal(data.backgroundSize, mode.startsWith("tiled") ? "auto" : "100% 100%");
  }
  return data;
}

(async () => {
  assert(!fs.existsSync(output), "Never overwrite previous button-frame evidence");
  fs.mkdirSync(output, { recursive: true });
  let server, browser, page;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "GameCli_framework"), configFile: path.join(root, "GameCli_framework/vite.config.cjs"),
      port: 0, logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch();
    const dpr = Number(process.env.PROFILE_DPR || 1);
    const defaultThemeCase = process.argv.includes("--case=default-theme");
    // 2026-10-10 user scope: three landscape desktop resolutions only.
    const viewports = [[1920, 1080], [2560, 1440], [3840, 2160]];
    for (const [width, height] of viewports) {
      page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr,
        hasTouch: width <= 915, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      const modes = defaultThemeCase
        ? ["default-theme"]
        : ["tiled-frame", "stretched-frame", "tiled-background", "legacy-background"];
      for (const mode of modes) {
        await server.run(async () => {
          await page.goto(`${server.url}/?mode=preview`);
          await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
          await page.evaluate(payload => window.postMessage({
            type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: `frames-${Date.now()}`,
            revision: 1, requestId: "frames", runId: "frames", screen: "title_menu", ...payload,
          }, "*"), fixture(mode));
          const title = page.getByTestId("renpy-title-view");
          await title.waitFor();
          await settle(page);
          await page.evaluate(() => document.activeElement?.blur?.());
          if (mode === "default-theme") await waitForStableTitleGeometry(page);
          await page.mouse.move(width - 2, height - 2);
          const scale = Number(await title.getAttribute("data-renpy-scale"));
          const observations = {};
          const titleButton = page.getByTestId("start-new-game");
          if (mode === "default-theme") {
            observations.title = await inspectDefaultThemeButton(titleButton, "标题页操作");
            await page.getByTestId("open-settings").click();
            await page.locator('[data-ui-screen="preferences"]').waitFor();
            await settle(page);
            assert.equal(await page.getByTestId("renpy-menu-navigation").getAttribute("aria-label"),
              "进阶页面导航", " Runtime 辅助页面导航的无障碍名称应使用产品类型名");
            observations.menu = await inspectDefaultThemeButton(
              page.getByTestId("renpy-menu-about"), "页面导航",
            );
            assert.deepEqual(errors, [], "默认按钮主题不得产生 Runtime 错误");
            report.cases.push({ width, height, dpr, mode, observations, status: "PASS" });
            fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
            return;
          }
          observations.title = await inspect(titleButton, mode, "normal", scale);
          await titleButton.focus();
          observations.titleFocus = await inspect(titleButton, mode, "hover", scale);
          await titleButton.evaluate(button => { button.disabled = true; });
          observations.titleDisabled = await inspect(titleButton, mode, "disabled", scale);
          await titleButton.evaluate(button => { button.disabled = false; });
          await page.getByTestId("open-settings").click();
          await page.locator('[data-ui-screen="preferences"]').waitFor();
          await settle(page);
          await page.mouse.move(width - 2, height - 2);
          await page.evaluate(() => document.activeElement?.blur?.());
          const menuScale = Number(await page.locator("[data-renpy-menu-frame]").getAttribute("data-renpy-menu-scale"));
          observations.menu = await inspect(page.getByTestId("renpy-menu-about"), mode, "normal", menuScale);
          observations.menuSelected = await inspect(page.getByTestId("renpy-menu-settings"), mode, "selected", menuScale);
          await page.getByTestId("renpy-menu-history").click();
          await page.locator('[data-ui-screen="history"]').waitFor();
          await settle(page);
          await page.getByTestId("renpy-menu-return").click();
          await title.waitFor();
          await settle(page);
          await titleButton.click();
          await page.getByRole("button", { name: "选择：左侧选择", exact: true }).waitFor();
          await settle(page);
          assert.equal(await page.getByTestId("renpy-quick-bar").getAttribute("aria-label"),
            "进阶快捷栏", "剧情快捷栏的无障碍名称应使用产品类型名");
          await page.mouse.move(width - 2, height - 2);
          await page.evaluate(() => document.activeElement?.blur?.());
          const scopeScale = await page.locator('[data-ui-screen="player"]').evaluate(node =>
            parseFloat(getComputedStyle(node).getPropertyValue("--runtime-ui-scale")) || 1);
          const choice = page.getByRole("button", { name: "选择：左侧选择", exact: true });
          observations.choice = await inspect(choice, mode, "normal", scopeScale);
          await choice.click();
          await page.waitForFunction(() => document.querySelector('[data-testid="game-state-playing"]')
            ?.getAttribute("data-current-scene-id") === "left");
          await page.getByRole("group", { name: "剧情选项" }).waitFor({ state: "hidden" });
          assert.equal(await page.getByRole("group", { name: "剧情选项" }).count(), 0,
            "点击选项必须进入对应分支并移除旧选项，不得只响应视觉按压");
          assert.deepEqual(errors, [], "界面不得产生未处理 Runtime 错误");
          report.cases.push({ width, height, dpr, mode, observations, status: "PASS" });
          fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
        });
      }
      report.screenshots.push(await captureSourceBrowser(page,
        path.join(output, `${width}x${height}-dpr${dpr}.png`),
        { width, height, dpr, reduced: true }));
      await page.close();
      page = undefined;
      console.log(`PASS button frames ${width}x${height} DPR=${dpr}`);
    }
    assert.equal(report.cases.length, viewports.length * (defaultThemeCase ? 1 : 4), "拒绝空矩阵或遗漏组合通过");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    try {
      await browser?.close();
      await server?.stop();
      report.cleanup = { browserClosed: true, ownedServiceStopped: true };
    } catch (error) {
      report.cleanup = { status: "FAILED", error: String(error) };
      report.status = "FAILED"; process.exitCode = 1;
    }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
    if (report.error) console.error(report.error);
  }
})();
