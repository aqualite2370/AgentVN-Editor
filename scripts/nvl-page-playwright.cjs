"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { currentAcceptanceViewports } = require("./lib/current-acceptance-viewports.cjs");

const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = process.env.AGENTVN_NVL_PAGE_OUTPUT ?? path.join(root, "output/playwright/nvl-page", runId);
assert(!fs.existsSync(output), "NVL page regression must not overwrite previous evidence");
const dpr = Number(process.env.PROFILE_DPR || 1);
const reduced = process.env.PROFILE_REDUCED === "1";
const authoredLayout = process.argv.includes("--authored-layout");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sources = ["ChoicePanel.tsx", "DialogBox.tsx", "PlaybackControls.tsx", "StoryPlayer.tsx", "useNvlPanelRect.ts"]
  .map(file => `GameCli_framework/src/components/player/${file}`)
  .concat(["GameCli_framework/src/styles/player.css", "shared/cartridge/quickMenuMetrics.ts",
    "GameCli_framework/src/components/player/useDialogPortrait.ts"]);
const report = { runId, status: "RUNNING", dpr, reduced, authoredLayout, cases: [],
  scope: "Source Chromium regression; controlled preview fixtures, browser save storage, not installed/device",
  modelRequests: 0, testSha256: sha(__filename), sources: sources.map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const selectedCase = process.argv.find(arg => arg.startsWith("--case="))?.slice(7) ?? "all";
assert(["all", "compact", "dense", "single-long", "save-restore", "menu-stability"].includes(selectedCase), `Unknown NVL page test case: ${selectedCase}`);
const viewports = currentAcceptanceViewports();
const contextOptions = (width, height) => ({ viewport: { width, height }, deviceScaleFactor: dpr,
  reducedMotion: reduced ? "reduce" : "no-preference" });
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

async function startRuntime(page, url, commands) {
  const uiSkin = loaded.exports.createRenpyUILayout();
  if (authoredLayout) uiSkin.dialogueLayouts = {
    nvl: { rect: { x: 8, y: 15, width: 84, height: 20, anchor: "top_left" },
      textStyle: { fontSize: 26 }, panelStyle: { padding: 14 } },
  };
  await page.goto(`${url}/?mode=preview`);
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
  await page.evaluate(({ uiSkin, commands }) => window.postMessage({
    type: "agentvn.live-preview.init",
    protocolVersion: 2,
    sessionId: "nvl-visible-page",
    revision: 1,
    requestId: "nvl-visible-page",
    runId: "nvl-visible-page",
    screen: "title_menu",
    uiSkin,
    manifest: {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.13.0",
      game_id: "nvl-visible-page",
      title: "NVL 页面验收",
      author: "QA",
      version: "1.0.0",
      language: "zh-CN",
      entry_script: "script.json",
      entry_scene_id: "main",
      assets: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    script: {
      schema_version: "1.7.0",
      game_id: "nvl-visible-page",
      title: "NVL 页面验收",
      entry_scene_id: "main",
      characters: [{ character_id: "alice", name: "小岚" }],
      scenes: [{
        scene_id: "main",
        title: "页面渲染",
        chapter: 1,
        tags: [],
        commands: commands ?? [
          { type: "dialog", character_id: "alice", text: "第一句对白", presentation_mode: "nvl" },
          { type: "narration", text: "第二句旁白", presentation_mode: "nvl" },
          { type: "dialog", character_id: "alice", text: "第三句对白", presentation_mode: "nvl" },
          { type: "choice", choices: [{ choice_id: "nvl-continue", text: "继续普通对白",
            target_scene_id: "after", conditions: [] }] },
        ],
      }, { scene_id: "after", title: "分支后", chapter: 1, tags: [], commands: [
        { type: "dialog", character_id: "alice", text: "普通对白只保留当前句", presentation_mode: "dialog" },
      ] }],
    },
    assetUrls: {},
  }, "*"), { uiSkin, commands });
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor();
  await page.locator(".game-launch-blackout").waitFor({ state: "detached" });
}

async function revealAndAdvance(page) {
  const dialog = page.locator(".dialog-box");
  await dialog.focus();
  const isTyping = await page.getByTestId("game-state-playing").getAttribute("data-is-typing");
  if (isTyping === "true") {
    await dialog.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-testid='game-state-playing']")
      ?.dataset.isTyping === "false");
  }
  const beforeCommand = await page.getByTestId("game-state-playing").getAttribute("data-current-command-index");
  await dialog.press("Enter");
  await page.waitForFunction(previous => document.querySelector("[data-testid='game-state-playing']")
    ?.getAttribute("data-current-command-index") !== previous, beforeCommand);
}

