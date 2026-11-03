"use strict";
// One authoring tracer: hide only the title, keep artwork/menu/version, persist.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const JSZip = require("../editor/node_modules/jszip");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
const executedTool = fs.readFileSync(__filename);
assert.match(attempt, /^(?:red|green|matrix)-\d{2}$/);
const viewport = process.env.AGENTVN_TITLE_TEXT_VIEWPORT
  ? JSON.parse(process.env.AGENTVN_TITLE_TEXT_VIEWPORT) : { width: 1920, height: 1080, dpr: 1, reduced: false };
assert([[1920, 1080], [2560, 1440], [3840, 2160]].some(([w, h]) => viewport.width === w && viewport.height === h));
assert([1, 2].includes(viewport.dpr) && typeof viewport.reduced === "boolean");
const cell = `${viewport.width}x${viewport.height}-dpr${viewport.dpr}-${viewport.reduced ? "reduced" : "normal"}`;
const out = path.resolve(`F:/AgentVN/QA/Renpy-Title-Text-20261024-01/${attempt}${process.env.AGENTVN_TITLE_TEXT_VIEWPORT ? `/${cell}` : ""}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const model = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(model, model.exports);
const project = fixture(`qa-renpy-title-text-${attempt}-${cell}`);
project.title = "标题显隐隔离工程";
const layout = model.exports.createRenpyUILayout();
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#305566"/></svg>';
project.asset_manifest = [{ asset_id: "qa_title_art", asset_type: "background", metadata: {
  filename: "独立标题背景.svg", display_name: "独立标题背景", mime_type: "image/svg+xml", width: 1280, height: 720,
  data_url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
} }];
const hero = layout.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === "title_hero");
hero.style = { ...hero.style, backgroundImage: "asset:qa_title_art" };
project.editor_settings.runtimeUILayoutProfiles = { version: 1, activeType: "renpy",
  profiles: { agentvn: model.exports.getDefaultUISkinLayout(), renpy: layout } };
project.editor_settings.runtimeUILayout = structuredClone(layout);
const input = path.join(out, "标题显隐临时工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
process.env.TEMP = temporary; process.env.TMP = temporary;
const report = { status: "RUNNING", startedAt: new Date().toISOString(), scope: "SOURCE_REAL_BROWSER_TITLE_AUTHORING_NOT_INSTALLED",
  project: { path: input, sha256: sha(input), projectId: project.project_id },
  viewport, steps: [], screenshots: [],
  modelRequests: 0, productChanges: 0,
  tool: { path: __filename, sha256: createHash("sha256").update(executedTool).digest("hex") },
  sources: ["shared/cartridge/uiSkin.ts", "shared/cartridge/renpyTitleControls.ts",
    "shared/cartridge/runtimeCapabilities.ts", "shared/cartridge/constants.ts",
    "editor/src/components/advanced/RenpyTitleEditor.tsx", "editor/src/components/advanced/RenpyTitleTextEditor.tsx",
    "editor/src/components/advanced/renpy-title-editor.css",
    "GameCli_framework/src/components/shell/RenpyTitleView.tsx"].map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let env, browser, page, runtimeServer;
async function step(name, fn) {
  const s = { name, status: "RUNNING" }; report.steps.push(s); save();
  try { s.detail = await fn(); s.status = "PASS"; }
  catch (e) { s.status = "FAILED"; s.error = String(e.stack || e); throw e; }
  finally { s.finishedAt = new Date().toISOString(); save(); }
}
async function openLayout() {
  await settleEditor(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
  await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_hero"]').click();
}
async function assertHiddenTitle() {
  assert.equal(await page.locator(".renpy-title-heading h1:visible").count(), 0);
  assert.equal(await page.locator(".renpy-title-heading p:visible").count(), 1, "Hiding a title does not hide its version");
  assert(await page.locator(".renpy-title-action:visible").count() >= 5, "Menu actions remain available");
  const image = page.getByTestId("renpy-imported-title-background");
  assert.notEqual(await image.evaluate(n => getComputedStyle(n).backgroundImage), "none", "Title artwork remains visible");
}
async function shot(name, target = page) {
  const file = path.join(out, `${name}.png`);
  const sample = () => target.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const before = await sample(); await target.screenshot({ path: file }); const after = await sample();
  assert.deepEqual(before, after); assert.deepEqual(before, viewport); const b = fs.readFileSync(file);
  assert.equal(b.readUInt32BE(16), before.width * before.dpr); assert.equal(b.readUInt32BE(20), before.height * before.dpr);
  report.screenshots.push({ path: file, sha256: sha(file), before, after });
}
(async () => {
  try {
    save(); env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
    report.owner = { url: env.url, backendUrl: env.backendUrl, processes: rows().filter(p =>
      p.ProcessId === env.backendPid || p.ProcessId === env.server.pid) };
    assert.equal(report.owner.processes.length, 2);
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.dpr, reducedMotion: viewport.reduced ? "reduce" : "no-preference" });
    page = await context.newPage(); page.setDefaultTimeout(15000);
    report.pageErrors = []; page.on("pageerror", e => report.pageErrors.push(String(e)));
    await env.server.run(async () => {
      await step("Real isolated project import and existing title/artwork preview", async () => {
        await env.open(page); await openLayout();
        assert.equal(await page.locator(".renpy-title-heading h1").innerText(), project.title);
        assert.notEqual(await page.getByTestId("renpy-imported-title-background").evaluate(n => getComputedStyle(n).backgroundImage), "none");
        await shot("before"); return { projectTitle: project.title, realPreview: true };
      });
      await step("Ordinary title-only visibility setting survives layout save and reopen", async () => {
        const visible = page.getByRole("checkbox", { name: "显示标题", exact: true });
        assert.equal(await visible.count(), 1, "普通标题属性缺少独立“显示标题”开关；不能用隐藏整个标题容器或代码覆盖代替");
        assert(await visible.isChecked()); await visible.uncheck(); await assertHiddenTitle();
        const r = await visible.evaluate(n => { const r = n.getBoundingClientRect(); return { ...r.toJSON(),
          hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), overflow: document.documentElement.scrollWidth - innerWidth }; });
        assert(r.hit && r.x >= 0 && r.y >= 0 && r.right <= viewport.width && r.bottom <= viewport.height && r.overflow <= 1);
        report.checkboxGeometry = r; save();
        assert.equal(r.width, r.height, "A title visibility checkbox must stay square rather than inherit a text input's minimum height");
        assert(r.width >= 16 && r.width <= 20);
        await page.locator('[data-help-key="layout.save"]:visible').click();
        await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent?.includes("已保存"));
        await page.reload(); await page.getByRole("button", { name: "继续上次编辑", exact: true }).click();
        await page.locator(".editor-toolbar").waitFor(); await openLayout();
        assert.equal(await page.getByRole("checkbox", { name: "显示标题", exact: true }).isChecked(), false);
        await assertHiddenTitle(); await shot("hidden-after-reopen");
        return { hiddenOnlyTitle: true, artworkAndVersionRetained: true, savedAndReopened: true };
      });
      if (process.argv.includes("--wording")) {
        await step("Independent version wording, empty override and project inheritance", async () => {
          const titleVisible = page.getByRole("checkbox", { name: "显示标题", exact: true });
          const versionVisible = page.getByRole("checkbox", { name: "显示版本", exact: true });
          await versionVisible.uncheck();
          assert.equal(await page.locator(".renpy-title-heading p:visible").count(), 0);
          await titleVisible.check();
          await page.getByRole("button", { name: "自定义标题文字", exact: true }).click();
          assert.equal(await page.locator(".renpy-title-heading h1:visible").count(), 0, "An empty override is not inheritance");
          await page.getByRole("textbox", { name: "标题文字", exact: true }).fill("自定义作品标题");
          assert.equal(await page.locator(".renpy-title-heading h1").innerText(), "自定义作品标题");
          await page.getByRole("button", { name: "自定义版本文字", exact: true }).click();
          await page.getByRole("textbox", { name: "版本文字", exact: true }).fill("特别版 · 第一卷");
          assert.equal(await page.locator(".renpy-title-heading p:visible").count(), 0, "Hidden wording stays hidden");
          await versionVisible.check();
          assert.equal(await page.locator(".renpy-title-heading p").innerText(), "特别版 · 第一卷");
          await page.getByRole("button", { name: "恢复标题工程继承", exact: true }).click();
          assert.equal(await page.locator(".renpy-title-heading h1").innerText(), project.title);
          await titleVisible.uncheck();
          return { titleAndVersionIndependent: true, emptyDistinctFromInherit: true, inheritanceRestored: true };
        });
        await step("Native menu text is editable without replacing its action", async () => {
          await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_help_button"]').click();
          const text = page.getByRole("textbox", { name: "菜单按钮文字", exact: true });
          assert.equal(await text.count(), 1, "普通模式必须能直接编辑菜单文案");
          await text.fill("操作说明");
          assert.equal(await page.locator('.renpy-title-action').filter({ hasText: "操作说明" }).count(), 1);
        });
      }
      if (process.argv.includes("--full")) {
        assert(process.argv.includes("--wording"));
        const expected = { title: { visible: false }, version: { text: "特别版 · 第一卷" } };
        await step("Saved portable project retains text and both independent profiles", async () => {
          await page.locator('[data-help-key="layout.save"]:visible').click();
          await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent?.includes("已保存"));
          const pending = page.waitForEvent("download");
          await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
          const download = await pending, file = path.join(out, "保存后的工程.vnproj");
          await download.saveAs(file);
          const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
          const saved = JSON.parse(await zip.file("project.json").async("string"));
          assert.equal(saved.project_id, project.project_id); assert.equal(saved.title, project.title);
          assert.deepEqual(saved.editor_settings.runtimeUILayout.renpyTitleText, expected);
          const profiles = saved.editor_settings.runtimeUILayoutProfiles;
          assert.deepEqual(profiles.profiles.agentvn, project.editor_settings.runtimeUILayoutProfiles.profiles.agentvn);
          assert.deepEqual(profiles.profiles.renpy.renpyTitleText, expected);
          report.portable = { path: file, sha256: sha(file), expected };
          await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
          await page.getByTestId("project-save-confirmation").waitFor({ state: "detached" });
          await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
          await page.locator('[data-help-key="toolbar.importProject"] input').setInputFiles(file);
          await page.locator(".editor-toolbar").waitFor(); await openLayout();
          assert.equal(await page.locator(".renpy-title-heading h1:visible").count(), 0);
          assert.equal(await page.locator(".renpy-title-heading p").innerText(), "特别版 · 第一卷");
          assert.equal(await page.locator(".renpy-title-action").filter({ hasText: "操作说明" }).count(), 1);
          await shot("portable-reopened");
          return report.portable;
        });
        await step("Real publish download includes only the active layout and exact background bytes", async () => {
          await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
          await page.locator('[data-package-stage="settings"]').click();
          await page.locator('[data-help-key="package.mode"]').click();
          await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
          const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
          if (await warnings.isVisible()) await warnings.click();
          const consent = page.locator('[data-help-key="package.confirmWarnings"]');
          if (await consent.isVisible()) await consent.check();
          const pending = page.waitForEvent("download");
          await page.locator('[data-help-key="package.export"]:visible').click();
          const download = await pending, file = path.join(out, "主页文字.vncart");
          await download.saveAs(file);
          const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
          const skin = JSON.parse(await zip.file("ui/layout.json").async("string"));
          const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
          assert.equal(manifest.title, project.title); assert.equal(manifest.runtime_version, "0.26.0");
          assert.deepEqual(skin.renpyTitleText, expected); assert.equal(skin.layout_type, "renpy");
          assert(!JSON.stringify(skin).includes("runtimeUILayoutProfiles"));
          const art = manifest.assets.find(asset => asset.asset_id === "qa_title_art"); assert(art);
          assert.equal(await zip.file(art.path).async("string"), svg);
          report.cartridge = { path: file, sha256: sha(file), runtimeVersion: manifest.runtime_version,
            layoutSha: createHash("sha256").update(await zip.file("ui/layout.json").async("nodebuffer")).digest("hex"),
            exactArtBytes: true };
          return report.cartridge;
        });
        await step("Actual Runtime imports the authored cartridge and keeps native help/start actions", async () => {
          runtimeServer = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
            logFile: path.join(out, "runtime.log") });
          report.runtimeOwner = { url: runtimeServer.url, processes: rows().filter(p => p.ProcessId === runtimeServer.pid) };
          assert.equal(report.runtimeOwner.processes.length, 1);
          const player = await context.newPage(); player.setDefaultTimeout(20000);
          player.on("pageerror", e => report.pageErrors.push(String(e)));
          await runtimeServer.run(async () => {
            await player.goto(`${runtimeServer.url}/?mode=library`);
            await player.getByTestId("web-cartridge-file").setInputFiles(report.cartridge.path);
            await player.getByRole("button", { name: "启动卡带", exact: true }).click();
            await settleRuntime(player);
            assert.equal(await player.locator(".renpy-title-heading h1:visible").count(), 0);
            assert.equal(await player.locator(".renpy-title-heading p").innerText(), "特别版 · 第一卷");
            assert.equal(await player.getByTestId("open-help").innerText(), "操作说明");
            const geometry = await player.locator(".renpy-title-view").evaluate(root => {
              const bounds = root.getBoundingClientRect(), buttons = [...root.querySelectorAll("button")];
              return { bounds: bounds.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth,
                buttons: buttons.map(button => {
                  const r = button.getBoundingClientRect();
                  return { rect: r.toJSON(), hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
                    clipped: button.scrollWidth > button.clientWidth + 1 };
                }) };
            });
            assert(geometry.overflow <= 1 && geometry.buttons.length >= 5);
            for (const b of geometry.buttons) assert(b.hit && !b.clipped && b.rect.x >= 0 && b.rect.y >= 0
              && b.rect.right <= viewport.width && b.rect.bottom <= viewport.height);
            await shot("exported-runtime-title", player);
            await player.getByTestId("open-help").click();
            await player.getByTestId("help-screen").waitFor(); await settleRuntime(player);
            await player.keyboard.press("Escape"); await settleRuntime(player);
            await player.getByTestId("start-new-game").click();
            await player.getByTestId("game-state-playing").waitFor(); await settleRuntime(player);
            report.initialStory = await player.locator(".dialog-box").innerText(); save();
            const expectedStory = project.nodes.find(n => n.id === "scene").data.scene.commands[0].text;
            await player.waitForFunction(text => document.querySelector(".dialog-box")?.textContent?.includes(text), expectedStory);
            report.revealedStory = await player.locator(".dialog-box").innerText(); save();
            assert(report.revealedStory.includes(expectedStory), "The original exported narration must become fully readable");
            await player.close();
            return geometry;
          });
          return { importedFile: report.cartridge.path, helpAndStartWorked: true, geometryVerified: true };
        });
      }
      assert.deepEqual(report.pageErrors, []);
    });
    report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page) await shot("failure").catch(error => { report.captureError = String(error); });
  } finally {
    try {
      const cleanups = await Promise.allSettled([browser?.close(), env?.stop(), runtimeServer?.stop()]);
      assert(cleanups.every(c => c.status === "fulfilled"), "All owned services and browsers must close");
      report.browserClosed = true;
      if (report.owner) {
        assert(!rows().some(p => report.owner.processes.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
        const ports = [new URL(report.owner.url).port, new URL(report.owner.backendUrl).port].map(Number);
        assert.deepEqual(listeners(ports), []); report.cleanup = { status: "PASS", absentPorts: ports };
      }
      if (report.runtimeOwner) {
        assert(!rows().some(p => report.runtimeOwner.processes.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
        const ports = [Number(new URL(report.runtimeOwner.url).port)];
        assert.deepEqual(listeners(ports), []); report.runtimeCleanup = { status: "PASS", absentPorts: ports };
      }
      assert.equal(sha(__filename), report.tool.sha256, "Do not modify a running QA tool");
      for (const f of report.sources) assert.equal(sha(path.join(root, f.file)), f.sha256, "Product sources changed during run");
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "executed.cjs"), executedTool, { flag: "wx" }); save();
    console.log(JSON.stringify({ status: report.status, out, steps: report.steps.map(s => ({ name: s.name, status: s.status })),
      error: report.error, cleanupError: report.cleanupError }));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
