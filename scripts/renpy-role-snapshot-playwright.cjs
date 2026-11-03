"use strict";
// Test state retention on real Runtime buttons and the actual page handoff.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/playwright/renpy-role-snapshot",
  new Date().toISOString().replace(/[:.]/g, "-"));
const fast = process.argv.includes("--fast");
const loaded = { exports: {} };
new Function("module", "exports", buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(loaded, loaded.exports);
const report = { status: "RUNNING", scope: "Runtime button states in presentation snapshots", cases: [] };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
function fixture(id) {
  const uiSkin = loaded.exports.createRenpyUILayout();
  uiSkin.renpy ??= {};
  uiSkin.renpy.shared = { buttonRoles: Object.fromEntries([
    "title_action", "page_navigation", "category_pagination",
  ].map(role => [role, { states: {
    normal: { opacity: .37, textColor: "#526479" },
    hover: { opacity: .74, textColor: "#21ca81" },
    selected: { opacity: .58, textColor: "#994477" },
    disabled: { opacity: .22 },
  } }])) };
  return { uiSkin,
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.14.0",
      game_id: id, title: "快照状态隔离验收", author: "QA", version: "1.0.0", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "main", assets: [] },
    script: { schema_version: "1.1.0", game_id: id, title: "快照状态",
      entry_scene_id: "main", characters: [], scenes: [
        { scene_id: "main", title: "隔离剧情", chapter: 1, tags: [],
          commands: [{ type: "narration", text: "仅测试页面快照，不生成剧情。" }] },
      ] },
  };
}
async function idle(page) {
  await page.waitForFunction(() => document.querySelector("[data-runtime-transition-phase]")
    ?.dataset.runtimeTransitionPhase === "idle");
}
async function settle(button) {
  await button.evaluate(async node => {
    await Promise.all(node.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function helperState(button) {
  return button.evaluate(async node => {
    const { captureRuntimePage } = await import("/src/app/runtimePageCrossfade.ts");
    const surface = node.closest(".runtime-screen-transition-current");
    const originals = [...surface.querySelectorAll("button")];
    const index = originals.indexOf(node);
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    const before = { opacity: Number(style.opacity), color: style.color,
      background: style.backgroundColor, width: rect.width, height: rect.height,
      hovered: node.matches(":hover"), selected: node.getAttribute("aria-current"),
      running: node.getAnimations().some(animation => animation.playState === "running") };
    const copy = captureRuntimePage(surface);
    surface.parentElement.append(copy);
    try {
      const target = copy.querySelectorAll("button")[index];
      const copiedStyle = getComputedStyle(target), copiedRect = target.getBoundingClientRect();
      return { before, after: { opacity: Number(copiedStyle.opacity), color: copiedStyle.color,
        background: copiedStyle.backgroundColor, width: copiedRect.width, height: copiedRect.height },
      inert: copy.inert, hidden: copy.getAttribute("aria-hidden"),
      hasOwners: !!copy.querySelector("[data-testid],.runtime-screen-transition-current"),
      hasFocus: copy.contains(document.activeElement) };
    } finally { copy.remove(); }
  });
}
async function navigationState(page, button, target, probes) {
  await button.hover(); await settle(button);
  await page.evaluate(probes => {
    const owner = document.querySelector("[data-runtime-transition-phase]");
    const pick = (container, text) => [...container.querySelectorAll("button")]
      .find(node => node.textContent.trim() === text);
    window.__snapshotState = { frames: [], before: probes.map(text => {
      const node = pick(owner.querySelector(".runtime-screen-transition-current"), text);
      if (!node) throw new Error(`Actual outgoing page has no button "${text}"`);
      return { text, opacity: Number(getComputedStyle(node).opacity), color: getComputedStyle(node).color };
    }), running: true };
    const sample = () => {
      // This flow crosses the full title/menu boundary. A category fade can
      // still have its own nested snapshot; it is not the page navigator's
      // outgoing presentation and must not be measured with the page clock.
      const snapshot = owner.querySelector(":scope > [data-runtime-transition-snapshot]");
      if (snapshot) window.__snapshotState.frames.push({
        at: performance.now(), opacity: Number(getComputedStyle(snapshot).opacity),
        phase: owner.dataset.runtimeTransitionPhase,
        black: Number(getComputedStyle(owner, "::before").opacity),
        duration: Number(owner.dataset.runtimeTransitionDuration),
        inert: snapshot.inert, focus: snapshot.contains(document.activeElement),
        probes: probes.map(text => {
          const node = pick(snapshot, text), style = node && getComputedStyle(node);
          return { text, opacity: style ? Number(style.opacity) : null, color: style?.color };
        }),
      });
      if (window.__snapshotState.running) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, probes);
  await button.click();
  await page.waitForFunction(target => document.querySelector("[data-runtime-presented-screen]")
    ?.dataset.runtimePresentedScreen === target, target);
  await idle(page);
  return page.evaluate(() => {
    window.__snapshotState.running = false;
    return window.__snapshotState;
  });
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  let server, browser;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), port: 0,
      logFile: path.join(output, "server.log") });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch({ headless: true });
    for (const [width, height] of fast ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of fast ? [1] : [1, 2]) for (const reduced of fast ? [false] : [false, true]) {
        const entry = { width, height, dpr, reduced, status: "RUNNING", states: [], navigations: [], failures: [] };
        report.cases.push(entry); save();
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
          reducedMotion: reduced ? "reduce" : "no-preference" });
        const page = await context.newPage(), errors = [];
        page.on("pageerror", error => errors.push(String(error)));
        const check = (condition, message) => { if (!condition) entry.failures.push(message); };
        async function snapshot(button, label, expected) {
          await settle(button);
          const value = await helperState(button);
          entry.states.push({ label, value });
          check(Math.abs(value.before.opacity - expected) < .01, `${label}: source state not reached`);
          check(!value.before.running, `${label}: must test settled states, not animation freeze`);
          check(Math.abs(value.before.opacity - value.after.opacity) < .01,
            `${label}: snapshot opacity ${value.after.opacity}, source ${value.before.opacity}`);
          check(value.before.color === value.after.color, `${label}: snapshot changed state color`);
          check(value.before.background === value.after.background, `${label}: snapshot changed background`);
          check(Math.abs(value.before.width - value.after.width) < 1
            && Math.abs(value.before.height - value.after.height) < 1, `${label}: snapshot geometry changed`);
          check(value.inert && value.hidden === "true" && !value.hasOwners && !value.hasFocus,
            `${label}: snapshot acquired interaction ownership`);
        }
        async function navigation(button, target, probes, label) {
          const value = await navigationState(page, button, target, probes);
          entry.navigations.push({ label, value });
          check(value.frames.length > 2, `${label}: no real crossfade frames`);
          check(value.frames.some(frame => frame.opacity > .1 && frame.opacity < .9), `${label}: missing fade intermediate`);
          for (const frame of value.frames) {
            check(frame.black < .01 && frame.inert && !frame.focus, `${label}: black or interactive snapshot`);
            check(frame.duration === (reduced ? 816 : 1632), `${label}: wrong fade duration`);
            for (const source of value.before) {
              const copied = frame.probes.find(probe => probe.text === source.text);
              check(copied && Math.abs(copied.opacity - source.opacity) < .01
                && copied.color === source.color, `${label}/${source.text}: state changed at handoff`);
            }
          }
        }
        try {
          await server.assertAlive();
          await page.goto(`${server.url}/?mode=preview`);
          await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
          await page.evaluate(data => window.postMessage({ type: "agentvn.live-preview.init",
            protocolVersion: 2, sessionId: data.manifest.game_id, revision: 1,
            requestId: "snapshot", runId: "snapshot", screen: "title_menu", ...data }, "*"),
          fixture(`snapshot-${width}-${dpr}-${reduced}`));
          await page.getByTestId("open-settings").waitFor(); await idle(page);
          const settings = page.getByTestId("open-settings");
          await settings.hover(); await snapshot(settings, "title/settled-hover", .74);
          await navigation(settings, "settings", [(await settings.textContent()).trim()], "title-to-settings");
          const text = page.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true });
          await text.hover(); await snapshot(text, "category/settled-hover", .74);
          await text.click(); await page.mouse.move(1, 1); await page.evaluate(() => document.activeElement?.blur?.());
          await snapshot(text, "category/settled-selected", .58);
          await snapshot(page.getByTestId("renpy-menu-settings"), "navigation/settled-selected", .58);
          const back = page.getByTestId("renpy-menu-return");
          await navigation(back, "title_menu",
            [(await page.getByTestId("renpy-menu-settings").textContent()).trim()], "menu-to-title");
          check(errors.length === 0, `Runtime errors: ${errors.join(";")}`);
          check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "horizontal overflow");
          await page.screenshot({ path: path.join(output, `${width}-${dpr}-${reduced}.png`) });
          entry.status = entry.failures.length ? "FAILED" : "PASS";
        } catch (error) { entry.status = "FAILED"; entry.error = String(error.stack || error); }
        finally { await context.close(); save(); console.log(`${entry.status} ${width} DPR${dpr} reduce=${reduced}`); }
      }
    assert.equal(report.cases.length, fast ? 1 : 12);
    assert(report.cases.every(entry => entry.status === "PASS"), "Snapshot state regressions failed");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    await browser?.close(); await server?.stop(); report.finishedAt = new Date().toISOString(); save();
    console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