async function inspectNvlPage(page, width, height, expectedTexts) {
  const pageNode = page.locator(".nvl-page");
  await pageNode.waitFor({ state: "visible", timeout: 1800 });
  const lines = await pageNode.locator("[data-nvl-line]").evaluateAll(nodes => nodes.map(node => ({
    text: node.querySelector(".nvl-page-text")?.textContent?.trim() ?? "",
    speaker: node.querySelector(".nvl-page-speaker")?.textContent?.trim() ?? "",
    kind: node.getAttribute("data-nvl-kind"),
    rect: node.getBoundingClientRect().toJSON(),
  })));
  assert.deepEqual(lines.map(line => line.text), expectedTexts,
    "NVL 页面必须按剧情顺序同时显示已完成对白和旁白");
  const geometry = await page.evaluate(() => {
    const page = document.querySelector(".nvl-page");
    const dialog = document.querySelector(".dialog-box");
    const player = document.querySelector(".story-player");
    const quickBar = document.querySelector(".renpy-quick-bar");
    const choices = document.querySelector(".choice-panel");
    const box = page.getBoundingClientRect();
    const playerBox = player.getBoundingClientRect();
    return {
      page: box.toJSON(),
      dialog: dialog.getBoundingClientRect().toJSON(),
      player: playerBox.toJSON(),
      scrollWidth: page.scrollWidth,
      clientWidth: page.clientWidth,
      quickBar: quickBar?.getBoundingClientRect().toJSON(),
      choices: choices?.getBoundingClientRect().toJSON(),
    };
  });
  assert(geometry.page.left >= geometry.player.left - 1
    && geometry.page.right <= geometry.player.right + 1
    && geometry.page.top >= geometry.player.top - 1
    && geometry.page.bottom <= geometry.player.bottom + 1,
  "NVL 阅读区域必须留在游戏画面内");
  assert(geometry.scrollWidth <= geometry.clientWidth + 1, "NVL 页面不能横向溢出");
  assert(geometry.dialog.height <= height * 0.72 + 1,
    "NVL 阅读框应随内容收口，并为场景保留至少约四分之一视野");
  for (const line of lines) {
    assert(line.rect.left >= geometry.page.left - 1 && line.rect.right <= geometry.page.right + 1
      && line.rect.top >= geometry.page.top - 1 && line.rect.bottom <= geometry.page.bottom + 1,
    `NVL 行不得裁切或越界：${line.text}`);
  }
  if (geometry.quickBar) assert(geometry.page.bottom <= geometry.quickBar.top + 1,
    "NVL 页面不得覆盖 Ren’Py 快捷栏");
  await page.screenshot({ path: path.join(output, `nvl-${width}x${height}.png`) });
  return { lines, geometry };
}

