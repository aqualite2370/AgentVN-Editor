"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const { settleEditor, assetBytes, dismissEnvironmentCompletion, realDownload } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-video-20261018-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const destination = process.argv[2];
const exportOnly = process.argv[3] === "--export-only";
assert(destination && !fs.existsSync(destination)); fs.mkdirSync(destination);
const launch = read(path.join(run, "launch.json")), fixture = read(path.join(run, "fixtures.json"));
const fresh = fixture.videos.find(v => v.version === "new"), old = fixture.videos.find(v => v.version === "old");
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], screenshots: [], error: null,
  scope: "REAL_INSTALLED_UI_REPLACE_SAVE_REOPEN_AND_CARTRIDGE_EXPORT; fixture seed via actual backend, native import NOT_RUN",
  realModelRequests: 0, project: fixture.projectId,
  environment: { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: process.env.AGENTVN_WORKSPACE_OUTPUT } };
let browser, page, cdp;
function check(name, ok, detail) { report.checks.push({ name, status: ok ? "PASS" : "FAILED", detail }); assert(ok, name); }
async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, `${name}.png`),
  { width: 1920, height: 1080, dpr: 1, reduced: false })); }
async function state() {
  return page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), g = window.__AGENTVN_EDITOR_STORE__.getState();
    return { id: p.projectId, assets: p.assetManifest, folders: p.settings.assetLibrary, nodes: g.nodes, edges: g.edges };
  });
}
async function library() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.library"]:visible').click(); await settleEditor(page);
  await page.getByRole("button", { name: /原文件夹/ }).first().click();
}
async function payload(zip, doc, kind) {
  const asset = (kind === "project" ? doc.asset_manifest : doc.assets).find(a => a.asset_id === "qa_video");
  assert(asset); const p = kind === "project" ? asset.metadata.project_path : asset.path;
  const bytes = await zip.file(p).async("nodebuffer"); assert.equal(sha(bytes), fresh.sha256);
  for (const entry of Object.values(zip.files).filter(f => !f.dir))
    assert.notEqual(sha(await entry.async("nodebuffer")), old.sha256, `Old video retained: ${entry.name}`);
  return { path: p, sha256: sha(bytes), bytes: bytes.length };
}
async function exportCartridge() {
  await dismissEnvironmentCompletion(page);
  if (!(await page.locator('[data-help-key="package.mode"]').isVisible())) {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
  }
  await dismissEnvironmentCompletion(page);
  await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warnings.isVisible()) await warnings.click();
  const confirm = page.locator('[data-help-key="package.confirmWarnings"]'); if (await confirm.isVisible()) await confirm.check();
  const output = path.join(path.dirname(fixture.input), "exported-cartridge"); assert(!fs.existsSync(output)); fs.mkdirSync(output);
  report.cartridge = await realDownload(page, cdp, output, page.locator('[data-help-key="package.export"]'));
  const cartridgeZip = await JSZip.loadAsync(fs.readFileSync(report.cartridge.path));
  const manifest = JSON.parse(await cartridgeZip.file("manifest.json").async("string"));
  assert.equal(manifest.game_id, fixture.projectId);
  report.cartridge.video = await payload(cartridgeZip, manifest, "cartridge");
  check("Actual publish UI exports exact replacement bytes for native player consumption", true, report.cartridge);
  await shot("actual-export-complete");
}
(async () => {
  assert.equal(report.environment.AGENTVN_TEST_PROJECT, fixture.input);
  assert.equal(report.environment.AGENTVN_WORKSPACE_OUTPUT, run);
  assert.equal(sha(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  if (!exportOnly) {
    const seed = await fetch("http://127.0.0.1:8278/api/project/projects/import", { method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(fixture.input)) },
      body: fs.readFileSync(fixture.input), signal: AbortSignal.timeout(30000) });
    const data = await seed.json(); assert(seed.ok && data.ok && data.data.project_id === fixture.projectId);
    report.fixtureSeed = { method: "CONTROLLED_REAL_BACKEND_NOT_NATIVE_PICKER", inputSha256: fixture.inputSha256 };
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(30000); cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (exportOnly) {
    const prior = read(path.join(run, "ui-01/report.json"));
    assert.equal(prior.status, "FAILED"); assert.equal(prior.checks.length, 4);
    assert(prior.checks.every(c => c.status === "PASS"));
    const current = await state(); assert.equal(current.id, fixture.projectId);
    assert.equal(sha(await assetBytes(8278, current.assets.find(a => a.asset_id === "qa_video"))), fresh.sha256);
    report.continuation = { from: path.join(run, "ui-01/report.json"),
      reason: "Original export click blocked by asynchronously completed environment dialog; original FAILED retained",
      productChanges: 0, noRepeatedSeedOrReplacement: true };
    await exportCartridge(); report.status = "PASS"; return;
  }
  await page.reload();
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await library();
  const before = await state(); assert.equal(before.id, fixture.projectId);
  const original = before.assets.find(a => a.asset_id === "qa_video");
  assert.equal(sha(await assetBytes(8278, original)), old.sha256);
  const card = page.locator('.asset-library-card[data-asset-id="qa_video"]');
  await card.scrollIntoViewIfNeeded(); await card.locator('[data-help-key="asset.card.menu"]').click();
  await card.getByRole("menuitem", { name: "替换文件", exact: true }).click();
  await page.locator('[data-help-key="asset.replace.file"]').setInputFiles(fresh.path);
  const dialog = page.getByRole("dialog", { name: "确认替换素材" }); await dialog.waitFor();
  await shot("replace-confirmation");
  await dialog.getByRole("button", { name: "确认替换", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
  const after = await state(), changed = after.assets.find(a => a.asset_id === "qa_video");
  assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.edges, before.edges); assert.deepEqual(after.folders, before.folders);
  assert.deepEqual(after.assets.filter(a => a.asset_id !== "qa_video"), before.assets.filter(a => a.asset_id !== "qa_video"));
  check("Real installed replacement changes exact video bytes, not identities, references or other assets",
    changed.asset_id === original.asset_id && changed.asset_type === original.asset_type
    && changed.metadata.display_name === original.metadata.display_name && sha(await assetBytes(8278, changed)) === fresh.sha256);
  check("New video technical metadata retains real multiframe duration", changed.metadata.width === 480
    && changed.metadata.height === 270 && changed.metadata.duration_ms > 1000, {
      width: changed.metadata.width, height: changed.metadata.height, duration_ms: changed.metadata.duration_ms });
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
  const downloads = "C:/Users/1/Downloads", existing = new Set(fs.readdirSync(downloads));
  await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
  const savedDialog = page.getByTestId("project-save-confirmation"); await savedDialog.waitFor({ timeout: 60000 });
  const files = fs.readdirSync(downloads).filter(f => !existing.has(f) && f.includes(fixture.title) && f.endsWith(".vnproj"));
  assert.equal(files.length, 1);
  const native = path.join(downloads, files[0]), retained = path.join(path.dirname(fixture.input), "视频替换后保存.vnproj");
  fs.copyFileSync(native, retained, fs.constants.COPYFILE_EXCL);
  const zip = await JSZip.loadAsync(fs.readFileSync(retained));
  report.package = { native, retained, sha256: sha(fs.readFileSync(retained)),
    video: await payload(zip, JSON.parse(await zip.file("project.json").async("string")), "project") };
  check("Actual native saved project contains new multiframe video and no original video", true, report.package);
  await savedDialog.getByRole("button", { name: "OK", exact: true }).click();
  await page.getByRole("button", { name: "返回首页", exact: true }).click(); await settleEditor(page);
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  const reopened = await state();
  check("Homepage reopen preserves actual replacement bytes",
    reopened.id === fixture.projectId && sha(await assetBytes(8278, reopened.assets.find(a => a.asset_id === "qa_video"))) === fresh.sha256);
  await exportCartridge(); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) { report.failureText = await page.locator("body").innerText().catch(() => ""); await shot("failure").catch(() => {}); }
}).finally(async () => {
  await browser?.close().catch(() => {}); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error, destination }, null, 2));
});
