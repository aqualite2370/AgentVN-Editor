"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip"), { chromium } = require("../editor/node_modules/playwright");
const { sha256, settleEditor, realDownload } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const base = process.env.AGENTVN_PORTRAIT_RUN || "D:/AgentVN/output/installed-dialog-portrait-20261019-01";
const work = process.env.AGENTVN_PORTRAIT_WORK || "F:/AgentVN/QA/Dialog-Portrait-20261019-01";
assert.equal(path.dirname(path.resolve(base)), path.resolve("D:/AgentVN/output"));
assert.equal(path.dirname(path.resolve(work)), path.resolve("F:/AgentVN/QA"));
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const prep = read(`${base}/preparation.json`), launch = read(`${base}/launch.json`), fixture = read(`${base}/fixtures.json`);
assert(prep.profiles.every(p => fs.existsSync(p.held)));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(base));
assert(!fs.existsSync(`${base}/editor-01.json`));
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], screenshots: [], cartridges: [], pageErrors: [],
  scope: "FROZEN_INSTALLED_EDITOR_REAL_DIALOGUE_ASSET_PICKER_SAVE_REOPEN_EXPORT; PUBLIC_BACKEND_SEED_NOT_NATIVE_PICKER",
  modelRequests: 0, productChanges: 0 };
