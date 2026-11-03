"use strict";
// E4-B one actual Release flow. Native inputs are performed by Computer Use,
// acknowledged with request-scoped receipts, then independently asserted here.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const A = require("./lib/installed-acceptance.cjs");

if (process.argv.includes("--help")) {
  console.log("node scripts/installed-editor-resources-flow-playwright.cjs <owned-installed-session> <fresh-output>\n"
    + "AGENTVN_TEST_PROJECT and AGENTVN_WORKSPACE_OUTPUT must identify this run's isolated fixture/output.\n"
    + "Native pickers announce NATIVE_INPUT_REQUIRED; Computer Use completes each real picker. No UI mocks.");
  process.exit(0);
}
assert(process.argv[2] && process.argv[3], "Explicit installed session and fresh evidence output required");
const runRoot = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
assert(process.env.AGENTVN_TEST_PROJECT && process.env.AGENTVN_WORKSPACE_OUTPUT,
  "Set explicit isolated AGENTVN_TEST_PROJECT and AGENTVN_WORKSPACE_OUTPUT");
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), out);
assert(A.inside(runRoot, out), "Evidence must remain inside the owned installed session");
assert(!fs.existsSync(out), `Never overwrite earlier evidence: ${out}`);
fs.mkdirSync(out, { recursive: true });
const projectFile = path.resolve(process.env.AGENTVN_TEST_PROJECT);
assert(A.inside(out, projectFile), "Fixture must be fresh and inside this run's evidence directory");
const id = `installed_resource_flow_${crypto.randomUUID().replaceAll("-", "")}`;
const title = `安装资源闭环 ${id.slice(-8)}`;
const report = { status: "RUNNING", runId: id, startedAt: new Date().toISOString(), scope: "Actual installed Release GUI/ZIP/vnproj/vncart resource flow; not final Windows/Android release acceptance",
  isolatedFixture: projectFile, output: out, cases: [], errors: [], nativeInputs: [], artifacts: [], runtimeMatrix: [] };
