"use strict";
// Actual installed Editor: graphical resource settings and safe code controls.
// The controlled fixture is imported through the public backend. No store/Tauri
// mocks, source frontend server, model requests or user projects.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor, settleRuntime, projectSnapshot, select } = require("./lib/installed-acceptance.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, "..");
const attempt = process.argv[2]; assert.equal(attempt, "53");
const out = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const installationFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const authorFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-50/report.json";
const prior = JSON.parse(fs.readFileSync(authorFile, "utf8")); assert.equal(prior.status, "PASS");
const p = fixture("installed-1924-control-code"); p.title = "安装版普通设置与安全代码独立工程";
p.nodes[0].data.openingAudio = [];
p.editor_settings.runtimeUILayoutProfiles = structuredClone(prior.profiles);
p.editor_settings.runtimeUILayoutProfiles.activeType = "renpy";
p.editor_settings.runtimeUILayout = structuredClone(p.editor_settings.runtimeUILayoutProfiles.profiles.renpy);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" fill="#394d78"/><circle cx="48" cy="32" r="16" fill="#c6d4eb"/></svg>';
p.asset_manifest = [{ asset_id: "qa-control-image", asset_type: "ui", metadata: {
  filename: "独立背景.svg", display_name: "控件背景验收图", mime_type: "image/svg+xml",
  width: 96, height: 64, source: "imported", data_url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
} }];
const input = path.join(out, "控件代码独立工程.vnproj");
fs.writeFileSync(input, JSON.stringify(p), { flag: "wx" });
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], errors: [], launches: [],
  cleanups: [], screenshots: [], modelRequests: 0, installation: installationFile,
  scope: "INSTALLED_1924_ORDINARY_AND_SAFE_CODE_AUTHOR_RESTART_NOT_PORTABLE_EXPORT_OR_PLAYER_ACTIONS",
  fixture: { path: input, sha256: sha(input), profilesSource: authorFile, profilesSourceSha256: sha(authorFile),
    boundary: "CONTROLLED_BASELINE_PROFILES_AND_TEST_IMAGE_PUBLIC_IMPORT" } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedReleaseSession({ installationFile, out, input, report, save });
let page, prepared = false;
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action,
    "-RunDirectory", out, "-CodexCacheView"], { encoding: "utf8", windowsHide: true, timeout: 30000 });
  (report.cache ??= []).push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }); save();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
const click = async n => { await n.scrollIntoViewIfNeeded(); await n.click(); };
async function enter() {
  await page.locator(".project-home").waitFor();
  await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: p.title }));
  await settleEditor(page);
  await click(page.locator('[data-workspace-surface="options"]:visible'));
  await click(page.locator('[data-help-key="advanced.tab.layout"]:visible'));
  await settleEditor(page);
  const renpy = page.locator('[data-layout-type-option="renpy"]:visible');
  if (await renpy.getAttribute("aria-pressed") !== "true") await click(renpy);
  await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
  await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
  await click(page.getByTestId("renpy-title-static-preview-toggle"));
}
async function persist() {
  await click(page.locator('[data-help-key="layout.save"]:visible'));
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
  const state = await projectSnapshot(host.current.ports[0]);
  const profiles = state.settings.runtimeUILayoutProfiles;
  assert.equal(profiles.activeType, "renpy");
  assert.deepEqual(profiles.profiles.agentvn, prior.profiles.profiles.agentvn, "Other layout changed");
  return profiles;
}
function control(profiles) {
  return profiles.profiles.renpy.screens.find(s => s.screen_id === "title")
    .components.find(c => c.component_id === "title_start_button");
}
const cssFor = i => `.root { background-color: #${(0x742b59 + i * 0x010101).toString(16)}; border-radius: 6px; } .body { color: white; }`;
const rgbFor = i => { const hex = (0x742b59 + i * 0x010101).toString(16);
  return `rgb(${[0, 2, 4].map(n => parseInt(hex.slice(n, n + 2), 16)).join(", ")})`; };
