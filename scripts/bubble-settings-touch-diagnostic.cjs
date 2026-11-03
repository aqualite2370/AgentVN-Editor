"use strict";
// Source-browser diagnosis only. No Android/device, installed-player or audio claim.
// Reuse the unmodified UI-exported cartridge and enter through its title/branches.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const attempt = process.argv[2] || "04";
const heldOnly = process.argv.includes("--held-only");
assert.match(attempt, /^\d{2}$/);
const out = `F:/AgentVN/QA/Android-Candidate-1940-20261103-04/bubble-settings-diagnostic-${attempt}`;
assert(!fs.existsSync(out), "Do not overwrite historical evidence");
fs.mkdirSync(out);
const receipt = "F:/AgentVN/QA/Android-Package-20261021-01/editor-41/report.json";
const input = JSON.parse(fs.readFileSync(receipt, "utf8")).cartridge;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(sha(fs.readFileSync(input.path)), input.sha256);
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "SOURCE_BROWSER_TOUCH_NATURAL_ROUTE_NOT_ANDROID_ACCEPTANCE",
  cartridge: { path: input.path, sha256: input.sha256 },
  cases: [], events: [], states: [], errors: [], cleanup: "PENDING",
  builds: 0, modelRequests: 0, deviceLaunches: 0,
  heldOnly,
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
report.scriptSha256 = sha(fs.readFileSync(__filename));
const sourceFiles = ["components/player/DialogBox.tsx", "components/player/StoryPlayer.tsx",
  "engine/StoryEngine.ts", "store/runtimeStore.ts"];
report.sourceHashes = Object.fromEntries(sourceFiles.map(f =>
  [f, sha(fs.readFileSync(path.join(root, "GameCli_framework/src", f)))]));
let server, browser, page;

