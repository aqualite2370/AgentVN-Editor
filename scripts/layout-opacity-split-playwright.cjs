"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { chromium } = require("../editor/node_modules/playwright");
const { resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const isolation = resolveAcceptancePaths(), smoke = process.argv.includes("--smoke");
const agentOnly = process.argv.includes("--agentvn-only");
const staticOnly = process.argv.includes("--static-only");
const portableOnly = process.argv.includes("--portable-only");
const root = path.resolve(__dirname, ".."), sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const report = { status: "RUNNING", at: new Date().toISOString(), cases: [], modelRequests: 0,
  scope: "Source browser + isolated real backend + real Runtime iframe; not installed or physical display" };
const sourceFiles = [
  "shared/cartridge/uiSkin.ts", "shared/cartridge/runtimeCapabilities.ts", "shared/cartridge/constants.ts",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx", "GameCli_framework/src/uiSkin/UILayoutOpacitySurface.tsx",
  "GameCli_framework/src/uiSkin/ui-layout-opacity.css",
  ...["MainMenu", "RenpyTitleView", "SettingsScreen", "SaveLoadScreen", "HistoryScreen", "AboutScreen", "HelpScreen", "GalleryScreen"]
    .map(n => `GameCli_framework/src/components/shell/${n}.tsx`),
  ...["RuntimeLayoutDesigner", "RenpyTitleEditor"].map(n => `editor/src/components/advanced/${n}.tsx`),
];
report.sources = sourceFiles.map(file => ({ file, sha256: sha(path.join(root, file)) }));
report.testSha256 = sha(__filename); report.matrix = [];
const pageCases = [
  ["标题主页", "title_hero", ".main-menu-title-hero-background"],
  ["选项", "settings_group", ".settings-renpy"],
  ["存档/读档", "save_grid", ".save-grid"], ["历史", "history_list", ".history-list"],
  ["关于", "about_panel", ".about-card"], ["帮助", "help_panel", ".help-card"], ["画廊", "gallery_grid", ".gallery-grid"],
];
let host, browser;
async function editorState(page) {
  return page.evaluate(async () => {
    const p = (await import("/src/store/projectStore.ts")).useProjectStore.getState();
    const g = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    return { id: p.projectId, settings: p.settings, nodes: g.nodes, edges: g.edges };
  });
}
async function open(page) {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  const type = page.locator('[data-layout-type-option="renpy"]:visible');
  if (await type.getAttribute("aria-pressed") !== "true") await type.click();
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
}
async function choose(page, label, id) {
  await page.locator(".renpy-title-editor .runtime-layout-sidebar").getByRole("button", { name: label, exact: true }).click();
  await page.getByTestId("renpy-page-region-editor").locator(`[data-component-id="${id}"]`).click();
  const toggle = page.getByTestId("renpy-title-runtime-preview-toggle");
  if (await toggle.count() && await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
}
async function observe(page, selector) {
  await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor({ timeout: 45000 });
  const preview = page.locator(".renpy-editor-runtime-viewport iframe");
  assert.equal(await preview.count(), 1, "Observe the actual layout preview, not the mounted node preview");
  const frame = await (await preview.elementHandle()).contentFrame();
  assert(frame); await settleRuntime(frame);
  return frame.locator(selector).first().evaluate(n => {
    const background = n.querySelector(":scope > [data-ui-opacity-layer=background]") ?? n;
    const content = n.matches(".main-menu-title-hero-background")
      ? n.closest(".renpy-title-view")?.querySelector(".renpy-title-heading")
      : n.querySelector(":scope > [data-ui-opacity-layer=content]");
    const bs = getComputedStyle(background), cs = content ? getComputedStyle(content) : null;
    const r = n.getBoundingClientRect();
    const entries = n.matches(".save-grid") ? [...n.querySelectorAll(".save-slot")]
      : n.matches(".gallery-grid") ? [...n.querySelectorAll(".gallery-item")]
      : n.matches(".settings-renpy") ? [...n.querySelectorAll(".settings-tabs, .settings-content, .settings-footer")] : [];
    const children = entries.map(e => {
      const b = e.getBoundingClientRect();
      return { className: e.className, rect: b.toJSON() };
    });
    const controls = [...n.querySelectorAll("button:not(:disabled), input:not(:disabled)")].map(e => {
      const b = e.getBoundingClientRect();
      const visible = b.width > 0 && b.height > 0 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1
        && b.left >= r.left - 1 && b.right <= r.right + 1;
      return { label: e.getAttribute("aria-label") || e.textContent, visible,
        hit: visible && e.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) };
    });
    return { background: bs.backgroundColor, backgroundOpacity: Number(bs.opacity),
      contentOpacity: cs ? Number(cs.opacity) : null, rect: r.toJSON(),
      overflow: document.documentElement.scrollWidth - innerWidth, children, controls };
  });
}
async function agentTitle(page) {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
  await page.locator('[data-layout-type-option="agentvn"]:visible').click();
  await page.locator('.runtime-layout-designer[data-layout-type="agentvn"]').waitFor();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
  await page.locator(".runtime-layout-sidebar").getByRole("button", { name: "标题主页", exact: true }).click();
  await page.locator('.runtime-layout-sidebar button[data-component-id="title_hero"]').click();
  const details = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^外观$/ }) });
  if (await details.getAttribute("open") === null) await details.locator("summary").click();
  await page.getByLabel("页面背景不透明度", { exact: true }).fill("0.4");
  await page.getByLabel("页面内容不透明度", { exact: true }).fill("0.7");
  const result = await page.locator('.runtime-layout-page-part.part-main_menu_hero').evaluate(n => {
    const bg = n.parentElement.querySelector(".part-main_menu_hero-background");
    return { backgroundOpacity: Number(getComputedStyle(bg).opacity), contentOpacity: Number(getComputedStyle(n).opacity) };
  });
  assert.equal(result.backgroundOpacity, .4, "AgentVN diagram background matches authoring");
  assert.equal(result.contentOpacity, .7, "AgentVN diagram content matches authoring");
  return result;
}
function assertGeometry(first, id) {
  assert(first.rect.width > 0 && first.rect.height > 0 && first.overflow <= 1);
  for (const child of first.children) {
    assert(child.rect.width > 0 && child.rect.height > 0, `${id}: child has no size`);
    assert(child.rect.left >= first.rect.left - 1 && child.rect.right <= first.rect.right + 1,
      `${id}: horizontal child overflow`);
  }
  if (id === "settings_group") {
    assert.equal(first.children.length, 3);
    for (const child of first.children) assert(child.rect.top >= first.rect.top - 1
      && child.rect.bottom <= first.rect.bottom + 1, "Settings panels must not clip");
    for (const control of first.controls) assert(control.visible && control.hit, `Settings control blocked: ${control.label}`);
  }
  if (id === "save_grid" || id === "gallery_grid") {
    assert(first.children.length >= 6, "Actual grid entries are present");
    assert(Math.abs(first.children[0].rect.top - first.children[1].rect.top) < 1, "Grid keeps multiple columns");
    assert(first.children[0].rect.right <= first.children[1].rect.left + 1, "Grid entries do not overlap");
  }
}
async function staticTitle(page) {
  await page.getByTestId("renpy-title-static-preview-toggle").click();
  const actual = await page.locator(".renpy-editor-preview .renpy-title-heading").evaluate(n => ({
    content: Number(getComputedStyle(n).opacity),
    background: Number(getComputedStyle(n.closest(".renpy-title-view").querySelector('[data-testid="renpy-imported-title-background"]')).opacity),
  }));
  assert.equal(actual.content, .8); assert.equal(actual.background, .5);
  await page.getByTestId("renpy-title-runtime-preview-toggle").click();
  return actual;
}
async function portableRoundtrip(page, item) {
  const result = { status: "RUNNING" };
  item.portableRoundtrip = result;
  const save = async () => {
    await page.locator('[data-help-key="layout.save"]:visible').click();
    await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
  };
  // A title without any material intentionally has no background layer.
  // Give this fixture a material before asserting the exported layer opacity.
  await page.getByLabel("页面背景色", { exact: true }).fill("#24384c");
  await page.getByLabel("页面背景不透明度", { exact: true }).fill("0.5");
  await page.getByLabel("页面内容不透明度", { exact: true }).fill("0.8");
  await save();
  await agentTitle(page);
  await save();
  const before = await editorState(page);
  const profiles = before.settings.runtimeUILayoutProfiles;
  for (const [type, background, content] of [["agentvn", .4, .7], ["renpy", .5, .8]]) {
    const style = profiles.profiles[type].screens.find(s => s.screen_id === "title")
      .components.find(c => c.component_id === "title_hero").style;
    assert.equal(style.backgroundOpacity, background);
    assert.equal(style.contentOpacity, content);
  }
  await page.locator('[data-workspace-surface="edit"]:visible').click();
  await settleEditor(page);
  const pending = page.waitForEvent("download");
  await page.locator('[data-help-key="toolbar.saveProject"]').click();
  const download = await pending, file = path.join(isolation.output, "双布局-双通道.vnproj");
  await download.saveAs(file);
  const zip = await require("../editor/node_modules/jszip").loadAsync(fs.readFileSync(file));
  const packed = JSON.parse(await zip.file("project.json").async("string"));
  assert.deepEqual(packed.editor_settings.runtimeUILayoutProfiles, profiles);
  assert.deepEqual(packed.editor_settings.runtimeUILayout, profiles.profiles[profiles.activeType]);
  result.portable = { path: file, sha256: sha(file) };
  result.bothProfilesPreserved = true;
  await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
    .some(n => n instanceof HTMLInputElement && !n.disabled));
  await page.locator(".project-import-button input").first().setInputFiles(file);
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  const imported = await editorState(page);
  assert.deepEqual(imported.settings.runtimeUILayoutProfiles, profiles);
  assert.deepEqual(imported.nodes, before.nodes); assert.deepEqual(imported.edges, before.edges);
  const stored = await (await fetch(`${host.backendUrl}/api/project/projects/${imported.id}`)).json();
  assert(stored.ok);
  assert.deepEqual(stored.data.editor_settings.runtimeUILayoutProfiles, profiles);
  result.backendPreserved = true; result.graphPreserved = true;
  await open(page); await choose(page, "标题主页", "title_hero");
  result.previewFrames = await Promise.all(page.frames().filter(f => f.parentFrame()).map(async frame => ({
    url: frame.url(), body: (await frame.locator("body").innerText().catch(() => "")).slice(0, 500),
    isLayoutPreview: await frame.frameElement().then(e => e.evaluate(n =>
      Boolean(n.closest(".renpy-editor-runtime-viewport")))).catch(() => false),
  })));
  const actual = await observe(page, ".main-menu-title-hero-background");
  assert.equal(actual.backgroundOpacity, .5); assert.equal(actual.contentOpacity, .8);
  Object.assign(result, { status: "PASS", types: ["agentvn", "renpy"], actual });
  return result;
}
async function displayMatrix(page) {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
  await page.locator('[data-layout-type-option="renpy"]:visible').click();
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
  const cdp = await page.context().newCDPSession(page);
  for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const motion of ["no-preference", "reduce"]) {
    const cell = { width, height, dpr, motion, pages: [], status: "RUNNING" }; report.matrix.push(cell);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: motion });
    for (const [label, id, selector] of pageCases) {
      await choose(page, label, id);
      const actual = await observe(page, selector); assertGeometry(actual, id);
      assert.equal(actual.backgroundOpacity, .5);
      assert.equal(actual.contentOpacity, id === "about_panel" ? 1 : .8);
      for (const name of ["页面背景不透明度", "页面内容不透明度"]) {
        const input = page.getByLabel(name, { exact: true });
        await input.scrollIntoViewIfNeeded(); await input.click({ trial: true });
      }
      cell.pages.push({ id, actual });
    }
    const display = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
    const before = await display(), file = path.join(isolation.output, `matrix-${width}-${dpr}-${motion}.png`);
    assert.deepEqual(before, { width, height, dpr, reduced: motion === "reduce" });
    const png = Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64");
    fs.writeFileSync(file, png, { flag: "wx" }); const after = await display();
    assert.deepEqual(before, after); assert.equal(png.readUInt32BE(16), width * dpr); assert.equal(png.readUInt32BE(20), height * dpr);
    cell.screenshot = { path: file, sha256: sha(file), before, after }; cell.status = "PASS";
    console.log(JSON.stringify({ displayMatrix: true, width, dpr, motion, pages: cell.pages.length, status: cell.status }));
  }
}
(async () => {
  host = await startEditorAcceptance(isolation.output); fs.copyFileSync(__filename, path.join(isolation.output, "executed-test.cjs"));
  report.service = { url: host.url, backendUrl: host.backendUrl, frontendPid: host.server.pid, backendPid: host.backendPid };
  browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
  // Run the data/persistence workflow once, then re-use that real edited state
  // for the complete display matrix rather than repeat 336 identical writes.
  for (const [width, height] of desktopViewports.slice(0, 1))
    for (const dpr of [1]) for (const motion of ["no-preference"]) {
      const item = { width, height, dpr, motion, status: "RUNNING", pages: [], errors: [] }; report.cases.push(item);
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: motion });
      const page = await context.newPage(); page.setDefaultTimeout(40000);
      page.on("pageerror", e => item.errors.push(String(e)));
      await page.route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
        if (route.request().method() !== "POST") return route.continue();
        report.modelRequests++; return route.abort();
      });
      try {
        await host.open(page); await settleEditor(page); await open(page); await choose(page, "标题主页", "title_hero");
        if (portableOnly) {
          item.portableRoundtrip = await portableRoundtrip(page, item);
          assert.deepEqual(item.errors, []);
          item.status = "PASS"; continue;
        }
        if (agentOnly) {
          item.agentvn = await agentTitle(page); item.status = "PASS";
          continue;
        }
        if (staticOnly) {
          await page.getByLabel("页面背景色", { exact: true }).fill("#24384c");
          await page.getByLabel("页面背景不透明度", { exact: true }).fill("0.5");
          await page.getByLabel("页面内容不透明度", { exact: true }).fill("0.8");
          await page.getByTestId("renpy-title-static-preview-toggle").click();
          item.staticTitle = await page.locator(".renpy-editor-preview .renpy-title-heading")
            .evaluate(n => Number(getComputedStyle(n).opacity));
          assert.equal(item.staticTitle, .8, "Static title preview shows the configured foreground");
          item.status = "PASS"; continue;
        }
        const baseline = await editorState(page);
        for (const [label, id, selector] of pageCases) {
          await choose(page, label, id);
          await page.getByLabel("页面背景色", { exact: true }).fill("#24384c");
          const background = page.getByLabel("页面背景不透明度", { exact: true });
          const content = page.getByLabel("页面内容不透明度", { exact: true });
          await background.waitFor({ timeout: 7000 });
          await background.fill("0.5"); await content.fill("0.8");
          const first = await observe(page, selector);
          assert.equal(first.backgroundOpacity, .5); assert.equal(first.contentOpacity, .8);
          assert.equal(first.background, "rgb(36, 56, 76)", "No duplicate color alpha");
          if (id === "title_hero") item.staticTitle = await staticTitle(page);
          await content.fill("0.3"); const changed = await observe(page, selector);
          assert.equal(changed.backgroundOpacity, .5); assert.equal(changed.contentOpacity, .3);
          await background.fill("0"); const zero = await observe(page, selector);
          assert.equal(zero.backgroundOpacity, 0); assert.equal(zero.contentOpacity, .3);
          await background.fill("0.5"); await content.fill("0.8");
          assertGeometry(first, id);
          await background.scrollIntoViewIfNeeded(); await background.click({ trial: true });
          await content.scrollIntoViewIfNeeded(); await content.click({ trial: true });
          const geometry = await content.evaluate(n => {
            const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return { hit: n === hit || n.contains(hit), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          });
          assert(geometry.hit && geometry.left >= 0 && geometry.top >= 0 && geometry.right <= width + 1 && geometry.bottom <= height + 1);
          item.pages.push({ id, first, changed, zero, geometry });
          console.log(JSON.stringify({ width, dpr, motion, page: id, status: "PASS" }));
        }
        await page.locator('[data-help-key="layout.save"]:visible').click();
        await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
        const saved = await editorState(page);
        assert.deepEqual(saved.nodes, baseline.nodes); assert.deepEqual(saved.edges, baseline.edges);
        assert.deepEqual(saved.settings.runtimeUILayoutProfiles.profiles.agentvn, baseline.settings.runtimeUILayoutProfiles.profiles.agentvn);
        const backend = await (await fetch(`${host.backendUrl}/api/project/projects/${saved.id}`)).json();
        assert(backend.ok); assert.deepEqual(backend.data.editor_settings.runtimeUILayoutProfiles, saved.settings.runtimeUILayoutProfiles);
        await page.reload(); await page.locator('[data-help-key="home.recentProject"]').first().click();
        await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await open(page);
        await choose(page, "关于", "about_panel");
        const restored = await observe(page, ".about-card");
        assert.equal(restored.backgroundOpacity, .5); assert.equal(restored.contentOpacity, .8);
        const current = await editorState(page);
        assert.deepEqual(current.settings.runtimeUILayoutProfiles, saved.settings.runtimeUILayoutProfiles);
        await page.getByTestId("renpy-page-style-property-contentOpacity").getByRole("button", { name: "恢复主题继承", exact: true }).click();
        const reset = await observe(page, ".about-card");
        assert.equal(reset.backgroundOpacity, .5); assert.equal(reset.contentOpacity, 1);
        item.persistedAndReopened = true; item.independentReset = reset;
        item.agentvn = await agentTitle(page);
        const display = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
        const before = await display(), file = path.join(isolation.output, `${width}-${dpr}-${motion}.png`);
        await page.screenshot({ path: file }); const after = await display(), png = fs.readFileSync(file);
        assert.deepEqual(before, after); assert.equal(png.readUInt32BE(16), width * dpr); assert.equal(png.readUInt32BE(20), height * dpr);
        assert.equal(item.errors.length, 0);
        item.screenshot = { path: file, sha256: sha(file), before, after }; item.status = "PASS";
        if (!smoke) await displayMatrix(page);
      } catch (error) {
        item.status = "FAILED"; item.error = String(error.stack || error);
        const pending = report.matrix.at(-1); if (pending?.status === "RUNNING") pending.status = "FAILED";
      }
      finally { await context.close(); }
      console.log(JSON.stringify({ width, dpr, motion, status: item.status, error: item.error }));
    }
  assert.equal(report.cases.length, 1); assert.equal(report.modelRequests, 0);
  assert.equal(report.matrix.length, smoke || portableOnly ? 0 : 12);
  assert(report.matrix.every(c => c.status === "PASS" && c.pages.length === 7));
  report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); await host?.stop();
  let online = false;
  if (host) try { online = (await fetch(host.url, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
  report.cleanup = { status: online ? "FAILED" : "PASS", serviceResponds: online };
  if (online) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(isolation.output, { recursive: true });
  fs.writeFileSync(path.join(isolation.output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, output: isolation.output }));
});