const saveReport = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser, page, session, state, player, playerBrowser;
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Lz4AAAAASUVORK5CYII=", "base64");
const snapshot = () => A.projectSnapshot(state.backendPort);
async function sourceAssetHashes(value) {
  return Promise.all(value.assetManifest.map(async asset => ({ assetId: asset.asset_id,
    path: asset.metadata.project_path, sha256: A.sha256(await A.assetBytes(state.backendPort, asset)) })));
}
async function saveLayout(editor) {
  await editor.locator("[data-save-state]").filter({ hasText: /保存布局|已保存/ }).first().click();
  await page.waitForFunction(() => document.querySelector('[data-save-state="saved"]'));
}
async function record(name, operation) {
  report.stage = name; saveReport();
  const details = await operation();
  report.cases.push({ name, status: "PASS", ...(details || {}) }); saveReport();
  console.log(`PASS ${name}`);
}
async function native(name, trigger, selectedPath, cancel = false) {
  const result = await A.nativeInput({ page, trigger, out, name, ownerPid: state.editorPid, selectedPath, cancel });
  report.nativeInputs.push(result); saveReport(); return result;
}
async function closePublish() {
  await A.dismissEnvironmentCompletion(page);
  const result = page.getByTestId("package-build-result-dialog");
  if (await result.isVisible().catch(() => false)) await result.getByRole("button", { name: "完成", exact: true }).click();
  const panel = page.locator(".cartridge-export-panel");
  if (await panel.isVisible().catch(() => false)) await panel.getByRole("button", { name: "关闭发布与打包", exact: true }).click();
}
async function main() {
  const installed = A.readInstalledSession(runRoot); state = installed.state;
  report.owner = state; report.exeSha256 = installed.exeSha256;
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  page = browser.contexts()[0].pages().find(candidate => candidate.url().startsWith("http://tauri.localhost"));
  assert(page, "Must test actual installed WebView, never Vite");
  page.setDefaultTimeout(45000);
  page.on("pageerror", error => report.errors.push(String(error)));
  session = await browser.contexts()[0].newCDPSession(page);
  const staleGuiDialog = page.getByTestId("renpy-gui-import-dialog");
  if (await staleGuiDialog.isVisible().catch(() => false)) {
    if (await page.getByRole("listbox").isVisible().catch(() => false)) await page.keyboard.press("Escape");
    await staleGuiDialog.getByRole("button", { name: "取消，不修改工程", exact: true }).click();
    await staleGuiDialog.waitFor({ state: "detached" });
  }
  await closePublish();
  if (await page.locator(".editor-toolbar").isVisible()) {
    await page.locator('[data-workspace-surface="edit"]:visible').click();
    await A.settleEditor(page);
    await page.getByRole("button", { name: "返回首页", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
  }
  const project = fixture(id); project.title = title;
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2), { flag: "wx" });
  report.fixtureSha256 = A.sha256(fs.readFileSync(projectFile));
  const imported = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(projectFile)) }, body: fs.readFileSync(projectFile) });
  const text = await imported.text(); assert(imported.ok, `Isolated fixture import: ${text}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: title }).first().click();
  await page.locator(".editor-toolbar").waitFor({ state: "visible" });
  await A.settleEditor(page);
  assert.equal((await snapshot()).projectId, id, "Installed UI must own this new temporary project");
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
  const editor = page.locator(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
  await editor.locator('[data-layout-type-option="renpy"]').click();
  await editor.locator(".renpy-title-editor").waitFor(); await saveLayout(editor);
  const dialog = page.getByTestId("renpy-gui-import-dialog");
  const guiSource = path.join(out, "中文 GUI 目录"); fs.mkdirSync(path.join(guiSource, "gui"), { recursive: true });
  fs.writeFileSync(path.join(guiSource, "gui.rpy"), "define gui.navigation_xpos = 73\ndefine gui.navigation_spacing = 18\n");
  fs.writeFileSync(path.join(guiSource, "gui/idle.png"), image);
  const before = await snapshot(); assert.equal(before.assetManifest.length, 0);
  await editor.getByTestId("renpy-gui-import-open").click();
  await record("native-directory-cancel-and-no-mutation", async () => {
    await native("gui-cancel", dialog.getByRole("button", { name: "选择资源目录", exact: true }), guiSource, true);
    assert.equal(await dialog.locator(".renpy-gui-import-summary").count(), 0);
    const applyAfterCancel = dialog.getByRole("button", { name: "确认应用已选项目", exact: true });
    if (await applyAfterCancel.count()) assert(await applyAfterCancel.first().isDisabled());
    A.assertProjectContentUnchanged(await snapshot(), before);
  });
  await record("native-directory-scan-map-license-library-byte-integrity", async () => {
    await native("gui-select", dialog.getByRole("button", { name: "选择资源目录", exact: true }), guiSource);
    await dialog.locator(".renpy-gui-import-summary").waitFor();
    assert.equal(await dialog.locator(".renpy-gui-import-asset-row").count(), 1);
    assert.match(await dialog.locator(".renpy-gui-import-row").filter({ hasText: "shared.x" }).innerText(), /73/);
    A.assertProjectContentUnchanged(await snapshot(), before, "Scan must not apply");
    await A.select(page, "gui/idle.png 导入操作", "收入资源包");
    const importButton = dialog.getByRole("button", { name: "确认入库，不修改工程", exact: true });
    assert(await importButton.isDisabled());
    await dialog.locator(".renpy-gui-import-license input").check();
    await importButton.click();
    const initialPack = dialog.locator('[data-testid="renpy-gui-library"] [data-pack-id]').first();
    await initialPack.waitFor();
    A.assertProjectContentUnchanged(await snapshot(), before, "Library import must not modify the project");
    await initialPack.getByRole("button", { name: "预览并选择应用", exact: true }).click();
    await dialog.getByTestId("renpy-gui-impact").waitFor();
    await A.select(page, "gui/idle.png 游戏界面用途", "标题页主视觉");
    const applyButton = dialog.getByRole("button", { name: "确认应用到当前工程", exact: true });
    assert(await applyButton.isDisabled());
    await dialog.locator(".renpy-gui-import-license input").check();
    assert(await applyButton.isEnabled());
    await applyButton.click(); await dialog.waitFor({ state: "detached" });
    await saveLayout(editor);
    const saved = await snapshot();
    assert.equal(saved.settings.runtimeUILayout.renpy.shared.x, 73);
    assert.deepEqual(saved.settings.runtimeUILayoutProfiles.profiles.agentvn, before.settings.runtimeUILayoutProfiles.profiles.agentvn);
    assert.equal(saved.assetManifest.length, 1);
    assert.deepEqual(await A.assetBytes(state.backendPort, saved.assetManifest[0]), image);
    const titleHero = saved.settings.runtimeUILayout.screens.find(screen => screen.screen_id === "title")
      ?.components.find(component => component.component_id === "title_hero");
    assert.equal(titleHero?.style?.backgroundImage, `asset:${saved.assetManifest[0].asset_id}`);
    report.saved = saved;
  });
  await record("installed-GUI-library-revision-safe-copy-and-failure-rollback", async () => {
    const first = await snapshot(); const original = first.assetManifest[0];
    const replacement = Buffer.concat([image, Buffer.from([2])]);
    const zip = new JSZip(); zip.file("gui.rpy", "define gui.navigation_xpos = 84\ndefine gui.navigation_spacing = 24\n"); zip.file("gui/idle.png", replacement);
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    async function scanZip(bytes) {
      await editor.getByTestId("renpy-gui-import-open").click();
      await dialog.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles({ name: "中文 重导入.zip", mimeType: "application/zip", buffer: bytes });
      await dialog.locator(".renpy-gui-import-summary").waitFor();
    }
    await scanZip(buffer);
    await dialog.getByLabel("资源包名称", { exact: true }).fill(`安装版 GUI 修订 ${id.slice(-8)}`);
    const revisionSource = dialog.getByRole("combobox", { name: "资源包修订来源", exact: true });
    await revisionSource.click();
    await page.getByRole("option").filter({ hasText: "从修订 1 新建修订" }).first().click();
    await A.select(page, "gui/idle.png 导入操作", "收入资源包");
    await dialog.locator(".renpy-gui-import-license input").check();
    await dialog.getByRole("button", { name: "确认入库，不修改工程", exact: true }).click();
    const revisionPack = dialog.locator('[data-testid="renpy-gui-library"] [data-pack-id]')
      .filter({ hasText: `安装版 GUI 修订 ${id.slice(-8)}` }).first();
    await revisionPack.waitFor();
    A.assertProjectContentUnchanged(await snapshot(), first);
    await revisionPack.getByRole("button", { name: "预览并选择应用", exact: true }).click();
    await dialog.getByTestId("renpy-gui-impact").waitFor();
    await dialog.locator(".renpy-gui-import-row").filter({ hasText: "shared.x" })
      .getByRole("checkbox").check();
    await dialog.locator(".renpy-gui-import-row").filter({ hasText: "shared.spacing" })
      .getByRole("checkbox").check();
    await A.select(page, "gui/idle.png 游戏界面用途", "标题页主视觉");
    await A.select(page, "gui/idle.png 导入操作", "复制为新素材");
    await dialog.locator(".renpy-gui-import-license input").check();
    await dialog.getByRole("button", { name: "确认应用到当前工程", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); await saveLayout(editor);
    const second = await snapshot();
    assert.equal(second.assetManifest.length, 2);
    const originalAfterRevision = second.assetManifest.find(asset => asset.asset_id === original.asset_id);
    assert(originalAfterRevision, "原素材必须保留，不能被修订应用覆盖");
    assert.deepEqual(await A.assetBytes(state.backendPort, originalAfterRevision), image);
    const copied = second.assetManifest.find(asset => asset.asset_id !== original.asset_id);
    assert(copied);
    assert.notEqual(copied.asset_id, original.asset_id);
    assert.deepEqual(await A.assetBytes(state.backendPort, copied), replacement);
    assert.equal(second.settings.runtimeUILayout.renpy.shared.x, 84);
    assert.deepEqual(second.settings.runtimeUILayoutProfiles.profiles.agentvn, first.settings.runtimeUILayoutProfiles.profiles.agentvn);
    report.saved = second;
    const bad = new JSZip(); bad.file("../escape.png", image, { createFolders: false });
    await editor.getByTestId("renpy-gui-import-open").click();
    const libraryCount = await dialog.locator('[data-testid="renpy-gui-library"] [data-pack-id]').count();
    await dialog.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles({
      name: "越界.zip", mimeType: "application/zip", buffer: await bad.generateAsync({ type: "nodebuffer" }),
    });
    const issues = dialog.locator(".renpy-gui-import-issues").filter({ hasText: "阻止应用的问题" });
    await issues.waitFor();
    assert.match(await issues.innerText(), /unsafe_path/);
    assert(await dialog.getByRole("button", { name: "确认入库，不修改工程", exact: true }).isDisabled());
    assert.equal(await dialog.locator('[data-testid="renpy-gui-library"] [data-pack-id]').count(), libraryCount);
    await dialog.getByRole("button", { name: "取消，不修改工程", exact: true }).click(); await dialog.waitFor({ state: "detached" });
    A.assertProjectContentUnchanged(await snapshot(), second);
  });
  await record("installed-component-library-share-scan-copy-project-isolation", async () => {
    const assetsBeforeComponent = await snapshot();
    const details = page.locator("details.renpy-personal-component-library"); if (!await details.evaluate(node => node.open)) await details.locator("summary").click();
    const library = page.getByTestId("custom-component-library"); const name = `安装组件 ${id.slice(-8)}`;
    await library.getByLabel("添加组件图片依赖", { exact: true }).setInputFiles({ name: "分享 图标.png", mimeType: "image/png", buffer: image });
    await library.getByText(/已添加 1 个图片依赖/).waitFor(); const assetId = await library.locator(".custom-component-dependencies code").innerText();
    await library.getByLabel("组件名称", { exact: true }).fill(name);
    await library.getByLabel("组件 HTML", { exact: true }).fill(`<div class="root"><span class="title" data-bind="project.title">标题</span><img class="icon" data-asset="${assetId}" aria-label="分享图标"/><button type="button" class="button" aria-label="组件打开关于" data-action="open_about">关于</button></div>`);
    await library.getByLabel("组件 CSS", { exact: true }).fill(".root { display: flex; flex-direction: column; gap: 8px; padding: 8px; }.title { font-size: 16px; color: #ffffff; }.icon { width: 32px; height: 32px; object-fit: contain; }.button { color: #ffffff; background-color: #222222; padding: 4px 8px; }");
    await library.getByTestId("component-save").click(); await library.getByText(`“${name}”已保存到本机个人组件库。`).waitFor();
    const original = library.locator(".custom-component-list li").filter({ hasText: name }); assert.equal(await original.count(), 1); await original.getByRole("checkbox").check();
    const artifact = await A.realDownload(page, session, out, library.getByTestId("component-export")); report.artifacts.push(artifact);
    const archive = await JSZip.loadAsync(fs.readFileSync(artifact.path)); const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    assert.deepEqual(Object.keys(manifest).sort(), ["components", "format", "schemaVersion"]); assert.equal(manifest.components.length, 1);
    for (const asset of manifest.components[0].assets) assert.deepEqual(await archive.file(asset.path).async("nodebuffer"), image);
    const count = await library.locator(".custom-component-list li").count(); const bad = new JSZip(); bad.file("../bad.txt", "unsafe", { createFolders: false });
    await library.getByTestId("component-import-file").setInputFiles({ name: "越界.zip", mimeType: "application/zip", buffer: await bad.generateAsync({ type: "nodebuffer" }) });
    await library.getByText(/组件包未通过检查/).waitFor(); assert.equal(await library.locator(".custom-component-list li").count(), count);
    await library.getByTestId("component-import-file").setInputFiles(artifact.path); await library.getByText(/扫描通过：1 个组件/).waitFor(); assert.equal(await library.locator(".custom-component-list li").count(), count);
    await library.getByTestId("component-confirm-import").click(); await library.getByText(/已将 1 个组件另存为本机副本/).waitFor(); assert.equal(await library.locator(".custom-component-list li").count(), count + 1);
    const copy = library.locator(".custom-component-list li").filter({ hasText: name }).filter({ hasText: "（副本）" });
    const copiedName = await copy.locator("label span").innerText(); await copy.getByRole("button", { name: `添加 ${copiedName} 到当前页面`, exact: true }).click(); await library.getByText(/已复制到当前工程页面/).waitFor();
    const projectCopies = page.locator("details.renpy-project-components"); if (!await projectCopies.evaluate(node => node.open)) await projectCopies.locator("summary").click();
    await projectCopies.locator("fieldset").filter({ hasText: copiedName }).getByLabel("height", { exact: true }).fill("32"); await saveLayout(editor);
    const saved = await snapshot(); assert.equal(saved.assetManifest.length, assetsBeforeComponent.assetManifest.length + 1);
    const addedAsset = saved.assetManifest.find(asset => !assetsBeforeComponent.assetManifest.some(before => before.asset_id === asset.asset_id));
    assert(addedAsset, "Copying the component must add its own project asset");
    assert.deepEqual(await A.assetBytes(state.backendPort, addedAsset), image);
    // Alter a personal draft without editing its immutable project copy.
    await library.getByLabel("组件名称", { exact: true }).fill(`${name} 库修改`); await library.getByLabel("组件 HTML", { exact: true }).fill('<div class="root"><span>库中不同内容</span></div>');
    await library.getByTestId("component-save").click(); await library.getByText(`“${name} 库修改”已保存到本机个人组件库。`).waitFor();
    assert.deepEqual((await snapshot()).settings.runtimeUILayoutProfiles, saved.settings.runtimeUILayoutProfiles);
    report.saved = saved;
  });
  await record("installed-Runtime-cold-entry-high-resolution-matrix", async () => {
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await page.locator(".renpy-title-editor .runtime-layout-sidebar").getByRole("button", { name: "标题主页", exact: true }).click();
      await page.getByRole("button", { name: "布局编辑", exact: true }).click();
      await page.locator('iframe[title="Ren\'Py（进阶）实际页面预览"]').waitFor({ state: "detached" });
      await page.getByRole("button", { name: "实际 Runtime", exact: true }).click();
      await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
      const frame = page.frames().find(candidate => candidate.parentFrame() && candidate.url().includes("gamecli-preview")); assert(frame);
      await A.settleRuntime(frame); const custom = frame.getByTestId("runtime-custom-component"); assert.equal(await custom.count(), 1);
      const metrics = await custom.evaluate(async node => {
        const image = node.querySelector("img"); await image.decode(); const button = node.querySelector("button"), rect = button.getBoundingClientRect(), box = node.getBoundingClientRect();
        return { title: node.querySelector('[data-binding="project.title"]').textContent, imageWidth: image.naturalWidth,
          hit: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)), rect: rect.toJSON(), box: box.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert.equal(metrics.title, title); assert(metrics.imageWidth > 0 && metrics.hit && metrics.overflow <= 1);
      assert(metrics.rect.top >= metrics.box.top && metrics.rect.bottom <= metrics.box.bottom);
      await custom.getByRole("button", { name: "组件打开关于", exact: true }).click(); await frame.getByTestId("about-screen").waitFor(); await A.settleRuntime(frame);
      report.runtimeMatrix.push({ width, height, dpr, reduced, metrics }); saveReport();
      (report.runtimeScreenshots ||= []).push(await captureInstalledWebview(page, session,
        path.join(out, `runtime-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`),
        { width, height, dpr, reduced }));
    }
    assert.equal(report.runtimeMatrix.length, 12);
  });
  await record("native-vnproj-directory-save-home-native-reopen-and-resource-bytes", async () => {
    await session.send("Emulation.clearDeviceMetricsOverride"); await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator('[data-help-key="advanced.tab.settings"]:visible').click(); await A.settleEditor(page);
    const directory = path.join(out, "中文 工程保存目录"); fs.mkdirSync(directory);
    await native("project-save-directory", page.locator('[data-help-key="settings.projectExportDirectory.choose"]:visible'), directory);
    await page.waitForFunction(value => document.querySelector('[data-help-key="settings.projectExportDirectory.current"]')?.textContent?.trim() === value, directory);
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
    await page.getByRole("button", { name: "保存工程", exact: true }).click(); const success = page.getByTestId("project-save-confirmation"); await success.waitFor();
    const names = fs.readdirSync(directory).filter(name => name.endsWith(".vnproj")); assert.equal(names.length, 1);
    const file = path.join(directory, names[0]), bytes = fs.readFileSync(file), zip = await JSZip.loadAsync(bytes);
    const project = JSON.parse(await zip.file("project.json").async("string")); const saved = await snapshot();
    assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, saved.settings.runtimeUILayoutProfiles);
    assert(!JSON.stringify(project).includes("projectExportDirectories")); const hashes = await sourceAssetHashes(saved);
    for (const asset of project.asset_manifest) assert.equal(A.sha256(await zip.file(asset.metadata.project_path).async("nodebuffer")), hashes.find(item => item.assetId === asset.asset_id).sha256);
    report.projectArtifact = { path: file, sha256: A.sha256(bytes), bytes: bytes.length }; report.sourceAssets = hashes;
    await success.getByRole("button", { name: "OK", exact: true }).click(); await page.getByRole("button", { name: "返回首页", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
    await native("project-open", page.getByRole("button", { name: "导入项目", exact: true }), file);
    await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
    const reopened = await snapshot(); assert.deepEqual(reopened.settings.runtimeUILayoutProfiles, saved.settings.runtimeUILayoutProfiles);
    assert.deepEqual(reopened.assetManifest.map(asset => asset.asset_id).sort(), saved.assetManifest.map(asset => asset.asset_id).sort());
    assert.deepEqual(await sourceAssetHashes(reopened), hashes);
    assert.equal(A.sha256(fs.readFileSync(file)), report.projectArtifact.sha256);
  });
  await record("actual-installed-cartridge-download-layout-and-dependency-byte-integrity", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); const publish = page.locator(".cartridge-export-panel"); await publish.waitFor();
    await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
    await A.dismissEnvironmentCompletion(page);
    await publish.locator('[data-help-key="package.mode"]').click(); await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    await publish.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
    const warning = publish.getByRole("checkbox", { name: /我已检查全部警告/ }); if (await warning.count()) await warning.check();
    const artifact = await A.realDownload(page, session, out, publish.locator(".package-primary-action")); report.artifacts.push(artifact);
    const zip = await JSZip.loadAsync(fs.readFileSync(artifact.path)); const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer"); const layout = JSON.parse(layoutBytes.toString("utf8"));
    assert.equal(layout.layout_type, "renpy"); assert.deepEqual(layout.renpy, report.saved.settings.runtimeUILayoutProfiles.profiles.renpy.renpy);
    assert.equal(layout.screens.find(screen => screen.screen_id === "title").components.filter(component => component.component_type === "custom_component").length, 1);
    for (const asset of manifest.assets) assert.equal(A.sha256(await zip.file(asset.path).async("nodebuffer")), report.sourceAssets.find(item => item.assetId === asset.asset_id).sha256);
    assert(manifest.assets.some(asset => asset.asset_id === report.saved.assetManifest.find(item => item.metadata.tags?.includes("custom_component")).asset_id));
    report.cartridgeArtifact = { ...artifact, layoutSha256: A.sha256(layoutBytes), title, gameId: id };
    await page.screenshot({ path: path.join(out, "cartridge-export.png") });
  });
  assert.equal(report.cases.length, 7, "Require the complete nonempty resource flow, not partial/zero PASS");
  assert.equal(A.sha256(fs.readFileSync(projectFile)), report.fixtureSha256); assert.deepEqual(report.errors, []);
  report.status = "PASS";
}
main().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
}).finally(async () => {
  if (page && report.status === "FAILED") {
    const dialog = page.getByTestId("renpy-gui-import-dialog");
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole("button", { name: "取消，不修改工程", exact: true }).click().catch(() => {});
    }
  }
  if (session) { await session.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    await session.send("Browser.setDownloadBehavior", { behavior: "default" }).catch(() => {}); await session.detach().catch(() => {}); }
  await browser?.close(); report.finishedAt = new Date().toISOString(); saveReport();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, runtimeMatrix: report.runtimeMatrix.length, error: report.error, out }));
});
