"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, "..");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT
  ? path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT)
  : path.join(root, "output/playwright/runtime-modal-visual", new Date().toISOString().replace(/[:.]/g, "-"));
const authoredRoles = process.argv.includes("--authored-roles");
const compiled = buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text;
const mod = { exports: {} };
new Function("module", "exports", compiled)(mod, mod.exports);
const deviceScaleFactor = Number(process.env.PROFILE_DPR || 1);
const reduced = process.env.PROFILE_REDUCED === "1";
const report = { status: "RUNNING", deviceScaleFactor, reduced,
  scope: "browser-runtime-modal-visual-not-installed-acceptance", authoredRoles, cases: [], screenshots: [] };

function skinFor(layout) {
  if (layout !== "renpy") return undefined;
  const skin = mod.exports.createRenpyUILayout();
  if (authoredRoles) {
    skin.confirmationLayout = { panelStyle: { backgroundColor: "#394a73", opacity: 1 } };
    skin.renpy ??= {};
    skin.renpy.shared ??= {};
    skin.renpy.shared.buttonRoles = { modal_action: {
      geometry: { width: 152, height: 48, fontSize: 19, paddingX: 17, paddingY: 9 },
      states: {
        normal: { textColor: "#99b6c0", backgroundColor: "#203447", borderColor: "#52677a", borderWidth: 1, opacity: .96 },
        hover: { textColor: "#99b9c1", backgroundColor: "#324961", borderColor: "#8aa4bb", borderWidth: 2, opacity: .99 },
        selected: { textColor: "#99bcc2", backgroundColor: "#425570", borderColor: "#adc3d6", borderWidth: 1.5, opacity: .95 },
        disabled: { textColor: "#99bfc3", backgroundColor: "#192b3b", borderColor: "#3e5163", borderWidth: .5, opacity: .65 },
      },
    } };
  }
  return skin;
}

async function inspectAuthoredActions(page, dialog) {
  await settleRuntime(page);
  const actions = dialog.locator(".modal-actions > button");
  const results = [];
  await page.mouse.move(0, 0);
  for (const action of await actions.all()) {
    const read = () => action.evaluate(n => {
      const r = n.getBoundingClientRect(), panel = n.closest(".modal-panel");
      const content = panel.querySelector(".modal-content");
      return { rect: r.toJSON(), color: getComputedStyle(n).color,
        contentOverflow: content.scrollWidth - content.clientWidth,
        panelOverflow: panel.scrollWidth - panel.clientWidth };
    });
    const normal = await read();
    assert(normal.contentOverflow <= 1 && normal.panelOverflow <= 1,
      `自定义弹窗操作不可产生横向滚动: ${JSON.stringify(normal)}`);
    await action.hover();
    await settleRuntime(page);
    const hover = await read();
    for (const key of ["x", "y", "width", "height"])
      assert(Math.abs(normal.rect[key] - hover.rect[key]) <= .15,
        `悬停不得触发内部滚动或按钮位移: ${JSON.stringify({ normal, hover })}`);
    assert.equal(normal.color, "rgb(153, 182, 192)");
    assert.equal(hover.color, "rgb(153, 185, 193)");
    results.push({ normal, hover });
    await page.mouse.move(0, 0);
    await settleRuntime(page);
  }
  return results;
}

