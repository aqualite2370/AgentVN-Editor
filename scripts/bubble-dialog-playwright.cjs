"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { currentAcceptanceViewports } = require("./lib/current-acceptance-viewports.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/bubble-dialog", runId);
const viewports = currentAcceptanceViewports(process.env.BUBBLE_VIEWPORTS
  ? JSON.parse(process.env.BUBBLE_VIEWPORTS) : undefined);
const authoredLayout = process.argv.includes("--authored-layout");
const longSpeaker = process.argv.includes("--long-speaker");
const restoredPagination = process.argv.includes("--restored-pagination");
const classicScrollbars = process.argv.includes("--classic-scrollbars");
const report = { runId, status: "RUNNING", authoredLayout, longSpeaker, restoredPagination, classicScrollbars, cases: [] };
let activePage;
// Controlled media boundary measures duplicate play requests, not audible output.
const voiceData = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
const longBubbleText = longSpeaker
  ? "气泡超长验收：角色移动与边缘安全区不裁切文字，达到字号下限后按页推进。".repeat(70)
  : Array.from({ length: 80 }, (_, index) =>
  `第${index + 1}句：气泡长文本必须在可读字号下分页，任何一句都不能在画面边缘被裁切。\n  缩进、空行与标点也必须保留。`).join("\n\n");
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

async function startRuntime(page, url) {
  const uiSkin = loaded.exports.createRenpyUILayout();
  if (authoredLayout) uiSkin.dialogueLayouts = {
    bubble: { rect: { x: 50, y: 18, width: 30, height: 16, anchor: "center" },
      textStyle: { fontSize: 26 } },
  };
  await page.goto(`${url}/?mode=preview`);
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
  await page.evaluate(({ uiSkin, voiceData, longBubbleText, longSpeaker }) => window.postMessage({
    type: "agentvn.live-preview.init",
    protocolVersion: 2,
    sessionId: "bubble-dialog-acceptance",
    revision: 1,
    requestId: "bubble-dialog-acceptance",
    runId: "bubble-dialog-acceptance",
    screen: "title_menu",
    uiSkin,
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.18.0",
      game_id: "bubble-dialog-acceptance",
      title: "气泡对白验收",
      author: "QA",
      version: "1.0.0",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "main",
      assets: [{ asset_id: "fixed-voice", asset_type: "voice", path: "assets/fixed.wav", mime_type: "audio/wav" },
        { asset_id: "offset-voice", asset_type: "voice", path: "assets/offset.wav", mime_type: "audio/wav" }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    script: {
      schema_version: "1.10.0",
      game_id: "bubble-dialog-acceptance",
      title: "气泡对白验收",
      entry_scene_id: "main",
      default_dialog_presentation: "bubble",
      characters: [{ character_id: "alice", name: "小岚", dialog_presentation: "bubble" }],
      scenes: [{
        scene_id: "main",
        title: "气泡位置和交互",
        chapter: 1,
        tags: [],
        commands: [
          { type: "sprite", character_id: "alice", sprite_id: "placeholder", position: "center", visible: true },
          { type: "dialog", character_id: "alice", text: "人物立绘上方的气泡对白应留有间距，并且完整显示。" },
          { type: "narration", text: "旁白没有人物立绘时应回退到画面上方，并避开快捷栏。" },
          { type: "sprite", character_id: "alice", sprite_id: "placeholder", position: "right", visible: false },
          { type: "dialog", character_id: "alice", text: "人物离场后仍需回退到安全的画面位置。", presentation_mode: "bubble" },
          { type: "dialog", character_id: "alice", text: "固定锚点靠近快捷栏时也应安全避让。",
            voice: "fixed-voice",
            bubble_position: { mode: "fixed", x: 50, y: 98 } },
          { type: "sprite", character_id: "alice", sprite_id: "placeholder", position: "center", visible: true },
          { type: "dialog", character_id: "alice", text: "角色偏移应跟随可见立绘。",
            voice: "offset-voice",
            bubble_position: { mode: "character", offset_x: 5, offset_y: -2 } },
          { type: "camera", motion: { schema_version: 1, kind: "reframe",
            to: { center_x: 0.5, center_y: 0.5, zoom: 1.15 }, duration_ms: 240, easing: "linear" },
            blocking: false },
          { type: "sprite", character_id: "alice", sprite_id: "placeholder", position: "right",
            scale: 1.1, visible: true },
          { type: "dialog", character_id: "alice", text: "镜头和立绘变换后气泡仍应跟随角色。" },
          ...(longSpeaker ? [{ type: "sprite", character_id: "alice", visible: false }] : []),
          { type: longSpeaker ? "dialog" : "narration", ...(longSpeaker
            ? { character_id: "alice", bubble_position: { mode: "fixed", x: 94, y: 94 } } : {}), text: longBubbleText },
        ],
      }],
    },
    assetUrls: { "fixed-voice": voiceData, "offset-voice": `${voiceData}#offset` },
  }, "*"), { uiSkin, voiceData, longBubbleText, longSpeaker });
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor();
  await page.locator(".game-launch-blackout").waitFor({ state: "detached" });
}

async function advanceDialog(page) {
  const dialog = page.locator(".dialog-box");
  await dialog.focus();
  if (await page.getByTestId("game-state-playing").getAttribute("data-is-typing") === "true") {
    await dialog.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-testid='game-state-playing']")
      ?.getAttribute("data-is-typing") === "false");
  }
  const previous = await page.getByTestId("game-state-playing").getAttribute("data-current-command-index");
  await dialog.press("Enter");
  await page.waitForFunction(index => document.querySelector("[data-testid='game-state-playing']")
    ?.getAttribute("data-current-command-index") !== index, previous);
  await page.waitForTimeout(40);
}

