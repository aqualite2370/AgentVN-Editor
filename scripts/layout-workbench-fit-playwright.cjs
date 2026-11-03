"use strict";
// Exercise actual Options navigation; record source UI evidence, never installation proof.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt, /^\d{2}$/);
const base = "F:/AgentVN/QA/Layout-Workbench-Fit-20261021-01";
const out = path.join(base, attempt), checkpoint = "F:/AgentVN/Checkpoints/Layout-Workbench-Fit-20261021-01";
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const files = ["editor/src/components/editor/EditorToolbar.tsx", "editor/src/styles/editor-responsive.css",
  "editor/src/styles/layout.css", "editor/src/components/advanced/renpy-title-editor.css",
  "editor/src/components/novel-import/NovelTaskCard.tsx", "editor/src/components/novel-import/novel-task-floating.css",
  "editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx"];
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
if (!fs.existsSync(checkpoint)) {
  fs.mkdirSync(checkpoint, { recursive: true });
  for (const f of files) {
    const dest = path.join(checkpoint, f); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, f), dest, fs.constants.COPYFILE_EXCL);
  }
}
const report = { status: "RUNNING", at: new Date().toISOString(), scope: "SOURCE_BROWSER_NOT_INSTALLED",
  modelRequests: 0, matrix: [], sources: files.map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const input = path.join(out, "复杂工作台 独立工程.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture(`layout-workbench-${attempt}`)), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
let host, browser;
async function sample(page) {
  return page.evaluate(() => {
    const selectors = { panel: ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)",
      workspace: ".editor-workspace", palette: ".node-palette", inspector: ".scene-editor-pane",
      header: ".runtime-layout-header", save: '[data-help-key="layout.save"]',
      grid: ".runtime-layout-grid", left: ".runtime-layout-grid > .runtime-layout-sidebar",
      center: ".runtime-layout-grid > .runtime-layout-center", right: ".runtime-layout-grid > .runtime-layout-inspector" };
    const active = document.querySelector(".advanced-tab-content.is-active");
    return Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
      const n = (["header", "save", "grid", "left", "center", "right"].includes(key) ? active ?? document : document).querySelector(selector);
      if (!n) return [key, null];
      const s = getComputedStyle(n), r = n.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 20));
      return [key, { rect: r.toJSON(), width: n.clientWidth, scrollWidth: n.scrollWidth, scrollLeft: n.scrollLeft,
        display: s.display, visibility: s.visibility, hit: n === hit || n.contains(hit), columns: s.gridTemplateColumns }];
    }));
  });
}
function verify(o) {
  for (const k of ["header", "save", "grid", "left", "center", "right"]) {
    assert(o[k], `Missing ${k}`); const r = o[k].rect, p = o.panel.rect;
    assert(r.width > 0 && r.height > 0 && r.left >= p.left - 1 && r.right <= p.right + 1
      && r.top >= p.top - 1 && r.bottom <= p.bottom + 1, `${k} clipped by panel: ${JSON.stringify(o)}`);
    if (k !== "save") assert(o[k].scrollWidth <= o[k].width + 1, `${k} has hidden horizontal content`);
  }
  assert(o.save.hit, "Save must be actually clickable");
  assert(o.left.rect.right <= o.center.rect.left + 1 && o.center.rect.right <= o.right.rect.left + 1);
  assert(o.palette.rect.right <= o.panel.rect.left + 1, "Node-building rail stays outside workbench");
  assert(o.palette.visibility === "visible" && o.palette.display !== "none");
  assert(o.center.rect.width >= 360, "The real preview needs usable working room");
}
(async () => {
  save(); host = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.service = { url: host.url, backendUrl: host.backendUrl, pid: host.server.pid, backendPid: host.backendPid }; save();
  browser = await chromium.launch({ headless: true });
  const cells = [];
  for (const [width, height] of process.argv.includes("--reported") ? [[1280, 1053]]
    : [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) cells.push({ width, height, dpr, reduced });
  for (const metrics of cells) {
    const cell = { ...metrics, status: "RUNNING", cases: [] }; report.matrix.push(cell); save();
    const context = await browser.newContext({ viewport: metrics, deviceScaleFactor: metrics.dpr,
      reducedMotion: metrics.reduced ? "reduce" : "no-preference" });
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    try {
      await page.route(/\/api\/(?:assistant|novel)/, r => {
        if (r.request().method() === "POST") { report.modelRequests++; return r.abort(); }
        return r.continue();
      });
      await host.open(page); await settleEditor(page);
      const original = await sample(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
      for (const type of ["renpy", "agentvn"]) {
        const button = page.locator(`[data-layout-type-option="${type}"]:visible`);
        if (await button.getAttribute("aria-pressed") !== "true") await button.click();
        await page.waitForFunction(t => document.querySelector(".runtime-layout-designer")?.getAttribute("data-layout-type") === t
          && document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false", type);
        await settleEditor(page);
        const observed = await sample(page); cell.cases.push({ type, observed }); save();
        if ((metrics.width === 1920 || metrics.width === 1280) && metrics.dpr === 1 && !metrics.reduced)
          cell.cases.at(-1).screenshot = await captureSourceBrowser(page, path.join(out, `${type}.png`), metrics);
        verify(observed);
        assert.deepEqual(observed.palette.rect, original.palette.rect, "Do not reflow the node rail");
        assert.deepEqual(observed.inspector.rect, original.inspector.rect, "Do not reflow the background Inspector");
      }
      await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
      const after = await sample(page);
      assert.deepEqual(after.palette.rect, original.palette.rect);
      assert.deepEqual(after.inspector.rect, original.inspector.rect);
      cell.status = "PASS"; save(); console.log(`PASS ${metrics.width} DPR${metrics.dpr} reduce=${metrics.reduced}`);
    } finally { await context.close(); }
  }
  assert.equal(report.matrix.length, process.argv.includes("--reported") ? 4 : 12);
  assert(report.matrix.every(c => c.status === "PASS" && c.cases.length === 2));
  assert.equal(report.modelRequests, 0); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => {
    await browser?.close(); await host?.stop(); report.cleanup = [];
    for (const url of [host?.url, host?.backendUrl].filter(Boolean)) {
      let alive = false; try { await fetch(url, { signal: AbortSignal.timeout(1000) }); alive = true; } catch {}
      report.cleanup.push({ url, status: alive ? "FAILED" : "PASS" });
    }
    if (report.cleanup.some(c => c.status !== "PASS")) { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error }));
  });