async function runDenseNvlCase(browser, server, width, height, deviceScaleFactor) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor,
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  const lineCount = 14 * Math.ceil(width / 1920);
  const commands = Array.from({ length: lineCount }, (_, index) => ({
    type: index % 2 === 0 ? "dialog" : "narration",
    ...(index % 2 === 0 ? { character_id: "alice" } : {}),
    text: `第${index + 1}句：这是用于验证 NVL 满页翻页的连续长文本，内容应在阅读页中保持完整、清晰，并且不能依靠内部滚动才能继续阅读。`,
    presentation_mode: "nvl",
  }));
  await startRuntime(page, server.url, commands);
  for (let index = 0; index < commands.length - 1; index += 1) {
    await revealAndAdvance(page);
  }
  await page.waitForFunction(last => document.querySelector(
    ".nvl-page [data-nvl-current='true'] .nvl-page-text",
  )?.textContent?.trim().startsWith(`第${last}句：`), lineCount);
  if (await page.getByTestId("game-state-playing").getAttribute("data-is-typing") === "true") {
    await page.locator(".dialog-box").focus();
    await page.locator(".dialog-box").press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-testid='game-state-playing']")
      ?.getAttribute("data-is-typing") === "false");
  }
  await page.waitForFunction(() => document.querySelector(
    ".nvl-page [data-nvl-current='true'] .nvl-page-text",
  )?.textContent?.trim().endsWith("并且不能依靠内部滚动才能继续阅读。"), undefined, { timeout: 4000 });
  await page.waitForFunction(() => Number(document.querySelector(".nvl-page")
    ?.getAttribute("data-nvl-page-count")) > 1);
  const geometry = await page.locator(".nvl-page").evaluate(node => {
    const quickBar = document.querySelector(".renpy-quick-bar")?.getBoundingClientRect();
    return {
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      overflowY: getComputedStyle(node).overflowY,
      visibleLines: [...node.querySelectorAll("[data-nvl-line]")].filter(line => {
        const style = getComputedStyle(line);
        return style.display !== "none" && style.visibility !== "hidden";
      }).length,
      totalLines: Number(node.getAttribute("data-nvl-total-lines")),
      pageCount: Number(node.getAttribute("data-nvl-page-count")),
      lineTexts: [...node.querySelectorAll("[data-nvl-line]")].map(line =>
        line.querySelector(".nvl-page-text")?.textContent?.trim() ?? ""),
      lineRects: [...node.querySelectorAll("[data-nvl-line]")].map(line => line.getBoundingClientRect().toJSON()),
      fontSizes: [...node.querySelectorAll(".nvl-page-text")].map(line => getComputedStyle(line).fontSize),
      pageRect: node.getBoundingClientRect().toJSON(),
      quickBar: quickBar?.toJSON(),
    };
  });
  assert(geometry.scrollHeight <= geometry.clientHeight + 1,
    `NVL 满页后必须翻页，不能依赖内部滚动：${JSON.stringify(geometry)}`);
  assert.equal(geometry.overflowY, "hidden", "NVL 阅读页不能用滚动代替翻页");
  assert(geometry.pageCount > 1, "密集 NVL 内容必须形成多个阅读页");
  assert(geometry.visibleLines < geometry.totalLines,
    "NVL 满页后应只呈现当前阅读页，历史页不能继续挤占当前页空间");
  assert(geometry.lineTexts.at(-1)?.startsWith(`第${lineCount}句：`)
    && geometry.lineTexts.at(-1)?.includes("才能继续阅读。"),
  "翻页后的当前句必须完整呈现");
  assert(geometry.lineRects.every(rect => rect.top >= geometry.pageRect.top - 1
    && rect.bottom <= geometry.pageRect.bottom + 1
    && rect.left >= geometry.pageRect.left - 1
    && rect.right <= geometry.pageRect.right + 1),
  "当前 NVL 页的每条对白都必须完整位于阅读区域内");
  assert.equal(new Set(geometry.fontSizes).size, 1,
    "满页翻页不得通过不断缩小已显示对白字号来挤入内容");
  assert(geometry.scrollWidth <= geometry.clientWidth + 1, "NVL 阅读页不能横向溢出");
  if (geometry.quickBar) assert(geometry.pageRect.bottom <= geometry.quickBar.top + 1,
    "NVL 当前页不能覆盖快捷栏");
  assert.deepEqual(errors, [], "NVL 密集翻页不得产生前端异常");
  await page.screenshot({
    path: path.join(output, `nvl-dense-page-turning-${width}x${height}-dpr${deviceScaleFactor}.png`),
  });
  await context.close();
  return geometry;
}