async function inspectBubble(page, scenario, viewport) {
  await page.waitForFunction(() => document.querySelector("[data-testid='game-state-playing']")?.dataset.isTyping === "false");
  await page.waitForFunction(() => {
    const dialog = document.querySelector(".dialog-box.is-bubble-presentation");
    return dialog?.dataset.dialogBubbleAnchor !== "pending";
  });
  await page.waitForFunction(() => {
    const dialog = document.querySelector(".dialog-box.is-bubble-presentation");
    if (!dialog || dialog.getAnimations().some(animation => animation.playState === "running")) return false;
    const rect = dialog.getBoundingClientRect();
    const signature = [rect.x, rect.y, rect.width, rect.height, dialog.dataset.dialogBubbleAnchor].join(",");
    const last = window.__bubbleSettled;
    const frames = last?.signature === signature ? last.frames + 1 : 0;
    window.__bubbleSettled = { signature, frames };
    return frames >= 3;
  });
  const geometry = await page.locator(".dialog-box").evaluate((dialog) => {
    const player = document.querySelector(".story-player");
    const quickBar = player?.querySelector(".renpy-quick-bar, .playback-controls");
    const speakerId = dialog.getAttribute("data-dialog-character-id");
    const sprite = speakerId
      ? [...(player?.querySelectorAll(".sprite-slot[data-character-id]") ?? [])]
          .find(node => node.getAttribute("data-character-id") === speakerId
            && node.getAttribute("data-sprite-phase") !== "exiting")
      : null;
    const visual = sprite?.querySelector(".sprite-visual, .sprite-placeholder") ?? sprite;
    const tail = dialog.querySelector(".dialog-bubble-tail");
    const spriteRect = visual?.getBoundingClientRect();
    const head = spriteRect ? {
      x: spriteRect.x,
      y: spriteRect.y,
      width: spriteRect.width,
      height: Math.min(84, Math.max(32, spriteRect.height * 0.16)),
    } : null;
    return {
      bubble: dialog.getBoundingClientRect().toJSON(),
      player: player.getBoundingClientRect().toJSON(),
      text: dialog.querySelector(".dialog-text")?.getBoundingClientRect().toJSON(),
      textScrollWidth: dialog.querySelector(".dialog-text")?.scrollWidth,
      textClientWidth: dialog.querySelector(".dialog-text")?.clientWidth,
      textMetrics: (() => {
        const text = dialog.querySelector(".dialog-text");
        const style = text && getComputedStyle(text);
        return {
          fontSize: style?.fontSize, lineHeight: style?.lineHeight,
          inlineFontSize: text?.style.fontSize, fontFamily: style?.fontFamily,
          scrollHeight: text?.scrollHeight, clientHeight: text?.clientHeight,
          fontMode: dialog.dataset.dialogFontMode, fontScale: dialog.dataset.dialogFontScale,
          animations: dialog.getAnimations({ subtree: true }).map(animation => ({
            playState: animation.playState,
            target: animation.effect?.target?.className,
            property: animation.transitionProperty,
            timing: animation.effect?.getComputedTiming(),
          })),
        };
      })(),
      quickBar: quickBar?.getBoundingClientRect().toJSON() ?? null,
      sprite: visual?.getBoundingClientRect().toJSON() ?? null,
      head,
      anchor: dialog.getAttribute("data-dialog-bubble-anchor"),
      tail: dialog.getAttribute("data-dialog-bubble-tail"),
      tailVisibility: tail ? getComputedStyle(tail).display : "missing",
      mode: dialog.getAttribute("data-dialog-content-mode"),
      textContent: dialog.querySelector(".dialog-text")?.textContent?.trim(),
    };
  });
  (report.inspections ??= []).push({ scenario, viewport, geometry });
  const { bubble, player } = geometry;
  assert(bubble.left >= player.left + 8 && bubble.right <= player.right - 8,
    `${scenario}: bubble must remain within the horizontal safe area: ${JSON.stringify(geometry)}`);
  assert(bubble.top >= player.top + 8 && bubble.bottom <= player.bottom - 8,
    `${scenario}: bubble must remain within the vertical safe area: ${JSON.stringify(geometry)}`);
  assert(geometry.textScrollWidth <= geometry.textClientWidth + 1,
    `${scenario}: bubble text must not overflow horizontally`);
  assert(geometry.textContent?.length > 0, `${scenario}: bubble must render its dialogue rather than an empty frame`);
  if (geometry.quickBar) {
    const overlapsQuickBar = bubble.left < geometry.quickBar.right
      && bubble.right > geometry.quickBar.left
      && bubble.top < geometry.quickBar.bottom
      && bubble.bottom > geometry.quickBar.top;
    assert(!overlapsQuickBar, `${scenario}: bubble must avoid the quick bar: ${JSON.stringify(geometry)}`);
  }
  if (scenario === "character" || scenario === "offset-character") {
    assert.equal(geometry.anchor, "character", "a visible speaking sprite should anchor the bubble");
    assert.notEqual(geometry.tailVisibility, "none", "character-anchored bubbles should show a directional tail");
    const head = geometry.head;
    assert(head, "the visible speaking sprite should expose a measurable head anchor");
    const overlapsHead = bubble.left < head.x + head.width
      && bubble.right > head.x
      && bubble.top < head.y + head.height
      && bubble.bottom > head.y;
    const horizontalGap = Math.max(0, head.x - bubble.right, bubble.left - (head.x + head.width));
    const verticalGap = Math.max(0, head.y - bubble.bottom, bubble.top - (head.y + head.height));
    assert(!overlapsHead && Math.hypot(horizontalGap, verticalGap) <= 80,
      `character bubble should stay close to, and not cover, the speaker's head anchor: ${JSON.stringify(geometry)}`);
  } else if (scenario === "fixed") {
    assert.equal(geometry.anchor, "fixed", "authored fixed anchor must survive quick-bar avoidance");
  } else {
    assert.equal(geometry.anchor, "fallback", `${scenario}: absent speaker sprite should use the safe fallback`);
    assert.equal(geometry.tailVisibility, "none", "a fallback narration bubble must not show a misleading character tail");
  }
  await page.screenshot({ path: path.join(output, `${scenario}-${viewport.width}x${viewport.height}-dpr${viewport.deviceScaleFactor}.png`) });
  return geometry;
}

