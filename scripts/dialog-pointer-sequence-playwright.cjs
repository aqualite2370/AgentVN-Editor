"use strict";
// Controlled scripts/preferences through the public preview protocol. No model calls,
// store injection, Android or installed-player claims.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, "..");
const attempt = process.argv[2];
assert.match(attempt || "", /^\d{2}$/);
const smoke = process.argv.includes("--smoke");
const resume = process.argv.find(arg => arg.startsWith("--resume="))?.slice(9);
if (resume) assert.match(resume, /^\d{2}$/);
const out = `F:/AgentVN/QA/Dialog-Pointer-Sequence-20261103-01/browser-${attempt}`;
assert(!fs.existsSync(out), "Historical evidence must remain unchanged");
fs.mkdirSync(out);
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const desc = file => ({ path: file, sha256: sha(fs.readFileSync(file)) });
const report = { status: "RUNNING", scope: "SOURCE_BROWSER_CONTROLLED_PUBLIC_PREVIEW",
  startedAt: new Date().toISOString(), smoke, physicalDisplayClaimed: false,
  sources: [__filename, "GameCli_framework/src/components/player/DialogBox.tsx",
    "GameCli_framework/src/components/player/StoryPlayer.tsx"].map(f => desc(path.resolve(root, f))),
  cases: [], inheritedCases: [], errors: [], screenshots: [], cleanup: "NOT_RUN", paidRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
const loaded = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts",
    contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(loaded, loaded.exports);
let server, browser, page;
const frame = page => page.evaluate(() => new Promise(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
const longText = "输入回归：一次按压只推进一次，长按松手不应跳页，键盘与无障碍点击仍可使用。".repeat(900);
function state() {
  const d = document.querySelector(".dialog-box"), p = document.querySelector(".story-player");
  return { page: Number(d?.dataset.dialogPage), pages: Number(d?.dataset.dialogPages),
    done: d?.dataset.dialogPageDone === "true", scene: p?.dataset.currentSceneId,
    command: Number(p?.dataset.currentCommandIndex), mode: d?.dataset.dialogueLayoutMode,
    choice: p?.dataset.waitingChoice === "true" };
}
async function ready() {
  await page.waitForFunction(() => {
    const d = document.querySelector(".dialog-box");
    return d?.dataset.dialogPageDone === "true";
  });
  await frame(page);
}
async function point(selector) {
  const target = page.locator(selector), box = await target.boundingBox();
  assert(box && box.width > 0 && box.height > 0);
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  assert(await target.evaluate((e, p) => e.contains(document.elementFromPoint(p.x, p.y)), p),
    `${selector}: pointer target is obstructed`);
  return p;
}
async function start(layout, mode, choice = false, typing = false) {
  await page.goto(`${server.url}/?mode=preview`);
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
  const gameId = `qa-pointer-${layout}-${mode}-${choice}-${typing}`;
  await page.evaluate(({ typing, gameId }) => {
    const settings = JSON.stringify({ textSpeed: typing ? 36 : 0,
      textSpeedCps: typing ? 36 : 0, autoSaveEnabled: false });
    localStorage.setItem("vn.runtime.settings", settings);
    localStorage.setItem(`vn.runtime.settings.live_preview_${gameId}`, settings);
  }, { typing, gameId });
  const uiSkin = layout === "renpy" ? loaded.exports.createRenpyUILayout() : loaded.exports.getDefaultUISkinLayout();
  const commands = choice
    ? [{ type: "dialog", character_id: "alice", text: "触摸分支前的对白。", presentation_mode: mode },
      { type: "choice", choices: [{ choice_id: "finish", text: "进入正确分支",
        target_scene_id: "finish", conditions: [] }] }]
    : [{ type: "dialog", character_id: "alice", text: mode === "nvl" ? longText.repeat(4) : longText,
      presentation_mode: mode }];
  await page.evaluate(payload => window.postMessage(payload, "*"), {
    type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: gameId,
    requestId: gameId, runId: gameId, revision: 1, screen: "title_menu", uiSkin, assetUrls: {},
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.18.0",
      game_id: gameId, title: "指针输入验收", author: "QA", version: "0.1.0", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "main", assets: [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    script: { schema_version: "1.10.0", game_id: gameId, title: "指针输入验收", entry_scene_id: "main",
      default_dialog_presentation: mode, characters: [{ character_id: "alice", name: "小岚" }],
      scenes: [{ scene_id: "main", title: "输入", chapter: 1, tags: [], commands },
        { scene_id: "finish", title: "分支", chapter: 1, tags: [], commands: [
          { type: "dialog", character_id: "alice", text: "分支成功，且没有被重复推进。", presentation_mode: mode }] }] },
  });
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor();
  await page.waitForFunction(() => !document.querySelector(".game-launch-blackout")
    && document.querySelector("[data-runtime-screen-transition]")?.dataset.runtimeScreenTransition === "idle");
  if (typing) {
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "false"
      && document.querySelector(".story-player")?.dataset.isTyping === "true");
    await frame(page);
  } else await ready();
  assert.equal((await page.evaluate(state)).mode, mode);
}
async function delta(row, name, input, expected = 1) {
  await ready();
  // Larger viewports fit more text. Start a fresh real game before reaching
  // the last page; each input assertion still requires an actual page delta.
  if ((await page.evaluate(state)).page >= (await page.evaluate(state)).pages) {
    await start(row.layout, row.mode);
    row.restarts = (row.restarts || 0) + 1;
  }
  const before = await page.evaluate(state);
  await input();
  await frame(page);
  if (expected) await ready();
  const after = await page.evaluate(state);
  row.steps.push({ name, before, after, expected }); save();
  assert.equal(after.scene, before.scene, name + ": scene skipped");
  assert.equal(after.command, before.command, name + ": command skipped");
  assert.equal(after.page, before.page + expected, name + ": wrong advance count");
}
async function exercise(row, context, mode) {
  const selector = mode === "nvl" ? ".nvl-advance-surface" : ".dialog-box";
  const cdp = await context.newCDPSession(page);
  assert((await page.evaluate(state)).pages >= 2, "Fixture must actually paginate");
  const touch = async dwell => {
    const { x, y } = await point(selector);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
    // Input dwell is deliberate; readiness uses observed runtime state.
    if (dwell) await new Promise(resolve => setTimeout(resolve, dwell));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await delta(row, "short-touch", () => touch(0));
  await delta(row, "held-touch-650ms", () => touch(650));
  await delta(row, "held-touch-1100ms", () => touch(1100));
  await delta(row, "consecutive-touch-first", () => touch(0));
  await delta(row, "consecutive-touch-second", () => touch(0));
  await delta(row, "mouse-click", () => page.locator(selector).click());
  await delta(row, "held-mouse-650ms", () => page.locator(selector).click({ delay: 650 }));
  for (const key of ["Enter", "Space"]) {
    await page.locator(selector).focus();
    await delta(row, "keyboard-" + key, () => page.locator(selector).press(key));
    assert(await page.locator(selector).evaluate(e => e === document.activeElement),
      "Pointer filtering must not steal keyboard focus");
  }
  // DOM click is the independent detail=0 activation used by assistive callers.
  await delta(row, "accessibility-detail-zero", () => page.locator(selector).evaluate(e => e.click()));
  await delta(row, "right-button", () => page.locator(selector).click({ button: "right" }), 0);
  if (mode === "nvl") {
    await delta(row, "real-touch-swipe", async () => {
      const { x, y } = await point(selector);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
      for (const dy of [15, 35, 65, 110])
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove", touchPoints: [{ x, y: y - dy, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }, 0);
    const synthetic = event => page.locator(selector).evaluate((e, args) => {
      for (const item of args) e.dispatchEvent(new PointerEvent(item.type, {
        bubbles: true, cancelable: true, pointerType: "touch", button: 0, ...item }));
    }, event);
    await delta(row, "controlled-cancel-and-trailing-click", async () => {
      await synthetic([{ type: "pointerdown", pointerId: 41, isPrimary: true },
        { type: "pointercancel", pointerId: 41, isPrimary: true },
        { type: "pointerup", pointerId: 41, isPrimary: true }]);
      await page.locator(selector).evaluate(e => e.dispatchEvent(new MouseEvent("click",
        { bubbles: true, cancelable: true, detail: 1 })));
    }, 0);
    await delta(row, "controlled-swipe-and-trailing-click", async () => {
      await synthetic([{ type: "pointerdown", pointerId: 42, isPrimary: true, clientY: 50 },
        { type: "pointerup", pointerId: 42, isPrimary: true, clientY: 90 }]);
      await page.locator(selector).evaluate(e => e.dispatchEvent(new MouseEvent("click",
        { bubbles: true, cancelable: true, detail: 1 })));
    }, 0);
    await delta(row, "controlled-secondary-pointer-preserves-primary", async () => {
      await synthetic([{ type: "pointerdown", pointerId: 43, isPrimary: true },
        { type: "pointerdown", pointerId: 44, isPrimary: false },
        { type: "pointerup", pointerId: 44, isPrimary: false },
        { type: "pointerup", pointerId: 43, isPrimary: true }]);
      await page.locator(selector).evaluate(e => e.dispatchEvent(new MouseEvent("click",
        { bubbles: true, cancelable: true, detail: 1 })));
    });
    await delta(row, "touch-after-cancel-and-swipe", () => touch(0));
  }
  await cdp.detach();
}
(async () => {
  const caseKey = row => JSON.stringify([row.metrics, row.layout, row.mode]);
  if (resume) {
    assert(!smoke, "A smoke run cannot satisfy the full matrix");
    const priorFile = path.join(path.dirname(out), `browser-${resume}/report.json`);
    const previous = JSON.parse(fs.readFileSync(priorFile, "utf8"));
    assert.equal(previous.smoke, false); assert.equal(previous.cleanup, "PASS");
    assert.equal(previous.scope, report.scope);
    const executed = path.join(path.dirname(priorFile), "executed.cjs");
    assert.equal(sha(fs.readFileSync(executed)), previous.sources[0].sha256);
    for (const s of previous.sources.slice(1)) assert.equal(sha(fs.readFileSync(s.path)), s.sha256,
      "Only unchanged product sources may reuse completed cases");
    report.inheritedEvidence = desc(priorFile);
    report.inheritedCases = previous.cases.filter(c => c.status === "PASS");
    assert(report.inheritedCases.length > 0);
    assert(report.inheritedCases.every(c => c.steps.length >= 12));
    assert.equal(new Set(report.inheritedCases.map(caseKey)).size, report.inheritedCases.length);
  }
  const inheritedKeys = new Set(report.inheritedCases.map(caseKey));
  save();
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    logFile: path.join(out, "vite.log") });
  report.server = { pid: server.pid, runId: server.runId, url: server.url }; save();
  await server.run(async () => {
    browser = await chromium.launch({ headless: true });
    for (const [width, height] of smoke ? [desktopViewports[0]] : desktopViewports)
      for (const dpr of smoke ? [1] : [1, 2]) for (const reduced of smoke ? [false] : [false, true]) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
          hasTouch: true, reducedMotion: reduced ? "reduce" : "no-preference" });
        // Controlled isolated preference fixture; not a settings-page acceptance claim.
        await context.addInitScript(() => localStorage.setItem("vn.runtime.settings",
          JSON.stringify({ textSpeed: 0, textSpeedCps: 0, autoSaveEnabled: false })));
        page = await context.newPage(); page.setDefaultTimeout(30000);
        page.on("pageerror", error => report.errors.push(String(error.stack || error)));
        const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
        assert.deepEqual(metrics, { width, height, dpr, reduced });
        for (const layout of ["agentvn", "renpy"]) for (const mode of ["dialog", "nvl", "bubble"]) {
          const row = { layout, mode, metrics, status: "RUNNING", steps: [] };
          if (inheritedKeys.has(caseKey(row))) continue;
          report.cases.push(row); save();
          try {
            await start(layout, mode); await exercise(row, context, mode);
            if (mode === "nvl") {
              await start(layout, mode, true);
              await page.locator(".nvl-advance-surface").tap();
              const choice = page.getByRole("button", { name: "选择：进入正确分支", exact: true });
              await choice.tap();
              await page.waitForFunction(() => document.querySelector(".story-player")?.dataset.currentSceneId === "finish");
              await ready(); const after = await page.evaluate(state);
              assert.equal(after.command, 0);
              row.steps.push({ name: "nvl-choice-not-intercepted", after });
            }
            await start(layout, mode, false, true);
            const before = await page.evaluate(state), target = mode === "nvl" ? ".nvl-advance-surface" : ".dialog-box";
            const p = await point(target), cdp = await context.newCDPSession(page);
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchStart", touchPoints: [{ ...p, id: 1 }] });
            await new Promise(resolve => setTimeout(resolve, 650));
            await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            await cdp.detach(); await ready();
            const after = await page.evaluate(state);
            assert.equal(after.page, before.page, "Held reveal must not also advance the text page");
            assert.equal(after.command, before.command, "Held reveal must not skip dialogue");
            assert(after.done);
            row.steps.push({ name: "held-touch-reveals-without-advancing", before, after });
            row.status = "PASS";
          } catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
          finally { save(); }
          console.log(`PASS ${width}x${height} DPR${dpr} reduced=${reduced} ${layout}/${mode}`);
        }
        await context.close();
      }
    const all = [...report.inheritedCases, ...report.cases];
    assert.equal(all.length, smoke ? 6 : 72);
    assert.equal(new Set(all.map(caseKey)).size, all.length);
    assert(all.every(row => row.status === "PASS" && row.steps.length >= 12));
    assert.deepEqual(report.errors, []);
    report.status = "PASS";
  });
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.finalState = await page.evaluate(state).catch(() => null);
    await page.screenshot({ path: path.join(out, "failure.png"), animations: "allow" }).catch(() => {});
  }
}).finally(async () => {
  try { if (browser) await browser.close(); if (server) await server.stop(); report.cleanup = "PASS"; }
  catch (error) { report.cleanup = "FAILED"; report.cleanupError = String(error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    inheritedCases: report.inheritedCases.length, out, error: report.error }));
});
