"use strict";
// Actual installed Editor/backend/player. Fixture preparation uses the public
// backend import API; every author edit, save, reopen and export uses real UI.
// No frontend modules/store access and no Tauri or player-state mocks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { assertRenpyQuickBarGeometry } = require("./lib/installed-portable-layout.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");

assert(process.argv[2] && process.argv[3], "Pass installation audit and fresh output");
const root = path.resolve(__dirname, ".."), audit = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]), input = path.resolve(process.env.AGENTVN_TEST_PROJECT || "");
const resumeArgument = process.argv.find(arg => arg.startsWith("--resume-authoring="));
const resumeFile = resumeArgument ? path.resolve(resumeArgument.slice("--resume-authoring=".length)) : null;
const profileSafety = process.argv.includes("--profile-safety");
const playerAuthoring = process.argv.includes("--player-authoring");
const fontNodeAuthoring = process.argv.includes("--font-node-authoring");
const visibleNativeWindow = process.argv.includes("--visible-native-window");
assert([Boolean(resumeFile), profileSafety, playerAuthoring, fontNodeAuthoring].filter(Boolean).length <= 1,
  "Choose one installed acceptance lifecycle");
assert(!fs.existsSync(out), "Never overwrite acceptance evidence");
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""), out);
assert(A.inside(out, input) && input.endsWith(".vnproj"));
assert.notEqual(process.env.E5_LIFECYCLE_SOURCE, "1");
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(audit, path.join(out, "installer-resource-report.json"));
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "Installed Release authoring -> native vnproj save/reopen -> UI vncart export -> installed player",
  environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out },
  cases: [], matrix: [], playerMatrix: [], launches: [], errors: [], nativeInputs: [], cleanup: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const pages = [
  { id: "title", label: "标题主页", component: "title_hero", content: ".main-menu-title-hero-background" },
  { id: "preferences", label: "选项", component: "settings_group", action: "settings", content: ".settings-renpy" },
  { id: "save_load", label: "存档/读档", component: "save_grid", action: "save-load", content: ".save-grid" },
  { id: "history", label: "历史", component: "history_list", action: "history", content: ".history-list" },
  { id: "about", label: "关于", component: "about_panel", action: "about", content: ".about-card" },
  { id: "help", label: "帮助", component: "help_panel", action: "help", content: ".help-card" },
  { id: "gallery", label: "画廊", component: "gallery_grid", action: "gallery", content: ".gallery-grid" },
].map((value, index) => ({ ...value, font: 23 + index, spacing: 7 + index,
  color: `#${(0x24384c + index * 0x040302).toString(16)}` }));
