"use strict";
// Non-generating installed UI evidence after the two one-shot live tasks.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { readCurrentInstalledRealModelSession } = require("./lib/current-installed-real-model-session.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const run = path.resolve(__dirname, "../output/installed-real-model-20261019-01");
const out = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || "");
assert.equal(path.dirname(out), run);
assert(/^native-entry-motion-probe-\d{2}$/.test(path.basename(out)));
assert(!fs.existsSync(out)); fs.mkdirSync(out);
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""), out);
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""),
  path.resolve("F:/AgentVN-QA-InstalledRealModel-20261019-01/真实Agent组件 隔离小工程.vnproj"));
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "INSTALLED_EDITOR_ONLY_NO_MODEL_CALL_NO_PRODUCT_FIX",
  novelEntry: [], motion: [], screenshots: [], modelSubmissions: 0, error: null };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser;
(async () => {
  const { state } = readCurrentInstalledRealModelSession(run);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  const page = browser.contexts()[0].pages().find(p => /tauri\.localhost/.test(p.url()));
  page.setDefaultTimeout(15000);
  const cdp = await page.context().newCDPSession(page);
  page.on("request", req => {
    if (req.method() === "POST" && /\/api\/assistant\/creation\/processes$|\/api\/novel\/.*execute\/jobs$/.test(new URL(req.url()).pathname))
      report.modelSubmissions++;
  });
  const close = page.getByRole("button", { name: "关闭工作台", exact: true });
  if (await close.isVisible()) { await close.click(); await page.getByTestId("assistant-creation-workbench-window").waitFor({ state: "detached" }); }
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    const expected = { width, height, dpr, reduced };
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await readInstalledViewport(page, expected);
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    const entry = await page.locator('[data-help-key="toolbar.novelImport"]').evaluateAll(buttons =>
      buttons.map(button => {
        const rect = button.getBoundingClientRect();
        const hidden = []; for (let n = button; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.display === "none" || s.visibility === "hidden") hidden.push({ tag: n.tagName, class: n.className, display: s.display, visibility: s.visibility });
        }
        return { rect: rect.toJSON(), hiddenAncestors: hidden, hit: rect.width > 0 && rect.height > 0
          && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
      }));
    assert.equal(entry.length, 1);
    report.novelEntry.push({ ...expected, status: entry[0].hit ? "PASS" : "FAILED", entry });
    await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
    const visibleAlternatives = await page.locator("button:visible").filter({ hasText: /小说导入/ }).count();
    report.novelEntry.at(-1).visibleAlternativesInAI = visibleAlternatives;
    await page.locator('[data-workspace-surface="options"]:visible').click(); await settleEditor(page);
    const tools = page.locator(".workspace-task-panel.is-open .advanced-tools-panel > nav");
    await tools.getByRole("button", { name: "项目设置", exact: true }).click(); await settleEditor(page);
    for (const target of ["素材库", "生成历史", "项目设置"]) {
      await page.evaluate(() => {
        window.__qaGlassFrames = []; window.__qaGlassSampling = true;
        const frame = time => {
          if (!window.__qaGlassSampling) return;
          const nav = document.querySelector(".workspace-task-panel.is-open .advanced-tools-panel > nav");
          const active = nav?.querySelector('[data-glass-selected="true"]');
          const indicator = nav?.querySelector(".glass-selection-indicator");
          const material = nav?.querySelector(".liquid-glass-surface");
          window.__qaGlassFrames.push({ time, active: active?.textContent?.trim(), moving: indicator?.dataset.glassMoving,
            state: indicator?.dataset.glassState, nav: nav?.getBoundingClientRect().toJSON(),
            button: active?.getBoundingClientRect().toJSON(), indicator: indicator?.getBoundingClientRect().toJSON(),
            material: material?.getBoundingClientRect().toJSON() });
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      await tools.getByRole("button", { name: target, exact: true }).click(); await settleEditor(page);
      await page.waitForFunction(() => {
        const i = document.querySelector(".workspace-task-panel.is-open .advanced-tools-panel > nav .glass-selection-indicator");
        return i && i.dataset.glassMoving !== "true" && i.dataset.glassState === "settled";
      }, null, { timeout: 10000 });
      const frames = await page.evaluate(async () => {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        window.__qaGlassSampling = false; return window.__qaGlassFrames;
      });
      assert(frames.length > 1, "Reject an empty/single-frame motion proof");
      const last = frames.at(-1);
      const mismatch = last.indicator && last.button ? Math.max(...["x", "y", "width", "height"].map(k =>
        Math.abs(last.indicator[k] - last.button[k]))) : null;
      const contentOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      report.motion.push({ ...expected, target, frameCount: frames.length,
        sampledMs: frames.at(-1).time - frames[0].time, settledGeometryDelta: mismatch,
        status: mismatch !== null && mismatch <= 2 && contentOverflow <= 1 ? "PASS" : "FAILED",
        horizontalOverflow: contentOverflow, frames });
      save();
    }
    report.screenshots.push(await captureInstalledWebview(page, cdp,
      path.join(out, `editor-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`), expected));
    console.log(`RECORDED ${width}x${height} DPR${dpr} reduced=${reduced}`);
  }
  assert.equal(report.novelEntry.length, 12); assert.equal(report.motion.length, 36);
  assert.equal(report.screenshots.length, 12); assert.equal(report.modelSubmissions, 0);
  report.status = report.novelEntry.some(r => r.status === "FAILED") || report.motion.some(r => r.status === "FAILED") ? "FAILED" : "PASS";
  report.novelModelTask = report.novelEntry.every(r => r.status === "FAILED")
    ? "NOT_RUN_DEPENDENT_ON_UNREACHABLE_REAL_UI_ENTRY" : "NOT_SUBMITTED_BY_THIS_PROBE";
})().catch(error => { report.status = "TOOL_FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(async () => { await browser?.close(); report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, novelEntryCases: report.novelEntry.length,
      motionCases: report.motion.length, paidSubmissions: report.modelSubmissions, error: report.error, out })); });
