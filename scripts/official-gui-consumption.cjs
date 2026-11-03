"use strict";
// QA only: full unmodified official GUI -> real Editor import/save/reopen/
// downloads -> actual Runtime library. No store writes or model requests.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { fixture, startEditorAcceptance, resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor, settleRuntime, select } = require("./lib/installed-acceptance.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Official-GUI-Consumption-20261020-01";
const checkpoint = "F:/AgentVN/Checkpoints/Official-GUI-Consumption-20261020-01";
const out = path.join(root, "output/official-gui-consumption-20261020-01");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sha = file => hash(fs.readFileSync(file));
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const writeNew = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), { flag: "wx" });
const productFiles = [
  "shared/cartridge/renpyGui.ts", "shared/cartridge/uiSkin.ts", "shared/cartridge/uiLayoutProfiles.ts",
  "editor/src/renpy/renpyGuiImport.ts", "editor/src/renpy/renpyGuiImportPlan.ts",
  "editor/src/components/advanced/RenpyGuiImportWorkbench.tsx",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx", "editor/src/cartridge/exportCartridge.ts",
  "editor/src/cartridge/collectProjectAssets.ts", "editor/src/utils/projectBundle.ts",
  "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx", "GameCli_framework/src/components/shell/MainMenu.tsx",
  "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
  "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
  "GameCli_framework/src/components/shell/SaveLoadScreen.tsx",
  "GameCli_framework/src/components/shell/SettingsScreen.tsx",
  "GameCli_framework/src/components/player/DialogBox.tsx", "GameCli_framework/src/components/player/ChoicePanel.tsx",
  "GameCli_framework/src/components/shell/renpy-title.css", "GameCli_framework/src/components/shell/renpy-menu.css",
  "GameCli_framework/src/styles/renpy-button-roles.css", "GameCli_framework/src/styles/player.css",
];
const bindings = {
  "gui/main_menu.png": "标题页主视觉",
  "gui/textbox.png": "对白面板背景",
  "gui/button/choice_idle_background.png": "分支选项按钮背景",
  "gui/button/quick_idle_background.png": "共享按钮 · 普通状态",
  "gui/button/quick_hover_background.png": "共享按钮 · 悬停/聚焦状态",
  "DejaVuSans.ttf": "全局界面字体",
};
const prefix = "官方模板 中文/game/";
const matrices = [];
for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
  for (const dpr of [1, 2]) for (const reduced of [false, true])
    matrices.push({ width, height, dpr, reduced, key: `${width}-dpr${dpr}-${reduced ? "reduce" : "normal"}` });
