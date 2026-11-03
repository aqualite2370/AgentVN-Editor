"use strict";
// Observe the exact already-replaced legacy JSON, without inventing a JSON schema.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip"), { chromium } = require("../editor/node_modules/playwright");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { sha256, settleEditor, realDownload } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const base = process.env.AGENTVN_ANIMATION_ASSET_RUN, work = process.env.AGENTVN_ANIMATION_ASSET_WORK;
assert(base && work);
assert.equal(path.dirname(path.resolve(base)), path.resolve("D:/AgentVN/output"));
assert.equal(path.dirname(path.resolve(work)), path.resolve("F:/AgentVN/QA"));
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const prep = read(`${base}/preparation.json`), launch = read(`${base}/launch.json`);
assert(prep.profiles.every(p => fs.existsSync(p.held)));
assert.equal(process.env.AGENTVN_WORKSPACE_OUTPUT.replaceAll("\\", "/"), base);
assert.equal(process.env.AGENTVN_TEST_PROJECT.replaceAll("\\", "/"), `${work}/动画素材隔离工程.vnproj`);
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], screenshots: [], launches: [], pageErrors: [],
  cartridges: [], productChanges: 0, modelRequests: 0, newBuilds: 0, consumerConclusion: "BLOCKED",
  scope: "REAL_INSTALLED_EDITOR_ASSET_PICKER_EXPORT_AND_LIBRARY_PLAYER_OBSERVATION; NOT_JSON_SCHEMA_OR_FULL_CONSUMPTION_PASS",
  displayScope: "1920x1080 DPR1 normal only; command-data probe, not full display-matrix acceptance" };
