#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/playwright/renpy-page-button-chrome",
  new Date().toISOString().replace(/[:.]/g, "-"));
const report = { status: "RUNNING", productLayer: "GameCLI Runtime", cases: [] };
const reducedMotion = process.env.RENPY_CHROME_REDUCED === "1" ? "reduce" : "no-preference";
report.reducedMotion = reducedMotion;
report.isolation = "Synthetic in-memory cartridge, fresh browser contexts, owned Vite; no user project";
const compiled = { exports: {} };
new Function("module", "exports", buildSync({
  stdin: {
    resolveDir: root,
    loader: "ts",
    contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";',
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
}).outputFiles[0].text)(compiled, compiled.exports);

function fixture(renpy = true) {
  const uiSkin = renpy ? compiled.exports.createRenpyUILayout() : undefined;
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.9.0",
      game_id: "renpy-page-button-chrome",
      title: "Runtime按钮样式验收",
      author: "QA",
      version: "1.0.0",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "main",
      assets: [{
        asset_id: "gallery-art",
        asset_type: "ui",
        path: "assets/gallery.svg",
        filename: "gallery.svg",
        mime_type: "image/svg+xml",
        size_bytes: 100,
        preload: false,
      }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    script: {
      schema_version: "1.1.0",
      game_id: "renpy-page-button-chrome",
      title: "Runtime按钮样式验收",
      entry_scene_id: "main",
      characters: [{ character_id: "palette-speaker", name: "示例角色" }],
      scenes: [{
        scene_id: "main",
        title: "Main",
        chapter: 1,
        tags: [],
        commands: [
          { type: "gallery_anchor", anchor_id: "gallery-entry", title: "验收画廊",
            asset_id: "gallery-art", description: "生成可从真实菜单进入的画廊项目。" },
          { type: "dialog", character_id: "palette-speaker", text: "样式验收剧情。" },
          { type: "choice", choices: [
            { choice_id: "left", text: "继续左侧故事", target_scene_id: "left", conditions: [] },
            { choice_id: "right", text: "继续右侧故事", target_scene_id: "right", conditions: [],
              button_style: { backgroundColor: "#223344", color: "#ffffff",
                borderColor: "#55aacc", borderWidth: 2, borderRadius: 0, shadow: "none" } },
          ] },
        ],
      },
        { scene_id: "left", title: "Left", chapter: 1, tags: [],
          commands: [{ type: "narration", text: "左侧分支已进入。" }] },
        { scene_id: "right", title: "Right", chapter: 1, tags: [],
          commands: [{ type: "narration", text: "右侧分支已进入。" }] },
      ],
    },
    uiSkin,
    assetUrls: {
      "gallery-art": "data:image/svg+xml," + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#31506b"/></svg>'),
    },
  };
}

async function idle(page) {
  await page.waitForFunction(() =>
    document.querySelector("[data-runtime-transition-phase]")?.getAttribute("data-runtime-transition-phase") === "idle");
}

async function inspectButtons(locator) {
  return locator.evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return {
      label: button.textContent?.trim(),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      borderWidth: style.borderTopWidth,
      borderStyle: style.borderTopStyle,
      borderColor: style.borderTopColor,
      radius: style.borderRadius,
      background: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      shadow: style.boxShadow,
      color: style.color,
      textDecoration: style.textDecorationLine,
      textDecorationStyle: style.textDecorationStyle,
      renpyDefaultTextChoice: button.getAttribute("data-renpy-default-text-choice"),
      renpyRoleCustom: button.getAttribute("data-renpy-role-custom"),
      hit: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
      clipped: button.scrollWidth > button.clientWidth + 1,
      inViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
    };
  }));
}

async function settle(locator) {
  await locator.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
}