function sources() { return productFiles.map(file => ({ file, sha256: sha(path.join(root, file)) })); }
function unchanged(before) {
  for (const entry of before) assert.equal(sha(path.join(root, entry.file)), entry.sha256, `Source changed: ${entry.file}`);
}
function prep() { return read(path.join(out, "preparation.json")); }
function artifact(file) {
  return { path: file, sha256: sha(file), bytes: fs.statSync(file).size, generatedAt: fs.statSync(file).mtime.toISOString() };
}
async function prepare() {
  for (const dir of [qa, checkpoint, out]) assert(!fs.existsSync(dir), `Preserve prior directory: ${dir}`);
  const old = read("F:/AgentVN/Checkpoints/GUI-Scope-20261019-01/manifest.json");
  const official = { ...old.officialArchive, path: "F:/AgentVN/QA/AgentVN-QA-InstalledGui-20261018-01/官方完整界面模板.zip" };
  assert.equal(sha(official.path), official.sha256);
  for (const file of [...productFiles, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md", "AGENTS.md", __filename])
    assert(fs.existsSync(path.resolve(root, file)), file);
  for (const dir of [qa, checkpoint, out]) fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const file of [...productFiles, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md", "AGENTS.md",
    "scripts/official-gui-consumption.cjs"]) {
    const target = path.join(checkpoint, "files", file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(target), sha(path.join(root, file)));
    saved.push({ file, sha256: sha(target) });
  }
  const project = fixture("official-gui-consumption-20261020-01");
  project.title = "官方 GUI 玩家消费 隔离验收";
  project.nodes[1].data.scene.commands = [
    { type: "dialog", character_id: "gui-speaker", text: "GUI_CONSUMPTION：完整官方资源，中文字体回退与实际对白面板。" },
    { type: "choice", choices: [
      { choice_id: "again", choice_display_name: "再次检查", text: "再次检查 GUI_REPEAT", target_scene_id: "ui_acceptance", conditions: [] },
      { choice_id: "also", choice_display_name: "继续检查", text: "继续检查 GUI_CONTINUE", target_scene_id: "ui_acceptance", conditions: [] },
    ] },
  ];
  project.editor_settings.characters = [{ character_id: "gui-speaker", name: "验收角色", aliases: [] }];
  const input = path.join(qa, "官方GUI 玩家消费临时工程.vnproj");
  writeNew(input, project);
  const dev = artifact(path.join(root, "AgentVN Dev.exe"));
  // Prior exact executable is already recoverably saved by the previous block.
  // This QA-only block snapshots small relevant files and records the executable hash.
  const record = { status: "PASS", at: new Date().toISOString(), qa, checkpoint, input, inputSha256: sha(input),
    officialArchive: official, officialFiles: old.officialFiles, saved, dev,
    scope: "QA-only targeted recoverable copies; no product changes, no new build or model calls",
    previousDevCheckpoint: "F:/AgentVN/Checkpoints/Role-Geometry-Source-20261020-02" };
  writeNew(path.join(checkpoint, "manifest.json"), record);
  writeNew(path.join(out, "preparation.json"), record);
  console.log(JSON.stringify({ status: "PASS", input, checkpoint, qa }));
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const { useEditorStore } = await import("/src/store/editorStore.ts");
    const p = useProjectStore.getState(), g = useEditorStore.getState();
    return { id: p.projectId, settings: p.settings, assets: p.assetManifest, nodes: g.nodes, edges: g.edges };
  });
}
async function openLayout(page) {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await settleEditor(page);
  const b = page.locator('[data-layout-type-option="renpy"]:visible');
  if (await b.getAttribute("aria-pressed") !== "true") await b.click();
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]:visible').waitFor();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
  await settleEditor(page);
}
function checked(item, name, detail) { item.checks.push({ name, status: "PASS", ...(detail ? { detail } : {}) }); }
async function portable(page, item, p) {
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
  const before = await snapshot(page), pending = page.waitForEvent("download");
  await page.locator('[data-help-key="toolbar.saveProject"]').click();
  const download = await pending, file = path.join(item.output, "完整官方GUI.vnproj");
  await download.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file)), project = JSON.parse(await zip.file("project.json").async("string"));
  assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, before.settings.runtimeUILayoutProfiles);
  assert.equal(project.asset_manifest.length, 25);
  const proofs = [];
  for (const a of project.asset_manifest) {
    const sourcePath = a.metadata.tags.find(tag => tag.startsWith("renpy_gui_path:")).slice("renpy_gui_path:".length);
    const expected = p.officialFiles.find(f => prefix + f.relative === sourcePath); assert(expected);
    const actual = hash(await zip.file(a.metadata.project_path).async("nodebuffer"));
    assert.equal(actual, expected.sha256); proofs.push({ id: a.asset_id, sourcePath, sha256: actual });
  }
  await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
    .some(n => n instanceof HTMLInputElement && !n.disabled));
  await page.locator(".project-import-button input").first().setInputFiles(file);
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  const after = await snapshot(page);
  assert.deepEqual(after.settings.runtimeUILayoutProfiles, before.settings.runtimeUILayoutProfiles);
  assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.edges, before.edges);
  assert.deepEqual(after.assets.map(a => a.asset_id), before.assets.map(a => a.asset_id));
  item.portable = { ...artifact(file), assets: proofs, realReimport: true };
  checked(item, "portable-all-25-original-assets-both-profiles-and-real-reimport");
}
async function publish(page, item, p) {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
  await page.locator(".cartridge-export-panel").waitFor();
  await page.locator('[data-package-stage="settings"]').click();
  await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warning = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warning.isVisible()) await warning.click();
  const consent = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await consent.isVisible()) await consent.check();
  const button = page.locator('[data-help-key="package.export"]:visible');
  await button.scrollIntoViewIfNeeded(); await button.click({ trial: true });
  const pending = page.waitForEvent("download"); await button.click();
  const download = await pending, file = path.join(item.output, "完整官方GUI.vncart");
  await download.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const script = JSON.parse(await zip.file("script.json").async("string"));
  const state = await snapshot(page);
  assert.equal(layout.layout_type, "renpy");
  assert.equal(manifest.game_id, p.projectId || "official-gui-consumption-20261020-01");
  assert.equal(layout.renpy.shared.fontSize, 22); assert.equal(layout.renpy.shared.spacing, 4);
  assert.equal(layout.renpy.save_load.saveColumns, 3);
  assert(!zip.file("project.json")); assert(!layout.profiles && !layout.runtimeUILayoutProfiles);
  const expected = Object.keys(bindings).sort(), proofs = [];
  for (const a of manifest.assets) {
    const ref = state.assets.find(r => r.asset_id === a.asset_id); assert(ref);
    const sourcePath = ref.metadata.tags.find(t => t.startsWith("renpy_gui_path:")).slice("renpy_gui_path:".length);
    const original = p.officialFiles.find(f => prefix + f.relative === sourcePath); assert(original);
    const value = hash(await zip.file(a.path).async("nodebuffer")); assert.equal(value, original.sha256);
    proofs.push({ id: a.asset_id, relative: original.relative, sha256: value });
  }
  assert.deepEqual(proofs.map(a => a.relative).sort(), expected);
  assert(script.scenes.some(s => s.commands.some(c => c.type === "dialog" && c.text.includes("GUI_CONSUMPTION"))));
  item.cartridge = { ...artifact(file), assets: proofs, layoutSha256: hash(await zip.file("ui/layout.json").async("nodebuffer")),
    scriptSha256: hash(await zip.file("script.json").async("nodebuffer")), values: layout.renpy };
  checked(item, "UI-export-only-six-bound-dependencies-official-bytes-and-static-values");
}
async function editorRun(output, smoke) {
  const isolation = resolveAcceptancePaths(), p = prep(); assert.equal(path.resolve(isolation.input), path.resolve(p.input));
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), isolation, cases: [],
    modelRequests: 0, sources: sources(), testSha256: sha(__filename), officialArchive: p.officialArchive,
    scope: "SOURCE_EDITOR_REAL_ISOLATED_BACKEND_UI_IMPORT_SAVE_REOPEN_DOWNLOAD_NOT_NATIVE_INSTALLED" };
  let host, browser;
  try {
    assert.equal(sha(p.input), p.inputSha256); assert.equal(sha(p.officialArchive.path), p.officialArchive.sha256);
    host = await startEditorAcceptance(output);
    fs.copyFileSync(__filename, path.join(output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
    report.service = { backendPid: host.backendPid, frontendPid: host.server.pid,
      backendUrl: host.backendUrl, url: host.url, runId: host.server.runId };
    browser = await chromium.launch();
    for (const m of smoke ? matrices.slice(0, 1) : matrices) {
      const item = { ...m, status: "RUNNING", checks: [], errors: [], output: path.join(output, m.key) };
      report.cases.push(item); fs.mkdirSync(item.output);
      const context = await browser.newContext({ viewport: { width: m.width, height: m.height },
        deviceScaleFactor: m.dpr, reducedMotion: m.reduced ? "reduce" : "no-preference", acceptDownloads: true });
      const page = await context.newPage(); page.setDefaultTimeout(45000);
      page.on("pageerror", e => item.errors.push(String(e)));
      await page.route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
        if (route.request().method() !== "POST") return route.continue();
        report.modelRequests++; return route.abort();
      });
      try {
        await host.open(page); await settleEditor(page); await openLayout(page);
        const before = await snapshot(page), dialog = page.getByTestId("renpy-gui-import-dialog");
        await page.getByTestId("renpy-gui-import-open").click();
        await dialog.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles(p.officialArchive.path);
        await dialog.locator(".renpy-gui-import-summary").waitFor();
        assert.equal(await dialog.locator(".renpy-gui-import-asset-row").count(), 25);
        item.issues = await dialog.getByRole("list").innerText();
        assert(item.issues.includes("unsupported_context") && item.issues.includes("unsupported_script"));
        for (const input of await dialog.locator(".renpy-gui-import-row input[type=checkbox]").all()) await input.check();
        for (const [relative, label] of Object.entries(bindings)) await select(page, prefix + relative + " 游戏界面用途", label);
        await dialog.locator(".renpy-gui-import-license input").check();
        await dialog.getByRole("button", { name: "确认应用已选项目", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        await page.locator('[data-help-key="layout.save"]:visible').click();
        await page.waitForFunction(() => document.querySelector('[data-help-key="layout.save"]')?.getAttribute("data-save-state") === "saved");
        const actual = await snapshot(page);
        assert.equal(actual.assets.length, 25);
        assert.deepEqual(actual.settings.runtimeUILayoutProfiles.profiles.agentvn, before.settings.runtimeUILayoutProfiles.profiles.agentvn);
        assert.deepEqual(actual.nodes, before.nodes); assert.deepEqual(actual.edges, before.edges);
        await page.getByTestId("renpy-font-coverage-report").locator("strong", { hasText: "项目字符存在缺字" }).waitFor();
        item.fontCoverage = await page.getByTestId("renpy-font-coverage-report").innerText();
        assert(item.fontCoverage.includes("项目字符存在缺字") && item.fontCoverage.includes("回退到系统字体"));
        const backend = await (await fetch(`${host.backendUrl}/api/project/projects/${actual.id}`)).json();
        assert(backend.ok); assert.deepEqual(backend.data.editor_settings.runtimeUILayout, actual.settings.runtimeUILayout);
        checked(item, "full-official-scan-explicit-six-bindings-real-backend-and-visible-font-warning");
        await page.reload(); await page.locator('[data-help-key="home.recentProject"]').first().click();
        await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await openLayout(page);
        const reopened = await snapshot(page);
        assert.deepEqual(reopened.settings.runtimeUILayout, actual.settings.runtimeUILayout);
        assert.deepEqual(reopened.assets.map(a => a.asset_id), actual.assets.map(a => a.asset_id));
        checked(item, "real-reload-reopen-same-active-layout-and-all-resource-identities");
        await portable(page, item, p); await publish(page, item, p);
        item.screenshot = await captureSourceBrowser(page, path.join(item.output, "editor-export.png"),
          { width: m.width, height: m.height, dpr: m.dpr, reduced: m.reduced });
        checked(item, "actual-source-viewport-DPR-motion-PNG");
        assert.deepEqual(item.errors, []); assert.equal(item.checks.length, 5); item.status = "PASS";
      } catch (e) {
        item.status = "FAILED"; item.error = String(e.stack || e);
        await page.screenshot({ path: path.join(item.output, "failure.png"), scale: "device" }).catch(() => {});
      } finally {
        await context.close(); fs.writeFileSync(path.join(output, "progress.json"), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ phase: "editor", key: item.key, status: item.status, error: item.error }));
      }
      if (item.status !== "PASS") break; // preserve first failure; do not repeat it in every viewport.
    }
    assert.equal(report.cases.length, smoke ? 1 : 12); assert.equal(report.modelRequests, 0);
    assert(report.cases.every(c => c.status === "PASS")); unchanged(report.sources); report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    await browser?.close(); await host?.stop();
    report.cleanup = await cleanup(host ? [host.url, `${host.backendUrl}/api/health`] : []);
    if (report.cleanup.status !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); writeNew(path.join(output, "report.json"), report);
    console.log(JSON.stringify({ status: report.status, phase: "editor", cases: report.cases.length, output }));
  }
}
async function cleanup(urls) {
  const ports = [];
  for (const url of urls) {
    let responds = false;
    try { await fetch(url, { signal: AbortSignal.timeout(1000) }); responds = true; } catch {}
    ports.push({ url, responds });
  }
  return { status: ports.every(p => !p.responds) ? "PASS" : "FAILED", ports };
}
async function ready(page, screen) {
  await page.waitForFunction(screen => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.dataset.runtimePresentedScreen === screen && n.dataset.runtimeTransitionPhase === "idle"
      && !document.querySelector(".game-launch-blackout");
  }, screen); await settleRuntime(page);
}
async function displayedImage(locator, expected) {
  const value = await locator.evaluate(async n => {
    const css = getComputedStyle(n), url = css.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]
      || css.borderImageSource.match(/url\(["']?(.*?)["']?\)/)?.[1];
    if (!url) throw Error(`No rendered background/border image: ${css.backgroundImage}/${css.borderImageSource}`);
    const image = new Image(); image.src = url; await image.decode();
    const response = await fetch(url); if (!response.ok) throw Error(`Image HTTP ${response.status}`);
    return { width: image.naturalWidth, height: image.naturalHeight, bytes: [...new Uint8Array(await response.arrayBuffer())],
      rect: n.getBoundingClientRect().toJSON(), opacity: css.opacity, visibility: css.visibility, display: css.display,
      backgroundImage: css.backgroundImage, borderImageSource: css.borderImageSource };
  });
  const { bytes, ...detail } = value; detail.sha256 = hash(Buffer.from(bytes));
  if (expected) assert.equal(detail.sha256, expected.sha256);
  assert(detail.width > 0 && detail.height > 0);
  assert(detail.rect.width > 0 && detail.rect.height > 0 && detail.opacity !== "0" && detail.visibility === "visible" && detail.display !== "none");
  return detail;
}
async function geometry(locator) {
  return locator.evaluate(node => {
    const r = node.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(node);
    const text = [...range.getClientRects()].filter(b => b.width > 0 && b.height > 0).map(b => b.toJSON());
    const css = getComputedStyle(node);
    return { rect: r.toJSON(), text, fontSize: parseFloat(css.fontSize), fontFamily: css.fontFamily,
      gap: css.gap, color: css.color, disabled: node.disabled,
      hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
function assertGeometry(g, m, text = true) {
  const r = g.rect;
  assert(r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= m.width + 1 && r.bottom <= m.height + 1);
  assert(g.hit && g.overflow <= 1, JSON.stringify(g));
  if (text) for (const t of g.text) assert(t.left >= r.left - 1 && t.top >= r.top - 1 && t.right <= r.right + 1 && t.bottom <= r.bottom + 1,
    `Text Range outside control: ${JSON.stringify(g)}`);
}
async function platformFonts(page, selector) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("DOM.enable"); await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector }); assert(nodeId);
    return (await session.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
  } finally { await session.detach(); }
}
async function playerRun(output, smoke) {
  const p = prep(), inputReport = process.env.AGENTVN_GUI_EDITOR_REPORT; assert(inputReport);
  const exported = read(inputReport); assert.equal(exported.status, "PASS");
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), path.resolve(p.input));
  assert(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(__filename, path.join(output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], sources: sources(), modelRequests: 0,
    source: artifact(inputReport), testSha256: sha(__filename),
    scope: "SOURCE_RUNTIME_ACTUAL_WEB_FILE_IMPORT_LIBRARY_ENGINE_NOT_INSTALLED_WINDOWS_OR_ANDROID" };
  let server, browser;
  const expected = relative => { const f = p.officialFiles.find(f => f.relative === relative); assert(f); return f; };
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(output, "runtime-vite.log") });
    report.service = { url: server.url, pid: server.pid, runId: server.runId };
    browser = await chromium.launch();
    for (const m of smoke ? matrices.slice(0, 1) : matrices) {
      // One real UI-exported artifact can be consumed at multiple Runtime displays.
      // Record the exporting case rather than claiming twelve Editor UI imports.
      const source = exported.cases.find(c => c.key === m.key) || exported.cases[0];
      assert(source?.cartridge); assert.equal(sha(source.cartridge.path), source.cartridge.sha256);
      const item = { ...m, exportCase: source.key, artifact: source.cartridge, status: "RUNNING", checks: [], samples: {}, errors: [] };
      report.cases.push(item);
      const context = await browser.newContext({ viewport: { width: m.width, height: m.height },
        deviceScaleFactor: m.dpr, reducedMotion: m.reduced ? "reduce" : "no-preference" });
      const page = await context.newPage(); page.setDefaultTimeout(40000);
      page.on("pageerror", e => item.errors.push(String(e)));
      try {
        await server.run(async () => {
          await page.goto(`${server.url}/?mode=library`);
          await page.getByTestId("web-cartridge-file").setInputFiles(source.cartridge.path);
          await page.getByRole("button", { name: "启动卡带", exact: true }).click();
          await ready(page, "title_menu");
          item.samples.titleImage = await displayedImage(page.locator(".main-menu-title-hero-background:visible"), expected("gui/main_menu.png"));
          const start = page.getByTestId("start-new-game");
          await page.mouse.move(m.width - 10, 10);
          item.samples.titleNormal = await displayedImage(start, expected("gui/button/quick_idle_background.png"));
          const titleGeometry = await geometry(start); assertGeometry(titleGeometry, m);
          const titleScale = Number(await page.getByTestId("renpy-title-view").getAttribute("data-renpy-scale"));
          assert(Math.abs(titleGeometry.fontSize - 22 * titleScale) <= .1);
          const titleGap = await page.locator(".renpy-title-navigation").evaluate(n => parseFloat(getComputedStyle(n).gap));
          assert(Math.abs(titleGap - 4 * titleScale) <= .1);
          await start.focus();
          item.samples.titleFocus = await displayedImage(start, expected("gui/button/quick_hover_background.png"));
          await start.hover();
          item.samples.titleHover = await displayedImage(start, expected("gui/button/quick_hover_background.png"));
          item.samples.title = { ...titleGeometry, titleScale, titleGap };
          checked(item, "actual-title-official-image-normal-hover-focus-22-font-4-spacing-and-hit-geometry");
          await page.getByTestId("open-settings").click(); await ready(page, "settings");
          const nav = page.getByTestId("renpy-menu-help");
          await page.mouse.move(m.width - 10, 10);
          item.samples.menuNormal = await displayedImage(nav, expected("gui/button/quick_idle_background.png"));
          await nav.focus();
          item.samples.menuFocus = await displayedImage(nav, expected("gui/button/quick_hover_background.png"));
          assertGeometry(await geometry(nav), m);
          await page.keyboard.press("Enter"); await ready(page, "help");
          assert(await page.getByTestId("renpy-menu-title").textContent() === "帮助");
          await page.getByTestId("renpy-menu-save-load").click(); await ready(page, "save_load");
          const grid = page.getByTestId("save-slot-grid");
          item.samples.grid = await grid.evaluate(n => ({ columns: getComputedStyle(n).gridTemplateColumns,
            declared: n.dataset.renpySaveColumns, slots: [...n.children].map(c => c.getBoundingClientRect().toJSON()) }));
          assert.equal(item.samples.grid.declared, "3");
          assert.equal(item.samples.grid.columns.trim().split(/\s+/).length, 3);
          assert.equal(item.samples.grid.slots.length, 6);
          const slots = item.samples.grid.slots;
          assert(Math.abs(slots[0].top - slots[1].top) <= 1 && Math.abs(slots[0].top - slots[2].top) <= 1 && slots[3].top > slots[0].bottom - 1);
          await page.getByTestId("save-page-next").click(); await page.getByTestId("save-slot-manual-7").waitFor();
          await page.getByTestId("save-page-previous").click(); await page.getByTestId("save-slot-manual-1").waitFor();
          checked(item, "menu-image-keyboard-navigation-and-actual-three-column-six-slot-pagination");
          await page.getByTestId("renpy-menu-return").click(); await ready(page, "title_menu");
          await page.getByTestId("start-new-game").click(); await ready(page, "playing");
          const dialog = page.locator(".dialog-box:visible"); await dialog.waitFor();
          item.samples.dialogImage = await displayedImage(dialog, expected("gui/textbox.png"));
          // Complete typewriter through a real click, then wait for rendered text.
          await dialog.click();
          await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent.includes("中文字体回退"));
          await page.evaluate(() => document.fonts.ready);
          item.samples.fonts = await platformFonts(page, ".dialog-text");
          const custom = item.samples.fonts.find(f => f.isCustomFont && /DejaVu/i.test(f.familyName));
          const fallback = item.samples.fonts.find(f => !f.isCustomFont && f.glyphCount > 0);
          assert(custom?.glyphCount > 0, JSON.stringify(item.samples.fonts)); assert(fallback, "Chinese must actually use a system fallback");
          item.samples.fontCss = (await geometry(page.locator(".dialog-text"))).fontFamily;
          assert(item.samples.fontCss.includes("AgentVNFont_"));
          // Font URL byte proof, in addition to actual rendered Latin/CJK font selection.
          item.samples.fontBytes = await page.evaluate(async () => {
            const rules = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } });
            const rule = rules.find(r => r.cssText.includes("@font-face") && r.cssText.includes("AgentVNFont_"));
            if (!rule) throw Error("No actual imported @font-face");
            const url = rule.cssText.match(/url\(["']?(.*?)["']?\)/)?.[1]; if (!url) throw Error("No font URL");
            const response = await fetch(url);
            return { ok: response.ok, bytes: [...new Uint8Array(await response.arrayBuffer())] };
          });
          assert(item.samples.fontBytes.ok);
          const fontHash = hash(Buffer.from(item.samples.fontBytes.bytes));
          item.samples.fontBytes = { sha256: fontHash, bytes: item.samples.fontBytes.bytes.length };
          assert.equal(fontHash, expected("DejaVuSans.ttf").sha256);
          checked(item, "actual-textbox-font-bytes-Latin-custom-and-Chinese-system-fallback");
          item.screenshot = await captureSourceBrowser(page, path.join(output, `${m.key}-dialog.png`),
            { width: m.width, height: m.height, dpr: m.dpr, reduced: m.reduced });
          await page.getByTestId("renpy-quick-settings").click(); await ready(page, "settings");
          await page.getByTestId("settings-finish").click(); await ready(page, "playing");
          await page.locator(".dialog-box:visible").click();
          const choice = page.getByRole("button", { name: "选择：再次检查 GUI_REPEAT", exact: true });
          await choice.waitFor(); await choice.click({ trial: true }); await settleRuntime(page);
          item.samples.choiceImage = await displayedImage(choice);
          if (process.argv.includes("--diagnostic")) {
            item.diagnostic = await choice.evaluate(async n => {
              const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
              const current = useRuntimeStore.getState().currentGame, css = getComputedStyle(n);
              return { inline: n.getAttribute("style"), frameMode: n.dataset.uiFrameMode,
                frame: n.dataset.renpyButtonFrame, hovered: n.matches(":hover"), focused: n.matches(":focus-visible"),
                actual: css.backgroundImage, shared: css.getPropertyValue("--renpy-button-image-normal"),
                choiceVariable: css.getPropertyValue("--runtime-choice-option-background-image"),
                component: current.uiSkin.screens.find(s => s.screen_id === "player").components
                  .find(c => c.component_type === "choice_option") };
            });
            assert.equal(item.samples.choiceImage.sha256, expected("gui/button/quick_idle_background.png").sha256);
            const original = await choice.getAttribute("style");
            await choice.evaluate(n => n.style.setProperty("background-image", n.style.backgroundImage, "important"));
            item.diagnostic.singleInlinePriorityOverride = await displayedImage(choice, expected("gui/button/choice_idle_background.png"));
            await choice.evaluate((n, value) => n.setAttribute("style", value), original);
            item.diagnostic.reverted = await displayedImage(choice, expected("gui/button/quick_idle_background.png"));
            checked(item, "DIAGNOSTIC-reproduced-correct-inline-resource-overridden-by-CSS-and-reversible-priority-probe");
            return;
          }
          assert.equal(item.samples.choiceImage.sha256, expected("gui/button/choice_idle_background.png").sha256);
          assertGeometry(await geometry(choice), m);
          await choice.focus(); await page.keyboard.press("Enter");
          await page.waitForFunction(() => !document.querySelector(".choice-panel") && document.querySelector(".dialog-text")?.textContent.includes("GUI_CONSUMPTION"));
          checked(item, "official-choice-background-not-overridden-by-shared-state-and-real-loop-selection");
          assert.deepEqual(item.errors, []); assert.equal(item.checks.length, 4);
        });
        item.status = "PASS";
      } catch (e) {
        item.status = "FAILED"; item.error = String(e.stack || e);
        await page.screenshot({ path: path.join(output, `${m.key}-failure.png`), scale: "device" }).catch(() => {});
      } finally {
        await context.close(); fs.writeFileSync(path.join(output, "progress.json"), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ phase: "player", key: item.key, status: item.status, error: item.error }));
      }
      if (item.status !== "PASS") break;
    }
    assert.equal(report.cases.length, smoke ? 1 : 12); assert(report.cases.every(c => c.status === "PASS"));
    unchanged(report.sources); report.status = process.argv.includes("--diagnostic") ? "REPRODUCED" : "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    await browser?.close(); await server?.stop(); report.cleanup = await cleanup(server ? [server.url] : []);
    if (report.cleanup.status !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); writeNew(path.join(output, "report.json"), report);
    console.log(JSON.stringify({ status: report.status, phase: "player", cases: report.cases.length, output }));
  }
}
(async () => {
  const mode = process.argv[2], smoke = process.argv.includes("--smoke");
  if (mode === "prepare") return prepare();
  const output = process.env.AGENTVN_WORKSPACE_OUTPUT;
  assert(output && path.resolve(output).startsWith(path.resolve(qa) + path.sep));
  assert(!fs.existsSync(output), "Never overwrite historical tests");
  if (mode === "editor") return editorRun(output, smoke);
  if (mode === "player") return playerRun(output, smoke);
  throw Error("Use prepare|editor|player");
})().catch(e => { console.error(e); process.exitCode = 1; });
