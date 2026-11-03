"use strict";
// G12 read-only presentation observation plus real safe clicks in QA project.
// Original motion-01 report remains FAILED; this only supplements specific gaps.
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { settleEditor, sha256 } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const { beginEditorMotion, finishEditorMotion } = require("./lib/installed-editor-motion-sampler.cjs");
const { waitForSurfaceTransitionSettled } = require("./editor-workspace-surface-transition-playwright.cjs");
const run = "D:/AgentVN/output/installed-editor-motion-20261018-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const fixture = read(path.join(run, "fixtures.json")), launch = read(path.join(run, "launch.json"));
const out = process.argv[2]; assert(out && !fs.existsSync(out)); fs.mkdirSync(out);
const traceRoot = path.join(path.dirname(fixture.input), path.basename(out)); assert(!fs.existsSync(traceRoot)); fs.mkdirSync(traceRoot);
const report = { status: "RUNNING", at: new Date().toISOString(), curveMatrix: [], interactionMatrix: [], screenshots: [],
  errors: [], modelSubmissions: [], productChanges: 0, realModelRequests: 0,
  priorEvidence: { path: path.join(run, "motion-01/report.json"), sha256: sha256(fs.readFileSync(path.join(run, "motion-01/report.json"))),
    unchangedFailedReport: true }, error: null };
let browser, page, cdp, serial = 0, expected;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function check(row, name, ok, detail) { row.checks.push({ name, status: ok ? "PASS" : "FAILED", detail }); }
async function homeReady() {
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: fixture.title }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching, .project-entry-loading-overlay"));
}
async function idle(tab) {
  await page.waitForFunction(tab => {
    const p = document.querySelector(".workspace-task-panel.is-open:not(.toolbar-popover-morph-ghost)");
    return p?.querySelector(".advanced-tools-panel.is-tab-idle") && p.querySelector(`.advanced-tab-content.is-active[data-tab="${tab}"]`)
      && !p.classList.contains("is-morphing") && !p.getAnimations().some(a => a.playState === "running");
  }, tab);
}
async function entry() {
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay, .app-view-editor.is-entering"));
}
async function observed(name, rows, action, verify) {
  const row = { ...expected, name, status: "RUNNING", checks: [] }; rows.push(row); save();
  await beginEditorMotion(page, name);
  try { await action(); } catch (e) { row.actionError = String(e.stack || e); }
  const trace = await finishEditorMotion(page);
  const file = path.join(traceRoot, `${++serial}-${name}.json.gz`), bytes = zlib.gzipSync(Buffer.from(JSON.stringify(trace)));
  fs.writeFileSync(file, bytes, { flag: "wx" }); row.trace = { path: file, sha256: sha256(bytes), frames: trace.frames.length };
  check(row, "Real trusted input and visible frames match actual combination", trace.inputs.some(i => i.trusted)
    && trace.frames.length >= 3 && !trace.limitReached && trace.frames.every(f => !f.pageHidden && f.width === expected.width
      && f.height === expected.height && f.dpr === expected.dpr && f.reduced === expected.reduced));
  if (row.actionError) check(row, "Actual UI action completes", false, row.actionError);
  try { await verify(row, trace); } catch (e) { check(row, "Verifier has complete evidence", false, String(e.stack || e)); }
  row.status = row.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED"; save();
  console.log(`${row.status} ${expected.width}/${expected.dpr}/${expected.reduced} ${name}`);
}
(async () => {
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
  assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
  assert.equal(sha256(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(25000); cdp = await page.context().newCDPSession(page);
  page.on("pageerror", e => report.errors.push(String(e)));
  page.on("request", r => { if (r.method() === "POST" && /\/api\/(assistant\/creation\/processes|assistant\/chat|novel.*\/start)$/.test(new URL(r.url()).pathname))
    report.modelSubmissions.push(r.url()); });
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    expected = { width, height, dpr, reduced };
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" }); await readInstalledViewport(page, expected);
    await page.reload({ waitUntil: "domcontentloaded" }); await homeReady();
    await observed("css-container-curve", report.curveMatrix, entry, (row, trace) => {
      const animated = trace.frames.filter(f => f.editor?.animations.some(a => a.name === "container-boot" && a.state === "running"));
      const curve = "cubic-bezier(0.16, 0.86, 0.18, 1)";
      check(row, "Actual CSS keyframe segment easing and1120/520 duration retained", animated.length >= 3
        && animated.every(f => f.editor.cssAnimationTimingFunction === curve && f.editor.animations.filter(a => a.name === "container-boot")
          .every(a => a.duration === (reduced ? 520 : 1120) && a.keyframes.some(k => k.offset < 1 && k.easing === curve))),
      { samples: animated.length, first: animated[0]?.editor,
        note: "CSSAnimation overall effect timing is legitimately linear; CSS easing is on keyframe segments." });
      check(row, "Actual rendered container intermediate values retained", animated.filter(f => f.editor.opacity > .01 && f.editor.opacity < .99).length >= 2);
    });
    await page.locator('[data-workspace-surface="options"]:visible').click(); await waitForSurfaceTransitionSettled(page, "options"); await idle("settings");
    for (const tab of ["assets", "library"]) {
      await observed(`inspector-boundary-${tab}`, report.interactionMatrix, async () => {
        await page.locator(`[data-help-key="advanced.tab.${tab}"]:visible`).click(); await idle(tab);
      }, (row, trace) => {
        const hits = trace.frames.filter(f => f.inspectorOverlapHit?.belongsToPanel);
        check(row, "Animated panel never actually intercepts Inspector pixels", hits.length === 0, {
          interceptedFrameCount: hits.length, examples: hits.slice(0, 3).map(f => ({ at: f.at, panel: f.panel.rect,
            inspector: f.inspector.rect, hit: f.inspectorOverlapHit })) });
      });
    }
    await observed("background-input-during-exit", report.interactionMatrix, async () => {
      const prior = await page.locator(".react-flow__node").count();
      await page.locator('[data-workspace-surface="edit"]:visible').click();
      await page.locator(".node-palette").getByRole("button", { name: "场景节点", exact: true }).click();
      await page.waitForFunction(n => document.querySelectorAll(".react-flow__node").length === n + 1, prior);
      await page.waitForFunction(() => !document.querySelector(".workspace-task-panel, .toolbar-popover-morph-ghost"));
    }, (row, trace) => {
      const input = trace.inputs.find(i => i.type === "click" && i.inPalette && i.label === "场景节点");
      check(row, "Real scene-add click executes while closing layer still exists", Boolean(input?.trusted && input.panelClosing), input);
      check(row, "Leaving panel never regains input/focus", trace.frames.filter(f => f.panel?.className.includes("is-closing"))
        .every(f => f.panel.inert && !f.bodyInert && !f.focus.inClosingPanel));
      check(row, "No horizontal overflow after actual edit", trace.frames.every(f => f.overflow <= 1));
    });
    report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${width}-${dpr}-${reduced}.png`), expected)); save();
  }
  assert.equal(report.curveMatrix.length, 12); assert.equal(report.interactionMatrix.length, 36); assert.equal(report.modelSubmissions.length, 0);
  report.status = [...report.curveMatrix, ...report.interactionMatrix].every(r => r.status === "PASS") && report.errors.length === 0 ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await page?.evaluate(() => window.__qaInstalledEditorMotion?.stop?.()).catch(() => {});
  await browser?.close().catch(() => {}); report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, curveCombinations: report.curveMatrix.length,
    interactionEpisodes: report.interactionMatrix.length, error: report.error }, null, 2));
});
