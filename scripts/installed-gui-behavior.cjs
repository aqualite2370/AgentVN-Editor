"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const { settleEditor, assetBytes, select, realDownload, dismissEnvironmentCompletion } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-gui-session-20261018-01";
const [phase, out] = process.argv.slice(2), attempt = Number(process.argv[4] || 1);
assert(["author", "reopen", "export"].includes(phase) && out && !fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const fixture = read(path.join(run, "fixtures.json"));
const launch = read(path.join(run, `launch${attempt === 1 ? "" : `-${String(attempt).padStart(2, "0")}`}.json`));
const report = { status: "RUNNING", at: new Date().toISOString(), phase, checks: [], cases: [], matrix: [],
  screenshots: [], errors: [], error: null, realModelRequests: 0,
  scope: "ACTUAL_INSTALLED_RELEASE_FULL_OFFICIAL_GUI_ZIP_IMPORT; controlled packaged-backend fixture seed, not native project picker",
  environment: { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: process.env.AGENTVN_WORKSPACE_OUTPUT } };
fs.mkdirSync(out); let browser, page, cdp, dialog;
let expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const archivePrefix = "官方模板 中文/game/";
const sourcePath = relative => archivePrefix + relative;
function check(name, ok, detail) { report.checks.push({ name, status: ok ? "PASS" : "FAILED", detail }); assert(ok, name); }
async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected)); }
async function snapshot() {
  return page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), g = window.__AGENTVN_EDITOR_STORE__.getState();
    return { id: p.projectId, settings: p.settings, assets: p.assetManifest, nodes: g.nodes, edges: g.edges };
  });
}
async function assetProofs() {
  const current = await snapshot(), proofs = [];
  for (const a of current.assets) proofs.push({ id: a.asset_id, metadata: a.metadata, sha256: sha(await assetBytes(8278, a)) });
  return proofs;
}
async function openLayout() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  const b = page.locator('.runtime-layout-type-switch [data-layout-type-option="renpy"]:visible');
  if (await b.getAttribute("aria-pressed") !== "true") {
    await b.click(); await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
  }
}
async function scan(file) {
  if (!await dialog.isVisible()) await page.getByTestId("renpy-gui-import-open").click();
  await dialog.waitFor(); await dialog.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles(file);
  await dialog.locator(".renpy-gui-import-summary").waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid="renpy-gui-import-dialog"] button')?.disabled);
}
async function cancel() {
  await dialog.getByRole("button", { name: "取消，不修改工程", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
}
async function saveLayout() {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.waitForFunction(() => document.querySelector('[data-help-key="layout.save"]')?.getAttribute("data-save-state") === "saved");
}
async function bind(relative, purpose) {
  await select(page, `${sourcePath(relative)} 游戏界面用途`, purpose);
}
async function param(key, selected) {
  const row = dialog.locator(".renpy-gui-import-row").filter({ has: page.locator("span", { hasText: new RegExp(`^${key.replaceAll(".", "\\.")}$`) }) });
  await row.getByRole("checkbox").setChecked(selected);
}
(async () => {
  assert.equal(report.environment.AGENTVN_TEST_PROJECT, fixture.input);
  assert.equal(report.environment.AGENTVN_WORKSPACE_OUTPUT, run);
  assert.equal(sha(fs.readFileSync(fixture.officialArchive.path)), fixture.officialArchive.sha256);
  assert.equal(sha(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  if (phase === "author") {
    const response = await fetch("http://127.0.0.1:8278/api/project/projects/import", {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(fixture.input)) },
      body: fs.readFileSync(fixture.input), signal: AbortSignal.timeout(30000) });
    const body = await response.json(); assert(response.ok && body.ok && body.data.project_id === fixture.projectId);
    report.fixtureSeed = "CONTROLLED_REAL_PACKAGED_BACKEND_IMPORT_NOT_NATIVE_PICKER";
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(30000); page.on("pageerror", e => report.errors.push(String(e)));
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (phase !== "export") {
    await page.reload(); await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await openLayout();
  }
  dialog = page.getByTestId("renpy-gui-import-dialog");
  if (phase === "reopen") {
    const prior = read(path.join(run, "author-01/report.json")); assert.equal(prior.status, "PASS");
    const current = await snapshot(); assert.equal(current.id, fixture.projectId);
    assert.deepEqual(current.settings.runtimeUILayoutProfiles, prior.finalProject.settings.runtimeUILayoutProfiles);
    assert.deepEqual(current.settings.runtimeUILayout, prior.finalProject.settings.runtimeUILayout);
    assert.deepEqual(JSON.parse(JSON.stringify(current.nodes)), prior.finalProject.nodes);
    assert.deepEqual(JSON.parse(JSON.stringify(current.edges)), prior.finalProject.edges);
    const proofs = await assetProofs();
    assert.deepEqual(proofs.map(a => ({ id: a.id, sha256: a.sha256 })), prior.assetProofs.map(a => ({ id: a.id, sha256: a.sha256 })));
    await page.getByTestId("renpy-font-coverage-report").locator("strong", { hasText: "项目字符存在缺字" }).waitFor();
    check("Real installed restart/homepage reopen preserves both profiles, all imported bytes and visible font-fallback diagnostics", true);
    await shot("actual-restart"); report.status = "PASS"; return;
  }
  if (phase === "export") {
    assert.equal((await snapshot()).id, fixture.projectId);
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
    await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
    if (await page.locator(".android-env-import-backdrop").isVisible())
      await page.getByRole("dialog").filter({ hasText: "环境检测已完成" }).waitFor({ timeout: 60000 });
    await dismissEnvironmentCompletion(page);
    await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    const warning = page.getByRole("button", { name: "查看并确认警告", exact: true }); if (await warning.isVisible()) await warning.click();
    const confirm = page.locator('[data-help-key="package.confirmWarnings"]'); if (await confirm.isVisible()) await confirm.check();
    const target = path.join(path.dirname(fixture.input), "cartridge-export"); fs.mkdirSync(target);
    report.cartridge = await realDownload(page, cdp, target, page.locator('[data-help-key="package.export"]'));
    const zip = await JSZip.loadAsync(fs.readFileSync(report.cartridge.path));
    const m = JSON.parse(await zip.file("manifest.json").async("string"));
    const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
    const prior = read(path.join(run, "author-01/report.json"));
    assert.equal(m.game_id, fixture.projectId); assert.deepEqual(layout, prior.finalProject.settings.runtimeUILayout);
    report.exportedAssets = [];
    for (const a of m.assets) {
      const old = prior.assetProofs.find(p => p.id === a.asset_id); assert(old);
      const hash = sha(await zip.file(a.path).async("nodebuffer")); assert.equal(hash, old.sha256);
      report.exportedAssets.push({ id: a.asset_id, path: a.path, sha256: hash });
    }
    assert(report.exportedAssets.length >= 6);
    check("Real installed publish exports active imported layout and exact GUI bytes without post-export editing", true,
      { assets: report.exportedAssets.length, cartridge: report.cartridge });
    await shot("actual-export"); report.status = "PASS"; return;
  }
  const baseline = await snapshot(); assert.equal(baseline.id, fixture.projectId); assert.equal(baseline.assets.length, 0);
  await scan(fixture.officialArchive.path);
  assert.equal(await dialog.locator(".renpy-gui-import-asset-row").count(), 25);
  report.scan = { summary: await dialog.locator(".renpy-gui-import-summary").innerText(),
    issues: await dialog.locator('[aria-label="扫描问题"]').innerText(),
    parameters: await dialog.locator(".renpy-gui-import-row").allTextContents() };
  assert(report.scan.issues.includes("unsupported_script"), "Custom screen logic must be reported, not executed");
  assert(report.scan.parameters.some(s => s.includes("shared.x") && s.includes("40")));
  assert.deepEqual(await snapshot(), baseline);
  await cancel(); assert.deepEqual(await snapshot(), baseline);
  check("Complete authentic 24-image/one-font official ZIP scans with explicit unsupported items and cancel leaves project unchanged", true, report.scan);
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      expected = { width, height, dpr, reduced };
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" }); await readInstalledViewport(page, expected);
      await scan(fixture.officialArchive.path);
      await bind("gui/main_menu.png", "标题页主视觉");
      await dialog.locator(".renpy-gui-import-license input").check();
      const geometry = await dialog.evaluate(node => {
        const box = node.getBoundingClientRect(), footer = node.querySelector("footer").getBoundingClientRect();
        const body = node.querySelector(".renpy-gui-import-body").getBoundingClientRect();
        return { box: box.toJSON(), footer: footer.toJSON(), body: body.toJSON(),
          overflow: document.documentElement.scrollWidth - innerWidth,
          buttons: [...node.querySelectorAll("footer button")].map(b => {
            const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return { text: b.textContent, rect: r.toJSON(), hit: b === hit || b.contains(hit) };
          }), nativeSelects: node.querySelectorAll("select").length };
      });
      assert(geometry.box.left >= 0 && geometry.box.top >= 0 && geometry.box.right <= width + 1 && geometry.box.bottom <= height + 1);
      assert(geometry.body.bottom <= geometry.footer.top + 1 && geometry.buttons.every(b => b.hit));
      assert(geometry.overflow <= 1 && geometry.nativeSelects === 0);
      await shot(`${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}`);
      await cancel(); assert.deepEqual(await snapshot(), baseline);
      report.matrix.push({ ...expected, status: "PASS", geometry });
    }
  check("Twelve actual installed WebView combinations keep complete-template mapping/footer bounded, themed and hit-testable", report.matrix.length === 12);
  expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await scan(fixture.officialArchive.path);
  for (const b of await dialog.locator(".renpy-gui-import-row input[type=checkbox]").all()) await b.check();
  await bind("gui/main_menu.png", "标题页主视觉");
  await bind("gui/textbox.png", "对白面板背景");
  await bind("gui/button/choice_idle_background.png", "分支选项按钮背景");
  await bind("gui/button/quick_idle_background.png", "共享按钮 · 普通状态");
  await bind("gui/button/quick_hover_background.png", "共享按钮 · 悬停/聚焦状态");
  await bind("DejaVuSans.ttf", "全局界面字体");
  await dialog.locator(".renpy-gui-import-license input").check();
  await dialog.getByRole("button", { name: "确认应用已选项目", exact: true }).click(); await dialog.waitFor({ state: "detached" });
  await saveLayout(); const imported = await snapshot(); assert.equal(imported.assets.length, 25);
  assert.deepEqual(imported.settings.runtimeUILayoutProfiles.profiles.agentvn, baseline.settings.runtimeUILayoutProfiles.profiles.agentvn);
  assert.deepEqual(imported.nodes, baseline.nodes); assert.deepEqual(imported.edges, baseline.edges);
  assert.equal(imported.settings.runtimeUILayout.renpy.shared.x, 40);
  assert.equal(imported.settings.runtimeUILayout.renpy.shared.fontSize, 22);
  report.importedAssets = await assetProofs();
  for (const a of report.importedAssets) {
    const tag = a.metadata.tags.find(t => t.startsWith("renpy_gui_path:"));
    const relative = tag.slice("renpy_gui_path:".length).slice(archivePrefix.length);
    assert.equal(a.sha256, fixture.officialFiles.find(f => f.relative === relative).sha256);
  }
  const font = page.getByTestId("renpy-font-coverage-report");
  await font.locator("strong", { hasText: "项目字符存在缺字" }).waitFor();
  report.fontCoverage = await font.innerText(); assert(report.fontCoverage.includes("回退到系统字体"));
  check("Confirm imports all 25 exact official resources, chosen parameters/bindings and visible CJK fallback without mutating AgentVN/story", true);
  await shot("complete-official-applied-font-fallback");
  // Reimport the full official source, with one deliberately edited PNG and
  // one parameter. Other hand-edited values must not be overwritten.
  const originalZip = await JSZip.loadAsync(fs.readFileSync(fixture.officialArchive.path));
  const replacementBytes = await originalZip.file(sourcePath("gui/button/choice_hover_background.png")).async("nodebuffer");
  originalZip.file(sourcePath("gui/button/quick_idle_background.png"), replacementBytes);
  const gui = await originalZip.file(sourcePath("gui.rpy")).async("string");
  assert(gui.includes("define gui.navigation_xpos = 40"));
  originalZip.file(sourcePath("gui.rpy"), gui.replace("define gui.navigation_xpos = 40", "define gui.navigation_xpos = 56"));
  const edited = path.join(path.dirname(fixture.input), "官方模板 人工修改.zip");
  const editedBytes = await originalZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(edited, editedBytes, { flag: "wx" }); report.reimportArchive = { path: edited, sha256: sha(editedBytes) };
  await scan(edited);
  assert(await dialog.getByRole("combobox", { name: `${sourcePath("gui/main_menu.png")} 导入操作`, exact: true }).innerText().then(t => t.includes("跳过")));
  for (const b of await dialog.locator(".renpy-gui-import-row input[type=checkbox]").all()) assert(!await b.isChecked());
  await select(page, `${sourcePath("gui/button/quick_idle_background.png")} 导入操作`, "替换同来源导入");
  await param("shared.x", true); await dialog.locator(".renpy-gui-import-license input").check();
  await cancel(); assert.deepEqual(await snapshot(), imported);
  await scan(edited);
  await select(page, `${sourcePath("gui/button/quick_idle_background.png")} 导入操作`, "替换同来源导入");
  await param("shared.x", true); await dialog.locator(".renpy-gui-import-license input").check();
  await dialog.getByRole("button", { name: "确认应用已选项目", exact: true }).click(); await dialog.waitFor({ state: "detached" }); await saveLayout();
  const replacement = await snapshot(); assert.equal(replacement.assets.length, 25);
  assert.equal(replacement.settings.runtimeUILayout.renpy.shared.x, 56);
  const priorSettings = structuredClone(imported.settings), nextSettings = structuredClone(replacement.settings);
  for (const value of [priorSettings, nextSettings]) {
    value.runtimeUILayout.renpy.shared.x = 0;
    value.runtimeUILayoutProfiles.profiles.renpy.renpy.shared.x = 0;
  }
  assert.deepEqual(nextSettings, priorSettings);
  report.assetProofs = await assetProofs();
  const replaced = report.assetProofs.find(a => a.metadata.tags.includes(`renpy_gui_path:${sourcePath("gui/button/quick_idle_background.png")}`));
  assert.equal(replaced.sha256, sha(replacementBytes));
  for (const a of report.assetProofs) {
    const old = report.importedAssets.find(p => p.id === a.id); assert(old);
    if (a.id !== replaced.id) assert.equal(a.sha256, old.sha256);
  }
  report.replacedAsset = replaced;
  check("Full-template reimport cancel is inert; selected overwrite preserves asset ID, all unselected parameters/resources and other layout", true);
  // Save through actual native toolbar; retain and verify portable bytes.
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
  const downloads = "C:/Users/1/Downloads", before = new Set(fs.readdirSync(downloads));
  await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
  const saved = page.getByTestId("project-save-confirmation"); await saved.waitFor({ timeout: 60000 });
  const found = fs.readdirSync(downloads).filter(f => !before.has(f) && f.includes(fixture.title) && f.endsWith(".vnproj"));
  assert.equal(found.length, 1); const native = path.join(downloads, found[0]);
  const retained = path.join(path.dirname(fixture.input), "完整官方GUI保存包.vnproj");
  fs.copyFileSync(native, retained, fs.constants.COPYFILE_EXCL);
  const portableZip = await JSZip.loadAsync(fs.readFileSync(retained));
  const portable = JSON.parse(await portableZip.file("project.json").async("string"));
  report.finalProject = await snapshot();
  assert.deepEqual(portable.editor_settings.runtimeUILayoutProfiles, report.finalProject.settings.runtimeUILayoutProfiles);
  assert.equal(portable.asset_manifest.length, 25);
  for (const a of portable.asset_manifest) {
    const bytes = await portableZip.file(a.metadata.project_path).async("nodebuffer");
    assert.equal(sha(bytes), report.assetProofs.find(p => p.id === a.asset_id).sha256);
  }
  report.package = { native, retained, sha256: sha(fs.readFileSync(retained)) };
  await saved.getByRole("button", { name: "OK", exact: true }).click();
  check("Native project package includes both profiles and all 25 verified GUI dependency bytes", true, report.package);
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) { report.failureText = await page.locator("body").innerText().catch(() => ""); await shot("failure").catch(() => {}); }
}).finally(async () => {
  await browser?.close().catch(() => {}); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, matrix: report.matrix.length,
    error: report.error, out }, null, 2));
});
