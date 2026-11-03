"use strict";
// Resume the exact owned installation/data/profile from an earlier UI run.
// Native save is exercised by the real toolbar. Portable reimport below uses
// the public backend API, explicitly NOT a substitute for native file picking.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const run = path.resolve(process.argv[2] || ""), out = path.resolve(process.argv[3] || "");
assert(process.argv[2] && process.argv[3] && !fs.existsSync(out));
assert(run.startsWith("F:\\AgentVN\\QA\\") && out.startsWith("F:\\AgentVN\\QA\\"));
const prior = JSON.parse(fs.readFileSync(path.join(run, "report.json")));
assert.equal(prior.status, "BLOCKED");
assert.equal(prior.cases.filter(row => row.status === "PASS").length, 5);
assert.equal(prior.cases.filter(row => row.status === "BLOCKED").length, 1);
assert.equal(prior.cases.find(row => row.status === "BLOCKED").name,
  "native-save-normal-close-restart-and-native-portable-reopen");
fs.mkdirSync(out);
process.env.AGENTVN_TEST_PROJECT = prior.environment.AGENTVN_TEST_PROJECT;
process.env.AGENTVN_WORKSPACE_OUTPUT = out;
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], cleanup: [],
  inputReport: { path: path.join(run, "report.json"), sha256: A.sha256(fs.readFileSync(path.join(run, "report.json"))) },
  environment: { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: out },
  boundaries: { nativeSave: true, restart: "OWNED_PROCESS_STOP_AND_RESTART_SAME_DB_AND_WEBVIEW",
    portableReimport: "PUBLIC_BACKEND_API_THEN_REAL_RECENT_PROJECT_BUTTON",
    nativePicker: "BLOCKED_NOT_EXERCISED", normalWindowClose: "NOT_EXERCISED", modelRequests: 0 } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let owner, browser, page, state, pendingDownload;
