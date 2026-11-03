"use strict";
// Actual NSIS Editor, native backend/pickers, portable project, and shipped
// player. Fixture preparation alone uses the public backend import API.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { spawn, spawnSync } = require("node:child_process"), net = require("node:net");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { readInstalledViewport, captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const root = path.resolve(__dirname, ".."), audit = path.resolve(process.argv[2] || "");
const out = path.resolve(process.argv[3] || "");
assert(process.argv[2] && process.argv[3] && !fs.existsSync(out));
assert(out.startsWith("F:\\AgentVN\\QA\\") && !process.env.E5_LIFECYCLE_SOURCE);
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(audit, path.join(out, "installer-resource-report.json"));
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { buildSync } = require("../editor/node_modules/esbuild");
const mod = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports);
const project = fixture(`installed_redesign_${path.basename(out)}`);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#394d78"/></svg>';
project.asset_manifest = [{ asset_id: "qa_background", asset_type: "background", metadata: {
  filename: "隔离背景.svg", display_name: "隔离背景", mime_type: "image/svg+xml", width: 1280, height: 720,
  data_url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` } }];
project.editor_settings.runtimeUILayout = mod.exports.createRenpyUILayout();
project.editor_settings.runtimeUILayoutProfiles = { version: 1, activeType: "renpy",
  profiles: { agentvn: mod.exports.getDefaultUISkinLayout(), renpy: project.editor_settings.runtimeUILayout } };
const input = path.join(out, "重构验收隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = out;
const report = { status: "RUNNING", scope: "ACTUAL_INSTALLED_EDITOR_NATIVE_SAVE_REOPEN_EXPORT_SHIPPED_PLAYER",
  startedAt: new Date().toISOString(), modelRequests: 0, cases: [], screenshots: [], matrix: [], cleanup: [],
  environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out },
  boundaries: { realModel: false, AndroidDevice: false, physical4K: false, fullLegacyAcceptance: false } };
const nativeUnavailable = process.env.AGENTVN_NATIVE_PICKER_UNAVAILABLE;
if (nativeUnavailable) report.nativeToolBlock = { status: "BLOCKED", reason: nativeUnavailable };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let owner, browser, page, cdp, state, player, playerBrowser;
const snapshot = () => A.projectSnapshot(state.backendPort);
const content = value => ({ settings: value.settings, assets: value.assetManifest });
async function stage(name, body) {
  report.stage = name; save(); console.log(`START ${name}`);
  if (nativeUnavailable && name === "native-save-normal-close-restart-and-native-portable-reopen") {
    report.cases.push({ name, status: "BLOCKED", reason: nativeUnavailable, executed: false });
    save(); return;
  }
  const result = await body(); report.cases.push({ name, status: "PASS", ...result }); save();
}
async function connect() {
  state = owner.state; A.readInstalledSession(out);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  const deadline = Date.now() + 45000;
  while (!page && Date.now() < deadline) {
    page = browser.contexts()[0].pages().find(p => p.url().startsWith("http://tauri.localhost"));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(page); page.setDefaultTimeout(30000);
  cdp = await browser.contexts()[0].newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
}
async function options(tab = "layout") {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator(`[data-help-key="advanced.tab.${tab}"]:visible`).click(); await A.settleEditor(page);
}
async function saveLayout() {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent.includes("已保存"));
}
async function native(trigger, name, selectedPath, isFile) {
  const file = path.join(out, `native-${name}.json`); assert(!fs.existsSync(file));
  await trigger.click();
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/gui-directory-picker-uia.ps1"), "-OwnerPid", String(state.editorPid),
    "-ReportPath", file, "-Directory", selectedPath, "-TitlePattern",
    isFile ? "^选择 AgentVN 工程文件$" : "^选择当前工程的 \\.vnproj 保存目录$"];
  if (isFile) args.push("-File");
  const result = await new Promise((resolve, reject) => {
    const helper = spawn("powershell.exe", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let log = ""; helper.stdout.on("data", data => { log += data; }); helper.stderr.on("data", data => { log += data; });
    helper.on("error", reject); helper.on("close", code => resolve({ code, log }));
  });
  assert.equal(result.code, 0, result.log);
  const receipt = JSON.parse(fs.readFileSync(file)); assert.equal(receipt.status, "PASS");
  assert.equal(receipt.ownerPid, state.editorPid); assert.equal(path.resolve(receipt.directory), path.resolve(selectedPath));
  return { evidence: file, method: receipt.method };
}
async function closeNormally() {
  A.readInstalledSession(out);
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `$p=Get-Process -Id ${Number(state.editorPid)} -ErrorAction Stop; if(-not $p.CloseMainWindow()){throw 'Close rejected'}; if(-not $p.WaitForExit(20000)){throw 'Close timeout'}`],
  { windowsHide: true, encoding: "utf8", timeout: 25000 });
  assert.equal(r.status, 0, r.stderr);
  await browser.close(); browser = undefined; page = undefined;
  report.cleanup.push(await owner.stop()); owner = undefined;
}
(async () => {
  owner = await startInstalledEditor(out); await connect();
  await stage("isolated-native-backend-fixture-load", async () => {
    const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input) });
    assert(response.ok, await response.text());
    await page.reload();
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await options();
    assert.equal((await snapshot()).projectId, project.project_id);
    return { exeSha256: A.readInstalledSession(out).exeSha256, fixture: input };
  });
  const originalAgentVN = (await snapshot()).settings.runtimeUILayoutProfiles.profiles.agentvn;
  await stage("ordinary-background-and-advanced-safe-control-edit", async () => {
    await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_hero"]').click();
    await A.select(page, "当前控件背景图", "隔离背景"); await A.select(page, "背景图适配", "完整显示");
    const bg = page.getByTestId("renpy-imported-title-background"); await bg.waitFor();
    const bytes = await bg.evaluate(async e => {
      const url = /^url\("(.*)"\)$/.exec(getComputedStyle(e).backgroundImage)?.[1];
      if (!url) throw Error("Background missing"); return (await fetch(url)).text();
    });
    assert.equal(bytes, svg); assert.equal(await bg.evaluate(e => getComputedStyle(e).backgroundSize), "contain");
    await page.locator('.renpy-title-action[data-ui-component-id="title_start_button"]').click();
    const advanced = page.getByRole("checkbox", { name: "Ren’Py进阶代码编辑", exact: true });
    await advanced.check(); await page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }).click();
    const css = ".root { background-color: #742b59; border-radius: 6px; padding: 8px; } .body { color: white; }";
    await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(css);
    const start = page.locator('.renpy-title-action[data-ui-component-id="title_start_button"]');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.renpy-title-action[data-ui-component-id="title_start_button"]')).backgroundColor === "rgb(116, 43, 89)");
    assert.equal(await start.getAttribute("data-control-slot-count"), "1");
    assert.equal(await page.getByRole("spinbutton", { name: "当前控件内容留白", exact: true }).isDisabled(), true);
    await advanced.uncheck(); assert.notEqual(await start.evaluate(e => getComputedStyle(e).backgroundColor), "rgb(116, 43, 89)");
    await advanced.check(); assert.equal(await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).inputValue(), css);
    await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill("body { color: red; }");
    await page.getByRole("alert").filter({ hasText: "代码未应用" }).waitFor();
    assert.equal(await page.locator('[data-help-key="layout.save"]:visible').isDisabled(), true);
    assert.equal(await start.evaluate(e => getComputedStyle(e).backgroundColor), "rgb(116, 43, 89)");
    await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(css); await saveLayout();
    assert.deepEqual((await snapshot()).settings.runtimeUILayoutProfiles.profiles.agentvn, originalAgentVN);
  });
  await stage("native-library-import-with-explicit-control-application", async () => {
    const before = content(await snapshot());
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Lz4AAAAASUVORK5CYII=", "base64");
    const zip = new JSZip(); zip.file("gui.rpy", "define gui.navigation_xpos = 44\n");
    zip.file("gui/button/idle.png", png);
    await page.getByTestId("renpy-gui-import-open").click();
    const dialog = page.getByTestId("renpy-gui-import-dialog");
    await page.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles({
      name: "安装版 中文资源.zip", mimeType: "application/zip", buffer: await zip.generateAsync({ type: "nodebuffer" }) });
    await dialog.locator(".renpy-gui-import-summary").waitFor();
    await dialog.getByRole("checkbox", { name: /我已重新核对/ }).check();
    await dialog.getByRole("button", { name: "确认入库，不修改工程", exact: true }).click();
    const library = dialog.getByTestId("renpy-gui-library"); await library.locator("article").waitFor();
    assert.deepEqual(content(await snapshot()), before);
    await library.getByRole("button", { name: "预览并选择应用", exact: true }).click();
    await A.select(page, "资源包应用范围", "单个控件"); await A.select(page, "目标页面", "标题");
    await A.select(page, "目标控件", "存档");
    await A.select(page, "gui/button/idle.png 游戏界面用途", "当前控件背景");
    await dialog.getByRole("checkbox", { name: /我已重新核对/ }).check();
    await dialog.getByRole("button", { name: "确认应用到当前工程", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); await saveLayout();
    const after = await snapshot();
    assert.equal(after.assetManifest.length, before.assets.length + 1);
    assert.deepEqual(after.settings.runtimeUILayoutProfiles.profiles.agentvn, originalAgentVN);
    const added = after.assetManifest.find(a => !before.assets.some(b => b.asset_id === a.asset_id));
    assert.equal(Buffer.compare(await A.assetBytes(state.backendPort, added), png), 0);
    return { appliedAsset: added.asset_id, sha256: A.sha256(png) };
  });
  await stage("installed-webview-twelve-display-combinations", async () => {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const expected = { width, height, dpr, reduced };
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
        await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" }); await A.settleEditor(page);
        await readInstalledViewport(page, expected);
        const control = page.locator('[data-help-key="layout.save"]:visible');
        const geometry = await control.evaluate(e => {
          const r = e.getBoundingClientRect(); return { rect: r.toJSON(),
            hit: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(geometry.hit && geometry.overflow <= 1 && geometry.rect.right <= width && geometry.rect.bottom <= height);
        report.screenshots.push(await captureInstalledWebview(page, cdp,
          path.join(out, `installed-${width}-${dpr}-${reduced}.png`), expected));
        report.matrix.push({ ...expected, geometry, status: "PASS" }); save();
      }
    assert.equal(report.matrix.length, 12);
  });
  let portable, saved;
  await stage("native-save-normal-close-restart-and-native-portable-reopen", async () => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await page.emulateMedia({ reducedMotion: "no-preference" }); await options("settings");
    const directory = path.join(out, "中文 工程保存"); fs.mkdirSync(directory);
    const directoryInput = await native(page.locator('[data-help-key="settings.projectExportDirectory.choose"]:visible'), "save-directory", directory, false);
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
    await page.getByRole("button", { name: "保存工程", exact: true }).click();
    const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    const names = fs.readdirSync(directory).filter(f => f.endsWith(".vnproj")); assert.equal(names.length, 1);
    portable = path.join(directory, names[0]); const bytes = fs.readFileSync(portable);
    const zip = await JSZip.loadAsync(bytes), data = JSON.parse(await zip.file("project.json").async("string"));
    saved = await snapshot(); assert.deepEqual(data.editor_settings.runtimeUILayoutProfiles, saved.settings.runtimeUILayoutProfiles);
    assert(!JSON.stringify(data).includes(directory), "Machine-local save directory must not enter project data");
    report.portable = { path: portable, sha256: A.sha256(bytes), generatedAt: fs.statSync(portable).mtime.toISOString() };
    await closeNormally(); owner = await startInstalledEditor(out, { restart: true }); await connect();
    await page.getByRole("button", { name: "导入项目", exact: true }).waitFor();
    const reopen = await native(page.getByRole("button", { name: "导入项目", exact: true }), "reopen", portable, true);
    await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
    assert.deepEqual((await snapshot()).settings.runtimeUILayoutProfiles, saved.settings.runtimeUILayoutProfiles);
    await options(); await page.getByTestId("renpy-gui-import-open").click();
    await page.getByTestId("renpy-gui-library").locator("article").waitFor();
    await page.getByRole("button", { name: "关闭导入预览", exact: true }).click();
    return { directoryInput, reopen, portable: report.portable };
  });
  await stage("actual-cartridge-export-and-shipped-native-player-hide", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click();
    const publishing = page.locator(".cartridge-export-panel"); await publishing.waitFor();
    await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
    await A.dismissEnvironmentCompletion(page);
    await publishing.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    await publishing.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
    const warning = publishing.getByRole("checkbox", { name: /我已检查全部警告/ }); if (await warning.count()) await warning.check();
    report.cartridge = await A.realDownload(page, cdp, out, publishing.locator(".package-primary-action"));
    const zip = await JSZip.loadAsync(fs.readFileSync(report.cartridge.path));
    const skin = JSON.parse(await zip.file("ui/layout.json").async("string"));
    assert.equal(skin.layout_type, "renpy"); assert(skin.advancedPresentationEnabled);
    assert.equal(JSON.parse(await zip.file("manifest.json").async("string")).runtime_version, "0.25.0");
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer(); probe.on("error", reject); probe.listen(0, "127.0.0.1", () => {
        const p = probe.address().port; probe.close(() => resolve(p)); });
    });
    const exe = path.join(state.installRoot, "agentvn-player.exe");
    player = spawn(exe, ["--mode", "preview", "--cartridge", report.cartridge.path], {
      cwd: state.installRoot, windowsHide: true, stdio: "ignore", env: { ...process.env,
        WEBVIEW2_USER_DATA_FOLDER: path.join(out, "native-player-profile"),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
    report.player = { exe, sha256: A.sha256(fs.readFileSync(exe)), pid: player.pid, port };
    const deadline = Date.now() + 60000; let ready = false;
    while (Date.now() < deadline) {
      assert.equal(player.exitCode, null);
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert(ready); playerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const target = playerBrowser.contexts()[0].pages()[0];
    await target.getByTestId("start-new-game").waitFor(); await A.settleRuntime(target);
    const start = target.getByTestId("start-new-game");
    assert.equal(await start.evaluate(e => getComputedStyle(e).backgroundColor), "rgb(116, 43, 89)");
    await start.click(); await target.getByTestId("game-state-playing").waitFor(); await A.settleRuntime(target);
    assert.equal(await target.locator(".renpy-quick-bar button").count(), 9);
    const index = await target.getByTestId("game-state-playing").getAttribute("data-current-command-index");
    await target.getByTestId("renpy-quick-hide").click();
    await target.waitForFunction(() => getComputedStyle(document.querySelector(".story-interface")).opacity === "0");
    assert.equal(await target.locator(".story-interface").evaluate(e => e.inert), true);
    await target.keyboard.press("Escape");
    await target.waitForFunction(() => getComputedStyle(document.querySelector(".story-interface")).opacity === "1");
    assert.equal(await target.getByTestId("game-state-playing").getAttribute("data-current-command-index"), index);
    assert.equal(await target.getByTestId("renpy-quick-hide").evaluate(e => e === document.activeElement), true);
    await playerBrowser.close(); playerBrowser = undefined;
    const killed = spawnSync("taskkill.exe", ["/PID", String(player.pid), "/T", "/F"], { windowsHide: true });
    assert.equal(killed.status, 0); player = undefined;
    return { cartridge: report.cartridge, player: report.player };
  });
  assert.equal(report.cases.length, 6);
  assert(report.cases.filter(row => row.status === "PASS").length > 0, "No empty acceptance pass");
  report.status = report.cases.some(row => row.status === "BLOCKED") ? "BLOCKED" : "PASS";
  if (report.status === "BLOCKED") process.exitCode = 2;
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && cdp) {
    try { const captured = await cdp.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(out, "failure.png"), Buffer.from(captured.data, "base64")); } catch {}
  }
}).finally(async () => {
  await playerBrowser?.close(); await browser?.close();
  if (player) report.playerCleanup = spawnSync("taskkill.exe", ["/PID", String(player.pid), "/T", "/F"], { windowsHide: true }).status;
  if (owner) report.cleanup.push(await owner.stop());
  if (report.cleanup.some(c => c.editor.exitCode !== 0 || c.backend.exitCode !== 0) || report.playerCleanup) {
    report.status = "FAILED"; process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, stage: report.stage, out, error: report.error }));
});
