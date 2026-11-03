"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { currentAcceptanceViewports } = require("./lib/current-acceptance-viewports.cjs");
const { readZipEntrySync } = require("./project-container.cjs");
const root = path.resolve(__dirname, "..");
const paths = resolveAcceptancePaths();
const fast = process.argv.includes("--fast");
const mode = process.argv.includes("--runtime") ? "runtime" : "editor";
const viewports = currentAcceptanceViewports(fast ? [[1920, 1080]] : undefined);
const loaded = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(loaded, loaded.exports);
const report = { runId: new Date().toISOString(), status: "RUNNING", mode,
  scope: "E4 category role page ownership, inheritance and actual Runtime binding; not installed acceptance",
  isolation: paths, browserMode: "headless-real-chromium", cases: [] };
const save = () => fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2));
function role(width, color) {
  return { geometry: { width, height: 40, fontSize: 18, paddingX: 6, paddingY: 3 },
    states: { normal: { textColor: color, backgroundColor: "#102030" },
      hover: { textColor: "#ddeeff", backgroundColor: "#203040" },
      selected: { textColor: "#ffee88", backgroundColor: "#304050" } } };
}
function skinFixture() {
  const skin = loaded.exports.createRenpyUILayout();
  skin.renpy ??= {};
  skin.renpy.shared = { buttonRoles: { category_pagination: role(136, "#81bbcc") } };
  skin.renpy.save_load = { buttonRoles: { category_pagination: role(100, "#cc99aa") } };
  return skin;
}
async function idle(pageOrFrame, screen) {
  await pageOrFrame.locator(`[data-runtime-presented-screen="${screen}"][data-runtime-transition-phase="idle"]`).waitFor();
}
async function settleControl(control) {
  await control.evaluate(async node => {
    await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
}
async function readControl(control) {
  await settleControl(control);
  return control.evaluate(node => {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    return { color: style.color, background: style.backgroundColor,
      width: rect.width, height: rect.height, x: rect.x, y: rect.y,
      custom: node.getAttribute("data-renpy-role-custom"), font: parseFloat(style.fontSize) };
  });
}
async function geometry(frame) {
  const data = await frame.locator(".settings-tabs").evaluate(nav => {
    const frame = nav.closest(".runtime-layout-frame").getBoundingClientRect();
    const buttons = [...nav.querySelectorAll("button")].map(node => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const clips = [];
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (["hidden", "clip", "scroll", "auto"].includes(style.overflowX))
          clips.push({ axis: "x", bounds: bounds.toJSON() });
        if (["hidden", "clip", "scroll", "auto"].includes(style.overflowY))
          clips.push({ axis: "y", bounds: bounds.toJSON() });
      }
      return { label: node.textContent.trim(), rect: rect.toJSON(), clips,
        hit: hit === node || node.contains(hit),
        clipped: node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1 };
    });
    return { frame: frame.toJSON(), buttons, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert.equal(data.buttons.length, 5);
  assert(data.overflow <= 1, "Runtime横向溢出");
  for (let i = 0; i < data.buttons.length; i++) {
    const { label, rect, hit, clipped, clips } = data.buttons[i];
    assert(hit && !clipped, `分类不可点击或文字裁切: ${label}`);
    assert(rect.left >= data.frame.left - 1 && rect.top >= data.frame.top - 1
      && rect.right <= data.frame.right + 1 && rect.bottom <= data.frame.bottom + 1, `分类越界: ${label}`);
    for (const { axis, bounds } of clips) assert(axis === "x"
      ? rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
      : rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1, `父容器裁切分类: ${label}`);
    if (i) assert(rect.top >= data.buttons[i - 1].rect.bottom - 1, "分类互相重叠");
  }
  return data;
}
async function choose(page, name, option) {
  const control = page.getByRole("combobox", { name, exact: true });
  await control.click();
  // RichSelect renders its interactive options in a document-level portal.
  await control.page().getByRole("option", { name: option, exact: true }).click();
}
async function savedGUI(page, backendUrl) {
  const response = await page.request.get(`${backendUrl}/api/project/state`);
  assert(response.ok());
  return (await response.json()).data.project_metadata.settings;
}
const activeDesignerSelector = '.runtime-layout-designer:not(.toolbar-popover-morph-ghost *):not([inert] *):not([aria-hidden="true"] *)';
async function activeDesigner(page, entry, phase) {
  const designer = page.locator(activeDesignerSelector);
  await designer.waitFor({ state: "visible" });
  assert.equal(await designer.count(), 1, "布局页必须只有一个可交互所有者");
  const ownership = await page.locator(".runtime-layout-designer").evaluateAll(nodes =>
    nodes.map(node => ({
      type: node.getAttribute("data-layout-type"),
      ghost: Boolean(node.closest(".toolbar-popover-morph-ghost")),
      inert: Boolean(node.closest("[inert]")),
      hidden: Boolean(node.closest('[aria-hidden="true"]')),
    })));
  assert.equal(ownership.filter(node => !node.inert && !node.hidden && !node.ghost).length, 1);
  for (const node of ownership.filter(node => node.ghost || node.inert || node.hidden))
    assert(node.inert && node.hidden, "离场/预热布局必须同时退出点击和辅助技术路径");
  (entry.ownership ??= []).push({ phase, nodes: ownership });
  return designer;
}
async function editorCase(env, browser, viewport, dpr, reduced) {
  const id = `${viewport[0]}-dpr${dpr}-reduced${reduced}`;
  const entry = { id, viewport, dpr, reduced, status: "RUNNING" };
  const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] },
    deviceScaleFactor: dpr, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.setDefaultTimeout(30000);
  try {
    await env.server.assertAlive();
    await page.goto(env.url);
    await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
      .some(node => node instanceof HTMLInputElement && !node.disabled));
    await page.locator(".project-import-button input").first().setInputFiles(env.derivedInput);
    await page.locator(".editor-toolbar").waitFor();
    await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
    let designer = await activeDesigner(page, entry, "initial");
    await designer.getByRole("group", { name: "布局类型", exact: true })
      .getByRole("button", { name: "Ren'Py（进阶）", exact: true }).click();
    await designer.locator('.renpy-editor-page-list button').filter({ hasText: /^选项$/ }).click();
    await page.locator(`${activeDesignerSelector}[data-renpy-editor="preferences"]`).waitFor();
    await choose(designer, "按钮角色", "分类 / 分页");
    await choose(designer, "按钮样式范围", "当前页面覆盖");
    await choose(designer, "按钮状态", "普通");
    await designer.getByLabel("按钮宽度", { exact: true }).fill("184");
    await designer.getByLabel("按钮高度", { exact: true }).fill("48");
    await designer.getByLabel("按钮字号", { exact: true }).fill("24");
    await designer.getByLabel("按钮文字色", { exact: true }).fill("#71bbcc");
    await designer.getByRole("button", { name: "保存布局", exact: true }).click();
    await designer.getByText("布局已保存", { exact: true }).waitFor();
    const settings = await savedGUI(page, env.backendUrl);
    const skin = settings.runtimeUILayoutProfiles.profiles.renpy;
    entry.savedGUI = skin.renpy;
    // This is the actual UI write, not a direct store mutation.
    assert.equal(skin.renpy.preferences?.buttonRoles?.category_pagination?.geometry?.width, 184,
      "编辑设置页的当前页面分类覆盖必须写入preferences");
    assert.deepEqual(skin.renpy.save_load, skinFixture().renpy.save_load,
      "设置页分类修改不能串写到存读档");
    assert.deepEqual(settings.runtimeUILayoutProfiles.profiles.agentvn, loaded.exports.getDefaultUISkinLayout(),
      "Ren'Py角色编辑不得改变AgentVN布局");
    const runtime = designer.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
    await idle(runtime, "settings");
    const display = runtime.locator(".settings-tabs").getByRole("button", { name: "显示", exact: true });
    const text = runtime.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true });
    entry.geometry = await geometry(runtime);
    entry.runtime = await readControl(text);
    const previewScale = await runtime.locator("[data-renpy-menu-frame]")
      .evaluate(node => Number(node.dataset.renpyMenuScale));
    assert.equal(entry.runtime.custom, "true", "真实预览未绑定设置页分类角色");
    assert.equal(entry.runtime.color, "rgb(113, 187, 204)", "设置页局部文字色未应用");
    assert(Math.abs(entry.runtime.font - 24 * previewScale) < .1, "设置页局部字号必须反映在真实Runtime预览");
    await text.click();
    await runtime.locator("[data-settings-tab-current] .settings-section-title").filter({ hasText: /^文字$/ }).waitFor();
    await display.click();
    await choose(designer, "按钮样式范围", "共享样式");
    assert.equal(await designer.getByLabel("按钮宽度", { exact: true }).inputValue(), "136",
      "编辑共享范围必须显示共享值，不能显示当前页覆盖");
    await choose(designer, "按钮样式范围", "当前页面覆盖");
    assert.equal(await designer.getByLabel("按钮宽度", { exact: true }).inputValue(), "184");
    assert.equal(await designer.getByLabel("按钮字号", { exact: true }).inputValue(), "24");
    // Native project bytes keep the GUI and export only the active layout.
    const portable = await page.evaluate(async () => {
      const { useProjectStore } = await import("/src/store/projectStore.ts");
      const { useEditorStore } = await import("/src/store/editorStore.ts");
      const { buildProjectBundle, readProjectJsonFromBundle } = await import("/src/utils/projectBundle.ts");
      const { exportEditorCartridge } = await import("/src/cartridge/exportCartridge.ts");
      const { exportScript } = await import("/src/utils/exportScript.ts");
      const p = useProjectStore.getState(), e = useEditorStore.getState();
      const project = e.exportProject({ title: p.title, author: p.author,
        projectId: p.projectId, editorSettings: p.settings, assetManifest: p.assetManifest });
      const blob = await buildProjectBundle(project);
      const reopened = await readProjectJsonFromBundle(new File([blob], "分类样式.vnproj"));
      const packed = await exportEditorCartridge({
        script: exportScript(reopened.nodes, reopened.edges),
        gameId: "category-role-roundtrip", title: "分类样式", author: "QA",
        version: "1.0.0", language: "zh-CN", description: "", includeGallery: false,
        includeMetadata: false, projectAssetRefs: [], projectAssets: [],
        uiLayoutProfiles: reopened.editor_settings.runtimeUILayoutProfiles,
        uiSkin: reopened.editor_settings.runtimeUILayout,
      });
      return { project: Array.from(new Uint8Array(await blob.arrayBuffer())),
        cartridge: Array.from(new Uint8Array(await packed.blob.arrayBuffer())),
        settings: reopened.editor_settings, errors: packed.errors };
    });
    assert.deepEqual(portable.errors, []);
    assert.deepEqual(portable.settings.runtimeUILayoutProfiles, settings.runtimeUILayoutProfiles);
    const reopenPath = path.join(paths.output, `${id}-roundtrip.vnproj`);
    fs.writeFileSync(reopenPath, Buffer.from(portable.project), { flag: "wx" });
    const cartridgePath = path.join(paths.output, `${id}-active.vncart`);
    fs.writeFileSync(cartridgePath, Buffer.from(portable.cartridge), { flag: "wx" });
    const exportedLayout = JSON.parse(readZipEntrySync(cartridgePath, "ui/layout.json").toString("utf8"));
    assert.equal(exportedLayout.layout_type, "renpy", "卡带必须使用当前活动布局");
    assert.deepEqual(exportedLayout.renpy, skin.renpy, "包内实际layout.json必须保留各页角色");
    entry.exportedLayout = exportedLayout.renpy;
    // Reopen the actual bundle via the user-facing import control.
    await page.locator('.editor-toolbar input[type="file"][accept=".vnproj,.json"]').setInputFiles(reopenPath);
    await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
    designer = await activeDesigner(page, entry, "reopened");
    await page.locator(`${activeDesignerSelector}[data-layout-type="renpy"]`).waitFor();
    await designer.locator('.renpy-editor-page-list button').filter({ hasText: /^选项$/ }).click();
    await choose(designer, "按钮角色", "分类 / 分页");
    await choose(designer, "按钮样式范围", "当前页面覆盖");
    assert.equal(await designer.getByLabel("按钮宽度", { exact: true }).inputValue(), "184");
    await designer.locator('.renpy-editor-page-list button').filter({ hasText: /^存档\/读档$/ }).click();
    assert.equal(await designer.getByLabel("按钮宽度", { exact: true }).inputValue(), "100",
      "切到存读档必须恢复其独立的分类角色，不得显示设置页值");
    await designer.locator('.renpy-editor-page-list button').filter({ hasText: /^选项$/ }).click();
    assert.equal(await designer.getByLabel("按钮宽度", { exact: true }).inputValue(), "184");
    await designer.getByRole("button", { name: "恢复此角色共享继承", exact: true }).click();
    assert.equal(await designer.getByTestId("renpy-title-button-role-source").innerText(), "继承共享");
    assert.equal(await designer.getByLabel("按钮宽度", { exact: true }).inputValue(), "136");
    assert.equal(await designer.getByLabel("按钮字号", { exact: true }).inputValue(), "18");
    await designer.getByRole("button", { name: "保存布局", exact: true }).click();
    await designer.getByText("布局已保存", { exact: true }).waitFor();
    const restored = await savedGUI(page, env.backendUrl);
    assert.equal(restored.runtimeUILayoutProfiles.profiles.renpy.renpy.preferences?.buttonRoles?.category_pagination, undefined);
    assert.deepEqual(restored.runtimeUILayoutProfiles.profiles.renpy.renpy.save_load, skinFixture().renpy.save_load);
    await idle(runtime, "settings");
    await page.waitForFunction(selector => {
      const doc = document.querySelector(selector)?.querySelector('iframe[title="Ren\'Py（进阶）实际页面预览"]')?.contentDocument;
      const button = doc?.querySelector(".settings-tabs button:nth-child(2)");
      return button && doc.defaultView.getComputedStyle(button).color === "rgb(129, 187, 204)";
    }, activeDesignerSelector);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(paths.output, `${id}-editor.png`) });
    assert.deepEqual(errors, []);
    entry.status = "PASS";
  } catch (error) {
    entry.status = "FAILED"; entry.error = String(error.stack || error);
    entry.pageErrors = errors;
    await page.screenshot({ path: path.join(paths.output, `${id}-failure.png`) }).catch(() => {});
  } finally {
    report.cases.push(entry); save();
    await context.close();
    console.log(`${entry.status} editor ${id}`);
  }
}
async function runtimeCase(server, browser, viewport, dpr, reduced, type) {
  const id = `${viewport[0]}-dpr${dpr}-reduced${reduced}-${type}`;
  const entry = { id, viewport, dpr, reduced, type, status: "RUNNING" };
  const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] },
    deviceScaleFactor: dpr, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  try {
    await server.assertAlive();
    await page.goto(`${server.url}/?mode=preview`);
    await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
    const skin = skinFixture();
    if (type === "local") skin.renpy.preferences = { buttonRoles: { category_pagination: role(184, "#71bbcc") } };
    if (type === "agentvn") skin.layout_type = "agentvn";
    await page.evaluate(({ skin, id }) => window.postMessage({
      type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: id,
      revision: 1, requestId: id, runId: id, screen: "settings", uiSkin: skin,
      manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.14.0",
        game_id: id, title: "分类角色", author: "QA", version: "1.0.0", language: "zh-CN",
        entry_script: "script.json", entry_scene_id: "main", assets: [] },
      script: { schema_version: "1.1.0", game_id: id, title: "分类角色", entry_scene_id: "main", characters: [],
        scenes: [{ scene_id: "main", title: "主场景", chapter: 1, tags: [],
          commands: [{ type: "narration", text: "分类角色隔离回归。" }] }] },
    }, "*"), { skin, id });
    await idle(page, "settings");
    entry.geometry = await geometry(page);
    const text = page.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true });
    await page.mouse.move(1, 1);
    await page.evaluate(() => document.activeElement?.blur?.());
    entry.normal = await readControl(text);
    if (type === "agentvn") {
      assert.equal(entry.normal.custom, null, "AgentVN不得应用Ren'Py角色");
    } else {
      assert.equal(entry.normal.custom, "true", "Runtime设置分类未应用角色");
      assert.equal(entry.normal.color, type === "local" ? "rgb(113, 187, 204)" : "rgb(129, 187, 204)");
      const scale = await page.locator("[data-renpy-menu-frame]").evaluate(node => Number(node.dataset.renpyMenuScale));
      assert(Math.abs(entry.normal.width - (type === "local" ? 184 : 136) * scale) < 1,
        "角色几何未使用同一安全画布比例");
      assert(Math.abs(entry.normal.font - 18 * scale) < .1, "角色字号被页面固定字号覆盖");
      await text.hover();
      entry.hover = await readControl(text);
      assert.equal(entry.hover.color, "rgb(221, 238, 255)");
      assert.equal(entry.hover.width, entry.normal.width);
      assert.equal(entry.hover.height, entry.normal.height);
    }
    await text.focus();
    await page.keyboard.press("Enter");
    await page.locator("[data-settings-tab-current] .settings-section-title").filter({ hasText: /^文字$/ }).waitFor();
    assert(await text.evaluate(node => document.activeElement === node), "分类键盘操作丢失焦点");
    for (const label of ["文字", "音频", "跳过", "系统", "显示"]) {
      const control = page.locator(".settings-tabs").getByRole("button", { name: label, exact: true });
      await control.click();
      await page.locator("[data-settings-tab-current] .settings-section-title").filter({ hasText: new RegExp(`^${label}$`) }).waitFor();
      assert.equal(await control.getAttribute("aria-pressed"), "true");
      await page.mouse.move(1, 1);
      await page.evaluate(() => document.activeElement?.blur?.());
      if (type !== "agentvn") assert.equal((await readControl(control)).color, "rgb(255, 238, 136)");
    }
    await geometry(page);
    await page.screenshot({ path: path.join(paths.output, `${id}-runtime.png`) });
    assert.deepEqual(errors, []);
    entry.status = "PASS";
  } catch (error) {
    entry.status = "FAILED"; entry.error = String(error.stack || error);
    await page.screenshot({ path: path.join(paths.output, `${id}-failure.png`) }).catch(() => {});
  } finally {
    report.cases.push(entry); save();
    await context.close();
    console.log(`${entry.status} runtime ${id}`);
  }
}
(async () => {
  fs.mkdirSync(paths.output, { recursive: true });
  let env, server, browser;
  try {
    if (mode === "editor") {
      const project = fixture(paths.fixtureProjectId);
      project.editor_settings = { runtimeUILayout: loaded.exports.getDefaultUISkinLayout(),
        runtimeUILayoutProfiles: { version: 1, activeType: "agentvn", profiles: {
          agentvn: loaded.exports.getDefaultUISkinLayout(), renpy: skinFixture(),
        } } };
      const derivedInput = path.join(paths.output, "分类页面独立小工程.vnproj");
      // The ownership helper requires a fresh directory. Build the derived
      // fixture only after it has validated/started its independent services.
      env = await startEditorAcceptance(paths.output);
      console.log("Owned Editor services ready");
      report.services = { url: env.url, editorPid: env.server.pid, backendPid: env.backendPid, backendUrl: env.backendUrl };
      save();
      env.derivedInput = derivedInput;
      fs.writeFileSync(derivedInput, JSON.stringify(project), { flag: "wx" });
      console.log("Isolated project fixture ready");
    } else {
      server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
        configFile: path.join(root, "GameCli_framework/vite.config.cjs"),
        port: 0, logFile: path.join(paths.output, "runtime.log") });
      report.services = { url: server.url, pid: server.pid, runId: server.runId };
    }
    browser = await chromium.launch({ headless: true });
    console.log("Chromium ready");
    for (const viewport of viewports) for (const dpr of fast ? [1] : [1, 2])
      for (const reduced of fast ? [false] : [false, true]) {
        if (mode === "editor") await editorCase(env, browser, viewport, dpr, reduced);
        else for (const type of ["local", "shared", "agentvn"])
          await runtimeCase(server, browser, viewport, dpr, reduced, type);
      }
    assert.equal(report.cases.length, viewports.length * (fast ? 1 : 4) * (mode === "editor" ? 1 : 3),
      "验收矩阵缺项或为空");
    assert(report.cases.every(row => row.status === "PASS"), "分类角色存在失败");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    await browser?.close();
    await env?.stop();
    await server?.stop();
    report.finishedAt = new Date().toISOString(); save();
    console.log(`Evidence: ${paths.output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
