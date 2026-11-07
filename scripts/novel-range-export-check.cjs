"use strict";
// Reopen persisted real output, export via the toolbar and reimport its bytes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const out = process.env.AGENTVN_WORKSPACE_OUTPUT, privateOut = process.env.AGENTVN_PRIVATE_OUTPUT;
assert(out && privateOut && !fs.existsSync(out) && !fs.existsSync(privateOut));
fs.mkdirSync(privateOut, { recursive: true });
const baseline = JSON.parse(fs.readFileSync(process.env.AGENTVN_TEST_PROJECT, "utf8"));
const expected = baseline.editor_settings.novelPersistence.sessionSnapshot;
assert.equal(expected.ai_stage, "outline"); assert.equal(expected.ai_chunk_analyses.length, 85);
const report = { status: "RUNNING", scope: "SOURCE_BROWSER_REAL_OUTPUT_REOPEN_EXPORT_REIMPORT",
  steps: [], requests: 0, realModelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const sha = v => crypto.createHash("sha256").update(v).digest("hex");
let env, browser, page;
async function check(page) {
  const session = await page.evaluate(() => window.__AGENTVN_NOVEL_IMPORT_STORE__.getState().session);
  for (const k of ["document", "ai_chunk_analyses", "outline_partials", "ai_outline", "ai_stage"])
    assert.deepEqual(session[k], expected[k], k);
  return { scans: session.ai_chunk_analyses.length, batches: session.outline_partials.batches.length,
    chapters: session.ai_outline.chapters.length, needsReview: session.ai_outline.needs_review };
}
(async () => {
  try {
    env = await startEditorAcceptance(out);
    report.owner = { backendPid: env.backendPid, frontendPid: env.server.pid,
      frontendUrl: env.url, backendUrl: env.backendUrl }; save();
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(60000);
    page.on("websocket", s => s.on("framesent", e => {
      if (JSON.parse(String(e.payload)).command === "start_novel_job") { report.requests++; save(); }
    }));
    await page.route(/\/api\/(?:assistant\/|novel\/.*process)/, r =>
      r.request().method() === "POST" ? r.abort() : r.continue());
    await env.open(page);
    await page.locator('[data-help-key="toolbar.novelImport"]').click();
    await page.getByTestId("novel-import-workbench").waitFor();
    report.steps.push({ name: "fresh-browser-reopen-persisted-project", ...await check(page) }); save();
    await page.locator('[data-help-key="toolbar.novelImport.closeWorkbench"]').click();
    await page.getByTestId("novel-import-workbench").waitFor({ state: "hidden" });
    await page.locator('[data-workspace-surface="edit"]').click();
    await page.locator('[data-workspace-surface="edit"][aria-current="page"]').waitFor();
    const [artifact] = await Promise.all([page.waitForEvent("download"),
      page.locator('[data-help-key="toolbar.saveProject"]').click()]);
    const target = path.join(privateOut, "real-outline.vnproj");
    await artifact.saveAs(target);
    const bytes = fs.readFileSync(target), zip = await JSZip.loadAsync(bytes);
    const exported = JSON.parse(await zip.file("project.json").async("string"));
    const saved = exported.editor_settings.novelPersistence.sessionSnapshot;
    for (const k of ["document", "ai_chunk_analyses", "outline_partials", "ai_outline", "ai_stage"])
      assert.deepEqual(saved[k], expected[k], `portable ${k}`);
    report.steps.push({ name: "toolbar-portable-export", sha256: sha(bytes), bytes: bytes.length }); save();
    // Close this page so it cannot save a stale snapshot over the reimport.
    await page.close();
    const next = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    next.setDefaultTimeout(60000);
    next.on("websocket", s => s.on("framesent", e => {
      if (JSON.parse(String(e.payload)).command === "start_novel_job") { report.requests++; save(); }
    }));
    await next.goto(env.url, { waitUntil: "domcontentloaded" });
    const input = next.locator(".project-import-button input").first();
    await next.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
      .some(i => !i.disabled));
    await input.setInputFiles(target);
    await next.locator(".editor-toolbar").waitFor();
    await next.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
    await next.locator('[data-help-key="toolbar.novelImport"]').click();
    await next.getByTestId("novel-import-workbench").waitFor();
    report.steps.push({ name: "portable-byte-reimport", ...await check(next) }); save();
    assert.equal(report.requests, 0); assert.equal(report.steps.length, 3);
    report.status = "PASS_REAL_OUTPUT_ROUNDTRIP";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      fs.writeFileSync(path.join(privateOut, "failed-ui.txt"), await page.locator("body").innerText());
      await page.screenshot({ path: path.join(privateOut, "failed-ui.png") }).catch(() => {});
    }
  }
  finally {
    await browser?.close(); await env?.stop();
    report.finishedAt = new Date().toISOString();
    if (fs.existsSync(out)) save();
    console.log(JSON.stringify(report));
  }
})();
