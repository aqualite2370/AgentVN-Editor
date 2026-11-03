"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { currentAcceptanceViewports } = require("./lib/current-acceptance-viewports.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, "..");
const fast = process.argv.includes("--fast");
const quickText = process.argv.includes("--quick-text");
const pauseExit = process.argv.includes("--pause-choice-exit");
const interruptions = process.argv.includes("--choice-interruptions");
const lifecycle = process.argv.includes("--choice-lifecycle") || interruptions;
const selectedCase = process.argv.find(argument => argument.startsWith("--case="))?.slice("--case=".length);
const workers = Number(process.argv.find(argument => argument.startsWith("--workers="))?.slice("--workers=".length) ?? 1);
assert(Number.isInteger(workers) && workers >= 1 && workers <= 2, "Use one or two isolated browser contexts");
const headless = process.env.ROLE_OPACITY_HEADFUL !== "1";
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT
  || path.join(root, "output/playwright/renpy-role-opacity", runId);
const report = { runId, status: "RUNNING", scope: "E4 actual role opacity; not installed acceptance", cases: [] };
report.scope = interruptions ? "SOURCE_RUNTIME_CONTROLLED_ANIMATION_CANCELLATION_ROLLBACK_AND_MENU_NOT_INSTALLED"
  : lifecycle ? "SOURCE_RUNTIME_ACTUAL_BRANCH_MENU_SAVE_LOAD_ROLLBACK_THREE_PRESENTATIONS_NOT_INSTALLED"
  : report.scope;
