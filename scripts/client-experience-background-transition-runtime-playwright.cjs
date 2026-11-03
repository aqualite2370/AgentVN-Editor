#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../Editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "playwright", "client-experience-enhancement", "background-transition-runtime");
const ENGINE_ONLY = process.argv.includes("--engine-only");
const INTERRUPTION_ONLY = process.argv.includes("--interruption");
const REPORT = path.join(
  OUT,
  ENGINE_ONLY
    ? "engine-report.json"
    : INTERRUPTION_ONLY
      ? "interruption-report.json"
      : "runtime-report.json",
);
const PORT = Number(process.env.AGENTVN_BACKGROUND_TRANSITION_PORT || 6995);
const URL = `http://127.0.0.1:${PORT}/`;
const VITE_ENTRY = path.join(ROOT, "GameCli_framework", "node_modules", "vite", "bin", "vite.js");
const checks = [];
const consoleErrors = [];
const pageErrors = [];
let server;
let serverOutput;

function expect(condition, assertion, value, file = "GameCli_framework/src/engine/StoryEngine.ts") {
  if (!condition) throw new Error(`${assertion}; ${JSON.stringify(value)}`);
  checks.push({ assertion, value, file });
}

function loadEngineApi() {
  const esbuild = require("../Editor/node_modules/esbuild");
  const result = esbuild.buildSync({
    stdin: {
      contents: "export { StoryEngine } from './GameCli_framework/src/engine/StoryEngine';",
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: "output/playwright/background-transition-engine-entry.ts",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  const filename = path.join(OUT, "background-transition-engine.cjs");
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(ROOT);
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports;
}

function runEngineChecks() {
  global.window = {
    setTimeout: () => 0,
    dispatchEvent: () => true,
  };
  global.performance ??= { now: () => Date.now() };
  const { StoryEngine } = loadEngineApi();
  const engine = new StoryEngine();

  engine.executeCommand({
    type: "background",
    background_id: "bg_a",
    background_fit: "cover",
    transition: "fade",
    transition_config: { kind: "reveal_center", duration_ms: 760, easing: "ease-out" },
  });
  expect(engine.state.background === "bg_a" && engine.state.backgroundFit === "cover", "background command writes id and normalized fit", engine.state);
  expect(
    engine.state.backgroundTransition?.kind === "reveal_center"
      && engine.state.backgroundTransition.duration_ms === 760
      && engine.state.backgroundTransition.easing === "ease-out",
    "structured background transition is normalized into engine state",
    engine.state.backgroundTransition,
  );
  expect(engine.state.backgroundTransitionKey === 1, "first real background assignment increments transition key", engine.state.backgroundTransitionKey);

  engine.executeCommand({
    type: "background",
    background_id: "bg_a",
    background_fit: "cover",
    transition: "fade",
    transition_config: { kind: "reveal_center", duration_ms: 760, easing: "ease-out" },
  });
  expect(engine.state.backgroundTransitionKey === 1, "identical background command does not create a meaningless transition key", engine.state.backgroundTransitionKey);

  engine.executeCommand({
    type: "background",
    background_id: "bg_a",
    background_fit: "cover",
    transition_config: { kind: "reveal_center", duration_ms: 900, easing: "ease-out" },
  });
  expect(engine.state.backgroundTransitionKey === 2, "transition config change is observable even when id and fit stay the same", engine.state.backgroundTransitionKey);
  expect(engine.state.backgroundTransition?.duration_ms === 900, "same-image transition metadata updates to the new normalized config", engine.state.backgroundTransition);

  engine.executeCommand({
    type: "background",
    background_id: "bg_b",
    background_fit: "contain",
    transition: "wipe_rtl",
  });
  expect(
    engine.state.backgroundTransition?.kind === "wipe_right_to_left"
      && engine.state.backgroundTransition.duration_ms === 420,
    "legacy background transition maps through the shared resolver",
    engine.state.backgroundTransition,
  );
  expect(engine.state.backgroundTransitionKey === 3, "real legacy-mapped switch increments the transition key", engine.state.backgroundTransitionKey);

  engine.executeCommand({ type: "background", background_id: "bg_c", background_fit: "stretch" });
  expect(engine.state.backgroundTransition === undefined, "missing transition config preserves no-explicit-animation semantics", engine.state.backgroundTransition);
  expect(engine.state.backgroundTransitionKey === 4, "switch without explicit transition still has a unique visual state key", engine.state.backgroundTransitionKey);

  engine.script = { schema_version: "1.0.0", game_id: "engine", title: "Engine", entry_scene_id: "scene", characters: [], scenes: [] };
  engine.manifest = { game_id: "engine" };
  const save = engine.createSaveSnapshot(1);
  engine.state.backgroundTransition = { kind: "slide_left", duration_ms: 800, easing: "ease-in-out" };
  engine.state.backgroundTransitionKey = 99;
  engine.restoreSaveSnapshot(save);
  expect(engine.state.background === "bg_c" && engine.state.backgroundFit === "stretch", "save restore preserves final background and fit", engine.state);
  expect(
    engine.state.backgroundTransition === undefined && engine.state.backgroundTransitionKey === 0,
    "save restore does not replay an in-flight background transition",
    engine.state,
  );
}

function killPort() {
  if (process.platform !== "win32") return;
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | % { if ($_ -gt 0) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }`,
    ], { windowsHide: true, stdio: "ignore" });
  } catch (_) {}
}

function startServer() {
  fs.mkdirSync(path.join(OUT, "logs"), { recursive: true });
  serverOutput = fs.openSync(path.join(OUT, "logs", "gamecli-vite.log"), "a");
  server = spawn(process.execPath, [VITE_ENTRY, "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: path.join(ROOT, "GameCli_framework"),
    stdio: ["ignore", serverOutput, serverOutput],
    windowsHide: true,
    shell: false,
  });
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(URL);
      if (response.ok || response.status < 500) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`GameCli dev server did not start: ${URL}`);
}

function stopServer() {
  try { server?.kill(); } catch (_) {}
  try { if (serverOutput !== undefined) fs.closeSync(serverOutput); } catch (_) {}
  killPort();
}

async function completeRenderedBackgroundTransition(page) {
  const attempts = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const frameCount = await page.locator(".background-transition-frame").count();
    if (frameCount <= 1) return attempts;
    const snapshot = await page.locator(".background-transition-frame.is-current").evaluate((element) => {
      const animationName = getComputedStyle(element).animationName;
      const animations = element.getAnimations().map((animation) => ({
        currentTime: animation.currentTime,
        playState: animation.playState,
      }));
      element.getAnimations().forEach((animation) => animation.finish());
      element.dispatchEvent(new AnimationEvent("animationend", {
        bubbles: true,
        animationName,
        elapsedTime: 1,
      }));
      const layer = element.closest(".background-layer");
      return {
        frameCount: layer?.querySelectorAll(".background-transition-frame").length ?? 0,
        phase: layer?.getAttribute("data-transition-phase"),
        generation: layer?.getAttribute("data-transition-generation"),
        current: element.getAttribute("data-background-id"),
        animationName,
        animations,
      };
    });
    attempts.push(snapshot);
    await page.waitForTimeout(100);
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const frameCount = await page.locator(".background-transition-frame").count();
    if (frameCount <= 1) return attempts;
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForTimeout(120);
  }
  return attempts;
}

async function runBrowserChecks({
  includeRuntimeTransitions = false,
  includeInterruptionChecks = false,
} = {}) {
  killPort();
  await new Promise((resolve) => setTimeout(resolve, 300));
  startServer();
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    let navigationError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await page.goto(URL, { waitUntil: "domcontentloaded" });
        navigationError = undefined;
        break;
      } catch (error) {
        navigationError = error;
        await page.waitForTimeout(350);
      }
    }
    if (navigationError) throw navigationError;
    await page.waitForSelector("#root", { timeout: 30_000 });
    await page.waitForTimeout(1_600);
    await page.evaluate(async () => {
      const [{ useRuntimeStore }, { assetResolver }] = await Promise.all([
        import("/src/store/runtimeStore.ts"),
        import("/src/engine/assetResolver.ts"),
      ]);
      const svg = (color, label) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="${color}"/><text x="72" y="640" fill="white" font-size="54">${label}</text></svg>`)}`;
      const script = {
        schema_version: "1.0.0",
        game_id: "background_transition_engine_browser",
        title: "Background Transition Engine",
        entry_scene_id: "start",
        characters: [],
        scenes: [{
          scene_id: "start",
          title: "Start",
          summary: "Engine metadata browser acceptance.",
          chapter: 1,
          tags: ["acceptance"],
          commands: [
            { type: "background", background_id: "bg_a", background_fit: "cover", transition_config: { kind: "slide_left", duration_ms: 720, easing: "ease-out" } },
            { type: "background", background_id: "bg_a", background_fit: "cover", transition_config: { kind: "slide_left", duration_ms: 720, easing: "ease-out" } },
            { type: "background", background_id: "bg_b", background_fit: "contain", transition: "wipe_rtl" },
            { type: "narration", text: "背景切换元数据已进入运行时。" },
          ],
          is_ending: true,
        }],
      };
      const manifest = {
        manifest_version: "1.0.0",
        cartridge_version: "1.0.0",
        runtime_version: "0.2.0",
        game_id: script.game_id,
        title: script.title,
        author: "AgentVN QA",
        description: "Background transition engine browser acceptance.",
        version: "1.0.0",
        language: "zh-CN",
        tags: ["acceptance"],
        entry_script: "script.json",
        entry_scene_id: "start",
        assets: [
          { asset_id: "bg_a", asset_type: "background", path: "assets/background/bg-a.svg", filename: "bg-a.svg" },
          { asset_id: "bg_b", asset_type: "background", path: "assets/background/bg-b.svg", filename: "bg-b.svg" },
          { asset_id: "bg_c", asset_type: "background", path: "assets/background/bg-c.svg", filename: "bg-c.svg" },
        ],
        created_at: "2026-07-11T00:00:00.000Z",
        updated_at: "2026-07-11T00:00:00.000Z",
      };
      const assetUrls = {
        bg_a: svg("#253d68", "FIRST BACKGROUND"),
        bg_b: svg("#58406e", "LEGACY WIPE BACKGROUND"),
        bg_c: svg("#2f655c", "FINAL RAPID BACKGROUND"),
      };
      assetResolver.configure(manifest, "", assetUrls);
      const runtime = useRuntimeStore.getState();
      const log = [];
      const unsubscribe = useRuntimeStore.subscribe((state) => {
        const current = state.engineState;
        if (!current.background) return;
        log.push({
          background: current.background,
          fit: current.backgroundFit,
          key: current.backgroundTransitionKey,
          transition: current.backgroundTransition,
          commandIndex: current.currentCommandIndex,
        });
      });
      window.__AGENTVN_BACKGROUND_STATE_LOG__ = log;
      window.__AGENTVN_BACKGROUND_UNSUBSCRIBE__ = unsubscribe;
      window.__AGENTVN_SET_BACKGROUND__ = ({ background, fit, transition, key }) => {
        const currentRuntime = useRuntimeStore.getState();
        currentRuntime.engine.state.background = background;
        currentRuntime.engine.state.backgroundFit = fit;
        currentRuntime.engine.state.backgroundTransition = transition;
        currentRuntime.engine.state.backgroundTransitionKey = key;
        currentRuntime.engine.onChange?.(currentRuntime.engine.state);
      };
      window.__AGENTVN_SET_RUNTIME_SCREEN__ = (screen) => useRuntimeStore.setState({ screen });
      runtime.engine.loadScript(script, manifest);
      useRuntimeStore.setState({
        currentGame: {
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
          assetUrls,
          imported_at: manifest.created_at,
          updated_at: manifest.updated_at,
          source_file_name: "background-transition-engine.vncart",
          cartridge_path: "",
        },
        runtimeMode: "fixed",
        screen: "title_menu",
        saves: [],
      });
      useRuntimeStore.getState().startNewGame();
    });
    await page.locator(".story-player").waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForFunction(() => {
      const layer = document.querySelector(".background-layer");
      return layer?.getAttribute("data-background-id") === "bg_b"
        && layer?.getAttribute("data-transition-key") === "2";
    }, null, { timeout: 10_000 });
    const layer = page.locator(".background-layer");
    const attrs = await layer.evaluate((element) => ({
      background: element.getAttribute("data-background-id"),
      fit: element.getAttribute("data-background-fit"),
      key: element.getAttribute("data-transition-key"),
      kind: element.getAttribute("data-transition-kind"),
      duration: element.getAttribute("data-transition-duration"),
      easing: element.getAttribute("data-transition-easing"),
    }));
    expect(
      attrs.background === "bg_b" && attrs.fit === "contain" && attrs.key === "2",
      "real GameCli renders the final background with a stable transition key",
      attrs,
      "GameCli_framework/src/components/player/BackgroundLayer.tsx",
    );
    expect(
      attrs.kind === "wipe_right_to_left" && attrs.duration === "420" && attrs.easing === "ease-in-out",
      "BackgroundLayer receives normalized legacy transition metadata",
      attrs,
      "GameCli_framework/src/components/player/BackgroundLayer.tsx",
    );
    const log = await page.evaluate(() => window.__AGENTVN_BACKGROUND_STATE_LOG__);
    const firstKeyStates = log.filter((entry) => entry.background === "bg_a");
    expect(firstKeyStates.some((entry) => entry.key === 1 && entry.transition?.kind === "slide_left"), "browser runtime observes structured metadata on the first background", firstKeyStates);
    expect(firstKeyStates.filter((entry) => entry.key === 1).length >= 2, "duplicate background command emits state without incrementing the transition key", firstKeyStates);
    expect(log.some((entry) => entry.background === "bg_b" && entry.key === 2), "real switch increments the browser-observed transition key", log);
    await page.screenshot({ path: path.join(OUT, "01-background-transition-engine-state.png"), fullPage: true });

    if (includeRuntimeTransitions) {
      let key = 2;
      let currentBackground = "bg_b";
      const switchBackground = async ({ kind, duration = 360, easing = "ease-in-out", target }) => {
        key += 1;
        currentBackground = target ?? (currentBackground === "bg_a" ? "bg_b" : "bg_a");
        const payload = {
          background: currentBackground,
          fit: currentBackground === "bg_a" ? "cover" : "contain",
          transition: { kind, duration_ms: kind === "none" ? 0 : duration, easing },
          key,
        };
        await page.evaluate((next) => window.__AGENTVN_SET_BACKGROUND__(next), payload);
        return payload;
      };

      const slide = await switchBackground({ kind: "slide_left", duration: 760, easing: "linear", target: "bg_a" });
      await page.waitForFunction(({ background, key: expectedKey }) => {
        const frames = [...document.querySelectorAll(".background-transition-frame")];
        const current = frames.find((frame) => frame.getAttribute("data-transition-role") === "current");
        const previous = frames.find((frame) => frame.getAttribute("data-transition-role") === "previous");
        return frames.length === 2
          && current?.getAttribute("data-background-id") === background
          && current?.getAttribute("data-transition-key") === String(expectedKey)
          && previous?.getAttribute("data-background-id") === "bg_b";
      }, slide, { timeout: 3_000 });
      const slideMid = await page.locator(".background-layer").evaluate((element) => {
        const current = element.querySelector('[data-transition-role="current"]');
        const previous = element.querySelector('[data-transition-role="previous"]');
        const currentStyle = current ? getComputedStyle(current) : null;
        return {
          frameCount: element.querySelectorAll(".background-transition-frame").length,
          rootClass: element.className,
          duration: element.style.getPropertyValue("--visual-transition-duration"),
          easing: element.style.getPropertyValue("--visual-transition-easing"),
          currentAnimation: currentStyle?.animationName,
          currentRole: current?.getAttribute("data-transition-role"),
          previousRole: previous?.getAttribute("data-transition-role"),
        };
      });
      expect(
        slideMid.frameCount === 2 && slideMid.currentRole === "current" && slideMid.previousRole === "previous",
        "animated background switch temporarily renders previous and current frames",
        slideMid,
        "GameCli_framework/src/components/player/BackgroundLayer.tsx",
      );
      expect(
        slideMid.duration.trim() === "760ms" && slideMid.easing.trim() === "linear",
        "duration and easing are exposed through background transition CSS variables",
        slideMid,
        "GameCli_framework/src/components/player/BackgroundLayer.tsx",
      );
      expect(
        slideMid.rootClass.includes("is-transitioning") && slideMid.currentAnimation && slideMid.currentAnimation !== "none",
        "slide transition starts a real CSS animation",
        slideMid,
        "GameCli_framework/src/styles/player.css",
      );
      await page.waitForTimeout(140);
      await page.screenshot({ path: path.join(OUT, "02-background-transition-slide-mid.png"), fullPage: true });
      const completionAttempts = await completeRenderedBackgroundTransition(page);
      const completedSlide = await page.evaluate((background) => {
        const layer = document.querySelector(".background-layer");
        const frames = [...document.querySelectorAll(".background-transition-frame")];
        return {
          ok: frames.length === 1
          && frames[0].getAttribute("data-transition-role") === "current"
          && frames[0].getAttribute("data-background-id") === background,
          phase: layer?.getAttribute("data-transition-phase"),
          generation: layer?.getAttribute("data-transition-generation"),
          frames: frames.map((frame) => ({
            role: frame.getAttribute("data-transition-role"),
            id: frame.getAttribute("data-background-id"),
          })),
        };
      }, slide.background);
      expect(completedSlide.ok, "animation completion removes the outgoing background frame", { slide: slide.background, completedSlide, completionAttempts }, "GameCli_framework/src/components/player/BackgroundLayer.tsx");

      const supportedKinds = [
        "fade",
        "crossfade",
        "reveal_center",
        "wipe_left_to_right",
        "wipe_right_to_left",
        "blur",
        "slide_right",
        "slide_up",
        "slide_down",
      ];
      const observedKinds = [];
      for (const kind of supportedKinds) {
        const active = await switchBackground({ kind, duration: 300, easing: "ease-out" });
        await page.waitForFunction(({ background, kind: expectedKind }) => {
          const layer = document.querySelector(".background-layer");
          const current = layer?.querySelector('[data-transition-role="current"]');
          return layer?.classList.contains(`transition-${expectedKind}`)
            && layer.querySelectorAll(".background-transition-frame").length === 2
            && current?.getAttribute("data-background-id") === background
            && getComputedStyle(current).animationName !== "none";
        }, { background: active.background, kind }, { timeout: 2_000 });
        observedKinds.push(kind);
        await page.waitForFunction((background) => {
          const frames = [...document.querySelectorAll(".background-transition-frame")];
          return frames.length === 1 && frames[0].getAttribute("data-background-id") === background;
        }, active.background, { timeout: 2_000 });
      }
      expect(
        observedKinds.length === supportedKinds.length,
        "all configured background transition kinds have real current-frame animations",
        observedKinds,
        "GameCli_framework/src/styles/player.css",
      );

      const noneStarted = Date.now();
      const none = await switchBackground({ kind: "none", target: currentBackground === "bg_a" ? "bg_b" : "bg_a" });
      await page.waitForFunction((background) => {
        const layer = document.querySelector(".background-layer");
        const frames = [...document.querySelectorAll(".background-transition-frame")];
        return !layer?.classList.contains("is-transitioning")
          && frames.length === 1
          && frames[0].getAttribute("data-background-id") === background;
      }, none.background, { timeout: 1_000 });
      expect(
        Date.now() - noneStarted < 500,
        "none transition replaces the background without retaining an outgoing frame",
        { elapsedMs: Date.now() - noneStarted },
        "GameCli_framework/src/components/player/BackgroundLayer.tsx",
      );

      const missing = await switchBackground({ kind: "blur", duration: 320, target: "missing_background" });
      await page.waitForFunction(() => {
        const layer = document.querySelector(".background-layer");
        return layer?.querySelectorAll(".background-transition-frame").length === 2
          && Boolean(layer.querySelector('[data-transition-role="current"].is-missing'));
      }, null, { timeout: 2_000 });
      await page.waitForFunction((background) => {
        const frames = [...document.querySelectorAll(".background-transition-frame")];
        return frames.length === 1
          && frames[0].getAttribute("data-background-id") === background
          && frames[0].classList.contains("is-missing");
      }, missing.background, { timeout: 2_000 });
      expect(
        true,
        "missing incoming background keeps its placeholder and still cleans the outgoing frame",
        missing.background,
        "GameCli_framework/src/components/player/BackgroundLayer.tsx",
      );
      await page.screenshot({ path: path.join(OUT, "03-background-transition-missing-fallback.png"), fullPage: true });
    }

    if (includeInterruptionChecks) {
      const setBackground = async ({ background, kind, duration = 700, easing = "ease-in-out", key }) => {
        const payload = {
          background,
          fit: background === "bg_b" ? "contain" : "cover",
          transition: { kind, duration_ms: duration, easing },
          key,
        };
        await page.evaluate((next) => window.__AGENTVN_SET_BACKGROUND__(next), payload);
        return payload;
      };

      await page.evaluate(() => {
        const layer = document.querySelector(".background-layer");
        const log = [];
        const record = () => {
          const root = document.querySelector(".background-layer");
          const frames = [...(root?.querySelectorAll(".background-transition-frame") ?? [])];
          log.push({
            at: performance.now(),
            frameCount: frames.length,
            phase: root?.getAttribute("data-transition-phase"),
            current: frames.find((frame) => frame.getAttribute("data-transition-role") === "current")?.getAttribute("data-background-id"),
            previous: frames.find((frame) => frame.getAttribute("data-transition-role") === "previous")?.getAttribute("data-background-id"),
          });
        };
        window.__AGENTVN_BACKGROUND_DOM_LOG__ = log;
        window.__AGENTVN_BACKGROUND_DOM_OBSERVER__ = new MutationObserver(record);
        if (layer) {
          window.__AGENTVN_BACKGROUND_DOM_OBSERVER__.observe(layer, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "data-background-id", "data-transition-phase", "data-transition-role"],
          });
        }
        record();
      });

      const rapidStartedAt = Date.now();
      await setBackground({ background: "bg_a", kind: "slide_left", key: 3 });
      await page.waitForFunction(() => document.querySelectorAll(".background-transition-frame").length === 2);
      await page.waitForTimeout(45);
      await setBackground({ background: "bg_b", kind: "blur", key: 4 });
      await page.waitForTimeout(45);
      await setBackground({ background: "bg_c", kind: "wipe_left_to_right", key: 5 });
      expect(Date.now() - rapidStartedAt < 300, "A to B to C commands are issued inside the rapid replacement window", { elapsedMs: Date.now() - rapidStartedAt });

      await page.waitForFunction(() => {
        const layer = document.querySelector(".background-layer");
        const frames = [...document.querySelectorAll(".background-transition-frame")];
        const current = frames.find((frame) => frame.getAttribute("data-transition-role") === "current");
        const previous = frames.find((frame) => frame.getAttribute("data-transition-role") === "previous");
        return layer?.getAttribute("data-transition-phase") === "active"
          && frames.length === 2
          && current?.getAttribute("data-background-id") === "bg_c"
          && previous?.getAttribute("data-background-id") === "bg_b";
      }, null, { timeout: 2_000 });
      await page.waitForTimeout(90);
      await page.screenshot({ path: path.join(OUT, "04-background-transition-interruption-mid.png"), fullPage: true });

      const rapidLog = await page.evaluate(() => window.__AGENTVN_BACKGROUND_DOM_LOG__);
      expect(
        Math.max(...rapidLog.map((entry) => entry.frameCount)) <= 2,
        "rapid replacement never exceeds one outgoing and one current frame",
        rapidLog,
        "GameCli_framework/src/components/player/BackgroundLayer.tsx",
      );
      expect(
        rapidLog.some((entry) => entry.current === "bg_c" && entry.previous === "bg_b"),
        "latest visible background becomes the outgoing frame for the final C transition",
        rapidLog,
        "GameCli_framework/src/components/player/BackgroundLayer.tsx",
      );

      const rapidCompletionAttempts = await completeRenderedBackgroundTransition(page);
      const completedRapidTransition = await page.evaluate(() => {
        const layer = document.querySelector(".background-layer");
        const frames = [...document.querySelectorAll(".background-transition-frame")];
        return {
          ok: frames.length === 1
          && frames[0].getAttribute("data-transition-role") === "current"
          && frames[0].getAttribute("data-background-id") === "bg_c",
          phase: layer?.getAttribute("data-transition-phase"),
          generation: layer?.getAttribute("data-transition-generation"),
          frames: frames.map((frame) => ({
            role: frame.getAttribute("data-transition-role"),
            id: frame.getAttribute("data-background-id"),
          })),
        };
      });
      expect(completedRapidTransition.ok, "rapid replacement settles on C with no outgoing frame", { completedRapidTransition, rapidCompletionAttempts }, "GameCli_framework/src/components/player/BackgroundLayer.tsx");
      await page.screenshot({ path: path.join(OUT, "05-background-transition-interruption-final.png"), fullPage: true });

      await page.locator('[data-transition-role="current"]').evaluate((element) => {
        element.setAttribute("data-duplicate-probe", "stable-node");
      });
      await setBackground({ background: "bg_c", kind: "wipe_left_to_right", key: 5 });
      await page.waitForTimeout(120);
      const duplicateState = await page.locator(".background-layer").evaluate((element) => ({
        frameCount: element.querySelectorAll(".background-transition-frame").length,
        phase: element.getAttribute("data-transition-phase"),
        probe: element.querySelector('[data-transition-role="current"]')?.getAttribute("data-duplicate-probe"),
      }));
      expect(
        duplicateState.frameCount === 1 && duplicateState.phase === "idle" && duplicateState.probe === "stable-node",
        "duplicate background state preserves the current DOM node without flashing",
        duplicateState,
        "GameCli_framework/src/components/player/BackgroundLayer.tsx",
      );

      await setBackground({ background: "bg_a", kind: "crossfade", duration: 620, key: 6 });
      await page.waitForFunction(() => document.querySelectorAll(".background-transition-frame").length === 2);
      await page.evaluate(() => window.__AGENTVN_SET_RUNTIME_SCREEN__("title_menu"));
      await page.waitForFunction(() => !document.querySelector(".story-player"));
      await page.waitForTimeout(850);
      await page.evaluate(() => window.__AGENTVN_SET_RUNTIME_SCREEN__("playing"));
      await page.waitForFunction(() => {
        const layer = document.querySelector(".background-layer");
        const frames = layer?.querySelectorAll(".background-transition-frame");
        return frames?.length === 1
          && layer?.getAttribute("data-transition-phase") === "idle"
          && frames[0].getAttribute("data-background-id") === "bg_a";
      }, null, { timeout: 2_000 });
      expect(
        true,
        "unmounting during a transition clears pending work and remounts with only the final frame",
        "bg_a",
        "GameCli_framework/src/components/player/BackgroundLayer.tsx",
      );

      await page.evaluate(() => {
        window.__AGENTVN_BACKGROUND_FOCUS_LOG__ = [];
        window.addEventListener("blur", () => window.__AGENTVN_BACKGROUND_FOCUS_LOG__.push("blur"));
        window.addEventListener("focus", () => window.__AGENTVN_BACKGROUND_FOCUS_LOG__.push("focus"));
        document.addEventListener("visibilitychange", () => {
          window.__AGENTVN_BACKGROUND_FOCUS_LOG__.push(`visibilitychange:${document.visibilityState}`);
        });
        const originalSetTimeout = window.setTimeout.bind(window);
        window.__AGENTVN_ORIGINAL_SET_TIMEOUT__ = originalSetTimeout;
        window.setTimeout = (callback, delay, ...args) => originalSetTimeout(
          callback,
          Number(delay) >= 560 && Number(delay) <= 640 ? Number(delay) + 5_000 : delay,
          ...args,
        );
        const style = document.createElement("style");
        style.id = "background-transition-focus-probe";
        style.textContent = ".background-layer.is-transitioning .background-transition-frame { animation: none !important; }";
        document.head.append(style);
      });
      await setBackground({ background: "bg_b", kind: "slide_right", duration: 420, key: 7 });
      await page.waitForFunction(() => document.querySelectorAll(".background-transition-frame").length === 2);
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await page.waitForTimeout(680);
      await page.evaluate(() => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
      });
      await page.waitForFunction(() => {
        const frames = [...document.querySelectorAll(".background-transition-frame")];
        return frames.length === 1 && frames[0].getAttribute("data-background-id") === "bg_b";
      }, null, { timeout: 2_000 });
      const focusLog = await page.evaluate(() => {
        window.setTimeout = window.__AGENTVN_ORIGINAL_SET_TIMEOUT__;
        document.querySelector("#background-transition-focus-probe")?.remove();
        return window.__AGENTVN_BACKGROUND_FOCUS_LOG__;
      });
      expect(
        focusLog.includes("blur")
          && focusLog.includes("visibilitychange:visible")
          && focusLog.includes("focus"),
        "browser blur, visibility restoration, and focus events are observed during cleanup",
        focusLog,
        "GameCli_framework/src/components/player/BackgroundLayer.tsx",
      );
      expect(
        true,
        "outgoing frame is eventually removed after browser focus restoration",
        "bg_b",
        "GameCli_framework/src/components/player/BackgroundLayer.tsx",
      );
      await page.evaluate(() => window.__AGENTVN_BACKGROUND_DOM_OBSERVER__?.disconnect());
    }

    expect(consoleErrors.length === 0 && pageErrors.length === 0, "GameCli browser console and page-error streams remain clean", { consoleErrors, pageErrors }, "scripts/client-experience-background-transition-runtime-playwright.cjs");
    await context.close();
  } finally {
    await browser.close();
    stopServer();
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const target of [
    REPORT,
    path.join(OUT, "01-background-transition-engine-state.png"),
    path.join(OUT, "02-background-transition-slide-mid.png"),
    path.join(OUT, "03-background-transition-missing-fallback.png"),
    path.join(OUT, "04-background-transition-interruption-mid.png"),
    path.join(OUT, "05-background-transition-interruption-final.png"),
    path.join(OUT, "background-transition-engine.cjs"),
    path.join(OUT, "logs"),
  ]) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  const report = { ok: false, startedAt: new Date().toISOString(), checks, artifacts: { outputDir: OUT } };
  try {
    runEngineChecks();
    await runBrowserChecks({
      includeRuntimeTransitions: !ENGINE_ONLY && !INTERRUPTION_ONLY,
      includeInterruptionChecks: INTERRUPTION_ONLY,
    });
    report.ok = true;
    report.finishedAt = new Date().toISOString();
    report.consoleErrors = consoleErrors;
    report.pageErrors = pageErrors;
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    const mode = ENGINE_ONLY ? "engine" : INTERRUPTION_ONLY ? "interruption" : "runtime";
    console.log(`Background transition ${mode} acceptance passed: ${checks.length} checks.`);
  } catch (error) {
    report.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    report.finishedAt = new Date().toISOString();
    report.consoleErrors = consoleErrors;
    report.pageErrors = pageErrors;
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    throw error;
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
