"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { viewports } = require("./lib/editor-ui-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = process.env.AGENTVN_RUNTIME_MENU_MOTION_OUTPUT
  || path.join(root, "output/playwright/runtime-menu-motion", runId);
const requested = (process.env.RUNTIME_MOTION_VIEWPORTS || "").split(",").filter(Boolean);
const matrix = viewports.filter(item => ["1080p", "1440p", "4k"].includes(item.name)
  && (!requested.length || requested.includes(item.name)));
const report = { runId, scope: "runtime-menu-motion-real-browser-not-installed-final", status: "RUNNING",
  deviceScaleFactor: Number(process.env.RUNTIME_MOTION_DPR || 1),
  reducedMotion: process.env.RUNTIME_MOTION_REDUCED === "1", cases: [] };
const compiled = { exports: {} };
new Function("module", "exports", buildSync({
  stdin: { resolveDir: root, loader: "ts",
    contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(compiled, compiled.exports);

function fixture() {
  const id = "runtime-menu-motion";
  const now = new Date().toISOString();
  return {
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.9.0",
      game_id: id, title: "游戏菜单动效验收", author: "QA", version: "1.0.0", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "main", assets: [], created_at: now, updated_at: now },
    script: { schema_version: "1.1.0", game_id: id, title: "游戏菜单动效验收", entry_scene_id: "main",
      characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "菜单切换不应重新初始化剧情。" }] }] },
    uiSkin: compiled.exports.createRenpyUILayout(), assetUrls: {},
  };
}
async function idle(page) {
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle", undefined, { timeout: 15000 });
}
async function initialize(page, url) {
  await page.goto(`${url}/?mode=preview`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
  await page.evaluate(payload => window.postMessage({
    type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "runtime-menu-motion",
    revision: 1, requestId: "init", runId: "init", screen: "title_menu", ...payload,
  }, "*"), fixture());
  await page.getByTestId("game-state-title").waitFor();
  await idle(page);
}
async function watchLaunch(page, action) {
  await page.evaluate(() => {
    window.__launchFrames = [];
    window.__captureLaunch = true;
    const sample = () => {
      const blackout = document.querySelector('[data-testid="game-launch-blackout"]');
      if (blackout) {
        const seam = document.querySelector("[data-runtime-screen-transition]");
        window.__launchFrames.push({
          phase: [...blackout.classList].find(value => value.startsWith("is-")) ?? "",
          opacity: Number(getComputedStyle(blackout).opacity),
          screen: seam?.getAttribute("data-runtime-committed-screen") ?? null,
        });
      }
      if (window.__captureLaunch) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await action();
  await page.getByTestId("game-state-playing").waitFor({ timeout: 30000 });
  await page.waitForSelector('[data-testid="game-launch-blackout"]', { state: "detached", timeout: 30000 });
  return page.evaluate(() => {
    window.__captureLaunch = false;
    return window.__launchFrames;
  });
}
async function navigation(page, viewport) {
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-screen").waitFor();
  await idle(page);
  const focusTransferred = await page.evaluate(() =>
    document.querySelector(".runtime-screen-transition-current")?.contains(document.activeElement));
  assert(focusTransferred, "Replacing the title page must transfer focus into the ready menu, not leave it on body");
  const settingsGeometry = await page.getByTestId("settings-screen").evaluate(frame => {
    const panel = frame.querySelector(".settings-renpy");
    const rect = panel.getBoundingClientRect().toJSON();
    const clipped = [];
    const buttons = [...frame.querySelectorAll(".settings-tabs button, .settings-footer button")].map(button => {
      const r = button.getBoundingClientRect();
      for (let node = button.parentElement; node && node !== frame.parentElement; node = node.parentElement) {
        const css = getComputedStyle(node), bounds = node.getBoundingClientRect();
        if (["hidden", "clip", "auto", "scroll"].includes(css.overflowY)
          && (r.top < bounds.top - 1 || r.bottom > bounds.bottom + 1)) clipped.push(button.textContent);
      }
      return { rect: r.toJSON(), hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    });
    return { rect, frame: frame.getBoundingClientRect().toJSON(), buttons, clipped };
  });
  assert(settingsGeometry.rect.height > 100 && settingsGeometry.frame.height > 100,
    "Managed settings page must fill the available outlet instead of collapsing its flex content");
  // On very short windows the categories may deliberately scroll. Normal
  // landscape windows must expose every category and footer action directly.
  if (viewport.height >= 412) {
    assert(settingsGeometry.clipped.length === 0 && settingsGeometry.buttons.every(button => button.hit),
      "Settings categories and footer actions must not be clipped or lose real pointer hit targets");
  }
  report.cases.push({ name: "managed-settings-content-retains-usable-height", viewport, settingsGeometry, status: "PASS" });
  await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="renpy-menu-navigation"]');
    const rect = nav.getBoundingClientRect().toJSON();
    window.__menuMotion = { nav, rect, frames: [], clicked: false };
    document.addEventListener("click", event => {
      if (event.target.closest('[data-testid="renpy-menu-about"]')) window.__menuMotion.clicked = true;
    }, { capture: true, once: true });
    const capture = at => {
      const record = window.__menuMotion;
      const seam = document.querySelector("[data-runtime-screen-transition]");
      const currentNav = document.querySelector('[data-testid="renpy-menu-navigation"]');
      const content = document.querySelector('[data-runtime-motion-surface]');
      if (record.clicked) record.frames.push({
        at, phase: seam?.getAttribute("data-runtime-transition-phase"),
        screen: seam?.getAttribute("data-runtime-presented-screen"),
        duration: Number(seam?.getAttribute("data-runtime-transition-duration") || 0),
        black: seam ? Number(getComputedStyle(seam, "::before").opacity) : 0,
        sameNavigation: currentNav === record.nav,
        navigationRect: currentNav?.getBoundingClientRect().toJSON(),
        opacity: content ? Number(getComputedStyle(content).opacity) : 1,
        snapshotOpacity: Number(getComputedStyle(document.querySelector("[data-runtime-transition-snapshot]")
          ?? document.body).opacity),
        snapshotInert: document.querySelector("[data-runtime-transition-snapshot]")?.inert,
        transform: content ? getComputedStyle(content).transform : "none",
        animations: content?.getAnimations().map(animation => ({
          playState: animation.playState, currentTime: animation.currentTime,
          duration: animation.effect?.getTiming().duration,
        })) ?? [],
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      });
      if (!record.clicked || record.frames.length < 2
        || seam?.getAttribute("data-runtime-screen-transition") !== "idle")
        requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
  });
  await page.getByTestId("renpy-menu-about").click();
  await page.getByTestId("about-screen").waitFor();
  await idle(page);
  const sample = await page.evaluate(() => ({
    frames: window.__menuMotion.frames, rect: window.__menuMotion.rect,
    sameNavigation: window.__menuMotion.nav === document.querySelector('[data-testid="renpy-menu-navigation"]'),
  }));
  report.cases.push({ name: "shared-menu-keeps-navigation-through-crossfade", viewport, sample, status: "CHECKING" });
  assert(sample.frames.length >= 2, "Capture must include actual rendered transition frames");
  const expectedDuration = process.env.RUNTIME_MOTION_REDUCED === "1" ? 816 : 1632;
  const phases = [...new Set(sample.frames.map(frame => frame.phase))];
  assert(phases.includes("crossfading") && !phases.some(phase => ["covering", "swap", "revealing"].includes(phase)),
    "Renpy non-gameplay pages must crossfade rather than use a black curtain");
  assert(sample.frames.every(frame => frame.black < .01), "Menu crossfade must never darken the full viewport");
  assert(sample.frames.some(frame => frame.phase === "crossfading" && frame.opacity > .1
    && frame.opacity < .9 && frame.snapshotOpacity > .1 && frame.snapshotInert),
    "Real crossfade frames must overlap an inert outgoing presentation and the ready page");
  assert(sample.frames.every(frame => frame.phase === "idle"
    ? frame.duration === 0 : frame.duration === expectedDuration),
    `The full screen transition must use the established ${expectedDuration}ms duration`);
  assert(sample.sameNavigation && sample.frames.every(frame => frame.sameNavigation),
    "Menu subpages must retain the same mounted navigation, not recreate it");
  for (const frame of sample.frames) {
    assert(frame.horizontalOverflow <= 1, "Menu motion caused horizontal overflow");
    assert(frame.navigationRect, "Navigation vanished during the content transition");
    for (const key of ["x", "y", "width", "height"])
      assert(Math.abs(frame.navigationRect[key] - sample.rect[key]) <= 1, `Navigation ${key} moved`);
  }
  assert(sample.frames.every(frame => frame.transform === "none"),
    "Menu page crossfade must not move its content or navigation geometry");
  const navHit = await page.getByTestId("renpy-menu-help").evaluate(button => {
    const r = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  assert(navHit, "Ready navigation must retain its real hit target");
  report.cases.at(-1).status = "PASS";
  report.cases.push({ name: "menu-crossfade-has-a-single-ready-functional-page", viewport,
    status: "CHECKING", opacityFrames: sample.frames.map(frame => frame.black) });
  assert(sample.frames.every(frame => frame.navigationRect)
    && await page.locator("[data-runtime-transition-snapshot]").count() === 0,
    "The stable rail must remain mounted and the outgoing snapshot must be removed at idle");
  await page.screenshot({ path: path.join(output, `${viewport.name}-about-revealed.png`) });
  report.cases.at(-1).status = "PASS";

  const nav = page.getByTestId("renpy-menu-navigation");
  await page.getByTestId("renpy-menu-help").click();
  await page.waitForFunction(() => {
    const seam = document.querySelector("[data-runtime-screen-transition]");
    const content = document.querySelector("[data-runtime-motion-surface]");
    return seam?.getAttribute("data-runtime-transition-phase") === "crossfading"
      && content && Number(getComputedStyle(content).opacity) > .2
      && Number(getComputedStyle(content).opacity) < .8;
  });
  await page.getByTestId("renpy-menu-history").click();
  const redirected = await page.evaluate(() => {
    const seam = document.querySelector("[data-runtime-screen-transition]");
    return {
      target: seam?.getAttribute("data-runtime-transition-to"),
      current: seam?.getAttribute("data-runtime-presented-screen"),
      black: Number(seam ? getComputedStyle(seam, "::before").opacity : 0),
    };
  });
  assert(redirected.target === "history" && redirected.black < .01,
    "Ready navigation must accept interruption without reintroducing the blackout");
  await page.locator('[data-ui-screen="history"]').waitFor();
  await idle(page);

  const rapidRequest = { targets: ["renpy-menu-help", "renpy-menu-settings", "renpy-menu-about"] };
  for (const testId of rapidRequest.targets) await page.getByTestId(testId).click();
  await page.waitForFunction(() =>
    document.querySelector("[data-runtime-screen-transition]")
      ?.getAttribute("data-runtime-transition-to") === "about");
  const interruption = rapidRequest;
  await page.getByTestId("about-screen").waitFor();
  await idle(page);
  const interrupted = await page.evaluate(({ targets }) => {
    const seam = document.querySelector("[data-runtime-screen-transition]");
    const nav = document.querySelector('[data-testid="renpy-menu-navigation"]');
    const current = seam?.getAttribute("data-runtime-presented-screen");
    const active = nav?.querySelector('[aria-current="page"]')?.getAttribute("data-testid");
    return {
      current, active,
      sameNavigation: nav === window.__menuMotion.nav,
      navCount: document.querySelectorAll('[data-testid="renpy-menu-navigation"]').length,
      layerCount: document.querySelectorAll(".runtime-screen-transition-layer").length,
      phase: seam?.getAttribute("data-runtime-transition-phase"),
      targets,
      black: Number(getComputedStyle(seam, "::before").opacity),
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  }, interruption);
  assert(interrupted.current === "about" && interrupted.active === "renpy-menu-about",
    "Rapid A→B→C navigation must settle on the latest requested page", interrupted);
  assert(interrupted.sameNavigation && interrupted.navCount === 1 && interrupted.layerCount === 1,
    "Interrupted navigation must retain one stable navigation rail and one page layer", interrupted);
  assert(interrupted.phase === "idle" && interrupted.black < .01 && interrupted.overflow <= 1,
    "Interrupted navigation must settle after revealing the latest page without overflow", interrupted);
  report.cases.push({ name: "rapid-navigation-settles-on-latest-request", viewport, interruption: interrupted, status: "PASS" });

  await page.evaluate(() => {
    window.__keyboardFrames = [];
    window.__captureKeyboardTransition = true;
    const capture = () => {
      const seam = document.querySelector("[data-runtime-screen-transition]");
      if (seam?.getAttribute("data-runtime-screen-transition") === "active") {
        window.__keyboardFrames.push({
          phase: seam?.getAttribute("data-runtime-transition-phase"),
          black: seam ? Number(getComputedStyle(seam, "::before").opacity) : 0,
          duration: Number(seam?.getAttribute("data-runtime-transition-duration") || 0),
          opacity: Number(getComputedStyle(document.querySelector("[data-runtime-motion-surface]") ?? document.body).opacity),
        });
      }
      if (window.__captureKeyboardTransition) requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
  });
  await page.getByTestId("renpy-menu-help").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("help-screen").waitFor();
  await idle(page);
  await page.evaluate(() => { window.__captureKeyboardTransition = false; });
  const keyboard = await page.evaluate(() => {
    const seam = document.querySelector("[data-runtime-screen-transition]");
    const content = document.querySelector('[data-testid="renpy-menu-content"]');
    return {
      screen: seam?.getAttribute("data-runtime-presented-screen"),
      phase: seam?.getAttribute("data-runtime-transition-phase"),
      duration: Number(seam?.getAttribute("data-runtime-transition-duration") || 0),
      animations: content?.getAnimations().length ?? 0,
      frames: window.__keyboardFrames,
      focusInside: document.querySelector('[data-testid="renpy-menu-navigation"]')?.contains(document.activeElement),
    };
  });
  const keyboardPhases = [...new Set(keyboard.frames.map(frame => frame.phase))];
  if (!(keyboard.screen === "help" && keyboard.phase === "idle" && keyboard.duration === 0
    && keyboard.animations === 0 && keyboard.focusInside
    && keyboardPhases.includes("crossfading") && keyboard.frames.every(frame => frame.black < .01)
    && keyboard.frames.some(frame => frame.opacity > .1 && frame.opacity < .9))) {
    throw new Error(`Keyboard page navigation must crossfade and retain real focus\n${JSON.stringify(keyboard, null, 2)}`);
  }
  report.cases.push({ name: "keyboard-navigation-crossfades-and-restores-focus", viewport, keyboard, status: "PASS" });

  async function assertDirectScreenChange(action, expectedScreen) {
    await page.evaluate(() => {
      window.__directScreenFrames = [];
      window.__captureDirectScreen = true;
      const capture = () => {
        const seam = document.querySelector("[data-runtime-screen-transition]");
        window.__directScreenFrames.push({
          phase: seam?.getAttribute("data-runtime-transition-phase") ?? "missing",
          presented: seam?.getAttribute("data-runtime-presented-screen"),
          committed: seam?.getAttribute("data-runtime-committed-screen"),
          black: seam ? Number(getComputedStyle(seam, "::before").opacity) : 0,
          style: seam?.getAttribute("data-runtime-transition-style"),
        });
        if (window.__captureDirectScreen) requestAnimationFrame(capture);
      };
      requestAnimationFrame(capture);
    });
    await page.evaluate(async nextAction => {
      const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
      const state = useRuntimeStore.getState();
      if (nextAction === "loadGame") {
        if (!state.currentGame) throw new Error("Direct loadGame regression requires the loaded fixture.");
        await state.loadGame(state.currentGame);
      } else state.setRuntimeMode(nextAction);
    }, action);
    await page.waitForFunction(expected => {
      const seam = document.querySelector("[data-runtime-screen-transition]");
      return seam?.getAttribute("data-runtime-presented-screen") === expected
        && seam?.getAttribute("data-runtime-screen-transition") === "idle";
    }, expectedScreen, { timeout: 15000 });
    const frames = await page.evaluate(() => {
      window.__captureDirectScreen = false;
      return window.__directScreenFrames;
    });
    const phases = [...new Set(frames.map(frame => frame.phase))];
    assert(phases.includes("crossfading") && frames.every(frame => frame.black < .01),
      `Direct non-gameplay Renpy change to ${expectedScreen} must crossfade`, frames);
    assert(frames.some(frame => frame.phase === "crossfading"
      && frame.presented === expectedScreen && frame.committed === expectedScreen),
    `Direct Runtime change to ${expectedScreen} must commit one functional page before fading`, frames);
    report.cases.push({ name: `direct-runtime-screen-change-${expectedScreen}-crossfades`,
      viewport, phases, frames, status: "PASS" });
  }

  await assertDirectScreenChange("library", "library");
  await assertDirectScreenChange("fixed", "title_menu");
  await assertDirectScreenChange("library", "library");
  await assertDirectScreenChange("loadGame", "title_menu");
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  let server, browser, page;
  try {
    assert(matrix.length > 0, "Runtime menu acceptance must not execute an empty matrix");
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(output, "vite.log") });
    report.owner = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch({args:process.env.RUNTIME_QA_GPU==="1"?["--use-angle=d3d11"]:[]});
    for (const viewport of matrix) {
      page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: Number(process.env.RUNTIME_MOTION_DPR || 1),
        reducedMotion: process.env.RUNTIME_MOTION_REDUCED === "1" ? "reduce" : "no-preference" });
      await server.run(async () => {
        await initialize(page, server.url);
        await navigation(page, viewport);
      });
      await page.close();
    }
    const gameplay = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    try {
      await server.run(async () => {
        await initialize(gameplay, server.url);
        const entryFrames = await watchLaunch(gameplay, () => gameplay.getByTestId("start-new-game").click());
        assert(entryFrames.some(frame => frame.phase === "is-covering" && frame.opacity > 0 && frame.opacity < 1),
          "Entering gameplay must keep the real black cover's opacity transition");
        const entryCommit = entryFrames.find(frame => frame.screen === "playing");
        assert(entryCommit && entryCommit.phase !== "is-arming",
          "Gameplay must commit only after the independent launch-cover flow begins");
        await gameplay.keyboard.press("Escape");
        await gameplay.getByTestId("continue-game").waitFor();
        const returnFrames = await watchLaunch(gameplay, () => gameplay.getByTestId("continue-game").click());
        assert(returnFrames.some(frame => frame.phase === "is-covering" && frame.opacity > 0 && frame.opacity < 1),
          "Returning to gameplay must retain the real black cover's opacity transition");
        assert(returnFrames.some(frame => frame.screen === "playing"),
          "Return-to-game cover must commit gameplay through the launch flow");
        report.gameplayLaunch = { status: "PASS", path: "title→playing→main-menu→playing",
          blackTransition: "dedicated-game-launch-blackout", entryFrames, returnFrames };
      });
    } finally {
      await gameplay.close();
    }
    assert(report.cases.length === matrix.length * 9 && report.cases.every(item => item.status === "PASS"));
    assert(report.gameplayLaunch?.status === "PASS", "Gameplay launch/return transition evidence is required");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await server?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${path.join(output, "report.json")}`);
  }
})();
