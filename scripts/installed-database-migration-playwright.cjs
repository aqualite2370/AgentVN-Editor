"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { chromium } = require("../editor/node_modules/playwright");
const { sha256, settleEditor } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-database-migration-20261018-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")), sha = p => sha256(fs.readFileSync(p));
const [which, out] = process.argv.slice(2);
assert(["cancel", "cancel-restart", "accept", "accept-restart", "conflict"].includes(which));
assert(out && path.dirname(path.resolve(out)) === path.resolve(run) && !fs.existsSync(out));
fs.mkdirSync(out);
const fixture = read(path.join(run, "fixtures.json")), prep = read(path.join(run, "preparation.json"));
assert(prep.profiles.every(p => fs.existsSync(p.held)));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
const launch = read(path.join(run, `${which}-launch.json`)), backend = read(path.join(run, `${which}-backend.json`));
assert.equal(backend.status, "PASS"); assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")), launch.executableSha256);
const approved = !which.startsWith("cancel"), database = path.join(fixture.defaultRoaming, "backend/vn_engine.db");
const report = { status: "RUNNING", at: new Date().toISOString(), which, checks: [], screenshots: [], pageErrors: [],
  source: { path: fixture.source.path, sha256: fixture.source.sha256 }, launch,
  scope: "ACTUAL_NSIS_EDITOR_NATIVE_CONSENT_AND_REAL_OLD_DATABASE_PLACED_AT_EXE_LEGACY_PATH_NOT_OLD_INSTALLATION_LOCATION_PROOF",
  productChanges: 0, realModelRequests: 0, tool: { path: __filename, sha256: sha(__filename) }, error: null };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser, page, cdp;