report.workers = workers;
const loaded = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(loaded, loaded.exports);
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
function payload(variant, id, presentation) {
  const skin = variant === "agentvn" ? loaded.exports.getDefaultUISkinLayout() : loaded.exports.createRenpyUILayout();
  const roles = ["title_action", "page_navigation", "category_pagination", "story_choice", "quick_bar", "modal_action"];
  skin.renpy ??= {};
  skin.renpy.shared = { buttonRoles: Object.fromEntries(roles.map(role => [role, {
    states: variant === "color-only" ? { normal: { textColor: "#81bbcc" } } : {
      normal: { opacity: .37 }, hover: { opacity: .74 }, selected: { opacity: .58 }, disabled: { opacity: .22 },
    },
  }])) };
  if (variant === "opacity") skin.renpy.preferences = {
    buttonRoles: { category_pagination: { states: { normal: { opacity: .46 } } } },
  };
  if (variant === "quick-text") {
    skin.renpy.shared.buttonRoles.quick_bar = { states: {
      normal: { textColor: "#98b4c0" }, hover: { textColor: "#12ab67" },
      selected: { textColor: "#ad78ef" }, disabled: { textColor: "#6a798b" },
    } };
    skin.advancedPresentationEnabled = true;
    const controls = skin.screens.find(screen => screen.screen_id === "player").components;
    const find = id => controls.find(component => component.component_id === `quick_${id}_button`);
    find("auto").style.color = "#eeaa22";
    delete find("history").style.color; // Actual "restore inheritance" result.
    find("skip").style.color = "#dd8844";
    find("skip").stateStyles = { normal: { color: "#3377bb" },
      hover: { color: "#44aabb" }, selected: { color: "#aa4499" } };
    find("settings").style.color = "#eeaa22";
    find("settings").presentation = { version: 1, html: '<div class="root"><slot name="content"></slot></div>',
      css: ".root { color: #2266bb; } .root:hover { color: #cc4488; }" };
  }
  const data = { uiSkin: skin,
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.14.0",
      game_id: id, title: "不透明度隔离验收", author: "QA", version: "1.0.0", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "main", assets: [] },
    script: { schema_version: "1.1.0", game_id: id, title: "不透明度", entry_scene_id: "main", characters: [],
      scenes: [
        { scene_id: "main", title: "隔离剧情", chapter: 1, tags: [], commands: [
          { type: "narration", text: "角色状态独立验收。" },
          { type: "choice", choices: [
            { choice_id: "a", text: "继续 A", target_scene_id: "next", conditions: [] },
            { choice_id: "b", text: "继续 B", target_scene_id: "next", conditions: [] },
          ] },
        ] },
        { scene_id: "next", title: "结果", chapter: 1, tags: [],
          commands: [{ type: "narration", text: "真实选择已完成。" }] },
      ] },
  };
  if (presentation) {
    data.script.schema_version = "1.10.0";
    data.manifest.runtime_version = "0.26.0";
    data.script.scenes[0].commands.splice(0, 1,
      { type: "narration", text: "分支前第一句。", presentation_mode: presentation },
      { type: "narration", text: "分支前第二句。", presentation_mode: presentation });
    data.script.scenes[1].commands[0].presentation_mode = presentation;
    // A second line prevents accidental completion from hiding duplicate input.
    data.script.scenes[1].commands.push({
      type: "narration", text: "不应由选择事件直接推进到这里。", presentation_mode: presentation,
    });
  }
  return data;
}
async function idle(page) {
  await page.waitForFunction(() => document.querySelector("[data-runtime-transition-phase]")?.dataset.runtimeTransitionPhase === "idle"
    && !document.querySelector(".game-launch-blackout"));
}
async function read(button) {
  return button.evaluate(async node => {
    // Compare settled state geometry, not a child sampled at 0.96 of the
    // modal's entrance morph against the same child after that morph ends.
    // Record the actual ancestor animations; do not suppress or finish them.
    const owners = [];
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) owners.push(ancestor);
    const animations = [...new Set(owners.flatMap(owner => owner.getAnimations()))].filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity);
    const settling = animations.map(animation => ({ state: animation.playState,
      target: animation.effect?.target?.className,
      keyframes: animation.effect?.getKeyframes().map(frame => ({ transform: frame.transform, opacity: frame.opacity })) }));
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { opacity: Number(style.opacity), rect: rect.toJSON(), disabled: node.disabled,
      hit: hit === node || node.contains(hit), clipped: node.scrollWidth > node.clientWidth + 1
        || node.scrollHeight > node.clientHeight + 1,
      role: node.dataset.renpyRoleCustom,
      opacityRole: node.dataset.renpyRoleOpacity ?? node.closest(".modal-panel")?.dataset.renpyRoleOpacity,
      background: style.backgroundColor, settling };
  });
}
async function runtimeSnapshot(page) {
  return page.evaluate(async () => {
    // Observation only. All actions below use actual visible controls/keys.
    const state = (await import("/src/store/runtimeStore.ts")).useRuntimeStore.getState();
    const engine = state.engineState;
    return JSON.parse(JSON.stringify({
      scene: engine.currentSceneId, command: engine.currentCommandIndex,
      choices: engine.choices, history: engine.history, variables: engine.variables,
      nvlPage: engine.nvlPage, nvlMode: engine.nvlPresentationMode,
      page: engine.dialogPageIndex, pageCount: engine.dialogPageCount,
    }));
  });
}
async function runLifecycle(page, entry, check) {
  const choice = page.getByRole("button", { name: "选择：继续 A", exact: true });
  const advance = () => page.getByTestId("game-state-playing").click({ position: { x: 12, y: 12 } });
  async function menu(action) {
    if (entry.variant === "agentvn") {
      if (await page.getByTestId("quick-menu-toggle").getAttribute("aria-expanded") !== "true")
        await page.getByTestId("quick-menu-toggle").click();
      await page.getByRole("button", { name: action === "history" ? "打开历史记录" : "打开存档读档", exact: true }).click();
    } else await page.getByTestId(`renpy-quick-${action}`).click();
    await idle(page);
  }
  async function back() {
    await page.keyboard.press("Escape");
    await page.getByTestId("game-state-playing").waitFor(); await idle(page);
  }
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor(); await idle(page);
  await page.evaluate(() => {
    window.__roleChoiceMotion = { running: true, frames: [] };
    const sample = () => {
      const node = document.querySelector(".choice-option");
      if (node) {
        const css = getComputedStyle(node), panel = node.closest(".choice-panel");
        window.__roleChoiceMotion.frames.push({
          at: performance.now(), opacity: Number(css.opacity), transform: css.transform,
          animation: css.animationName, phase: panel.classList.contains("is-exiting") ? "exit" : "enter",
          rect: node.getBoundingClientRect().toJSON(), disabled: node.disabled,
        });
      }
      if (window.__roleChoiceMotion.running) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  for (let attempt = 0; attempt < 10 && !await choice.count(); attempt++) await advance();
  await choice.waitFor();
  await read(choice);
  const initial = await runtimeSnapshot(page);
  check(initial.scene === "main" && initial.command === 2 && initial.choices.length === 2,
    "Fixture failed to reach its actual branch");
  const geometry = await page.locator(".choice-option").evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect(), css = getComputedStyle(node);
    return { box: box.toJSON(), scroll: [node.scrollWidth, node.clientWidth, node.scrollHeight, node.clientHeight],
      hit: node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)),
      opacity: css.opacity, transform: css.transform };
  }));
  for (const node of geometry) {
    check(node.hit && node.box.left >= 0 && node.box.top >= 0
      && node.box.right <= entry.viewport[0] + 1 && node.box.bottom <= entry.viewport[1] + 1,
    "Branch is not fully visible and hit-testable");
    check(node.scroll[0] <= node.scroll[1] + 1 && node.scroll[2] <= node.scroll[3] + 1,
      "Branch label clipped");
  }
  entry.checks.push({ label: "branch-reached-and-geometry", initial, geometry });
  if (entry.presentation === "nvl") {
    const lines = await page.locator("[data-nvl-line] .nvl-page-text").allTextContents();
    check(lines.join("").includes("分支前第一句。") && lines.join("").includes("分支前第二句。"),
      "NVL branch lost accumulated lines");
  }
  if (interruptions) {
    for (const action of ["cancel-animation", "rollback", "open-menu"]) {
      await page.evaluate(() => {
        const panel = document.querySelector(".choice-panel");
        const observer = new MutationObserver(() => {
          if (!panel.classList.contains("is-exiting")) return;
          const animations = panel.getAnimations({ subtree: true })
            .filter(animation => animation.animationName?.startsWith("choice-fade-out"));
          if (!animations.length) return;
          animations.forEach(animation => animation.pause());
          window.__choiceExitInterruption = { panel, animations, at: performance.now() };
          observer.disconnect();
        });
        observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
      });
      await choice.click();
      await page.waitForFunction(() => window.__choiceExitInterruption?.animations
        .some(animation => animation.playState === "paused"));
      assert.deepEqual(await runtimeSnapshot(page), initial, "Paused exit already committed selection");
      if (action === "cancel-animation") {
        await page.evaluate(() => window.__choiceExitInterruption.animations.forEach(animation => animation.cancel()));
        await page.waitForFunction(() => !document.querySelector(".choice-panel.is-exiting"));
      } else if (action === "rollback") {
        await page.keyboard.press("PageUp");
        await page.waitForFunction(() => document.querySelector("[data-testid='game-state-playing']")
          ?.dataset.currentCommandIndex === "1");
        const rolled = await runtimeSnapshot(page);
        check(rolled.scene === "main" && !rolled.choices.length, "Rollback did not replace the pending selection");
        for (let attempt = 0; attempt < 4 && !await choice.count(); attempt++) await advance();
      } else {
        await page.keyboard.press("Escape");
        await page.getByTestId("main-menu").waitFor(); await idle(page);
        assert.deepEqual(await runtimeSnapshot(page), initial, "Departing choice committed underneath menu");
        await back();
      }
      await choice.waitFor(); await read(choice);
      assert.deepEqual(await runtimeSnapshot(page), initial, `Stale selection survived ${action}`);
      const final = await page.evaluate(() => ({
        exiting: Boolean(document.querySelector(".choice-panel.is-exiting")),
        disabled: document.querySelector(".choice-option")?.disabled,
        inaccessibleFocus: Boolean(document.activeElement?.closest("[inert], [aria-hidden='true']")),
      }));
      check(!final.exiting && !final.disabled && !final.inaccessibleFocus,
        `${action} did not restore interaction/focus ownership`);
      entry.checks.push({ label: `controlled-exit-interruption/${action}`, final });
      // No listener or paused animation is left for the next action.
      await page.evaluate(() => { delete window.__choiceExitInterruption; });
    }
    await choice.click();
    await page.waitForFunction(() => document.querySelector("[data-testid='game-state-playing']")
      ?.dataset.currentSceneId === "next");
    check((await runtimeSnapshot(page)).command === 0, "Selection after interruption did not work");
    entry.choiceMotion = await page.evaluate(() => {
      window.__roleChoiceMotion.running = false;
      return window.__roleChoiceMotion.frames;
    });
    entry.checks.push({ label: "actual-selection-after-all-interruptions" });
    return;
  }
  await menu("history");
  await back();
  assert.deepEqual(await runtimeSnapshot(page), initial, "Menu roundtrip changed the branch/NVL snapshot");
  entry.checks.push({ label: "history-roundtrip-preserves-snapshot" });
  await menu("save-load");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "保存到手动存档 1", exact: true }).click();
  await page.locator('[data-testid="save-slot-manual-1"].has-save').waitFor();
  await back();
  assert.deepEqual(await runtimeSnapshot(page), initial, "Saving changed the live branch snapshot");
  entry.checks.push({ label: "actual-manual-save-preserves-snapshot" });
  // Actual rapid pointer activation; no store choose() or DOM dispatch.
  await choice.dblclick();
  await page.waitForFunction(() => document.querySelector("[data-testid='game-state-playing']")
    ?.dataset.currentSceneId === "next");
  const result = await runtimeSnapshot(page);
  check(result.command === 0 && result.choices.length === 0, "Repeated activation advanced past the selected result");
  entry.choiceMotion = await page.evaluate(() => {
    window.__roleChoiceMotion.running = false;
    return window.__roleChoiceMotion.frames;
  });
  const opacity = entry.variant === "agentvn" ? 1 : .37;
  check(entry.choiceMotion.some(frame => frame.phase === "enter"
    && frame.opacity > .001 && frame.opacity < opacity - .001), "Missing branch entry intermediate frame");
  check(entry.choiceMotion.some(frame => frame.phase === "exit"
    && frame.opacity > .001 && frame.opacity < (entry.variant === "agentvn" ? 1 : .22) - .001),
  "Missing branch exit intermediate frame");
  if (entry.reduced) check(entry.choiceMotion.every(frame => frame.transform === "none"),
    "Reduced branch moved in space");
  entry.checks.push({ label: "real-double-click-single-selection", result });
  await page.keyboard.press("PageUp");
  await choice.waitFor(); await read(choice);
  const rollback = await runtimeSnapshot(page);
  check(rollback.scene === initial.scene && rollback.command === initial.command
    && rollback.choices.length === initial.choices.length, "Rollback did not restore the branch");
  assert.deepEqual(rollback.nvlPage, initial.nvlPage, "Rollback changed accumulated NVL content");
  entry.checks.push({ label: "actual-rollback-restores-branch", rollback });
  await page.keyboard.press("PageDown");
  await page.waitForFunction(() => document.querySelector("[data-testid='game-state-playing']")
    ?.dataset.currentSceneId === "next");
  assert.deepEqual(await runtimeSnapshot(page), result, "Roll-forward duplicated history or changed result");
  entry.checks.push({ label: "actual-roll-forward-preserves-result" });
  await menu("save-load");
  await page.getByRole("button", { name: "读取", exact: true }).click();
  await page.getByRole("button", { name: "读取手动存档 1", exact: true }).click();
  await page.getByTestId("game-state-playing").waitFor(); await idle(page); await choice.waitFor();
  assert.deepEqual(await runtimeSnapshot(page), initial, "Manual load failed to restore exact branch/NVL state");
  entry.checks.push({ label: "actual-load-restores-branch" });
  await choice.click();
  await page.waitForFunction(() => document.querySelector("[data-testid='game-state-playing']")
    ?.dataset.currentSceneId === "next");
  const reselected = await runtimeSnapshot(page);
  assert.deepEqual(reselected.history.slice(0, initial.history.length), initial.history,
    "Selecting after load changed existing history identities");
  assert.equal(reselected.history.length, initial.history.length + 1,
    "Selecting after load duplicated dialogue/history");
  const semanticResult = snapshot => ({ ...snapshot,
    history: snapshot.history.map(({ id, timestamp, ...content }) => content) });
  // Re-executing a branch after load creates a new history entry, with its
  // own actual ID and timestamp. Roll-forward above must restore exact IDs.
  assert.deepEqual(semanticResult(reselected), semanticResult(result),
    "Selecting after load changed semantic result/NVL content");
  entry.checks.push({ label: "selection-after-load-preserves-history", reselected });
}
async function runCase(server, browser, viewport, dpr, reduced, variant, presentation) {
  const id = `${viewport[0]}-dpr${dpr}-reduced${reduced}-${variant}${presentation ? `-${presentation}` : ""}`;
  const entry = { id, viewport, dpr, reduced, variant, presentation, status: "RUNNING", checks: [], failures: [] };
  const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] },
    deviceScaleFactor: dpr, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  const check = (condition, message) => { if (!condition) entry.failures.push(message); };
  async function state(button, label, expected, stable) {
    const data = await read(button);
    entry.checks.push({ label, expected, actual: data });
    check(Math.abs(data.opacity - expected) < .01, `${label}: opacity ${data.opacity}, expected ${expected}`);
    check(data.disabled || data.hit, `${label}: button not hit`);
    check(!data.clipped && data.rect.left >= -1 && data.rect.top >= -1
      && data.rect.right <= viewport[0] + 1 && data.rect.bottom <= viewport[1] + 1, `${label}: clipped or outside viewport`);
    if (stable) check(Math.abs(data.rect.width - stable.rect.width) < 1
      && Math.abs(data.rect.height - stable.rect.height) < 1, `${label}: state changed geometry`);
    if (variant === "opacity") check(data.opacityRole === "true", `${label}: missing opacity ownership`);
    if (variant === "color-only") check(data.opacityRole !== "true", `${label}: color-only override acquired opacity ownership`);
    return data;
  }
  async function normalAndHover(button, label, normal = .37) {
    await page.mouse.move(1, 1);
    await page.evaluate(() => document.activeElement?.blur?.());
    const baseline = await state(button, `${label}/normal`, variant === "opacity" ? normal : 1);
    await button.hover();
    await state(button, `${label}/hover`, variant === "opacity" ? .74 : 1, baseline);
    await button.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await page.mouse.move(1, 1);
    await state(button, `${label}/keyboard-focus`, variant === "opacity" ? .74 : 1, baseline);
    await page.evaluate(() => document.activeElement?.blur?.());
    return baseline;
  }
  try {
    await server.assertAlive();
    await page.goto(`${server.url}/?mode=preview`);
    await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
    await page.evaluate(data => window.postMessage({ type: "agentvn.live-preview.init",
      protocolVersion: 2, sessionId: data.manifest.game_id, revision: 1,
      requestId: "opacity", runId: "opacity", screen: "title_menu", ...data }, "*"), payload(variant, id, presentation));
    await page.getByTestId("start-new-game").waitFor();
    await idle(page);
    if (lifecycle) {
      await runLifecycle(page, entry, check);
    } else if (variant === "quick-text") {
      await page.getByTestId("start-new-game").click();
      await page.getByTestId("game-state-playing").waitFor(); await idle(page);
      const auto = page.getByTestId("renpy-quick-auto");
      const history = page.getByTestId("renpy-quick-history");
      const skip = page.getByTestId("renpy-quick-skip");
      const settings = page.getByTestId("renpy-quick-settings");
      async function text(button, label, expected) {
        await read(button); // Wait for actual entry/state transitions.
        const value = await button.evaluate(node => {
          const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
          return { color: css.color, rect: rect.toJSON(), state: node.dataset.renpyRoleState,
            disabled: node.disabled, hit: node.contains(document.elementFromPoint(
              rect.x + rect.width / 2, rect.y + rect.height / 2)) };
        });
        entry.checks.push({ label, expected, actual: value });
        check(value.color === expected, `${label}: ${value.color}, expected ${expected}`);
        check(value.disabled || value.hit, `${label}: not hit`);
        check(value.rect.left >= -1 && value.rect.top >= -1 && value.rect.right <= viewport[0] + 1
          && value.rect.bottom <= viewport[1] + 1, `${label}: outside viewport`);
        return value;
      }
      await page.mouse.move(1, 1);
      const normal = await text(auto, "local-normal", "rgb(238, 170, 34)");
      await text(history, "restored-shared-normal", "rgb(152, 180, 192)");
      await text(skip, "local-state-normal", "rgb(51, 119, 187)");
      await text(settings, "code-over-local-normal", "rgb(34, 102, 187)");
      await settings.hover(); await text(settings, "code-hover", "rgb(204, 68, 136)");
      await auto.hover(); const hovered = await text(auto, "shared-hover", "rgb(18, 171, 103)");
      await auto.click(); await page.mouse.move(1, 1);
      const selected = await text(auto, "shared-selected", "rgb(173, 120, 239)");
      check(await auto.getAttribute("aria-pressed") === "true", "real auto toggle failed");
      await auto.click(); await page.mouse.move(1, 1);
      await text(auto, "local-after-toggle", "rgb(238, 170, 34)");
      // Exercise the actual disabled state: no rollback exists at initial command.
      await text(page.getByTestId("renpy-quick-rollback"), "shared-disabled", "rgb(106, 121, 139)");
      check(await page.getByTestId("renpy-quick-rollback").isDisabled(), "rollback must really be disabled");
      await skip.hover(); await text(skip, "local-state-hover", "rgb(68, 170, 187)");
      await skip.click(); await page.mouse.move(1, 1);
      await text(skip, "local-state-selected", "rgb(170, 68, 153)");
      check(await skip.getAttribute("aria-pressed") === "true", "real skip toggle failed");
      await skip.click(); await page.mouse.move(1, 1);
      for (const next of [hovered, selected]) for (const key of ["x", "y", "width", "height"])
        check(Math.abs(next.rect[key] - normal.rect[key]) <= .15, `state changed ${key}`);
      const items = await page.getByTestId("renpy-quick-bar").locator("button").evaluateAll(nodes =>
        nodes.map(node => node.getBoundingClientRect().toJSON()));
      check(items.length === 9 && items.every((r, i) => Math.abs(r.y - items[0].y) <= 1
        && (!i || r.left >= items[i - 1].right - 1)), "nine actions overlap or wrap");
    } else if (variant === "agentvn") {
      await page.getByTestId("open-settings").click();
      await page.locator(".settings-tabs").waitFor();
      await idle(page);
      for (const button of await page.locator(".settings-tabs button").all()) {
        check(await button.getAttribute("data-renpy-role-custom") === null, "AgentVN applied Ren'Py role");
        check(await button.getAttribute("data-renpy-role-opacity") === null, "AgentVN applied opacity override");
      }
      check(await page.locator('[data-renpy-role-opacity="true"]').count() === 0, "AgentVN role leaked");
    } else {
      await normalAndHover(page.getByTestId("start-new-game"), "title_action");
      // Real disabled title entry, not a modified DOM or internal store.
      const disabledTitle = page.getByTestId("continue-game");
      if (await disabledTitle.count()) await state(disabledTitle, "title_action/disabled", variant === "opacity" ? .22 : .55);
      await page.getByTestId("open-settings").click();
      await page.locator(".settings-tabs").waitFor(); await idle(page);
      await normalAndHover(page.getByTestId("renpy-menu-about"), "page_navigation");
      const text = page.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true });
      await normalAndHover(text, "preferences/category_pagination", .46);
      await text.click(); await page.mouse.move(1, 1); await page.evaluate(() => document.activeElement?.blur?.());
      await state(text, "preferences/category_pagination/selected", variant === "opacity" ? .58 : 1);
      await page.getByTestId("renpy-menu-save-load").click();
      await page.getByTestId("save-page-next").waitFor(); await idle(page);
      await normalAndHover(page.getByTestId("save-page-next"), "save_load/category_pagination");
      await page.mouse.move(1, 1); await page.evaluate(() => document.activeElement?.blur?.());
      await state(page.getByTestId("save-page-previous"), "category_pagination/disabled", variant === "opacity" ? .22 : .55);
      await state(page.getByTestId("renpy-menu-save-load"), "page_navigation/selected", variant === "opacity" ? .58 : 1);
      await page.getByTestId("save-page-next").click();
      await page.getByTestId("save-slot-manual-7").waitFor();
      await page.getByTestId("renpy-menu-return").click();
      await page.getByTestId("start-new-game").waitFor(); await idle(page);
      await page.getByTestId("start-new-game").click();
      await page.getByTestId("game-state-playing").waitFor(); await idle(page);
      await page.evaluate(() => {
        window.__roleChoiceMotion = { running: true, frames: [] };
        const sample = () => {
          const button = document.querySelector(".choice-option");
          if (button) {
            const css = getComputedStyle(button);
            window.__roleChoiceMotion.frames.push({ at: performance.now(), opacity: Number(css.opacity),
              phase: button.closest(".choice-panel").classList.contains("is-exiting") ? "exit" : "enter",
              target: css.getPropertyValue("--renpy-role-current-opacity"),
              animation: css.animationName });
          }
          if (window.__roleChoiceMotion.running) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      for (let attempt = 0; attempt < 5 && !await page.getByRole("button", { name: "选择：继续 A" }).count(); attempt++)
        await page.getByTestId("game-state-playing").click({ position: { x: 12, y: 12 } });
      const choice = page.getByRole("button", { name: "选择：继续 A" });
      await choice.waitFor();
      await normalAndHover(choice, "story_choice");
      await normalAndHover(page.getByTestId("renpy-quick-auto"), "quick_bar");
      await page.getByTestId("renpy-quick-auto").click();
      await page.mouse.move(1, 1); await page.evaluate(() => document.activeElement?.blur?.());
      await state(page.getByTestId("renpy-quick-auto"), "quick_bar/selected", variant === "opacity" ? .58 : 1);
      await page.getByTestId("renpy-quick-auto").click();
      await page.getByTestId("renpy-quick-save").click();
      await page.getByTestId("renpy-quick-save").waitFor({ state: "visible" });
      await page.waitForFunction(() => !document.querySelector("[data-testid='renpy-quick-save']")?.disabled);
      await page.getByTestId("renpy-quick-load").click();
      const confirm = page.getByTestId("confirm-quick-load");
      await confirm.waitFor();
      await normalAndHover(confirm, "modal_action");
      await page.getByRole("dialog", { name: "读取最新快存？", exact: true }).getByRole("button", { name: "取消", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      if (pauseExit && variant === "opacity") {
        await page.evaluate(() => {
          const panel = document.querySelector(".choice-panel");
          const observer = new MutationObserver(() => {
            if (!panel.classList.contains("is-exiting")) return;
            const animations = panel.getAnimations({ subtree: true })
              .filter(animation => animation.animationName?.startsWith("choice-fade-out"));
            if (!animations.length) return;
            animations.forEach(animation => animation.pause());
            window.__choiceExitBarrier = { panel, animations, at: performance.now() };
            observer.disconnect();
          });
          observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
        });
      }
      await choice.click();
      if (pauseExit && variant === "opacity") {
        await page.waitForFunction(() => window.__choiceExitBarrier?.animations.length > 0);
        // Controlled failure injection: hold past the legacy 180ms removal
        // timer. This delay is a test stimulus, never a readiness substitute.
        entry.exitBarrier = await page.evaluate(async () => {
          const barrier = window.__choiceExitBarrier;
          await new Promise(resolve => setTimeout(resolve, 300));
          return { connected: barrier.panel.isConnected, elapsed: performance.now() - barrier.at,
            states: barrier.animations.map(animation => animation.playState),
            targetsConnected: barrier.animations.map(animation => animation.effect.target.isConnected),
            resultVisible: [...document.querySelectorAll(".dialog-text")]
              .some(node => node.textContent.includes("真实选择已完成。")) };
        });
        check(entry.exitBarrier.connected && !entry.exitBarrier.resultVisible
          && entry.exitBarrier.states.every(state => state === "paused"),
        "Selection committed before the actual paused exit animations completed");
        await page.evaluate(() => window.__choiceExitBarrier.animations.forEach(animation => animation.play()));
      }
      await page.getByText("真实选择已完成。", { exact: true }).waitFor();
      entry.choiceMotion = await page.evaluate(() => {
        window.__roleChoiceMotion.running = false;
        return window.__roleChoiceMotion.frames;
      });
      {
        check(entry.choiceMotion.some(frame => frame.phase === "enter" && frame.animation.includes("choice-fade-in")
          && frame.opacity > .001 && frame.opacity < (variant === "opacity" ? .37 : 1) - .001),
        "Choice entry lost actual opacity intermediate frames");
        check(entry.choiceMotion.some(frame => frame.phase === "exit" && frame.animation.includes("choice-fade-out")
          && frame.opacity > 0 && frame.opacity < (variant === "opacity" ? .22 : 1)),
        "Choice exit lost actual opacity intermediate frames");
        if (reduced) check(entry.choiceMotion.filter(frame => frame.phase === "exit").length > 0,
          "Reduced motion must retain an actual exit presentation");
      }
      const roles = new Set(entry.checks.map(row => row.label.split("/")[0]));
      for (const role of ["title_action", "page_navigation", "save_load", "story_choice", "quick_bar", "modal_action"])
        check(roles.has(role), `missing actual role coverage: ${role}`);
    }
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "horizontal overflow");
    check(errors.length === 0, `Runtime errors: ${errors.join(";")}`);
    entry.screenshot = await captureSourceBrowser(page, path.join(output, `${id}.png`),
      { width: viewport[0], height: viewport[1], dpr, reduced });
    entry.status = entry.failures.length ? "FAILED" : "PASS";
  } catch (error) {
    entry.status = "FAILED"; entry.error = String(error.stack || error);
    await page.screenshot({ path: path.join(output, `${id}-failure.png`) }).catch(() => {});
  } finally {
    report.cases.push(entry); save(); await context.close();
    console.log(`${entry.status} ${id}`);
  }
}
(async () => {
  assert(!fs.existsSync(output), "Never overwrite a historical run");
  fs.mkdirSync(output, { recursive: true });
  report.headless = headless;
  let server, browser;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), port: 0, logFile: path.join(output, "server.log") });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch({ headless, args: headless ? [] : [
      "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows", "--disable-features=CalculateNativeWinOcclusion",
    ] });
    const viewports = currentAcceptanceViewports(fast ? [[1920, 1080]] : undefined);
    const pending = [];
    for (const viewport of viewports) for (const dpr of fast ? [1] : [1, 2])
      for (const reduced of fast ? [false] : [false, true])
        for (const variant of lifecycle ? ["opacity", "agentvn"] : quickText ? ["quick-text"] : ["opacity", "color-only", "agentvn"])
          for (const presentation of interruptions ? ["dialog"] : lifecycle ? ["dialog", "nvl", "bubble"] : [undefined])
            if (!selectedCase || selectedCase === `${viewport[0]}-dpr${dpr}-reduced${reduced}-${variant}${presentation ? `-${presentation}` : ""}`) {
              pending.push(server.run(() => runCase(server, browser, viewport, dpr, reduced, variant, presentation)));
              if (pending.length >= workers) { await Promise.all(pending); pending.length = 0; }
            }
    await Promise.all(pending);
    assert.equal(report.cases.length, selectedCase ? 1 : interruptions ? fast ? 2 : 24
      : lifecycle ? fast ? 6 : 72 : quickText ? fast ? 1 : 12 : fast ? 3 : 36);
    assert(report.cases.every(row => row.status === "PASS"), "Role opacity regressions failed");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    await browser?.close(); await server?.stop(); report.finishedAt = new Date().toISOString(); save();
    console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
