"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip"), { chromium } = require("../editor/node_modules/playwright");
const { sha256, settleEditor, realDownload } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const run = process.env.AGENTVN_RUNTIME_ACCEPTANCE_RUN || "D:/AgentVN/output/installed-runtime-abilities-20261018-01";
const work = process.env.AGENTVN_RUNTIME_ACCEPTANCE_WORK || "F:/AgentVN-QA-InstalledRuntimeAbilities-20261018-01";
assert(path.dirname(path.resolve(run)) === path.resolve("D:/AgentVN/output"));
assert([path.resolve("F:/"), path.resolve("F:/AgentVN/QA")].includes(path.dirname(path.resolve(work))));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const out = process.argv[2]; assert(out && !fs.existsSync(out)); fs.mkdirSync(out);
const launch = read(path.join(run, "launch.json")), fixtureFile = process.argv[3] || path.join(run, "fixtures.json"),
  fixture = read(fixtureFile);
const prep = read(path.join(run, "preparation.json")); assert(prep.profiles.every(p => fs.existsSync(p.held)));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], cartridges: [], screenshots: [],
  pageErrors: [], realModelRequests: 0, productChanges: 0,
  scope: "ACTUAL_INSTALLED_EDITOR_UI_EXPORT_WITH_CONTROLLED_PROJECT_SEED_NOT_NATIVE_PROJECT_PICKER",
  fixtureFile, fixtureSha256: sha256(fs.readFileSync(fixtureFile)), error: null };