const html = '<span class="root"><span class="body"><slot name="content"></slot></span></span>';
const matrix = [[1920, 1080], [2560, 1440], [3840, 2160]]
  .flatMap(([width, height]) => [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
async function colorIs(target, value) {
  await target.evaluate((node, wanted) => new Promise((resolve, reject) => {
    const start = performance.now();
    const sample = () => {
      if (getComputedStyle(node).backgroundColor === wanted) return resolve(true);
      if (performance.now() - start > 10000) return reject(Error("Actual control color not ready: " + getComputedStyle(node).backgroundColor));
      requestAnimationFrame(sample);
    }; sample();
  }), value);
}
(async () => {
  save(); cache("SelfTest"); cache("Prepare"); prepared = true;
  page = await host.start();
  const imported = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "content-type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input),
    signal: AbortSignal.timeout(30000) });
  const payload = await imported.json(); assert(imported.ok && payload.ok && payload.data.project_id === p.project_id);
  await page.reload(); await enter();
  for (const [i, display] of matrix.entries()) {
    await host.metrics(display);
    const row = { display, status: "RUNNING", checks: [], startedAt: new Date().toISOString() };
    report.cases.push(row); save();
    const checked = (name, detail) => { row.checks.push({ name, status: "PASS", detail }); save(); };
    await click(page.getByTestId("renpy-title-static-preview-toggle"));
    const start = page.locator('.renpy-editor-preview .renpy-title-action[data-ui-component-id="title_start_button"]');
    await click(start);
    assert.equal(await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_start_button"]').getAttribute("aria-pressed"), "true");
    const advanced = page.getByRole("checkbox", { name: "Ren’Py进阶代码编辑", exact: true });
    if (await advanced.isChecked()) await advanced.uncheck();
    const appearance = page.getByTestId("renpy-control-appearance");
    await appearance.getByLabel("当前控件背景颜色", { exact: true }).fill("#204a68");
    const fontBefore = await start.evaluate(n => getComputedStyle(n).fontSize);
    await select(page, "当前控件背景图", "控件背景验收图");
    await select(page, "背景图适配", "完整显示");
    const image = await start.evaluate(async node => {
      const style = getComputedStyle(node), match = /^url\("(.*)"\)$/.exec(style.backgroundImage);
      if (!match) throw Error("Expected one actual project background image");
      const response = await fetch(match[1]); if (!response.ok) throw Error("Selected image failed to load");
      return { fit: style.backgroundSize, font: style.fontSize, bytes: await response.text() };
    });
    assert.equal(image.bytes, svg); assert.equal(image.fit, "contain"); assert.equal(image.font, fontBefore);
    checked("Ordinary preview selection, actual project image bytes/fit and inherited font", image);
    await advanced.check();
    const enable = page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true });
    if (await enable.isVisible()) await click(enable);
    const htmlField = page.getByRole("textbox", { name: "当前控件 HTML", exact: true });
    const cssField = page.getByRole("textbox", { name: "当前控件 CSS", exact: true });
    await htmlField.fill(html); await cssField.fill(cssFor(i)); await colorIs(start, rgbFor(i));
    assert.equal(await appearance.getByLabel("当前控件背景颜色", { exact: true }).isDisabled(), true);
    assert.equal(await start.locator(".body").innerText(), await start.innerText());
    checked("Safe HTML slot and CSS override retain button content; graphical conflict visible",
      { css: cssFor(i), html, tag: await start.evaluate(n => n.tagName) });
    await cssField.fill("body { color: red; }");
    await page.getByRole("alert").filter({ hasText: "代码未应用" }).waitFor();
    assert(await page.locator('[data-help-key="layout.save"]:visible').isDisabled());
    await colorIs(start, rgbFor(i)); await cssField.fill(cssFor(i));
    await htmlField.fill('<script>window.__qaUnsafeExecuted = true</script><slot name="content"></slot>');
    await page.getByRole("alert").filter({ hasText: "代码未应用" }).waitFor();
    assert(await page.locator('[data-help-key="layout.save"]:visible').isDisabled());
    assert.equal(await page.evaluate(() => window.__qaUnsafeExecuted), undefined);
    await colorIs(start, rgbFor(i)); await htmlField.fill(html);
    checked("Invalid CSS and executable HTML refused; save blocked and last valid preview retained");
    await advanced.uncheck(); await colorIs(start, "rgb(32, 74, 104)");
    const paused = await persist(), pausedControl = control(paused);
    assert.equal(paused.profiles.renpy.advancedPresentationEnabled, false);
    assert.equal(pausedControl.presentation.css, cssFor(i)); assert.equal(pausedControl.presentation.html, html);
    checked("Disabling code restores graphical appearance without deleting persisted source", pausedControl);
    await advanced.check();
    assert.equal(await cssField.inputValue(), cssFor(i)); await colorIs(start, rgbFor(i));
    const final = await persist(); assert.equal(final.profiles.renpy.advancedPresentationEnabled, true);
    assert.equal(control(final).presentation.css, cssFor(i));
    checked("Reenable restores source and appearance; other layout remains byte-equivalent");
    await click(page.getByTestId("renpy-title-runtime-preview-toggle"));
    const viewport = page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]');
    await viewport.waitFor({ timeout: 45000 });
    const frame = await (await viewport.locator("iframe").elementHandle()).contentFrame();
    await settleRuntime(frame);
    const live = frame.locator('.renpy-title-action[data-ui-component-id="title_start_button"]');
    await colorIs(live, rgbFor(i));
    const actual = await live.evaluate(async node => {
      const s = getComputedStyle(node), r = node.getBoundingClientRect();
      const match = /^url\("(.*)"\)$/.exec(s.backgroundImage);
      const bytes = match ? await (await fetch(match[1])).text() : null;
      return { tag: node.tagName, color: s.backgroundColor, radius: s.borderRadius, image: bytes,
        rect: r.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth,
        width: innerWidth, height: innerHeight, slotCount: node.dataset.controlSlotCount };
    });
    assert.equal(actual.image, svg); assert.equal(actual.tag, "BUTTON"); assert.equal(actual.slotCount, "1");
    assert(actual.overflow <= 1 && actual.rect.width > 0 && actual.rect.height > 0
      && actual.rect.left >= 0 && actual.rect.top >= 0
      && actual.rect.right <= actual.width + 1 && actual.rect.bottom <= actual.height + 1);
    checked("Actual installed Runtime iframe consumes safe structure, color and image bytes", actual);
    await host.shot(`code-${display.width}-dpr${display.dpr}-${display.reduced ? "reduced" : "ordinary"}`);
    row.status = "PASS"; row.finishedAt = new Date().toISOString(); save();
    console.log(`PASS safe-code ${display.width}/dpr${display.dpr}/${display.reduced}`);
  }
  report.profiles = await projectSnapshot(host.current.ports[0]).then(s => s.settings.runtimeUILayoutProfiles);
  await host.stop("Owned-process restart; normal close not claimed"); page = await host.start(); await enter();
  const restored = await projectSnapshot(host.current.ports[0]);
  assert.deepEqual(restored.settings.runtimeUILayoutProfiles, report.profiles);
  await click(page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_start_button"]'));
  assert.equal(await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).inputValue(), cssFor(11));
  await colorIs(page.locator('.renpy-editor-preview .renpy-title-action[data-ui-component-id="title_start_button"]'), rgbFor(11));
  report.restart = { status: "PASS", fullProcessRestart: true };
  assert.equal(report.cases.length, 12); assert(report.cases.every(c => c.status === "PASS" && c.checks.length === 6));
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) {
    report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-8000);
    try { await host.shot("failure"); } catch (e) { report.captureError = String(e); }
  }
}).finally(async () => {
  try { await host.stop("finally"); if (prepared) { cache("Restore"); report.nativeCacheRestoration = "PASS"; } }
  catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.tool = { path: __filename, sha256: sha(__filename) }; save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
