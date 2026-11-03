#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.RENPY_MENU_TEST_PORT || 6895);
const output = process.env.AGENTVN_QA_OUTPUT || path.join(root, "output/playwright/renpy-menu", new Date().toISOString().replace(/[:.]/g, "-"));
const report = { status: "RUNNING", cases: [] };
let baseUrl;
const loaded = { exports: {} };

new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: {
    resolveDir: root,
    loader: "ts",
    contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";',
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
}).outputFiles[0].text)(loaded, loaded.exports);

function fixture(renpy = true) {
  const skin = renpy ? loaded.exports.createRenpyUILayout() : undefined;
  if (skin) skin.renpy = {
    shared: {
      fontSize: 28, x: 52, spacing: 6,
      buttonImages: {
        normal: "asset:renpy-button-normal",
        hover: "asset:renpy-button-hover",
        selected: "asset:renpy-button-selected",
        disabled: "asset:renpy-button-disabled",
      },
      buttonTextColors: {
        normal: "#111111",
        hover: "#eeeeee",
        selected: "#00ccdd",
        disabled: "#777777",
      },
    },
    title: { fontSize: 40 },
    preferences: { fontSize: 30 },
  };
  return {
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.8.0",
      game_id: "renpy-menu-acceptance",
      title: "Ren'Py 菜单夹具",
      author: "QA",
      version: "1.0.0",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "main",
      assets: ["gallery-art", "renpy-button-normal", "renpy-button-hover",
        "renpy-button-selected", "renpy-button-disabled"].map((asset_id) => ({
        asset_id,
        asset_type: "ui",
        path: `assets/${asset_id}.svg`,
        filename: `${asset_id}.svg`,
        mime_type: "image/svg+xml",
        size_bytes: 1,
        preload: false,
      })),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    script: {
      schema_version: "1.1.0",
      game_id: "renpy-menu-acceptance",
      title: "菜单夹具",
      entry_scene_id: "main",
      characters: [],
      scenes: [{
        scene_id: "main",
        title: "Main",
        chapter: 1,
        tags: [],
      commands: [
        { type: "gallery_anchor", anchor_id: "gallery-entry", title: "测试画廊", asset_id: "gallery-art", description: "用于验证画廊入口。" },
        { type: "narration", text: "用于验证真实页面导航。" },
      ],
      }],
    },
    uiSkin: skin,
    assetUrls: Object.fromEntries([
      ["gallery-art", "#16303a"],
      ["renpy-button-normal", "#111111"],
      ["renpy-button-hover", "#222222"],
      ["renpy-button-selected", "#333333"],
      ["renpy-button-disabled", "#444444"],
    ].map(([id, color]) => [id, "data:image/svg+xml," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="${color}"/></svg>`)])),
  };
}

async function assertButtonStateImages(page) {
  const navigation = page.getByTestId("renpy-menu-navigation");
  const selected = navigation.locator('[aria-current="page"]');
  const normal = navigation.locator("button:not([aria-current])").first();
  await page.mouse.move(0, 0);
  const normalImage = await normal.evaluate((button) => getComputedStyle(button).backgroundImage);
  const selectedImage = await selected.evaluate((button) => getComputedStyle(button).backgroundImage);
  assert(normalImage.includes("%23111111"), "空闲按钮必须显示 normal GUI 图");
  assert(selectedImage.includes("%23333333"), "当前页按钮必须显示 selected GUI 图");
  await normal.hover();
  const hoverImage = await normal.evaluate((button) => getComputedStyle(button).backgroundImage);
  assert(hoverImage.includes("%23222222"), "悬停按钮必须显示 hover GUI 图");
  await normal.evaluate((button) => { button.disabled = true; });
  const disabledImage = await normal.evaluate((button) => getComputedStyle(button).backgroundImage);
  assert(disabledImage.includes("%23444444"), "禁用按钮必须显示 disabled GUI 图");
  await normal.evaluate((button) => { button.disabled = false; });
  return { normalImage, hoverImage, selectedImage, disabledImage };
}

async function initialize(page, renpy = true) {
  await page.goto(`${baseUrl}/?mode=preview`);
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
  await page.evaluate((payload) => {
    window.postMessage({
      type: "agentvn.live-preview.init",
      protocolVersion: 2,
      sessionId: `renpy-menu-${Date.now()}`,
      revision: 1,
      requestId: "menu",
      runId: "menu",
      screen: "title_menu",
      ...payload,
    }, "*");
  }, fixture(renpy));
  await page.getByTestId("game-state-title").waitFor();
}

async function waitForScreen(page, screen) {
  await page.locator(`[data-ui-screen="${screen}"]`).waitFor();
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
  if (screen === "player") {
    // Gameplay DOM is committed under the opaque launch cover before it becomes
    // interactive. This menu-flow test operates after the real resume completes;
    // launch-cover timing and input are tested by game-entry-transition.
    await page.waitForFunction(() => !document.querySelector(".game-launch-blackout"));
    assert(await page.getByTestId("game-state-playing").isVisible(),
      "菜单恢复流程结束后真实剧情页必须可见");
  }
}

async function currentHighContrastCheckbox(page) {
  // Category/page fades retain inert presentation copies with the same labels.
  // Select the real accessible control, and independently verify that retained
  // pixels cannot acquire focus or become the active settings owner.
  const current = page.locator("[data-settings-tab-current]");
  assert.equal(await current.count(), 1, "设置必须只有一个当前功能内容层");
  const checkbox = current.getByRole("checkbox", { name: "High contrast text", exact: true });
  await checkbox.waitFor({ state: "visible" });
  assert.equal(await checkbox.count(), 1, "当前设置层必须有唯一高对比度控件");
  const ownership = await page.evaluate(() => ({
    snapshots: [...document.querySelectorAll("[data-runtime-transition-snapshot]")].map(snapshot => ({
      inert: snapshot.inert,
      hidden: snapshot.getAttribute("aria-hidden") === "true",
      pointerBlocked: getComputedStyle(snapshot).pointerEvents === "none",
      focusInside: snapshot.contains(document.activeElement),
      containsOwner: Boolean(snapshot.querySelector("[data-settings-tab-current]")),
      focusableDescendant: [...snapshot.querySelectorAll("button,input,select,textarea,a,[tabindex]")]
        .some(node => node.tabIndex >= 0),
    })),
  }));
  assert(ownership.snapshots.every(snapshot => snapshot.inert && snapshot.hidden
    && snapshot.pointerBlocked && !snapshot.focusInside && !snapshot.containsOwner
    && !snapshot.focusableDescendant), "离场设置快照不得接管焦点、输入或当前页归属");
  return checkbox;
}

async function assertNavigationGeometry(page, activeScreen) {
  const current = page.getByTestId("renpy-menu-navigation").locator('[aria-current="page"]');
  assert.equal(await current.count(), 1, "当前页面必须有唯一选中项");
  assert.equal(await current.getAttribute("data-testid"), `renpy-menu-${activeScreen}`,
    "导航选中状态必须跟随真实页面");
  const result = await page.getByTestId("renpy-menu-navigation").evaluate((navigation) => {
    const frame = navigation.closest(".runtime-layout-frame")?.getBoundingClientRect();
    const nav = navigation.getBoundingClientRect();
    const menu = navigation.closest("[data-renpy-menu-frame]");
    const contentRegion = menu?.querySelector("[data-testid='renpy-menu-content']");
    const buttons = [...navigation.querySelectorAll("button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        label: button.textContent?.trim(),
        rect: rect.toJSON(),
        clipped: button.scrollWidth > button.clientWidth + 1,
        hit: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
      };
    });
    return {
      frame: frame?.toJSON(),
      nav: nav.toJSON(),
      menuScale: Number(menu?.getAttribute("data-renpy-menu-scale")),
      contentRegion: contentRegion?.getBoundingClientRect().toJSON(),
      fontSize: parseFloat(getComputedStyle(navigation.querySelector("button")).fontSize),
      gap: parseFloat(getComputedStyle(navigation).rowGap),
      buttons,
      overflow: document.documentElement.scrollWidth - innerWidth,
      content: [...(contentRegion || navigation.parentElement).querySelectorAll(
        ":scope > .settings-renpy, :scope > .history-list, :scope > .save-load-toolbar, :scope > .about-card, :scope > .gallery-grid, :scope > .help-card",
      )].map((node) => ({ name: node.className, rect: node.getBoundingClientRect().toJSON() })),
    };
  });

  assert(result.frame, "缺少 Runtime 帧");
  assert(result.contentRegion, "Ren’Py 菜单必须有独立的侧栏及内容区域");
  assert(result.nav.right <= result.contentRegion.left + 1, "页面导航必须在内容区左侧，不可继续使用顶部临时横排");
  assert(Math.abs(result.fontSize / result.menuScale - (activeScreen === "settings" ? 30 : 28)) < .1,
    "实际菜单字号必须使用页面覆盖或共享值，不可继承标题覆盖或使用固定字号");
  assert(Math.abs(result.gap / result.menuScale - 6) < .1, "菜单间距必须继承共享值并同倍率缩放");
  assert(result.contentRegion.right <= result.frame.right + 1 && result.contentRegion.bottom <= result.frame.bottom + 1,
    "菜单内容区越出实际 Runtime 帧");
  assert(result.overflow <= 1, "Ren'Py 菜单页面产生横向溢出");
  assert(result.nav.left >= result.frame.left - 1 && result.nav.right <= result.frame.right + 1,
    "Ren'Py 页面导航越出 Runtime 帧");
  for (const button of result.buttons) {
    assert(button.rect.width > 0 && button.rect.height > 0 && button.hit && !button.clipped,
      `导航按钮不可点击或裁切：${button.label}`);
    assert(button.rect.left >= result.frame.left - 1 && button.rect.right <= result.frame.right + 1
      && button.rect.top >= result.frame.top - 1 && button.rect.bottom <= result.frame.bottom + 1,
    `导航按钮越界：${button.label}`);
  }
  for (let i = 0; i < result.buttons.length; i++) {
    for (const content of result.content) {
      const a = result.buttons[i].rect, b = content.rect;
      assert(!(Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1),
      `导航遮挡内容：${result.buttons[i].label}/${content.name}`);
    }
    for (let j = i + 1; j < result.buttons.length; j++) {
      const a = result.buttons[i].rect;
      const b = result.buttons[j].rect;
      const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      assert(!overlap, `导航按钮重叠：${result.buttons[i].label}/${result.buttons[j].label}`);
    }
  }
  return result;
}

async function assertRenpyButtonStateImages(page) {
  const navigation = page.getByTestId("renpy-menu-navigation");
  const selected = navigation.locator('[aria-current="page"]');
  const normal = navigation.locator("button:not([aria-current])").first();
  const settle = async (button) => button.evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  const viewport = page.viewportSize();
  await page.mouse.move(viewport.width - 2, viewport.height - 2);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await settle(normal);
  await settle(selected);
  const normalImage = await normal.evaluate((button) => getComputedStyle(button).backgroundImage);
  const selectedImage = await selected.evaluate((button) => getComputedStyle(button).backgroundImage);
  const normalState = await normal.evaluate((button) => ({
    color: getComputedStyle(button).color,
    backgroundImage: getComputedStyle(button).backgroundImage,
    textColorToken: getComputedStyle(button).getPropertyValue("--renpy-button-text-normal").trim(),
    hovered: button.matches(":hover"),
    focused: button.matches(":focus-visible"),
    selected: button.matches("[aria-current='page']"),
    disabled: button.disabled,
  }));
  assert(!normalState.hovered && !normalState.focused && !normalState.selected && !normalState.disabled,
    `读取 normal 颜色前按钮必须处于无 hover/focus/selected/disabled 的普通状态：${JSON.stringify(normalState)}`);
  const normalColor = normalState.color;
  assert(normalImage.includes("%23111111"), `共享 normal 状态图未显示：${normalImage}`);
  assert(selectedImage.includes("%23333333"), `共享 selected 状态图未显示：${selectedImage}`);
  assert.equal(normalColor, "rgb(17, 17, 17)",
    `共享 normal 状态文字颜色未显示：${JSON.stringify(normalState)}`);
  await normal.hover();
  await settle(normal);
  const hoverImage = await normal.evaluate((button) => getComputedStyle(button).backgroundImage);
  const hoverColor = await normal.evaluate((button) => getComputedStyle(button).color);
  assert(hoverImage.includes("%23222222"), `共享 hover 状态图未显示：${hoverImage}`);
  assert.equal(hoverColor, "rgb(238, 238, 238)", "共享 hover 状态文字颜色未显示");
  await page.mouse.move(0, 0);
  await settle(normal);
  const selectedColor = await selected.evaluate((button) => getComputedStyle(button).color);
  assert.equal(selectedColor, "rgb(0, 204, 221)", "共享 selected 状态文字颜色未显示");
  await normal.evaluate((button) => { button.disabled = true; });
  await settle(normal);
  const disabledImage = await normal.evaluate((button) => getComputedStyle(button).backgroundImage);
  const disabledState = await normal.evaluate((button) => ({
    color: getComputedStyle(button).color,
    textColorToken: getComputedStyle(button).getPropertyValue("--renpy-button-text-disabled").trim(),
    backgroundImage: getComputedStyle(button).backgroundImage,
    disabled: button.disabled,
    hovered: button.matches(":hover"),
    focused: button.matches(":focus-visible"),
    selected: button.matches("[aria-current='page']"),
  }));
  const disabledColor = disabledState.color;
  assert(disabledImage.includes("%23444444"), `共享 disabled 状态图未显示：${disabledImage}`);
  assert.equal(disabledColor, "rgb(119, 119, 119)",
    `共享 disabled 状态文字颜色未显示：${JSON.stringify(disabledState)}`);
  await normal.evaluate((button) => { button.disabled = false; });
  return { normalImage, hoverImage, selectedImage, disabledImage,
    normalColor, hoverColor, selectedColor, disabledColor };
}

async function testViewport(page, width, height) {
  const geometry = {};
  const activate = async (testId) => {
    const control = page.getByTestId(testId);
    if (width <= 915) await control.tap();
    else await control.click();
  };
  await page.setViewportSize({ width, height });
  await initialize(page);

  await activate("open-help");
  await page.getByTestId("help-screen").waitFor();
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
  const help = await page.getByTestId("help-screen").innerText();
  assert.match(help, /鼠标|点击/, "帮助必须描述实际鼠标操作");
  assert.match(help, /键盘|空格|Enter/, "帮助必须描述实际键盘操作");
  assert.match(help, /触摸|轻触/, "帮助必须描述实际触摸操作");
  assert.doesNotMatch(help, /手柄/, "未支持手柄时不得展示虚构操作");
  assert.match(help, /PageDown 恢复已回退/, "PageDown 必须说明为恢复已回退进度，不得声称推进未访问剧情");
  geometry.help = await assertNavigationGeometry(page, "help");
  geometry.buttonStates = await assertRenpyButtonStateImages(page);
  geometry.buttonStates = await assertButtonStateImages(page);
  if (width >= 1920 && height >= 1080) {
    await page.screenshot({ path: path.join(output, `${width}x${height}-help.png`) });
  }
  await activate("renpy-menu-return");
  await page.getByTestId("game-state-title").waitFor();

  await activate("open-exit-confirmation");
  const exitDialog = page.getByRole("dialog", { name: "退出游戏？" });
  await exitDialog.waitFor();
  assert.match(await exitDialog.innerText(), /自动保存|进度/);
  const exitGeometry = await exitDialog.evaluate((dialog) => {
    const panel = dialog.getBoundingClientRect();
    const actions = dialog.querySelector(".modal-actions")?.getBoundingClientRect();
    const content = [...dialog.children].map((element) => ({
      name: element.tagName,
      rect: element.getBoundingClientRect().toJSON(),
      clipped: element.scrollHeight > element.clientHeight + 1,
    }));
    const buttons = [...dialog.querySelectorAll("button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        label: button.textContent?.trim() || button.getAttribute("aria-label"),
        rect: rect.toJSON(),
        hit: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
      };
    });
    return { panel: panel.toJSON(), actions: actions?.toJSON(), content, buttons };
  });
  assert(exitGeometry.panel.left >= 0 && exitGeometry.panel.top >= 0
    && exitGeometry.panel.right <= width && exitGeometry.panel.bottom <= height,
  "退出弹窗必须完整位于可视区内");
  assert(exitGeometry.actions, "退出弹窗必须有操作区域");
  assert(exitGeometry.content.every((child) => !child.clipped
    && child.rect.left >= exitGeometry.panel.left - 1 && child.rect.right <= exitGeometry.panel.right + 1
    && child.rect.top >= exitGeometry.panel.top - 1 && child.rect.bottom <= exitGeometry.panel.bottom + 1),
  "退出弹窗内容不得裁切或越界");
  for (const button of exitGeometry.buttons) {
    assert(button.hit && button.rect.width > 0 && button.rect.height > 0,
      `退出弹窗按钮不可点击：${button.label}`);
    assert(button.rect.left >= exitGeometry.panel.left - 1 && button.rect.right <= exitGeometry.panel.right + 1
      && button.rect.top >= exitGeometry.panel.top - 1 && button.rect.bottom <= exitGeometry.panel.bottom + 1,
    `退出弹窗按钮越界：${button.label}`);
  }
  for (let i = 0; i < exitGeometry.buttons.length; i++) {
    for (let j = i + 1; j < exitGeometry.buttons.length; j++) {
      const a = exitGeometry.buttons[i].rect, b = exitGeometry.buttons[j].rect;
      assert(!(Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1),
      `退出弹窗按钮重叠：${exitGeometry.buttons[i].label}/${exitGeometry.buttons[j].label}`);
    }
  }
  assert(await exitDialog.evaluate((dialog) => dialog.contains(document.activeElement)),
    "打开退出弹窗后焦点必须进入弹窗");
  const initialModalFocus = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  await page.keyboard.press("Shift+Tab");
  assert(await exitDialog.evaluate((dialog) => dialog.contains(document.activeElement)),
    "Shift+Tab 不得将焦点移出最上层弹窗");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
    initialModalFocus, "弹窗焦点应能在首尾控件间循环");
  if (width >= 1920 && height >= 1080) {
    await page.screenshot({ path: path.join(output, `${width}x${height}-exit-confirmation.png`) });
  }
  await exitDialog.getByRole("button", { name: "取消", exact: true }).click();
  await exitDialog.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
    "open-exit-confirmation", "关闭弹窗后应恢复到打开弹窗的控件");
  assert(await page.getByTestId("game-state-title").isVisible(), "取消退出不得离开标题页");
  await activate("open-exit-confirmation");
  await exitDialog.waitFor();
  const modalBack = await page.evaluate(() => window.dispatchEvent(
    new CustomEvent("agentvn:system-back", { cancelable: true }),
  ));
  assert.equal(modalBack, false, "系统返回关闭最上层弹窗时必须消费返回事件");
  await exitDialog.waitFor({ state: "hidden" });
  assert(await page.getByTestId("game-state-title").isVisible(), "系统返回关闭弹窗不得退出标题页");
  await activate("open-exit-confirmation");
  await exitDialog.getByTestId("confirm-exit-game").click();
  assert.match(await exitDialog.innerText(), /预览模式不会关闭编辑器/);
  await page.keyboard.press("Escape");
  await exitDialog.waitFor({ state: "hidden" });

  await activate("open-settings");
  await waitForScreen(page, "preferences");
  await page.getByTestId("renpy-menu-navigation").waitFor();
  geometry.settings = await assertNavigationGeometry(page, "settings");
  await activate("renpy-menu-exit");
  await exitDialog.waitFor();
  await page.keyboard.press("Escape");
  await exitDialog.waitFor({ state: "hidden" });
  assert(await page.getByTestId("settings-screen").isVisible(), "取消共享菜单退出不得重置设置页");
  report.modalReturnDiagnostic = await page.locator(".settings-tabs button").first().evaluate(button => {
    const ancestors = [];
    for (let node = button; node; node = node.parentElement) {
      const css = getComputedStyle(node);
      ancestors.push({ tag: node.tagName, class: node.className, inert: node.inert,
        ariaHidden: node.getAttribute("aria-hidden"), rect: node.getBoundingClientRect().toJSON(),
        opacity: css.opacity, pointerEvents: css.pointerEvents, visibility: css.visibility,
        style: node.getAttribute("style") });
    }
    return ancestors;
  });
  for (const category of ["显示", "文字", "音频", "跳过", "系统"]) {
    const tab = page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: category, exact: true });
    await tab.click();
    const settingsGeometry = await page.locator(".settings-renpy").evaluate((panel) => {
      const content = panel.querySelector(".settings-content");
      const bounds = content.getBoundingClientRect();
      const tabs = panel.querySelector(".settings-tabs");
      return {
        contentOverflow: content.scrollWidth - content.clientWidth,
        categories: [...tabs.querySelectorAll("button")].map((button) => {
          const rect = button.getBoundingClientRect(), parent = tabs.getBoundingClientRect();
          return { label: button.textContent, clipped: rect.bottom > parent.bottom + 1 || rect.top < parent.top - 1
            || rect.left < parent.left - 1 || rect.right > parent.right + 1 };
        }),
        fields: [...content.querySelectorAll("input, output, .settings-check")].map((node) => {
          const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
          return { name: node.getAttribute("aria-label") || node.textContent,
            visible: css.display !== "none", left: rect.left, right: rect.right };
        }),
        bounds: bounds.toJSON(),
      };
    });
    assert(settingsGeometry.contentOverflow <= 1, `${category}设置内容横向溢出`);
    if (width >= 640) assert(settingsGeometry.categories.every((item) => !item.clipped),
      `${category}设置分类被裁切`);
    for (const field of settingsGeometry.fields.filter((item) => item.visible)) {
      assert(field.left >= settingsGeometry.bounds.left - 1 && field.right <= settingsGeometry.bounds.right + 1,
        `${category}设置控件横向裁切：${field.name}`);
    }
  }
  await page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "显示", exact: true }).click();
  await page.screenshot({ path: path.join(output, `${width}x${height}-settings.png`) });
  const checkbox = await currentHighContrastCheckbox(page);
  const previous = await checkbox.isChecked();
  if (width <= 915) await checkbox.tap();
  else await checkbox.click();
  assert.equal(await checkbox.isChecked(), !previous, "Ren'Py 设置页不得破坏原有设置控件");

  await page.getByTestId("renpy-menu-history").focus();
  assert.equal(await page.getByTestId("renpy-menu-history").evaluate((node) => (
    node === document.activeElement && getComputedStyle(node).outlineStyle !== "none"
  )), true, "键盘焦点必须可见");
  await page.keyboard.press("Enter");
  await waitForScreen(page, "history");
  geometry.history = await assertNavigationGeometry(page, "history");
  await activate("renpy-menu-save-load");
  await waitForScreen(page, "save_load");
  geometry.saves = await assertNavigationGeometry(page, "save-load");
  await activate("renpy-menu-settings");
  await waitForScreen(page, "preferences");
  assert.equal(await (await currentHighContrastCheckbox(page)).isChecked(), !previous, "页面切换不得重置设置");
  await activate("renpy-menu-about");
  await waitForScreen(page, "about");
  geometry.about = await assertNavigationGeometry(page, "about");
  await activate("renpy-menu-gallery");
  await waitForScreen(page, "gallery");
  assert.equal(await page.getByTestId("gallery-item-gallery-entry").count(), 1,
    "有画廊内容时必须提供真实画廊入口和条目");
  geometry.gallery = await assertNavigationGeometry(page, "gallery");
  await page.screenshot({ path: path.join(output, `${width}x${height}-gallery.png`) });

  await activate("renpy-menu-return");
  await page.getByTestId("renpy-title-view").waitFor();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(output, `${width}x${height}.png`) });

  await activate("start-new-game");
  await waitForScreen(page, "player");
  await page.waitForFunction(() => !document.querySelector(".game-launch-blackout"));
  const command = await page.getByTestId("game-state-playing").getAttribute("data-current-command-index");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("agentvn:system-back", { cancelable: true })));
  await page.getByTestId("main-menu").waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("agentvn:system-back", { cancelable: true })));
  await waitForScreen(page, "player");
  assert.equal(await page.getByTestId("game-state-playing").getAttribute("data-current-command-index"), command,
    "游玩中的系统返回应打开菜单，再次返回恢复原剧情位置");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("agentvn:system-back", { cancelable: true })));
  await page.getByTestId("main-menu").waitFor();
  await activate("open-settings");
  await waitForScreen(page, "preferences");
  await activate("renpy-menu-history");
  await waitForScreen(page, "history");
  const gameplayHistory = page.locator(".history-list");
  assert.equal(await gameplayHistory.count(), 1, "游玩菜单必须渲染唯一历史记录区：" + JSON.stringify(
    await page.evaluate(() => ({
      screen: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-committed-screen"),
      presented: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-presented-screen"),
      runtimeScreens: [...document.querySelectorAll("[data-ui-screen]")].map((node) => ({
        screen: node.getAttribute("data-ui-screen"),
        inert: node.inert,
        text: node.textContent?.slice(0, 120),
      })),
    })),
  ));
  assert.match(await gameplayHistory.innerText(), /用于验证真实页面导航/);
  await activate("renpy-menu-return");
  await page.getByTestId("main-menu").waitFor();
  await page.waitForFunction(() =>
    document.querySelector("[data-runtime-screen-transition]")
      ?.getAttribute("data-runtime-transition-phase") === "crossfading",
  undefined, { timeout: 5000 });
  const returnDuringReveal = await page.evaluate(() => ({
    phase: document.querySelector("[data-runtime-screen-transition]")
      ?.getAttribute("data-runtime-transition-phase"),
    screen: document.querySelector("[data-runtime-screen-transition]")
      ?.getAttribute("data-runtime-presented-screen"),
  }));
  assert.equal(returnDuringReveal.phase, "crossfading",
    "The return-key regression must fire during the non-gameplay page crossfade");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".game-launch-blackout", { state: "attached", timeout: 5000 });
  await waitForScreen(page, "player");
  report.cases.push({ name: "escape-during-page-crossfade-resumes-gameplay",
    status: "PASS", returnDuringReveal });
  await page.waitForFunction(() => !document.querySelector(".game-launch-blackout"));
  if (await page.getByTestId("renpy-quick-bar").count()) {
    const quickActions = await page.locator(".renpy-quick-bar button").allTextContents();
    assert.deepEqual(quickActions, ["回退", "历史", "快进", "自动", "存档", "快存", "快读", "设置", "隐藏"],
      "Ren’Py 剧情界面必须显示完整九项快捷栏，而非旧折叠菜单");
    assert.equal(await page.getByTestId("quick-menu-toggle").count(), 0,
      "Ren’Py 九项单行模式不得同时挂载 AgentVN 折叠控制");
    await activate("renpy-quick-history");
  } else {
    await activate("quick-menu-toggle");
    const openHistory = page.getByRole("button", { name: "打开历史记录", exact: true });
    if (width <= 915) await openHistory.tap();
    else await openHistory.click();
  }
  await waitForScreen(page, "history");
  await activate("renpy-menu-settings");
  await waitForScreen(page, "preferences");
  await activate("renpy-menu-help");
  await page.getByTestId("help-screen").waitFor();
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
  geometry.helpFromPlaying = await assertNavigationGeometry(page, "help");
  await activate("renpy-menu-return");
  await waitForScreen(page, "player");
  assert.equal(await page.getByTestId("game-state-playing").getAttribute("data-current-command-index"), command,
    "跨菜单返回必须恢复剧情推进位置");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("agentvn:system-back", { cancelable: true })));
  await page.getByTestId("main-menu").waitFor();
  await waitForScreen(page, "title");
  // The game menu uses MainMenu's actual "continue-game" action, not the
  // child-page RenpyMenuNavigation. Verify it resumes before testing the root.
  assert.equal(await page.getByTestId("renpy-menu-navigation").count(), 0,
    "剧情主菜单与子页面导航不得混淆");
  await activate("continue-game");
  await waitForScreen(page, "player");
  assert.equal(await page.getByTestId("game-state-playing").getAttribute("data-current-command-index"), command,
    "剧情主菜单的继续操作必须恢复原进度");
  await initialize(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("agentvn:system-back", { cancelable: true })));
  await page.getByRole("dialog", { name: "退出游戏？" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "退出游戏？" }).waitFor({ state: "hidden" });

  await initialize(page, false);
  assert.equal(await page.getByTestId("renpy-title-view").count(), 0, "AgentVN 不得使用 Ren’Py 标题");
  for (const [button, screen] of [
    ["open-settings", "preferences"], ["open-about", "about"], ["open-save-load", "save_load"], ["open-gallery", "gallery"],
  ]) {
    await activate(button);
    await waitForScreen(page, screen);
    assert.equal(await page.getByTestId("renpy-menu-navigation").count(), 0, "AgentVN 不得挂载 Ren’Py 共享导航");
    assert.equal(await page.locator(`[data-ui-screen="${screen}"]`).getAttribute("data-layout-type"), "agentvn");
    if (screen === "preferences") {
      assert.equal(await (await currentHighContrastCheckbox(page)).isChecked(), !previous,
        "重新加载并切回 AgentVN 布局不得丢失玩家偏好");
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "AgentVN 页面横向溢出");
    await page.keyboard.press("Escape");
    await page.getByTestId("game-state-title").waitFor();
  }
  return geometry;
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
      port,
      logFile: path.join(output, "server.log"),
    });
    baseUrl = server.url;
    report.service = { pid: server.pid, runId: server.runId, url: baseUrl };
    browser = await chromium.launch({args:process.env.RUNTIME_QA_GPU==="1"?["--use-angle=d3d11"]:[]});
    const viewports = process.env.PROFILE_VIEWPORTS ? JSON.parse(process.env.PROFILE_VIEWPORTS) : process.env.RENPY_MENU_FAST === "1"
      ? [[1920, 1080]]
      : [[1920, 1080], [2560, 1440], [3840, 2160]];
    for (const [width, height] of viewports) {
      await server.assertAlive();
      page = await browser.newPage({
        viewport: { width, height },
        hasTouch: width <= 915,
        deviceScaleFactor: Number(process.env.PROFILE_DPR || 1),
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      const geometry = await server.run(() => testViewport(page, width, height));
      await server.assertAlive();
      assert.deepEqual(errors, [], "页面发生未处理错误");
      report.cases.push({ width, height, geometry, status: "PASS" });
      await page.close();
      page = undefined;
      console.log(`PASS shared menu ${width}x${height} DPR=${process.env.PROFILE_DPR || 1}`);
    }
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    await server?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
