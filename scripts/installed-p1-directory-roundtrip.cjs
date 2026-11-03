"use strict";
// Run after restarting the owned installed Editor/backend with the same isolated
// DB and WebView profile. All project switching uses actual user-facing buttons.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
assert(process.argv[2] && process.argv[3] && process.argv[4],
  "node script <installed-session> <passing-p1-report> <fresh-output>");
const runRoot = path.resolve(process.argv[2]), priorFile = path.resolve(process.argv[3]), out = path.resolve(process.argv[4]);
assert(A.inside(runRoot, priorFile) && A.inside(runRoot, out) && !fs.existsSync(out));
assert(process.env.AGENTVN_TEST_PROJECT && path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || "") === out,
  "Explicit isolated AGENTVN_TEST_PROJECT and AGENTVN_WORKSPACE_OUTPUT required");
assert(A.inside(runRoot, process.env.AGENTVN_TEST_PROJECT) && fs.existsSync(process.env.AGENTVN_TEST_PROJECT));
const prior = JSON.parse(fs.readFileSync(priorFile, "utf8"));
assert.equal(prior.status, "PASS");
fs.mkdirSync(out);
const report = { status: "RUNNING", scope: "actual installed restart, per-project directory and native package roundtrip",
  priorFile, priorSha256: A.sha256(fs.readFileSync(priorFile)), cases: [], errors: [],
  environment: { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: out } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser, page;
async function check(name, action) {
  report.stage = name; save();
  const details = await action();
  report.cases.push({ name, status: "PASS", ...details }); save();
}
async function home() {
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
  await page.getByRole("button", { name: "返回首页", exact: true }).click(); await A.settleEditor(page);
  await page.getByLabel("创建或打开项目").waitFor();
}
async function openOriginal() {
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: prior.before.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
  assert.equal((await A.projectSnapshot(report.owner.backendPort)).projectId, prior.before.projectId);
}
async function settings() {
  await page.locator('[data-workspace-surface="options"]:visible').click(); await A.settleEditor(page);
  await page.locator('[data-help-key="advanced.tab.settings"]:visible').click(); await A.settleEditor(page);
}
(async () => {
  try {
    const { state } = A.readInstalledSession(runRoot); report.owner = state;
    assert.notEqual(state.editorPid, prior.owner.editorPid, "Require an actual Editor restart");
    assert.notEqual(state.backendPid, prior.owner.backendPid, "Require an actual backend restart");
    assert.equal(state.webviewRoot, prior.owner.webviewRoot);
    assert.equal(state.databasePath, prior.owner.databasePath);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
    page = browser.contexts()[0].pages().find(p => p.url().startsWith("http://tauri.localhost"));
    assert(page); page.setDefaultTimeout(45000);
    page.on("pageerror", error => report.errors.push(String(error)));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    if (await page.locator(".editor-toolbar").isVisible()) await home();
    await openOriginal();
    await check("restart-restores-project-directory-and-replacement-bytes", async () => {
      await settings();
      assert.equal((await page.locator('[data-help-key="settings.projectExportDirectory.current"]').innerText()).trim(), prior.directory);
      const project = await A.projectSnapshot(state.backendPort);
      const portableBytes = fs.readFileSync(prior.projectArtifacts[0].path);
      assert.equal(A.sha256(portableBytes), prior.projectArtifacts[0].sha256);
      const portable = await JSZip.loadAsync(portableBytes);
      const expected = JSON.parse(await portable.file("project.json").async("string"));
      assert.equal(project.assetManifest.length, expected.asset_manifest.length);
      for (const asset of project.assetManifest) {
        const priorAsset = expected.asset_manifest.find(item => item.asset_id === asset.asset_id);
        assert(priorAsset);
        const archived = await portable.file(priorAsset.metadata.project_path).async("nodebuffer");
        assert.equal(A.sha256(await A.assetBytes(state.backendPort, asset)), A.sha256(archived));
      }
      await page.screenshot({ path: path.join(out, "directory-after-restart.png") });
      return { directory: prior.directory, projectId: project.projectId, assets: project.assetManifest.map(asset => asset.asset_id) };
    });
    await check("switch-new-project-default-and-return-original-directory", async () => {
      await home();
      await page.getByLabel("创建或打开项目").getByRole("button", { name: "新建项目", exact: true }).click();
      await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
      const other = await A.projectSnapshot(state.backendPort); assert.notEqual(other.projectId, prior.before.projectId);
      await settings();
      const label = await page.locator('[data-help-key="settings.projectExportDirectory.current"]').innerText();
      assert(label.includes("下载") && !label.includes(prior.directory), "A new project must not inherit another project's directory");
      const map = await page.evaluate(() => JSON.parse(localStorage.getItem("agentvn.projectExportDirectories.v1") || "{}"));
      assert.equal(map[other.projectId], undefined); assert.equal(map[prior.before.projectId], prior.directory);
      await home(); await openOriginal(); await settings();
      assert.equal((await page.locator('[data-help-key="settings.projectExportDirectory.current"]').innerText()).trim(), prior.directory);
      return { otherProjectId: other.projectId, otherDirectoryLabel: label, originalDirectory: prior.directory };
    });
    await check("after-restart-native-save-keeps-old-files-and-portable-new-bytes", async () => {
      await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
      const previous = fs.readdirSync(prior.directory).filter(name => name.endsWith(".vnproj"));
      const old = previous.map(name => ({ name, hash: A.sha256(fs.readFileSync(path.join(prior.directory, name))) }));
      await page.getByRole("button", { name: "保存工程", exact: true }).click();
      const success = page.getByTestId("project-save-confirmation"); await success.waitFor();
      const added = fs.readdirSync(prior.directory).filter(name => name.endsWith(".vnproj") && !previous.includes(name));
      assert.equal(added.length, 1);
      for (const item of old) assert.equal(A.sha256(fs.readFileSync(path.join(prior.directory, item.name))), item.hash);
      const file = path.join(prior.directory, added[0]), bytes = fs.readFileSync(file), zip = await JSZip.loadAsync(bytes);
      const project = JSON.parse(await zip.file("project.json").async("string"));
      assert.equal(project.project_id, prior.before.projectId);
      assert(!JSON.stringify(project).includes("projectExportDirectories"));
      const current = await A.projectSnapshot(state.backendPort);
      for (const asset of project.asset_manifest) {
        const packaged = await zip.file(asset.metadata.project_path).async("nodebuffer");
        assert.equal(A.sha256(packaged), A.sha256(await A.assetBytes(state.backendPort, current.assetManifest.find(item => item.asset_id === asset.asset_id))));
      }
      await success.getByRole("button", { name: "OK", exact: true }).click();
      report.projectArtifact = { path: file, sha256: A.sha256(bytes), bytes: bytes.length };
      return { oldFiles: old, artifact: report.projectArtifact };
    });
    assert.equal(report.cases.length, 3); assert.deepEqual(report.errors, []); report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
    await page?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  } finally {
    await browser?.close(); save(); console.log(JSON.stringify({ status: report.status, stage: report.stage, error: report.error, out }));
  }
})();