function readState() {
  const p = document.querySelector(".story-player"), d = document.querySelector(".dialog-box");
  const t = document.querySelector("[data-runtime-screen-transition]");
  return { screen: t?.dataset.runtimePresentedScreen, transition: t?.dataset.runtimeScreenTransition,
    scene: p?.dataset.currentSceneId, command: Number(p?.dataset.currentCommandIndex),
    page: Number(d?.dataset.dialogPage), pages: Number(d?.dataset.dialogPages),
    done: d?.dataset.dialogPageDone === "true", typing: p?.dataset.isTyping === "true",
    reveal: p?.dataset.typingRevealRequested === "true", mode: d?.dataset.dialogueLayoutMode,
    choice: p?.dataset.waitingChoice === "true",
    auto: document.querySelector('[data-testid="renpy-quick-auto"]')?.getAttribute("aria-pressed"),
    skip: document.querySelector('[data-testid="renpy-quick-skip"]')?.getAttribute("aria-pressed"),
    text: d?.querySelector(".dialog-text")?.textContent || "" };
}
async function settled() {
  await page.waitForFunction(() => {
    const t = document.querySelector("[data-runtime-screen-transition]");
    return t?.dataset.runtimeScreenTransition === "idle"
      && !document.querySelector(".game-launch-blackout");
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function snapshot(label) {
  const value = await page.evaluate(readState);
  report.states.push({ label, ...value }); save(); return value;
}
async function touch(selector, label) {
  const target = page.locator(selector);
  await target.waitFor({ state: "visible" });
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  assert(box && box.width > 0 && box.height > 0, `${label}: missing touch area`);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  assert(await target.evaluate((e, point) => e.contains(document.elementFromPoint(point.x, point.y)), { x, y }),
    `${label}: obstructed touch target`);
  // Let Playwright wait for enabled/stable input ownership as well as visibility.
  // Choice intro exposes a visible disabled button before it can accept a tap.
  await target.tap();
}
async function reveal() {
  const before = await page.evaluate(readState);
  assert(before.scene && before.pages >= 1, "Reveal requires an active measured dialogue");
  if (!before.done) {
    const line = script.scenes.find(s => s.scene_id === before.scene)?.commands[before.command];
    if ((line?.text?.length || 0) > 160)
      await touch(before.mode === "nvl" ? ".nvl-advance-surface" : ".dialog-box", "reveal");
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
  }
  const after = await page.evaluate(readState);
  assert.equal(after.scene, before.scene, "Reveal changed scene");
  assert.equal(after.command, before.command, "Reveal changed command");
  assert.equal(after.page, before.page, "Reveal skipped page");
  return after;
}
let script;
(async () => {
  save();
  const zip = await JSZip.loadAsync(fs.readFileSync(input.path), { checkCRC32: true });
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
  const uiSkin = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const assetUrls = {};
  for (const asset of manifest.assets) {
    const bytes = await zip.file(asset.path).async("nodebuffer");
    assetUrls[asset.asset_id] = `data:${asset.mime_type || "application/octet-stream"};base64,${bytes.toString("base64")}`;
  }
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(out, "vite.log") });
  report.server = { pid: server.pid, runId: server.runId, url: server.url }; save();
  await server.run(async () => {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 915, height: 412 },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", e => report.errors.push(String(e.stack || e)));
    await page.exposeFunction("recordBubbleInput", event => { report.events.push(event); });
    await page.addInitScript(() => {
      for (const type of ["pointerdown", "pointerup", "click", "touchstart", "touchend"]) {
        document.addEventListener(type, event => {
          const e = event.target instanceof Element ? event.target : null;
          const player = document.querySelector(".story-player");
          void window.recordBubbleInput({ type, at: performance.now(), detail: event.detail,
            pointerType: event.pointerType, target: e?.closest("[data-testid]")?.getAttribute("data-testid"),
            className: e?.getAttribute("class"), prevented: event.defaultPrevented,
            scene: player?.dataset.currentSceneId, command: player?.dataset.currentCommandIndex,
            page: document.querySelector(".dialog-box")?.dataset.dialogPage });
        }, true);
      }
    });
    await page.goto(`${server.url}/?mode=preview`);
    await page.waitForFunction(() => Boolean(document.querySelector("[data-testid='game-state-loading']"))
      || Boolean(document.querySelector("#root")?.childElementCount));
    await page.evaluate(payload => window.postMessage(payload, "*"), {
      type: "agentvn.live-preview.init", protocolVersion: 2,
      sessionId: "bubble-settings-touch", revision: 1, requestId: "bubble-settings-touch",
      runId: "bubble-settings-touch", screen: "title_menu", manifest, script, uiSkin, assetUrls,
    });
    await page.getByTestId("start-new-game").waitFor();
    await settled();
    await touch('[data-testid="start-new-game"]', "start");
    // Do not confuse the title's old idle state with the completed game launch.
    await page.getByTestId("game-state-playing").waitFor();
    await settled();
    await page.waitForFunction(() => Number(document.querySelector(".dialog-box")?.dataset.dialogPages) >= 1);
    let state;
    for (let i = 0; i < 500; i++) {
      state = await page.evaluate(readState);
      if (state.scene === "bubble" && state.command === 8) break;
      if (state.choice) {
        await touch(".choice-option:first-child", "authored branch");
        await page.waitForFunction(previousScene => {
          const p = document.querySelector(".story-player");
          return p?.dataset.currentSceneId !== previousScene && p?.dataset.waitingChoice === "false";
        }, state.scene);
        await page.locator(".dialog-box").waitFor({ state: "visible" });
        await page.waitForFunction(() => Number(document.querySelector(".dialog-box")?.dataset.dialogPages) >= 1);
      } else {
        const before = await reveal();
        await touch(before.mode === "nvl" ? ".nvl-advance-surface" : ".dialog-box", "next page/line");
        await page.waitForFunction(({ scene, command, currentPage }) => {
          const p = document.querySelector(".story-player"), d = document.querySelector(".dialog-box");
          return p?.dataset.currentSceneId !== scene || Number(p?.dataset.currentCommandIndex) !== command
            || Number(d?.dataset.dialogPage) !== currentPage || p?.dataset.waitingChoice === "true";
        }, { scene: before.scene, command: before.command, currentPage: before.page });
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    assert.equal(state.scene, "bubble");
    assert.equal(state.command, 8);
    await reveal();
    report.entry = await snapshot("natural-route-long-bubble");
    assert(report.entry.pages > 1, "Expected real long-bubble pagination");
    for (let iteration = 1; iteration <= (heldOnly ? 0 : 5); iteration++) {
      const row = { iteration, status: "RUNNING" };
      report.cases.push(row); save();
      row.before = await snapshot(`before-${iteration}`);
      await touch('[data-testid="renpy-quick-settings"]', "settings");
      await page.getByTestId("settings-finish").waitFor();
      await settled();
      row.inSettings = await snapshot(`settings-${iteration}`);
      await touch('[data-testid="settings-finish"]', "finish settings");
      await page.getByTestId("game-state-playing").waitFor();
      await settled();
      row.after = await snapshot(`after-${iteration}`);
      for (const key of ["scene", "command", "page", "pages", "mode", "text"])
        assert.deepEqual(row.after[key], row.before[key], `Settings return changed ${key}`);
      assert(row.after.done, "Completed text restarted");
      row.status = "PASS"; save();
    }
    if (heldOnly) {
      const row = { name: "one held touch advances exactly one page", status: "RUNNING",
        input: { pointerType: "touch", dwellMs: 650 } };
      report.cases.push(row);
      row.before = await snapshot("before-held-touch");
      const target = page.locator(".dialog-box");
      const rect = await target.boundingBox();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      assert(await target.evaluate((e, p) => e.contains(document.elementFromPoint(p.x, p.y)), { x, y }));
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
      // Deliberate input duration, not an animation/readiness delay.
      await new Promise(resolve => setTimeout(resolve, row.input.dwellMs));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.evaluate(() => new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
      row.after = await snapshot("after-held-touch");
      assert.equal(row.after.scene, row.before.scene, "One held touch changed the scene");
      assert.equal(row.after.command, row.before.command, "One held touch skipped the current command");
      assert.equal(row.after.page, row.before.page + 1, "One held touch advanced more than one page");
      row.status = "PASS";
    }
    assert.equal(report.cases.length, heldOnly ? 1 : 5);
    assert.deepEqual(report.errors, []);
    report.status = "PASS_SOURCE_TOUCH_ONLY";
  });
})().catch(async error => {
  report.status = "FAILED_DIAGNOSTIC";
  report.error = String(error.stack || error);
  for (const row of report.cases.filter(row => row.status === "RUNNING")) {
    row.status = "FAILED";
    row.error = report.error;
  }
  if (page) {
    report.finalState = await page.evaluate(readState).catch(() => null);
    await page.screenshot({ path: path.join(out, "failure.png"), animations: "allow" }).catch(() => {});
  }
  process.exitCode = 1;
}).finally(async () => {
  try {
    if (browser) await browser.close();
    if (server) await server.stop();
    report.cleanup = "PASS";
  } catch (error) { report.cleanup = "FAILED"; report.cleanupError = String(error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
});
