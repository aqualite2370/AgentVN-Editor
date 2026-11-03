"use strict";
// Current installed EXE + its backend/Runtime. No source server, store writes,
// model calls or native-picker claims. All edits use actual author controls.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");
const { buildSync } = require("../editor/node_modules/esbuild");
const JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const A = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt, /^\d{2}$/);
const out = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const installationFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json";
const mod = { exports: {} };
new Function("module", "exports", buildSync({ stdin: {
  resolveDir: root, loader: "ts", contents:
    'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";',
}, bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports);
const project = fixture(`installed-special-layout-${attempt}`);
project.title = `安装版特殊区域${attempt}`;
project.nodes[0].data.openingAudio = [];
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#394d78"/></svg>';
project.asset_manifest = [{ asset_id: "special_background", asset_type: "background", metadata: {
  filename: "隔离背景.svg", display_name: "隔离背景", mime_type: "image/svg+xml",
  width: 1280, height: 720, data_url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
} }];
project.editor_settings.runtimeUILayout = mod.exports.createRenpyUILayout();
project.editor_settings.runtimeUILayoutProfiles = { version: 1, activeType: "renpy",
  profiles: { agentvn: mod.exports.getDefaultUISkinLayout(), renpy: project.editor_settings.runtimeUILayout } };
const input = path.join(out, "特殊区域隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = out;
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(), steps: [], screenshots: [],
  launches: [], cleanups: [], errors: [], modelRequests: 0,
  scope: "INSTALLED_NVL_BUBBLE_CONFIRMATION_AUTHOR_NATIVE_SAVE_RESTART_AND_PUBLIC_REIMPORT",
  boundaries: { nativePicker: false, normalWindowClose: false, standaloneGame: false, android: false,
    display: "1920x1080 DPR1 ordinary WebView viewport simulation" },
  environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out },
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedReleaseSession({ installationFile, out, input, report, save });
let page, prepared = false, ownedDownload;
const snapshot = () => A.projectSnapshot(host.current.ports[0]);
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"),
    "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 30000 });
  (report.cache ??= []).push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }); save();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
