"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = process.env.AGENTVN_QA_OUTPUT || path.join(root, "output/playwright/renpy-dialog-quickbar-overlap", runId);
const loaded = { exports: {} };
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
}).outputFiles[0].text)(loaded, loaded.exports);

const report = {
  runId,
  status: "RUNNING",
  scope: "GameCLI Runtime Ren'Py standard dialogue versus nine-item quick bar",
  output,
  cases: [],
};

function persist() {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), "utf8");
}

const shortText = "这是一句用于确认普通对白文字区域不会被底部九项快捷栏覆盖的测试内容。";
// Even 4K must exercise real pagination at the minimum font size.
const longText = "长对白必须先自动缩小字号，仍然放不下时分页，每页都不能覆盖快捷栏、角色名或者继续提示。".repeat(160);

function fixture() {
  const now = new Date().toISOString();
  return {
    uiSkin: loaded.exports.createRenpyUILayout(),
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.21.0",
      game_id: "renpy-dialog-quickbar-overlap",
      title: "Ren'Py 对白与快捷栏隔离验收",
      author: "QA",
      version: "1.0.0",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "main",
      assets: [],
      created_at: now,
      updated_at: now,
    },
    script: {
      schema_version: "1.7.0",
      game_id: "renpy-dialog-quickbar-overlap",
      title: "Ren'Py 对白与快捷栏隔离验收",
      entry_scene_id: "main",
      characters: [{ character_id: "alice", name: "小岚" }],
      scenes: [{
        scene_id: "main",
        title: "对白布局",
        chapter: 1,
        tags: [],
        commands: [
          {
            type: "dialog",
            character_id: "alice",
            text: shortText,
          },
          {
            type: "dialog",
            character_id: "alice",
            text: longText,
          },
          {
            type: "dialog",
            character_id: "alice",
            text: "第二句用于确保切换对白后几何仍然稳定。",
          },
        ],
      }],
    },
    assetUrls: {},
  };
}

async function settle(page) {
  await page.waitForFunction(() =>
    document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition") === "idle"
    && !document.querySelector(".game-launch-blackout"),
  );
}