let browser, page, cdp; const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const previousFile = process.argv[4];
async function step(name, fn) {
  const c = { name, status: "RUNNING" }; report.checks.push(c); save();
  try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; } finally { save(); }
}
async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected)); save(); }
async function completeEnvironmentIfPresent() {
  const panel = page.locator(".windows-env-panel");
  if (await panel.count()) await page.waitForFunction(() => {
    const n = document.querySelector(".windows-env-panel");
    return ["passed", "failed"].includes(n?.getAttribute("data-environment-verification"));
  }, null, { timeout: 120000 });
  const complete = page.locator(".android-env-import-backdrop:visible").filter({ hasText: "环境检测已完成" });
  if (await complete.count()) {
    await complete.getByRole("button", { name: "完成", exact: true }).click(); await complete.waitFor({ state: "hidden" });
  }
}
async function publish(layout) {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
  await page.locator(".cartridge-export-panel").waitFor(); await completeEnvironmentIfPresent();
  await page.locator('[data-package-stage="settings"]').click();
  await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warn = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warn.isVisible()) await warn.click();
  report.warnings ??= {}; report.warnings[layout] = await page.locator(".preflight-check.is-warning").allTextContents();
  const confirm = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await confirm.isVisible()) await confirm.check();
  const directory = path.join(work, `${path.basename(out)}-cartridge-${layout}`); assert(!fs.existsSync(directory)); fs.mkdirSync(directory);
  const cartridge = await realDownload(page, cdp, directory, page.locator('[data-help-key="package.export"]'));
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  const skinBytes = await zip.file("ui/layout.json").async("nodebuffer"), skin = JSON.parse(skinBytes);
  assert.equal(manifest.game_id, fixture.projectId); assert.equal(skin.layout_type || "agentvn", layout);
  assert.equal(script.default_dialog_presentation, "nvl");
  if (!fixture.capacity && !fixture.voice) {
  assert.equal(script.characters.find(c => c.character_id === "alice").dialog_presentation, "bubble");
  assert.equal(script.characters.find(c => c.character_id === "nvl_person").dialog_presentation, "nvl");
  assert.equal(script.scenes.find(s => s.scene_id === "ordinary_nvl").commands[1].text, fixture.text.mid);
  assert.equal(script.scenes.find(s => s.scene_id === "ordinary_nvl").commands[2].text, fixture.text.extreme);
  assert(script.scenes.find(s => s.scene_id === "ordinary_nvl").commands.some(c => c.clear_nvl_page_before === true));
  }
  if (fixture.voice) {
    const scene = script.scenes.find(s => s.scene_id === "voice_restore"); assert(scene);
    assert.deepEqual(scene.commands.filter(c => c.type === "dialog").map(c => ({
      text: c.text, voice: c.voice, mode: c.presentation_mode,
    })), fixture.voice.dialogs);
    const audio = manifest.assets.find(a => a.asset_id === fixture.voice.assetId); assert(audio);
    assert.equal(sha256(await zip.file(audio.path).async("nodebuffer")), fixture.voice.sha256);
  }
  if (fixture.capacity) {
    const scene = script.scenes.find(s => s.scene_id === "nvl_capacity"); assert(scene);
    assert.deepEqual(scene.commands.filter(c => c.type === "narration").map(c => c.text), fixture.capacity.text);
    assert.equal(script.entry_scene_id, "qa_entry");
    const branch = scene.commands.find(c => c.type === "choice");
    assert.equal(branch.choices.length, 3);
  }
  const sprite = manifest.assets.find(a => a.asset_id === "qa_actor"); assert(sprite);
  assert.equal(sha256(await zip.file(sprite.path).async("nodebuffer")), fixture.spriteSha256);
  const item = { ...cartridge, layout, layoutSha256: sha256(skinBytes), scriptSha256: sha256(await zip.file("script.json").async("nodebuffer")),
    manifestSha256: sha256(await zip.file("manifest.json").async("nodebuffer")), gameId: manifest.game_id,
    runtimeVersion: manifest.runtime_version, scriptSchema: script.schema_version };
  if (report.cartridges.length) assert.equal(item.scriptSha256, report.cartridges[0].scriptSha256,
    "Changing only layout must not rewrite the exported story");
  report.cartridges.push(item); await shot(`${layout}-actual-cartridge-export`); return item;
}
(async () => {
  assert.equal(sha256(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  assert.equal(sha256(fs.readFileSync(fixture.input)), fixture.inputSha256);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(45000); page.on("pageerror", e => report.pageErrors.push(String(e)));
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (!previousFile) await step("Controlled project seed followed by actual homepage entry in frozen installed Editor", async () => {
    const response = await fetch(`http://127.0.0.1:${launch.backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(fixture.input)) },
      body: fs.readFileSync(fixture.input), signal: AbortSignal.timeout(30000) });
    const result = await response.json(); assert(response.ok && result.ok && result.data.project_id === fixture.projectId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    assert.equal(await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().projectId), fixture.projectId);
    return { projectId: fixture.projectId, nativeProjectPickerClaim: false };
  });
  if (!previousFile) await step("Actual AgentVN UI cartridge export preserves inheritance, story modes and real sprite bytes", () => publish("agentvn"));
  else {
    const previous = read(previousFile);
    assert.equal(previous.fixtureSha256, report.fixtureSha256);
    assert.equal(previous.cartridges.length, 1);
    assert.equal(sha256(fs.readFileSync(previous.cartridges[0].path)), previous.cartridges[0].sha256);
    report.cartridges.push(previous.cartridges[0]);
    report.previousEvidence = { path: previousFile, sha256: sha256(fs.readFileSync(previousFile)),
      status: previous.status, reusedPassingChecksOnly: true };
  }
  await step("Real layout-type toggle then Renpy UI export preserves the exact same story and game identity", async () => {
    const close = page.getByRole("button", { name: "关闭发布与打包", exact: true });
    if (await close.isVisible()) { await close.click(); await settleEditor(page); }
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
    await page.locator('.runtime-layout-type-switch [data-layout-type-option="renpy"]:visible').click();
    await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
    return publish("renpy");
  });
  assert.equal(report.cartridges.length, 2); assert.equal(report.pageErrors.length, 0); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) { report.failureText = await page.locator("body").innerText().catch(() => ""); await shot("failure").catch(() => {}); }
}).finally(async () => {
  report.finishedAt = new Date().toISOString(); save(); await browser?.close();
  console.log(JSON.stringify({ status: report.status, cartridges: report.cartridges.length, error: report.error, out }));
});
