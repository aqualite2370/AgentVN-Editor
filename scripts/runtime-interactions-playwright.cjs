"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto"), { gzipSync } = require("node:zlib");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, "..");
const out = process.env.AGENTVN_RUNTIME_INTERACTIONS_OUTPUT;
assert(out && !fs.existsSync(out), "Explicit fresh runtime evidence directory required");
fs.mkdirSync(out, { recursive: true });
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const mod = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts",
    contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(mod, mod.exports);
const report = { status: "RUNNING", at: new Date().toISOString(), layer: "GameCLI Runtime",
  scope: "Source Chromium; controlled tiny-story init via public live-preview protocol; not installed export",
  modelRequests: 0, cases: [], sourceHashes: [
    "GameCli_framework/src/components/common/Modal.tsx", "GameCli_framework/src/app/App.tsx",
    "GameCli_framework/src/styles/quick-menu-contract.css", "GameCli_framework/src/store/runtimeStore.ts",
    "GameCli_framework/src/utils/runtimeModalPresentation.ts", "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
    "GameCli_framework/src/utils/runtimeSystemBack.ts",
  ].map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) })) };
let server, browser;
function fixture(layout) {
  const now = new Date().toISOString(), id = `qa-runtime-interactions-${layout}`;
  return {
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.8.0",
      game_id: id, title: "菜单交接隔离小剧情", author: "QA", version: "0.1.0", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "main", assets: [], created_at: now, updated_at: now },
    script: { schema_version: "1.5.0", game_id: id, title: "菜单交接隔离小剧情",
      entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "本句用于菜单交接验收，不需要生成或用户工程。" },
          { type: "narration", text: "第二句用于核对返回不推进剧情。" }] }] },
    uiSkin: layout === "renpy" ? mod.exports.createRenpyUILayout() : undefined, assetUrls: {},
  };
}
async function ready(page, screen) {
  await page.waitForFunction(screen => {
    const r = document.querySelector("[data-runtime-screen-transition]");
    return r?.getAttribute("data-runtime-presented-screen") === screen
      && r.getAttribute("data-runtime-transition-phase") === "idle"
      && !document.querySelector(".game-launch-blackout");
  }, screen, { timeout: 30000 });
}
async function capture(page, name, action) {
  await page.evaluate(() => {
    const c = { frames: [], inputs: [], boundaries: [], done: false };
    const visual = n => {
      if (!n) return null;
      const s = getComputedStyle(n), r = n.getBoundingClientRect();
      return { opacity: +s.opacity, transform: s.transform, visibility: s.visibility, pointer: s.pointerEvents,
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        inert: n.inert, hidden: n.getAttribute("aria-hidden"),
        animations: n.getAnimations().map(a => ({ state: a.playState, time: a.currentTime,
          duration: a.effect?.getTiming().duration, name: a.animationName || a.transitionProperty || "WAAPI" })) };
    };
    const input = e => c.inputs.push({ at: performance.now(), type: e.type, key: e.key, trusted: e.isTrusted });
    document.addEventListener("click", input, true); document.addEventListener("keydown", input, true);
    window.addEventListener("agentvn:system-back", input, true);
    c.stop = () => { c.done = true; document.removeEventListener("click", input, true);
      document.removeEventListener("keydown", input, true);
      window.removeEventListener("agentvn:system-back", input, true); };
    const frame = at => {
      if (c.done) return;
      const root = document.querySelector("[data-runtime-screen-transition]");
      const modal = document.querySelector("[data-runtime-modal='true']");
      const ghost = document.querySelector("[data-runtime-modal-exit]");
      const focus = document.activeElement;
      c.frames.push({ at, width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, hidden: document.hidden,
        screen: root?.getAttribute("data-runtime-presented-screen"),
        phase: root?.getAttribute("data-runtime-transition-phase"),
        black: root ? +getComputedStyle(root, "::before").opacity : 0,
        modal: visual(modal), backdrop: visual(modal?.parentElement),
        modalCount: document.querySelectorAll("[data-runtime-modal='true']").length,
        modalFocus: Boolean(modal?.contains(focus)), ghost: visual(ghost),
        ghostHasFunctionalModal: Boolean(ghost?.querySelector("[data-runtime-modal='true'],[role='dialog']")),
        unavailableFocus: focus !== document.body && Boolean(focus?.closest("[inert],[hidden],[aria-hidden='true']")),
        quick: visual(document.querySelector(".quick-menu-surface")),
        dialogText: document.querySelector(".dialog-text")?.textContent,
        scene: document.querySelector(".story-player")?.getAttribute("data-current-scene-id"),
        command: document.querySelector(".story-player")?.getAttribute("data-current-command-index"),
        buttons: [...document.querySelectorAll(".quick-menu-action-layer>.quick-menu-button")].map(visual),
        playerCount: document.querySelectorAll(".story-player").length,
        overflow: document.documentElement.scrollWidth - innerWidth });
      if (c.frames.length < 4096) requestAnimationFrame(frame); else { c.limitReached = true; c.stop(); }
    };
    window.__qaInteractions = c; requestAnimationFrame(frame);
  });
  let actionError;
  try { await action(); } catch (e) { actionError = String(e.stack || e); }
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const trace = await page.evaluate(() => {
    const c = window.__qaInteractions; c.stop();
    return { frames: c.frames, inputs: c.inputs, boundaries: c.boundaries, limitReached: !!c.limitReached };
  });
  const bytes = gzipSync(Buffer.from(JSON.stringify(trace))), file = path.join(out, `${name}.json.gz`);
  fs.writeFileSync(file, bytes, { flag: "wx" });
  return { trace, actionError, evidence: { path: file, sha256: sha(bytes), frames: trace.frames.length } };
}
function check(row, name, ok, detail) { row.checks.push({ name, status: ok ? "PASS" : "FAILED", detail }); }
async function episode(page, item, label, action, verify) {
  const row = { name: label, status: "RUNNING", checks: [] };
  item.episodes.push(row);
  const result = await capture(page, `${item.key}-${label}`, action);
  row.trace = result.evidence;
  if (result.actionError) row.actionError = result.actionError;
  const t = result.trace;
  check(row, "Complete actual trusted-input frame sequence", !result.actionError && t.frames.length >= 3
    && !t.limitReached && t.inputs.some(i => i.trusted)
    && t.frames.every(f => !f.hidden && f.width === item.width && f.height === item.height
      && f.dpr === item.dpr && f.reduced === item.reduced), result.actionError);
  check(row, "No overflow, unavailable focus, duplicate functional modal/player",
    t.frames.every(f => f.overflow <= 1 && !f.unavailableFocus && f.modalCount <= 1 && f.playerCount <= 1));
  verify(row, t);
  row.status = row.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    logFile: path.join(out, "vite.log") });
  report.service = { pid: server.pid, runId: server.runId, url: server.url };
  report.headed = process.env.AGENTVN_RUNTIME_INTERACTIONS_HEADED === "1";
  browser = await chromium.launch({ headless: !report.headed });
  const browserCDP = await browser.newBrowserCDPSession();
  const gpu = await browserCDP.send("SystemInfo.getInfo");
  report.renderer = { browser: browser.version(), devices: gpu.gpu.devices,
    auxiliary: gpu.gpu.auxAttributes, featureStatus: gpu.gpu.featureStatus };
  await browserCDP.detach();
  const smoke = process.env.AGENTVN_RUNTIME_INTERACTIONS_SMOKE === "1";
  const onlyCase = process.env.AGENTVN_RUNTIME_INTERACTIONS_CASE;
  report.caseFilter = onlyCase || null;
  for (const layout of ["agentvn", "renpy"])
    for (const [width, height] of smoke ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of smoke ? [1] : [1, 2]) for (const reduced of [false, true]) {
        const item = { layout, width, height, dpr, reduced, key: `${layout}-${width}-${dpr}-${reduced}`,
          status: "RUNNING", episodes: [], errors: [] };
        if (onlyCase && item.key !== onlyCase) continue;
        report.cases.push(item);
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
          reducedMotion: reduced ? "reduce" : "no-preference" });
        const page = await context.newPage(); page.setDefaultTimeout(20000);
        page.on("pageerror", e => item.errors.push(String(e)));
        try {
          await server.run(async () => {
            await page.goto(`${server.url}/?mode=preview`, { waitUntil: "domcontentloaded" });
            await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
            const payload = fixture(layout);
            await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init",
              protocolVersion: 2, sessionId: `runtime-interactions-${Date.now()}`, revision: 1,
              requestId: "init", runId: "tiny-story", screen: "title_menu", ...payload }, "*"), payload);
            await ready(page, "title_menu");
            await page.getByTestId("open-settings").click(); await ready(page, "settings");
            await episode(page, item, "modal-open-close", async () => {
              await page.getByTestId("open-exit-confirmation").click();
              await page.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor();
              await page.evaluate(async () => {
                const p = document.querySelector("[data-runtime-modal='true']");
                await Promise.all(p.parentElement.getAnimations({ subtree: true }).filter(a =>
                  a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
              });
              await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
              await page.keyboard.press("Escape");
              await page.waitForFunction(() => !document.querySelector("[data-runtime-modal='true'],[data-runtime-modal-exit]"));
              await ready(page, "settings");
            }, (row, t) => {
              const m = t.frames.filter(f => f.modal);
              check(row, "Modal is focused and inside viewport", m.length >= 1 && m.every(f => f.modalFocus
                && f.modal.rect.left >= 0 && f.modal.rect.top >= 0
                && f.modal.rect.right <= width && f.modal.rect.bottom <= height), { sampledFrames: m.length });
              check(row, "Opening has continuous real opacity", m.filter(f =>
                (f.modal.opacity > .01 && f.modal.opacity < .99)
                  || (f.backdrop?.opacity > .01 && f.backdrop.opacity < .99)).length >= 2);
              const g = t.frames.filter(f => f.ghost);
              check(row, "Close has visible inert presentation-only handoff", g.filter(f =>
                f.ghost.opacity > .01 && f.ghost.opacity < .99).length >= 2
                  && g.every(f => f.ghost.inert && f.ghost.hidden === "true"
                    && f.ghost.pointer === "none" && !f.ghostHasFunctionalModal));
              check(row, "Cancel preserves settings and removes presentation", t.frames.at(-1).screen === "settings"
                && !t.frames.at(-1).ghost && !t.frames.at(-1).modal);
            });
            await episode(page, item, "modal-reopen-during-exit", async () => {
              await page.getByTestId("open-exit-confirmation").click();
              await page.waitForFunction(() => {
                const n = document.querySelector("[data-runtime-modal='true']")?.parentElement;
                return n && !n.getAnimations({ subtree: true }).some(a => a.playState === "running");
              });
              await page.keyboard.press("Escape");
              await page.waitForFunction(() => {
                const n = document.querySelector("[data-runtime-modal-exit]");
                // A missed transient is a failure immediately after it ends,
                // not twenty seconds of polling for a state that cannot recur.
                return !n || (+getComputedStyle(n).opacity > .05 && +getComputedStyle(n).opacity < .95);
              });
              assert(await page.locator("[data-runtime-modal-exit]").count(),
                "Visible close interval was missed before reopen input");
              await page.getByTestId("open-exit-confirmation").click();
              await page.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor();
              await page.waitForFunction(() => {
                const n = document.querySelector("[data-runtime-modal='true']")?.parentElement;
                return n && !n.getAnimations({ subtree: true }).some(a => a.playState === "running");
              });
              await page.keyboard.press("Escape");
              await page.waitForFunction(() => !document.querySelector("[data-runtime-modal='true'],[data-runtime-modal-exit]"));
            }, (row, t) => {
              check(row, "Reopen uses real controls during visible close, never stacks functional owners",
                t.frames.some(f => f.ghost?.opacity > .05 && f.ghost.opacity < .95)
                  && t.frames.every(f => f.modalCount <= 1 && !(f.modal && f.ghost)));
              check(row, "Reopen/cancel preserves focus ownership and clears snapshots",
                t.frames.filter(f => f.modal).every(f => f.modalFocus)
                  && t.frames.at(-1).screen === "settings" && !t.frames.at(-1).ghost);
            });
            // Real back then real start, never set the runtime store directly.
            await page.getByTestId(layout === "renpy" ? "renpy-menu-return" : "settings-finish").click();
            await ready(page, "title_menu");
            await page.getByTestId("start-new-game").click(); await ready(page, "playing");
            if (layout === "agentvn") await episode(page, item, "quick-open-close", async () => {
              const toggle = page.getByTestId("quick-menu-toggle");
              await toggle.click();
              await page.evaluate(async () => Promise.all(document.querySelector(".playback-controls")
                .getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity)
                .map(a => a.finished.catch(() => {}))));
              await toggle.click();
              await page.evaluate(async () => Promise.all(document.querySelector(".playback-controls")
                .getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity)
                .map(a => a.finished.catch(() => {}))));
            }, (row, t) => {
              check(row, "Menu retains continuous presentation in its own motion mode",
                reduced ? t.frames.filter(f => f.buttons.some(b => b.opacity > .01 && b.opacity < .99)).length >= 2
                  : t.frames.filter(f => f.quick?.animations.some(a => a.name === "clip-path" && a.state === "running")).length >= 2);
              check(row, "Menu never changes story or adds black curtain",
                t.frames.every(f => f.screen === "playing" && f.black < .01 && f.playerCount === 1));
            });
            await episode(page, item, "second-escape-during-cover", async () => {
              await page.keyboard.press("Escape");
              await page.waitForFunction(() => document.querySelector("[data-runtime-transition-phase='covering']"));
              await page.keyboard.press("Escape");
              await page.waitForFunction(() => document.querySelector("[data-runtime-transition-phase='idle']")
                && !document.querySelector(".game-launch-blackout"), undefined, { timeout: 30000 });
            }, (row, t) => {
              check(row, "Two trusted Escapes include actual covering interval", t.inputs.filter(i =>
                i.type === "keydown" && i.key === "Escape" && i.trusted).length === 2
                  && t.frames.some(f => f.phase === "covering"));
              check(row, "Latest back returns to unchanged gameplay", t.frames.at(-1).screen === "playing"
                && t.frames.at(-1).playerCount === 1 && t.frames.at(-1).phase === "idle"
                && t.frames.at(-1).scene === t.frames[0].scene && t.frames.at(-1).command === t.frames[0].command);
            });
            await episode(page, item, "system-back-during-cover", async () => {
              await page.keyboard.press("Escape");
              await page.waitForFunction(() => document.querySelector("[data-runtime-transition-phase='covering']"));
              // Public host event boundary, explicitly controlled: this is not
              // Android hardware-back/device acceptance.
              await page.evaluate(() => {
                const event = new Event("agentvn:system-back", { cancelable: true });
                window.dispatchEvent(event);
                window.__qaInteractions.boundaries.push({ type: "controlled-system-back",
                  at: performance.now(), handled: event.defaultPrevented, trusted: event.isTrusted });
              });
              await ready(page, "playing");
            }, (row, t) => {
              check(row, "Controlled system-back boundary reverses pending menu",
                t.boundaries.some(i => i.type === "controlled-system-back" && i.handled && !i.trusted)
                  && t.frames.some(f => f.phase === "covering")
                  && t.frames.at(-1).screen === "playing" && t.frames.at(-1).phase === "idle"
                  && t.frames.at(-1).scene === t.frames[0].scene && t.frames.at(-1).command === t.frames[0].command);
            });
          });
          const pngPath = path.join(out, `${item.key}.png`);
          const readViewport = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight,
            dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
          const beforePNG = await readViewport();
          const png = await page.screenshot({ path: pngPath });
          const afterPNG = await readViewport();
          assert.deepEqual(beforePNG, { width, height, dpr, reduced });
          assert.deepEqual(afterPNG, beforePNG);
          assert.equal(png.readUInt32BE(16), width * dpr); assert.equal(png.readUInt32BE(20), height * dpr);
          item.screenshot = { path: pngPath, sha256: sha(png), pixels: [width * dpr, height * dpr],
            before: beforePNG, after: afterPNG };
          item.status = item.errors.length === 0 && item.episodes.length === (layout === "agentvn" ? 5 : 4)
            && item.episodes.every(e => e.status === "PASS") ? "PASS" : "FAILED";
        } catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); }
        finally { await page.evaluate(() => window.__qaInteractions?.stop?.()).catch(() => {}); await context.close(); }
        console.log(JSON.stringify({ key: item.key, status: item.status,
          failed: item.episodes.flatMap(e => e.checks.filter(c => c.status !== "PASS").map(c => `${e.name}:${c.name}`)),
          error: item.error?.split("\n")[0] }));
        fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
      }
  assert.equal(report.cases.length, onlyCase ? 1 : smoke ? 4 : 24);
  report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(e => { report.status = "TOOL_FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); await server?.stop();
  let responding = false;
  if (server) { try { responding = (await fetch(server.url, { signal: AbortSignal.timeout(1500) })).ok; } catch {} }
  report.cleanup = { ownedServerResponding: responding, status: responding ? "FAILED" : "PASS" };
  if (responding) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out }));
});
