"use strict";
// Real editor inputs + isolated backend + public cartridge exporter + browser player.
// Browser safe-insets are controlled; this is not native/install/physical-phone evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor, select, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
const resume = process.argv[3] === "--resume" ? path.resolve(process.argv[4]) : undefined;
const boundaries = process.argv[3] === "--boundaries" ? path.resolve(process.argv[4]) : undefined;
assert(process.argv[2] && out.startsWith("F:\\testavn\\") && !fs.existsSync(out), "Fresh F evidence directory required");
fs.mkdirSync(out, { recursive: true });
const temp = path.join(out, "temp"); fs.mkdirSync(temp); process.env.TEMP = temp; process.env.TMP = temp;
const req = require("node:module").createRequire(path.join(root, "editor/package.json")), m = { exports: {} };
new Function("module", "exports", "require", req("esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";
    export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles";
    export {exportEditorCartridge} from "./editor/src/cartridge/exportCartridge";
    export {exportScript} from "./editor/src/utils/exportScript";
    export {resolveRenpyQuickBar} from "./shared/cartridge/renpyQuickBar";
  ` }, bundle: true, platform: "node", packages: "external", format: "cjs", write: false,
}).outputFiles[0].text)(m, m.exports, req);
const api = m.exports, project = fixture(`quick-placement-${path.basename(out)}`);
const original = { agentvn: api.getDefaultUISkinLayout(), renpy: api.createRenpyUILayout() };
project.editor_settings = { runtimeUILayout: original.renpy, runtimeUILayoutProfiles: {
  version: 1, activeType: "renpy", profiles: original } };
project.title = "快捷栏位置独立验收";
project.nodes.find(n => n.data.scene).data.scene.commands = [
  { type: "narration", text: "自定义顶部快捷栏不应压缩这段对白。保存重开与导出消费必须使用实际作者设置。" },
  { type: "narration", text: "这是仍然可以阅读的NVL段落。", presentation_mode: "nvl" },
];
process.env.AGENTVN_TEST_PROJECT = path.join(out, "fixture.vnproj");
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "editor");
fs.writeFileSync(process.env.AGENTVN_TEST_PROJECT, JSON.stringify(project), { flag: "wx" });
const productFiles = ["shared/cartridge/renpyQuickBar.ts", "shared/cartridge/uiSkin.ts",
  "shared/cartridge/runtimeCapabilities.ts", "shared/cartridge/constants.ts",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  "GameCli_framework/src/components/player/RenpyQuickBar.tsx", "GameCli_framework/src/components/player/DialogBox.tsx"];
const fingerprints = () => productFiles.map(file => ({ file,
  sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex") }));
const report = { status: "RUNNING", scope: "SOURCE_BROWSER_REAL_AUTHORING_SAVE_REOPEN_PUBLIC_API_EXPORT_LIBRARY_CONSUMPTION",
  modelRequests: 0, nativeInputs: 0, sourcesBefore: fingerprints(), startedAt: new Date().toISOString(), cases: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, runtime, browser, activePage;
async function test(name, run) {
  const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  try { await run(row); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { save(); }
}
const settings = page => page.evaluate(async () => {
  const { useProjectStore } = await import("/src/store/projectStore.ts");
  return structuredClone(useProjectStore.getState().settings);
});
const menuFrom = skin => skin.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "quick_menu");
async function selectMenu(page) {
  await page.locator('.runtime-layout-component-list button[data-component-id="quick_menu"]').click();
}
async function openLayout(page) {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
  const entry = page.getByTestId("renpy-player-layout-entry");
  if (await entry.isVisible()) await entry.click();
  else await page.locator(".runtime-layout-screen-list").getByRole("button", { name: "播放页", exact: true }).click();
  await settleEditor(page); await selectMenu(page);
}
async function saveLayout(page) {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
}
const near = (a, b, tolerance = 1.5) => assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
async function readGeometry(page) {
  return page.evaluate(async () => {
    // Wait for actual layout stability, not a guessed animation sleep.
    let last = "", stable = 0;
    for (let i = 0; i < 150; i++) {
      await new Promise(requestAnimationFrame);
      const bar = document.querySelector(".renpy-quick-bar");
      const value = JSON.stringify([bar?.getBoundingClientRect(), document.querySelector(".dialog-text")?.getBoundingClientRect()]);
      stable = value === last ? stable + 1 : 0; last = value; if (stable >= 4) break;
    }
    const rect = n => n?.getBoundingClientRect().toJSON(), bar = document.querySelector(".renpy-quick-bar");
    return {
      frame: rect(document.querySelector(".runtime-layout-frame")), bar: rect(bar),
      text: rect(document.querySelector(".dialog-text")), nvl: rect(document.querySelector(".nvl-page")),
      placement: bar?.dataset.quickMenuPlacement, overflow: document.documentElement.scrollWidth - innerWidth,
      display: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
      buttons: [...(bar?.querySelectorAll("button") || [])].map(button => {
        const box = button.getBoundingClientRect();
        return { label: button.textContent, box: box.toJSON(), disabled: button.disabled,
          hit: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      }),
    };
  });
}
async function startGame(page) {
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor();
  await settleRuntime(page);
  await page.evaluate(async () => {
    const { useSettingsStore } = await import("/src/store/settingsStore.ts");
    useSettingsStore.getState().updateSettings({ textSpeedCps: 0 });
  });
  if (await page.locator(".story-player").getAttribute("data-is-typing") === "true")
    await page.locator(".story-player").click({ position: { x: 20, y: 300 } });
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
}
function verify(g, expectedRect, bottom = 0) {
  assert.equal(g.placement, expectedRect ? "custom" : "bottom"); assert.equal(g.buttons.length, 9);
  assert(g.buttons.every(b => b.hit), "All nine controls must have real pointer ownership");
  assert(g.buttons.every(b => Math.abs(b.box.top - g.bar.top) <= 1.5 && Math.abs(b.box.bottom - g.bar.bottom) <= 1.5));
  assert(g.bar.left >= g.frame.left - 1 && g.bar.right <= g.frame.right + 1);
  assert(g.bar.top >= g.frame.top - 1);
  const remainingBottom = Math.max(0, bottom - (g.display.height - g.frame.bottom));
  assert(g.bar.bottom <= g.frame.bottom - remainingBottom + 1);
  assert(g.overflow <= 1); assert(g.text && g.text.height > 12, "Dialogue remains readable");
  if (expectedRect) {
    const expected = api.resolveRenpyQuickBar({ width: g.frame.width, height: g.frame.height },
      { x: 0, y: 0, width: 100, height: (g.frame.height - remainingBottom) / g.frame.height * 100 }, undefined, expectedRect);
    near(g.bar.left - g.frame.left, expected.x); near(g.bar.top - g.frame.top, expected.y);
    near(g.bar.width, expected.width); near(g.bar.height, expected.height);
    assert(g.bar.bottom < g.text.top, "Top toolbar must not cover dialogue");
  }
}
(async () => {
  save();
  if (boundaries) {
    const previous = JSON.parse(fs.readFileSync(path.join(boundaries, "report.json")));
    assert.equal(previous.cases[0].status, "PASS"); assert.equal(previous.cases[1].status, "PASS");
    const zip = await req("jszip").loadAsync(fs.readFileSync(path.join(boundaries, "quick-placement.vncart")));
    const savedLayout = JSON.parse(await zip.file("ui/layout.json").async("string"));
    project.editor_settings.runtimeUILayout = savedLayout;
    project.editor_settings.runtimeUILayoutProfiles.profiles.renpy = savedLayout;
    fs.writeFileSync(process.env.AGENTVN_TEST_PROJECT, JSON.stringify(project));
    report.inputScope = "ISOLATED_FIXTURE_COPIES_PRIOR_REAL_AUTHORED_EXPORTED_LAYOUT_NOT_ORIGINAL_PROFILE";
  }
  if (!resume) host = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  runtime = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(out, "runtime.log") });
  report.services = [...(host ? [{ url: host.url, pid: host.server.pid }, { url: host.backendUrl, pid: host.backendPid }] : []),
    { url: runtime.url, pid: runtime.pid }]; save();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = activePage = await context.newPage(); page.setDefaultTimeout(45000);
  page.on("pageerror", error => report.errors.push(String(error)));
  if (host) { await host.open(page); await settleEditor(page); }
  let skin, authoredRect;
  if (boundaries) {
    await openLayout(page);
    const editorMatrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, dpr, reduced }))));
    const cdp = await context.newCDPSession(page);
    for (const v of editorMatrix) await test(`Editor position controls ${v.width} DPR${v.dpr} ${v.reduced ? "reduce" : "normal"}`, async row => {
      const height = v.width * 9 / 16;
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: v.width, height, deviceScaleFactor: v.dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: v.reduced ? "reduce" : "no-preference" });
      const input = page.getByRole("spinbutton", { name: "控件y", exact: true });
      await input.scrollIntoViewIfNeeded(); await input.click(); assert.equal(await input.inputValue(), "10");
      row.control = await input.evaluate(n => { const box = n.getBoundingClientRect(), parent = n.closest(".runtime-layout-inspector").getBoundingClientRect();
        return { box: box.toJSON(), parent: parent.toJSON(), hit: n.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)),
          focused: document.activeElement === n, overflow: document.documentElement.scrollWidth - innerWidth,
          display: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches } };
      });
      assert.deepEqual(row.control.display, { width: v.width, height, dpr: v.dpr, reduced: v.reduced });
      const g = row.control; assert(g.focused && g.hit && g.overflow <= 1);
      assert(g.box.top >= g.parent.top && g.box.bottom <= g.parent.bottom && g.box.left >= g.parent.left && g.box.right <= g.parent.right);
      await select(page, "快捷栏位置", "底部居中"); assert.equal(await input.isDisabled(), true);
      await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
      const frame = await (await page.locator(".renpy-editor-runtime-viewport iframe").elementHandle()).contentFrame();
      await frame.locator('.renpy-quick-bar[data-quick-menu-placement="bottom"]').waitFor();
      const defaultBar = await readGeometry(frame), expected = api.resolveRenpyQuickBar(
        { width: defaultBar.frame.width, height: defaultBar.frame.height }, { x: 0, y: 0, width: 100, height: 100 });
      near(defaultBar.bar.left - defaultBar.frame.left, expected.x); near(defaultBar.bar.top - defaultBar.frame.top, expected.y);
      await select(page, "快捷栏位置", "自定义位置"); assert.equal(await input.inputValue(), "10");
      await frame.locator('.renpy-quick-bar[data-quick-menu-placement="custom"]').waitFor();
      const current = await settings(page); // Draft not saved again: original real saved settings remain custom.
      authoredRect = menuFrom(current.runtimeUILayoutProfiles.profiles.renpy).rect;
      row.defaultBar = defaultBar.bar;
    });
    await cdp.send("Emulation.clearDeviceMetricsOverride"); await cdp.detach();
    await test("Custom upper bar preserves NVL reading and all nine pointer targets", async row => {
      const frame = await (await page.locator(".renpy-editor-runtime-viewport iframe").elementHandle()).contentFrame();
      await frame.locator(".dialog-box").click({ position: { x: 500, y: 80 } });
      await frame.getByTestId("nvl-page").waitFor();
      await frame.waitForFunction(() => document.querySelector(".story-player")?.dataset.isTyping === "false");
      row.geometry = await readGeometry(frame);
      assert(row.geometry.nvl && row.geometry.nvl.height > 16);
      assert(row.geometry.bar.bottom < row.geometry.nvl.top);
      assert(row.geometry.buttons.every(b => b.hit)); assert.equal(row.geometry.buttons.length, 9);
      assert(row.geometry.overflow <= 1);
    });
    assert.equal(report.cases.length, 13); assert.deepEqual(report.errors, []);
    report.status = "PASS"; return;
  }
  const cartridge = path.join(resume || out, "quick-placement.vncart");
  if (resume) {
    assert(resume.startsWith("F:\\testavn\\") && resume !== out);
    const priorBytes = fs.readFileSync(path.join(resume, "report.json"));
    const previous = JSON.parse(priorBytes);
    assert.equal(previous.status, "FAILED"); assert.equal(previous.cases.length, 4);
    assert.deepEqual(previous.sourcesBefore, report.sourcesBefore);
    assert(previous.cases.slice(0, 3).every(c => c.status === "PASS"));
    assert(previous.cleanup.every(c => c.status === "PASS_STOPPED_AND_PORT_CLOSED"));
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(cartridge)).digest("hex"), previous.cases[2].sha256);
    report.inheritedCases = previous.cases.slice(0, 3).map(c => ({ name: c.name, status: c.status,
      evidence: path.join(resume, "report.json"), evidenceSha256: crypto.createHash("sha256").update(priorBytes).digest("hex") }));
    const zip = await req("jszip").loadAsync(fs.readFileSync(cartridge));
    skin = JSON.parse(await zip.file("ui/layout.json").async("string")); authoredRect = menuFrom(skin).rect;
  } else {
  await test("Real editor opt-in, controls, default/custom restore and layout isolation", async row => {
    await openLayout(page);
    const x = page.getByRole("spinbutton", { name: "控件x", exact: true });
    assert.equal(await x.isDisabled(), true);
    await select(page, "快捷栏位置", "自定义位置"); assert.equal(await x.isEnabled(), true);
    row.initialRect = {};
    for (const field of ["x", "y", "width", "height"])
      row.initialRect[field] = Number(await page.getByRole("spinbutton", { name: `控件${field}`, exact: true }).inputValue());
    near(row.initialRect.x, 337 / 12.8, .001); near(row.initialRect.y, 680 / 7.2, .001);
    await select(page, "布局锚点", "顶部居中");
    for (const [field, value] of [["x", "50"], ["y", "10"], ["width", "60"], ["height", "6"]]) {
      const input = page.getByRole("spinbutton", { name: `控件${field}`, exact: true });
      await input.fill(value); await input.press("Tab"); assert.equal(await input.inputValue(), value);
    }
    await select(page, "快捷栏位置", "底部居中"); assert.equal(await x.isDisabled(), true);
    await select(page, "快捷栏位置", "自定义位置"); assert.equal(await x.inputValue(), "50");
    await saveLayout(page);
    const saved = await settings(page);
    skin = saved.runtimeUILayoutProfiles.profiles.renpy; authoredRect = menuFrom(skin).rect;
    assert.deepEqual(authoredRect, { x: 50, y: 10, width: 60, height: 6, anchor: "top_center" });
    assert.equal(menuFrom(skin).style.quickMenuPlacement, "custom");
    assert.deepEqual(saved.runtimeUILayoutProfiles.profiles.agentvn, JSON.parse(JSON.stringify(original.agentvn)));
    await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
    const preview = await page.locator(".renpy-editor-runtime-viewport iframe").elementHandle();
    const frame = await preview.contentFrame();
    await frame.locator('.renpy-quick-bar[data-quick-menu-placement="custom"]').waitFor();
    row.previewBar = await frame.locator(".renpy-quick-bar").boundingBox();
    row.screenshot = await captureSourceBrowser(page, path.join(out, "authoring.png"),
      { width: 1920, height: 1080, dpr: 1, reduced: false });
  });
  await test("Saved catalog reload preserves authored rect and mode", async row => {
    await page.reload();
    await page.locator(".recent-project-open").filter({ hasText: project.title }).first().click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    assert.deepEqual((await settings(page)).runtimeUILayoutProfiles.profiles.renpy, skin);
    await openLayout(page);
    assert.equal(await page.getByRole("spinbutton", { name: "控件y", exact: true }).inputValue(), "10");
    assert.equal(await page.getByRole("spinbutton", { name: "控件y", exact: true }).isEnabled(), true);
    row.persisted = true;
  });
  await test("Public export API includes layout and Runtime 0.32 requirement", async row => {
    const exported = await api.exportEditorCartridge({ script: api.exportScript(project.nodes, project.edges),
      gameId: project.project_id, title: project.title, author: "QA", version: "1.0.0", language: "zh-CN",
      description: "", includeGallery: false, includeMetadata: false, projectAssets: [], projectAssetRefs: [], uiSkin: skin });
    assert.deepEqual(exported.errors, []);
    fs.writeFileSync(cartridge, Buffer.from(await exported.blob.arrayBuffer()), { flag: "wx" });
    const zip = await req("jszip").loadAsync(fs.readFileSync(cartridge));
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
    assert.equal(manifest.runtime_version, "0.32.0"); assert.deepEqual(menuFrom(layout).rect, authoredRect);
    row.manifest = manifest; row.sha256 = crypto.createHash("sha256").update(fs.readFileSync(cartridge)).digest("hex");
    row.exportMethod = "PUBLIC_EXPORT_API_FROM_REAL_UI_SAVED_LAYOUT_NOT_EXPORT_BUTTON";
  });
  }
  await test("Real library import and exported game action consumption", async row => {
    const player = activePage = await context.newPage(); player.setDefaultTimeout(30000);
    await player.goto(runtime.url + "/?mode=library");
    await player.getByTestId("web-cartridge-file").setInputFiles(cartridge);
    await player.locator(".cartridge-spine").filter({ hasText: project.title }).last().click();
    await player.getByRole("button", { name: "启动卡带", exact: true }).click();
    await settleRuntime(player); await startGame(player);
    row.geometry = await readGeometry(player); verify(row.geometry, authoredRect);
    await player.getByTestId("renpy-quick-history").click(); await settleRuntime(player);
    await player.locator(".history-list").waitFor();
    // Public navigation back to story; no store mutation to fake a working hit.
    await player.getByRole("button", { name: "返回", exact: true }).click(); await settleRuntime(player);
    await player.getByTestId("game-state-playing").waitFor();
    await player.getByTestId("renpy-quick-hide").click();
    await player.waitForFunction(() => document.querySelector(".story-interface")?.getAttribute("data-hidden") === "true");
    await player.keyboard.press("h");
    await player.waitForFunction(() => document.querySelector(".story-interface")?.getAttribute("data-hidden") === "false");
    row.actions = ["history", "return", "hide", "restore"];
    await player.close(); activePage = page;
  });
  // One fresh context per declared DPR; actual viewport/media are sampled in every case.
  const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr => [false, true].map(reduced =>
    ({ width, height: width * 9 / 16, dpr, reduced, bottom: 0, aspect: "16:9" }))));
  matrix.push(...[1920, 2400].flatMap(width => ["16:9", "16:10", "4:3"].map(aspect =>
    ({ width, height: 1080, dpr: 2, reduced: false, bottom: 32, aspect, mobile: true }))));
  for (const v of matrix) await test(`Runtime ${v.width}x${v.height} DPR${v.dpr} ${v.reduced ? "reduce" : "normal"} ${v.aspect} ${v.mobile ? "controlled-Android" : "desktop"}`, async row => {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height },
      deviceScaleFactor: v.dpr, reducedMotion: v.reduced ? "reduce" : "no-preference", hasTouch: Boolean(v.mobile),
      ...(v.mobile ? { userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36" } : {}) });
    try {
      const p = activePage = await ctx.newPage(); p.setDefaultTimeout(30000);
      p.on("pageerror", error => report.errors.push(String(error)));
      if (v.mobile) await p.addInitScript(v => { window.AgentVNViewport = { requestInsets() {
        window.dispatchEvent(new CustomEvent("agentvn:android-insets", { detail: { top: 0, right: 0, left: 0,
          bottom: v.bottom * v.dpr, coordinateSpace: "physical", revision: 1 } }));
      } }; }, v);
      await p.goto(runtime.url + "/?mode=preview");
      await p.waitForFunction(() => document.querySelector("#root")?.childElementCount);
      const uiSkin = structuredClone(skin); uiSkin.gameViewport = { aspectRatio: v.aspect };
      await p.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
        sessionId: "quick-placement", revision: 1, requestId: "quick-placement", runId: "quick-placement",
        screen: "title_menu", ...payload }, "*"), { uiSkin, assetUrls: {},
        manifest: { manifest_version: "1.0.0", runtime_version: "0.32.0", game_id: "quick-placement",
          title: project.title, author: "QA", version: "1.0.0", language: "zh-CN", entry_script: "script.json",
          entry_scene_id: "main", assets: [] },
        script: { schema_version: "1.0.0", game_id: "quick-placement", title: project.title, entry_scene_id: "main",
          scenes: [{ scene_id: "main", title: "主场景", commands: project.nodes.find(n => n.data.scene).data.scene.commands }] } });
      await startGame(p);
      row.geometry = await readGeometry(p); verify(row.geometry, authoredRect, v.bottom);
      assert.deepEqual(row.geometry.display, { width: v.width, height: v.height, dpr: v.dpr, reduced: v.reduced });
      if (v.width === 1920 && v.dpr === 1 && !v.reduced && !v.mobile)
        row.screenshot = await captureSourceBrowser(p, path.join(out, "runtime.png"),
          { width: v.width, height: v.height, dpr: v.dpr, reduced: v.reduced });
      await p.getByTestId("renpy-quick-history").click(); await settleRuntime(p);
      await p.locator(".history-list").waitFor(); row.actualHistoryClick = true;
    } finally { await ctx.close(); activePage = page; }
  });
  assert.equal(report.cases.length, resume ? 19 : 22); assert.deepEqual(report.errors, []);
  report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  try { if (activePage && !activePage.isClosed()) {
    fs.writeFileSync(path.join(out, "failure-dom.html"), await activePage.content(), { flag: "wx" });
    await activePage.screenshot({ path: path.join(out, "failure.png") });
  } } catch {}
}).finally(async () => {
  try {
    await browser?.close(); await host?.stop(); await runtime?.stop();
    assert.deepEqual(fingerprints(), report.sourcesBefore);
    report.cleanup = [];
    for (const service of report.services || []) {
      assert.throws(() => process.kill(service.pid, 0)); let responding = false;
      try { await fetch(service.url, { signal: AbortSignal.timeout(1000) }); responding = true; } catch {}
      assert(!responding); report.cleanup.push({ ...service, status: "PASS_STOPPED_AND_PORT_CLOSED" });
    }
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, out }));
});
