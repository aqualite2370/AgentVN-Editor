"use strict";
// Native portable save -> real UI reimport -> cartridge export of safe controls.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const A = require("./lib/installed-acceptance.cjs");
const { until, ps } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
assert.equal(process.argv[2], "54");
const root = path.resolve(__dirname, ".."), out = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-54";
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const priorFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-53/report.json";
const prior = JSON.parse(fs.readFileSync(priorFile, "utf8"));
const auditFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/control-author-audit-01/report.json";
assert.equal(prior.status, "PASS");
assert.equal(JSON.parse(fs.readFileSync(auditFile, "utf8")).status, "PASS");
assert.equal(sha(prior.fixture.path), prior.fixture.sha256);
const project = JSON.parse(fs.readFileSync(prior.fixture.path, "utf8"));
project.editor_settings.runtimeUILayoutProfiles = structuredClone(prior.profiles);
project.editor_settings.runtimeUILayout = structuredClone(prior.profiles.profiles.renpy);
const input = path.join(out, "真实作者配置续接工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const installationFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], screenshots: [], errors: [],
  launches: [], cleanups: [], modelRequests: 0, productChanges: 0, builds: 0,
  installation: installationFile, priorAuthor: desc(priorFile), priorAudit: desc(auditFile), input: desc(input),
  scope: "INSTALLED_NATIVE_PORTABLE_SAVE_UI_REOPEN_AND_FRESH_CARTRIDGE_SAFE_CONTROLS_NOT_PLAYER_OR_ANDROID",
  fixtureBoundary: "Controlled copy of previously UI-authored profiles; new About code edit and all subsequent save/reopen/export use actual UI" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedReleaseSession({ installationFile, out, input, report, save });
let page, protectedCache = false;
const aboutHtml = '<span class="root"><span class="body"><slot name="content"></slot></span></span>';
const aboutCss = ".root { background-color: #315b72; border-radius: 6px; } .body { color: #f6f8ff; }";
const component = (profiles, id) => profiles.profiles.renpy.screens.find(s => s.screen_id === "title")
  .components.find(c => c.component_id === id);
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { windowsHide: true, encoding: "utf8", timeout: 30000 });
  (report.cache ??= []).push({ action, exitCode: r.status, stdout: r.stdout, stderr: r.stderr }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function stage(name, fn) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.cases.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; console.log("PASS " + name); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { row.finishedAt = new Date().toISOString(); save(); }
}
const click = async l => { await l.scrollIntoViewIfNeeded(); await l.click(); };
async function layout() {
  await click(page.locator('[data-workspace-surface="options"]:visible'));
  await click(page.locator('[data-help-key="advanced.tab.layout"]:visible'));
  await page.getByTestId("renpy-title-editor").waitFor(); await A.settleEditor(page);
}
(async () => {
  save(); cache("SelfTest"); cache("Prepare"); protectedCache = true; page = await host.start();
  await stage("Public isolated import of actual authored profiles; real About control authoring", async () => {
    const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input),
      signal: AbortSignal.timeout(30000) });
    const result = await r.json(); assert(r.ok && result.ok && result.data.project_id === project.project_id);
    await page.reload(); await page.locator(".project-home").waitFor();
    await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }));
    await A.settleEditor(page); await layout();
    await click(page.getByTestId("renpy-title-static-preview-toggle"));
    await click(page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_about_button"]'));
    assert(await page.getByRole("checkbox", { name: "Ren’Py进阶代码编辑", exact: true }).isChecked());
    await click(page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }));
    await page.getByRole("textbox", { name: "当前控件 HTML", exact: true }).fill(aboutHtml);
    await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(aboutCss);
    await page.waitForFunction(() => getComputedStyle(document.querySelector(
      '.renpy-editor-preview .renpy-title-action[data-ui-component-id="title_about_button"]')).backgroundColor === "rgb(49, 91, 114)");
    await click(page.locator('[data-help-key="layout.save"]:visible'));
    await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
    report.profiles = (await A.projectSnapshot(host.current.ports[0])).settings.runtimeUILayoutProfiles;
    assert.deepEqual(report.profiles.profiles.agentvn, prior.profiles.profiles.agentvn);
    assert.deepEqual(component(report.profiles, "title_start_button"), component(prior.profiles, "title_start_button"));
    assert.equal(component(report.profiles, "title_about_button").presentation.html, aboutHtml);
    assert.equal(component(report.profiles, "title_about_button").presentation.css, aboutCss);
    return { aboutHtml, aboutCss, otherLayoutAndStartUnchanged: true };
  });
  await stage("Actual toolbar native portable save and archived original project/image bytes", async () => {
    await click(page.locator('[data-workspace-surface="edit"]:visible')); await A.settleEditor(page);
    const started = Date.now();
    await click(page.getByRole("button", { name: "保存工程", exact: true }));
    const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor({ timeout: 60000 });
    const text = await dialog.innerText(), native = /工程已保存到：([^\r\n]+\.vnproj)/.exec(text)?.[1];
    assert(native && path.isAbsolute(native), "Must be a real native save, not browser download");
    const downloads = ps("$v=(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders').'{374DE290-123F-4565-9164-39C4925E467B}';[Environment]::ExpandEnvironmentVariables($v)");
    assert.equal(path.resolve(path.dirname(native)).toLowerCase(), path.resolve(downloads).toLowerCase());
    assert(path.basename(native).includes(project.title));
    const stat = fs.statSync(native); assert(stat.birthtimeMs >= started - 2000 && stat.mtimeMs >= started - 2000);
    const archive = path.join(out, "真实原生保存工程.vnproj");
    fs.copyFileSync(native, archive, fs.constants.COPYFILE_EXCL); assert.equal(sha(archive), sha(native));
    const zip = await JSZip.loadAsync(fs.readFileSync(archive), { checkCRC32: true });
    const document = JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(document.project_id, project.project_id);
    assert.deepEqual(document.editor_settings.runtimeUILayoutProfiles, report.profiles);
    const asset = document.asset_manifest.find(a => a.asset_id === "qa-control-image"); assert(asset?.metadata.project_path);
    const expected = Buffer.from(project.asset_manifest[0].metadata.data_url.split(",")[1], "base64");
    assert.deepEqual(await zip.file(asset.metadata.project_path).async("nodebuffer"), expected);
    assert(!JSON.stringify(document).includes("projectExportDirectories"));
    report.portable = { ...desc(archive), originalNativePath: native, originalGeneratedAt: stat.mtime.toISOString(),
      archiveSameBytes: true, assetPath: asset.metadata.project_path, nativeCleanupStatus: "PENDING" };
    save(); await host.shot("native-project-save");
    await click(dialog.getByRole("button", { name: "OK", exact: true }));
    return report.portable;
  });
  await stage("Real homepage portable-file import restores both layout configurations and code", async () => {
    await click(page.locator('[data-help-key="toolbar.home"]'));
    await page.locator(".project-home").waitFor();
    await page.locator(".project-import-button input").first().setInputFiles(report.portable.path);
    await page.locator(".editor-toolbar").waitFor({ timeout: 45000 }); await A.settleEditor(page);
    const state = await A.projectSnapshot(host.current.ports[0]);
    assert.deepEqual(state.settings.runtimeUILayoutProfiles, report.profiles);
    await layout(); await click(page.getByTestId("renpy-title-static-preview-toggle"));
    const start = page.locator('.renpy-editor-preview .renpy-title-action[data-ui-component-id="title_start_button"]');
    const about = page.locator('.renpy-editor-preview .renpy-title-action[data-ui-component-id="title_about_button"]');
    assert.equal(await start.evaluate(n => getComputedStyle(n).backgroundColor), "rgb(127, 54, 100)");
    assert.equal(await about.evaluate(n => getComputedStyle(n).backgroundColor), "rgb(49, 91, 114)");
    assert.equal(await about.getAttribute("data-control-slot-count"), "1");
    await host.shot("portable-reopened-code");
    return { bothProfilesIdentical: true, startColor: "rgb(127, 54, 100)", aboutColor: "rgb(49, 91, 114)" };
  });
  await stage("Actual publish UI exports cartridge containing code and original resource bytes", async () => {
    await click(page.locator('[data-workspace-surface="publish"]:visible')); await A.settleEditor(page);
    const panel = page.locator(".cartridge-export-panel"); await panel.waitFor();
    await until(async () => {
      const dialog = page.getByTestId("package-environment-operation-dialog");
      if (await dialog.isVisible()) {
        const phase = await dialog.getAttribute("data-environment-phase");
        if (!["completed", "failed"].includes(phase)) return false;
        await dialog.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
      }
      try { await panel.locator('[data-package-stage="settings"]').click({ timeout: 750 }); } catch { return false; }
      return panel.locator('[data-help-key="package.mode"]').isVisible();
    }, "native publishing preparation", 180000);
    await click(panel.locator('[data-help-key="package.mode"]'));
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    const warning = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warning.isVisible()) await warning.click();
    const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
    report.exportWarnings = await panel.locator(".preflight-check.is-warning").allTextContents(); save();
    const directory = path.join(out, "cartridge"); fs.mkdirSync(directory);
    const download = await A.realDownload(page, host.cdp, directory, panel.locator('[data-help-key="package.export"]'));
    const zip = await JSZip.loadAsync(fs.readFileSync(download.path), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const skin = JSON.parse(await zip.file("ui/layout.json").async("string"));
    assert.equal(skin.layout_type, "renpy"); assert.equal(skin.advancedPresentationEnabled, true);
    assert.deepEqual(skin, report.profiles.profiles.renpy);
    const asset = manifest.assets.find(a => a.asset_id === "qa-control-image"); assert(asset);
    const expected = Buffer.from(project.asset_manifest[0].metadata.data_url.split(",")[1], "base64");
    assert.deepEqual(await zip.file(asset.path).async("nodebuffer"), expected);
    const script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
    assert(script.scenes.length > 0); assert.equal(manifest.title, project.title);
    report.cartridge = { ...download, manifest, image: { assetId: asset.asset_id, path: asset.path,
      sha256: require("node:crypto").createHash("sha256").update(expected).digest("hex") },
      layoutSha256: require("node:crypto").createHash("sha256").update(await zip.file("ui/layout.json").async("nodebuffer")).digest("hex") };
    save(); await host.shot("safe-code-cartridge-export");
    return report.cartridge;
  });
  assert.deepEqual(report.errors, []); assert.equal(report.cases.length, 4); assert.equal(report.modelRequests, 0);
  // Remove only this newly generated Downloads package, after an identical F
  // archive and real reimport/export. Never delete user packages or directories.
  assert.equal(sha(report.portable.originalNativePath), report.portable.sha256);
  assert.equal(sha(report.portable.path), report.portable.sha256);
  fs.unlinkSync(report.portable.originalNativePath);
  report.portable.nativeCleanupStatus = "REMOVED_AFTER_HASH_IDENTICAL_ARCHIVE_AND_UI_REIMPORT";
  assert(!fs.existsSync(report.portable.originalNativePath)); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) {
    report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-8000);
    try { await host.shot("failure"); } catch (e) { report.captureError = String(e); }
  }
}).finally(async () => {
  try { await host.stop("finally; owned-process termination, normal close not claimed");
    if (protectedCache) { cache("Restore"); report.nativeCacheRestoration = "PASS"; } }
  catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