async function step(name, fn) {
  const c = { name, status: "RUNNING" }; report.checks.push(c); save();
  try { c.detail = await fn(c); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { save(); console.log(`${c.status} ${which} ${name}`); }
}
function databaseState() {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    const summaries = db.prepare("SELECT project_id,title,author FROM editor_project_summaries ORDER BY project_id").all();
    const details = db.prepare("SELECT project_id,project_json FROM editor_project_details ORDER BY project_id").all()
      .map(r => ({ id: r.project_id, project: JSON.parse(r.project_json) }));
    return { path: database, sha256: sha(database), summaries, details };
  } finally { db.close(); }
}
function originalBackups() {
  const roots = [path.dirname(fixture.legacy), path.dirname(database)];
  return roots.flatMap(root => fs.readdirSync(root).filter(n => n.startsWith("vn_engine.db.agentvn-backup-"))
    .map(n => { const p = path.join(root, n); return { path: p, sha256: sha(p), bytes: fs.statSync(p).size }; }));
}
const expectedViewport = { width: 1920, height: 1080, dpr: 1, reduced: false };
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expectedViewport)); save();
}
(async () => {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tauri.localhost"));
    if (page) break; await new Promise(r => setTimeout(r, 100));
  }
  assert(page); page.setDefaultTimeout(30000); page.on("pageerror", e => report.pageErrors.push(String(e)));
  await page.locator('[data-help-key="home.createProject"].home-action-primary').waitFor();
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(() => innerWidth === 1920 && innerHeight === 1080 && devicePixelRatio === 1);
  await readInstalledViewport(page, expectedViewport);
  await step("Actual native decision, unchanged old database bytes and default shared database path match this case", async c => {
    const decisionPath = path.join(fixture.defaultRoaming, "backend/database-migration-decision.json");
    const decision = read(decisionPath);
    c.observed = { decision, decisionPath, decisionSha256: sha(decisionPath), database: databaseState(),
      legacySha256: sha(fixture.legacy), backups: originalBackups() }; save();
    assert.equal(decision.approved, approved); assert.equal(decision.sources.length, 1);
    assert.equal(path.resolve(decision.sources[0]), path.resolve(fixture.legacy));
    assert.equal(c.observed.legacySha256, fixture.source.sha256);
    assert.equal(sha(fixture.source.path), fixture.source.sha256);
    assert.equal(path.resolve(database), path.resolve("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"));
    assert.equal(launch.dataDirectoryOverride, false); assert.equal(launch.webviewDirectoryOverride, false); assert.equal(launch.consentInjected, false);
    return c.observed;
  });
  if (!approved) {
    await step("Actual homepage and SQLite both exclude old project after native No; no migration/backup file created", async () => {
      const current = databaseState(); assert.equal(current.details.length, 0); assert.equal(current.summaries.length, 0);
      const titles = await page.locator('[data-help-key="home.recentProject"]').allTextContents();
      assert(!titles.some(t => t.includes(fixture.title)));
      assert(!fs.existsSync(path.join(fixture.defaultRoaming, "backend/database-migration-record.json")));
      assert.equal(originalBackups().length, 0); await shot("cancelled-empty-home");
      return { summaries: current.summaries, recentProjectTexts: titles, oldProjectImported: false, originalBytesUnchanged: true };
    });
  } else {
    const expectedProject = which === "conflict" ? fixture.seed.project : fixture.source.project;
    await step("Real homepage migration result opens old project with correct identity, authored graph and actual inspector summary", async c => {
      await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
      const scene = expectedProject.nodes.find(n => n.data?.scene); assert(scene);
      await page.locator(`.react-flow__node[data-id="${scene.id}"]`).getByText(scene.data.scene.title, { exact: true }).click();
      const summary = page.getByRole("textbox", { name: /^场景摘要(?: 场景摘要)?$/ }); await summary.waitFor();
      const response = await fetch("http://127.0.0.1:8278/api/project/state", { signal: AbortSignal.timeout(10000) });
      const payload = await response.json(); assert(response.ok && payload.ok);
      const graph = payload.data.project_graph, metadata = payload.data.project_metadata;
      c.observed = { metadata: { projectId: metadata.projectId, title: metadata.title, author: metadata.author },
        nodeIds: graph.nodes.map(n => n.id), edgeIds: graph.edges.map(e => e.id), actualSummary: await summary.inputValue(),
        scenes: graph.nodes.filter(n => n.data?.scene).map(n => ({ id: n.id, scene: n.data.scene })) }; save();
      assert.equal(metadata.projectId, expectedProject.project_id); assert.equal(metadata.title, expectedProject.title);
      assert.equal(metadata.author, expectedProject.author);
      assert.deepEqual(graph.nodes.map(n => n.id).sort(), expectedProject.nodes.map(n => n.id).sort());
      assert.deepEqual(graph.edges, expectedProject.edges);
      for (const n of graph.nodes.filter(n => n.data?.scene)) {
        const expected = expectedProject.nodes.find(e => e.id === n.id); assert(expected);
        assert.equal(n.data.scene.scene_id, expected.data.scene.scene_id);
        assert.deepEqual(n.data.scene.commands, expected.data.scene.commands);
        assert.equal(n.data.scene.summary, expected.data.scene.summary);
      }
      assert.equal(c.observed.actualSummary, scene.data.scene.summary);
      await shot(which === "conflict" ? "shared-conflict-new-summary-retained" : "old-project-restored-inspector"); return c.observed;
    });
    await step("Durable target project, native migration receipt, source backup and restart idempotence are independently checked", async c => {
      const current = databaseState(), recordPath = path.join(fixture.defaultRoaming, "backend/database-migration-record.json");
      const receipt = read(recordPath), backups = originalBackups();
      c.observed = { database: current, receipt, recordPath, recordSha256: sha(recordPath), backups }; save();
      assert.equal(current.details.length, 1); assert.equal(current.summaries.length, 1);
      assert.equal(current.details[0].id, fixture.projectId);
      assert.deepEqual(current.details[0].project.nodes, expectedProject.nodes);
      assert.deepEqual(current.details[0].project.edges, expectedProject.edges);
      assert.equal(receipt.status, "MERGED"); assert.equal(receipt.sources.length, 1);
      assert.equal(receipt.fingerprints[fixture.legacy.replace(/\//g, "\\")], fixture.source.sha256);
      assert(backups.some(b => b.sha256 === fixture.source.sha256));
      if (which === "conflict") assert(receipt.conflicts.includes(fixture.projectId));
      else assert.equal(receipt.conflicts.length, 0);
      if (which === "accept-restart") {
        const prior = read(path.join(run, "accept-ui/report.json")).checks[2].detail;
        assert.equal(sha(recordPath), prior.recordSha256); assert.deepEqual(backups, prior.backups);
      }
      return c.observed;
    });
  }
  assert.equal(report.pageErrors.length, 0); report.status = "PASS";
})().catch(e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
}).finally(async () => {
  report.finishedAt = new Date().toISOString(); save(); await browser?.close();
  console.log(JSON.stringify({ status: report.status, which, checks: report.checks.length, error: report.error, out }, null, 2));
});
