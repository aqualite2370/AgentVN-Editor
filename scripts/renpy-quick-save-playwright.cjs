"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { currentAcceptanceViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = process.env.AGENTVN_QA_OUTPUT || path.join(root, "output/playwright/renpy-quick-save", runId);
const report = { runId, status: "RUNNING", cases: [] };
const loaded = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(loaded, loaded.exports);
const selectedDprs = process.env.PROFILE_DPR === "2" ? [2] : process.env.PROFILE_DPR === "1" ? [1] : [1, 2];
const allViewports = selectedDprs.flatMap(dpr => currentAcceptanceViewports()
  .map(([width, height]) => ({ width, height, dpr })));
const requested = process.argv.find(value => value.startsWith("--viewport="))?.split("=")[1];
const matrix = requested ? allViewports.filter(value => `${value.width}x${value.height}` === requested) : allViewports;
assert(matrix.length > 0, "Unknown or empty viewport matrix");
report.scope = requested ? `focused-${requested}` : "current-landscape-matrix";
report.reduced = process.env.PROFILE_REDUCED === "1";
async function init(page, url, renpy) {
  await page.goto(`${url}/?mode=preview`);
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
  const uiSkin = renpy ? loaded.exports.createRenpyUILayout() : loaded.exports.getDefaultUISkinLayout();
  const buttonRoleTest = process.argv.includes("--button-roles");
  if (renpy && buttonRoleTest) {
    uiSkin.renpy ??= {};
    uiSkin.renpy.shared ??= {};
    uiSkin.renpy.shared.buttonRoles = {
      title_action: { states: { normal: { backgroundColor: "#203040" } } },
      page_navigation: { states: { normal: { backgroundColor: "#314151" } } },
      category_pagination: { states: { normal: { backgroundColor: "#425262" } } },
      story_choice: { states: { normal: { backgroundColor: "#536373" } } },
      quick_bar: { geometry: { fontSize: 18 }, states: { normal: { backgroundColor: "#647484" } } },
      modal_action: { states: { normal: { backgroundColor: "#758595" } } },
    };
  }
  if (renpy && process.argv.includes("--local-typography")) {
    const history = uiSkin.screens.find(screen => screen.screen_id === "player").components
      .find(component => component.component_id === "quick_history_button");
    history.style.fontSize = 23;
    history.style.fontWeight = 650;
  }
  await page.evaluate(({ uiSkin, buttonRoleTest }) => window.postMessage({
    type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "quick-ui",
    revision: 1, requestId: "quick-ui", runId: "quick-ui", screen: "title_menu", uiSkin,
    manifest: {
      manifest_version: "1.0.0", cartridge_version: "1.0.0",
      runtime_version: Object.values(uiSkin.renpy?.shared?.buttonRoles ?? {}).length ? "0.14.0" : "0.12.0",
      game_id: "quick-ui", title: "快存真实界面验收", author: "QA", version: "1.0.0", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "main", assets: [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    script: { schema_version: "1.1.0", game_id: "quick-ui", title: "快存验收",
      entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "剧情",
        chapter: 1, tags: [], commands: buttonRoleTest ? [
          { type: "narration", text: "角色状态验收对白。" },
          { type: "choice", choices: [
            { choice_id: "continue-a", text: "继续 A", target_scene_id: "main", conditions: [] },
            { choice_id: "continue-b", text: "继续 B", target_scene_id: "main", conditions: [] },
          ] },
        ] : Array.from({ length: 20 }, (_, i) =>
          ({ type: "narration", text: `快存回归第${i + 1}句。` })) }] },
    assetUrls: {},
  }, "*"), { uiSkin, buttonRoleTest });
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor();
  await page.locator(".game-launch-blackout").waitFor({ state: "detached" });
  if (buttonRoleTest) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await page.getByRole("button", { name: "选择：继续 A" }).count()) break;
      await page.getByTestId("game-state-playing").click({ position: { x: 12, y: 12 } });
      await page.waitForTimeout(250);
    }
    await page.getByRole("button", { name: "选择：继续 A" }).waitFor();
  }
}
async function records(page) {
  return page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("agentvn.gamecli.saves."))
    .flatMap(key => JSON.parse(localStorage.getItem(key) || "[]")));
}
async function geometry(page) {
  return page.getByTestId("renpy-quick-bar").evaluate(node => {
    const rect = node.getBoundingClientRect();
    const buttons = [...node.querySelectorAll("button")].map(button => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { label: button.textContent.trim(), rect: box.toJSON(), disabled: button.disabled,
        hit: !!hit && (hit === button || button.contains(hit)),
        hitTag: hit?.tagName, hitClass: hit?.getAttribute("class") };
    });
    return { rect: rect.toJSON(), buttons, scale: Number(node.dataset.uniformScale),
      zIndex: getComputedStyle(node).zIndex,
      buttonStyles: [...node.querySelectorAll("button")].map(button => {
        const style = getComputedStyle(button);
        return { backgroundColor: style.backgroundColor, borderColor: style.borderTopColor,
          borderWidth: style.borderTopWidth, borderRadius: style.borderTopLeftRadius,
          height: style.height, fontSize: parseFloat(style.fontSize), fontWeight: style.fontWeight, boxShadow: style.boxShadow,
          roleFont: style.getPropertyValue("--renpy-role-font-size"), quickFont: style.getPropertyValue("--renpy-quick-font") };
      }),
      dialogZIndex: getComputedStyle(document.querySelector(".dialog-box")).zIndex,
      overflow: node.scrollWidth - node.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      dialogText: document.querySelector(".dialog-text")?.getBoundingClientRect().toJSON() };
  });
}
async function saveControlGeometry(page) {
  return page.locator(".save-load-screen").evaluate(screen => {
    const groups = [
      { name: "mode", selector: ".save-mode-switch .ui-button" },
      { name: "kind", selector: ".save-kind-tabs .save-kind-tab" },
      { name: "pagination", selector: ".save-page-navigation .ui-button" },
    ];
    const controls = groups.flatMap(group => [...screen.querySelectorAll(group.selector)].map(button => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        group: group.name,
        rect: rect.toJSON(),
        height: Number.parseFloat(style.height),
        radius: style.borderTopLeftRadius,
        borderWidth: style.borderTopWidth,
        background: style.backgroundColor,
        color: style.color,
        selected: button.matches(".active, [aria-selected='true']"),
      };
    }));
    const groupStyles = [
      ["mode", ".save-mode-switch"],
      ["kind", ".save-kind-tabs"],
      ["pagination", ".save-page-navigation"],
    ].map(([group, selector]) => {
      const node = screen.querySelector(selector);
      const style = getComputedStyle(node);
      return {
        group,
        rect: node.getBoundingClientRect().toJSON(),
        radius: style.borderTopLeftRadius,
        borderWidth: style.borderTopWidth,
        background: style.backgroundColor,
      };
    });
    return {
      controls,
      groupStyles,
      contentRect: screen.closest(".renpy-menu-outlet").getBoundingClientRect().toJSON(),
    };
  });
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server, browser, activePage;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "GameCli_framework"), configFile: path.join(root, "GameCli_framework/vite.config.cjs"),
      port: Number(process.env.QUICK_SAVE_TEST_PORT || 6903), logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch({args:process.env.RUNTIME_QA_GPU==="1"?["--use-angle=d3d11"]:[]});
    await server.run(async () => {
      for (const { width, height, dpr } of matrix) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
          reducedMotion: report.reduced ? "reduce" : "no-preference" });
        const page = await context.newPage();
        activePage = page;
        const errors = [];
        page.on("pageerror", error => errors.push(String(error)));
        await init(page, server.url, true);
        await page.getByTestId("renpy-quick-bar").waitFor({ timeout: 6000 });
        const actual = await geometry(page);
        const entry = { case: "nine-row-geometry", width, height, dpr, actual, status: "RUNNING" };
        report.cases.push(entry);
        assert.deepEqual(actual.buttons.map(button => button.label), ["回退", "历史", "快进", "自动", "存档", "快存", "快读", "设置", "隐藏"]);
        assert(actual.rect.left >= -1 && actual.rect.right <= width + 1
          && actual.rect.top >= -1 && actual.rect.bottom <= height + 1);
        assert(actual.pageOverflow <= 1 && actual.overflow <= 1, "快捷栏不能横向溢出或内部滚动");
        for (const button of actual.buttons) {
          assert(Math.abs(button.rect.top - actual.buttons[0].rect.top) <= 1, "九项必须同一行");
          if (!button.disabled) assert(button.hit, `不可命中 ${button.label}`);
          assert(button.rect.left >= actual.rect.left - 1 && button.rect.right <= actual.rect.right + 1);
        }
        for (let i = 1; i < actual.buttons.length; i++) {
          assert(actual.buttons[i].rect.left >= actual.buttons[i - 1].rect.right - 1, "按钮不能重叠");
        }
        const buttonStyles = actual.buttonStyles;
        const expectedFonts = Array(9).fill((process.argv.includes("--button-roles") ? 18 : 14) * actual.scale);
        if (process.argv.includes("--local-typography")) {
          expectedFonts[1] = 23 * actual.scale;
          assert.equal(buttonStyles[1].fontWeight, "650", "Explicit local typography remains an author override");
        } else {
          assert(buttonStyles.every(style => style.fontWeight === buttonStyles[0].fontWeight),
            "New preset native actions must inherit one consistent weight");
        }
        assert(buttonStyles.every((style, i) => Math.abs(style.fontSize - expectedFonts[i]) < .1),
          `Quick-bar local styles and role/default inheritance must scale once: ${JSON.stringify({ expectedFonts, scale: actual.scale, buttonStyles })}`);
        if (!process.argv.includes("--button-roles")) {
          assert(buttonStyles.every(style => style.backgroundColor === "rgba(0, 0, 0, 0)"
          && style.borderColor === "rgba(0, 0, 0, 0)"
          && style.borderRadius === "0px" && style.boxShadow === "none"),
          `Ren’Py 快捷栏默认操作应遵循原生文字按钮，不应套用通用卡片容器：${JSON.stringify(buttonStyles)}`);
        }
        assert(buttonStyles.every(style => style.height === buttonStyles[0].height),
          "快捷栏按钮高度必须统一");
        if (actual.dialogText) assert(actual.rect.top >= actual.dialogText.bottom - 1, "快捷栏不得覆盖对白文字");
        if (!process.argv.includes("--button-roles") && width === 1920 && dpr === 1) {
          const autoButton = page.getByTestId("renpy-quick-auto");
          const before = await autoButton.evaluate(node => ({
            rect: node.getBoundingClientRect().toJSON(),
            color: getComputedStyle(node).color,
          }));
          await autoButton.click();
          await page.mouse.move(1, 1);
          await page.evaluate(() => document.activeElement?.blur?.());
          await autoButton.evaluate(async node => {
            await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {})));
          });
          const selected = await autoButton.evaluate(node => ({
            rect: node.getBoundingClientRect().toJSON(),
            color: getComputedStyle(node).color,
            inlineColor: node.style.color,
            pressed: node.getAttribute("aria-pressed"),
            background: getComputedStyle(node).backgroundColor,
            border: getComputedStyle(node).borderTopColor,
            shadow: getComputedStyle(node).boxShadow,
          }));
          entry.autoFeedback = { before, selected };
          assert.equal(selected.pressed, "true", "Auto state really changed before checking its visual feedback");
          assert(selected.background === "rgba(0, 0, 0, 0)"
            && selected.border === "rgba(0, 0, 0, 0)" && selected.shadow === "none",
          `激活状态仍应是无容器文字按钮：${JSON.stringify(selected)}`);
          assert(selected.color !== before.color, "自动播放激活仍须有清晰的文字状态反馈");
          assert(Math.abs(selected.rect.width - before.rect.width) < 1
            && Math.abs(selected.rect.height - before.rect.height) < 1,
          "快捷栏状态反馈不得改变稳定命中盒");
          await autoButton.click();
        }
        if (process.argv.includes("--button-roles") && width === 1920 && dpr === 1) {
          assert.equal(actual.buttonStyles[0].backgroundColor, "rgb(100, 116, 132)",
            "快捷栏角色普通态必须作用于实际 Runtime 按钮");
          const choiceButton = page.getByRole("button", { name: "选择：继续 A" });
          await choiceButton.waitFor();
          assert.equal(await choiceButton.evaluate(node => getComputedStyle(node).backgroundColor),
            "rgb(83, 99, 115)", "剧情选项角色普通态必须作用于实际 Runtime 按钮");
          await page.getByTestId("renpy-quick-save-load").click();
          const runtimeNav = page.getByTestId("renpy-menu-settings");
          await runtimeNav.waitFor();
          assert.equal(await runtimeNav.evaluate(node => getComputedStyle(node).backgroundColor),
            "rgb(49, 65, 81)", "页面导航角色普通态必须作用于实际 Runtime 导航");
          await page.getByTestId("renpy-menu-save-load").click();
          const category = page.getByTestId("save-page-next");
          await category.waitFor();
          await page.waitForFunction(() => getComputedStyle(document.querySelector("[data-testid='save-page-next']")).backgroundColor
            === "rgb(66, 82, 98)");
          assert.equal(await category.evaluate(node => getComputedStyle(node).backgroundColor),
            "rgb(66, 82, 98)", "分类/分页角色普通态必须作用于分页真实控件");
          const roleEvidence = await page.locator(".save-load-screen").evaluate(node => ({
            tabs: [...node.querySelectorAll(".save-kind-tab")].map(button =>
              ({ custom: button.dataset.renpyRoleCustom, role: getComputedStyle(button).backgroundColor })),
            pages: [...node.querySelectorAll(".save-page-navigation button")].map(button =>
              ({ custom: button.dataset.renpyRoleCustom, role: getComputedStyle(button).backgroundColor })),
          }));
          assert(roleEvidence.tabs.every(item => item.custom === "true")
            && roleEvidence.pages.every(item => item.custom === "true"),
          "分类与分页按钮都必须绑定角色几何");
          await page.getByTestId("save-page-next").click();
          await page.getByTestId("renpy-menu-return").click();
          await page.getByTestId("game-state-playing").waitFor();
          entry.roleEvidence = roleEvidence;
        }
        await page.screenshot({ path: path.join(output, `bar-${width}x${height}-dpr${dpr}.png`) });
        entry.status = "PASS";

        await page.getByTestId("renpy-quick-load").click();
        await page.getByRole("status").filter({ hasText: "没有可读取的有效快存" }).waitFor();
        assert.equal(await page.getByRole("dialog").count(), 0);
        for (let i = 0; i < (width === 1920 && dpr === 1 ? 8 : 1); i++) {
          await page.getByTestId("renpy-quick-save").click();
          await page.getByRole("status").filter({ hasText: "快存已保存" }).waitFor();
          await page.getByTestId("renpy-quick-save").waitFor();
          await page.waitForFunction(() => !document.querySelector("[data-testid='renpy-quick-save']")?.disabled);
        }
        const saved = await records(page);
        const quick = saved.filter(save => save.save_kind === "quick");
        assert.equal(quick.length, width === 1920 && dpr === 1 ? 6 : 1);
        await page.getByTestId("renpy-quick-load").click();
        const confirmation = page.getByRole("dialog", { name: "读取最新快存？" });
        await confirmation.waitFor();
        // Button-only getAnimations() omits the parent modal's entrance scale.
        // Compare focus geometry after actual finite transitions settle.
        await confirmation.evaluate(async () => {
          await Promise.all(document.getAnimations().filter(animation =>
            animation.effect?.getComputedTiming().iterations !== Infinity)
            .map(animation => animation.finished.catch(() => {})));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        await page.mouse.move(1, 1);
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
        await confirmation.locator(".modal-actions > .ui-button").evaluateAll(buttons =>
          Promise.all(buttons.flatMap(button => button.getAnimations().map(animation =>
            animation.finished.catch(() => {})))));
        assert.equal(await confirmation.getAttribute("data-runtime-screen"), "playing",
          "剧情内快读确认必须归属 playing 页面");
        assert.equal(await confirmation.getAttribute("data-layout-type"), "renpy",
          "快读确认必须使用当前 Ren'Py 布局");
        let modalButtons = [];
        if (!process.argv.includes("--button-roles")) {
          modalButtons = await confirmation.locator(".modal-actions > .ui-button").evaluateAll(buttons =>
            buttons.map(button => {
              const rect = button.getBoundingClientRect();
              const style = getComputedStyle(button);
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              return { text: button.textContent.trim(), rect: rect.toJSON(),
                borderWidth: style.borderTopWidth, borderRadius: style.borderTopLeftRadius,
                background: style.backgroundColor, backgroundImage: style.backgroundImage,
                shadow: style.boxShadow, hit: hit === button || button.contains(hit),
                clipped: button.scrollWidth > button.clientWidth + 1
                  || button.scrollHeight > button.clientHeight + 1 };
            }));
          assert.deepEqual(modalButtons.map(button => button.text), ["取消", "确认读取"]);
          entry.quickLoadModal = modalButtons;
          assert(modalButtons.every(button => button.borderWidth === "0px"
            && button.borderRadius === "0px"
            && button.background === "rgba(0, 0, 0, 0)"
            && button.backgroundImage === "none"
            && button.shadow === "none"
            && button.hit && !button.clipped),
          `剧情内快读确认默认应为无容器文字按钮且可实际点击：${JSON.stringify(modalButtons)}`);
        }
        if (process.argv.includes("--button-roles")) {
          const modalAction = confirmation.getByTestId("confirm-quick-load");
          entry.modalAction = await modalAction.evaluate(node => getComputedStyle(node).backgroundColor);
          assert.equal(entry.modalAction, "rgb(117, 133, 149)",
            "弹窗操作角色普通态必须作用于实际 Modal 操作");
        }
        await confirmation.getByRole("button", { name: "关闭读取最新快存？", exact: true }).focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        assert(await confirmation.evaluate(node => node.contains(document.activeElement)), "快读确认必须围栏焦点");
        if (!process.argv.includes("--button-roles")) {
          await confirmation.locator(".modal-actions > .ui-button").evaluateAll(buttons =>
            Promise.all(buttons.flatMap(button => button.getAnimations().map(animation =>
              animation.finished.catch(() => {})))));
          const focusedAction = await confirmation.locator(".modal-actions > .ui-button").evaluateAll(buttons =>
            buttons.filter(button => button.matches(":focus-visible")).map(button => ({
              text: button.textContent.trim(), rect: button.getBoundingClientRect().toJSON(),
              decoration: getComputedStyle(button).textDecorationLine,
              decorationStyle: getComputedStyle(button).textDecorationStyle,
              shadow: getComputedStyle(button).boxShadow,
            })));
          entry.quickLoadFocus = focusedAction;
          assert.equal(focusedAction.length, 1, "Tab后必须有唯一快读操作获得焦点");
          assert(focusedAction[0].decoration.includes("underline")
            && focusedAction[0].decorationStyle === "double"
            && focusedAction[0].shadow === "none",
          `快读键盘焦点应使用双线文字反馈而非卡片阴影：${JSON.stringify(focusedAction)}`);
          assert.deepEqual(focusedAction[0].rect,
            modalButtons.find(button => button.text === focusedAction[0].text).rect,
          "键盘焦点反馈不得改变快读按钮几何");
        }
        await page.keyboard.press("Escape");
        await confirmation.waitFor({ state: "detached" });
        assert(await page.getByTestId("renpy-quick-load").evaluate(button => button === document.activeElement),
          "关闭快读确认后焦点必须恢复到快读入口");
        await page.getByTestId("renpy-quick-load").click();
        await page.getByTestId("confirm-quick-load").click();
        await page.locator(".game-launch-blackout").waitFor({ state: "detached" });
        await page.getByTestId("game-state-playing").waitFor();
        await page.getByTestId("renpy-quick-save-load").click();
        await page.getByTestId("save-slot-grid").waitFor();
        const { controls: saveControls, groupStyles, contentRect } = await saveControlGeometry(page);
        const modeHeight = saveControls.find(control => control.group === "mode")?.height;
        assert(modeHeight !== undefined && saveControls.every(control => Math.abs(control.height - modeHeight) <= 2),
          `存读档主操作、类别和分页按钮需要统一高度：${JSON.stringify(saveControls)}`);
        assert(saveControls.every(control => control.radius === saveControls[0]?.radius),
          `存读档按钮需要统一圆角语言：${JSON.stringify(saveControls)}`);
        const actionGroups = groupStyles.filter(group => group.group !== "pagination");
        assert(actionGroups.every(group => group.background !== "rgba(0, 0, 0, 0)"
          && Number.parseFloat(group.borderWidth) >= 1
          && group.radius === actionGroups[0]?.radius),
        `主操作与类别需采用一致的分组承托：${JSON.stringify(groupStyles)}`);
        assert(actionGroups.every(group => group.borderWidth === actionGroups[0]?.borderWidth),
          `主操作与类别外框描边粗细必须一致：${JSON.stringify(groupStyles)}`);
        const paginationGroup = groupStyles.find(group => group.group === "pagination");
        assert(paginationGroup.rect.width <= contentRect.width + 1 && paginationGroup.rect.width >= contentRect.width * 0.9,
          `底部分页应使用内容区宽度并让左右按钮分居两端：${JSON.stringify(paginationGroup)}`);
        assert(paginationGroup.rect.top >= (await page.getByTestId("save-slot-grid").boundingBox()).y
          + (await page.getByTestId("save-slot-grid").boundingBox()).height - 1,"分页必须位于网格底部");
        assert(Math.abs(
          (paginationGroup.rect.left + paginationGroup.rect.right) / 2
            - (contentRect.left + contentRect.right) / 2,
        ) <= 2, `分页控件组应保持视觉居中：${JSON.stringify(paginationGroup)}`);
        assert(saveControls.every(control => control.radius === saveControls[0]?.radius
          && control.borderWidth === saveControls[0]?.borderWidth),
        `分段按钮内部形状与描边必须统一：${JSON.stringify(saveControls)}`);
        assert(saveControls.every(control => Number.parseFloat(control.radius)
          <= control.height * 0.32 + 1),
        `紧凑视口下按钮圆角应随高度协调缩小：${JSON.stringify(saveControls)}`);
        for (const group of ["mode", "kind"]) {
          const selected = saveControls.find(control => control.group === group && control.selected);
          const inactive = saveControls.find(control => control.group === group && !control.selected);
          assert(selected && inactive
            && (selected.background !== inactive.background || selected.color !== inactive.color),
          `${group} 组选中态与未选中态必须清楚区分`);
        }
        for (let i = 0; i < saveControls.length; i++) {
          for (let j = i + 1; j < saveControls.length; j++) {
            const a = saveControls[i].rect, b = saveControls[j].rect;
            assert(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1,
              "存读档操作按钮组不能重叠");
          }
        }
        assert.equal(await page.locator(".save-load-header .screen-back-button").count(), 0,
          "Ren’Py 存读档页不应在右上角重复提供返回按钮");
        assert(await page.getByTestId("renpy-menu-return").isVisible(),
          "移除右上角返回后，页面导航栏仍须提供游戏返回路径");
        assert.equal(await page.locator('[data-testid^="save-slot-manual-"]').count(), 6);
        await page.getByTestId("save-page-next").click();
        await page.getByTestId("save-slot-manual-7").waitFor();
        assert.equal(await page.locator('[data-testid^="save-slot-manual-"]').count(), 6);
        await page.getByRole("tab", { name: "快存", exact: true }).click();
        await page.getByTestId("save-slot-quick-1").waitFor();
        assert.equal(await page.locator('[data-testid^="save-slot-quick-"]').count(), 6);
        for (const slot of quick) {
          const button = page.getByTestId(`save-slot-quick-${slot.slot}`).locator(".save-card-main");
          await button.scrollIntoViewIfNeeded();
          const target = await button.evaluate(node => {
            const box = node.getBoundingClientRect();
            const grid = node.closest(".save-grid").getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return { box: box.toJSON(), grid: grid.toJSON(),
              hit: !!hit && (hit === node || node.contains(hit)) };
          });
          assert(target.hit && target.box.top >= target.grid.top - 1
            && target.box.bottom <= target.grid.bottom + 1, "每个快存必须可滚动至完整可见且可命中");
        }
        const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert(pageOverflow <= 1, "快存页不能横向溢出");
        await page.screenshot({ path: path.join(output, `saves-${width}x${height}-dpr${dpr}.png`) });
        await page.getByTestId("renpy-menu-return").click();
        await page.getByTestId("game-state-playing").waitFor();
        assert.deepEqual(errors, []);
        report.cases.push({ case: "quick-save-load-and-pagination", width, height, dpr, saveControls, groupStyles, contentRect, status: "PASS" });
        await context.close();
        activePage = undefined;
      }
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      activePage = page;
      await init(page, server.url, false);
      await page.getByTestId("quick-menu-toggle").click();
      assert.equal(await page.locator(".quick-menu-button").count(), 7, "AgentVN 保留七项操作");
      await page.getByRole("button", { name: "打开存档读档", exact: true }).click();
      await page.getByTestId("save-slot-grid").waitFor();
      assert.equal(await page.locator(".save-load-header .screen-back-button").count(), 1,
        "AgentVN 原有存读档返回操作必须保持");
      await page.getByRole("tab", { name: "快存", exact: true }).click();
      await page.getByTestId("save-slot-quick-1").waitFor();
      report.cases.push({ case: "agentvn-seven-and-quick-category-access", status: "PASS" });
      await page.close();
      activePage = undefined;
      assert.equal(report.cases.length, matrix.length * 2 + 1, "拒绝空矩阵或缺失行为");
      report.status = "PASS";
    });
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    await activePage?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    await browser?.close(); await server?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