const save = () => fs.writeFileSync(`${base}/editor-01.json`, JSON.stringify(report, null, 2));
let browser, page, cdp;
const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
async function step(name, fn) {
  const c = { name, status: "RUNNING" }; report.checks.push(c); save();
  try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; } finally { save(); }
}
async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, `${work}/${name}.png`, expected)); save(); }
async function state() {
  return page.evaluate(() => ({
    project: window.__AGENTVN_PROJECT_STORE__.getState().projectId,
    nodes: window.__AGENTVN_EDITOR_STORE__.getState().nodes,
  }));
}
function assertBound(p) {
  assert.equal(p.project_id || p.project, fixture.projectId);
  const list = p.nodes.find(n => n.id === fixture.nodeId).data.scene.commands;
  assert.equal(list[0].portrait, fixture.portrait.id); assert(!list[1].portrait); return list;
}
async function publish(layout) {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
  await page.locator(".cartridge-export-panel").waitFor();
  const env = page.locator(".windows-env-panel");
  if (await env.count()) await page.waitForFunction(() => ["passed", "failed"].includes(
    document.querySelector(".windows-env-panel")?.getAttribute("data-environment-verification")), null, { timeout: 120000 });
  const complete = page.locator(".android-env-import-backdrop:visible").filter({ hasText: "环境检测已完成" });
  if (await complete.count()) { await complete.getByRole("button", { name: "完成", exact: true }).click(); await complete.waitFor({ state: "hidden" }); }
  await page.locator('[data-package-stage="settings"]').click();
  await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warnings.isVisible()) await warnings.click();
  const confirm = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await confirm.isVisible()) await confirm.check();
  // Chromium's Windows download path must be normalized, not the mixed
  // "F:/.../directory\\filename" that failed in immutable attempt01.
  const out = path.resolve(work, `export-${layout}`); fs.mkdirSync(out);
  const cartridge = await realDownload(page, cdp, out, page.locator('[data-help-key="package.export"]'));
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer"), skin = JSON.parse(layoutBytes);
  assert.equal(manifest.game_id, fixture.projectId); assert.equal(skin.layout_type || "agentvn", layout);
  const scene = script.scenes.find(s => s.scene_id === fixture.scene); assert(scene);
  assert.equal(scene.commands[0].portrait, fixture.portrait.id); assert(!scene.commands[1].portrait);
  const asset = manifest.assets.find(a => a.asset_id === fixture.portrait.id); assert(asset);
  assert.equal(sha256(await zip.file(asset.path).async("nodebuffer")), fixture.portrait.sha256);
  const item = { ...cartridge, layout, layoutSha256: sha256(layoutBytes),
    scriptSha256: sha256(await zip.file("script.json").async("nodebuffer")),
    command: scene.commands[0], control: scene.commands[1], asset };
  if (report.cartridges.length) assert.equal(item.scriptSha256, report.cartridges[0].scriptSha256);
  report.cartridges.push(item); await shot(`export-${layout}`); return item;
}
(async () => {
  assert.equal(sha256(fs.readFileSync(`${launch.installRoot}/agentvn-editor.exe`)), launch.executableSha256);
  assert.equal(sha256(fs.readFileSync(fixture.input)), fixture.inputSha256);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(30000); page.on("pageerror", e => report.pageErrors.push(String(e)));
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await step("Explicit public backend fixture import followed by real homepage project entry", async () => {
    const response = await fetch(`http://127.0.0.1:${launch.backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(fixture.input)) },
      body: fs.readFileSync(fixture.input), signal: AbortSignal.timeout(30000) });
    const result = await response.json(); assert(response.ok && result.ok && result.data.project_id === fixture.projectId);
    await page.reload(); await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    assert.equal((await state()).project, fixture.projectId); return { nativePicker: "NOT_TESTED", projectId: fixture.projectId };
  });
  await step("Real scene command card and dedicated portrait picker bind the exact upgraded asset", async () => {
    await page.locator(`.react-flow__node[data-id="${fixture.nodeId}"]`).click();
    const card = page.locator(".command-card").filter({ hasText: "PORTRAIT_BOUND" }).first();
    await card.locator(".command-card-summary").click();
    const trigger = card.locator('[data-help-key="command.dialog.portrait.openPicker"]');
    await trigger.click();
    await page.locator(`[data-help-key="command.dialog.portrait.select"][data-asset-id="${fixture.portrait.id}"]`).click();
    await page.waitForFunction(id => window.__AGENTVN_EDITOR_STORE__.getState().nodes.find(n => n.id === "scene")
      ?.data.scene.commands[0].portrait === id, fixture.portrait.id);
    const list = assertBound(await state()); await shot("bound-through-dedicated-picker"); return list;
  });
  await step("Native project save contains the binding and upgraded bytes; real homepage reopen retains them", async () => {
    const downloads = "C:/Users/1/Downloads", previous = new Set(fs.readdirSync(downloads));
    await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
    const success = page.getByTestId("project-save-confirmation"); await success.waitFor({ timeout: 60000 });
    const files = fs.readdirSync(downloads).filter(n => !previous.has(n) && n.includes(fixture.title) && n.endsWith(".vnproj"));
    assert.equal(files.length, 1);
    const original = path.join(downloads, files[0]), retained = `${work}/saved-portrait.vnproj`;
    fs.copyFileSync(original, retained, fs.constants.COPYFILE_EXCL);
    const zip = await JSZip.loadAsync(fs.readFileSync(retained)), project = JSON.parse(await zip.file("project.json").async("string"));
    assertBound(project);
    const a = project.asset_manifest.find(a => a.asset_id === fixture.portrait.id);
    assert.equal(sha256(await zip.file(a.metadata.project_path).async("nodebuffer")), fixture.portrait.sha256);
    report.portable = { original, retained, sha256: sha256(fs.readFileSync(retained)), generatedAt: fs.statSync(original).mtime.toISOString() };
    await success.getByRole("button", { name: "OK", exact: true }).click();
    await page.getByRole("button", { name: "返回首页", exact: true }).click(); await settleEditor(page);
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    assertBound(await state()); return report.portable;
  });
  await step("Actual AgentVN publish UI exports the authored portrait command and exact replaced bytes", () => publish("agentvn"));
  await step("Real Renpy layout switch and publish preserve the same authored dialogue and portrait bytes", async () => {
    await page.getByRole("button", { name: "关闭发布与打包", exact: true }).click(); await settleEditor(page);
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
    await page.locator('.runtime-layout-type-switch [data-layout-type-option="renpy"]:visible').click();
    await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
    return publish("renpy");
  });
  assert.equal(report.pageErrors.length, 0); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) { report.failureText = await page.locator("body").innerText().catch(() => ""); await shot("editor-failure").catch(() => {}); }
}).finally(async () => { report.finishedAt = new Date().toISOString(); save(); await browser?.close();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error })); });