async function step(label, action) {
  const row = { label, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(row); save();
  try { row.detail = await action(); row.status = "PASS"; console.log(`PASS ${label}`); }
  catch (error) { row.status = "FAILED"; throw error; }
  finally { row.finishedAt = new Date().toISOString(); save(); }
}
async function openProject() {
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }).click();
  await A.settleEditor(page);
}
async function layout() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
  await page.getByTestId("renpy-title-editor").waitFor();
}
async function saveLayout() {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
}
async function runtime() {
  const viewport = page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]');
  await viewport.waitFor({ timeout: 45000 });
  const frame = await (await viewport.locator("iframe").elementHandle()).contentFrame();
  await A.settleRuntime(frame); return frame;
}
async function modePreview(mode) {
  const frame = await runtime(), panel = frame.locator(".dialog-box");
  assert.equal(await panel.evaluate(n => getComputedStyle(n).borderRadius), "7px");
  assert.notEqual(await panel.evaluate(n => getComputedStyle(n).backgroundImage), "none");
  const text = frame.locator(mode === "nvl" ? ".nvl-page-text" : ".dialog-text").first();
  assert.equal(await text.evaluate(n => getComputedStyle(n).color), "rgb(119, 255, 204)");
  return { mode, panel: await panel.boundingBox(), text: await text.innerText() };
}
function retainDownload() {
  if (!ownedDownload) return;
  const { original, retained, sha256 } = ownedDownload;
  assert.equal(A.sha256(fs.readFileSync(original)), sha256);
  if (!fs.existsSync(retained)) fs.copyFileSync(original, retained, fs.constants.COPYFILE_EXCL);
  assert.equal(A.sha256(fs.readFileSync(retained)), sha256);
  fs.unlinkSync(original); ownedDownload = undefined;
  report.downloadCleanup = { status: "PASS", original, retained, sha256 }; save();
}
(async () => {
  save(); cache("SelfTest"); cache("Prepare"); prepared = true; page = await host.start();
  await step("Isolated fixture through real packaged backend and real homepage entry", async () => {
    const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input),
    });
    const body = await response.json(); assert(response.ok && body.ok && body.data.project_id === project.project_id);
    await page.reload(); await openProject(); await layout();
    report.agentBaseline = (await snapshot()).settings.runtimeUILayoutProfiles.profiles.agentvn;
  });
  await page.getByTestId("renpy-player-layout-entry").click();
  for (const [mode, label] of [["nvl", "NVL 累积阅读"], ["bubble", "气泡对白"]]) {
    await step(`${mode} graphical background, scoped code, invalid-code guard and native Runtime preview`, async () => {
      await A.select(page, "对白布局模式", label);
      await page.getByTestId("dialogue-mode-layout-editor").waitFor(); await runtime();
      await A.select(page, "当前控件背景图", "隔离背景");
      await page.getByRole("checkbox", { name: "Ren’Py进阶代码编辑", exact: true }).check();
      await page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }).click();
      await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(".root { border-radius: 7px; }");
      await page.getByRole("button", { name: "正文", exact: true }).click();
      await page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }).click();
      const code = page.getByRole("textbox", { name: "当前控件 CSS", exact: true });
      await code.fill(".root { color: #77ffcc; }"); await modePreview(mode);
      await code.fill("body { color: red; }");
      await page.getByRole("alert").filter({ hasText: "代码未应用" }).waitFor();
      assert(await page.locator('[data-help-key="layout.save"]:visible').isDisabled());
      await modePreview(mode);
      await code.fill(".root { color: #77ffcc; }"); await saveLayout();
      assert.deepEqual((await snapshot()).settings.runtimeUILayoutProfiles.profiles.agentvn, report.agentBaseline);
      await host.shot(`${mode}-authored`); return modePreview(mode);
    });
  }
  await step("Confirmation scoped code retains native dialog and does not close Editor", async () => {
    await page.getByRole("button", { name: "返回页面导航", exact: true }).click();
    await page.getByTestId("renpy-confirmation-layout-entry").click();
    await page.getByTestId("confirmation-layout-editor").waitFor(); await runtime();
    await page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }).click();
    await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(".root { background-color: #26374a; }");
    const frame = await runtime();
    assert.equal(await frame.locator(".modal-panel").evaluate(n => getComputedStyle(n).backgroundColor), "rgb(38, 55, 74)");
    await saveLayout(); await host.shot("confirmation-authored");
    report.profiles = (await snapshot()).settings.runtimeUILayoutProfiles;
    assert.deepEqual(report.profiles.profiles.agentvn, report.agentBaseline);
  });
  await step("Real default-directory native project save includes profiles, code and exact resource bytes", async () => {
    const downloads = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      "[Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders').'{374DE290-123F-4565-9164-39C4925E467B}')"],
    { encoding: "utf8", windowsHide: true }).trim();
    assert(path.isAbsolute(downloads) && fs.statSync(downloads).isDirectory());
    const before = new Set(fs.readdirSync(downloads));
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
    await page.getByRole("button", { name: "保存工程", exact: true }).click();
    const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
    const files = fs.readdirSync(downloads).filter(f => !before.has(f) && f.endsWith(".vnproj"));
    assert.equal(files.length, 1);
    const original = path.join(downloads, files[0]), bytes = fs.readFileSync(original);
    ownedDownload = { original, retained: path.join(out, files[0]), sha256: A.sha256(bytes) };
    assert((await dialog.innerText()).includes(original));
    retainDownload(); report.portable = report.downloadCleanup;
    const zip = await JSZip.loadAsync(bytes), document = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(document.editor_settings.runtimeUILayoutProfiles, report.profiles);
    const asset = document.asset_manifest.find(a => a.asset_id === "special_background");
    assert(asset?.metadata.project_path);
    assert.equal(await zip.file(asset.metadata.project_path).async("string"), svg);
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    return report.portable;
  });
  await step("Actual Editor/backend restart and portable reimport retain all special-region authoring", async () => {
    await host.stop("Owned-process restart, not normal window close"); page = await host.start();
    await openProject(); assert.deepEqual((await snapshot()).settings.runtimeUILayoutProfiles, report.profiles);
    const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(report.portable.retained)) },
      body: fs.readFileSync(report.portable.retained),
    });
    const body = await response.json(); assert(response.ok && body.ok);
    await page.reload(); await openProject();
    assert.deepEqual((await snapshot()).settings.runtimeUILayoutProfiles, report.profiles);
    await layout(); await page.getByTestId("renpy-player-layout-entry").click();
    const restored = [];
    for (const [mode, label] of [["nvl", "NVL 累积阅读"], ["bubble", "气泡对白"]]) {
      await A.select(page, "对白布局模式", label); restored.push(await modePreview(mode));
    }
    await page.getByRole("button", { name: "返回页面导航", exact: true }).click();
    await page.getByTestId("renpy-confirmation-layout-entry").click();
    assert.equal(await (await runtime()).locator(".modal-panel")
      .evaluate(n => getComputedStyle(n).backgroundColor), "rgb(38, 55, 74)");
    return { restored, portableReimport: "public packaged backend API, not native picker" };
  });
  assert.equal(report.steps.length, 6); assert(report.steps.every(s => s.status === "PASS"));
  assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) try { await host.shot("failure"); } catch (e) { report.captureError = String(e); }
}).finally(async () => {
  try {
    retainDownload(); await host.stop("finally");
    if (prepared) { cache("Restore"); report.nativeCacheRestoration = "PASS"; }
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
