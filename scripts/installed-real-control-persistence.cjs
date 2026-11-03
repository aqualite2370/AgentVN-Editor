"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const A = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");

const runRoot = path.resolve(process.argv[2] || "");
assert(process.argv[2] && A.inside("F:/AgentVN/QA", runRoot));
const originalFile = path.join(runRoot, "session-report.json");
const original = JSON.parse(fs.readFileSync(originalFile, "utf8"));
const originalAuthor = JSON.parse(fs.readFileSync(original.creationReport.path, "utf8"));
assert.equal(originalAuthor.status, "PASS");
const out = path.join(runRoot, "persistence-followup");
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const fixture = JSON.parse(fs.readFileSync(path.join(runRoot, "fixture.vnproj"), "utf8"));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), modelRequests: 0,
  productChanges: 0, builds: 0, cases: [], screenshots: [], cleanups: [],
  scope: "Same installed Editor process restart, real portable save and fresh database reimport",
  originalReport: { path: originalFile, sha256: A.sha256(fs.readFileSync(originalFile)) },
  boundaries: ["Owned process termination, not normal native close",
    "Fresh database portable import through public backend API, then real UI reopen; not native file chooser",
    "Reuse previous display matrix; this follow-up uses 1080p DPR1 only"] };
let owner, browser, page, cdp, savedDownload;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stage(name, fn) {
  const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  await fn(); row.status = "PASS"; save();
}
async function start(sessionRoot) {
  owner = await startInstalledEditor(sessionRoot);
  assert.equal(A.sha256(fs.readFileSync(path.join(owner.state.installRoot, "agentvn-editor.exe"))), original.editorSha256);
  assert.equal(A.sha256(fs.readFileSync(path.join(owner.state.installRoot, "creator-backend.exe"))), original.backendSha256);
  (report.launches ||= []).push(owner.state); save();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${owner.state.cdpPort}`);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    page = browser.contexts().flatMap(context => context.pages()).find(p => p.url().includes("tauri.localhost"));
    if (page) break; await pause(100);
  }
  assert(page); page.setDefaultTimeout(30000);
  page.on("request", request => {
    if (request.method() === "POST" && /\/api\/assistant\/(query|creation\/processes)$/.test(new URL(request.url()).pathname)) {
      report.modelRequests++; save();
    }
  });
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
}
async function open() {
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: fixture.title }).first().click();
  await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
}
async function screenshot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, name),
    { width: 1920, height: 1080, dpr: 1, reduced: false }));
}
function verifyMetadata(metadata) {
  assert.equal(metadata.projectId, fixture.project_id);
  const layout = metadata.settings.runtimeUILayout;
  const edited = layout.screens.flatMap(screen => screen.components).filter(component => component.label === "开始创作");
  assert.equal(layout.layout_type, "renpy"); assert.equal(edited.length, 1);
  assert.deepEqual(edited[0].rect, originalAuthor.requests[0].authorizedTargets[0].rect);
  return edited[0];
}
async function stop() {
  await browser?.close().catch(() => {}); browser = null;
  if (owner) { report.cleanups.push(await owner.stop()); owner = null; save(); }
}
(async () => {
  let initial;
  await stage("real-editor-and-backend-restart-keep-reviewed-label-without-provider-secret", async () => {
    await start(runRoot); await open();
    const response = await fetch(`http://127.0.0.1:${owner.state.backendPort}/api/project/state`);
    assert(response.ok); const state = (await response.json()).data;
    assert.deepEqual(state.provider_secrets, {});
    initial = state.project_metadata; report.editedControl = verifyMetadata(initial);
    await screenshot("after-actual-process-restart.png");
  });
  await stage("real-ui-portable-save-keeps-both-layouts-and-no-model-credentials", async () => {
    const downloads = path.join(process.env.USERPROFILE, "Downloads");
    const before = new Set(fs.readdirSync(downloads));
    await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
    const confirmation = page.getByTestId("project-save-confirmation"); await confirmation.waitFor();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const candidates = fs.readdirSync(downloads).filter(name => !before.has(name) && name.endsWith(".vnproj"));
      assert(candidates.length <= 1, "Ambiguous download ownership; do not touch unrelated files");
      if (candidates.length === 1) { savedDownload = path.join(downloads, candidates[0]); break; }
      await pause(150);
    }
    assert(savedDownload);
    const bytes = fs.readFileSync(savedDownload);
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    const portable = JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(portable.project_id, fixture.project_id);
    assert.deepEqual(portable.editor_settings.runtimeUILayout, initial.settings.runtimeUILayout);
    assert.deepEqual(portable.editor_settings.runtimeUILayoutProfiles, initial.settings.runtimeUILayoutProfiles);
    assert(!/"provider_secrets"\s*:|"api_key"\s*:/.test(JSON.stringify(portable)));
    const saved = path.join(out, "真实控件修改保存后的工程.vnproj");
    fs.writeFileSync(saved, bytes, { flag: "wx" });
    report.portable = { path: saved, sha256: A.sha256(bytes), bytes: bytes.length };
    await confirmation.getByRole("button", { name: "OK", exact: true }).click();
    assert.equal(A.sha256(fs.readFileSync(savedDownload)), report.portable.sha256);
    fs.unlinkSync(savedDownload);
    report.downloadCleanup = { removed: savedDownload, archivedAt: saved, userFilesDeleted: 0 };
    savedDownload = null;
    await stop();
  });
  await stage("fresh-installed-database-public-import-and-real-ui-reopen-preserve-edit", async () => {
    const fresh = path.join(out, "fresh-session"); fs.mkdirSync(fresh);
    fs.copyFileSync(path.join(runRoot, "installer-resource-report.json"), path.join(fresh, "installer-resource-report.json"), fs.constants.COPYFILE_EXCL);
    await start(fresh);
    const imported = await fetch(`http://127.0.0.1:${owner.state.backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(report.portable.path)) },
      body: fs.readFileSync(report.portable.path), signal: AbortSignal.timeout(30000),
    });
    assert(imported.ok); assert.equal((await imported.json()).data.project_id, fixture.project_id);
    await page.reload({ waitUntil: "domcontentloaded" }); await open();
    const metadata = await A.projectSnapshot(owner.state.backendPort);
    verifyMetadata(metadata);
    assert.deepEqual(metadata.settings.runtimeUILayoutProfiles, initial.settings.runtimeUILayoutProfiles);
    await screenshot("fresh-database-portable-reopen.png");
  });
  assert.equal(report.cases.length, 3); assert.equal(report.modelRequests, 0);
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  try { await stop(); }
  catch (error) { report.status = "FAILED"; report.cleanupError = String(error); process.exitCode = 1; }
  if (savedDownload) report.unfinishedDownload = savedDownload;
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, modelRequests: report.modelRequests, out }));
});
