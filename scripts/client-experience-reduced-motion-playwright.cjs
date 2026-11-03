#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../Editor/node_modules/playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "playwright", "client-experience-enhancement", "reduced-motion");
const REPORT = path.join(OUT, "report.json");
const PORT = Number(process.env.AGENTVN_REDUCED_MOTION_PORT || 6993);
const URL = `http://127.0.0.1:${PORT}/`;
const VITE = path.join(ROOT, "GameCli_framework", "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
const checks = [];
const consoleErrors = [];
const pageErrors = [];
let server;
let serverOutput;

function expect(condition, assertion, value, file = "GameCli_framework/src/styles/player.css") {
  if (!condition) throw new Error(`${assertion}; ${JSON.stringify(value)}`);
  checks.push({ assertion, value, file });
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
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : VITE;
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", VITE, "--host", "127.0.0.1", "--port", String(PORT)]
    : ["--host", "127.0.0.1", "--port", String(PORT)];
  server = spawn(command, args, {
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
}

async function setupScenario(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root", { timeout: 30_000 });
  await page.locator(".library-shell").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(".boot-overlay").waitFor({ state: "detached", timeout: 12_000 });
  await page.evaluate(async () => {
    const [{ useRuntimeStore }, { assetResolver }] = await Promise.all([
      import("/src/store/runtimeStore.ts"),
      import("/src/engine/assetResolver.ts"),
    ]);
    const backgroundSvg = (from, to, label) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><text x="640" y="370" text-anchor="middle" fill="white" opacity=".22" font-size="96">${label}</text></svg>`)}`;
    const spriteSvg = (color, label) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="980"><rect width="520" height="980" fill="transparent"/><ellipse cx="260" cy="170" rx="112" ry="132" fill="${color}"/><path d="M92 920 Q118 330 260 310 Q402 330 428 920Z" fill="${color}"/><text x="260" y="890" text-anchor="middle" fill="white" font-size="44">${label}</text></svg>`)}`;
    const script = {
      schema_version: "1.0.0",
      game_id: "reduced_motion_acceptance",
      title: "Reduced Motion Acceptance",
      entry_scene_id: "scene",
      default_sprite_scale: 1,
      characters: [{ character_id: "hero", name: "Hero", aliases: [] }],
      scenes: [{ scene_id: "scene", title: "Scene", summary: "Acceptance", chapter: 1, tags: ["acceptance"], commands: [], is_ending: true }],
    };
    const manifest = {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.2.0",
      game_id: script.game_id,
      title: script.title,
      author: "AgentVN QA",
      description: "Reduced-motion transition acceptance.",
      version: "1.0.0",
      language: "zh-CN",
      tags: ["acceptance"],
      entry_script: "script.json",
      entry_scene_id: "scene",
      assets: [
        { asset_id: "bg_a", asset_type: "background", path: "assets/background/a.svg", filename: "a.svg" },
        { asset_id: "bg_b", asset_type: "background", path: "assets/background/b.svg", filename: "b.svg" },
        { asset_id: "sprite_a", asset_type: "sprite", path: "assets/sprites/a.svg", filename: "a.svg" },
        { asset_id: "sprite_b", asset_type: "sprite", path: "assets/sprites/b.svg", filename: "b.svg" },
      ],
      created_at: "2026-07-11T00:00:00.000Z",
      updated_at: "2026-07-11T00:00:00.000Z",
    };
    const assetUrls = {
      bg_a: backgroundSvg("#14243a", "#3a2850", "BACKGROUND A"),
      bg_b: backgroundSvg("#21473d", "#69442e", "BACKGROUND B"),
      sprite_a: spriteSvg("#6f9bd1", "SPRITE A"),
      sprite_b: spriteSvg("#bf6d88", "SPRITE B"),
    };
    assetResolver.configure(manifest, "", assetUrls);
    const runtime = useRuntimeStore.getState();
    const currentGame = {
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
      source_file_name: "reduced-motion.vncart",
      cartridge_path: "",
    };
    runtime.engine.loadScript(script, manifest);
    Object.assign(runtime.engine.state, {
      currentSceneId: "scene",
      background: "bg_a",
      backgroundFit: "cover",
      backgroundTransition: undefined,
      backgroundTransitionKey: 0,
      sprites: {
        hero: {
          character_id: "hero",
          sprite_id: "sprite_a",
          position: "center",
          scale: 1,
          visible: true,
        },
      },
      spriteOrder: ["hero"],
      currentCommandIndex: 7,
    });
    useRuntimeStore.setState({
      currentGame,
      engineState: structuredClone(runtime.engine.state),
      runtimeMode: "fixed",
      screen: "playing",
      saves: [],
    });
    window.__AGENTVN_TRIGGER_REDUCED_MOTION__ = () => {
      Object.assign(runtime.engine.state, {
        background: "bg_b",
        backgroundFit: "cover",
        backgroundTransition: { kind: "slide_left", duration_ms: 1400, easing: "ease-in-out" },
        backgroundTransitionKey: 1,
        sprites: {
          hero: {
            character_id: "hero",
            sprite_id: "sprite_b",
            position: "center",
            scale: 0.8,
            visible: true,
            replacement: {
              previous_sprite_id: "sprite_a",
              previous_position: "center",
              previous_scale: 1,
              transition: { kind: "slide_up", duration_ms: 1400, easing: "ease-in-out" },
              key: 1,
            },
          },
        },
        spriteOrder: ["hero"],
      });
      useRuntimeStore.setState({ engineState: structuredClone(runtime.engine.state) });
    };
    window.__AGENTVN_CAPTURE_TRANSITION_STATE__ = () => {
      const backgroundLayer = document.querySelector(".background-layer");
      const backgroundCurrent = backgroundLayer?.querySelector('.background-transition-frame[data-transition-role="current"]');
      const spriteSlot = document.querySelector('.sprite-slot[data-character-id="hero"]');
      const spriteStack = spriteSlot?.querySelector(".sprite-replacement-stack");
      const spriteCurrent = spriteSlot?.querySelector('.sprite-replacement-frame[data-sprite-role="current"]');
      const backgroundStyle = backgroundCurrent ? getComputedStyle(backgroundCurrent) : undefined;
      const spriteStyle = spriteCurrent ? getComputedStyle(spriteCurrent) : undefined;
      return {
        background: {
          frameCount: backgroundLayer?.querySelectorAll(".background-transition-frame").length ?? 0,
          transitionKind: backgroundLayer?.getAttribute("data-transition-kind"),
          configuredDuration: backgroundLayer?.getAttribute("data-transition-duration"),
          durationVariable: backgroundLayer?.style.getPropertyValue("--visual-transition-duration"),
          animationName: backgroundStyle?.animationName,
          animationDuration: backgroundStyle?.animationDuration,
          animationTiming: backgroundStyle?.animationTimingFunction,
          transform: backgroundStyle?.transform,
        },
        sprite: {
          frameCount: spriteSlot?.querySelectorAll(".sprite-replacement-frame").length ?? 0,
          transitionKind: spriteSlot?.getAttribute("data-sprite-transition-kind"),
          durationVariable: spriteStack?.style.getPropertyValue("--sprite-switch-duration"),
          animationName: spriteStyle?.animationName,
          animationDuration: spriteStyle?.animationDuration,
          animationTiming: spriteStyle?.animationTimingFunction,
          transform: spriteStyle?.transform,
        },
        commandIndex: useRuntimeStore.getState().engineState.currentCommandIndex,
      };
    };
  });
  try {
    await page.locator(".story-player").waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(async () => {
      const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
      const state = useRuntimeStore.getState();
      return {
        screen: state.screen,
        hasGame: Boolean(state.currentGame),
        engineState: {
          currentSceneId: state.engineState.currentSceneId,
          currentCommandIndex: state.engineState.currentCommandIndex,
          background: state.engineState.background,
          spriteIds: Object.values(state.engineState.sprites).map((sprite) => sprite.sprite_id),
          isEnded: state.engineState.isEnded,
        },
        mainClass: document.querySelector("main")?.className ?? null,
        bodyText: document.body.innerText.slice(0, 500),
      };
    });
    throw new Error(`story player setup failed: ${JSON.stringify(diagnostic)}\n${error.stack || error.message}`);
  }
  await page.locator('.background-layer[data-background-id="bg_a"]').waitFor({ state: "attached", timeout: 10_000 });
  await page.locator('.sprite-slot[data-character-id="hero"][data-sprite-id="sprite_a"]').waitFor({ state: "attached", timeout: 10_000 });
  await page.locator(".boot-overlay").waitFor({ state: "detached", timeout: 8_000 });
  await page.locator(".game-entry-transition").waitFor({ state: "detached", timeout: 3_000 });
  await page.waitForFunction(() => document.querySelector('.sprite-slot[data-character-id="hero"]')?.getAttribute("data-sprite-phase") === "present");
}

async function runMode(browser, reducedMotion, screenshotName) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(`${reducedMotion}: ${error.stack || error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${reducedMotion}: ${message.text()}`);
  });
  try {
    await setupScenario(page);
    await page.evaluate(() => {
      window.__AGENTVN_TRIGGER_REDUCED_MOTION__();
    });
    await page.waitForFunction(() => {
      const backgroundFrames = document.querySelectorAll(".background-transition-frame");
      const spriteFrames = document.querySelectorAll('.sprite-slot[data-character-id="hero"] .sprite-replacement-frame');
      if (backgroundFrames.length !== 2 || spriteFrames.length !== 2) return false;
      window.__AGENTVN_FIRST_TRANSITION_STATE__ = window.__AGENTVN_CAPTURE_TRANSITION_STATE__();
      return true;
    });
    const first = await page.evaluate(() => window.__AGENTVN_FIRST_TRANSITION_STATE__);
    await page.waitForTimeout(reducedMotion === "reduce" ? 300 : 260);
    await page.screenshot({ path: path.join(OUT, screenshotName), fullPage: true });
    const afterShortWait = await page.evaluate(() => window.__AGENTVN_CAPTURE_TRANSITION_STATE__());
    if (reducedMotion === "no-preference") {
      await page.waitForFunction(() => {
        const backgroundFrames = [...document.querySelectorAll(".background-transition-frame")];
        const spriteFrames = [...document.querySelectorAll('.sprite-slot[data-character-id="hero"] .sprite-replacement-frame')];
        return backgroundFrames.length === 1
          && backgroundFrames[0].getAttribute("data-background-id") === "bg_b"
          && spriteFrames.length === 1
          && spriteFrames[0].getAttribute("data-sprite-id") === "sprite_b";
      }, null, { timeout: 3_000 });
    }
    const final = await page.evaluate(() => window.__AGENTVN_CAPTURE_TRANSITION_STATE__());
    return { first, afterShortWait, final };
  } finally {
    await context.close();
  }
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const report = { ok: false, startedAt: new Date().toISOString(), checks, artifacts: { outputDir: OUT } };
  killPort();
  startServer();
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const normal = await runMode(browser, "no-preference", "01-normal-motion-slide.png");
    expect(
      normal.first.background.frameCount === 2
        && normal.first.background.animationName.includes("slide")
        && normal.first.background.animationDuration === "1.4s",
      "normal motion background keeps configured slide animation and duration",
      normal.first.background,
    );
    expect(
      normal.first.sprite.frameCount === 2
        && normal.first.sprite.animationName.includes("slide")
        && normal.first.sprite.animationDuration === "1.4s",
      "normal motion sprite keeps configured slide animation and duration",
      normal.first.sprite,
    );
    expect(
      normal.afterShortWait.background.frameCount === 2 && normal.afterShortWait.sprite.frameCount === 2,
      "normal motion retains outgoing frames while the configured 1400ms animation is active",
      normal.afterShortWait,
    );
    expect(
      normal.final.background.frameCount === 1 && normal.final.sprite.frameCount === 1,
      "normal motion eventually settles on the new background and sprite",
      normal.final,
    );

    const reduced = await runMode(browser, "reduce", "02-reduced-motion-short-fade.png");
    expect(
      reduced.first.background.frameCount === 2
        && reduced.first.background.animationName.includes("fade")
        && !reduced.first.background.animationName.includes("slide")
        && ["0.09s", "90ms"].includes(reduced.first.background.animationDuration)
        && reduced.first.background.transform === "none",
      "reduced motion converts background slide into a 90ms transform-free fade",
      reduced.first.background,
    );
    expect(
      reduced.first.sprite.frameCount === 2
        && reduced.first.sprite.animationName.includes("fade")
        && !reduced.first.sprite.animationName.includes("slide")
        && ["0.09s", "90ms"].includes(reduced.first.sprite.animationDuration)
        && reduced.first.sprite.transform === "none",
      "reduced motion converts sprite slide into a 90ms transform-free fade",
      reduced.first.sprite,
    );
    expect(
      reduced.first.background.configuredDuration === "1400"
        && reduced.first.background.durationVariable.trim() === "1400ms"
        && reduced.first.sprite.durationVariable.trim() === "1400ms",
      "reduced motion leaves the original transition configuration unchanged",
      reduced.first,
    );
    expect(
      reduced.afterShortWait.background.frameCount === 1
        && reduced.afterShortWait.sprite.frameCount === 1
        && reduced.afterShortWait.commandIndex === 7,
      "reduced motion cleans outgoing layers quickly without advancing or blocking script state",
      reduced.afterShortWait,
    );
    expect(
      reduced.final.background.frameCount === 1 && reduced.final.sprite.frameCount === 1,
      "reduced motion final visual state contains only the new background and sprite",
      reduced.final,
    );
    expect(
      consoleErrors.length === 0 && pageErrors.length === 0,
      "reduced-motion browser console and page-error streams remain clean",
      { consoleErrors, pageErrors },
      "scripts/client-experience-reduced-motion-playwright.cjs",
    );
    report.ok = true;
    report.normal = normal;
    report.reduced = reduced;
  } catch (error) {
    report.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    throw error;
  } finally {
    await browser.close();
    stopServer();
    report.finishedAt = new Date().toISOString();
    report.consoleErrors = consoleErrors;
    report.pageErrors = pageErrors;
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  }
  console.log(`Reduced-motion acceptance passed: ${checks.length} checks.`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
