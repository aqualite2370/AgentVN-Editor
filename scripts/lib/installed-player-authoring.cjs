"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("../../editor/node_modules/jszip");
const A = require("./installed-acceptance.cjs");
const { desktopViewports } = require("./current-acceptance-viewports.cjs");
const { assertRenpyQuickBarGeometry } = require("./installed-portable-layout.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./installed-webview-capture.cjs");

const colors = {
  choice: { normal: "#dfc95b", hover: "#e6f6ff", selected: "#ffab8f", disabled: "#7d8e9f" },
  quick: { normal: "#68c4b7", hover: "#f7d68c", selected: "#ffadcc", disabled: "#81909c" },
};
const stateLabels = { normal: "普通", hover: "悬停", selected: "选中", disabled: "禁用" };
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const profiles = value => value.settings.runtimeUILayoutProfiles;
const part = (profile, id) => profile.screens.find(s => s.screen_id === "player").components.find(c => c.component_id === id);

async function settlePresentation(target) {
  await A.settleRuntime(target);
  return target.evaluate(() => new Promise((resolve, reject) => {
    const start = performance.now(), frames = []; let last, stable = 0;
    function sample() {
      const selectors = [".story-player", ".dialog-box", ".dialog-text", ".renpy-quick-bar", ".choice-panel"];
      const nodes = selectors.map(selector => {
        const n = document.querySelector(selector);
        if (!n) return null;
        const css = getComputedStyle(n);
        return { selector, rect: n.getBoundingClientRect().toJSON(), color: css.color, font: css.fontSize,
          background: css.backgroundColor, opacity: css.opacity, display: css.display };
      });
      const animations = document.getAnimations().filter(a =>
        ["running", "pending"].includes(a.playState) && a.effect?.getComputedTiming().iterations !== Infinity).length;
      const current = JSON.stringify(nodes);
      stable = !animations && current === last ? stable + 1 : 0; last = current;
      frames.push({ elapsedMs: performance.now() - start, nodes, animations });
      if (stable >= 3) resolve({ count: frames.length, elapsedMs: performance.now() - start, last: frames.slice(-4) });
      else if (performance.now() - start > 10000) reject(Error(`Presentation did not settle: ${JSON.stringify(frames.slice(-4))}`));
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }));
}

async function assertOrdinary(target) {
  await target.locator('.dialog-box[data-dialogue-layout-mode="dialog"]').waitFor();
  await target.waitForFunction(() => document.querySelector(".story-player")?.dataset.isTyping === "false");
  const settlement = await settlePresentation(target);
  const actual = await target.locator(".dialog-box").evaluate(n => {
    const text = n.querySelector(".dialog-text"), css = getComputedStyle(n);
    const r = n.getBoundingClientRect(), stage = n.closest(".story-player").getBoundingClientRect();
    const quick = document.querySelector(".renpy-quick-bar"), scale = Number(quick.dataset.uniformScale);
    return { rect: r.toJSON(), stage: stage.toJSON(), background: css.backgroundColor, radius: css.borderRadius,
      text: text.textContent, color: getComputedStyle(text).color, font: parseFloat(getComputedStyle(text).fontSize),
      textScale: Number(n.dataset.uiTextScale), left: n.style.left, width: n.style.width,
      continueDisplay: getComputedStyle(n.querySelector(".continue-indicator")).display,
      overflow: document.documentElement.scrollWidth - innerWidth,
      quick: { rect: quick.getBoundingClientRect().toJSON(), overflow: quick.scrollWidth - quick.clientWidth,
        scale, pageOverflow: document.documentElement.scrollWidth - innerWidth,
        buttons: [...quick.querySelectorAll("button")].map(button => {
          const r = button.getBoundingClientRect(); return { rect: r.toJSON(), label: button.textContent.trim(),
            clipped: button.scrollWidth > button.clientWidth + 1, color: getComputedStyle(button).color,
            font: parseFloat(getComputedStyle(button).fontSize),
            roleFont: getComputedStyle(button).getPropertyValue("--renpy-role-font-size"),
            quickFont: getComputedStyle(button).getPropertyValue("--renpy-quick-font"),
            disabled: button.disabled, hit: button.disabled || button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
        }) } };
  });
  assert.equal(actual.background, "rgba(40, 76, 114, 0.78)");
  assert.equal(actual.radius, "17px"); assert.equal(actual.color, "rgb(240, 208, 128)");
  assert(Math.abs(actual.font - 31 * actual.textScale) < .05, JSON.stringify(actual));
  assert.equal(actual.left, "12%"); assert.equal(actual.width, "76%");
  assert.equal(actual.continueDisplay, "none");
  assert.match(actual.text, /安装版普通对白作者消费验证/);
  assert(actual.rect.left >= actual.stage.left - 1 && actual.rect.right <= actual.stage.right + 1
    && actual.rect.top >= actual.stage.top - 1 && actual.rect.bottom <= actual.stage.bottom + 1
    && actual.overflow <= 1);
  assertRenpyQuickBarGeometry(actual.quick, { width: actual.stage.right, height: actual.stage.bottom });
  for (const button of actual.quick.buttons) {
    assert(Math.abs(button.rect.width - 74 * actual.quick.scale) < 1);
    assert(Math.abs(button.font - 18 * actual.quick.scale) < .1, JSON.stringify(actual.quick));
  }
  return { ...actual, settlement };
}

async function runPlayerAuthoring(C) {
  const { out, report, stage, snapshot, layout, saveLayout } = C;
  const page = () => C.context().page;
  const selectPart = id => layout().locator(`.runtime-layout-component-list button[data-component-id="${id}"]`).click();
  const geometry = () => layout().locator(".runtime-layout-inspector details")
    .filter({ has: page().locator("summary", { hasText: /^位置与尺寸$/ }) });
  const rectInput = index => geometry().locator('input[type="number"]').nth(index);
  async function openGeometry() {
    if (!await geometry().evaluate(node => node.open)) await geometry().locator("summary").click();
  }
  const appearance = () => layout().getByTestId("renpy-control-appearance");
  const styleLabels = { color: "文字颜色", backgroundColor: "背景颜色", borderColor: "边框颜色",
    fontSize: "文字大小", borderRadius: "圆角大小" };
  async function editStyle(id, key, value) {
    await selectPart(id);
    const field = appearance().getByLabel(`当前控件${styleLabels[key]}`, { exact: true });
    await field.fill(String(value)); assert.equal(await field.inputValue(), String(value));
  }
  const roleEditor = () => page().getByTestId("renpy-button-role-editor");
  const choose = (name, value) => A.select(page(), name, value);
  let originalAgent, active;

  await stage("installed-ordinary-structure-style-inheritance-and-restore-isolation", async () => {
    await C.options();
    await layout().locator('[data-layout-type-option="renpy"]').click();
    await page().getByTestId("renpy-player-layout-entry").click();
    await saveLayout(); originalAgent = structuredClone(profiles(await snapshot()).profiles.agentvn);
    const defaultPanelStyle = structuredClone(part(profiles(await snapshot()).profiles.renpy, "dialog_panel").style);
    await selectPart("dialog_panel"); await openGeometry();
    await rectInput(0).fill("12"); await rectInput(2).fill("76");
    await editStyle("dialog_text", "color", "#f0d080");
    await editStyle("dialog_panel", "backgroundColor", "#284c72");
    const background = appearance().locator("label").filter({
      has: page().getByLabel("当前控件背景颜色", { exact: true }),
    });
    await background.getByRole("button", { name: "恢复继承", exact: true }).click();
    assert(await background.getByRole("button", { name: "恢复继承", exact: true }).isDisabled());
    await saveLayout();
    const restored = profiles(await snapshot()).profiles.renpy;
    const expectedRestored = { ...defaultPanelStyle }; delete expectedRestored.backgroundColor;
    assert.deepEqual(part(restored, "dialog_panel").style, expectedRestored,
      "Per-property restore must clear only the selected background override");
    assert.equal(part(restored, "dialog_panel").rect.x, 12); assert.equal(part(restored, "dialog_panel").rect.width, 76);
    assert.equal(part(restored, "dialog_text").style.color, "#f0d080");
    await editStyle("dialog_panel", "backgroundColor", "#284c72");
    await editStyle("dialog_panel", "borderRadius", 17);
    await editStyle("dialog_text", "fontSize", 31);
    await selectPart("continue_indicator"); await page().getByTestId("runtime-layout-component-visible").uncheck();
    await selectPart("choice_list"); await openGeometry();
    assert.equal(await page().getByTestId("runtime-layout-component-visible").count(), 0);
    await rectInput(0).fill("42"); await saveLayout();
    assert.deepEqual(profiles(await snapshot()).profiles.agentvn, originalAgent);
    return { dialogX: 12, width: 76, choiceX: 42, font: 31, optionalIndicatorHidden: true, requiredChoiceCannotHide: true };
  });

  await stage("installed-story-choice-quick-bar-four-state-role-authoring-and-inheritance", async () => {
    const fields = layout().locator(".runtime-layout-inspector details")
      .filter({ has: page().locator("summary", { hasText: /^共享快捷栏样式$/ }) });
    if (!await fields.evaluate(node => node.open)) await fields.locator("summary").click();
    await choose("按钮角色", "剧情选项"); await choose("按钮样式范围", "共享样式");
    await roleEditor().getByLabel("按钮文字色", { exact: true }).fill("#42c6a1");
    await choose("按钮样式范围", "剧情页面覆盖");
    assert.equal(await roleEditor().getByTestId("renpy-title-button-role-source").innerText(), "继承共享");
    await roleEditor().getByLabel("按钮文字色", { exact: true }).fill("#dfc95b");
    await roleEditor().getByRole("button", { name: "恢复此角色共享继承", exact: true }).click();
    assert.equal(await roleEditor().getByTestId("renpy-title-button-role-source").innerText(), "继承共享");
    for (const [role, label] of [["choice", "剧情选项"], ["quick", "快捷栏"]]) {
      await choose("按钮角色", label);
      for (const [state, color] of Object.entries(colors[role])) {
        await choose("按钮状态", stateLabels[state]);
        await roleEditor().getByLabel("按钮文字色", { exact: true }).fill(color);
      }
      if (role === "quick") {
        await roleEditor().getByLabel("按钮宽度", { exact: true }).fill("74");
        await roleEditor().getByLabel("按钮字号", { exact: true }).fill("18");
      }
    }
    await saveLayout();
    const withLocalDefaults = structuredClone(profiles(await snapshot()).profiles.renpy);
    report.localQuickTypography = withLocalDefaults.screens.find(s => s.screen_id === "player").components
      .filter(c => c.component_type === "quick_button" && c.component_id !== "quick_main_menu_button"
        && c.style?.fontSize !== undefined)
      .map(c => ({ id: c.component_id, fontSize: c.style.fontSize }));
    // Local component typography has priority over a shared/page role. Exercise
    // the real per-property reset before asserting uniform role inheritance.
    // Keep the original mixed-size failure as evidence of that initial state.
    for (const local of report.localQuickTypography) {
      await selectPart(local.id);
      const field = appearance().getByLabel("当前控件文字大小", { exact: true });
      assert.equal(Number(await field.inputValue()), local.fontSize);
      const label = appearance().locator("label").filter({
        has: page().getByLabel("当前控件文字大小", { exact: true }),
      });
      await label.getByRole("button", { name: "恢复继承", exact: true }).click();
      assert.equal(await field.inputValue(), "");
    }
    await saveLayout(); active = structuredClone(profiles(await snapshot()).profiles.renpy);
    const expectedAfterResets = structuredClone(withLocalDefaults);
    for (const local of report.localQuickTypography) delete part(expectedAfterResets, local.id).style.fontSize;
    assert.deepEqual(active, expectedAfterResets,
      "Per-property inheritance reset must preserve every other author field, including the inactive main-menu control");
    assert.equal(active.renpy.shared.buttonRoles.story_choice.states.normal.textColor, "#42c6a1");
    for (const [role, id] of [["choice", "story_choice"], ["quick", "quick_bar"]])
      for (const [state, color] of Object.entries(colors[role]))
        assert.equal(active.renpy.player.buttonRoles[id].states[state].textColor, color);
    assert.equal(active.renpy.player.buttonRoles.quick_bar.geometry.width, 74);
    assert.deepEqual(profiles(await snapshot()).profiles.agentvn, originalAgent);
    return { colors, sharedChoiceNormal: "#42c6a1", quickWidth: 74, quickFont: 18 };
  });

  await stage("installed-author-actual-ordinary-preview-matrix", async () => {
    // Selecting a choice region intentionally previews a synthetic branch.
    // Return to the authored ordinary-dialogue region before this matrix.
    await selectPart("dialog_text");
    await page().getByTestId("renpy-player-runtime-preview-toggle").click();
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await C.metrics(page(), C.context().cdp, width, height, dpr, reduced);
      await A.settleEditor(page());
      const target = await C.preview();
      await page().mouse.move(0, 0);
      const actual = await assertOrdinary(target);
      const controls = [];
      for (const id of ["dialog_text", "choice_list"])
        controls.push(await C.clickable(layout().locator(`.runtime-layout-component-list button[data-component-id="${id}"]`)));
      const row = { width, height, dpr, reduced, actual, controls };
      row.viewportBefore = await readInstalledViewport(page(), row);
      report.matrix.push(row); C.save();
      if (C.capture) await C.capture(`author-player-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}`);
      else row.capture = await captureInstalledWebview(page(), C.context().cdp,
        path.join(out, `author-player-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`), row);
      row.viewportAfter = await readInstalledViewport(page(), row); C.save();
      console.log(`PASS installed ordinary author ${width} DPR${dpr} reduced=${reduced}`);
    }
    assert.equal(report.matrix.length, 12);
  });

  if (C.authoringOnly) {
    assert.equal(C.authoringOnly, "STRUCTURE_ROLES_PREVIEW_ONLY_NO_NATIVE_SAVE_CLAIM");
    return { active, originalAgent };
  }

  await stage("installed-ordinary-native-save-restart-reopen-preserves-authored-data", async () => {
    await C.metrics(page(), C.context().cdp, 1920, 1080, 1, false); await saveLayout();
    const expected = structuredClone(profiles(await snapshot()));
    await C.options("settings");
    const directory = path.join(out, "中文 作者工程"); fs.mkdirSync(directory);
    await C.native(page().locator('[data-help-key="settings.projectExportDirectory.choose"]:visible'),
      "player-save-directory", directory, false);
    await page().waitForFunction(value =>
      document.querySelector('[data-help-key="settings.projectExportDirectory.current"]')?.textContent.trim() === value, directory);
    await page().locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page());
    await page().getByRole("button", { name: "保存工程", exact: true }).click();
    await page().getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
    const files = fs.readdirSync(directory).filter(f => f.endsWith(".vnproj")); assert.equal(files.length, 1);
    const file = path.join(directory, files[0]), bytes = fs.readFileSync(file);
    const archive = await JSZip.loadAsync(bytes), data = JSON.parse(await archive.file("project.json").async("string"));
    assert.deepEqual(data.editor_settings.runtimeUILayoutProfiles, expected);
    assert(!JSON.stringify(data).includes(directory));
    report.projectArtifact = { path: file, sha256: A.sha256(bytes), generatedAt: fs.statSync(file).mtime.toISOString() };
    await C.restart();
    await page().getByRole("button", { name: "导入项目", exact: true }).waitFor();
    await C.native(page().getByRole("button", { name: "导入项目", exact: true }), "player-reopen", file, true);
    await page().locator(".editor-toolbar").waitFor(); await A.settleEditor(page());
    assert.deepEqual(profiles(await snapshot()), expected);
    return { projectArtifact: report.projectArtifact };
  });

  await stage("installed-publish-UI-cartridge-includes-authored-structure-and-role-bytes", async () => {
    await page().locator('[data-workspace-surface="publish"]:visible').click();
    const publishing = page().locator(".cartridge-export-panel"); await publishing.waitFor();
    await page().waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
    await A.dismissEnvironmentCompletion(page());
    await publishing.locator('[data-help-key="package.mode"]').click();
    await page().getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    await publishing.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
    const warning = publishing.getByRole("checkbox", { name: /我已检查全部警告/ });
    if (await warning.count()) await warning.check();
    report.cartridgeArtifact = await A.realDownload(page(), C.context().cdp, out, publishing.locator(".package-primary-action"));
    const archive = await JSZip.loadAsync(fs.readFileSync(report.cartridgeArtifact.path));
    const bytes = await archive.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(bytes);
    assert.equal(layout.layout_type, "renpy");
    assert.deepEqual(layout.screens, active.screens); assert.deepEqual(layout.renpy, active.renpy);
    report.layoutSha256 = A.sha256(bytes);
    report.exportedManifest = JSON.parse(await archive.file("manifest.json").async("string"));
    return { cartridgeArtifact: report.cartridgeArtifact, layoutSha256: report.layoutSha256 };
  });

  await stage("installed-player-consumes-ordinary-choice-quick-bar-and-real-state-matrix", async () => {
    const player = await C.openInstalledPlayer(report.cartridgeArtifact.path), target = player.page;
    await target.getByTestId("game-state-title").waitFor(); await A.settleRuntime(target);
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await C.metrics(target, player.cdp, width, height, dpr, reduced); await A.settleRuntime(target);
      await target.getByTestId("start-new-game").click(); await target.mouse.move(0, 0);
      const row = { width, height, dpr, reduced, ordinary: await assertOrdinary(target), states: {} };
      row.viewportBefore = await readInstalledViewport(target, row);
      report.currentPlayerMatrix = row;
      const quick = target.getByTestId("renpy-quick-bar");
      const rollback = target.getByTestId("renpy-quick-rollback");
      assert(await rollback.isDisabled(), "Entry scene has no previous user progress to rollback");
      row.states.disabled = await rollback.evaluate(n => getComputedStyle(n).color);
      assert.equal(row.states.disabled, rgb(colors.quick.disabled));
      const auto = target.getByTestId("renpy-quick-auto");
      row.states.normal = await auto.evaluate(n => getComputedStyle(n).color);
      assert.equal(row.states.normal, rgb(colors.quick.normal));
      await auto.hover(); await settlePresentation(target);
      row.states.hover = await auto.evaluate(n => getComputedStyle(n).color);
      assert.equal(row.states.hover, rgb(colors.quick.hover));
      await auto.click();
      await target.waitForFunction(() => document.querySelector('[data-testid="renpy-quick-auto"]')?.getAttribute("aria-pressed") === "true");
      // Selected feedback is a real action; stop auto immediately after its
      // state transition, before its unrelated story timer advances the line.
      await auto.evaluate(async node => {
        await Promise.all(node.getAnimations().map(a => a.finished.catch(() => {})));
      });
      row.states.selected = await auto.evaluate(n => getComputedStyle(n).color);
      assert.equal(row.states.selected, rgb(colors.quick.selected));
      await auto.click();
      assert.equal(await auto.getAttribute("aria-pressed"), "false");
      await target.locator(".dialog-box").click();
      await target.locator(".choice-panel").waitFor();
      const choice = target.getByRole("button", { name: "选择：继续", exact: true });
      await C.clickable(choice); await target.mouse.move(0, 0); await settlePresentation(target);
      row.choice = await target.locator(".choice-panel").evaluate(n => ({
        left: n.style.left, rect: n.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight,
        color: getComputedStyle(n.querySelector("button")).color,
        labels: [...n.querySelectorAll("button")].map(b => b.textContent.trim()),
      }));
      assert.equal(row.choice.left, "42%"); assert.equal(row.choice.color, rgb(colors.choice.normal));
      assert.deepEqual(row.choice.labels, ["继续", "重看"]);
      assert(row.choice.rect.left >= -1 && row.choice.rect.right <= width + 1
        && row.choice.rect.top >= -1 && row.choice.rect.bottom <= height + 1);
      await choice.hover(); await settlePresentation(target);
      row.choice.hover = await choice.evaluate(n => getComputedStyle(n).color);
      assert.equal(row.choice.hover, rgb(colors.choice.hover));
      await C.clickable(quick.getByRole("button", { name: "设置", exact: true }));
      row.capture = await captureInstalledWebview(target, player.cdp,
        path.join(out, `player-choice-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`), row);
      await choice.click();
      await target.locator(".choice-panel").waitFor({ state: "detached" });
      await target.waitForFunction(() => document.querySelector(".dialog-text")?.textContent.includes("安装版普通对白作者消费验证"));
      row.viewportAfter = await readInstalledViewport(target, row);
      report.playerMatrix.push(row); C.save();
      await target.reload({ waitUntil: "domcontentloaded" });
      await target.getByTestId("game-state-title").waitFor(); await A.settleRuntime(target);
      console.log(`PASS installed authored ordinary player ${width} DPR${dpr} reduced=${reduced}`);
    }
    assert.equal(report.playerMatrix.length, 12);
    return { states: "Quick-bar four rendered states; choice normal/hover, all four authored/exported",
      scope: "Real branch click returns to authored ordinary scene; other seven quick actions covered separately in P1" };
  });
}

module.exports = { runPlayerAuthoring, assertOrdinary, settlePresentation, colors };