const save = () => fs.writeFileSync(`${base}/probe.json`, JSON.stringify(report, null, 2));
let browser, page, cdp, runtime;
const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
async function step(name, fn) {
  const c = { name, status: "RUNNING" }; report.checks.push(c); save();
  try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; } finally { save(); }
}
async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, `${work}/${name}.png`, expected)); save(); }
async function publish(layout) {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
  await page.locator(".cartridge-export-panel").waitFor();
  if (await page.locator(".windows-env-panel").count()) await page.waitForFunction(() =>
    ["passed", "failed"].includes(document.querySelector(".windows-env-panel")?.getAttribute("data-environment-verification")),
  null, { timeout: 120000 });
  const complete = page.locator(".android-env-import-backdrop:visible").filter({ hasText: "环境检测已完成" });
  if (await complete.count()) { await complete.getByRole("button", { name: "完成", exact: true }).click(); await complete.waitFor({ state: "hidden" }); }
  await page.locator('[data-package-stage="settings"]').click(); await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warnings.isVisible()) await warnings.click();
  const confirm = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await confirm.isVisible()) await confirm.check();
  const target = path.resolve(work, `export-${layout}`); fs.mkdirSync(target);
  const exported = await realDownload(page, cdp, target, page.locator('[data-help-key="package.export"]'));
  const zip = await JSZip.loadAsync(fs.readFileSync(exported.path));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  const command = script.scenes.find(s => s.scene_id === "ui_acceptance").commands[1];
  assert.equal(command.animation_id, "qa_animation"); assert.deepEqual(command.params, { duration: 1600 });
  const asset = manifest.assets.find(a => a.asset_id === "qa_animation"); assert(asset);
  assert.equal(sha256(await zip.file(asset.path).async("nodebuffer")), report.animation.sha256);
  const c = { ...exported, layout, command, asset }; report.cartridges.push(c); save(); await shot(`export-${layout}`); return c;
}
(async () => {
  save(); assert.equal(sha(`${launch.installRoot}/agentvn-editor.exe`), launch.executableSha256);
  const source = read("D:/AgentVN/output/installed-assets-20261018-01/fixtures.json").types.find(t => t.type === "animation");
  assert.equal(sha(source.files.new.path), source.files.new.sha256);
  report.animation = { path: source.files.new.path, sha256: source.files.new.sha256, json: read(source.files.new.path),
    provenance: "EXACT_PREVIOUS_REAL_UI_REPLACEMENT_BYTES", sourceManifest: source };
  const p = fixture("qa-animation-asset-20261019-01"); p.title = "动画素材消费边界验收20261019";
  p.nodes[1].data.scene.commands = [
    { type: "narration", text: "ANIMATION_BEFORE：先停留在此句，之后执行选中的动画素材。" },
    { type: "animation", animation_id: "", target: "dialog", params: { duration: 1600 }, blocking: true },
    { type: "narration", text: "ANIMATION_AFTER：动画命令执行后的对照句。" },
  ];
  p.asset_manifest = [{ asset_id: source.id, asset_type: "animation", metadata: {
    filename: "animation-升级.json", display_name: "升级动画配置专用验收", mime_type: "application/json",
    data_url: `data:application/json;base64,${fs.readFileSync(source.files.new.path).toString("base64")}`,
  } }];
  fs.writeFileSync(process.env.AGENTVN_TEST_PROJECT, JSON.stringify(p), { flag: "wx" });
  report.fixture = { input: process.env.AGENTVN_TEST_PROJECT, sha256: sha(process.env.AGENTVN_TEST_PROJECT), projectId: p.project_id };
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(30000); page.on("pageerror", e => report.pageErrors.push(String(e)));
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await step("Public import seeds only the isolated project; real homepage and animation asset picker bind it", async () => {
    const deadline = Date.now() + 60000;
    let healthy = false;
    while (Date.now() < deadline) {
      try { healthy = (await fetch(`http://127.0.0.1:${launch.backendPort}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (healthy) break; await new Promise(r => setTimeout(r, 100));
    }
    assert(healthy);
    const response = await fetch(`http://127.0.0.1:${launch.backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent("动画素材隔离工程.vnproj") },
      body: fs.readFileSync(process.env.AGENTVN_TEST_PROJECT), signal: AbortSignal.timeout(30000) });
    const result = await response.json(); assert(response.ok && result.ok);
    await page.reload(); await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: p.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await page.locator('.react-flow__node[data-id="scene"]').click();
    const card = page.locator(".command-card").nth(1); await card.locator(".command-card-summary").click();
    await card.locator('[data-help-key="command.animation.animationId.openPicker"]').click();
    await page.locator('[data-help-key="command.animation.animationId.select"][data-asset-id="qa_animation"]').click();
    const actual = await page.evaluate(() => window.__AGENTVN_EDITOR_STORE__.getState().nodes.find(n => n.id === "scene").data.scene.commands[1]);
    assert.equal(actual.animation_id, source.id); assert.deepEqual(actual.params, { duration: 1600 });
    await shot("dedicated-animation-picker"); return actual;
  });
  await step("Actual publish UI exports exact selected animation ID and upgraded JSON bytes", () => publish("agentvn"));
  await step("Actual layout switch then publish preserves the same animation data", async () => {
    await page.getByRole("button", { name: "关闭发布与打包", exact: true }).click(); await settleEditor(page);
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
    await page.locator('.runtime-layout-type-switch [data-layout-type-option="renpy"]:visible').click();
    await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
    return publish("renpy");
  });
  // Disconnect only this debugger. The wrapper owns stopping the Editor after
  // Player observations, so a process failure cannot strand the original profile.
  await browser.close(); browser = null; page = null;
  for (const layout of ["agentvn", "renpy"]) {
    runtime = new InstalledRuntimeSession({ prep, fixture: p, cartridges: report.cartridges, out: work, report, save,
      installId: `qa-animation-asset-${layout}-20261019` });
    await step(`Real installed ${layout} Player dispatches the authored ID; inspect actual animation rather than infer JSON consumption`, async () => {
      await runtime.start(layout, false);
      await runtime.page.getByTestId("start-new-game").click(); await runtime.ready("playing");
      await runtime.command("ui_acceptance", 0);
      await runtime.page.locator(".dialog-box").click();
      await runtime.page.waitForFunction(() => window.__AGENTVN_RUNTIME_ANIMATION_LOG__?.some(e =>
        e.animation_id === "qa_animation" && ["animate-start", "animate-error", "skipped"].includes(e.event)));
      const actual = await runtime.page.evaluate(() => ({
        log: window.__AGENTVN_RUNTIME_ANIMATION_LOG__.filter(e => e.animation_id === "qa_animation"),
        active: document.getAnimations().map(a => ({ target: a.effect?.target?.className,
          keyframes: a.effect?.getKeyframes(), timing: a.effect?.getTiming() })),
      }));
      await runtime.command("ui_acceptance", 2);
      actual.finished = await runtime.page.evaluate(() => window.__AGENTVN_RUNTIME_ANIMATION_LOG__.filter(e => e.animation_id === "qa_animation"));
      assert(actual.log.some(e => e.event === "animate-start"), JSON.stringify(actual));
      await runtime.shot("animation-command-finished"); await runtime.stop(); runtime = null;
      return actual;
    });
  }
  assert.equal(report.checks.length, 5); assert(report.checks.every(c => c.status === "PASS")); assert.deepEqual(report.pageErrors, []);
  report.status = "PASS";
  report.consumerConclusion = "BLOCKED";
  report.qualification = "Picker/export/dispatch observation PASS only. Legacy JSON has empty frames and no defined consumption schema; fallback dispatch does not prove file decoding, nor prove a visual defect. Keep full JSON consumption unaccepted and ask before changing format/runtime.";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) await shot("failure").catch(() => {});
}).finally(async () => {
  try { await runtime?.stop(); await browser?.close(); } catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
    consumerConclusion: report.consumerConclusion, error: report.error }));
});
