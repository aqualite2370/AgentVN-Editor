"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor, settleRuntime, projectSnapshot, dismissEnvironmentCompletion } = require("./lib/installed-acceptance.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const JSZip = require("../editor/node_modules/jszip");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt, /^(?:red|green|matrix)-\d{2}$/);
const resumeArgument = process.argv.find(arg => arg.startsWith("--resume-roundtrip="));
const resumeAttempt = resumeArgument?.slice("--resume-roundtrip=".length);
if (resumeAttempt) assert.match(resumeAttempt, /^(?:green|matrix)-\d{2}$/);
const out = `F:/AgentVN/QA/Renpy-Redesign-20261021-01/controls-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const mod = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports);
const project = fixture(`renpy-control-authoring-${attempt}`);
const renpy = mod.exports.createRenpyUILayout();
project.editor_settings.runtimeUILayoutProfiles = { version: 1, activeType: "renpy",
  profiles: { agentvn: mod.exports.getDefaultUISkinLayout(), renpy } };
project.editor_settings.runtimeUILayout = structuredClone(renpy);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#394d78"/></svg>`;
project.asset_manifest = [{ asset_id: "qa_renpy_background", asset_type: "background",
  metadata: { filename: "背景图.svg", display_name: "测试背景图", mime_type: "image/svg+xml",
    width: 1280, height: 720, data_url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` } }];
const input = path.join(out, "RenPy控件隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
const report = { status: "RUNNING", scope: "SOURCE_REAL_BROWSER_NOT_INSTALLED",
  startedAt: new Date().toISOString(), cases: [], modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let env, browser, activePage, runtimeServer;
const sourceHash = () => {
  const hash = createHash("sha256");
  for (const folder of ["editor/src", "GameCli_framework/src", "shared"]) {
    for (const name of fs.readdirSync(path.join(root, folder), { recursive: true }).sort())
      if (/\.(?:ts|tsx|css)$/.test(name)) hash.update(folder + "/" + name).update(fs.readFileSync(path.join(root, folder, name)));
  }
  return hash.digest("hex");
};
const previewFingerprint = () => {
  const hash = createHash("sha256");
  const folder = path.join(root, "GameCli_framework/dist");
  const files = fs.readdirSync(folder, { recursive: true }).filter(name =>
    /\.(?:html|js|css)$/.test(name)).sort();
  assert(files.length > 0, "The actual embedded Runtime build must exist");
  for (const name of files) hash.update(name).update(fs.readFileSync(path.join(folder, name)));
  return hash.digest("hex");
};
async function authorRoundtrip(page, context, m) {
  const saved = await projectSnapshot(new URL(env.backendUrl).port);
  const profiles = saved.settings.runtimeUILayoutProfiles;
  assert.equal(profiles.activeType, "renpy");
  assert.deepEqual(profiles.profiles.agentvn, project.editor_settings.runtimeUILayoutProfiles.profiles.agentvn,
    "The author chain must preserve the other layout");
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存工程", exact: true }).click();
  const download = await pending, portable = path.join(out, "作者链保存重开.vnproj");
  await download.saveAs(portable);
  await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
  const zip = await JSZip.loadAsync(fs.readFileSync(portable));
  const document = JSON.parse(await zip.file("project.json").async("string"));
  assert.deepEqual(document.editor_settings.runtimeUILayoutProfiles, profiles);
  const asset = document.asset_manifest.find(a => a.asset_id === "qa_renpy_background");
  assert(asset?.metadata.project_path);
  assert.equal(await zip.file(asset.metadata.project_path).async("string"), svg);
  const fresh = await browser.newContext({ viewport: { width: m.width, height: m.height },
    deviceScaleFactor: m.dpr, reducedMotion: m.reduced ? "reduce" : "no-preference" });
  try {
    const reopened = activePage = await fresh.newPage();
    await reopened.goto(env.url);
    await reopened.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some(e => !e.disabled));
    await reopened.locator(".project-import-button input").first().setInputFiles(portable);
    await reopened.waitForFunction(() => document.querySelector(".editor-toolbar") && !document.querySelector(".project-entry-loading-overlay"));
    await settleEditor(reopened);
    assert.deepEqual((await projectSnapshot(new URL(env.backendUrl).port)).settings.runtimeUILayoutProfiles, profiles);
    await reopened.locator('[data-workspace-surface="options"]:visible').click();
    await reopened.locator('[data-help-key="advanced.tab.layout"]:visible').click();
    await reopened.getByTestId("renpy-title-editor").waitFor(); await settleEditor(reopened);
    assert.equal(await reopened.locator('.renpy-title-action[data-ui-component-id="title_start_button"]')
      .evaluate(e => getComputedStyle(e).backgroundColor), "rgb(116, 43, 89)");
    await reopened.getByTestId("renpy-player-layout-entry").click();
    await reopened.locator('[data-preview-phase="ready"]').waitFor();
    for (const [mode, label] of [["nvl", "NVL 累积阅读"], ["bubble", "气泡对白"]]) {
      await reopened.getByRole("combobox", { name: "对白布局模式", exact: true }).click();
      await reopened.getByRole("option", { name: label, exact: true }).click();
      await reopened.locator('[data-preview-phase="ready"]').waitFor();
      const runtime = reopened.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
      assert.equal(await runtime.locator(".dialog-box").evaluate(e => getComputedStyle(e).borderRadius), "7px");
      const text = runtime.locator(mode === "nvl" ? ".nvl-page .nvl-page-text" : ".dialog-text").first();
      assert.equal(await text.evaluate(e => getComputedStyle(e).color), "rgb(119, 255, 204)");
    }
    await reopened.getByRole("button", { name: "返回页面导航", exact: true }).click();
    await reopened.getByTestId("renpy-confirmation-layout-entry").click();
    await reopened.locator('[data-preview-phase="ready"]').waitFor();
    assert.equal(await reopened.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]').locator(".modal-panel")
      .evaluate(e => getComputedStyle(e).backgroundColor), "rgb(38, 55, 74)");
    report.cases.push({ ...m, status: "PASS", behavior: "real-portable-save-fresh-context-import-and-special-region-preview",
      portable, sha256: createHash("sha256").update(fs.readFileSync(portable)).digest("hex"),
      otherLayoutUnchanged: true, backendRestartClaimed: false }); save();
    await reopened.locator('[data-workspace-surface="publish"]:visible').click();
    const publishing = reopened.locator(".cartridge-export-panel"); await publishing.waitFor();
    await reopened.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
    await dismissEnvironmentCompletion(reopened);
    await publishing.locator('[data-help-key="package.mode"]').click();
    await reopened.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    await publishing.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
    const warning = publishing.getByRole("checkbox", { name: /我已检查全部警告/ });
    if (await warning.count()) await warning.check();
    const exported = reopened.waitForEvent("download");
    await publishing.locator(".package-primary-action").click();
    const cartridge = path.join(out, "作者链真实导出.vncart"); await (await exported).saveAs(cartridge);
    const gameZip = await JSZip.loadAsync(fs.readFileSync(cartridge));
    const skin = JSON.parse(await gameZip.file("ui/layout.json").async("string"));
    assert.equal(skin.layout_type, "renpy"); assert.equal(skin.advancedPresentationEnabled, true);
    assert.deepEqual(skin.dialogueLayouts, profiles.profiles.renpy.dialogueLayouts);
    assert.deepEqual(skin.confirmationLayout, profiles.profiles.renpy.confirmationLayout);
    runtimeServer = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(out, "roundtrip-runtime.log") });
    report.runtimeOwner = { pid: runtimeServer.pid, url: runtimeServer.url }; save();
    await runtimeServer.run(async () => {
      const player = activePage = await fresh.newPage();
      await player.goto(`${runtimeServer.url}/?mode=library`);
      await player.getByTestId("web-cartridge-file").setInputFiles(cartridge);
      await player.locator(".launch-panel").getByRole("button", { name: "启动卡带", exact: true }).click();
      await player.getByTestId("start-new-game").waitFor(); await settleRuntime(player);
      assert.equal(await player.getByTestId("start-new-game").evaluate(e => getComputedStyle(e).backgroundColor), "rgb(116, 43, 89)");
      await player.getByTestId("open-about").click(); await settleRuntime(player);
      const background = await player.locator(".about-card").evaluate(e => getComputedStyle(e).backgroundImage);
      assert.notEqual(background, "none");
      await player.getByTestId("renpy-menu-help").click(); await settleRuntime(player);
      assert.notEqual(await player.locator(".help-card").evaluate(e => getComputedStyle(e).backgroundImage), "none");
      await player.getByTestId("renpy-menu-return").click(); await settleRuntime(player);
      await player.getByTestId("start-new-game").click(); await player.getByTestId("game-state-playing").waitFor();
      await settleRuntime(player);
      assert.equal(await player.locator(".renpy-quick-bar button").count(), 9);
      assert.notEqual(await player.getByTestId("renpy-quick-auto").evaluate(e => getComputedStyle(e).backgroundImage), "none");
      report.cases.push({ ...m, status: "PASS", behavior: "same-ui-exported-cartridge-real-browser-library-import-and-player-consumption",
        cartridge, sha256: createHash("sha256").update(fs.readFileSync(cartridge)).digest("hex"),
        sourceRuntime: true, installedOrAndroidClaimed: false }); save();
      await player.close();
    });
  } finally { await fresh.close(); activePage = page; }
}
(async () => {
  report.sourceSHA256 = sourceHash();
  report.runtimePreviewSHA256 = previewFingerprint();
  if (resumeAttempt) {
    const priorFile = `F:/AgentVN/QA/Renpy-Redesign-20261021-01/controls-${resumeAttempt}/report.json`;
    const prior = JSON.parse(fs.readFileSync(priorFile));
    assert.equal(prior.sourceSHA256, report.sourceSHA256);
    assert.equal(prior.runtimePreviewSHA256, report.runtimePreviewSHA256);
    assert(prior.cases.some(c => c.behavior === "confirmation-selected-region-safe-code-native-preview" && c.status === "PASS"));
    report.priorAuthor = { path: priorFile, sha256: createHash("sha256").update(fs.readFileSync(priorFile)).digest("hex"),
      status: prior.status, sourceUnchanged: true };
  }
  save(); env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  report.owner = { pid: env.server.pid, backendPid: env.backendPid, url: env.url, backendUrl: env.backendUrl }; save();
  browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
  const matrix = process.env.RENPY_AUTHOR_MATRIX === "1"
    ? [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
      [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))))
    : [{ width: 1920, height: 1080, dpr: 1, reduced: false }];
  for (const m of matrix) {
    const context = await browser.newContext({ viewport: { width: m.width, height: m.height },
      deviceScaleFactor: m.dpr, reducedMotion: m.reduced ? "reduce" : "no-preference" });
    const page = activePage = await context.newPage(); page.setDefaultTimeout(12000);
    await env.server.run(async () => {
      if (resumeAttempt) {
        await page.goto(env.url);
        await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some(e => !e.disabled));
        await page.locator(".project-import-button input").first().setInputFiles(
          `F:/AgentVN/QA/Renpy-Redesign-20261021-01/controls-${resumeAttempt}/作者链保存重开.vnproj`);
        await page.waitForFunction(() => document.querySelector(".editor-toolbar") && !document.querySelector(".project-entry-loading-overlay"));
        await settleEditor(page);
        await authorRoundtrip(page, context, m);
        return;
      }
      await env.open(page); await settleEditor(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
      const typeGeometry = await page.getByTestId("runtime-layout-type-control").evaluate(e => {
        const type = e.querySelector('[data-layout-type-option="renpy"]').getBoundingClientRect();
        const advanced = e.querySelector(".runtime-layout-advanced-toggle").getBoundingClientRect();
        return { type: type.toJSON(), advanced: advanced.toJSON() };
      });
      assert(typeGeometry.advanced.left >= typeGeometry.type.right
        && typeGeometry.advanced.top >= typeGeometry.type.top - 3
        && typeGeometry.advanced.bottom <= typeGeometry.type.bottom + 3,
        "The independent advanced checkbox must remain immediately right of Ren’Py on the same toolbar row");
      await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_hero"]').click();
      await page.getByRole("combobox", { name: "当前控件背景图", exact: true }).click();
      await page.getByRole("option", { name: "测试背景图", exact: true }).click();
      const preview = page.getByTestId("renpy-imported-title-background");
      await preview.waitFor();
      const image = await preview.evaluate(e => getComputedStyle(e).backgroundImage);
      assert.notEqual(image, "none");
      const imageUrl = /^url\("(.*)"\)$/.exec(image)?.[1]; assert(imageUrl, "Resolved project image URL");
      assert.equal(await page.evaluate(async url => (await fetch(url)).text(), imageUrl), svg,
        "The rendered image must contain the actual selected resource bytes");
      await page.getByRole("combobox", { name: "背景图适配", exact: true }).click();
      await page.getByRole("option", { name: "完整显示", exact: true }).click();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="renpy-imported-title-background"]')).backgroundSize === "contain");
      assert.equal(await page.getByTestId("renpy-background-source").innerText(), "当前控件覆盖");
      const geometry = await page.getByRole("combobox", { name: "当前控件背景图", exact: true }).evaluate(e => {
        const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { rect: r.toJSON(), hit: e.contains(hit), overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert(geometry.hit && geometry.overflow <= 1 && geometry.rect.right <= m.width && geometry.rect.bottom <= m.height);
      await page.locator('[data-help-key="layout.save"]:visible').click();
      await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent?.includes("已保存"));
      await page.reload();
      await page.getByRole("button", { name: "继续上次编辑", exact: true }).click();
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
      assert.equal(await page.getByTestId("renpy-imported-title-background").evaluate(e => getComputedStyle(e).backgroundSize), "contain");
      await page.getByRole("button", { name: "清除当前控件背景图", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="renpy-imported-title-background"]')
        || getComputedStyle(document.querySelector('[data-testid="renpy-imported-title-background"]')).backgroundImage === "none");
      if (process.argv.includes("--advanced")) {
        const start = page.locator('.renpy-title-action[data-ui-component-id="title_start_button"]');
        await start.click();
        assert.equal(await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_start_button"]').getAttribute("aria-pressed"), "true",
          "Clicking Runtime preview selects its exact authored control");
        const inheritedFont = await start.evaluate(e => getComputedStyle(e).fontSize);
        await page.getByRole("combobox", { name: "当前控件背景图", exact: true }).click();
        await page.getByRole("option", { name: "测试背景图", exact: true }).click();
        await page.getByRole("combobox", { name: "背景图适配", exact: true }).click();
        await page.getByRole("option", { name: "完整显示", exact: true }).click();
        assert.equal(await start.evaluate(e => getComputedStyle(e).fontSize), inheritedFont,
          "Repeated background edits must preserve the inherited navigation font");
        await page.getByRole("button", { name: "清除当前控件背景图", exact: true }).click();
        const before = await start.evaluate(e => getComputedStyle(e).backgroundColor);
        const advanced = page.getByRole("checkbox", { name: "Ren’Py进阶代码编辑", exact: true });
        await advanced.check();
        await page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }).click();
        const css = '.root { background-color: #742b59; border-radius: 6px; padding: 8px; } .body { color: white; }';
        await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(css);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.renpy-title-action[data-ui-component-id="title_start_button"]')).backgroundColor === "rgb(116, 43, 89)");
        if (process.argv.includes("--title-controls")) for (const id of ["title_help_button", "title_exit_button"]) {
          await page.locator(`[data-testid="renpy-page-region-editor"] [data-component-id="${id}"]`).click();
          await page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }).click();
          await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(".root { color: #aaffdd; }");
          await page.waitForFunction(id => getComputedStyle(document.querySelector(
            `.renpy-title-action[data-ui-component-id="${id}"]`)).color === "rgb(170, 255, 221)", id);
          await page.locator('[data-help-key="layout.save"]:visible').click();
          await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent?.includes("已保存"));
        }
        await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_start_button"]').click();
        assert.equal(await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_start_button"]').getAttribute("aria-pressed"), "true",
          "Code/property assertions belong to the currently selected Start control, after independently editing Help/Exit");
        assert.equal(await start.getAttribute("data-control-slot-count"), "1");
        assert.match(await start.innerText(), /开始游戏/);
        assert.equal(await page.getByRole("spinbutton", { name: "当前控件内容留白", exact: true }).inputValue(), "8",
          "Graphical controls show the effective code value");
        assert.equal(await page.getByRole("spinbutton", { name: "当前控件内容留白", exact: true }).isDisabled(), true,
          "A graphical edit cannot silently erase a code-owned property");
        assert.match(await page.locator('[data-code-property="padding"]').innerText(), /代码覆盖/);
        await advanced.uncheck();
        assert.equal(await start.evaluate(e => getComputedStyle(e).backgroundColor), before, "Unchecking pauses code effects");
        await advanced.check();
        assert.equal(await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).inputValue(), css, "Code remains authored while paused");
        await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill("body { color: red; }");
        await page.getByRole("alert").filter({ hasText: "代码未应用" }).waitFor();
        assert.equal(await page.locator('[data-help-key="layout.save"]:visible').isDisabled(), true);
        assert.equal(await start.evaluate(e => getComputedStyle(e).backgroundColor), "rgb(116, 43, 89)",
          "Invalid code preserves the last valid Runtime preview");
        await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(css);
        await page.locator('[data-help-key="layout.save"]:visible').click();
        await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent?.includes("已保存"));
        await page.reload();
        await page.getByRole("button", { name: "继续上次编辑", exact: true }).click();
        await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
        await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.renpy-title-action[data-ui-component-id="title_start_button"]')).backgroundColor === "rgb(116, 43, 89)");
        report.cases.push({ ...m, status: "PASS", behavior: "preview-selection-code-pause-restore-invalid-save-restart" }); save();
      }
      if (process.argv.includes("--pages")) {
        const visited = [];
        for (const [label, id] of [["关于", "about_panel"], ["帮助", "help_panel"], ["选项", "settings_group"],
          ["历史", "history_list"], ["存档/读档", "save_grid"], ["画廊", "gallery_grid"]]) {
          await page.getByRole("navigation", { name: "布局页面", exact: true }).getByRole("button", { name: label, exact: true }).click();
          await page.getByTestId("renpy-menu-editor").waitFor();
          await page.locator('[data-preview-phase="ready"]').waitFor();
          const runtime = page.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
          const frame = page.frames().find(frame => frame.url().includes("/gamecli-preview/"));
          await settleRuntime(frame);
          const panel = runtime.locator(`[data-ui-component-id="${id}"]`);
          await panel.click();
          assert.equal(await page.locator(`[data-testid="renpy-page-region-editor"] [data-component-id="${id}"]`).getAttribute("aria-pressed"), "true");
          await frame.evaluate(() => {
            window.__authoringFrames = []; window.__recordAuthoring = true;
            const sample = () => {
              if (!window.__recordAuthoring) return;
              const blackout = document.querySelector('[data-testid="game-launch-blackout"]');
              window.__authoringFrames.push({ blackout: Boolean(blackout),
                phase: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition") });
              if (window.__authoringFrames.length < 2000) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          await page.getByRole("combobox", { name: "当前控件背景图", exact: true }).click();
          await page.getByRole("option", { name: "测试背景图", exact: true }).click();
          await page.locator('[data-preview-phase="ready"]').waitFor();
          await panel.waitFor();
          await settleRuntime(frame);
          const frames = await frame.evaluate(() => { window.__recordAuthoring = false; return window.__authoringFrames; });
          assert(frames.length > 0 && !frames.some(frame => frame.blackout),
            `A ${id} appearance edit must not reinitialize the story or introduce a launch blackout: ${JSON.stringify(frames)}`);
          const panelGeometry = await panel.evaluate(e => {
            const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            if (getComputedStyle(e).backgroundImage === "none"
              && !Array.from(e.querySelectorAll("*")).some(n => getComputedStyle(n).backgroundImage !== "none"))
              throw new Error("The selected background is absent from the actual Runtime panel");
            return { rect: r.toJSON(), hit: e.contains(hit), viewport: { width: innerWidth, height: innerHeight },
              overflow: document.documentElement.scrollWidth - innerWidth };
          });
          assert(panelGeometry.hit && panelGeometry.rect.left >= -1 && panelGeometry.rect.top >= -1
            && panelGeometry.rect.right <= panelGeometry.viewport.width + 1
            && panelGeometry.rect.bottom <= panelGeometry.viewport.height + 1 && panelGeometry.overflow <= 1,
            `Actual Runtime panel ${id} must remain visible and reachable`);
          await page.getByTestId("renpy-title-runtime-preview-toggle").click();
          const destination = id === "help_panel" ? "about" : "help";
          await runtime.getByTestId(`renpy-menu-${destination}`).click();
          await page.locator(`[data-editor-page="${destination}"]`).waitFor();
          await settleRuntime(frame);
          await page.getByTestId("renpy-title-static-preview-toggle").click();
          visited.push({ label, id, geometry: panelGeometry });
        }
        report.cases.push({ ...m, status: "PASS", behavior: "actual-menu-runtime-selection-and-background", pages: visited }); save();
      }
      if (process.argv.includes("--player")) {
        await page.getByTestId("renpy-player-layout-entry").click();
        await page.locator('[data-active-screen="player"]').waitFor();
        await page.locator('[data-preview-phase="ready"]').waitFor();
        const runtime = page.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
        await runtime.getByTestId("renpy-quick-auto").click();
        assert.equal(await page.locator('.runtime-layout-component-list label[data-component-id="quick_auto_button"]').getAttribute("class"), "is-active",
          "Actual quick button clicks select its own authored control, without activating automatic progression");
        await page.getByRole("combobox", { name: "当前控件背景图", exact: true }).click();
        await page.getByRole("option", { name: "测试背景图", exact: true }).click();
        await page.locator('[data-preview-phase="ready"]').waitFor();
        assert.notEqual(await runtime.getByTestId("renpy-quick-auto").evaluate(e => getComputedStyle(e).backgroundImage), "none");
        for (const [action, id] of [["save", "quick_save_button"], ["load", "quick_load_button"], ["settings", "quick_settings_button"]]) {
          await runtime.getByTestId(`renpy-quick-${action}`).click();
          assert.equal(await page.locator(`.runtime-layout-component-list label[data-component-id="${id}"]`).getAttribute("class"), "is-active",
            `${action} must select its own editable native control, without running its action`);
          await page.getByRole("combobox", { name: "当前控件背景图", exact: true }).click();
          await page.getByRole("option", { name: "测试背景图", exact: true }).click();
          await page.locator('[data-preview-phase="ready"]').waitFor();
          await page.waitForFunction(action => {
            const frame = document.querySelector("iframe");
            return getComputedStyle(frame.contentDocument.querySelector(`[data-testid="renpy-quick-${action}"]`)).backgroundImage !== "none";
          }, action);
        }
        if (process.argv.includes("--stage")) {
          await page.locator('.runtime-layout-component-list label[data-component-id="stage_background"] button').click();
          assert.equal(await page.getByRole("combobox", { name: "当前控件背景图", exact: true }).isDisabled(), true,
            "The default stage is explicitly locked; inspecting it cannot mutate that protected component");
          assert.equal(await page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }).isDisabled(), true);
        }
        if (process.argv.includes("--choices")) {
          await page.locator('.runtime-layout-component-list label[data-component-id="choice_option"] button').click();
          await page.locator('[data-preview-phase="ready"]').waitFor();
          const choice = runtime.getByRole("button", { name: "选择：示例分支", exact: true });
          await choice.waitFor();
          await choice.click();
          assert.equal(await page.locator('.runtime-layout-component-list label[data-component-id="choice_option"]')
            .getAttribute("class"), "is-active", "The native option selects its shared editable choice style");
          await page.getByRole("combobox", { name: "当前控件背景图", exact: true }).click();
          await page.getByRole("option", { name: "测试背景图", exact: true }).click();
          await page.locator('[data-preview-phase="ready"]').waitFor();
          assert.notEqual(await choice.evaluate(e => getComputedStyle(e).backgroundImage), "none");
          await page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }).click();
          await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(".root { color: #77ffcc; }");
          await page.locator('[data-preview-phase="ready"]').waitFor();
          assert.equal(await choice.evaluate(e => getComputedStyle(e).color), "rgb(119, 255, 204)");
        }
        report.cases.push({ ...m, status: "PASS", behavior: "actual-player-preview-selected-button-ordinary-background" }); save();
      }
      if (process.argv.includes("--regions")) {
        for (const [mode, label] of [["nvl", "NVL 累积阅读"], ["bubble", "气泡对白"]]) {
          await page.getByRole("combobox", { name: "对白布局模式", exact: true }).click();
          await page.getByRole("option", { name: label, exact: true }).click();
          await page.getByTestId("dialogue-mode-layout-editor").waitFor();
          await page.locator('[data-preview-phase="ready"]').waitFor();
          const runtime = page.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
          await page.getByRole("combobox", { name: "当前控件背景图", exact: true }).click();
          await page.getByRole("option", { name: "测试背景图", exact: true }).click();
          await page.locator('[data-preview-phase="ready"]').waitFor();
          const panel = runtime.locator(".dialog-box");
          assert.notEqual(await panel.evaluate(e => getComputedStyle(e).backgroundImage), "none",
            `Ordinary ${mode} background editing uses the actual Runtime`);
          await page.getByRole("checkbox", { name: "Ren’Py进阶代码编辑", exact: true }).check();
          await page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }).click();
          await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(".root { border-radius: 7px; }");
          await page.locator('[data-preview-phase="ready"]').waitFor();
          assert.equal(await panel.evaluate(e => getComputedStyle(e).borderRadius), "7px");
          await page.getByRole("button", { name: "正文", exact: true }).click();
          await page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }).click();
          await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(".root { color: #77ffcc; }");
          await page.locator('[data-preview-phase="ready"]').waitFor();
          const text = runtime.locator(mode === "nvl" ? ".nvl-page .nvl-page-text" : ".dialog-text").first();
          assert.equal(await text.evaluate(e => getComputedStyle(e).color), "rgb(119, 255, 204)");
          await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill("body { color: red; }");
          await page.getByRole("alert").filter({ hasText: "代码未应用" }).waitFor();
          assert.equal(await page.locator('[data-help-key="layout.save"]:visible').isDisabled(), true);
          assert.equal(await text.evaluate(e => getComputedStyle(e).color), "rgb(119, 255, 204)",
            "Invalid mode code keeps the previous valid visual state");
          await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(".root { color: #77ffcc; }");
          await page.locator('[data-help-key="layout.save"]:visible').click();
          await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent?.includes("已保存"));
          report.cases.push({ ...m, status: "PASS", behavior: `${mode}-ordinary-and-advanced-native-preview` }); save();
        }
        await page.getByRole("button", { name: "返回页面导航", exact: true }).click();
        await page.getByTestId("renpy-confirmation-layout-entry").click();
        await page.getByTestId("confirmation-layout-editor").waitFor();
        await page.locator('[data-preview-phase="ready"]').waitFor();
        await page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }).click();
        await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(".root { background-color: #26374a; }");
        await page.locator('[data-preview-phase="ready"]').waitFor();
        const runtime = page.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
        assert.equal(await runtime.locator(".modal-panel").evaluate(e => getComputedStyle(e).backgroundColor), "rgb(38, 55, 74)");
        await page.locator('[data-help-key="layout.save"]:visible').click();
        await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent?.includes("已保存"));
        report.cases.push({ ...m, status: "PASS", behavior: "confirmation-selected-region-safe-code-native-preview" }); save();
      }
      if (process.argv.includes("--roundtrip")) {
        assert(["--advanced", "--title-controls", "--pages", "--player", "--regions"]
          .every(flag => process.argv.includes(flag)), "Roundtrip needs the full authored control chain");
        await authorRoundtrip(page, context, m);
      }
      await page.mouse.move(10, 10);
      const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      assert.deepEqual(actual, m, "Sample actual parameters before capturing, without resizing");
      const screenshot = `${m.width}x${m.height}-dpr${m.dpr}-${m.reduced ? "reduced" : "ordinary"}.png`;
      const png = await page.screenshot({ path: path.join(out, screenshot) });
      assert.equal(png.readUInt32BE(16), m.width * m.dpr);
      assert.equal(png.readUInt32BE(20), m.height * m.dpr);
      assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches })), actual, "Capture cannot change the tested environment");
      report.cases.push({ ...m, status: "PASS", behavior: "selected-control-background-fit-save-restart-clear", geometry, actual, screenshot }); save();
    });
    await context.close(); activePage = undefined;
  }
  assert.equal(report.cases.length, matrix.length * (resumeAttempt ? 2 : (1 + Number(process.argv.includes("--advanced")) + Number(process.argv.includes("--pages"))
    + Number(process.argv.includes("--player")) + Number(process.argv.includes("--regions")) * 3
    + Number(process.argv.includes("--roundtrip")) * 2)));
  assert.equal(sourceHash(), report.sourceSHA256, "Source changed while acceptance was running; rerun against a stable candidate");
  assert.equal(previewFingerprint(), report.runtimePreviewSHA256, "The embedded Runtime build changed during acceptance");
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  await activePage?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
}).finally(async () => {
  await browser?.close(); await runtimeServer?.stop(); await env?.stop();
  const alive = await Promise.all([env?.url, env?.backendUrl, runtimeServer?.url].filter(Boolean).map(async url => {
    try { await fetch(url, { signal: AbortSignal.timeout(700) }); return url; } catch { return null; }
  }));
  report.cleanup = alive.some(Boolean) ? "FAILED" : "PASS";
  if (alive.some(Boolean)) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