async function runSingleLongNvlLineCase(browser, server, width, height) {
  const context = await browser.newContext(contextOptions(width, height));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  const text = `这是同一条很长的 NVL 旁白，用来确认达到最小可读字号后仍会按实际页面高度拆分，而不是把整条文本裁切在当前阅读框里。${"雨夜旧车站第七号储物柜钥匙仍在掌心发烫，远处的站台灯光逐渐熄灭，而她终于决定打开那封迟到了十年的信。".repeat(240 * Math.ceil(width / 1920) ** 2)}`;
  await startRuntime(page, server.url, [
    { type: "narration", text, presentation_mode: "nvl" },
  ]);
  const dialog = page.locator(".dialog-box");
  try {
    await page.waitForFunction(() => {
      const dialog = document.querySelector(".dialog-box");
      return dialog?.getAttribute("data-dialog-font-mode") === "adaptive"
        && Number(dialog.getAttribute("data-dialog-pages")) > 1;
    });
  } catch (error) {
    const state = await page.evaluate(expected => {
      const dialog = document.querySelector(".dialog-box");
      const pageNode = document.querySelector(".nvl-page");
      const line = pageNode?.querySelector("[data-nvl-current='true']");
      const text = line?.querySelector(".nvl-page-text");
      const measure = document.querySelector(".nvl-page-measure [data-nvl-measure-line]");
      return {
        url: location.href,
        gameState: document.querySelector("[data-testid='game-state-playing']")?.outerHTML,
        dialog: dialog ? {
          fontMode: dialog.getAttribute("data-dialog-font-mode"),
          fontScale: dialog.getAttribute("data-dialog-font-scale"),
          pages: dialog.getAttribute("data-dialog-pages"),
          page: dialog.getAttribute("data-dialog-page"),
          contentMode: dialog.getAttribute("data-dialog-content-mode"),
          client: { width: dialog.clientWidth, height: dialog.clientHeight },
          rect: dialog.getBoundingClientRect().toJSON(),
        } : null,
        nvl: pageNode ? {
          currentTextPages: pageNode.getAttribute("data-nvl-current-text-pages"),
          rect: pageNode.getBoundingClientRect().toJSON(),
          scrollHeight: pageNode.scrollHeight,
          clientHeight: pageNode.clientHeight,
          textLength: text?.textContent?.length ?? 0,
          textRect: text?.getBoundingClientRect().toJSON(),
          fontSize: text ? getComputedStyle(text).fontSize : null,
        } : null,
        measure: measure ? {
          rect: measure.getBoundingClientRect().toJSON(),
          text: measure.textContent?.length ?? 0,
          fontSize: getComputedStyle(measure.querySelector(".nvl-page-text")).fontSize,
        } : null,
      };
    });
    await page.screenshot({ path: path.join(output, "single-long-timeout.png"), fullPage: true });
    throw new Error(`Single long NVL line did not enter adaptive pagination: ${JSON.stringify(state)}; ${String(error)}`);
  }
  await dialog.focus();
  if (await page.getByTestId("game-state-playing").getAttribute("data-is-typing") === "true") {
    await dialog.press("Enter");
  }
  const pageCount = Number(await dialog.getAttribute("data-dialog-pages"));
  assert(pageCount > 1, "A single NVL line exceeding the readable page height must become multiple pages");
  const visibleSegments = [];
  const pageGeometries = [];
  for (let expectedPage = 1; expectedPage <= pageCount; expectedPage += 1) {
    try {
      await page.waitForFunction(expected => document.querySelector(".dialog-box")
        ?.getAttribute("data-dialog-page-done") === "true"
        && Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-page")) === expected,
      expectedPage, { timeout: 5000 });
    } catch (error) {
      const state = await page.evaluate(() => {
        const dialogNode = document.querySelector(".dialog-box");
        const textNode = document.querySelector(".nvl-page [data-nvl-current='true'] .nvl-page-text");
        const game = document.querySelector("[data-testid='game-state-playing']");
        return {
          dialogPage: dialogNode?.getAttribute("data-dialog-page"),
          dialogPages: dialogNode?.getAttribute("data-dialog-pages"),
          pageDone: dialogNode?.getAttribute("data-dialog-page-done"),
          fontMode: dialogNode?.getAttribute("data-dialog-font-mode"),
          gameTyping: game?.getAttribute("data-is-typing"),
          gameCommand: game?.getAttribute("data-current-command-index"),
          nvlTextPages: document.querySelector(".nvl-page")?.getAttribute("data-nvl-current-text-pages"),
          visibleTextLength: textNode?.textContent?.length ?? 0,
          visibleText: textNode?.textContent?.slice(0, 160) ?? "",
          focusedElement: document.activeElement?.outerHTML?.slice(0, 240) ?? null,
          renderedPage: textNode?.getBoundingClientRect().toJSON(),
          computedFontSize: textNode ? getComputedStyle(textNode).fontSize : null,
        };
      });
      await page.screenshot({ path: path.join(output, `single-long-page-${expectedPage}-timeout.png`), fullPage: true });
      throw new Error(`NVL fragment did not finish typing: ${JSON.stringify(state)}; ${String(error)}`);
    }
    const geometry = await page.evaluate(() => {
      const pageNode = document.querySelector(".nvl-page");
      const line = pageNode?.querySelector("[data-nvl-line]");
      const textNode = line?.querySelector(".nvl-page-text");
      const dialogBox = document.querySelector(".dialog-box");
      return {
        page: pageNode?.getBoundingClientRect().toJSON(),
        line: line?.getBoundingClientRect().toJSON(),
        pageIndex: Number(dialogBox?.getAttribute("data-dialog-page")),
        pageCount: Number(dialogBox?.getAttribute("data-dialog-pages")),
        nvlTextPageCount: Number(pageNode?.getAttribute("data-nvl-current-text-pages")),
        text: textNode?.textContent ?? "",
        fontSize: textNode ? getComputedStyle(textNode).fontSize : "",
        overflowY: pageNode ? getComputedStyle(pageNode).overflowY : "",
        scrollHeight: pageNode?.scrollHeight,
        clientHeight: pageNode?.clientHeight,
        dialogFontMode: dialogBox?.getAttribute("data-dialog-font-mode"),
        dialogFontScale: dialogBox?.getAttribute("data-dialog-font-scale"),
        measureRect: document.querySelector(".nvl-page-measure")?.getBoundingClientRect().toJSON(),
        measureTextStyle: (() => {
          const item = document.querySelector(".nvl-page-measure [data-nvl-measure-line] .nvl-page-text");
          return item ? {
            fontSize: getComputedStyle(item).fontSize,
            lineHeight: getComputedStyle(item).lineHeight,
            width: item.getBoundingClientRect().width,
            height: item.getBoundingClientRect().height,
          } : null;
        })(),
      };
    });
    assert(geometry.page && geometry.line && geometry.line.top >= geometry.page.top - 1
      && geometry.line.bottom <= geometry.page.bottom + 1,
    `Every visible fragment must fit the current NVL page: ${JSON.stringify(geometry)}`);
    assert(geometry.scrollHeight <= geometry.clientHeight + 1 && geometry.overflowY === "hidden",
      `Long NVL lines must advance by pages, never internal scrolling: ${JSON.stringify(geometry)}`);
    assert(geometry.text.length > 0 && Number.parseFloat(geometry.fontSize) >= 12,
      `NVL pagination must preserve readable text and the minimum font size: ${JSON.stringify(geometry)}`);
    assert.equal(geometry.nvlTextPageCount, pageCount, "NVL must expose the current authored line's page count");
    visibleSegments.push(geometry.text);
    pageGeometries.push(geometry);
    if (expectedPage < pageCount) {
      await dialog.focus();
      await dialog.press("Enter");
    }
  }
  assert.equal(visibleSegments.join(""), text,
    "Turning through all fragments must preserve every source character in order without duplication");
  const geometry = { pageCount, pageGeometries, textLength: visibleSegments.join("").length };
  assert.deepEqual(errors, [], "Single-line NVL pagination must not produce frontend errors");
  await page.screenshot({ path: path.join(output, `nvl-single-line-${width}x${height}.png`) });
  await context.close();
  return geometry;
}

