#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "playwright", "game-entry-transition",
  new Date().toISOString().replace(/[:.]/g, "-"));
let URL;
let server;
const report = { status: "RUNNING", scope: "real-browser-game-entry-and-save-load-not-installed", checks: [] };

function expect(condition, message, detail) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`);
  report.checks.push({ message, status: "PASS", detail });
  console.log(`[PASS] ${message}`);
}

async function preparePage(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.locator(".boot-overlay").waitFor({ state: "detached", timeout: 20_000 });
  await page.evaluate(async () => {
    const [{ useRuntimeStore }, { progressiveAssetLoader }, saves] = await Promise.all([
      import("/src/store/runtimeStore.ts"),
      import("/src/engine/progressiveAssetLoader.ts"),
      import("/src/engine/desktopSaveManager.ts"),
    ]);
    const now = "2026-08-09T00:00:00.000Z";
    const script = {
      schema_version: "1.1.0",
      game_id: "game_entry_transition_qa",
      title: "Game Entry Transition QA",
      entry_scene_id: "chapter_1",
      scenes: [
        {
          scene_id: "chapter_1",
          title: "第一章",
          summary: "",
          chapter: 1,
          tags: [],
          commands: [{ type: "narration", text: "第一章入口" }],
        },
        {
          scene_id: "chapter_2",
          title: "第二章",
          summary: "",
          chapter: 2,
          tags: [],
          commands: [{ type: "narration", text: "第二章存档" }],
        },
      ],
    };
    const manifest = {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.2.0",
      game_id: script.game_id,
      title: script.title,
      author: "AgentVN QA",
      description: "Game entry transaction fixture",
      version: "1.0.0",
      language: "zh-CN",
      tags: ["acceptance"],
      entry_script: "script.json",
      entry_scene_id: script.entry_scene_id,
      assets: [],
      created_at: now,
      updated_at: now,
    };
    const game = {
      install_id: script.game_id,
      game_id: script.game_id,
      title: script.title,
      author: manifest.author,
      version: manifest.version,
      description: manifest.description,
      language: manifest.language,
      manifest,
      script,
      gallery: [],
      assetUrls: {},
      imported_at: now,
      updated_at: now,
      source_file_name: "game-entry-transition.vncart",
      cartridge_path: "",
    };
    localStorage.removeItem(`agentvn.gamecli.saves.${game.install_id}`);
    await useRuntimeStore.getState().loadGame(game);

    let traceActive = false;
    let trace = [];
    let poll = 0;
    const record = (source) => {
      if (!traceActive) return;
      const state = useRuntimeStore.getState();
      const overlay = document.querySelector("[data-testid='game-launch-blackout']");
      trace.push({
        source,
        at: performance.now(),
        phase: state.launchTransition,
        duration: state.launchTransitionDurationMs,
        screen: state.screen,
        scene: state.engineState.currentSceneId,
        playthroughId: state.engineState.playthroughId,
        opacity: overlay ? Number(getComputedStyle(overlay).opacity) : null,
        feedbackVisible: Boolean(document.querySelector(".launch-feedback.is-visible")),
      });
    };
    useRuntimeStore.subscribe(() => record("store"));
    const originalPrepareScene = progressiveAssetLoader.prepareScene.bind(progressiveAssetLoader);

    window.__GAME_ENTRY_QA__ = {
      store: useRuntimeStore,
      game,
      beginTrace() {
        trace = [];
        traceActive = true;
        record("begin");
        poll = window.setInterval(() => record("poll"), 12);
      },
      endTrace() {
        record("end");
        traceActive = false;
        window.clearInterval(poll);
        return trace;
      },
      snapshot() {
        const state = useRuntimeStore.getState();
        return {
          phase: state.launchTransition,
          duration: state.launchTransitionDurationMs,
          screen: state.screen,
          scene: state.engineState.currentSceneId,
          playthroughId: state.engineState.playthroughId,
          entryError: state.entryError,
        };
      },
      setSlowPreparation(delayMs) {
        progressiveAssetLoader.prepareScene = delayMs > 0
          ? async (...args) => {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return originalPrepareScene(...args);
          }
          : originalPrepareScene;
      },
      async seedSaves() {
        const runtime = useRuntimeStore.getState();
        runtime.engine.previewScene("chapter_1", { stopAt: "first_stable_frame", suppressTransientEffects: true });
        const manual = {
          ...runtime.engine.createSaveSnapshot(1),
          save_kind: "manual",
          install_id: game.install_id,
          game_id: game.game_id,
          created_at: "2026-08-09T01:00:00.000Z",
        };
        runtime.engine.previewScene("chapter_2", { stopAt: "first_stable_frame", suppressTransientEffects: true });
        const automatic = {
          ...runtime.engine.createSaveSnapshot(1),
          save_kind: "auto",
          install_id: game.install_id,
          game_id: game.game_id,
          created_at: "2026-08-09T02:00:00.000Z",
        };
        const invalid = {
          ...automatic,
          save_id: "invalid-save",
          save_kind: "manual",
          slot: 2,
          scene_id: "missing_scene",
          created_at: "2026-08-09T03:00:00.000Z",
        };
        await saves.writeDesktopSave(game.install_id, { kind: "manual", slot: 1 }, manual);
        await saves.writeDesktopSave(game.install_id, { kind: "auto", slot: 1 }, automatic);
        await saves.writeDesktopSave(game.install_id, { kind: "manual", slot: 2 }, invalid);
        await useRuntimeStore.getState().loadGame(game);
      },
      async previewChapterTwo() {
        await useRuntimeStore.getState().previewScene("chapter_2");
      },
      returnToTitle() {
        useRuntimeStore.getState().returnToTitle();
      },
      openMenu() {
        useRuntimeStore.getState().openMenu();
      },
    };
  });
  await page.locator('[data-testid="game-state-title"]').waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(() =>
    document.querySelector("[data-runtime-screen-transition]")
      ?.getAttribute("data-runtime-screen-transition") === "idle"
    && !document.querySelector('[data-testid="game-launch-blackout"]'),
  undefined, { timeout: 20_000 });
}

async function snapshot(page) {
  return page.evaluate(() => window.__GAME_ENTRY_QA__.snapshot());
}

async function runTransaction(page, trigger) {
  await page.evaluate(() => window.__GAME_ENTRY_QA__.beginTrace());
  await trigger();
  await page.waitForFunction(() => window.__GAME_ENTRY_QA__.snapshot().phase !== "idle");
  await page.waitForFunction(() => window.__GAME_ENTRY_QA__.snapshot().phase === "idle", null, { timeout: 15_000 });
  return page.evaluate(() => window.__GAME_ENTRY_QA__.endTrace());
}

function assertCoveredCommit(trace, label) {
  const commits = trace.filter((item, index) => {
    const previous = trace[index - 1];
    return previous && (item.screen !== previous.screen || item.scene !== previous.scene || item.playthroughId !== previous.playthroughId);
  });
  expect(
    commits.length > 0 && commits.every((item) => item.opacity !== null && item.opacity >= 0.99),
    `${label} only commits the new runtime frame behind an opaque blackout`,
    commits,
  );
}

async function normalMotionChecks(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  try {
    await preparePage(page);

    const beforeStart = await snapshot(page);
    const startTrace = await runTransaction(page, () => page.locator('[data-testid="start-new-game"]').evaluate((button) => {
      button.click();
      button.click();
    }));
    const afterStart = await snapshot(page);
    expect(
      afterStart.scene === "chapter_1" && afterStart.playthroughId === beforeStart.playthroughId + 1,
      "Start Game begins exactly one playthrough at the authored entry scene",
      { beforeStart, afterStart },
    );
    assertCoveredCommit(startTrace, "Start Game");
    expect(
      !startTrace.some((item) => item.feedbackVisible),
      "fast entry does not flash the delayed loading indicator",
      startTrace.filter((item) => item.feedbackVisible),
    );

    await page.evaluate(async () => {
      await window.__GAME_ENTRY_QA__.previewChapterTwo();
      window.__GAME_ENTRY_QA__.openMenu();
    });
    await page.locator('[data-runtime-state="main_menu"]').waitFor({ state: "visible" });
    const restartTrace = await runTransaction(page, () => page.locator('[data-testid="start-new-game"]').click());
    expect((await snapshot(page)).scene === "chapter_1", "Restart always returns from chapter two to the authored entry scene", await snapshot(page));
    assertCoveredCommit(restartTrace, "Restart");

    await page.evaluate(() => window.__GAME_ENTRY_QA__.openMenu());
    await page.locator('[data-runtime-state="main_menu"]').waitFor({ state: "visible" });
    const resumeTrace = await runTransaction(page, () => page.locator('[data-testid="continue-game"]').click());
    expect((await snapshot(page)).scene === "chapter_1", "in-game Continue preserves the active scene", await snapshot(page));
    assertCoveredCommit(resumeTrace, "in-game Continue");

    await page.evaluate(() => window.__GAME_ENTRY_QA__.seedSaves());
    await page.locator('[data-testid="game-state-title"]').waitFor({ state: "visible" });
    const continueTrace = await runTransaction(page, () => page.locator('[data-testid="continue-game"]').click());
    expect((await snapshot(page)).scene === "chapter_2", "title Continue selects the latest compatible auto save", await snapshot(page));
    assertCoveredCommit(continueTrace, "title Continue");

    await page.evaluate(() => window.__GAME_ENTRY_QA__.returnToTitle());
    await page.locator('[data-testid="open-save-load"]').click();
    await page.locator(".save-load-screen").waitFor({ state: "visible" });
    const manualTrace = await runTransaction(page, () => page.locator('[data-testid="save-slot-manual-1"] .save-card-main').click());
    expect((await snapshot(page)).scene === "chapter_1", "manual Load enters the saved first chapter", await snapshot(page));
    assertCoveredCommit(manualTrace, "manual Load");

    await page.evaluate(() => window.__GAME_ENTRY_QA__.returnToTitle());
    await page.locator('[data-testid="open-save-load"]').click();
    await page.locator(".save-kind-tabs button").nth(1).click();
    const autoTrace = await runTransaction(page, () => page.locator('[data-testid="save-slot-auto-1"] .save-card-main').click());
    expect((await snapshot(page)).scene === "chapter_2", "auto Load enters the saved second chapter", await snapshot(page));
    assertCoveredCommit(autoTrace, "auto Load");

    await page.evaluate(() => window.__GAME_ENTRY_QA__.returnToTitle());
    await page.locator('[data-testid="open-save-load"]').click();
    const beforeInvalid = await snapshot(page);
    const invalidTrace = await runTransaction(page, () => page.locator('[data-testid="save-slot-manual-2"] .save-card-main').click());
    const afterInvalid = await snapshot(page);
    expect(
      afterInvalid.screen === "save_load"
        && afterInvalid.scene === beforeInvalid.scene
        && afterInvalid.playthroughId === beforeInvalid.playthroughId
        && afterInvalid.entryError,
      "invalid Load reveals back to the original page without mutating progress",
      { beforeInvalid, afterInvalid },
    );
    expect(invalidTrace.some((item) => item.phase === "revealing"), "invalid Load still performs a complete reveal", invalidTrace);

    await page.evaluate(() => {
      window.__GAME_ENTRY_QA__.returnToTitle();
      window.__GAME_ENTRY_QA__.setSlowPreparation(1100);
    });
    await page.locator('[data-testid="game-state-title"]').waitFor({ state: "visible" });
    await page.evaluate(() => window.__GAME_ENTRY_QA__.beginTrace());
    await page.locator('[data-testid="continue-game"]').click();
    await page.waitForTimeout(850);
    const slowFeedback = await page.locator(".launch-feedback.is-visible").evaluate((node) => ({
      visible: node.classList.contains("is-visible") && Number(getComputedStyle(node).opacity) > 0,
      opacity: Number(getComputedStyle(node).opacity),
      role: node.getAttribute("role"),
      text: node.textContent,
    }));
    await page.waitForFunction(() => window.__GAME_ENTRY_QA__.snapshot().phase === "idle", null, { timeout: 15_000 });
    const slowTrace = await page.evaluate(() => {
      window.__GAME_ENTRY_QA__.setSlowPreparation(0);
      return window.__GAME_ENTRY_QA__.endTrace();
    });
    expect(
      slowFeedback.visible && slowFeedback.role === "status" && slowFeedback.text.includes("正在读取最近存档"),
      "slow entry shows operation-specific status only after the 800ms threshold",
      slowFeedback,
    );
    expect(slowTrace.some((item) => item.feedbackVisible), "slow entry trace includes visible loading feedback", slowTrace);

    await page.screenshot({ path: path.join(OUT, "normal-final.png"), fullPage: true });
  } finally {
    await context.close();
  }
}

async function reducedMotionChecks(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await preparePage(page);
    await page.evaluate(() => window.__GAME_ENTRY_QA__.beginTrace());
    await page.locator('[data-testid="start-new-game"]').click();
    await page.waitForFunction(() => window.__GAME_ENTRY_QA__.snapshot().phase === "covering");
    const css = await page.locator('[data-testid="game-launch-blackout"]').evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        property: style.transitionProperty,
        duration: style.transitionDuration,
        transform: style.transform,
      };
    });
    const covering = await snapshot(page);
    await page.waitForFunction(() => window.__GAME_ENTRY_QA__.snapshot().phase === "idle", null, { timeout: 10_000 });
    const trace = await page.evaluate(() => window.__GAME_ENTRY_QA__.endTrace());
    expect(
      covering.duration === 408
        && css.property === "opacity"
        && ["0.408s", "408ms"].includes(css.duration)
        && css.transform === "none",
      "reduced motion uses the doubled 408ms opacity-only blackout with no movement",
      { covering, css },
    );
    expect(
      trace.some((item) => item.phase === "revealing" && item.duration === 408),
      "reduced-motion reveal also uses the doubled 408ms fade",
      trace,
    );
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let browser;
  try {
    server = await startOwnedViteServer({ root: path.join(ROOT, "GameCli_framework"),
      configFile: path.join(ROOT, "GameCli_framework/vite.config.cjs"), logFile: path.join(OUT, "server.log") });
    URL = `${server.url}/`;
    report.owner = { url: URL, runId: server.runId, pid: server.pid };
    browser = await chromium.launch({ headless: true });
    await server.run(() => normalMotionChecks(browser));
    await server.run(() => reducedMotionChecks(browser));
    expect(report.checks.length >= 18, "entry acceptance must not pass with empty or incomplete coverage",
      { checks: report.checks.length });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    throw error;
  } finally {
    await browser?.close();
    await server?.stop();
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${path.join(OUT, "report.json")}`);
  }
  console.log("Game entry transition Playwright acceptance passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
