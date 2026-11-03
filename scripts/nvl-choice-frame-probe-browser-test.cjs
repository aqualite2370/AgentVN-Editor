"use strict";
// Test the observation instrument itself in an isolated Chromium document.
// This is deliberately not the AgentVN Runtime or an acceptance substitute.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { installChoiceFrameProbe, analyzeChoiceFrames, analyzeDialogFrames } = require("./lib/nvl-choice-frame-probe.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
async function main() {
  const [attempt] = process.argv.slice(2); assert.match(attempt, /^\d{2}$/);
  const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/nvl-choice-probe-selftest-${attempt}`;
  assert(!fs.existsSync(out)); fs.mkdirSync(out); fs.mkdirSync(path.join(out, "temp"));
  const report = { status: "RUNNING", scope: "QA_INSTRUMENT_SYNTHETIC_DOCUMENT_ONLY",
    startedAt: new Date().toISOString(), cases: [], productLaunches: 0, modelRequests: 0 };
  let browser;
  try {
    process.env.TEMP = path.join(out, "temp"); process.env.TMP = process.env.TEMP;
    browser = await chromium.launch({ headless: true });
    for (const kind of ["nvl-choice", "dialog"]) for (const clipped of [false, true]) {
      const width = kind === "dialog" ? 3840 : 1920, height = kind === "dialog" ? 2160 : 1080;
      const prefix = `${kind}-${clipped ? "clipped" : "fitting"}`;
      const context = await browser.newContext({ viewport: { width, height },
        deviceScaleFactor: 1, reducedMotion: "reduce" });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", e => errors.push(String(e)));
      await page.setContent(`<main class="story-player"><div data-testid="game-state-playing"
        data-current-scene-id="${kind === "dialog" ? "narrative_entry" : "capacity"}"
        data-current-command-index="${kind === "dialog" ? 0 : 23}"></div>
        <div class="dialog-box is-nvl-presentation" data-dialog-page="1" data-dialog-pages="1"
          data-dialog-page-done="true" style="width:500px;height:500px">
        <div class="nvl-advance-surface"><div class="nvl-page dialog-text"
          style="width:300px;height:300px;overflow:hidden;font:20px/24px sans-serif">
          <div data-nvl-current="true"><span class="nvl-page-text">${"逐帧观察文字。".repeat(10)}</span></div>
        </div></div></div></main>`);
      await page.evaluate(installChoiceFrameProbe, { kind });
      await page.evaluate(() => window.__QA_NVL_CHOICE_PROBE__.start());
      const cdp = await context.newCDPSession(page), paints = [];
      let firstPaintReceived;
      const firstPaint = new Promise(resolve => { firstPaintReceived = resolve; });
      const receivePaint = event => {
        void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(e => errors.push(String(e)));
        const bytes = Buffer.from(event.data, "base64");
        const file = path.join(out, `${prefix}-paint-${paints.length}.png`);
        fs.writeFileSync(file, bytes, { flag: "wx" });
        paints.push({ path: file, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
          sha256: sha(file), metadata: event.metadata });
        firstPaintReceived();
      };
      cdp.on("Page.screencastFrame", receivePaint);
      await cdp.send("Page.startScreencast", { format: "png", maxWidth: width, maxHeight: height, everyNthFrame: 1 });
      let firstPaintTimer;
      try {
        await Promise.race([firstPaint,
          new Promise((_, reject) => { firstPaintTimer = setTimeout(() => reject(Error("Missing initial frame")), 3000); })]);
      } finally { clearTimeout(firstPaintTimer); }
      await page.evaluate(({ clipped, kind }) => {
        const state = document.querySelector('[data-testid="game-state-playing"]');
        state.dataset.currentCommandIndex = kind === "dialog" ? "0" : "24";
        state.dataset.currentSceneId = kind === "dialog" ? "voice_dialog" : "capacity";
        if (clipped) document.querySelector(".nvl-page").style.height = "20px";
        if (kind === "dialog") document.querySelector(".nvl-page-text").textContent = "新句逐帧观察。".repeat(10);
        else {
          const choice = document.createElement("div");
          choice.className = "choice-panel"; choice.innerHTML = "<button>诊断仪器测试</button>";
          document.querySelector(".dialog-box").append(choice);
        }
      }, { clipped, kind });
      await page.waitForFunction(() => !window.__QA_NVL_CHOICE_PROBE__.read().active, null, { timeout: 10000 });
      const frames = await page.evaluate(() => window.__QA_NVL_CHOICE_PROBE__.finish());
      const analysis = kind === "dialog" ? analyzeDialogFrames(frames) : analyzeChoiceFrames(frames);
      await cdp.send("Page.stopScreencast"); cdp.off("Page.screencastFrame", receivePaint);
      assert.equal(analysis.classification, clipped ? "FRAME_OVERFLOW_AT_END" : "NO_OVERFLOW_OBSERVED");
      assert(analysis.animationFrameSamples >= 90); assert.deepEqual(errors, []);
      assert(paints.length >= 2 && paints.every(f => f.width === width && f.height === height));
      const trace = path.join(out, `${prefix}-trace.json`);
      fs.writeFileSync(trace, JSON.stringify(frames, null, 2), { flag: "wx" });
      report.cases.push({ kind, clipped, width, height, status: "PASS", analysis, trace, traceSha256: sha(trace), paints });
      await context.close();
    }
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try { await browser?.close(); report.browserClosed = true; }
    catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString();
    fs.copyFileSync(__filename, path.join(out, "executed-selftest.cjs"), fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(path.join(__dirname, "lib/nvl-choice-frame-probe.cjs"), path.join(out, "executed-probe.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length,
      browserClosed: report.browserClosed, error: report.error }));
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
