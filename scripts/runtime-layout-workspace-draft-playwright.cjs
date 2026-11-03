"use strict";
// Real browser, isolated backend, public authoring controls. No model requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const JSZip = require("../editor/node_modules/jszip");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { projectSnapshot, settleEditor, settleRuntime, dismissEnvironmentCompletion } = require("./lib/installed-acceptance.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const out = `F:/AgentVN/QA/Layout-Workspace-Draft-20261102-${attempt}`;
assert(!fs.existsSync(out), "Never overwrite existing evidence");
fs.mkdirSync(out, { recursive: true });
const mod = { exports: {} };
new Function("module", "exports", buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(mod, mod.exports);
const project = fixture(`qa-layout-draft-${attempt}`);
const renpy = mod.exports.createRenpyUILayout();
project.editor_settings.runtimeUILayoutProfiles = { version: 1, activeType: "renpy",
  profiles: { agentvn: mod.exports.getDefaultUISkinLayout(), renpy } };
project.editor_settings.runtimeUILayout = structuredClone(renpy);
const input = path.join(out, "草稿隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const secondProject = structuredClone(project);
secondProject.project_id += "-other";
secondProject.title = "另一工程 · 草稿归属验收";
const secondInput = path.join(out, "另一个隔离工程.vnproj");
fs.writeFileSync(secondInput, JSON.stringify(secondProject), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "SOURCE_REAL_BROWSER_CURRENT_WORKTREE_NOT_INSTALLED", modelRequests: 0,
  cases: [], screenshots: [], errors: [], cleanups: [] };
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const evidence = file => ({ path: path.resolve(file), sha256: hash(file), bytes: fs.statSync(file).size });
function sourceTreeHash() {
  const digest = crypto.createHash("sha256");
  for (const folder of ["editor/src", "GameCli_framework/src", "shared"]) {
    for (const file of fs.readdirSync(path.join(root, folder), { recursive: true }).sort()) {
      if (!/\.(?:ts|tsx|mjs|css)$/.test(file)) continue;
      digest.update(folder + "/" + file).update(fs.readFileSync(path.join(root, folder, file)));
    }
  }
  return digest.digest("hex");
}
report.sourceTreeSHA256 = sourceTreeHash();
report.source = ["editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  "editor/src/utils/runtimeLayoutWorkspaceDraft.mjs", "scripts/runtime-layout-workspace-draft-playwright.cjs"]
  .map(file => evidence(path.join(root, file)));
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const validHTML = '<span class="root"><span class="body"><slot name="content"></slot></span></span>';
const validCSS = ".root { background-color: #315b72; border-radius: 6px; } .body { color: #f6f8ff; }";
const invalidHTML = '<script>window.__qaDraftExecuted = true</script><slot name="content"></slot>';
const invalidCSS = "body { color: red; --qa-invalid-draft: 20261102; }";
const control = profiles => profiles.profiles.renpy.screens.find(s => s.screen_id === "title")
  .components.find(c => c.component_id === "title_start_button");
let env, browser, page, runtimeServer;
const html = () => page.getByRole("textbox", { name: "当前控件 HTML", exact: true });
const css = () => page.getByRole("textbox", { name: "当前控件 CSS", exact: true });
const saveButton = () => page.locator('[data-help-key="layout.save"]:visible');
const click = async locator => { await locator.scrollIntoViewIfNeeded(); await locator.click(); };
const snapshot = async () => (await projectSnapshot(new URL(env.backendUrl).port)).settings.runtimeUILayoutProfiles;
async function stage(name, action) {
  const item = { name, status: "RUNNING", startedAt: new Date().toISOString() };
  report.cases.push(item); save();
  try { item.detail = await action(); item.status = "PASS"; }
  catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); throw error; }
  finally { item.finishedAt = new Date().toISOString(); save(); }
  console.log("PASS " + name);
}
async function enterLayout() {
  const publishing = page.locator(".cartridge-export-panel:visible");
  if (await publishing.isVisible())
    await click(publishing.getByRole("button", { name: "关闭发布与打包", exact: true }));
  await click(page.locator('[data-workspace-surface="options"]:visible'));
  await click(page.locator('[data-help-key="advanced.tab.layout"]:visible'));
  await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
  await click(page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_start_button"]'));
}
async function exportSaved() {
  await click(page.locator('[data-workspace-surface="publish"]:visible'));
  const panel = page.locator(".cartridge-export-panel:visible");
  await panel.waitFor(); await settleEditor(page);
  await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText
    .includes("正在检测当前构建环境"));
  await dismissEnvironmentCompletion(page);
  await click(panel.locator('.package-stage-navigation-item[data-package-stage="settings"]'));
  await click(panel.locator('[data-help-key="package.mode"]'));
  await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
  await click(panel.locator('.package-stage-navigation-item[data-package-stage="checks"]'));
  const consent = panel.getByRole("checkbox", { name: /我已检查全部警告/ });
  if (await consent.count()) await consent.check();
  const pending = page.waitForEvent("download");
  await click(panel.locator(".package-primary-action"));
  const downloaded = await pending;
  const file = path.join(out, `saved-${report.cases.length}-${report.screenshots.length}.vncart`);
  await downloaded.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  for (const entry of Object.values(zip.files).filter(f => !f.dir && /\.(json|css|html)$/.test(f.name))) {
    const text = await entry.async("string");
    assert(!text.includes("__qaDraftExecuted") && !text.includes("--qa-invalid-draft"), entry.name);
  }
  return { file: evidence(file), layout };
}
async function shoot(label, display) {
  const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  assert.equal(metrics.width, display.width); assert.equal(metrics.height, display.height);
  assert.equal(metrics.dpr, display.dpr); assert.equal(metrics.reduced, display.reduced);
  const file = path.join(out, label + ".png");
  await page.screenshot({ path: file });
  const png = fs.readFileSync(file);
  assert.equal(png.readUInt32BE(16), metrics.width * metrics.dpr);
  assert.equal(png.readUInt32BE(20), metrics.height * metrics.dpr);
  report.screenshots.push({ ...evidence(file), metrics }); save();
}
(async () => {
  save();
  env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.url,
    backendPid: env.backendPid, backendUrl: env.backendUrl }; save();
  browser = await chromium.launch({ headless: true });
  const displays = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
    [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
  if (process.argv.includes("--smoke")) displays.splice(1);
  for (const display of displays) {
    const context = await browser.newContext({ viewport: { width: display.width, height: display.height },
      deviceScaleFactor: display.dpr, reducedMotion: display.reduced ? "reduce" : "no-preference" });
    page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on("pageerror", error => report.errors.push(String(error)));
    await env.server.run(async () => {
      await env.open(page); await settleEditor(page); await enterLayout();
      await stage(`valid-save-and-invalid-workspace-roundtrip-${display.width}-${display.dpr}-${display.reduced}`, async () => {
        const advanced = page.getByRole("checkbox", { name: "Ren’Py进阶代码编辑", exact: true });
        if (!await advanced.isChecked()) await advanced.check();
        const enable = page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true });
        if (await enable.isVisible()) await click(enable);
        await html().fill(validHTML); await css().fill(validCSS);
        await click(saveButton());
        await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
        const saved = await snapshot();
        assert.equal(control(saved).presentation.css, validCSS);
        assert.deepEqual(saved.profiles.agentvn, project.editor_settings.runtimeUILayoutProfiles.profiles.agentvn);
        await html().fill(invalidHTML); await css().fill(invalidCSS);
        await page.getByRole("alert").filter({ hasText: "代码未应用" }).waitFor();
        assert(await saveButton().isDisabled());
        assert.equal(await page.evaluate(() => window.__qaDraftExecuted), undefined);
        const exported = await exportSaved();
        assert.equal(exported.layout.screens.find(s => s.screen_id === "title")
          .components.find(c => c.component_id === "title_start_button").presentation.css, validCSS);
        await enterLayout();
        assert.equal(await html().inputValue(), invalidHTML);
        assert.equal(await css().inputValue(), invalidCSS);
        assert(await saveButton().isDisabled());
        assert.equal(await page.evaluate(() => window.__qaDraftExecuted), undefined);
        assert.deepEqual(await snapshot(), saved);
        await css().scrollIntoViewIfNeeded(); await css().focus();
        const geometry = await css().evaluate(el => {
          const rect = el.getBoundingClientRect();
          return { rect: rect.toJSON(), focused: document.activeElement === el,
            hit: el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
            inert: Boolean(el.closest("[inert]")),
            horizontalOverflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(geometry.focused && geometry.hit && !geometry.inert);
        assert(geometry.horizontalOverflow <= 1);
        assert(geometry.rect.left >= 0 && geometry.rect.right <= display.width + 1
          && geometry.rect.top >= 0 && geometry.rect.bottom <= display.height + 1);
        await shoot(`retained-${display.width}-${display.dpr}-${display.reduced}`, display);
        return { display, savedBaselineUnchanged: true, invalidDraftRetained: true,
          executionBlocked: true, actualExport: exported.file, geometry };
      });
      if (display === displays[0]) {
        await stage("failed-save-keeps-draft-and-successful-save-survives-real-reload", async () => {
          await html().fill(validHTML);
          const edited = ".root { background-color: #463859; border-radius: 7px; }";
          await css().fill(edited);
          const baseline = await snapshot();
          let rejected = 0;
          const url = env.backendUrl + "/api/project/state";
          await page.route(url, route => {
            if (route.request().method() === "POST") {
              rejected++; return route.fulfill({ status: 500, contentType: "application/json",
                body: JSON.stringify({ detail: "QA controlled persistence failure" }) });
            }
            return route.continue();
          });
          try {
            await click(saveButton());
            await page.locator('[data-help-key="layout.save"][data-save-state="error"]').waitFor();
            assert(rejected > 0, "Must actually intercept the attempted write");
            assert.deepEqual(await snapshot(), baseline);
            await exportSaved(); await enterLayout();
            assert.equal(await css().inputValue(), edited);
          } finally { await page.unroute(url); }
          await click(saveButton());
          await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
          assert.equal(control(await snapshot()).presentation.css, edited);
          await page.reload();
          await page.getByRole("button", { name: "继续上次编辑", exact: true }).click();
          await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await enterLayout();
          assert.equal(await css().inputValue(), edited);
          return { controlledWriteFailures: rejected, retainedAfterFailure: true, actualReload: true };
        });
        await stage("real-project-A-B-A-navigation-restores-only-the-owning-draft", async () => {
          await click(page.locator('[data-workspace-surface="edit"]:visible'));
          await settleEditor(page);
          const pending = page.waitForEvent("download");
          await page.getByRole("button", { name: "保存工程", exact: true }).click();
          const portable = path.join(out, "已保存作者基线.vnproj");
          await (await pending).saveAs(portable);
          await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
          await enterLayout();
          await html().fill(invalidHTML); await css().fill(invalidCSS);
          await page.getByRole("alert").filter({ hasText: "代码未应用" }).waitFor();
          const importThroughHome = async file => {
            await page.getByRole("button", { name: "返回首页", exact: true }).click();
            await page.locator(".editor-toolbar").waitFor({ state: "hidden" });
            await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching"));
            await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
              .some(e => !e.disabled));
            await page.locator(".project-import-button input").first().setInputFiles(file);
            await page.locator(".editor-toolbar").waitFor();
            await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
            await settleEditor(page); await enterLayout();
          };
          await importThroughHome(secondInput);
          const advanced = page.getByRole("checkbox", { name: "Ren’Py进阶代码编辑", exact: true });
          if (!await advanced.isChecked()) await advanced.check();
          const enable = page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true });
          if (await enable.isVisible()) await click(enable);
          assert.notEqual(await html().inputValue(), invalidHTML, "A code must not appear in B");
          const secondCSS = "body { color: blue; --qa-other-project-draft: 1; }";
          await html().fill(validHTML); await css().fill(secondCSS);
          await page.getByRole("alert").filter({ hasText: "代码未应用" }).waitFor();
          await importThroughHome(portable);
          assert.equal(await html().inputValue(), invalidHTML);
          assert.equal(await css().inputValue(), invalidCSS);
          assert.equal(await page.evaluate(() => window.__qaDraftExecuted), undefined);
          assert.notEqual(control(await snapshot()).presentation.css, invalidCSS);
          await importThroughHome(secondInput);
          assert.equal(await html().inputValue(), validHTML);
          assert.equal(await css().inputValue(), secondCSS);
          await importThroughHome(portable);
          assert.equal(await css().inputValue(), invalidCSS);
          return { nativePickerClaimed: false, portable: evidence(portable),
            realUIImports: 4, noProjectLeak: true, AtoBtoA: true };
        });
        await stage("real-player-consumes-exported-last-valid-code-not-the-invalid-draft", async () => {
          const exported = await exportSaved();
          runtimeServer = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
            configFile: path.join(root, "GameCli_framework/vite.config.cjs"),
            logFile: path.join(out, "player.log") });
          report.runtimeOwner = { pid: runtimeServer.pid, runId: runtimeServer.runId, url: runtimeServer.url }; save();
          const player = await context.newPage();
          try {
            await runtimeServer.run(async () => {
              await player.goto(runtimeServer.url + "/?mode=library");
              await player.getByTestId("web-cartridge-file").setInputFiles(exported.file.path);
              await player.locator(".launch-panel").getByRole("button", { name: "启动卡带", exact: true }).click();
              await player.getByTestId("start-new-game").waitFor(); await settleRuntime(player);
              const presentation = control({ profiles: { renpy: exported.layout } }).presentation;
              const color = /background-color:\s*([^;]+)/.exec(presentation.css)[1].trim();
              const actual = await player.getByTestId("start-new-game").evaluate(el => getComputedStyle(el).backgroundColor);
              assert.equal(actual, color === "#463859" ? "rgb(70, 56, 89)" : "rgb(49, 91, 114)");
              assert.equal(await player.evaluate(() => window.__qaDraftExecuted), undefined);
              assert.equal(await player.getByTestId("start-new-game").getAttribute("data-control-slot-count"), "1");
            });
          } finally { await player.close(); await runtimeServer.stop(); }
          await enterLayout();
          assert.equal(await css().inputValue(), invalidCSS);
          return { exported: exported.file, actualPlayerCSS: true, unsavedScriptNotExecuted: true };
        });
      }
    });
    await context.close();
  }
  assert.equal(report.cases.length, displays.length + 3);
  assert.deepEqual(report.errors, []);
  report.expectedDisplayCount = displays.length;
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureText = (await page.locator("body").innerText().catch(String)).slice(-12000);
    await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  }
}).finally(async () => {
  try {
    await browser?.close();
    await runtimeServer?.stop();
    await env?.stop();
    for (const file of report.source) assert.equal(hash(file.path), file.sha256, "Source changed during run");
    assert.equal(sourceTreeHash(), report.sourceTreeSHA256, "Product sources changed during run");
    for (const pid of [env?.server.pid, env?.backendPid, runtimeServer?.pid].filter(Boolean))
      assert.throws(() => process.kill(pid, 0), "Owned process still exists after cleanup: " + pid);
    const owners = [report.owner?.url, report.owner?.backendUrl, report.runtimeOwner?.url].filter(Boolean);
    for (const url of owners) {
      let reachable = false;
      try { await fetch(url, { signal: AbortSignal.timeout(1500) }); reachable = true; } catch {}
      assert(!reachable, "Owned service remains reachable after cleanup: " + url);
    }
    report.cleanups.push({ status: "PASS", action: "owned browser and isolated services stopped" });
  } catch (error) {
    report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length,
    error: report.error, cleanupError: report.cleanupError }));
});