function assertNoButtonChrome(buttons, context) {
  assert(buttons.length > 0, `${context}必须有实际按钮`);
  for (const button of buttons) {
    assert(button.hit && !button.clipped, `${context}/${button.label}不可点击或文字被裁切`);
    assert(button.inViewport, `${context}/${button.label}超出视口`);
    assert.equal(parseFloat(button.borderWidth), 0,
      `${context}/${button.label}默认态仍有容器边框：${JSON.stringify(button)}`);
    assert.equal(button.background, "rgba(0, 0, 0, 0)", `${context}/${button.label}默认态仍有容器底色`);
    assert.equal(button.backgroundImage, "none", `${context}/${button.label}默认态仍有背景图容器`);
    assert.equal(button.shadow, "none", `${context}/${button.label}默认态仍有容器阴影`);
  }
}

async function enterPage(page, testId, screen) {
  await page.getByTestId(testId).click();
  await page.locator(`.runtime-screen-transition-current [data-ui-screen="${screen}"]`).waitFor();
  await idle(page);
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  let server;
  let browser;
  let page;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"),
      port: 0,
      logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch({ headless: true });
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
      for (const dpr of [1, 2]) {
        page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion });
        const errors = [];
        page.on("pageerror", error => errors.push(String(error)));
        await page.goto(`${server.url}/?mode=preview`);
        await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
        await page.evaluate(payload => window.postMessage({
          type: "agentvn.live-preview.init",
          protocolVersion: 2,
          sessionId: `page-button-${Date.now()}`,
          revision: 1,
          requestId: "page-button-init",
          runId: "page-button-init",
          screen: "title_menu",
          ...payload,
        }, "*"), fixture());
        await page.getByTestId("game-state-title").waitFor();
        await idle(page);
        await page.getByTestId("open-settings").click();
        await page.locator('.runtime-screen-transition-current [data-ui-screen="preferences"]').waitFor();
        await idle(page);

        const palette = await page.locator('.runtime-screen-transition-current .ui-skin-scope').evaluate(scope => {
          const style = getComputedStyle(scope);
          const read = name => style.getPropertyValue(name).trim();
          return { background: read("--bg"), surface: read("--surface"),
            ink: read("--ink"), accent: read("--accent"), accent2: read("--accent-2"),
            panel: read("--runtime-panel"), dialogText: read("--runtime-dialog-text") };
        });
        assert.equal(palette.background, "#111111", "进阶背景必须使用灰阶默认色");
        assert.equal(palette.ink, "#ffffff", "进阶正文必须使用默认白色");
        assert.equal(palette.accent, "#00b8c3", "进阶强调色必须使用模板青色");
        assert.equal(palette.accent2, "#00b8c3", "进阶副强调色不得继承 AgentVN 粉色");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
          "配色修正不得引起页面横向溢出");
        if (width === 1920 && dpr === 1) await page.screenshot({ path: path.join(output, "settings.png") });

        const settings = page.locator(".settings-screen");
        const categoryButtons = settings.locator(".settings-tabs button");
        await page.mouse.move(width - 2, height - 2);
        const categoryNormal = await inspectButtons(categoryButtons);
        assertNoButtonChrome(categoryNormal, "选项分类");
        const category = categoryButtons.nth(1);
        const categoryInitialColor = categoryNormal[1].color;
        await category.click();
        await page.waitForFunction(() => document.querySelector(".settings-tabs button.is-active")
          ?.textContent?.includes("文字"));
        await settle(category);
        const selected = await category.evaluate(button => {
          const style = getComputedStyle(button);
          const rect = button.getBoundingClientRect();
          return {
            color: style.color,
            decoration: style.textDecorationLine,
            background: style.backgroundColor,
            borderWidth: style.borderTopWidth,
            shadow: style.boxShadow,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        });
        assert.equal(parseFloat(selected.borderWidth), 0, "选中分类不可恢复容器边框");
        assert.equal(selected.background, "rgba(0, 0, 0, 0)", "选中分类不可恢复容器底色");
        assert.equal(selected.shadow, "none", "选中分类不可显示容器光晕");
        assert.notEqual(selected.color, categoryInitialColor, "选中分类需要明确的文字状态反馈");
        const categoryAfterSelect = await inspectButtons(categoryButtons);
        assert(categoryNormal.every((button, index) => {
          const next = categoryAfterSelect[index].rect;
          return Math.abs(button.rect.x - next.x) < 0.1 && Math.abs(button.rect.y - next.y) < 0.1
            && Math.abs(button.rect.width - next.width) < 0.1
            && Math.abs(button.rect.height - next.height) < 0.1;
        }), "选中状态不得改变按钮几何");

        const hoveredCategory = categoryButtons.nth(2);
        await hoveredCategory.hover();
        await settle(hoveredCategory);
        const hovered = await hoveredCategory.evaluate(button => {
          const style = getComputedStyle(button);
          const rect = button.getBoundingClientRect();
          return { color: style.color, background: style.backgroundColor,
            borderWidth: style.borderTopWidth, shadow: style.boxShadow,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
        });
        assert.notEqual(hovered.color, categoryAfterSelect[2].color, "悬停必须提供非容器式文字反馈");
        assert.equal(hovered.background, "rgba(0, 0, 0, 0)", "悬停不可恢复容器底色");
        assert.equal(parseFloat(hovered.borderWidth), 0, "悬停不可恢复容器边框");
        assert.equal(hovered.shadow, "none", "悬停不可恢复容器光晕");
        assert.deepEqual(hovered.rect, categoryAfterSelect[2].rect, "悬停不得改变按钮几何");

        await category.focus();
        await page.keyboard.press("Tab");
        await page.evaluate(async () => {
          const element = document.activeElement;
          if (element) await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
        });
        const focused = await page.evaluate(() => {
          const button = document.activeElement;
          if (!(button instanceof HTMLButtonElement)) return null;
          const style = getComputedStyle(button);
          return { visible: button.matches(":focus-visible"), color: style.color,
            decoration: style.textDecorationLine, background: style.backgroundColor,
            borderWidth: style.borderTopWidth, shadow: style.boxShadow };
        });
        assert(focused?.visible, "键盘焦点必须可见");
        assert(focused.decoration.includes("underline"), "键盘焦点必须有文字下划线指示");
        assert.equal(focused.background, "rgba(0, 0, 0, 0)", "键盘焦点不可恢复容器底色");
        assert.equal(parseFloat(focused.borderWidth), 0, "键盘焦点不可恢复容器边框");
        assert.equal(focused.shadow, "none", "键盘焦点不可恢复容器光晕");

        const footerButtons = await inspectButtons(settings.locator(".settings-footer button"));
        assertNoButtonChrome(footerButtons, "选项底部操作");

        await page.getByTestId("renpy-menu-history").click();
        await page.locator('.runtime-screen-transition-current [data-ui-screen="history"]').waitFor();
        await idle(page);
        // Ren'Py pages intentionally use the shared bottom return action;
        // the legacy header back control remains mounted but is hidden.
        const historyBack = await inspectButtons(page.getByTestId("renpy-menu-return"));
        assertNoButtonChrome(historyBack, "历史页返回");

        await enterPage(page, "renpy-menu-help", "help");
        const helpBack = await inspectButtons(page.getByTestId("renpy-menu-return"));
        assertNoButtonChrome(helpBack, "帮助页返回");

        await enterPage(page, "renpy-menu-about", "about");
        const aboutBack = await inspectButtons(page.getByTestId("renpy-menu-return"));
        assertNoButtonChrome(aboutBack, "关于页返回");

        await enterPage(page, "renpy-menu-gallery", "gallery");
        const galleryBack = await inspectButtons(page.getByTestId("renpy-menu-return"));
        assertNoButtonChrome(galleryBack, "画廊页返回");

        await enterPage(page, "renpy-menu-save-load", "save_load");
        const saveCard = await page.locator(".save-slot").first().evaluate(card => {
          const style = getComputedStyle(card);
          return { background: style.backgroundColor, image: style.backgroundImage,
            border: style.borderTopWidth, rect: card.getBoundingClientRect().toJSON() };
        });
        assert(saveCard.rect.width > 0 && saveCard.rect.height > 0, "存档卡片必须保留可见布局");
        assert(saveCard.background !== "rgba(0, 0, 0, 0)" || saveCard.image !== "none",
          "存档页卡片容器是明确例外，不得被全局文字按钮规则抹除");

        await page.getByTestId("renpy-menu-return").click();
        await page.getByTestId("renpy-title-view").waitFor();
        await idle(page);
        await page.getByTestId("start-new-game").click();
        await page.getByTestId("game-state-playing").waitFor();
        await page.waitForSelector(".game-launch-blackout", { state: "detached" });
        const dialoguePalette = await page.locator(".dialog-box").evaluate(dialog => {
          const speaker = dialog.querySelector(".speaker"), text = dialog.querySelector(".dialog-text");
          return { background: getComputedStyle(dialog).backgroundColor,
            speakerBackground: speaker && getComputedStyle(speaker).backgroundColor,
            speakerColor: speaker && getComputedStyle(speaker).color,
            text: text && getComputedStyle(text).color };
        });
        assert.equal(dialoguePalette.text, "rgb(255, 255, 255)", "对白正文不得遗留蓝白色覆盖");
        assert.equal(dialoguePalette.speakerColor, "rgb(255, 255, 255)", "姓名文字不得遗留 AgentVN 蓝色");
        assert.equal(dialoguePalette.speakerBackground, "rgba(28, 28, 28, 0.78)", "姓名表面必须与默认灰阶一致");
        if (width === 1920 && dpr === 1) await page.screenshot({ path: path.join(output, "dialogue.png") });
        await page.keyboard.press("Space");
        await page.getByRole("group", { name: "剧情选项" }).waitFor();
        const choices = page.getByRole("group", { name: "剧情选项" })
          .getByRole("button", { name: "选择：继续左侧故事", exact: true });
        const authoredChoice = page.getByRole("group", { name: "剧情选项" })
          .getByRole("button", { name: "选择：继续右侧故事", exact: true });
        await choices.waitFor();
        await page.waitForFunction(reduced => {
          const button = document.querySelector('.choice-panel button[aria-label="选择：继续左侧故事"]');
          return button && !button.disabled && !button.closest(".choice-panel.is-entering")
            && (reduced || button.classList.contains("runtime-animation-settled"));
        }, reducedMotion === "reduce");
        await page.mouse.move(width - 2, height - 2);
        const choiceNormal = await inspectButtons(choices);
        assertNoButtonChrome(choiceNormal, "剧情分支选项");
        const authoredAppearance = await authoredChoice.evaluate(button => {
          const style = getComputedStyle(button);
          const scope = button.closest(".ui-skin-scope");
          return { marker: button.getAttribute("data-renpy-default-text-choice"),
            frame: button.getAttribute("data-renpy-button-frame"),
            background: style.backgroundColor, borderWidth: style.borderTopWidth,
            runtimeScale: Number.parseFloat(getComputedStyle(scope).getPropertyValue("--runtime-ui-scale")) || 1,
            inlineBorderWidth: button.style.borderTopWidth,
            inlineBorder: button.style.border,
            sharedBorderWidth: style.getPropertyValue("--renpy-button-border-width").trim(),
            roleBordered: button.getAttribute("data-renpy-role-bordered"),
            borderColor: style.borderTopColor, radius: style.borderTopLeftRadius };
        });
        assert.equal(authoredAppearance.marker, null, "单项显式按钮样式不得套用默认文字规则");
        assert.equal(authoredAppearance.background, "rgb(34, 51, 68)", "单项自定义背景必须保留");
        const authoredColor = await authoredChoice.evaluate(button => getComputedStyle(button).color);
        assert.equal(authoredColor, "rgb(255, 255, 255)", "单项作者文字颜色不能被共享导航灰色覆盖");
        assert(Math.abs(parseFloat(authoredAppearance.inlineBorderWidth) - 2 * authoredAppearance.runtimeScale) < 0.01,
          `单项自定义边框逻辑值必须按 Runtime 比例传递: ${JSON.stringify(authoredAppearance)}`);
        assert(parseFloat(authoredAppearance.borderWidth) > 0,
          `单项自定义边框必须保留画布缩放后的作者值: ${JSON.stringify(authoredAppearance)}`);
        assert.equal(authoredAppearance.borderColor, "rgb(85, 170, 204)", "单项边框颜色必须保留");
        await choices.hover();
        await settle(choices);
        const choiceHover = (await inspectButtons(choices))[0];
        assert.notEqual(choiceHover.color, choiceNormal[0].color, "剧情选项悬停必须有主题文字反馈");
        assert(choiceHover.textDecoration.includes("underline"), "剧情选项悬停必须有文字式状态指示");
        assert.equal(choiceHover.background, "rgba(0, 0, 0, 0)", "剧情选项悬停不得增加容器底色");
        assert.equal(choiceHover.shadow, "none", "剧情选项悬停不得增加容器阴影");
        assert.deepEqual(choiceHover.rect, choiceNormal[0].rect, "剧情选项悬停不得改变几何");
        await choices.focus();
        const choiceFocus = await choices.evaluate(button => ({
          visible: button.matches(":focus-visible"),
          decoration: getComputedStyle(button).textDecorationLine,
          style: getComputedStyle(button).textDecorationStyle,
        }));
        assert(choiceFocus.visible && choiceFocus.decoration.includes("underline")
          && choiceFocus.style === "double", "剧情选项键盘焦点必须有独立的双线文字指示");
        await choices.click();
        await page.waitForFunction(() => document.querySelector('[data-testid="game-state-playing"]')
          ?.getAttribute("data-current-scene-id") === "left");
        assert.deepEqual(errors, []);
        report.cases.push({
          width,
          height,
          dpr,
          status: "PASS",
          palette,
          dialoguePalette,
          categoryNormal,
          selectedCategory: selected,
          hoveredCategory: hovered,
          keyboardFocus: focused,
          footerButtons,
          historyBack,
          helpBack,
          aboutBack,
          galleryBack,
          saveCard,
          choiceNormal,
          authoredAppearance,
          choiceHover,
          choiceFocus,
        });
        await page.screenshot({ path: path.join(output, `${width}x${height}-dpr${dpr}.png`) });
        await page.close();
        page = undefined;
      }
    }
    assert.equal(report.cases.length, 6);

    page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion });
    await page.goto(`${server.url}/?mode=preview`);
    await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
    await page.evaluate(payload => window.postMessage({
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: `agentvn-choice-${Date.now()}`,
      revision: 1,
      requestId: "agentvn-choice-init",
      runId: "agentvn-choice-init",
      screen: "title_menu",
      ...payload,
    }, "*"), fixture(false));
    await page.getByTestId("game-state-title").waitFor();
    await idle(page);
    await page.getByTestId("start-new-game").click();
    await page.getByTestId("game-state-playing").waitFor();
    await page.waitForSelector(".game-launch-blackout", { state: "detached" });
    await page.keyboard.press("Space");
    const agentvnChoice = page.getByRole("group", { name: "剧情选项" })
      .getByRole("button", { name: "选择：继续左侧故事", exact: true });
    await agentvnChoice.waitFor();
    await page.waitForFunction(reduced => {
      const button = document.querySelector('.choice-panel button[aria-label="选择：继续左侧故事"]');
      return button && !button.disabled && !button.closest(".choice-panel.is-entering")
        && (reduced || button.classList.contains("runtime-animation-settled"));
    }, reducedMotion === "reduce");
    const agentvnAppearance = await agentvnChoice.evaluate(button => {
      const style = getComputedStyle(button);
      return { layoutType: button.closest(".ui-skin-scope")?.getAttribute("data-layout-type"),
        marker: button.getAttribute("data-renpy-default-text-choice"),
        background: style.backgroundColor, borderWidth: style.borderTopWidth };
    });
    assert.equal(agentvnAppearance.layoutType, "agentvn");
    assert.equal(agentvnAppearance.marker, null, "AgentVN 不得接收 Ren’Py 文字按钮标记");
    assert.notEqual(agentvnAppearance.background, "rgba(0, 0, 0, 0)", "AgentVN 原选项填充必须保留");
    assert.equal(parseFloat(agentvnAppearance.borderWidth), 1, "AgentVN 原选项边框必须保留");
    report.cases.push({ name: "agentvn-choice-style-isolation", status: "PASS", ...agentvnAppearance });
    await page.close();
    page = undefined;
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await server?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
    console.log(report.status, report.error ?? "");
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
