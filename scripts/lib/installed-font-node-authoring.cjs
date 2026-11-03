"use strict";
// Actual installed controls and real Runtime documents. No frontend/store
// imports, no generated model calls, no persistence or preview protocol mocks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("../../editor/node_modules/jszip");
const A = require("./installed-acceptance.cjs");
const { desktopViewports } = require("./current-acceptance-viewports.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./installed-webview-capture.cjs");

async function runFontNodeAuthoring(C) {
  const { root, out, report, stage, snapshot, layout, options, saveLayout } = C;
  const page = () => C.context().page;
  const coverage = () => page().getByTestId("renpy-font-coverage-report");
  const selectorName = "Ren'Py（进阶）全局界面字体";
  const diagnosticNodeOnly = process.env.AGENTVN_FONT_NODE_DIAGNOSTIC === "1";
  if (diagnosticNodeOnly) report.diagnosticOnly = "Node display investigation; never a complete acceptance PASS";
  report.fontMatrix = []; report.nodeMatrix = [];
  report.fontInputs = []; report.fontResponses = [];
  let latinAsset, originalAgent, expectedSettings, fontBytes;
  const latinPath = path.join(root, "GameCli_framework/node_modules/harfbuzzjs/test/fonts/noto/NotoSans-Regular.ttf");
  const woffPath = path.join(root, "GameCli_framework/node_modules/fontverter/testdata/Roboto-400.woff2");
  const fontFiles = path.join(out, "中文 字体输入"); fs.mkdirSync(fontFiles);
  for (const file of [latinPath, woffPath]) fs.copyFileSync(file, path.join(fontFiles, path.basename(file)), fs.constants.COPYFILE_EXCL);
  const invalidPath = path.join(fontFiles, "InvalidFont.ttf");
  fs.writeFileSync(invalidPath, Buffer.from("not a valid font file"), { flag: "wx" });
  async function enterLayout() {
    await options();
    if (await layout().getAttribute("data-layout-type") !== "renpy")
      await layout().locator('[data-layout-type-option="renpy"]').click();
    await page().locator('.renpy-title-editor[data-editor-page="title"]').waitFor();
    await A.settleEditor(page());
  }
  async function status(value) {
    await page().waitForFunction(expected =>
      document.querySelector('[data-testid="renpy-font-coverage-report"]')?.dataset.fontCoverage === expected, value);
    return coverage().innerText();
  }
  async function chooseFont(name) {
    const fields = layout().locator(".renpy-shared-typography");
    if (!await fields.evaluate(node => node.open)) await fields.locator("summary").click();
    await A.select(page(), selectorName, name);
  }
  async function importFont(filename) {
    await options("library");
    const file = path.join(fontFiles, filename);
    const chosen = page().waitForEvent("filechooser");
    await page().getByRole("button", { name: /导入字体/ }).click();
    await (await chosen).setFiles(file);
    await page().getByRole("button", { name: "保存到素材库", exact: true }).click();
    await page().getByText(new RegExp(`已将 ${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} 保存到`)).waitFor();
    report.fontInputs.push({ file, sha256: A.sha256(fs.readFileSync(file)),
      interaction: "Actual installed HTML file chooser via Playwright; not OS dialog input" });
    await enterLayout();
  }
  async function fontState(target, selector, expectedFamily) {
    const element = target.locator(selector); await element.waitFor();
    await target.evaluate(async () => { await document.fonts.ready; });
    const value = await element.evaluate(node => ({
      font: getComputedStyle(node).fontFamily, rect: node.getBoundingClientRect().toJSON(),
      text: node.innerText, overflow: document.documentElement.scrollWidth - innerWidth,
      faces: [...document.fonts].map(face => ({ family: face.family, status: face.status })),
    }));
    assert(value.font.includes(expectedFamily) && /serif|sans-serif/.test(value.font),
      `Custom and system fallback stack required: ${JSON.stringify(value)}`);
    assert(value.faces.some(face => face.family === expectedFamily && face.status === "loaded"),
      `Actual font must load, not merely appear in CSS: ${JSON.stringify(value)}`);
    assert(value.rect.width > 0 && value.rect.height > 0 && value.overflow <= 1);
    return value;
  }
  const fontFamily = () => `AgentVNFont_${latinAsset.asset_id.replace(/[^a-z0-9_-]/gi, "_")}`;
  const profileSet = value => value.settings.runtimeUILayoutProfiles;

  if (!diagnosticNodeOnly) {
  await stage("installed-font-library-system-TTF-WOFF2-invalid-and-fallback-report", async () => {
    page().on("response", response => {
      if (response.url().includes("/api/project/assets/")) report.fontResponses.push({
        status: response.status(), url: response.url(),
      });
    });
    await enterLayout();
    assert.match(await status("system"), /未指定自定义字体.*系统字体/);
    await saveLayout(); originalAgent = structuredClone(profileSet(await snapshot()).profiles.agentvn);
    await importFont("NotoSans-Regular.ttf");
    await chooseFont("NotoSans-Regular");
    const text = await status("incomplete");
    assert.match(text, /缺少 \d+ 个：/); assert.match(text, /隔.*离/);
    assert.match(text, /回退到系统字体/);
    const before = await snapshot();
    latinAsset = before.assetManifest.find(asset => asset.asset_type === "font" && asset.metadata.filename === "NotoSans-Regular.ttf");
    assert(latinAsset, "Imported font must belong to the actual project");
    fontBytes = await A.assetBytes(C.context().state.backendPort, latinAsset);
    assert.deepEqual(fontBytes, fs.readFileSync(latinPath));
    await fontState(page(), '[data-testid="renpy-title-view"]', fontFamily());
    await importFont("Roboto-400.woff2"); await chooseFont("Roboto-400");
    const woff = await status("incomplete"); assert.match(woff, /回退到系统字体/);
    await importFont("InvalidFont.ttf"); await chooseFont("InvalidFont");
    const invalid = await status("error");
    assert.match(invalid, /无法确认字体覆盖/); assert.match(invalid, /系统字体栈回退/);
    await chooseFont("NotoSans-Regular"); await status("incomplete"); await saveLayout();
    assert.deepEqual(profileSet(await snapshot()).profiles.agentvn, originalAgent);
    return { latin: text, woff, invalid, fontAsset: latinAsset.asset_id, fontSha256: A.sha256(fontBytes) };
  });

  await stage("installed-font-report-and-real-layout-runtime-preview-matrix", async () => {
    await page().getByTestId("renpy-title-runtime-preview-toggle").click();
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await C.metrics(page(), C.context().cdp, width, height, dpr, reduced);
      await A.settleEditor(page()); await status("incomplete");
      const target = await C.preview();
      const actual = await fontState(target, ".renpy-title-view", fontFamily());
      const bounds = await coverage().evaluate(node => {
        const r = node.getBoundingClientRect(); return { rect: r.toJSON(),
          overflow: node.scrollWidth - node.clientWidth, vw: innerWidth, vh: innerHeight };
      });
      assert(bounds.rect.left >= -1 && bounds.rect.right <= bounds.vw + 1
        && bounds.rect.top >= -1 && bounds.rect.bottom <= bounds.vh + 1 && bounds.overflow <= 1,
      `Font coverage report clipped: ${JSON.stringify(bounds)}`);
      const control = await C.clickable(page().getByRole("combobox", { name: selectorName, exact: true }));
      const row = { width, height, dpr, reduced, actual, bounds, control };
      row.capture = await captureInstalledWebview(page(), C.context().cdp,
        path.join(out, `font-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`), row);
      report.fontMatrix.push(row); C.save();
      console.log(`PASS installed font author ${width} DPR${dpr} reduced=${reduced}`);
    }
    await page().getByTestId("renpy-title-static-preview-toggle").click();
    await page().locator(".renpy-editor-runtime-viewport iframe").waitFor({ state: "detached" });
    assert(report.fontResponses.length > 0 && report.fontResponses.every(response => response.status === 200),
      `Font asset responses: ${JSON.stringify(report.fontResponses)}`);
  });
  } else {
    await enterLayout(); await saveLayout();
    await importFont("NotoSans-Regular.ttf"); await chooseFont("NotoSans-Regular");
    await status("incomplete"); await saveLayout();
  }

  await stage("installed-existing-node-iframe-priority-and-live-default-update-matrix", async () => {
    await C.metrics(page(), C.context().cdp, 1920, 1080, 1, false);
    await page().locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page());
    await page().locator('.react-flow__node[data-id="scene"]').click();
    const card = page().locator(".command-card").filter({ hasText: "对白呈现创作验收" }).first();
    await card.locator(".command-card-summary").click();
    if (await page().locator(".preview-rail-button").isVisible()) await page().locator(".preview-rail-button").click();
    await page().locator(".embedded-runtime-preview-status.is-ready").waitFor({ timeout: 45000 });
    const frameElement = page().locator('iframe[title="GameCLI 内嵌预览"]');
    let originalFrame = await frameElement.elementHandle();
    const frame = page().frameLocator('iframe[title="GameCLI 内嵌预览"]');
    report.nodeWorkspaceHandoffs = [];
    async function backToEditing() {
      await page().locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page());
      await page().locator(".embedded-runtime-preview-status.is-ready").waitFor({ timeout: 45000 });
      assert.equal(await frameElement.count(), 1, "Workspace return must restore exactly one node preview");
      const same = await frameElement.evaluate((node, original) => node === original, originalFrame);
      const connected = await originalFrame.evaluate(node => node.isConnected);
      report.nodeWorkspaceHandoffs.push({ sameIframe: same, previousConnected: connected,
        scope: "Options intentionally collapses/unmounts the node frame; returning to edit restores it" });
      assert(same || !connected, "An old frame must not remain live alongside its replacement");
      await originalFrame.dispose();
      originalFrame = await frameElement.elementHandle();
    }
    async function mode(expected) {
      const selector = expected === "nvl" ? ".dialog-box.is-nvl-presentation"
        : expected === "bubble" ? ".dialog-box.is-bubble-presentation"
          : ".dialog-box:not(.is-nvl-presentation):not(.is-bubble-presentation)";
      await frame.locator(selector).waitFor();
      await frame.locator(".game-launch-blackout").waitFor({ state: "detached" });
      await frame.locator('.story-player[data-is-typing="false"]').waitFor();
      const value = await frame.locator(selector).evaluate(node => {
        const stage = node.closest(".story-player"), r = node.getBoundingClientRect();
        return { rect: r.toJSON(), stage: stage.getBoundingClientRect().toJSON(), text: node.textContent,
          label: node.getAttribute("aria-label"), scene: stage.dataset.currentSceneId,
          pages: node.dataset.dialogPages, page: node.dataset.dialogPage, pageDone: node.dataset.dialogPageDone,
          fontMode: node.dataset.dialogFontMode, fontScale: node.dataset.dialogFontScale,
          textBoxes: [...node.querySelectorAll(".dialog-text,.nvl-page-text")].map(n => ({
            text: n.textContent, rect: n.getBoundingClientRect().toJSON(),
            clientWidth: n.clientWidth, clientHeight: n.clientHeight, scrollWidth: n.scrollWidth, scrollHeight: n.scrollHeight,
            font: getComputedStyle(n).fontSize, lineHeight: getComputedStyle(n).lineHeight,
          })),
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      report.lastNodeMeasurement = { mode: expected, ...value }; C.save();
      assert.equal(value.scene, "dialog_presentation_acceptance");
      if (expected === "nvl") {
        assert.equal(value.label, "NVL 剧情与分支");
        assert.match(await frame.locator(".nvl-advance-surface").getAttribute("aria-label"), /对白呈现创作验收/);
      } else assert.match(value.label, /对白呈现创作验收/);
      assert.match(value.text, /对白呈现创作验收/);
      const r = value.rect, s = value.stage;
      assert(r.width > 0 && r.height > 0 && r.left >= s.left - 1 && r.right <= s.right + 1
        && r.top >= s.top - 1 && r.bottom <= s.bottom + 1 && value.overflow <= 1,
      `Node preview escaped actual stage: ${JSON.stringify(value)}`);
      if (expected === "bubble") {
        assert.equal(Number(value.pages), 1, "The short node-preview line must fit on one page");
        assert.equal(value.textBoxes.length, 1);
        const body = value.textBoxes[0];
        assert.equal(body.text, "对白呈现创作验收，隔离中文字体缺字验证。",
          "Accessible labels alone do not prove that the full short line is rendered");
        assert(body.clientHeight + 1 >= parseFloat(body.lineHeight)
          && body.scrollHeight <= body.clientHeight + 1
          && body.scrollWidth <= body.clientWidth + 1,
        `Installed node-preview text is physically clipped: ${JSON.stringify(body)}`);
      }
      assert.equal(await frameElement.count(), 1);
      assert(await frameElement.evaluate((node, original) => node === original, originalFrame),
        "Within uninterrupted editing, mode/default changes must update the existing node iframe");
      return value;
    }
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await C.metrics(page(), C.context().cdp, width, height, dpr, reduced);
      await A.select(page(), "对白呈现方式", "普通对白框"); await mode("dialog");
      await A.select(page(), "角色默认呈现方式", "继承工程默认");
      await options("settings"); await A.select(page(), "工程默认呈现方式", "普通对白框");
      await backToEditing();
      await A.select(page(), "对白呈现方式", "继承角色 / 工程默认"); await mode("dialog");
      await A.select(page(), "角色默认呈现方式", "气泡对白"); const bubble = await mode("bubble");
      await A.select(page(), "角色默认呈现方式", "NVL 累积阅读"); const nvl = await mode("nvl");
      await A.select(page(), "角色默认呈现方式", "继承工程默认"); await mode("dialog");
      await options("settings"); await A.select(page(), "工程默认呈现方式", "气泡对白");
      await backToEditing();
      const inherited = await mode("bubble");
      await A.select(page(), "对白呈现方式", "普通对白框"); await mode("dialog");
      await A.select(page(), "对白呈现方式", "继承角色 / 工程默认"); await mode("bubble");
      await C.clickable(page().getByRole("combobox", { name: "对白呈现方式", exact: true }));
      const row = { width, height, dpr, reduced, bubble, nvl, inherited,
        sameIframeWithinEditing: true, workspaceRestore: "Single frame, same selected scene and authored content" };
      row.capture = await captureInstalledWebview(page(), C.context().cdp,
        path.join(out, `node-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`), row);
      report.nodeMatrix.push(row); C.save();
      console.log(`PASS installed node inheritance ${width} DPR${dpr} reduced=${reduced}`);
    }
    await originalFrame.dispose();
  });

  await stage("installed-font-and-mode-native-save-restart-reopen-byte-roundtrip", async () => {
    await C.metrics(page(), C.context().cdp, 1920, 1080, 1, false);
    expectedSettings = structuredClone((await snapshot()).settings);
    await options("settings");
    const directory = path.join(out, "中文 字体工程"); fs.mkdirSync(directory);
    await C.native(page().locator('[data-help-key="settings.projectExportDirectory.choose"]:visible'),
      "font-save-directory", directory, false);
    await page().waitForFunction(value =>
      document.querySelector('[data-help-key="settings.projectExportDirectory.current"]')?.textContent.trim() === value, directory);
    await page().locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page());
    await page().getByRole("button", { name: "保存工程", exact: true }).click();
    await page().getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
    const files = fs.readdirSync(directory).filter(f => f.endsWith(".vnproj")); assert.equal(files.length, 1);
    const file = path.join(directory, files[0]), bytes = fs.readFileSync(file);
    const archive = await JSZip.loadAsync(bytes), data = JSON.parse(await archive.file("project.json").async("string"));
    assert.deepEqual(data.editor_settings.runtimeUILayoutProfiles, expectedSettings.runtimeUILayoutProfiles);
    assert.equal(data.editor_settings.defaultDialogPresentation, "bubble");
    assert.equal(data.nodes.find(node => node.id === "scene").data.scene.commands[0].presentation_mode, undefined);
    const portableFont = data.asset_manifest.find(asset => asset.asset_id === latinAsset.asset_id);
    assert(portableFont, "Portable project must retain selected font reference");
    const portablePath = portableFont.metadata.project_path;
    assert(archive.file(portablePath), `Missing portable font bytes at ${portablePath}`);
    assert.deepEqual(await archive.file(portablePath).async("nodebuffer"), fontBytes);
    report.projectArtifact = { path: file, sha256: A.sha256(bytes), generatedAt: fs.statSync(file).mtime.toISOString() };
    await C.restart();
    await page().getByRole("button", { name: "导入项目", exact: true }).waitFor();
    await C.native(page().getByRole("button", { name: "导入项目", exact: true }), "font-reopen", file, true);
    await page().locator(".editor-toolbar").waitFor(); await A.settleEditor(page());
    const restored = await snapshot();
    assert.deepEqual(restored.settings.runtimeUILayoutProfiles, expectedSettings.runtimeUILayoutProfiles);
    assert.equal(restored.settings.defaultDialogPresentation, "bubble");
    assert.deepEqual(await A.assetBytes(C.context().state.backendPort,
      restored.assetManifest.find(asset => asset.asset_id === latinAsset.asset_id)), fontBytes);
    await enterLayout(); await status("incomplete");
    await fontState(page(), '[data-testid="renpy-title-view"]', fontFamily());
    return { projectArtifact: report.projectArtifact, fontSha256: A.sha256(fontBytes) };
  });

  await stage("installed-font-export-byte-identity-and-player-fallback-matrix", async () => {
    await page().locator('[data-workspace-surface="publish"]:visible').click();
    const publishing = page().locator(".cartridge-export-panel"); await publishing.waitFor();
    await page().waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
    await A.dismissEnvironmentCompletion(page());
    await publishing.locator('[data-help-key="package.mode"]').click();
    await page().getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    await publishing.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
    const warning = publishing.getByRole("checkbox", { name: /我已检查全部警告/ });
    if (await warning.count()) await warning.check();
    report.cartridgeArtifact = await A.realDownload(page(), C.context().cdp, out, publishing.locator(".package-primary-action"));
    const archive = await JSZip.loadAsync(fs.readFileSync(report.cartridgeArtifact.path));
    const layoutBytes = await archive.file("ui/layout.json").async("nodebuffer");
    const exported = JSON.parse(layoutBytes), manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    assert.equal(exported.tokens.fontAssetId, latinAsset.asset_id);
    const font = manifest.assets.find(asset => asset.asset_id === latinAsset.asset_id); assert(font);
    assert.deepEqual(await archive.file(font.path).async("nodebuffer"), fontBytes);
    report.layoutSha256 = A.sha256(layoutBytes); report.exportedFont = { ...font, sha256: A.sha256(fontBytes) };
    const player = await C.openInstalledPlayer(report.cartridgeArtifact.path), target = player.page;
    await target.getByTestId("game-state-title").waitFor(); await A.settleRuntime(target);
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await C.metrics(target, player.cdp, width, height, dpr, reduced); await A.settleRuntime(target);
      const actual = await fontState(target, ".renpy-title-view", fontFamily());
      const start = target.getByTestId("start-new-game"); await C.clickable(start);
      const row = { width, height, dpr, reduced, actual };
      row.capture = await captureInstalledWebview(target, player.cdp,
        path.join(out, `font-player-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`), row);
      report.playerMatrix.push(row); C.save();
    }
    return { cartridgeArtifact: report.cartridgeArtifact, fontSha256: A.sha256(fontBytes),
      scope: "Loaded custom font and explicit system fallback stack; missing glyph report verified in installed author; not universal device glyph availability" };
  });
}

module.exports = { runFontNodeAuthoring };
