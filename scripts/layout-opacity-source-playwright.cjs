"use strict";
// Actual top-level UI, real isolated backend and actual Runtime iframe.
// Store imports below are read-only observations, never writes or model calls.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const isolation = resolveAcceptancePaths(), smoke = process.argv.includes("--smoke");
const focused = smoke || process.argv.includes("--roundtrip");
const root = path.resolve(__dirname, "..");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sourceFiles = ["editor/src/components/advanced/RenpyTitleEditor.tsx",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx", "GameCli_framework/src/components/shell/MainMenu.tsx",
  "shared/cartridge/uiSkin.ts"];
const report = { status: "RUNNING", at: new Date().toISOString(), isolation, cases: [], modelRequests: 0,
  sources: sourceFiles.map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) })),
  testSha256: sha(fs.readFileSync(__filename)),
  scope: "Source Chromium + isolated real backend + Runtime iframe; not native Dev or installed Release" };
let host, browser;
async function snapshot(page) {
  return page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const { useEditorStore } = await import("/src/store/editorStore.ts");
    const p = useProjectStore.getState(), g = useEditorStore.getState();
    return { id: p.projectId, settings: p.settings, nodes: g.nodes, edges: g.edges, assets: p.assetManifest };
  });
}
const profile = s => s.settings.runtimeUILayoutProfiles.profiles;
async function openLayout(page) {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await settleEditor(page);
  const renpy = page.locator('[data-layout-type-option="renpy"]:visible');
  if (await renpy.getAttribute("aria-pressed") !== "true") await renpy.click();
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
}
async function save(page) {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
}
async function titlePreview(page) {
  await page.locator(".renpy-title-editor .runtime-layout-sidebar")
    .getByRole("button", { name: "标题主页", exact: true }).click();
  await page.getByTestId("renpy-page-region-editor").locator('[data-component-id="title_hero"]').click();
  const toggle = page.getByTestId("renpy-title-runtime-preview-toggle");
  if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
}
async function observe(page, selector = ".main-menu-title-hero-background") {
  await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor({ timeout: 45000 });
  const frame = page.frames().find(f => f.parentFrame() && f.url().includes("gamecli-preview"));
  assert(frame); await settleRuntime(frame);
  const runtime = await frame.locator(selector).first().evaluate(host => {
    const n = host.querySelector(":scope > [data-ui-opacity-layer=background]") ?? host;
    const s = getComputedStyle(n), r = n.getBoundingClientRect();
    let inheritedOpacity = 1;
    for (let p = n.parentElement; p; p = p.parentElement) inheritedOpacity *= Number(getComputedStyle(p).opacity);
    return { background: s.backgroundColor, opacity: Number(s.opacity), inheritedOpacity,
      rect: r.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth };
  });
  const backgroundAlpha = runtime.background.startsWith("rgba(")
    ? Number(runtime.background.match(/,\s*([\d.]+)\)$/)[1]) : 1;
  return { displayed: Number(await page.getByLabel("页面背景不透明度", { exact: true }).inputValue()),
    source: await page.getByTestId("renpy-page-style-backgroundOpacity-source").innerText(),
    runtime: { ...runtime, backgroundAlpha,
      effectiveBackgroundAlpha: backgroundAlpha * runtime.opacity * runtime.inheritedOpacity } };
}
function check(item, name, body) {
  try { body(); item.checks.push({ name, status: "PASS" }); }
  catch (error) { item.checks.push({ name, status: "FAILED", error: String(error.stack || error) }); }
}
(async () => {
  host = await startEditorAcceptance(isolation.output);
  fs.copyFileSync(__filename, path.join(isolation.output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  report.service = { url: host.url, backendUrl: host.backendUrl, backendPid: host.backendPid,
    frontendPid: host.server.pid, runId: host.server.runId };
  browser = await chromium.launch();
  for (const [width, height] of focused ? desktopViewports.slice(0, 1) : desktopViewports)
    for (const dpr of focused ? [1] : [1, 2]) for (const motion of focused ? ["no-preference"] : ["no-preference", "reduce"]) {
      const item = { width, height, dpr, motion, status: "RUNNING", checks: [], errors: [], observations: [] };
      report.cases.push(item);
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: motion });
      const page = await context.newPage(); page.setDefaultTimeout(40000);
      page.on("pageerror", e => item.errors.push(String(e)));
      await page.route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
        if (route.request().method() !== "POST") return route.continue();
        report.modelRequests++; return route.abort();
      });
      try {
        await host.open(page); await settleEditor(page); await openLayout(page); await titlePreview(page);
        const baseline = await snapshot(page);
        check(item, "no-local-background-retains-existing-element-default", () => {
          assert.equal(baseline.settings.runtimeUILayout.layout_type, "renpy");
        });
        item.noBackgroundDisplayed = Number(await page.getByLabel("页面背景不透明度", { exact: true }).inputValue());
        assert.equal(item.noBackgroundDisplayed, 1);
        await page.getByLabel("页面背景色", { exact: true }).fill("#24384c");
        item.inherited = await observe(page);
        check(item, "inherited-author-value-matches-runtime-background", () => {
          assert.equal(item.inherited.source, "主题继承");
          assert.equal(item.inherited.runtime.backgroundAlpha, .78, "Preserve existing material default");
          assert.equal(item.inherited.displayed, item.inherited.runtime.backgroundAlpha);
        });
        for (const value of [0, .5, 1]) {
          await page.getByLabel("页面背景不透明度", { exact: true }).fill(String(value));
          const actual = await observe(page); item.observations.push({ value, ...actual });
          check(item, `explicit-${value}-matches-existing-runtime-and-persists`, () => {
            assert.equal(actual.source, "覆盖"); assert.equal(actual.displayed, value);
            assert.equal(actual.runtime.effectiveBackgroundAlpha, value);
          });
          await save(page);
          const saved = await snapshot(page);
          assert.equal(profile(saved).renpy.screens.find(s => s.screen_id === "title")
            .components.find(c => c.component_id === "title_hero").style.backgroundOpacity, value);
          assert.deepEqual(profile(saved).agentvn, profile(baseline).agentvn);
          assert.deepEqual(saved.nodes, baseline.nodes); assert.deepEqual(saved.edges, baseline.edges);
        }
        const property = page.getByTestId("renpy-page-style-property-backgroundOpacity");
        await property.getByRole("button", { name: "恢复主题继承", exact: true }).click();
        item.restored = await observe(page);
        check(item, "restore-inheritance-returns-to-original-runtime-without-freezing-default", () => {
          assert.equal(item.restored.displayed, .78); assert.equal(item.restored.source, "主题继承");
          assert.equal(item.restored.runtime.backgroundAlpha, .78); assert.equal(item.restored.runtime.opacity, 1);
        });
        await save(page); const final = await snapshot(page);
        const backend = await (await fetch(`${host.backendUrl}/api/project/projects/${final.id}`)).json();
        assert(backend.ok);
        assert.deepEqual(backend.data.editor_settings.runtimeUILayoutProfiles, final.settings.runtimeUILayoutProfiles);
        assert.equal(Object.hasOwn(profile(final).renpy.screens.find(s => s.screen_id === "title")
          .components.find(c => c.component_id === "title_hero").style, "backgroundOpacity"), false);
        item.persisted = final.settings.runtimeUILayoutProfiles;
        await page.reload();
        await page.locator('[data-help-key="home.recentProject"]').first().click();
        await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await openLayout(page); await titlePreview(page);
        item.reopened = await observe(page);
        check(item, "real-backend-reopen-preserves-absent-override-and-other-profile", () => {
          assert.equal(item.reopened.displayed, .78); assert.equal(item.reopened.runtime.backgroundAlpha, .78);
          assert.deepEqual(profile(final).agentvn, profile(baseline).agentvn);
        });
        if (!smoke) {
          item.otherPages = [];
          for (const [id, label, component, content] of [
            ["preferences", "选项", "settings_group", ".settings-renpy"],
            ["save_load", "存档/读档", "save_grid", ".save-grid"],
            ["history", "历史", "history_list", ".history-list"],
            ["about", "关于", "about_panel", ".about-card"],
            ["help", "帮助", "help_panel", ".help-card"],
            ["gallery", "画廊", "gallery_grid", ".gallery-grid"],
          ]) {
            await page.locator(".renpy-title-editor .runtime-layout-sidebar")
              .getByRole("button", { name: label, exact: true }).click();
            await page.locator(`.renpy-title-editor[data-editor-page="${id}"]`).waitFor();
            await page.getByTestId("renpy-page-region-editor").locator(`[data-component-id="${component}"]`).click();
            await page.getByLabel("页面背景色", { exact: true }).fill("#24384c");
            const actual = await observe(page, content);
            item.otherPages.push({ id, ...actual });
            check(item, `${id}-background-inherits-the-same-runtime-value`, () => {
              assert.equal(actual.source, "主题继承");
              assert.equal(actual.displayed, actual.runtime.backgroundAlpha);
              assert.equal(actual.runtime.backgroundAlpha, .78);
            });
          }
          await save(page);
          const beforeSwitch = await snapshot(page);
          await page.locator('[data-layout-type-option="agentvn"]:visible').click();
          await page.locator('.runtime-layout-designer[data-layout-type="agentvn"]').waitFor();
          await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
          const agent = await snapshot(page);
          await page.locator('[data-layout-type-option="renpy"]:visible').click();
          await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
          await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
          check(item, "actual-type-roundtrip-does-not-mutate-either-profile", () => {
            assert.deepEqual(profile(agent).agentvn, profile(baseline).agentvn);
            assert.deepEqual(profile(agent).renpy, profile(beforeSwitch).renpy);
          });
          const current = await snapshot(page);
          assert.deepEqual(profile(current), profile(beforeSwitch));
          await titlePreview(page);
          await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
          const pending = page.waitForEvent("download");
          await page.locator('[data-help-key="toolbar.saveProject"]').click();
          const download = await pending, file = path.join(isolation.output, `${width}-${dpr}-${motion}.vnproj`);
          await download.saveAs(file);
          const zip = await JSZip.loadAsync(fs.readFileSync(file));
          const portable = JSON.parse(await zip.file("project.json").async("string"));
          item.portable = { path: file, sha256: sha(fs.readFileSync(file)) };
          check(item, "real-save-project-download-preserves-inheritance-and-both-profiles", () => {
            assert.deepEqual(portable.editor_settings.runtimeUILayoutProfiles, current.settings.runtimeUILayoutProfiles);
            assert.equal(Object.hasOwn(portable.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "title")
              .components.find(c => c.component_id === "title_hero").style, "backgroundOpacity"), false);
          });
          await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
          await page.reload();
          await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
            .some(n => n instanceof HTMLInputElement && !n.disabled));
          await page.locator(".project-import-button input").first().setInputFiles(file);
          await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await openLayout(page); await titlePreview(page);
          item.reimported = await observe(page);
          const reimported = await snapshot(page);
          check(item, "real-portable-file-import-and-runtime-preserve-inherited-value", () => {
            assert.deepEqual(profile(reimported), profile(current));
            assert.equal(item.reimported.displayed, .78);
            assert.equal(item.reimported.runtime.backgroundAlpha, .78);
          });
        }
        const input = page.getByLabel("页面背景不透明度", { exact: true });
        await input.scrollIntoViewIfNeeded(); await input.click({ trial: true });
        item.geometry = await input.evaluate(n => {
          const r = n.getBoundingClientRect();
          return { rect: r.toJSON(), viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
            hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        check(item, "real-ui-hit-bounds-and-display-parameters", () => {
          const g = item.geometry;
          assert.deepEqual(g.viewport, { width, height, dpr, reduced: motion === "reduce" });
          assert(g.hit && g.overflow <= 1 && g.rect.left >= 0 && g.rect.top >= 0
            && g.rect.right <= width + 1 && g.rect.bottom <= height + 1);
          assert.equal(item.reopened.runtime.overflow, 0); assert.deepEqual(item.errors, []);
        });
        const pngPath = path.join(isolation.output, `${width}-dpr${dpr}-${motion}.png`);
        const display = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
        const before = await display();
        await page.screenshot({ path: pngPath });
        const after = await display();
        const png = fs.readFileSync(pngPath);
        assert.deepEqual(before, after); assert.deepEqual(before, item.geometry.viewport);
        assert.equal(png.readUInt32BE(16), width * dpr); assert.equal(png.readUInt32BE(20), height * dpr);
        item.screenshot = { path: pngPath, sha256: sha(png), before, after };
        item.status = item.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
      } catch (e) {
        item.status = "FAILED"; item.error = String(e.stack || e);
        await page.screenshot({ path: path.join(isolation.output, `failure-${width}-${dpr}-${motion}.png`) }).catch(() => {});
      } finally { await context.close(); }
      console.log(JSON.stringify({ width, dpr, motion, status: item.status, error: item.error,
        failed: item.checks.filter(c => c.status === "FAILED") }));
    }
  assert.equal(report.cases.length, focused ? 1 : 12); assert.equal(report.modelRequests, 0);
  report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); await host?.stop();
  let serviceResponds = false;
  if (host) { try { serviceResponds = (await fetch(host.url, { signal: AbortSignal.timeout(1000) })).ok; } catch {} }
  report.cleanup = { status: !serviceResponds ? "PASS" : "FAILED", serviceResponds };
  if (serviceResponds) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(isolation.output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output: isolation.output }));
});