async function inspect(page) {
  return page.evaluate(() => {
    const scope = document.querySelector(".ui-skin-scope");
    const frame = document.querySelector(".runtime-layout-frame");
    const dialog = document.querySelector(".dialog-box");
    const text = document.querySelector(".dialog-text");
    const speaker = document.querySelector(".speaker");
    const indicator = document.querySelector(".continue-indicator");
    const quickBar = document.querySelector(".renpy-quick-bar");
    const rect = node => node?.getBoundingClientRect().toJSON() ?? null;
    const overlap = (a, b) => Boolean(a && b
      && a.left < b.right && a.right > b.left
      && a.top < b.bottom && a.bottom > b.top);
    const textRanges = [];
    if (text) {
      const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const item of range.getClientRects()) textRanges.push(item.toJSON());
      }
    }
    const dialogRect = rect(dialog);
    const textRect = rect(text);
    const quickRect = rect(quickBar);
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      scope: rect(scope),
      frame: rect(frame),
      dialog: dialogRect,
      text: textRect,
      speaker: rect(speaker),
      indicator: rect(indicator),
      quickBar: quickRect,
      textRanges,
      dialogQuickOverlap: overlap(dialogRect, quickRect),
      textQuickOverlap: overlap(textRect, quickRect),
      glyphQuickOverlap: textRanges.some(range => overlap(range, quickRect)),
      speakerQuickOverlap: overlap(rect(speaker), quickRect),
      indicatorQuickOverlap: overlap(rect(indicator), quickRect),
      textSpeakerOverlap: overlap(textRect, rect(speaker)),
      textIndicatorOverlap: overlap(textRect, rect(indicator)),
      fontMode: dialog?.getAttribute("data-dialog-font-mode"),
      fontSize: text ? parseFloat(getComputedStyle(text).fontSize) : null,
      pages: Number(dialog?.getAttribute("data-dialog-pages")),
      page: Number(dialog?.getAttribute("data-dialog-page")),
      done: dialog?.getAttribute("data-dialog-page-done") === "true",
      isTyping: document.querySelector(".story-player")?.getAttribute("data-is-typing"),
      revealRequested: document.querySelector(".story-player")?.getAttribute("data-typing-reveal-requested"),
      visibleText: text?.textContent ?? "",
      textScrollHeight: text?.scrollHeight,
      textClientHeight: text?.clientHeight,
      buttons: [...(quickBar?.querySelectorAll("button") ?? [])].map(button => {
        const box = button.getBoundingClientRect();
        return { rect: box.toJSON(), hit: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      }),
      dialogMode: dialog?.getAttribute("data-dialogue-layout-mode"),
      layoutType: dialog?.getAttribute("data-dialog-presentation"),
      quickActionCount: quickBar?.querySelectorAll("button").length ?? 0,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

function assertGeometry(geometry) {
  assert.equal(geometry.layoutType, "renpy");
  assert.equal(geometry.dialogMode, "dialog");
  assert.equal(geometry.quickActionCount, 9);
  assert(geometry.quickBar && geometry.text, "dialogue and quick bar must be mounted");
  for (const field of ["textQuickOverlap", "glyphQuickOverlap", "speakerQuickOverlap",
    "indicatorQuickOverlap", "textSpeakerOverlap", "textIndicatorOverlap"]) {
    assert.equal(geometry[field], false, `${field}: ${JSON.stringify(geometry)}`);
  }
  assert(geometry.buttons.every(button => button.hit), "nine quick actions must have real hit targets");
  assert(geometry.buttons.every(button => Math.abs(button.rect.y - geometry.buttons[0].rect.y) < 1),
    "nine quick actions must remain on one row");
  assert(geometry.textScrollHeight <= geometry.textClientHeight + 1, "dialogue must fit without internal scrolling");
  for (const field of ["text", "speaker", "indicator", "quickBar"]) {
    const box = geometry[field];
    assert(box && box.left >= geometry.frame.left - 1 && box.right <= geometry.frame.right + 1
      && box.top >= geometry.frame.top - 1 && box.bottom <= geometry.frame.bottom + 1,
    `${field} must stay inside the rendered frame`);
  }
  assert(geometry.overflow <= 1, "runtime must not overflow horizontally");
}

async function stableInputState(page) {
  // A page-index commit precedes the new TypewriterText effect. In particular,
  // a line-wide reveal request may still be completing the new page; never
  // classify that transient `done=false` as a request for another physical tap.
  await page.waitForFunction(() => {
    const dialog = document.querySelector(".dialog-box");
    const player = document.querySelector(".story-player");
    return dialog && player
      && !(player.getAttribute("data-typing-reveal-requested") === "true"
        && dialog.getAttribute("data-dialog-page-done") !== "true");
  });
  return page.evaluate(async () => {
    let previous;
    let stableFrames = 0;
    for (let frame = 0; frame < 120; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const dialog = document.querySelector(".dialog-box");
      const player = document.querySelector(".story-player");
      const state = {
        page: Number(dialog?.getAttribute("data-dialog-page")),
        pages: Number(dialog?.getAttribute("data-dialog-pages")),
        done: dialog?.getAttribute("data-dialog-page-done") === "true",
        isTyping: player?.getAttribute("data-is-typing"),
        revealRequested: player?.getAttribute("data-typing-reveal-requested"),
        command: player?.getAttribute("data-current-command-index"),
      };
      const key = JSON.stringify(state);
      stableFrames = key === previous ? stableFrames + 1 : 0;
      previous = key;
      if (stableFrames >= 3
        && !(state.revealRequested === "true" && !state.done)) return state;
    }
    throw new Error("Dialogue input state did not settle within 120 rendering frames");
  });
}

async function activateDialog(page, touch, intent = "input") {
  const before = await stableInputState(page);
  // The typewriter can naturally finish between reveal()'s decision and this
  // final input check. A completed page needs no reveal tap: that tap would
  // correctly advance the story rather than exercise text revelation.
  if (intent === "reveal" && before.done) {
    await page.evaluate(action => {
      window.__agentvnDialogActions ||= [];
      window.__agentvnDialogActions.push(action);
    }, { intent, before, after: before, skipped: "text-completed-before-input" });
    return { before, after: before };
  }
  const dialog = page.locator(".dialog-box");
  // Avoid the centred quick bar, using an actual pointer/touch on the panel.
  // Verify hit ownership instead of forcing a click through another control.
  const box = await dialog.boundingBox();
  assert(box, "dialogue panel must have a real hit area");
  const point = { x: box.x + 12, y: box.y + 12 };
  assert(await page.evaluate(({ x, y }) =>
    Boolean(document.elementFromPoint(x, y)?.closest(".dialog-box")), point),
  "dialogue advance position must be owned by the dialogue panel");
  await page.evaluate(() => {
    window.__agentvnDialogInputTrace ||= [];
    if (!window.__agentvnDialogInputTraceInstalled) {
      window.__agentvnDialogInputTraceInstalled = true;
      const snapshot = (type, event) => {
        const dialog = document.querySelector(".dialog-box");
        const player = document.querySelector(".story-player");
        window.__agentvnDialogInputTrace.push({
          type,
          time: performance.now(),
          eventPhase: event?.eventPhase ?? null,
          isTrusted: event?.isTrusted ?? null,
          pointerType: event && "pointerType" in event ? event.pointerType : null,
          detail: event && "detail" in event ? event.detail : null,
          page: Number(dialog?.getAttribute("data-dialog-page") || 0),
          done: dialog?.getAttribute("data-dialog-page-done"),
          isTyping: player?.getAttribute("data-is-typing"),
          typingRevealRequested: player?.getAttribute("data-typing-reveal-requested"),
        });
      };
      for (const type of ["pointerdown", "pointerup", "click"]) {
        document.addEventListener(type, event => {
          const target = event.target instanceof Element ? event.target.closest(".dialog-box") : null;
          if (target) snapshot(type, event);
        }, true);
      }
      new MutationObserver(records => {
        for (const record of records) {
          if (record.type === "attributes"
            && record.attributeName !== "data-dialog-page"
            && record.attributeName !== "data-dialog-page-done"
            && record.attributeName !== "data-is-typing"
            && record.attributeName !== "data-typing-reveal-requested") continue;
          if (record.type === "childList"
            && ![...record.addedNodes, ...record.removedNodes].some(node =>
              node instanceof Element && (node.matches(".dialog-box,.story-player")
                || node.querySelector(".dialog-box,.story-player")))) continue;
          snapshot(record.type === "attributes"
            ? `mutation:${record.attributeName}`
            : "mutation:dialog-tree", null);
        }
      }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: [
          "data-dialog-page",
          "data-dialog-page-done",
          "data-is-typing",
          "data-typing-reveal-requested",
        ],
        childList: true,
        subtree: true,
      });
    }
  });
  const startedAt = Date.now();
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await dialog.click({ position: { x: 12, y: 12 } });
  const after = await stableInputState(page);
  await page.evaluate(action => {
    window.__agentvnDialogActions ||= [];
    window.__agentvnDialogActions.push(action);
  }, { intent, before, after, elapsedMs: Date.now() - startedAt });
  return { before, after };
}

async function reveal(page, touch) {
  const before = await stableInputState(page);
  if (!before.done) {
    await activateDialog(page, touch, "reveal");
  }
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
  const after = await stableInputState(page);
  assert.equal(after.page, before.page, "revealing text must not change the page");
  assert.equal(after.command, before.command, "revealing text must not advance the story");
}

async function advancePage(page, touch, currentPage) {
  const { before, after } = await activateDialog(page, touch, "next-page");
  assert(before.done, "page advancement requires completed text");
  assert.equal(before.page, currentPage, "input must start on the expected page");
  assert.equal(after.page, currentPage + 1, "one physical input must advance exactly one page");
  assert.equal(after.command, before.command, "pagination must not advance the story command");
}

async function runCase(server, browser, config) {
  const item = { ...config, status: "RUNNING" };
  item.pageErrors = [];
  report.cases.push(item);
  const page = await browser.newPage({
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: config.dpr,
    hasTouch: config.hasTouch,
    userAgent: config.hasTouch
      ? "Mozilla/5.0 (Linux; Android 15; AgentVN QA) AppleWebKit/537.36 Chrome/148 Mobile Safari/537.36"
      : undefined,
    reducedMotion: config.reduced ? "reduce" : "no-preference",
  });
  page.on("pageerror", error => item.pageErrors.push(error.message));
  try {
    await page.goto(`${server.url}/?mode=preview`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
    await page.evaluate(payload => {
      window.postMessage({
        type: "agentvn.live-preview.init",
        protocolVersion: 2,
        sessionId: "renpy-dialog-quickbar-overlap",
        revision: 1,
        requestId: "renpy-dialog-quickbar-overlap",
        runId: "renpy-dialog-quickbar-overlap",
        screen: "title_menu",
        ...payload,
      }, "*");
    }, fixture());
    await page.getByTestId("start-new-game").waitFor();
    await page.getByTestId("start-new-game").click();
    await page.getByTestId("game-state-playing").waitFor();
    await settle(page);
    if (config.nativeInsets) {
      await page.evaluate(detail => {
        window.dispatchEvent(new CustomEvent("agentvn:android-insets", { detail }));
      }, config.nativeInsets);
      await page.waitForFunction(() => {
        const scope = document.querySelector(".ui-skin-scope");
        return Number(scope?.getAttribute("data-runtime-safe-revision") ?? "0") > 0;
      });
      await stableInputState(page);
    }
    // Short text may finish naturally while safe-area geometry settles. Wait
    // for it instead of racing a physical reveal tap against its final glyph.
    // The multi-page long-text case below still exercises explicit revelation.
    await page.waitForFunction(() =>
      document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
    item.geometry = await inspect(page);
    assertGeometry(item.geometry);
    const shortFontSize = item.geometry.fontSize;
    await activateDialog(page, config.hasTouch, "next-dialogue");
    await page.waitForFunction(prefix =>
      document.querySelector(".dialog-box")?.getAttribute("aria-label")?.includes(prefix) ?? false,
    longText.slice(0, 24));
    await stableInputState(page);
    await page.evaluate(() => {
      window.__agentvnDialogInputTrace = [];
      window.__agentvnDialogActions = [];
    });
    item.longPages = [];
    let collected = "";
    const pageCount = Number(await page.locator(".dialog-box").getAttribute("data-dialog-pages"));
    assert(pageCount > 1, "every viewport must exercise real multi-page dialogue");
    item.longTextFontSize = parseFloat(await page.locator(".dialog-text").evaluate(element => getComputedStyle(element).fontSize));
    assert(item.longTextFontSize <= shortFontSize, "long text must not use a larger font than short text");
    for (let index = 1; index <= pageCount; index++) {
      await reveal(page, config.hasTouch);
      const sample = await inspect(page);
      assert.equal(sample.page, index, "each physical input must advance exactly one page");
      assertGeometry(sample);
      collected += sample.visibleText;
      item.longPages.push(sample);
      if (index < pageCount) {
        await advancePage(page, config.hasTouch, sample.page);
      }
    }
    assert.equal(collected, longText, "pagination must preserve all source characters");
    await page.getByTestId("renpy-quick-settings").click();
    await page.getByTestId("settings-screen").waitFor();
    await settle(page);
    await page.getByTestId("settings-finish").click();
    await page.getByTestId("game-state-playing").waitFor();
    await settle(page);
    await page.waitForFunction(pageNumber =>
      Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-page")) === pageNumber,
    item.longPages.at(-1).page);
    item.returnedInputState = await stableInputState(page);
    item.returned = await inspect(page);
    assert.equal(item.returned.done, true,
      "returning from settings must preserve an already revealed dialogue page");
    assert.equal(item.returned.visibleText, item.longPages.at(-1).visibleText,
      "menu return must not restart the completed page's typewriter");
    assertGeometry(item.returned);
    assert.equal(item.returned.page, item.longPages.at(-1).page, "menu round trip must preserve the active dialogue page");
    assert.deepEqual(item.pageErrors, [], "runtime must not throw browser errors");
    item.status = "PASS";
    await page.screenshot({ path: path.join(output, `${config.label}.png`) });
  } catch (error) {
    item.status = "FAILED";
    item.error = String(error.stack || error);
    item.failureGeometry = await inspect(page).catch(() => null);
    await page.screenshot({ path: path.join(output, `failure-${config.label}.png`) });
  } finally {
    item.inputTrace = await page.evaluate(() => window.__agentvnDialogInputTrace || []);
    item.actions = await page.evaluate(() => window.__agentvnDialogActions || []);
    await page.close();
    persist();
  }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  persist();
  const server = await startOwnedViteServer({
    root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"),
    port: 0,
    logFile: path.join(output, "vite.log"),
  });
  const browser = await chromium.launch({ headless: true });
  report.owner = { pid: server.pid, runId: server.runId, url: server.url };
  try {
    await server.run(async () => {
      const matrix = [];
      for (const width of [1920, 2560, 3840]) {
        for (const dpr of [1, 2]) {
          for (const reduced of [false, true]) {
            for (const hasTouch of [false, true]) {
              matrix.push({ width, height: width * 9 / 16, dpr, reduced,
                hasTouch, label: `${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}-${hasTouch ? "touch" : "mouse"}` });
              if (hasTouch) matrix.push({ width, height: width * 9 / 16, dpr, reduced, hasTouch,
                label: `${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}-touch-insets`,
                nativeInsets: { top: 0, right: 132, bottom: 84, left: 0,
                  coordinateSpace: "physical", revision: 2 } });
            }
          }
        }
      }
      const selected = matrix.filter(config => !process.env.AGENTVN_DIALOG_QUICKBAR_CASE
        || config.label === process.env.AGENTVN_DIALOG_QUICKBAR_CASE);
      assert(selected.length > 0, "case selection must not produce an empty matrix");
      report.expectedCases = selected.length;
      report.matrix = process.env.AGENTVN_DIALOG_QUICKBAR_CASE ? "targeted" : "full";
      for (const config of selected) await runCase(server, browser, config);
    });
    assert.equal(report.cases.length, report.expectedCases, "required matrix cannot be empty or stop after its first failure");
    assert(report.cases.every(item => item.status === "PASS"), "one or more geometry cases failed");
    report.status = "PASS";
  } finally {
    await browser.close();
    await server.stop();
  }
})().catch(error => {
  report.status = "FAILED";
  report.error = String(error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  persist();
  console.log(`${report.status}: ${path.join(output, "report.json")}`);
});