const profiles = project => project.settings.runtimeUILayoutProfiles;
function stableAssets(assets, backendPort) {
  return assets.map(asset => {
    const metadata = { ...asset.metadata };
    if (typeof metadata.url === "string" && metadata.url.startsWith("http://127.0.0.1:")) {
      const value = new URL(metadata.url);
      assert.equal(value.origin, `http://127.0.0.1:${backendPort}`, "Asset must belong to this owned backend");
      metadata.url = `${value.pathname}${value.search}${value.hash}`;
    }
    return { ...asset, metadata };
  });
}
async function check(name, body) {
  report.stage = name; save(); console.log(`START ${name}`);
  const result = await body(); report.cases.push({ name, status: "PASS", ...result }); save();
}
async function connect() {
  state = owner.state; A.readInstalledSession(run);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  const deadline = Date.now() + 30000;
  while (!page && Date.now() < deadline) {
    page = browser.contexts()[0].pages().find(p => p.url().startsWith("http://tauri.localhost"));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(page); page.setDefaultTimeout(30000);
  const cdp = await browser.contexts()[0].newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
  });
}
async function openProject() {
  const resume = page.getByRole("button", { name: "继续上次编辑", exact: true });
  const recent = page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: "新 UI 独立验收" });
  await page.waitForFunction(() => !!document.querySelector(".recent-project-open:not(:disabled)"));
  if (await resume.isVisible()) await resume.click(); else await recent.click();
  await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
}
async function snapshot() { return A.projectSnapshot(state.backendPort); }
async function stop() {
  await browser?.close(); browser = undefined; page = undefined;
  if (owner) { report.cleanup.push(await owner.stop()); owner = undefined; }
}
async function verifyArchive(file, expected) {
  const bytes = fs.readFileSync(file), zip = await JSZip.loadAsync(bytes);
  const document = JSON.parse(await zip.file("project.json").async("string"));
  assert.equal(document.project_id, expected.projectId);
  assert.deepEqual(document.editor_settings.runtimeUILayoutProfiles, profiles(expected));
  assert(!JSON.stringify(document).includes("projectExportDirectories"));
  assert(!JSON.stringify(document).includes(report.downloadDirectory));
  assert.equal(document.asset_manifest.length, expected.assetManifest.length);
  const assets = [];
  for (const entry of document.asset_manifest) {
    const current = expected.assetManifest.find(a => a.asset_id === entry.asset_id); assert(current);
    const archived = await zip.file(entry.metadata.project_path).async("nodebuffer");
    assert.equal(A.sha256(archived), A.sha256(await A.assetBytes(state.backendPort, current)));
    assets.push({ id: current.asset_id, bytes: archived.length, sha256: A.sha256(archived) });
  }
  assert(assets.length >= 2, "Require original background and applied GUI bytes");
  return { path: file, sha256: A.sha256(bytes), bytes: bytes.length, assets };
}
function archiveOwnedDownload() {
  if (!pendingDownload) return;
  const { file, hash } = pendingDownload;
  assert.equal(path.dirname(file), report.downloadDirectory);
  assert.equal(A.sha256(fs.readFileSync(file)), hash, "Never remove changed download bytes");
  const destination = path.join(out, path.basename(file));
  assert(!fs.existsSync(destination), "Never overwrite an earlier artifact");
  fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
  assert.equal(A.sha256(fs.readFileSync(destination)), hash);
  fs.unlinkSync(file); pendingDownload = undefined;
  report.downloadCleanup = { status: "PASS", originalPath: file, retainedPath: destination, sha256: hash };
}
(async () => {
  owner = await startInstalledEditor(run, { restart: true }); await connect(); await openProject();
  const before = await snapshot();
  assert.equal(before.projectId, path.basename(prior.environment.AGENTVN_TEST_PROJECT) === "重构验收隔离工程.vnproj"
    ? `installed_redesign_${path.basename(run)}` : "");
  assert.equal(profiles(before).activeType, "renpy");
  const first = { ...state };
  report.installedExecutable = A.readInstalledSession(run).executable;
  await check("real-default-directory-native-save-and-portable-bytes", async () => {
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.settings"]:visible').click(); await A.settleEditor(page);
    const currentDirectory = (await page.locator('[data-help-key="settings.projectExportDirectory.current"]').innerText()).trim();
    assert(currentDirectory.includes("下载"), "Must use the product's unconfigured default, not an injected path");
    const registryPath = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      "[Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders').'{374DE290-123F-4565-9164-39C4925E467B}')"],
    { encoding: "utf8", windowsHide: true }).trim();
    assert(path.isAbsolute(registryPath) && fs.statSync(registryPath).isDirectory());
    report.downloadDirectory = path.resolve(registryPath);
    const prefix = "新_UI_独立验收_";
    const candidates = () => fs.readdirSync(registryPath)
      .filter(name => name.startsWith(prefix) && name.endsWith(".vnproj"));
    const old = candidates()
      .map(name => ({ name, sha256: A.sha256(fs.readFileSync(path.join(registryPath, name))) }));
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
    await page.getByRole("button", { name: "保存工程", exact: true }).click();
    const confirmation = page.getByTestId("project-save-confirmation"); await confirmation.waitFor();
    const additions = candidates().filter(name => !old.some(row => row.name === name));
    assert.equal(additions.length, 1);
    const file = path.resolve(registryPath, additions[0]);
    assert((await confirmation.innerText()).includes(file), "Native result must identify the actual filesystem path");
    const raw = fs.readFileSync(file), archive = await JSZip.loadAsync(raw);
    assert.equal(JSON.parse(await archive.file("project.json").async("string")).project_id, before.projectId);
    pendingDownload = { file, hash: A.sha256(raw) };
    const proof = await verifyArchive(file, before);
    for (const row of old) assert.equal(A.sha256(fs.readFileSync(path.join(registryPath, row.name))), row.sha256);
    await confirmation.getByRole("button", { name: "OK", exact: true }).click();
    archiveOwnedDownload(); report.portable = { ...proof, path: report.downloadCleanup.retainedPath };
    return { artifact: report.portable, oldPackagesUnchanged: old.length, currentDirectory };
  });
  await check("actual-editor-backend-restart-restores-layout-and-library", async () => {
    await stop(); owner = await startInstalledEditor(run, { restart: true }); await connect(); await openProject();
    assert.notEqual(state.editorPid, first.editorPid); assert.notEqual(state.backendPid, first.backendPid);
    assert.equal(state.databasePath, first.databasePath); assert.equal(state.webviewRoot, first.webviewRoot);
    const after = await snapshot();
    assert.deepEqual(profiles(after), profiles(before));
    assert.deepEqual(stableAssets(after.assetManifest, state.backendPort),
      stableAssets(before.assetManifest, first.backendPort));
    await verifyArchive(report.portable.path, after);
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
    const control = page.locator('.renpy-title-action[data-ui-component-id="title_start_button"]');
    await control.waitFor();
    assert.equal(await control.evaluate(e => getComputedStyle(e).backgroundColor), "rgb(116, 43, 89)");
    await page.getByTestId("renpy-gui-import-open").click();
    const library = page.getByTestId("renpy-gui-library");
    await library.locator("article").waitFor(); assert.equal(await library.locator("article").count(), 1);
    await page.getByRole("button", { name: "关闭导入预览", exact: true }).click();
    return { oldEditorPid: first.editorPid, newEditorPid: state.editorPid,
      oldBackendPid: first.backendPid, newBackendPid: state.backendPid, libraryEntries: 1 };
  });
  await check("public-portable-reimport-and-real-ui-retain-both-profiles-and-assets", async () => {
    const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(report.portable.path)) },
      body: fs.readFileSync(report.portable.path) });
    assert(response.ok, await response.text());
    await page.reload(); await openProject();
    const reopened = await snapshot();
    assert.equal(reopened.projectId, before.projectId); assert.deepEqual(profiles(reopened), profiles(before));
    await verifyArchive(report.portable.path, reopened);
    return { method: report.boundaries.portableReimport, artifact: report.portable };
  });
  assert.equal(report.cases.length, 3); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) {
    try {
      const cdp = await browser.contexts()[0].newCDPSession(page);
      const image = await cdp.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(out, "failure.png"), Buffer.from(image.data, "base64"));
    } catch {}
  }
}).finally(async () => {
  try { archiveOwnedDownload(); } catch (error) {
    report.downloadCleanup = { status: "FAILED", error: String(error) }; report.status = "FAILED"; process.exitCode = 1;
  }
  await stop();
  if (report.cleanup.some(row => row.editor.exitCode || row.backend.exitCode)) {
    report.status = "FAILED"; process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, stage: report.stage, error: report.error, out }));
});