async function openSaveDeleteConfirmation(page, layout) {
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor();
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");

  if (layout === "renpy") {
    await page.getByTestId("renpy-quick-save-load").click();
  } else {
    await page.getByTestId("quick-menu-toggle").click();
    await page.getByRole("button", { name: "打开存档读档", exact: true }).click();
  }
  await page.locator(".save-load-screen").waitFor();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "保存到手动存档 1", exact: true }).click();
  await page.locator("[data-testid='save-slot-manual-1'].has-save").waitFor();
  await page.getByRole("tab", { name: "手动", exact: true }).click();
  await page.getByRole("button", { name: "读取", exact: true }).click();
  const slot = page.getByTestId("save-slot-manual-1");
  await slot.getByRole("button", { name: "删除", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除存档", exact: true });
  await dialog.waitFor();
  return { dialog, deleteTrigger: slot.getByRole("button", { name: "删除", exact: true }) };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  let server, browser, page;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(output, "server.log") });
    browser = await chromium.launch();
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
      for (const layout of ["renpy", "agentvn"]) {
      page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor,
        reducedMotion: reduced ? "reduce" : "no-preference" });
      await server.run(async () => {
        await page.goto(`${server.url}/?mode=preview`);
        await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
        await page.evaluate(uiSkin => window.postMessage({
          type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "modal-visual",
          revision: 1, requestId: "modal", runId: "modal", screen: "title_menu", uiSkin, assetUrls: {},
          manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.9.0",
            game_id: "modal-visual", title: "退出弹窗视觉复核", author: "QA", version: "1.0.0", language: "zh-CN",
            entry_script: "script.json", entry_scene_id: "main", assets: [],
            created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          script: { schema_version: "1.1.0", game_id: "modal-visual", title: "退出弹窗视觉复核",
            entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1,
              tags: [], commands: [{ type: "narration", text: "只读视觉复测，不改变玩家存档。" }] }] },
        }, "*"), skinFor(layout));
        await page.getByTestId("game-state-title").waitFor();
        await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
          ?.getAttribute("data-runtime-screen-transition") === "idle");
        const expectedFocus = layout === "renpy" ? "open-exit-confirmation" : "start-new-game";
        if (layout === "agentvn") {
          assert.equal(await page.getByTestId("open-exit-confirmation").count(), 0,
            "AgentVN 标题页不得添加退出入口");
          await page.getByTestId("start-new-game").focus();
          await page.evaluate(() => window.dispatchEvent(new CustomEvent("agentvn:system-back", { cancelable: true })));
        } else {
          await page.getByTestId("open-exit-confirmation").click();
        }
        const dialog = page.getByRole("dialog", { name: "退出游戏？", exact: true });
        await dialog.waitFor();
        await dialog.getByRole("button", { name: "关闭退出游戏？" }).focus();
        await settleRuntime(page);
        // Wait for actual paint, not an arbitrary timeout or screenshot-only judgment.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await dialog.locator(".modal-actions > .ui-button").evaluateAll(buttons =>
          Promise.all(buttons.flatMap(button => button.getAnimations().map(animation =>
            animation.finished.catch(() => {})))));
        const geometry = await dialog.evaluate(panel => {
          const rect = panel.getBoundingClientRect();
          const ancestors = [];
          for (let node = panel; node; node = node.parentElement) {
            const css = getComputedStyle(node);
            ancestors.push({ tag: node.tagName, className: node.className,
              opacity: css.opacity, visibility: css.visibility, display: css.display, zIndex: css.zIndex });
          }
          const buttons = [...panel.querySelectorAll("button")].map(button => {
            const r = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return { label: button.textContent || button.getAttribute("aria-label"), rect: r.toJSON(),
              borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle,
              borderRadius: style.borderTopLeftRadius, background: style.backgroundColor,
              backgroundImage: style.backgroundImage, shadow: style.boxShadow,
              color: style.color, textDecoration: style.textDecorationLine,
              textDecorationStyle: style.textDecorationStyle,
              hit: button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
              clipped: button.scrollWidth > button.clientWidth + 1 };
          });
          const background = document.querySelector("[data-testid='open-help']");
          const bg = background?.getBoundingClientRect();
          return { rect: rect.toJSON(), backgroundColor: getComputedStyle(panel).backgroundColor,
            ancestors, buttons, focusInside: panel.contains(document.activeElement),
            backgroundBlocked: !bg || !background.contains(document.elementFromPoint(bg.left + bg.width / 2, bg.top + bg.height / 2)),
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(geometry.rect.left >= 0 && geometry.rect.top >= 0
          && geometry.rect.right <= width + 1 && geometry.rect.bottom <= height + 1, "退出弹窗越界");
        assert(geometry.focusInside && geometry.backgroundBlocked && geometry.overflow <= 1, "弹窗焦点/背景阻断/溢出失败");
        assert(geometry.ancestors.every(item => Number(item.opacity) > 0
          && item.visibility === "visible" && item.display !== "none"), "弹窗被祖先视觉隐藏");
        assert(geometry.buttons.every(button => button.hit && !button.clipped), "退出弹窗按钮被遮挡或裁切");
        const authoredExit = layout === "renpy" && authoredRoles
          ? await inspectAuthoredActions(page, dialog) : undefined;
        if (layout === "renpy" && !authoredRoles) {
          const actionButtons = geometry.buttons.filter(button => button.label !== "关闭退出游戏？");
          assert.equal(actionButtons.length, 2, "退出确认需要取消和确认两个操作");
          assert(actionButtons.every(button => button.borderWidth === "0px"
            && button.borderRadius === "0px"
            && button.background === "rgba(0, 0, 0, 0)"
            && button.backgroundImage === "none"
            && button.shadow === "none"),
          `Ren'Py确认操作默认使用文字按钮而非通用按钮容器: ${JSON.stringify({
            actionButtons,
            ancestors: geometry.ancestors,
            layoutType: await page.locator("body").getAttribute("data-layout-type"),
          })}`);
        }
        const screenshot = path.join(output, `${layout}-${width}x${height}-exit-open.png`);
        report.screenshots.push(await captureSourceBrowser(page, screenshot,
          { width, height, dpr: deviceScaleFactor, reduced }));
        const screenshotBytes = fs.readFileSync(screenshot);
        assert(await dialog.isVisible(), "截图之后退出弹窗不得消失");
        // Inert background nodes are excluded from hit testing even when they
        // paint ABOVE the modal. Check the painted surface as well as geometry.
        const pixel = await page.evaluate(async ({ imageUrl, x, y }) => {
          const image = new Image();
          image.src = imageUrl;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          return [...context.getImageData(Math.round(x * image.naturalWidth / innerWidth),
            Math.round(y * image.naturalHeight / innerHeight), 1, 1).data];
        }, { imageUrl: `data:image/png;base64,${screenshotBytes.toString("base64")}`,
          x: geometry.rect.left + geometry.rect.width / 2, y: geometry.rect.top + 8 });
        const expectedColor = geometry.backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number);
        assert(expectedColor?.length === 3, "无法读取本夹具弹窗背景颜色");
        report.cases.push({ layout, width, height, geometry, authoredExit, pixel, expectedColor, screenshot });
        assert(expectedColor.every((channel, index) => Math.abs(channel - pixel[index]) <= 20),
          `退出弹窗存在于 DOM 却未绘制在前景：${JSON.stringify({ pixel, expectedColor, geometry })}`);
        if (layout === "renpy" && !authoredRoles) {
          await page.keyboard.press("Tab");
          const focusedAction = await dialog.locator(".modal-actions > .ui-button").evaluateAll(buttons =>
            buttons.filter(button => button.matches(":focus-visible")).map(button => ({
              decoration: getComputedStyle(button).textDecorationLine,
              style: getComputedStyle(button).textDecorationStyle,
              shadow: getComputedStyle(button).boxShadow,
              rect: button.getBoundingClientRect().toJSON(),
            })));
          assert.equal(focusedAction.length, 1, "键盘Tab必须将焦点交给一个弹窗操作");
          assert(focusedAction[0].decoration.includes("underline")
            && focusedAction[0].style === "double", "键盘焦点必须以双线文字反馈");
          assert.equal(focusedAction[0].shadow, "none", "Ren'Py默认弹窗键盘焦点不得叠加全局光晕");
          const original = geometry.buttons.find(button => button.label === "取消").rect;
          assert.deepEqual(focusedAction[0].rect, original, "焦点反馈不得改变弹窗按钮几何");
        }
        report.cases[report.cases.length - 1].status = "PASS";
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
          expectedFocus, "关闭后焦点未恢复");

        const { dialog: deleteDialog, deleteTrigger } = await openSaveDeleteConfirmation(page, layout);
        const authoredDelete = layout === "renpy" && authoredRoles
          ? await inspectAuthoredActions(page, deleteDialog) : undefined;
        await deleteDialog.locator(".modal-actions > .ui-button").evaluateAll(buttons =>
          Promise.all(buttons.flatMap(button => button.getAnimations().map(animation =>
            animation.finished.catch(() => {})))));
        const deleteGeometry = await deleteDialog.evaluate(panel => {
          const rect = panel.getBoundingClientRect();
          const buttons = [...panel.querySelectorAll("button")].map(button => {
            const r = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return { label: button.textContent || button.getAttribute("aria-label"),
              rect: r.toJSON(), borderWidth: style.borderTopWidth,
              borderRadius: style.borderTopLeftRadius, background: style.backgroundColor,
              shadow: style.boxShadow,
              hit: button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
              clipped: button.scrollWidth > button.clientWidth + 1 };
          });
          return { screen: panel.getAttribute("data-runtime-screen"),
            layoutType: panel.getAttribute("data-layout-type"), rect: rect.toJSON(),
            focusInside: panel.contains(document.activeElement),
            buttons, overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert.equal(deleteGeometry.screen, "save_load",
          "存档删除确认必须保留 save_load 页面归属，供页面级按钮规则正确排除");
        assert.equal(deleteGeometry.layoutType, layout, "删除确认必须继承当前布局类型");
        assert(deleteGeometry.rect.left >= 0 && deleteGeometry.rect.top >= 0
          && deleteGeometry.rect.right <= width + 1 && deleteGeometry.rect.bottom <= height + 1,
        "存档删除确认弹窗越界");
        assert(deleteGeometry.focusInside && deleteGeometry.overflow <= 1
          && deleteGeometry.buttons.every(button => button.hit && !button.clipped),
        "存档删除确认焦点、命中或溢出失败");
        const deleteActions = deleteGeometry.buttons.filter(button => button.label !== "关闭删除存档");
        assert.equal(deleteActions.length, 2, "删除确认需要取消和确认两个操作");
        if (layout === "renpy") {
          assert(deleteActions.every(button => button.borderWidth !== "0px"
            && button.borderRadius !== "0px" && button.background !== "rgba(0, 0, 0, 0)"),
          `存档页的确认操作必须保留存档界面的容器样式例外: ${JSON.stringify(deleteActions)}`);
        }
        const deleteScreenshot = path.join(output, `${layout}-${width}x${height}-delete-open.png`);
        report.screenshots.push(await captureSourceBrowser(page, deleteScreenshot,
          { width, height, dpr: deviceScaleFactor, reduced }));
        report.cases.push({ layout, width, height, name: "save-delete-confirmation",
          geometry: deleteGeometry, authoredDelete, screenshot: deleteScreenshot, status: "PASS" });
        await page.keyboard.press("Escape");
        await deleteDialog.waitFor({ state: "hidden" });
        assert(await page.locator("[data-testid='save-slot-manual-1'].has-save").isVisible(),
          "取消删除必须保留真实创建的手动存档");
        assert(await deleteTrigger.evaluate(button => button === document.activeElement),
          "关闭删除确认后焦点必须恢复到删除操作");
      });
      await page.close(); page = undefined;
      }
    }
    assert.equal(report.cases.length, 12, "拒绝空矩阵或遗漏确认类型");
    assert(report.cases.every(entry => entry.status === "PASS"), "弹窗矩阵中有未通过用例");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    await browser?.close(); await server?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