async function runCase(browser, server, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    reducedMotion: viewport.reducedMotion ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  activePage = page;
  await page.addInitScript(() => {
    window.__voicePlayCalls = [];
    HTMLMediaElement.prototype.play = function () {
      window.__voicePlayCalls.push(this.src);
      return Promise.resolve();
    };
  });
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await startRuntime(page, server.url);
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogBubbleAnchor === "character");
  await page.waitForFunction(() => document.querySelector("[data-testid='game-state-playing']")
    ?.getAttribute("data-is-typing") === "false");
  const character = await inspectBubble(page, "character", viewport);
  await advanceDialog(page);
  await page.waitForFunction(() => {
    const dialog = document.querySelector(".dialog-box");
    const game = document.querySelector("[data-testid='game-state-playing']");
    return dialog?.getAttribute("data-dialog-character-id") === ""
      && dialog?.getAttribute("data-dialog-bubble-anchor") === "fallback"
      && game?.getAttribute("data-current-command-type") === "narration"
      && game?.getAttribute("data-is-typing") === "false";
  });
  const narration = await inspectBubble(page, "narration", viewport);
  await advanceDialog(page);
  await page.waitForFunction(() => {
    const dialog = document.querySelector(".dialog-box");
    const game = document.querySelector("[data-testid='game-state-playing']");
    return dialog?.getAttribute("data-dialog-character-id") === "alice"
      && dialog?.getAttribute("data-dialog-bubble-anchor") === "fallback"
      && game?.getAttribute("data-is-typing") === "false";
  });
  const absentCharacter = await inspectBubble(page, "absent-character", viewport);
  await advanceDialog(page);
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogBubbleAnchor === "fixed");
  const fixed = await inspectBubble(page, "fixed", viewport);
  await page.getByTestId("renpy-quick-save").click();
  await page.locator(".save-status-toast.is-saved").filter({ hasText: "快存已保存" }).waitFor();
  await page.getByTestId("renpy-quick-settings").click();
  await page.getByTestId("settings-screen").waitFor();
  await page.getByTestId("renpy-menu-return").click();
  await page.getByTestId("game-state-playing").waitFor();
  await page.locator(".game-launch-blackout").waitFor({ state: "detached" });
  const afterMenu = await inspectBubble(page, "fixed", viewport);
  assert.deepEqual(afterMenu.bubble, fixed.bubble, "menu return must preserve the current fixed bubble geometry");
  assert.equal(afterMenu.textMetrics.fontSize, fixed.textMetrics.fontSize,
    "menu return must preserve the measured font, not an interpolated configured size");
  await advanceDialog(page);
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogBubbleAnchor === "character"
    && document.querySelector("[data-testid='game-state-playing']")?.dataset.isTyping === "false");
  const offsetCharacter = await inspectBubble(page, "offset-character", viewport);
  await page.waitForFunction(() => window.__voicePlayCalls.length === 2);
  const playedBeforeRestore = await page.evaluate(() => window.__voicePlayCalls.length);
  await page.getByTestId("renpy-quick-load").click();
  await page.getByTestId("confirm-quick-load").click();
  await page.getByTestId("game-state-playing").waitFor();
  await page.locator(".game-launch-blackout").waitFor({ state: "detached" });
  const restored = await inspectBubble(page, "fixed", viewport);
  assert.deepEqual(restored.bubble, fixed.bubble, "reading quick save must restore fixed bubble geometry");
  assert.equal(restored.textMetrics.fontSize, fixed.textMetrics.fontSize, "quick load must restore the measured font");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.__voicePlayCalls.length), playedBeforeRestore,
    "reading a save must not replay the restored line's voice");
  await advanceDialog(page);
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogBubbleAnchor === "character"
    && document.querySelector("[data-testid='game-state-playing']")?.dataset.isTyping === "false");
  await page.waitForFunction(expected => window.__voicePlayCalls.length === expected,
    playedBeforeRestore + 1);
  await page.getByTestId("renpy-quick-rollback").click();
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogBubbleAnchor === "fixed");
  const rollback = await inspectBubble(page, "fixed", viewport);
  assert.deepEqual(rollback.bubble, fixed.bubble, "rollback must restore the authored position without repeating dialogue");
  assert.equal(rollback.textMetrics.fontSize, fixed.textMetrics.fontSize, "rollback must restore the measured font");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.__voicePlayCalls.length), playedBeforeRestore + 1,
    "rollback must not replay restored dialogue voice; subsequent new commands still play");
  await advanceDialog(page);
  await advanceDialog(page);
  await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.includes("镜头和立绘"));
  await page.waitForFunction(() => ![...document.querySelectorAll(".camera-pose, .sprite-slot")]
    .some(node => node.getAnimations().some(animation => animation.playState === "running")));
  const movedCharacter = await inspectBubble(page, "character", viewport);
  assert.notDeepEqual(movedCharacter.head, offsetCharacter.head,
    "fixture must actually move/scale the sprite and transform the camera");
  assert.notDeepEqual(movedCharacter.bubble, offsetCharacter.bubble,
    "bubble must remeasure its anchor after scene transforms");
  await advanceDialog(page);
  const dialog = page.locator(".dialog-box");
  await page.waitForFunction(() => Number(document.querySelector(".dialog-box")?.dataset.dialogPages) > 1);
  await dialog.focus();
  if (await dialog.getAttribute("data-dialog-page-done") !== "true") {
    await dialog.press("Enter");
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
  }
  if (restoredPagination) {
    await page.getByTestId("renpy-quick-settings").click();
    await page.getByTestId("settings-screen").waitFor();
    await page.getByTestId("settings-finish").click();
    await page.getByTestId("game-state-playing").waitFor();
    await page.locator(".game-launch-blackout").waitFor({ state: "detached" });
    await page.getByTestId("renpy-quick-save").click();
    await page.locator(".save-status-toast.is-saved").filter({ hasText: "快存已保存" }).waitFor();
    await page.getByTestId("renpy-quick-load").click();
    await page.getByTestId("confirm-quick-load").click();
    await page.getByTestId("game-state-playing").waitFor();
    await page.locator(".game-launch-blackout").waitFor({ state: "detached" });
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
  }
  const pages = Number(await dialog.getAttribute("data-dialog-pages"));
  const segments = [];
  report.paginationTrace = [];
  report.paginationFragments = [];
  for (let index = 1; index <= pages; index++) {
    report.paginationTrace.push(await dialog.evaluate((node, expected) => ({
      expected, page: node.dataset.dialogPage, done: node.dataset.dialogPageDone,
      textLength: node.querySelector(".dialog-text")?.textContent?.length,
      typing: node.closest(".story-player")?.dataset.isTyping,
      reveal: node.closest(".story-player")?.dataset.typingRevealRequested,
    }), index));
    await page.waitForFunction(expected => document.querySelector(".dialog-box")?.dataset.dialogPage === String(expected), index);
    // The first reveal request applies to the remaining fragments. Wait for
    // its rendered completion instead of sending another input while React is
    // committing the next fragment; that second input legitimately advances.
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
    const fragment = await dialog.evaluate(node => {
      const text = node.querySelector(".dialog-text");
      const box = node.getBoundingClientRect(), content = text.getBoundingClientRect();
      return { text: text.textContent, font: parseFloat(getComputedStyle(text).fontSize),
        box: box.toJSON(), content: content.toJSON(),
        overflow: text.scrollWidth - text.clientWidth,
        verticalOverflow: text.scrollHeight - text.clientHeight };
    });
    assert(fragment.font >= 12 && fragment.text.length > 0 && fragment.overflow <= 1,
      "long bubble must retain readable text with no horizontal overflow");
    assert(fragment.verticalOverflow <= 1,
      `long bubble text must not be silently clipped inside a flex-shrunk fragment: ${JSON.stringify(fragment)}`);
    assert(fragment.content.top >= fragment.box.top - 1 && fragment.content.bottom <= fragment.box.bottom + 1,
      "long bubble fragments must fit without clipping");
    segments.push(fragment.text);
    report.paginationFragments.push({ index, text: fragment.text, font: fragment.font });
    if (index < pages) {
      if (restoredPagination) {
        await dialog.press("Enter");
      } else if (index % 3 === 1) {
        // Space outside the dialog still advances its current fragment, not
        // the next story command.
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press("Space");
      } else if (index % 3 === 2) {
        await dialog.click();
      } else {
        await dialog.focus();
        await dialog.press("Enter");
      }
    }
  }
  assert(segments.join("") === longBubbleText,
    `bubble pagination must preserve every authored character in order (actual ${segments.join("").length}, expected ${longBubbleText.length})`);
  assert.deepEqual(errors, [], "bubble dialogue runtime must not emit frontend errors");
  report.cases.push({
    ...viewport,
    status: "PASS",
    geometry: { character, narration, absentCharacter, fixed, offsetCharacter, afterMenu, restored, rollback,
      movedCharacter, longTextPages: pages },
  });
  await context.close();
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server;
  let browser;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"),
      port: Number(process.env.BUBBLE_DIALOG_TEST_PORT || 6925),
      logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch({ ignoreDefaultArgs: classicScrollbars ? ["--hide-scrollbars"] : [] });
    await server.run(async () => {
      for (const viewport of viewports.map(([width, height]) => ({
        width, height, deviceScaleFactor: Number(process.env.PROFILE_DPR || 1),
        reducedMotion: process.env.PROFILE_REDUCED === "1",
      }))) {
        await runCase(browser, server, viewport);
      }
      assert.equal(report.cases.length, viewports.length, "Nonempty complete bubble matrix required");
    });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    if (activePage && !activePage.isClosed()) {
      report.failureState = await activePage.evaluate(() => ({
        dialog: document.querySelector(".dialog-box")?.outerHTML.slice(0, 5000),
        playing: document.querySelector("[data-testid='game-state-playing']")?.outerHTML.slice(0, 1400),
        audioCalls: window.__voicePlayCalls,
      })).catch(() => null);
      await activePage.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    }
    throw error;
  } finally {
    await browser?.close();
    await server?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