const rgb = hex => `rgb(${[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
const project = fixture(`installed_authoring_${path.basename(out)}`);
project.title = `安装版布局创作 ${path.basename(out)}`;
project.asset_manifest = [{
  asset_id: "author-gallery-art", asset_type: "ui", metadata: {
    filename: "验收画廊.svg", mime_type: "image/svg+xml", source: "imported",
    project_path: "assets/ui/author-gallery.svg", width: 64, height: 64,
    data_url: `data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#324d61"/></svg>',
    ).toString("base64")}`,
  },
}];
project.nodes[1].data.scene.commands = [
  { type: "dialog", character_id: "alice", text: "作者继承气泡验证。" },
  { type: "narration", text: "作者工程继承NVL验证。" },
  { type: "narration", text: "作者清页NVL验证。" },
  { type: "narration", presentation_mode: "dialog", text: "作者普通对白验证。" },
  { type: "gallery_anchor", anchor_id: "author-gallery", title: "作者画廊",
    asset_id: "author-gallery-art", description: "布局验收专用画廊" },
  { type: "choice", choices: [
    { choice_id: "continue", choice_display_name: "继续", text: "继续", target_scene_id: "ui_acceptance", conditions: [] },
    { choice_id: "again", choice_display_name: "重看", text: "重看", target_scene_id: "ui_acceptance", conditions: [] },
  ] },
];
if (playerAuthoring) project.nodes[1].data.scene.commands = [
  { type: "narration", text: "安装版普通对白作者消费验证。" },
  { type: "choice", choices: [
    { choice_id: "continue", choice_display_name: "继续", text: "继续", target_scene_id: "ui_acceptance", conditions: [] },
    { choice_id: "again", choice_display_name: "重看", text: "重看", target_scene_id: "ui_acceptance", conditions: [] },
  ] },
];
if (fontNodeAuthoring) {
  project.nodes[1].data.scene.scene_id = "dialog_presentation_acceptance";
  project.nodes[1].data.scene.commands = [
    { type: "dialog", character_id: "alice", text: "对白呈现创作验收，隔离中文字体缺字验证。" },
  ];
}
let owner, browser, page, cdp, state, saved, original, player, playerBrowser, playerPage;
const snapshot = () => A.projectSnapshot(state.backendPort);
const layout = () => page.locator(".advanced-tab-content.is-active .runtime-layout-designer");
const profiles = value => value.settings.runtimeUILayoutProfiles;
const component = (profile, screen, id) => profile.screens.find(s => s.screen_id === screen)
  .components.find(c => c.component_id === id);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stage(name, body) {
  report.stage = name; save(); console.log(`START ${name}`);
  const details = await body();
  report.cases.push({ name, status: "PASS", ...details }); save(); console.log(`PASS ${name}`);
}
async function connect() {
  state = owner.state;
  const verified = A.readInstalledSession(out);
  report.launches.push({ ...state, sha256: verified.exeSha256 });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  const context = browser.contexts()[0], deadline = Date.now() + 45000;
  while (!page && Date.now() < deadline) {
    page = context.pages().find(p => p.url().startsWith("http://tauri.localhost"));
    if (!page) await pause(100);
  }
  assert(page, "Actual installed WebView required");
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.errors.push({ product: "Editor", error: String(error) }));
  cdp = await context.newCDPSession(page);
}
async function metrics(target, session, width, height, dpr, reduced) {
  await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  await target.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await readInstalledViewport(target, { width, height, dpr, reduced });
}
async function options(tab = "layout") {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator(`[data-help-key="advanced.tab.${tab}"]:visible`).click();
  await A.settleEditor(page);
}
async function saveLayout() {
  await layout().locator('button[data-help-key="layout.save"]').click();
  await layout().locator('[data-save-state="saved"]').waitFor();
}
async function goPage(entry) {
  if (!await page.locator(".renpy-title-editor").count()) {
    const nav = layout().getByRole("button", { name: /^(返回)?页面导航$/ });
    if (await nav.count()) await nav.click();
    else await layout().locator(".runtime-layout-screen-list").getByRole("button", { name: /标题/ }).click();
  }
  await page.locator(".renpy-title-editor .runtime-layout-sidebar").getByRole("button", { name: entry.label, exact: true }).click();
  await page.locator(`.renpy-title-editor[data-editor-page="${entry.id}"]`).waitFor();
}
async function preview() {
  await layout().locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor({ timeout: 45000 });
  const frame = page.frames().find(f => f.parentFrame() && f.url().includes("gamecli-preview"));
  assert(frame); await A.settleRuntime(frame); return frame;
}
async function clickable(control) {
  await control.scrollIntoViewIfNeeded();
  // Attachment/Playwright visibility does not mean a staggered option's
  // entrance has finished: opacity:0 is "visible" to Playwright. Observe
  // actual actionability and finite animation completion, not a fixed sleep.
  await control.click({ trial: true });
  await control.evaluate(async node => {
    getComputedStyle(node).opacity;
    await Promise.all(document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const result = await control.evaluate(node => {
    const r = node.getBoundingClientRect(), css = getComputedStyle(node);
    return { rect: r.toJSON(), hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      overflow: document.documentElement.scrollWidth - innerWidth,
      visible: css.visibility !== "hidden" && Number(css.opacity) > 0,
      vw: innerWidth, vh: innerHeight, clipped: node.scrollWidth > node.clientWidth + 1 };
  });
  const r = result.rect;
  assert(result.hit && result.visible && result.overflow <= 1 && !result.clipped
    && r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1
    && r.right <= result.vw + 1 && r.bottom <= result.vh + 1,
  `Real control clipped/overlapped/unreachable: ${JSON.stringify(result)}`);
  return result;
}
async function native(trigger, name, selectedPath, isFile) {
  const receipt = await A.nativeInput({ page, trigger, out, name,
    ownerPid: state.editorPid, selectedPath });
  report.nativeInputs.push({ name, selectedPath, isFile, receipt });
}
async function closeNormally() {
  A.readInstalledSession(out);
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `$p=Get-Process -Id ${Number(state.editorPid)} -ErrorAction Stop; ` +
    `if (-not $p.CloseMainWindow()) { throw 'Native close rejected' }; ` +
    `if (-not $p.WaitForExit(15000)) { throw 'Native close timed out' }`],
  { windowsHide: true, timeout: 20000, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  await browser.close(); browser = undefined; page = undefined;
  report.cleanup.push(await owner.stop()); owner = undefined;
}
async function openInstalledPlayer(cartridgePath) {
  assert(!player, "One installed player owner per acceptance run");
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const p = probe.address().port; probe.close(() => resolve(p)); });
  });
  const exe = path.join(state.installRoot, "agentvn-player.exe");
  player = spawn(exe, ["--mode", "preview", "--cartridge", cartridgePath], {
    cwd: state.installRoot, windowsHide: true, stdio: "ignore", env: { ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: path.join(out, "player-webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  report.player = { exe, sha256: A.sha256(fs.readFileSync(exe)), pid: player.pid, port };
  const deadline = Date.now() + 60000; let ready = false;
  while (Date.now() < deadline) {
    assert.equal(player.exitCode, null, "Installed player exited before readiness");
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await pause(150);
  }
  assert(ready); playerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  playerPage = playerBrowser.contexts()[0].pages()[0]; playerPage.setDefaultTimeout(30000);
  playerPage.on("pageerror", error => report.errors.push({ product: "Runtime", error: String(error) }));
  return { page: playerPage, cdp: await playerBrowser.contexts()[0].newCDPSession(playerPage) };
}
async function assertMenu(target, entry) {
  await A.settleRuntime(target);
  // Runtime screen ownership can be idle before a ResizeObserver/media-query
  // update has started its geometry transitions. Observe actual presentation
  // and finite animations; do not wait for the author's expected values.
  const settlement = await target.evaluate(title => new Promise((resolve, reject) => {
    const started = performance.now(), first = [], last = [];
    let previous, stable = 0, count = 0;
    const sample = () => {
      const host = document.querySelector(title ? ".renpy-title-view" : "[data-renpy-menu-frame]");
      const nav = host?.querySelector(title ? ".renpy-title-navigation" : ".renpy-menu-navigation");
      const style = nav && getComputedStyle(nav);
      const actual = { width: innerWidth, height: innerHeight,
        scale: title ? host?.dataset.renpyScale : host?.dataset.renpyMenuScale,
        host: host?.getBoundingClientRect().toJSON(), nav: nav?.getBoundingClientRect().toJSON(),
        gap: style?.gap, configuredGap: host && getComputedStyle(host).getPropertyValue("--renpy-nav-gap"),
        font: nav?.querySelector("button") && getComputedStyle(nav.querySelector("button")).fontSize,
        animations: host?.getAnimations({ subtree: true }).filter(animation =>
          ["running", "pending"].includes(animation.playState)
          && animation.effect?.getComputedTiming().iterations !== Infinity)
          .map(animation => ({ property: animation.transitionProperty, state: animation.playState,
            localTime: animation.effect?.getComputedTiming().localTime })) };
      const current = JSON.stringify(actual);
      stable = nav && !actual.animations?.length && current === previous ? stable + 1 : 0;
      previous = current;
      const frame = { elapsedMs: performance.now() - started, ...actual }; count++;
      if (first.length < 12) first.push(frame);
      last.push(frame); if (last.length > 4) last.shift();
      if (stable >= 3) resolve({ frameCount: count, elapsedMs: performance.now() - started, first, last });
      else if (performance.now() - started > 5000) reject(Error(`Menu geometry failed to settle: ${JSON.stringify(last)}`));
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), entry.id === "title");
  const actual = await target.evaluate(({ content, title }) => {
    const host = document.querySelector(title ? ".renpy-title-view" : "[data-renpy-menu-frame]");
    const panel = document.querySelector(content), nav = host?.querySelector(title ? ".renpy-title-navigation" : ".renpy-menu-navigation");
    if (!host || !panel || !nav) throw Error(`Missing actual page ${content}`);
    const scale = Number(title ? host.dataset.renpyScale : host.dataset.renpyMenuScale);
    // Authored opacity splits material and content into sibling layers. The
    // outer frame must stay transparent; assert the actual painted material.
    const material = panel.querySelector(":scope > [data-ui-opacity-layer='background']") ?? panel;
    const materialCss = getComputedStyle(material);
    const rect = node => node.getBoundingClientRect().toJSON(), css = getComputedStyle(nav);
    const bounds = rect(panel), sx = bounds.width / panel.offsetWidth, sy = bounds.height / panel.offsetHeight;
    // Absolutely positioned material covers the padding box, excluding native
    // scrollbar tracks. A scrollable grid's border box is intentionally wider.
    const materialBounds = material === panel ? bounds : {
      left: bounds.left + panel.clientLeft * sx, top: bounds.top + panel.clientTop * sy,
      right: bounds.left + (panel.clientLeft + panel.clientWidth) * sx,
      bottom: bounds.top + (panel.clientTop + panel.clientHeight) * sy,
    };
    return { scale, rect: rect(panel), host: rect(host), background: materialCss.backgroundColor,
      material: { rect: rect(material), opacity: Number(materialCss.opacity),
        visibility: materialCss.visibility, display: materialCss.display,
        separateLayer: material !== panel, expectedBounds: materialBounds,
        scrollbarWidth: panel.offsetWidth - panel.clientWidth - panel.clientLeft },
      font: parseFloat(getComputedStyle(nav.querySelector("button")).fontSize), gap: parseFloat(css.gap),
      overflow: document.documentElement.scrollWidth - innerWidth, contentOverflow: panel.scrollWidth - panel.clientWidth,
      buttons: [...nav.querySelectorAll("button")].map(button => { const r = rect(button); return {
        rect: r, label: button.textContent, hit: button.disabled || button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        clipped: button.scrollWidth > button.clientWidth + 1 }; }) };
  }, { content: entry.content, title: entry.id === "title" });
  actual.settlement = settlement;
  report.lastMenuMeasurement = { page: entry.id, actual };
  assert.equal(actual.background, rgb(entry.color), `${entry.id} background did not reach Runtime`);
  assert.equal(actual.material.opacity, 1, `${entry.id} authored material opacity did not reach Runtime`);
  assert.notEqual(actual.material.visibility, "hidden");
  assert.notEqual(actual.material.display, "none");
  for (const key of ["left", "top", "right", "bottom"])
    assert(Math.abs(actual.material.rect[key] - actual.material.expectedBounds[key]) <= 1,
      `${entry.id} material does not cover its authored frame`);
  assert(Math.abs(actual.font / actual.scale - entry.font) < .15, `${entry.id} font did not reach Runtime`);
  assert(Math.abs(actual.gap / actual.scale - entry.spacing) < .15,
    `${entry.id} spacing did not reach Runtime: ${JSON.stringify(actual)}`);
  assert(actual.overflow <= 1 && actual.contentOverflow <= 1);
  for (const r of [actual.rect, ...actual.buttons.map(b => b.rect)])
    assert(r.width > 0 && r.height > 0 && r.left >= actual.host.left - 1 && r.right <= actual.host.right + 1
      && r.top >= actual.host.top - 1 && r.bottom <= actual.host.bottom + 1, `Menu clipped: ${JSON.stringify(actual)}`);
  assert(actual.buttons.every(b => b.hit && !b.clipped));
  for (let i = 1; i < actual.buttons.length; i++) assert(actual.buttons[i - 1].rect.bottom <= actual.buttons[i].rect.top + 1);
  return actual;
}
async function assertMode(target, mode) {
  const panel = target.locator(`.dialog-box[data-dialogue-layout-mode="${mode}"]`);
  await panel.waitFor(); await A.settleRuntime(target);
  const value = await panel.evaluate(node => {
    const r = node.getBoundingClientRect(), stage = node.closest(".story-player").getBoundingClientRect();
    const text = node.querySelector(".nvl-page-text,.dialog-text");
    return { rect: r.toJSON(), stage: stage.toJSON(), background: getComputedStyle(node).backgroundColor,
      color: getComputedStyle(text).color, source: node.dataset.dialogueLayoutSource,
      anchor: node.dataset.dialogBubbleAnchor, text: node.innerText,
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert.equal(value.source, "override");
  assert.equal(value.background, mode === "nvl" ? "rgb(34, 68, 102)" : "rgb(85, 51, 102)");
  assert.equal(value.color, mode === "nvl" ? "rgb(238, 221, 170)" : "rgb(170, 221, 187)");
  const r = value.rect, s = value.stage;
  assert(r.width > 0 && r.height > 0 && r.left >= s.left - 1 && r.right <= s.right + 1
    && r.top >= s.top - 1 && r.bottom <= s.bottom + 1 && value.overflow <= 1);
  return value;
}
async function main() {
  const checkpoint = path.join(out, "checkpoint"); fs.mkdirSync(checkpoint);
  report.checkpoint = [];
  for (const relative of ["plans/ACTIVE_TASKS.md", "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
    "editor/src/components/advanced/RenpyTitleEditor.tsx", "editor/src/components/advanced/DialogueModeLayoutEditor.tsx",
    "editor/src/components/advanced/ConfirmationLayoutEditor.tsx", "GameCli_framework/src/styles/shell.css",
    "GameCli_framework/src/components/player/renpy-quick-bar.css",
    "scripts/installed-layout-authoring-playwright.cjs", "scripts/lib/installed-webview-capture.cjs",
    ...(profileSafety ? ["scripts/lib/installed-profile-safety.cjs"] : []),
    ...(playerAuthoring ? ["scripts/lib/installed-player-authoring.cjs"] : []),
    ...(fontNodeAuthoring ? ["scripts/lib/installed-font-node-authoring.cjs",
      "editor/src/components/editor/PreviewPanel.tsx", "editor/src/components/advanced/AssetLibraryPanel.tsx",
      "GameCli_framework/src/components/player/DialogBox.tsx",
      "GameCli_framework/src/components/player/TypewriterText.tsx"] : [])]) {
    const bytes = fs.readFileSync(path.join(root, relative));
    fs.writeFileSync(path.join(checkpoint, relative.replaceAll("/", "__")), bytes, { flag: "wx" });
    report.checkpoint.push({ relative, sha256: A.sha256(bytes) });
  }
  if (resumeFile) {
    const previousBytes = fs.readFileSync(resumeFile), previous = JSON.parse(previousBytes);
    assert(["actual-installed-cartridge-export-and-capability-provenance",
      "installed-player-consumes-authored-pages-modes-confirmation-matrix"].includes(previous.stage));
    assert([5, 6].includes(previous.cases.length)); assert.equal(previous.matrix.length, 12);
    assert.equal(previous.cases[4].name, "native-project-save-normal-restart-native-reopen-and-profile-byte-integrity");
    if (previous.cases.length === 6)
      assert.equal(previous.cases[5].name, "actual-installed-cartridge-export-and-capability-provenance");
    assert(previous.cases.every(c => c.status === "PASS") && previous.sourceUnchanged);
    assert.deepEqual(previous.errors, []);
    assert(previous.cleanup.every(c => c.editor.exitCode === 0 && c.backend.exitCode === 0));
    if (previous.playerCleanup) assert.equal(previous.playerCleanup.exitCode, 0);
    assert.equal(A.sha256(fs.readFileSync(path.join(path.dirname(resumeFile), "installer-resource-report.json"))),
      A.sha256(fs.readFileSync(audit)), "Resume must reference exactly the same verified installation");
    for (const artifact of [previous.projectArtifact, previous.cartridgeArtifact])
      assert.equal(A.sha256(fs.readFileSync(artifact.path)), artifact.sha256, "Resume artifact bytes changed");
    for (const file of previous.checkpoint)
      assert.equal(A.sha256(fs.readFileSync(path.join(root, file.relative))), file.sha256, "Author candidate changed");
    const installation = JSON.parse(fs.readFileSync(audit));
    const deployment = installation.deployments.find(d => d.kind === "NSIS actual isolated installation");
    assert(deployment); state = { installRoot: deployment.installedRoot };
    assert.equal(A.sha256(fs.readFileSync(path.join(state.installRoot, "agentvn-editor.exe"))), deployment.executable.sha256);
    const portableZip = await JSZip.loadAsync(fs.readFileSync(previous.projectArtifact.path));
    const portable = JSON.parse(await portableZip.file("project.json").async("string"));
    saved = { settings: portable.editor_settings };
    report.referencedAuthoring = { path: resumeFile, sha256: A.sha256(previousBytes), originalStatus: previous.status,
      scope: "Five completed authoring/native-save flows and 12 previews; old FAILED is not rewritten" };
    // Re-audit the unchanged cartridge below. Reuse authoring evidence only;
    // never rewrite the earlier FAILED report or claim its player stage passed.
    report.cases = previous.cases.slice(0, 5)
      .map(c => ({ ...c, execution: "REFERENCED_UNCHANGED", evidence: resumeFile }));
    report.matrix = previous.matrix;
    report.projectArtifact = previous.projectArtifact; report.cartridgeArtifact = previous.cartridgeArtifact;
  } else {
  owner = await startInstalledEditor(out, { visible: visibleNativeWindow }); await connect();
  fs.writeFileSync(input, JSON.stringify(project, null, 2), { flag: "wx" });
  const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input) });
  assert(response.ok, await response.text());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
  await metrics(page, cdp, 1920, 1080, 1, false);
  if (fontNodeAuthoring) {
    report.scope = "Actual installed font import/coverage/fallback, node preview inheritance and native/export/player roundtrip";
    await require("./lib/installed-font-node-authoring.cjs").runFontNodeAuthoring({
      root, out, report, save, stage, snapshot, layout, options, saveLayout, metrics, native, preview, clickable,
      context: () => ({ page, cdp, state }), openInstalledPlayer,
      restart: async () => {
        await closeNormally();
        owner = await startInstalledEditor(out, { restart: true, visible: visibleNativeWindow });
        await connect();
      },
    });
    assert.equal(report.cases.length, 5);
    for (const key of ["fontMatrix", "nodeMatrix", "playerMatrix"]) assert.equal(report[key].length, 12);
    assert.deepEqual(report.errors, []);
    report.status = "PASS";
    return;
  }
  if (playerAuthoring) {
    report.scope = "Actual installed author edits ordinary dialogue/choice/quick-bar -> native roundtrip -> cartridge -> installed player";
    await require("./lib/installed-player-authoring.cjs").runPlayerAuthoring({
      root, out, report, save, stage, snapshot, layout, options, saveLayout, metrics, native, preview, clickable,
      context: () => ({ page, cdp, state }), openInstalledPlayer,
      restart: async () => {
        await closeNormally();
        owner = await startInstalledEditor(out, { restart: true, visible: visibleNativeWindow });
        await connect();
      },
    });
    assert.equal(report.cases.length, 6);
    assert.equal(report.matrix.length, 12);
    assert.equal(report.playerMatrix.length, 12);
    assert.deepEqual(report.errors, []);
    report.status = "PASS";
    return;
  }
  if (profileSafety) {
    report.scope = "Actual installed Release dual-profile draft safety, independent views and native portable roundtrip";
    await require("./lib/installed-profile-safety.cjs").runProfileSafety({
      root, out, report, save, stage, snapshot, layout, options, saveLayout, metrics, native,
      context: () => ({ page, cdp, state }),
      restart: async () => {
        await closeNormally();
        owner = await startInstalledEditor(out, { restart: true, visible: visibleNativeWindow });
        await connect();
      },
    });
    assert.equal(report.cases.length, 6);
    assert.equal(report.matrix.length, 12);
    assert.deepEqual(report.errors, []);
    report.status = "PASS";
    return;
  }
  await stage("installed-project-character-node-inheritance-and-NVL-clear-authoring", async () => {
    await options("settings");
    await A.select(page, "工程默认呈现方式", "NVL 累积阅读");
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
    await page.locator('.react-flow__node[data-id="scene"]').click();
    const card = page.locator(".command-card").filter({ hasText: "作者继承气泡验证。" }).first();
    await card.locator(".command-card-summary").click();
    await A.select(page, "对白呈现方式", "气泡对白");
    await A.select(page, "气泡锚点", "固定屏幕位置");
    await page.getByRole("spinbutton", { name: "气泡水平位置（%）", exact: true }).fill("65");
    await page.getByRole("spinbutton", { name: "气泡垂直位置（%）", exact: true }).fill("25");
    await A.select(page, "角色默认呈现方式", "气泡对白");
    await A.select(page, "对白呈现方式", "普通对白框");
    assert.match(await card.getByTestId("dialog-presentation-source").innerText(), /当前节点.*普通对白框/);
    await A.select(page, "对白呈现方式", "继承角色 / 工程默认");
    assert.match(await card.getByTestId("dialog-presentation-source").innerText(), /角色默认.*气泡对白/);
    await card.locator(".command-card-summary").click();
    const clear = page.locator(".command-card").filter({ hasText: "作者清页NVL验证。" }).first();
    await clear.locator(".command-card-summary").click();
    await clear.locator('[data-help-key="command.nvl.clearPage"]').check();
    await clear.locator(".command-card-summary").click();
    return { authored: true };
  });
  await stage("installed-seven-page-layout-and-independent-help-authoring", async () => {
    await options();
    await layout().locator('[data-layout-type-option="renpy"]').click(); await page.locator(".renpy-title-editor").waitFor();
    await saveLayout(); original = profiles(await snapshot()).profiles.agentvn;
    await page.locator("details").filter({ hasText: "共享导航排列" }).locator("summary").click();
    await page.getByRole("spinbutton", { name: "共享导航左边距", exact: true }).fill("48");
    for (const entry of pages) {
      await goPage(entry);
      const navigationFields = page.locator("details.renpy-page-navigation-fields");
      if (await navigationFields.getAttribute("open") === null)
        await navigationFields.locator("summary").click();
      const name = entry.id === "title" ? "标题页" : entry.label;
      for (const [label, value] of [["字号", entry.font], ["间距", entry.spacing]]) {
        await page.getByRole("button", { name: `覆盖${name}${label}`, exact: true }).click();
        await page.getByRole("spinbutton", { name: `${name}导航${label}`, exact: true }).fill(String(value));
      }
      await page.getByTestId("renpy-page-region-editor").locator(`[data-component-id="${entry.component}"]`).click();
      const appearance = page.getByTestId("renpy-control-appearance");
      await appearance.getByLabel("当前控件背景颜色", { exact: true }).fill(entry.color);
      const styles = page.getByTestId("renpy-page-style-editor");
      for (const label of ["页面背景不透明度", "页面内容不透明度"]) {
        const field = styles.getByLabel(label, { exact: true });
        if (await field.count()) {
          await field.fill("0.9");
          await field.fill("1");
        }
      }
    }
    await saveLayout();
    const current = profiles(await snapshot()); assert.deepEqual(current.profiles.agentvn, original);
    for (const entry of pages) {
      assert.equal(current.profiles.renpy.renpy[entry.id].fontSize, entry.font);
      assert.equal(component(current.profiles.renpy, entry.id, entry.component).style.backgroundColor, entry.color);
    }
    return { pages: pages.map(p => p.id), source: "actual installed UI and backend persistence" };
  });
  await stage("installed-NVL-bubble-layout-inheritance-and-confirmation-authoring", async () => {
    await page.getByTestId("renpy-player-layout-entry").click();
    for (const [mode, label, color, text, width] of [
      ["nvl", "NVL", "#224466", "#eeddaa", 84], ["bubble", "气泡", "#553366", "#aaddbb", 43],
    ]) {
      await A.select(page, "对白布局模式", mode === "nvl" ? "NVL 累积阅读" : "气泡对白");
      const geometryFields = page.locator(".dialogue-mode-fields details").filter({ hasText: "位置与尺寸" });
      if (await geometryFields.getAttribute("open") === null)
        await geometryFields.locator("summary").click();
      await page.getByRole("spinbutton", { name: `${label}区域width`, exact: true }).fill(String(width));
      if (mode === "nvl") {
        await page.getByRole("spinbutton", { name: "NVL区域x", exact: true }).fill("8");
        await page.getByRole("spinbutton", { name: "NVL区域y", exact: true }).fill("15");
        await page.getByRole("spinbutton", { name: "NVL区域height", exact: true }).fill("62");
      }
      const panelAppearance = page.getByTestId("renpy-control-appearance");
      await panelAppearance.getByLabel("当前控件背景颜色", { exact: true }).fill(color);
      const appearanceFields = page.locator(".dialogue-mode-fields details").filter({ hasText: "字体与更多外观" });
      if (await appearanceFields.getAttribute("open") === null)
        await appearanceFields.locator("summary").click();
      await page.getByRole("spinbutton", { name: `${label}不透明度`, exact: true }).fill("1");
      await page.getByRole("button", { name: "正文", exact: true }).click();
      const textAppearance = page.getByTestId("renpy-control-appearance");
      const textColor = textAppearance.getByLabel("当前控件文字颜色", { exact: true });
      await textColor.fill(text);
      await textColor.locator("xpath=..").getByRole("button", { name: "恢复继承", exact: true }).click();
      await textColor.fill(text);
      await textAppearance.getByLabel("当前控件文字大小", { exact: true }).fill("27");
      await assertMode(await preview(), mode);
    }
    await page.getByRole("button", { name: "返回页面导航", exact: true }).click();
    await page.getByTestId("renpy-confirmation-layout-entry").click();
    for (const [key, value] of [["x", 22], ["y", 26], ["width", 56], ["height", 48]])
      await page.getByRole("spinbutton", { name: `确认区域${key}`, exact: true }).fill(String(value));
    const confirmationPanelAppearance = page.getByTestId("renpy-control-appearance");
    await confirmationPanelAppearance.getByLabel("当前控件背景颜色", { exact: true }).fill("#30485d");
    await A.select(page, "确认提示区域", "正文");
    const confirmationTextAppearance = page.getByTestId("renpy-control-appearance");
    await confirmationTextAppearance.getByLabel("当前控件文字颜色", { exact: true }).fill("#ffe3a1");
    await confirmationTextAppearance.getByLabel("当前控件文字大小", { exact: true }).fill("28");
    await saveLayout();
    const frame = await preview(), modal = frame.getByRole("dialog", { name: "退出游戏？", exact: true });
    await modal.waitFor();
    assert.equal(await modal.getAttribute("data-confirmation-layout-source"), "override");
    assert.equal(await modal.evaluate(n => getComputedStyle(n).backgroundColor), "rgba(48, 72, 93, 0.78)");
    await modal.getByRole("button", { name: "关闭退出游戏？", exact: true }).click();
    saved = await snapshot(); assert.deepEqual(profiles(saved).profiles.agentvn, original);
    return { dialogueLayouts: profiles(saved).profiles.renpy.dialogueLayouts,
      confirmation: profiles(saved).profiles.renpy.confirmationLayout };
  });
  await stage("installed-high-resolution-seven-page-real-Runtime-preview-matrix", async () => {
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await metrics(page, cdp, width, height, dpr, reduced); await A.settleEditor(page);
      const viewport = await readInstalledViewport(page, { width, height, dpr, reduced });
      const row = { width, height, dpr, reduced, pages: [] }; report.currentMatrix = row;
      row.viewport = viewport;
      for (const entry of pages) {
        await goPage(entry);
        if (entry.id === "title") await page.getByTestId("renpy-title-runtime-preview-toggle").click();
        const control = page.locator(".renpy-title-editor .runtime-layout-sidebar").getByRole("button", { name: entry.label, exact: true });
        row.pages.push({ id: entry.id, authorHit: await clickable(control), runtime: await assertMenu(await preview(), entry) });
      }
      report.matrix.push(row); save();
      row.capture = await captureInstalledWebview(page, cdp,
        path.join(out, `author-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`),
        { width, height, dpr, reduced });
      save();
      console.log(`PASS installed author matrix ${width} DPR${dpr} ${reduced ? "reduced" : "normal"}`);
    }
    assert.equal(report.matrix.length, 12);
  });
  await stage("native-project-save-normal-restart-native-reopen-and-profile-byte-integrity", async () => {
    await metrics(page, cdp, 1920, 1080, 1, false);
    await options("settings");
    const directory = path.join(out, "中文 工程导出"); fs.mkdirSync(directory);
    await native(page.locator('[data-help-key="settings.projectExportDirectory.choose"]:visible'), "save-directory", directory, false);
    await page.waitForFunction(value => document.querySelector('[data-help-key="settings.projectExportDirectory.current"]')?.textContent.trim() === value, directory);
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
    await page.getByRole("button", { name: "保存工程", exact: true }).click();
    const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    const files = fs.readdirSync(directory).filter(f => f.endsWith(".vnproj")); assert.equal(files.length, 1);
    const file = path.join(directory, files[0]), bytes = fs.readFileSync(file), zip = await JSZip.loadAsync(bytes);
    const portable = JSON.parse(await zip.file("project.json").async("string"));
    saved = await snapshot();
    assert.deepEqual(portable.editor_settings.runtimeUILayoutProfiles, profiles(saved));
    assert.equal(portable.editor_settings.defaultDialogPresentation, "nvl");
    assert.equal(portable.editor_settings.characterDialogPresentations.alice, "bubble");
    const commands = portable.nodes.find(n => n.id === "scene").data.scene.commands;
    assert.equal(commands[0].presentation_mode, undefined);
    assert.deepEqual(commands[0].bubble_position, { mode: "fixed", x: 65, y: 25 });
    assert.equal(commands[2].clear_nvl_page_before, true);
    assert(!JSON.stringify(portable).includes(directory), "Local export preference must not enter portable data");
    report.projectArtifact = { path: file, sha256: A.sha256(bytes), generatedAt: fs.statSync(file).mtime.toISOString() };
    await closeNormally(); owner = await startInstalledEditor(out, { restart: true, visible: visibleNativeWindow }); await connect();
    // Reopen the actual saved portable file with the real native picker; do
    // not prove roundtrip by merely reloading the existing backend project.
    await page.getByRole("button", { name: "导入项目", exact: true }).waitFor();
    await native(page.getByRole("button", { name: "导入项目", exact: true }), "reopen", file, true);
    await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
    assert.deepEqual(profiles(await snapshot()), profiles(saved));
    assert.equal(A.sha256(fs.readFileSync(file)), report.projectArtifact.sha256);
    return { projectArtifact: report.projectArtifact };
  });
  }
  await stage("actual-installed-cartridge-export-and-capability-provenance", async () => {
    if (!resumeFile) {
    await page.locator('[data-workspace-surface="publish"]:visible').click();
    const publishing = page.locator(".cartridge-export-panel"); await publishing.waitFor();
    await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
    await A.dismissEnvironmentCompletion(page);
    await publishing.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    await publishing.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
    const warning = publishing.getByRole("checkbox", { name: /我已检查全部警告/ });
    if (await warning.count()) await warning.check();
    report.cartridgeArtifact = await A.realDownload(page, cdp, out, publishing.locator(".package-primary-action"));
    }
    const archive = await JSZip.loadAsync(fs.readFileSync(report.cartridgeArtifact.path));
    const layoutBytes = await archive.file("ui/layout.json").async("nodebuffer");
    const exportedLayout = JSON.parse(layoutBytes.toString("utf8")), active = profiles(saved).profiles.renpy;
    for (const field of ["renpy", "dialogueLayouts", "confirmationLayout", "screens"])
      assert.deepEqual(exportedLayout[field], active[field], `Cartridge lost authored ${field}`);
    const script = JSON.parse(await archive.file("script.json").async("string"));
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    assert.equal(script.characters.find(c => c.character_id === "alice").dialog_presentation, "bubble");
    assert.equal(script.default_dialog_presentation, "nvl");
    // Confirmation geometry is a later capability than dialogue inheritance.
    // An exact 0.18 assertion would wrongly reject the required newer minimum.
    assert.equal(manifest.runtime_version, "0.25.0", "Authored layout includes the Hide capability");
    report.layoutSha256 = A.sha256(layoutBytes);
    report.exported = { script, manifest };
    return { cartridgeArtifact: report.cartridgeArtifact, layoutSha256: report.layoutSha256 };
  });
  await stage("installed-player-consumes-authored-pages-modes-confirmation-matrix", async () => {
    const { cdp: session } = await openInstalledPlayer(report.cartridgeArtifact.path);
    await playerPage.getByTestId("game-state-title").waitFor(); await A.settleRuntime(playerPage);
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await metrics(playerPage, session, width, height, dpr, reduced);
      const row = { width, height, dpr, reduced, pages: [] }; report.currentPlayerMatrix = row;
      row.viewport = await readInstalledViewport(playerPage, { width, height, dpr, reduced });
      row.pages.push({ id: "title", actual: await assertMenu(playerPage, pages[0]) });
      await playerPage.getByTestId("open-settings").click();
      for (const entry of pages.slice(1)) {
        if (entry.id !== "preferences") await playerPage.getByTestId(`renpy-menu-${entry.action}`).click();
        row.pages.push({ id: entry.id, actual: await assertMenu(playerPage, entry) });
      }
      await playerPage.getByTestId("renpy-menu-return").click(); await A.settleRuntime(playerPage);
      await playerPage.getByTestId("open-exit-confirmation").click();
      const modal = playerPage.getByRole("dialog", { name: "退出游戏？", exact: true }); await modal.waitFor(); await A.settleRuntime(playerPage);
      row.confirmation = await modal.evaluate(n => {
        const r = n.getBoundingClientRect(), parent = n.parentElement.getBoundingClientRect();
        return { source: n.dataset.confirmationLayoutSource, color: getComputedStyle(n).backgroundColor,
          relative: [(r.x - parent.x) / parent.width * 100, (r.y - parent.y) / parent.height * 100, r.width / parent.width * 100, r.height / parent.height * 100],
          focus: n.contains(document.activeElement) };
      });
      assert.equal(row.confirmation.source, "override"); assert(row.confirmation.focus);
      for (const [index, expected] of [22, 26, 56, 48].entries()) assert(Math.abs(row.confirmation.relative[index] - expected) < .5);
      await modal.getByRole("button", { name: "关闭退出游戏？", exact: true }).click();
      await playerPage.getByTestId("start-new-game").click();
      await playerPage.locator('.dialog-box[data-dialogue-layout-mode="bubble"]').waitFor();
      await playerPage.waitForFunction(() => document.querySelector(".story-player")?.dataset.isTyping === "false");
      row.bubble = await assertMode(playerPage, "bubble"); assert.equal(row.bubble.anchor, "fixed");
      const quick = await playerPage.locator(".renpy-quick-bar").evaluate(n => ({
        rect: n.getBoundingClientRect().toJSON(), overflow: n.scrollWidth - n.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
        buttons: [...n.querySelectorAll("button")].map(b => { const r = b.getBoundingClientRect(); return {
          label: b.textContent.trim(), rect: r.toJSON(), clipped: b.scrollWidth > b.clientWidth + 1,
          hit: b.disabled || b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; }) }));
      assertRenpyQuickBarGeometry(quick, { width, height }); row.quick = quick;
      await playerPage.locator(".dialog-box").click();
      await playerPage.locator('.dialog-box[data-dialogue-layout-mode="nvl"]').waitFor();
      await playerPage.waitForFunction(() => document.querySelector(".story-player")?.dataset.isTyping === "false");
      row.nvl = await assertMode(playerPage, "nvl");
      assert(row.nvl.text.includes("作者工程继承NVL验证。"));
      await playerPage.locator(".dialog-box").click();
      await playerPage.waitForFunction(() => document.querySelector(".nvl-page.is-visible")?.textContent.includes("作者清页NVL验证。")
        || [...document.querySelectorAll(".nvl-page:not([aria-hidden='true'])")].some(n => n.textContent.includes("作者清页NVL验证。")));
      await playerPage.waitForFunction(() => document.querySelector(".story-player")?.dataset.isTyping === "false");
      const clearText = await playerPage.locator(".nvl-page:not([aria-hidden='true'])").innerText();
      assert(!clearText.includes("作者工程继承NVL验证。"), "Authored NVL clear must not retain old visible line");
      await playerPage.locator(".dialog-box").click();
      await playerPage.locator('.dialog-box[data-dialogue-layout-mode="dialog"]').waitFor();
      await playerPage.waitForFunction(() => document.querySelector(".story-player")?.dataset.isTyping === "false");
      await playerPage.locator(".dialog-box").click();
      await playerPage.locator(".choice-panel").waitFor();
      await clickable(playerPage.getByRole("button", { name: /选择：继续/ }).first());
      // A fresh native document is the next matrix entry's cold title baseline.
      // Menu-return behavior was asserted above; do not invent a title-return
      // button or call the Runtime store to reset the player between samples.
      await playerPage.reload({ waitUntil: "domcontentloaded" });
      await playerPage.getByTestId("game-state-title").waitFor();
      await A.settleRuntime(playerPage);
      report.playerMatrix.push(row); save();
      row.capture = await captureInstalledWebview(playerPage, session,
        path.join(out, `player-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`),
        { width, height, dpr, reduced });
      save();
      console.log(`PASS installed authored player ${width} DPR${dpr} ${reduced ? "reduced" : "normal"}`);
    }
    assert.equal(report.playerMatrix.length, 12);
  });
  assert.equal(report.cases.length, 7); assert.deepEqual(report.errors, []);
  assert(report.matrix.every(m => m.pages.length === 7) && report.playerMatrix.every(m => m.pages.length === 7));
  report.status = "PASS";
}
main().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  for (const [name, target] of [["editor", page], ["player", playerPage]]) if (target) {
    report[`${name}FailureText`] = (await target.locator("body").innerText().catch(() => "")).slice(-7000);
    report[`${name}FailureFrames`] = await Promise.all(target.frames().map(async frame => ({
      url: frame.url(), text: (await frame.locator("body").innerText().catch(() => "")).slice(-7000),
    })));
    await target.screenshot({ path: path.join(out, `${name}-failure.png`) }).catch(() => {});
  }
}).finally(async () => {
  await playerBrowser?.close().catch(() => {});
  if (player && player.exitCode === null) {
    const stopped = spawnSync("taskkill.exe", ["/PID", String(player.pid), "/T", "/F"], { windowsHide: true });
    report.playerCleanup = { exitCode: stopped.status }; if (stopped.status !== 0) report.status = "FAILED";
  }
  await browser?.close().catch(() => {});
  if (owner) report.cleanup.push(await owner.stop());
  if (report.cleanup.some(c => c.editor.exitCode !== 0 || c.backend.exitCode !== 0)) report.status = "FAILED";
  report.sourceUnchanged = (report.checkpoint || []).every(c => A.sha256(fs.readFileSync(path.join(root, c.relative))) === c.sha256);
  if (!report.sourceUnchanged) report.status = "FAILED";
  report.finishedAt = new Date().toISOString(); save();
  if (report.status !== "PASS") process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, authorMatrix: report.matrix.length,
    playerMatrix: report.playerMatrix.length, error: report.error, out }));
});