async function runNvlSaveRestoreCase(browser, server, width, height) {
  const context = await browser.newContext(contextOptions(width, height));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  const text = `NVL 存读档分页恢复测试。${"漫长旅途中留下的每一段回忆都应该随着存档完整保留，重新读取时回到玩家离开前正在阅读的段落，而不是重复剧情或跳到下一句。".repeat(300 * Math.ceil(width / 1920) ** 2)}`;
  await startRuntime(page, server.url, [{ type: "narration", text, presentation_mode: "nvl" }]);
  const dialog = page.locator(".dialog-box");
  await page.waitForFunction(() => Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-pages")) > 2);
  const pageCount = Number(await dialog.getAttribute("data-dialog-pages"));
  await dialog.focus();
  await dialog.press("Enter");
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
  await dialog.press("Enter");
  await page.waitForFunction(() => Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-page")) === 2);
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
  assert(pageCount > 2, "save/restore fixture must contain at least three fragments");
  await page.getByTestId("renpy-quick-save").click();
  await page.locator(".save-status-toast.is-saved").filter({ hasText: "快存已保存" }).waitFor({ timeout: 10_000 });
  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(item => item.startsWith("agentvn.gamecli.saves."));
    const saves = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
    return saves.find(item => item.save_kind === "quick");
  });
  assert.equal(saved?.dialog_page_index, 1, "quick save must persist the visible second fragment as a zero-based index");
  assert.equal(saved?.dialog_page_count, pageCount, "quick save must persist the measured fragment count");
  const sourceText = saved?.nvl_page?.at(-1)?.text;
  assert.equal(sourceText, text, "quick save must retain the complete authored NVL line");

  await dialog.focus();
  await dialog.press("Enter");
  await page.waitForFunction(() => Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-page")) === 3);
  await page.getByTestId("renpy-quick-load").click();
  await page.getByTestId("confirm-quick-load").click();
  try {
    await page.waitForFunction(() => Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-page")) === 2
      && document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true"
      && Boolean(document.querySelector(".nvl-page [data-nvl-current='true'] .nvl-page-text")?.textContent?.trim()),
    undefined, { timeout: 15_000 });
  } catch (error) {
    const state = await page.evaluate(expected => {
      const dialogNode = document.querySelector(".dialog-box");
      const textNode = document.querySelector(".nvl-page [data-nvl-current='true'] .nvl-page-text");
      return {
        runtime: document.querySelector("[data-testid='game-state-playing']")?.outerHTML?.slice(0, 1000),
        page: dialogNode?.getAttribute("data-dialog-page"),
        pages: dialogNode?.getAttribute("data-dialog-pages"),
        pageDone: dialogNode?.getAttribute("data-dialog-page-done"),
        pageIndexState: dialogNode?.getAttribute("data-dialog-page-index-state"),
        pageCountState: dialogNode?.getAttribute("data-dialog-page-count-state"),
        textLength: textNode?.textContent?.length ?? 0,
        textStart: textNode?.textContent?.slice(0, 160) ?? "",
        textEnd: textNode?.textContent?.slice(-80) ?? "",
        fontMode: dialogNode?.getAttribute("data-dialog-font-mode"),
        bodyText: document.body.innerText.slice(0, 1200),
      };
    });
    await page.screenshot({ path: path.join(output, "nvl-save-restore-timeout.png"), fullPage: true });
    throw new Error(`NVL saved fragment was not restored: ${JSON.stringify(state)}; ${String(error)}`);
  }
  const restoredFragment = await page.locator(".nvl-page [data-nvl-current='true'] .nvl-page-text").textContent();
  assert(sourceText.includes(restoredFragment.trim()) && restoredFragment.length > 0,
    "reading the quick save must render the saved line's fragment at the persisted position");

  await page.getByTestId("renpy-quick-rollback").click();
  await page.waitForFunction(() => Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-page")) === 1);
  const rolledBackFragment = await page.locator(".nvl-page [data-nvl-current='true'] .nvl-page-text").textContent();
  assert(rolledBackFragment.length > 0 && sourceText.includes(rolledBackFragment.trim()),
    "rollback must reveal a valid fragment from the same authored line");
  await dialog.press("PageDown");
  await page.waitForFunction(() => Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-page")) === 2);
  const rolledForwardFragment = await page.locator(".nvl-page [data-nvl-current='true'] .nvl-page-text").textContent();
  assert(rolledForwardFragment.length > 0 && sourceText.includes(rolledForwardFragment.trim()),
    "roll-forward must restore the saved position within the same authored line");
  assert.deepEqual(errors, [], "NVL save, restore, rollback, and roll-forward must not produce frontend errors");
  await page.screenshot({ path: path.join(output, `nvl-save-restore-page-2-${width}x${height}.png`) });
  await context.close();
  return {
    viewport: `${width}x${height}`,
    pageCount,
    savedPageIndex: saved.dialog_page_index,
    restoredPage: 2,
    rollbackPage: 1,
    rollForwardPage: 2,
  };
}

async function runNvlMenuStabilityCase(browser, server, width, height) {
  const context = await browser.newContext(contextOptions(width, height));
  const page = await context.newPage();
  const errors = [], snapshots = [];
  page.on("pageerror", error => errors.push(String(error)));
  const text = "NVL 超长单句验收：清页、分页、快存、快读和回滚之后不重播或丢失文字。"
    .repeat(320 * Math.ceil(width / 1920) ** 2);
  const capture = () => page.evaluate(async () => {
    let previous = "", stable = 0;
    for (let frame = 0; frame < 240; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const dialog = document.querySelector(".dialog-box");
      const nvl = document.querySelector(".nvl-page");
      const text = nvl?.querySelector("[data-nvl-current=true] .nvl-page-text");
      const sample = { page: Number(dialog?.dataset.dialogPage), pages: Number(dialog?.dataset.dialogPages),
        done: dialog?.dataset.dialogPageDone === "true",
        font: text ? getComputedStyle(text).fontSize : null, text: text?.textContent,
        dialog: dialog?.getBoundingClientRect().toJSON(), nvl: nvl?.getBoundingClientRect().toJSON(),
        measure: document.querySelector(".nvl-page-measure")?.getBoundingClientRect().toJSON(),
        command: document.querySelector(".story-player")?.getAttribute("data-current-command-index") };
      const key = JSON.stringify(sample);
      stable = key === previous ? stable + 1 : 0; previous = key;
      if (stable >= 12) return sample;
    }
    throw Error("NVL geometry did not settle within 240 rendered frames");
  });
  try {
    await startRuntime(page, server.url, [
      { type: "dialog", character_id: "alice", text: "NVL 第一行保留。", presentation_mode: "nvl" },
      { type: "narration", text: "NVL 第二行累积，打开菜单不清空。", presentation_mode: "nvl" },
      { type: "dialog", character_id: "alice", text, presentation_mode: "nvl", clear_nvl_page_before: true },
    ]);
    await revealAndAdvance(page);
    await revealAndAdvance(page);
    await page.locator(".dialog-box").press("Enter");
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
    const initial = await capture(); snapshots.push({ stage: "before-menu", ...initial });
    assert(initial.pages > 1 && initial.page === 1);
    const fragments = [];
    for (let index = 1; index <= initial.pages; index++) {
      const before = await capture();
      assert.equal(before.pages, initial.pages, "Pagination must remain stable while reading one authored line");
      assert.equal(before.page, index);
      if ([1, Math.ceil(initial.pages / 2), initial.pages].includes(index)) {
        await page.getByTestId("renpy-quick-settings").click();
        await page.getByTestId("settings-screen").waitFor();
        await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
          ?.getAttribute("data-runtime-screen-transition") === "idle");
        await page.getByTestId("settings-finish").click();
        await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
          ?.getAttribute("data-runtime-screen-transition") === "idle"
          && !document.querySelector(".game-launch-blackout"));
        const after = await capture(); snapshots.push({ stage: `menu-return-page-${index}`, ...after });
        assert.equal(after.pages, before.pages, "Settings return must retain NVL pagination");
        assert.equal(after.page, before.page, "Settings return must retain current NVL fragment");
        assert.equal(after.text, before.text, "Settings return must retain the exact visible text");
        assert.equal(after.font, before.font, "Settings return must retain NVL font size");
        assert(after.done, "Completed NVL text must not restart typing");
      }
      fragments.push(before.text);
      if (index < initial.pages) {
        await page.locator(".dialog-box").press("Enter");
        await page.waitForFunction(expected => Number(document.querySelector(".dialog-box")?.dataset.dialogPage) === expected
          && document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true", index + 1);
      }
    }
    assert.equal(fragments.join(""), text, "Menu visits and NVL pagination must preserve all characters");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `nvl-menu-stability-${width}.png`) });
    return { pages: initial.pages, snapshots, errors };
  } catch (error) {
    snapshots.push({ stage: "failure", ...await capture().catch(() => ({})) });
    fs.writeFileSync(path.join(output, `nvl-menu-stability-${width}.json`), JSON.stringify({ snapshots, errors }, null, 2));
    await page.screenshot({ path: path.join(output, `nvl-menu-stability-${width}-failure.png`) });
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(__filename, path.join(output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  let server, browser;
  try {
    server = await startOwnedViteServer({
      root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"),
      port: Number(process.env.NVL_PAGE_TEST_PORT || 6917),
      logFile: path.join(output, "server.log"),
    });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch({ headless: process.env.AGENTVN_NVL_PAGE_HEADED !== "1" });
    await server.run(async () => {
      if (selectedCase === "all") for (const [width, height] of viewports) {
        const context = await browser.newContext(contextOptions(width, height));
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(String(error)));
        await startRuntime(page, server.url);
        await page.getByTestId("game-state-playing").waitFor();
        const entry = { width, height, status: "RUNNING" };
        report.cases.push(entry);
        await page.locator(".nvl-page").waitFor({ state: "visible", timeout: 1800 });
        await revealAndAdvance(page);
        await page.locator(".nvl-page").getByText("第二句旁白", { exact: true }).waitFor();
        await revealAndAdvance(page);
        entry.beforeInspect = await page.locator(".dialog-box").evaluate(node => ({
          mode: node.getAttribute("data-dialog-content-mode"),
          text: node.innerText,
          currentCommand: document.querySelector("[data-testid='game-state-playing']")
            ?.getAttribute("data-current-command-index"),
        }));
        await page.waitForFunction(() => document.querySelector(".nvl-page [data-nvl-current='true'] .nvl-page-text")
          ?.textContent?.trim() === "第三句对白");
        entry.thirdNvl = await inspectNvlPage(page, width, height,
          ["第一句对白", "第二句旁白", "第三句对白"]);
        await page.getByTestId("renpy-quick-settings").click();
        await page.getByTestId("settings-screen").waitFor();
        await page.getByTestId("renpy-menu-return").click();
        await page.getByTestId("game-state-playing").waitFor();
        await page.locator(".game-launch-blackout").waitFor({ state: "detached" });
        entry.afterMenu = await inspectNvlPage(page, width, height,
          ["第一句对白", "第二句旁白", "第三句对白"]);
        await revealAndAdvance(page);
        const choice = page.getByRole("button", { name: "选择：继续普通对白", exact: true });
        await choice.waitFor();
        const choiceGeometry = await page.evaluate(() => {
          const content = document.querySelector(".nvl-page").getBoundingClientRect();
          const choice = document.querySelector(".choice-panel").getBoundingClientRect();
          return { content: content.toJSON(), choice: choice.toJSON() };
        });
        assert(choiceGeometry.content.right <= choiceGeometry.choice.left + 1
          || choiceGeometry.choice.right <= choiceGeometry.content.left + 1
          || choiceGeometry.content.bottom <= choiceGeometry.choice.top + 1
          || choiceGeometry.choice.bottom <= choiceGeometry.content.top + 1,
        `NVL choices must reserve space instead of covering accumulated text: ${JSON.stringify(choiceGeometry)}`);
        entry.choiceGeometry = choiceGeometry;
        await choice.click();
        await page.getByText("普通对白只保留当前句", { exact: true }).waitFor();
        const ordinaryCount = await page.locator(".nvl-page").count();
        assert.equal(ordinaryCount, 0, "切回普通对白后应清除 NVL 页面容器");
        assert.equal(await page.locator(".dialog-box .dialog-text").innerText(), "普通对白只保留当前句",
          "普通对白模式必须保留既有单句显示");
        assert.deepEqual(errors, [], "NVL 页面流程不得产生前端异常");
        entry.status = "PASS";
        await context.close();
      }
      const denseViewports = ["all", "dense", "compact"].includes(selectedCase)
        ? viewports.map(([width, height]) => [width, height, dpr]) : [];
      for (const [width, height, deviceScaleFactor] of denseViewports) {
        const geometry = await runDenseNvlCase(browser, server, width, height, deviceScaleFactor);
        report.cases.push({
          width,
          height,
          deviceScaleFactor,
          scenario: "dense-nvl-page-turning",
          status: "PASS",
          geometry,
        });
      }
      for (const [width, height] of (["all", "single-long", "compact"].includes(selectedCase) ? viewports : [])) {
        const geometry = await runSingleLongNvlLineCase(browser, server, width, height);
        report.cases.push({
          width,
          height,
          scenario: "single-long-nvl-line-pagination",
          status: "PASS",
          geometry,
        });
      }
      if (["all", "save-restore", "compact"].includes(selectedCase)) for (const [width, height] of viewports) {
        const geometry = await runNvlSaveRestoreCase(browser, server, width, height);
        report.cases.push({ width, height, scenario: "nvl-save-restore-page-position", status: "PASS", geometry });
      }
      if (["all", "menu-stability"].includes(selectedCase)) for (const [width, height] of viewports) {
        const geometry = await runNvlMenuStabilityCase(browser, server, width, height);
        report.cases.push({ width, height, scenario: "nvl-menu-stable-pagination", status: "PASS", geometry });
      }
      assert(report.cases.length > 0, "NVL page acceptance must execute at least one case");
      if (selectedCase === "all") assert.equal(report.cases.length, viewports.length * 5,
        "必须覆盖完整声明的视口矩阵、密集 NVL 与单句超长分页");
      if (selectedCase === "compact") assert.equal(report.cases.length, viewports.length * 3,
        "短外框必须覆盖完整主视口矩阵、密集翻页、超长分页与存档恢复；旧三句同页契约独立保留");
      report.status = "PASS";
    });
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    throw error;
  } finally {
    await browser?.close();
    await server?.stop();
    let responding = false;
    if (server) try { responding = (await fetch(server.url, { signal: AbortSignal.timeout(1200) })).ok; } catch {}
    report.cleanup = { serviceResponds: responding, status: responding ? "FAILED" : "PASS" };
    if (responding) { report.status = "FAILED"; process.exitCode = 1; }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
