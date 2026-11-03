"use strict";
// Real Editor workflow. Owned backend/project/browser; no model or user files.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { createHash } = require("node:crypto");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const attempt = process.argv[2], root = path.resolve(__dirname, "..");
assert.match(attempt, /^(red|green|matrix)-\d{2}$/);
const out = `F:/AgentVN/QA/Renpy-Redesign-20261021-01/gui-library-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const model = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(model, model.exports);
const project = fixture(`gui-library-${attempt}`);
const renpy = model.exports.createRenpyUILayout();
project.editor_settings.runtimeUILayoutProfiles = { version: 1, activeType: "renpy",
  profiles: { agentvn: model.exports.getDefaultUISkinLayout(), renpy } };
project.editor_settings.runtimeUILayout = structuredClone(renpy);
const input = path.join(out, "资源包隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
const report = { status: "RUNNING", scope: "SOURCE_REAL_BROWSER_NOT_INSTALLED",
  startedAt: new Date().toISOString(), cases: [], modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function sourceHash() {
  const hash = createHash("sha256");
  for (const folder of ["editor/src", "editor/src-tauri/src", "shared", "GameCli_framework/src"])
    for (const name of fs.readdirSync(path.join(root, folder), { recursive: true }).sort())
      if (/\.(ts|tsx|css|rs)$/.test(name))
        hash.update(folder + "/" + name).update(fs.readFileSync(path.join(root, folder, name)));
  return hash.digest("hex");
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Lz4AAAAASUVORK5CYII=", "base64");
let env, browser, page;
async function snapshot(page) {
  return page.evaluate(async () => {
    const state = (await import("/src/store/projectStore.ts")).useProjectStore.getState();
    return JSON.stringify({ id: state.projectId, assets: state.assetManifest, settings: state.settings });
  });
}
async function openLayout(page) {
  await settleEditor(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
}
(async () => {
  report.sourceSHA256 = sourceHash();
  save(); env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.owner = { pid: env.server.pid, backendPid: env.backendPid, url: env.url, backendUrl: env.backendUrl }; save();
  browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
  const matrix = process.env.GUI_LIBRARY_MATRIX === "1"
    ? [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
      [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))))
    : [{ width: 1920, height: 1080, dpr: 1, reduced: false }];
  const zip = new JSZip();
  zip.file("gui.rpy", "define gui.navigation_xpos = 44\ndefine gui.navigation_spacing = 12\n");
  zip.file("gui/button/idle.png", png);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  for (const m of matrix) {
    const context = await browser.newContext({ viewport: { width: m.width, height: m.height },
      deviceScaleFactor: m.dpr, reducedMotion: m.reduced ? "reduce" : "no-preference" });
    page = await context.newPage(); page.setDefaultTimeout(15000);
    await env.server.run(async () => {
      await env.open(page); await openLayout(page);
      const baseline = await snapshot(page);
      const trigger = page.getByTestId("renpy-gui-import-open");
      await trigger.click();
      const dialog = page.getByTestId("renpy-gui-import-dialog");
      await page.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles({
        name: "中文 测试界面.zip", mimeType: "application/zip", buffer });
      await dialog.locator(".renpy-gui-import-summary").waitFor();
      await dialog.getByRole("checkbox", { name: /我已重新核对/ }).check();
      await dialog.getByRole("button", { name: "确认入库，不修改工程", exact: true }).click();
      const library = dialog.getByTestId("renpy-gui-library");
      await library.getByText("中文 测试界面", { exact: true }).waitFor();
      assert.equal(await snapshot(page), baseline, "Importing into the local library cannot mutate project assets or either layout");
      assert.equal(await dialog.getByRole("button", { name: "确认应用已选项目", exact: true }).count(), 0,
        "The library import step cannot double as project application");
      await dialog.getByRole("button", { name: "关闭导入预览", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await page.reload();
      await page.getByRole("button", { name: "继续上次编辑", exact: true }).click();
      await openLayout(page); await trigger.click();
      await library.getByText("中文 测试界面", { exact: true }).waitFor();
      assert.equal(await snapshot(page), baseline, "Restart restores the independent library without applying it");
      if (process.argv.includes("--lifecycle")) {
        const original = await page.evaluate(async () => {
          const api = await import("/src/renpy/guiPackLibrary.ts");
          return api.encodeGuiPack(await api.readGuiPack((await api.listGuiPacks())[0].id));
        });
        const choose = () => page.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles({
          name: "中文 测试界面.zip", mimeType: "application/zip", buffer });
        await choose(); await dialog.locator(".renpy-gui-import-summary").waitFor();
        await dialog.getByRole("button", { name: "取消，不修改工程", exact: true }).click();
        await dialog.waitFor({ state: "detached" }); await trigger.click();
        assert.equal(await library.locator("article").count(), 1, "Cancelling a scan cannot publish a library revision");
        assert.equal(await snapshot(page), baseline);
        const unsafe = new JSZip();
        unsafe.file("../escape.txt", "blocked");
        unsafe.file("gui.rpy", "define gui.navigation_xpos = 42\n");
        await page.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles({
          name: "恶意路径.zip", mimeType: "application/zip", buffer: await unsafe.generateAsync({ type: "nodebuffer" }) });
        await dialog.locator(".renpy-gui-import-summary").waitFor();
        assert.equal(await dialog.getByRole("button", { name: "确认入库，不修改工程", exact: true }).isDisabled(), true);
        assert.match(await dialog.getByLabel("扫描问题", { exact: true }).innerText(), /unsafe_path|不安全路径/);
        assert.equal(await library.locator("article").count(), 1);
        assert.equal(await snapshot(page), baseline, "Rejected archives cannot affect a project or the library");
        await choose(); await dialog.locator(".renpy-gui-import-summary").waitFor();
        await page.evaluate(() => {
          window.__guiOriginalAdd = IDBObjectStore.prototype.add;
          IDBObjectStore.prototype.add = function (...args) {
            if (this.name === "packs") throw new DOMException("controlled GUI library quota failure", "QuotaExceededError");
            return window.__guiOriginalAdd.apply(this, args);
          };
        });
        try {
          await dialog.getByRole("checkbox", { name: /我已重新核对/ }).check();
          await dialog.getByRole("button", { name: "确认入库，不修改工程", exact: true }).click();
          await dialog.getByRole("alert").filter({ hasText: "controlled GUI library quota failure" }).waitFor();
          assert.equal(await library.locator("article").count(), 1);
          const count = await page.evaluate(async () => (await (await import("/src/renpy/guiPackLibrary.ts")).listGuiPacks()).length);
          assert.equal(count, 1, "A storage failure cannot publish a partial library revision");
          assert.equal(await snapshot(page), baseline);
        } finally { await page.evaluate(() => { IDBObjectStore.prototype.add = window.__guiOriginalAdd; }); }
        await dialog.getByRole("combobox", { name: "资源包修订来源", exact: true }).click();
        await page.getByRole("option", { name: /从修订 1 新建修订/ }).click();
        await dialog.getByRole("checkbox", { name: /我已重新核对/ }).check();
        await dialog.getByRole("button", { name: "确认入库，不修改工程", exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="renpy-gui-library"] article').length === 2);
        const lineage = await page.evaluate(async () => {
          const api = await import("/src/renpy/guiPackLibrary.ts"), items = await api.listGuiPacks();
          const first = items.find(item => item.revision === 1), second = items.find(item => item.revision === 2);
          return { first: api.encodeGuiPack(await api.readGuiPack(first.id)), parent: second.parentId, firstId: first.id };
        });
        assert.equal(lineage.first, original, "Reimport cannot modify an existing library revision");
        assert.equal(lineage.parent, lineage.firstId);
        assert.equal(await snapshot(page), baseline, "Reviewable reimport is still independent of a project");
      }
      await library.getByRole("button", { name: "预览并选择应用", exact: true }).first().click();
      const scope = dialog.getByRole("combobox", { name: "资源包应用范围", exact: true });
      await scope.click();
      await page.getByRole("option", { name: "单个控件", exact: true }).click();
      await dialog.getByRole("combobox", { name: "目标页面", exact: true }).click();
      await page.getByRole("option", { name: "标题", exact: true }).click();
      await dialog.getByRole("combobox", { name: "目标控件", exact: true }).click();
      await page.getByRole("option", { name: /开始游戏/ }).click();
      await dialog.getByRole("combobox", { name: "gui/button/idle.png 游戏界面用途", exact: true }).click();
      await page.getByRole("option", { name: "当前控件背景", exact: true }).click();
      assert.match(await dialog.getByTestId("renpy-gui-impact").innerText(), /当前控件|开始游戏/);
      await dialog.getByRole("checkbox", { name: /我已重新核对/ }).check();
      const geometry = await dialog.evaluate(e => {
        const rect = e.getBoundingClientRect(), body = e.querySelector(".renpy-gui-import-body").getBoundingClientRect();
        const footer = e.querySelector("footer").getBoundingClientRect();
        return { rect: rect.toJSON(), body: body.toJSON(), footer: footer.toJSON(),
          overflow: e.scrollWidth - e.clientWidth, documentOverflow: document.documentElement.scrollWidth - innerWidth,
          focus: e.contains(document.activeElement),
          buttons: [...e.querySelectorAll("footer button:not(:disabled)")].map(button => {
            const r = button.getBoundingClientRect();
            return { rect: r.toJSON(), hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
          }) };
      });
      assert(geometry.rect.left >= -1 && geometry.rect.top >= -1 && geometry.rect.right <= m.width + 1 && geometry.rect.bottom <= m.height + 1);
      assert(geometry.overflow <= 1 && geometry.documentOverflow <= 1 && geometry.body.bottom <= geometry.footer.top + 1);
      assert(geometry.focus && geometry.buttons.every(button => button.hit), "Application actions must remain reachable and focus must belong to the modal");
      await dialog.getByRole("button", { name: "确认应用到当前工程", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await page.locator('[data-help-key="layout.save"]:visible').click();
      await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent?.includes("已保存"));
      const state = JSON.parse(await snapshot(page));
      fs.writeFileSync(path.join(out, `applied-${m.width}-${m.dpr}-${m.reduced}.json`), JSON.stringify(state, null, 2));
      assert.equal(state.assets.length, 1, "Application copies the selected dependency into project-managed assets");
      const consumed = await page.locator('.renpy-title-action[data-ui-component-id="title_start_button"]').evaluate(async e => {
        const image = getComputedStyle(e).backgroundImage;
        const url = /^url\("(.*)"\)$/.exec(image)?.[1];
        if (!url) throw new Error(`The applied control has no resolved resource: ${image}`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Cannot read applied resource: ${response.status}`);
        return Array.from(new Uint8Array(await response.arrayBuffer()));
      });
      assert.equal(Buffer.from(consumed).compare(png), 0, "Compare the bytes actually consumed by the Runtime control, including cached-asset storage");
      const layout = state.settings.runtimeUILayout;
      const control = layout.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === "title_start_button");
      assert.equal(control.style.backgroundImage, `asset:${state.assets[0].asset_id}`);
      const before = JSON.parse(baseline).settings.runtimeUILayout;
      for (const screen of layout.screens) for (const component of screen.components)
        if (component.component_id !== "title_start_button")
          assert.deepEqual(component, before.screens.find(s => s.screen_id === screen.screen_id)?.components.find(c => c.component_id === component.component_id),
            "A control-only application cannot silently alter other controls");
      assert.deepEqual(state.settings.runtimeUILayoutProfiles.profiles.agentvn,
        JSON.parse(baseline).settings.runtimeUILayoutProfiles.profiles.agentvn, "The inactive layout remains independent");
      const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      assert.deepEqual(actual, m);
      const screenshot = `${m.width}x${m.height}-dpr${m.dpr}-${m.reduced ? "reduced" : "ordinary"}.png`;
      const image = await page.screenshot({ path: path.join(out, screenshot) });
      assert.equal(image.readUInt32BE(16), m.width * m.dpr); assert.equal(image.readUInt32BE(20), m.height * m.dpr);
      await trigger.click();
      await library.getByRole("button", { name: "预览并选择应用", exact: true }).first().click();
      const operation = dialog.getByRole("combobox", { name: "gui/button/idle.png 导入操作", exact: true });
      await operation.click();
      assert.equal(await page.getByRole("option", { name: /替换/ }).count(), 0,
        "Applying a pack cannot replace bytes referenced by the inactive profile, even at project scope");
      await page.getByRole("option", { name: "复制为新素材", exact: true }).click();
      await dialog.getByRole("button", { name: "取消，不修改工程", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(await snapshot(page), JSON.stringify(state), "Cancelling reapplication preserves applied assets and both profiles");
      report.cases.push({ ...m, status: "PASS", behavior: "independent-library-restart-explicit-control-application-actual-bytes",
        lifecycle: process.argv.includes("--lifecycle"), geometry, actual, screenshot }); save();
    });
    await context.close(); page = undefined;
  }
  assert.equal(report.cases.length, matrix.length); assert(report.cases.length > 0);
  assert.equal(sourceHash(), report.sourceSHA256, "Source changed during the matrix; a stable candidate is required");
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  await page?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
}).finally(async () => {
  await browser?.close(); await env?.stop();
  const alive = await Promise.all([env?.url, env?.backendUrl].filter(Boolean).map(async url => {
    try { await fetch(url, { signal: AbortSignal.timeout(700) }); return url; } catch { return null; }
  }));
  report.cleanup = alive.some(Boolean) ? "FAILED" : "PASS";
  if (alive.some(Boolean)) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
