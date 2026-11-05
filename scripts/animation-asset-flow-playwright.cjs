"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, "..");
const output = path.resolve(process.argv[2] || "");
assert(process.argv[2] && output.startsWith(path.resolve("F:/AgentVN/QA") + path.sep));
assert(!fs.existsSync(output), "Preserve all previous evidence.");
fs.mkdirSync(output, { recursive: true });
const baseline = process.argv.includes("--baseline");
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const preset = duration => JSON.stringify({
  schema_version: "1.0.0", preset_id: "qa_native", name: "受控原生动画",
  target_type: "screen", duration_ms: duration, easing: "linear", loop: false, direction: "normal",
  keyframes: [{ offset: 0, x: 0 }, { offset: 0.5, x: duration === 731 ? 51 : -83 }, { offset: 1, x: 0 }],
});
const original = preset(731), replacement = preset(947);
const project = fixture(`animation-flow-${Date.now()}`);
project.title = "动画素材功能隔离工程";
project.nodes[1].data.scene.commands = [
  { type: "narration", text: "点击播放文件动画。" },
  { type: "animation", animation_id: "custom", target: "screen", params: {}, blocking: true },
  { type: "narration", text: "文件动画已完成。" },
];
const input = path.join(output, "isolated.vnproj");
fs.writeFileSync(input, JSON.stringify(project));
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(output, "services");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "SOURCE_BROWSER_REAL_EDITOR_AND_RUNTIME_WITH_CONTROLLED_NATIVE_ASSETS",
  limits: ["No installed Editor, native Player, Android or model calls.", "Browser viewport emulation, not physical 4K."],
  cases: [], errors: [], cleanup: {} };
const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
async function check(id, context, fn) {
  const item = { id, ...context, status: "RUNNING" }; report.cases.push(item); persist();
  try { Object.assign(item, await fn()); item.status = "PASS"; }
  catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); throw error; }
  finally { persist(); }
}
async function idle(page) {
  await page.waitForFunction(() => {
    const panel = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
    return !document.querySelector(".app-transition-stage.is-switching")
      && !panel?.classList.contains("is-morphing")
      && (!panel || panel.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle"));
  });
}
async function openLibrary(page) {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.library"]:visible').click();
  await idle(page);
}
async function selectScene(page) {
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await idle(page);
  await page.locator('.react-flow__node[data-id="scene"]').click({ position: { x: 44, y: 34 } });
  await page.locator('.command-card[data-command-index="1"]').waitFor();
}
async function openCommand(page) {
  const card = page.locator('.command-card[data-command-index="1"]');
  if (!await card.locator(".command-card-body").isVisible())
    await card.locator('[data-help-key="command.expand"]').click();
  await card.locator(".command-card-body").waitFor();
  return card;
}
async function choose(page, container, id) {
  await container.locator('[data-help-key="command.animation.animationId.openPicker"]').click();
  await page.locator(`.asset-picker-card-main[data-asset-id="${id}"]`).click();
  await page.waitForFunction(() => window.__AGENTVN_EDITOR_STORE__.getState().nodes
    .find(n => n.id === "scene").data.scene.commands[1].animation_asset_id !== undefined);
}
async function graph(page) {
  return page.evaluate(() => window.__AGENTVN_EDITOR_STORE__.getState().nodes
    .find(n => n.id === "scene").data.scene.commands);
}
async function save(page, name) {
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await idle(page);
  const pending = page.waitForEvent("download");
  await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
  const download = await pending, target = path.join(output, name);
  await download.saveAs(target);
  await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
  return target;
}
async function exportCartridge(page, name) {
  // Controlled export invocation; actual authored store, exporter, packer and bytes.
  const data = await page.evaluate(async () => {
    const { exportScript, applyProjectRuntimeSettingsToScript } = await import("/src/utils/exportScript.ts");
    const { exportEditorCartridge } = await import("/src/cartridge/exportCartridge.ts");
    const { manifestAssetsFromProjectAssets } = await import("/src/utils/projectAssets.ts");
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), e = window.__AGENTVN_EDITOR_STORE__.getState();
    const result = await exportEditorCartridge({
      script: applyProjectRuntimeSettingsToScript(exportScript(e.nodes, e.edges), p.settings),
      gameId: p.projectId, title: p.title, author: "QA", version: "1.0.0",
      language: "zh-CN", description: "", includeGallery: false, includeMetadata: false,
      projectAssetRefs: p.assetManifest,
      projectAssets: manifestAssetsFromProjectAssets(p.assetManifest),
    });
    if (result.errors.length) throw new Error(result.errors.join("\n"));
    return { bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())), manifest: result.manifest };
  });
  const file = path.join(output, name), bytes = Buffer.from(data.bytes);
  fs.writeFileSync(file, bytes);
  const zip = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
  const command = script.scenes[0].commands.find(c => c.type === "animation");
  assert(command.animation_asset_id); assert.deepEqual(command.params, {});
  assert.equal(manifest.runtime_version, "0.28.0");
  const asset = manifest.assets.find(a => a.asset_id === command.animation_asset_id);
  assert(asset && await zip.file(asset.path).async("string") === replacement);
  return { file, bytes: data.bytes, sha256: hash(bytes), manifest };
}
async function screenshot(page, file, context) {
  const before = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, overflow: document.documentElement.scrollWidth - innerWidth }));
  assert.deepEqual([before.width, before.height, before.dpr, before.reduced],
    [context.width, context.height, context.dpr, context.reduced]);
  assert(before.overflow <= 1);
  const png = await page.screenshot({ path: file, scale: "device" });
  assert.equal(png.readUInt32BE(16), context.width * context.dpr);
  assert.equal(png.readUInt32BE(20), context.height * context.dpr);
  assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]),
    [before.width, before.height, before.dpr]);
  return { file, sha256: hash(png), ...before };
}
async function editorFlow(page, env) {
  await env.open(page); await openLibrary(page);
  const fileInput = page.locator('.asset-library-panel input[type="file"][multiple]');
  await check("INVALID_IMPORT_NO_MUTATION", {}, async () => {
    await fileInput.setInputFiles({ name: "非法动画.json", mimeType: "application/json", buffer: Buffer.from('{"layers":[]}') });
    await page.locator(".asset-library-panel [role=alert]").filter({ hasText: /不支持|keyframes|duration_ms/ }).waitFor();
    assert.equal(await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().assetManifest.length), 0);
  });
  let assetId;
  await check("IMPORT_SELECT_REAL_COMMAND", {}, async () => {
    await fileInput.setInputFiles({ name: "原生动画.json", mimeType: "application/json", buffer: Buffer.from(original) });
    await page.locator('[data-help-key="asset.confirmImport"]').click();
    await page.waitForFunction(() => window.__AGENTVN_PROJECT_STORE__.getState().assetManifest.length === 1);
    assetId = await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().assetManifest[0].asset_id);
    await selectScene(page); const card = await openCommand(page); await choose(page, card, assetId);
    const commands = await graph(page);
    assert.equal(commands[1].animation_asset_id, assetId); assert.deepEqual(commands[1].params, {});
    return { assetId };
  });
  await check("WORKBENCH_CREATES_REFERENCE_WITHOUT_INLINE_OVERRIDE", {}, async () => {
    if (!await page.locator(".floating-command-workbench").isVisible())
      await page.locator('.command-workbench-launcher [data-help-key="workbench.commandType"]').click();
    const workbench = page.locator(".floating-command-workbench");
    await workbench.locator('[data-help-key="workbench.commandType"]').filter({ hasText: "演出动画" }).click();
    await workbench.locator('[data-help-key="command.animation.animationId.openPicker"]').waitFor();
    await workbench.locator('[data-help-key="command.animation.target"]').fill("screen");
    await workbench.locator('[data-help-key="command.animation.animationId.openPicker"]').click();
    await page.locator(`.asset-picker-card-main[data-asset-id="${assetId}"]`).click();
    await page.waitForFunction(() => !document.querySelector(".floating-command-workbench [role=status]"));
    await workbench.getByTestId("workbench-add-command").click();
    const commands = await graph(page), last = commands.at(-1);
    assert.equal(last.type, "animation"); assert.equal(last.animation_asset_id, assetId);
    assert.deepEqual(last.params, {});
    await workbench.getByRole("button", { name: "关闭事件工作台", exact: true }).click();
  });
  await check("REPLACE_CANCEL_INVALID_AND_LATEST_BYTES", {}, async () => {
    await openLibrary(page);
    const card = page.locator(`.asset-library-card[data-asset-id="${assetId}"]`);
    const replace = async text => {
      await card.locator('[data-help-key="asset.card.menu"]').click();
      await card.getByRole("menuitem", { name: "替换文件", exact: true }).click();
      await page.locator('[data-help-key="asset.replace.file"]').setInputFiles({
        name: "替换动画.json", mimeType: "application/json", buffer: Buffer.from(text),
      });
    };
    await replace(replacement);
    await page.getByRole("dialog", { name: "确认替换素材" }).getByRole("button", { name: "取消", exact: true }).click();
    await replace('{"duration_ms":947,"keyframes":[]}');
    await page.locator(".asset-library-panel [role=alert]").filter({ hasText: /原素材未改变|keyframes/ }).waitFor();
    await replace(replacement);
    await page.getByRole("dialog", { name: "确认替换素材" }).getByRole("button", { name: "确认替换", exact: true }).click();
    const asset = await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().assetManifest[0]);
    assert.equal(asset.asset_id, assetId);
    assert.equal(Buffer.from(asset.metadata.data_url.split(",")[1], "base64").toString(), replacement);
    assert.equal((await graph(page))[1].animation_asset_id, assetId);
  });
  await check("PORTABLE_SAVE_HOME_REOPEN_AND_EXPORT", {}, async () => {
    const saved = await save(page, "saved.vnproj"), zip = await JSZip.loadAsync(fs.readFileSync(saved));
    const p = JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(p.nodes.find(n => n.id === "scene").data.scene.commands[1].animation_asset_id, assetId);
    assert.equal(await zip.file(p.asset_manifest[0].metadata.project_path).async("string"), replacement);
    await page.getByRole("button", { name: "返回首页", exact: true }).click(); await idle(page);
    await page.locator(".project-import-button input").first().setInputFiles(saved);
    await page.locator(".editor-toolbar").waitFor(); await idle(page);
    await selectScene(page); const card = await openCommand(page);
    assert((await card.innerText()).includes("替换动画.json"));
    const cartridge = await exportCartridge(page, "native-animation.vncart");
    report.cartridge = cartridge; delete report.cartridge.bytes;
    return { project: saved, cartridge: cartridge.file, cartridgeSha256: cartridge.sha256 };
  });
}
async function runtimeFlow(page, runtime, context) {
  await page.addInitScript(() => {
    const originalAnimate = Element.prototype.animate;
    window.__qaAnimationCalls = [];
    Element.prototype.animate = function (frames, options) {
      const animation = originalAnimate.call(this, frames, options);
      window.__qaAnimationCalls.push({ frames: animation.effect.getKeyframes(), options: animation.effect.getTiming(),
        target: this.className, time: performance.now() });
      return animation;
    };
  });
  await page.goto(`${runtime.url}/?mode=preview`, { waitUntil: "domcontentloaded" });
  const bytes = Array.from(fs.readFileSync(report.cartridge.file));
  await page.evaluate(async bytes => {
    const { loadGameFromArrayBuffer } = await import("/src/cartridge/desktopLibrary.ts");
    const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
    window.__qaStore = useRuntimeStore;
    const game = await loadGameFromArrayBuffer(new Uint8Array(bytes).buffer, { installId: "isolated-native-animation-qa" });
    window.__qaGame = game;
    window.postMessage({
      type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "native-animation-qa",
      revision: 1, requestId: "init", runId: "run1",
      manifest: game.manifest, script: game.script, assetUrls: game.assetUrls,
      start: { requestId: "start", target: { sceneId: game.script.entry_scene_id, commandIndex: 0 },
        entryPath: [], mode: "play_target_event", playbackRate: 1 },
    }, location.origin);
  }, bytes);
  await page.waitForFunction(() => window.__qaStore?.getState().screen === "playing"
    && window.__qaStore?.getState().engineState.dialog?.text === "点击播放文件动画。");
  const player = page.locator(".story-player");
  await player.waitFor();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !window.__qaStore.getState().engineState.typing);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__AGENTVN_RUNTIME_ANIMATION_LOG__?.some(e =>
    e.animation_id === window.__qaGame.script.scenes[0].commands[1].animation_id
      && (e.event === "animate-start" || e.event === "skipped")));
  const actual = await page.evaluate(() => ({
    calls: window.__qaAnimationCalls.filter(c => c.options.duration === 947),
    probes: window.__AGENTVN_RUNTIME_ANIMATION_LOG__,
    params: window.__qaStore.getState().currentGame.script.scenes[0].commands[1].params,
  }));
  assert.equal(actual.params.duration, 947);
  assert.equal(actual.params.keyframes[1].x, -83);
  if (context.reduced) assert(actual.probes.some(e => e.details?.reason === "prefers-reduced-motion"));
  else {
    assert.equal(actual.calls.length, 1);
    assert(actual.calls[0].frames.some(frame => frame.transform.includes("-83px")));
    assert(!actual.calls[0].frames.some(frame => frame.transform.includes("51px")));
  }
  await page.waitForFunction(() => window.__qaStore.getState().engineState.dialog?.text === "文件动画已完成。");
  const box = await player.boundingBox();
  assert(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= context.width + 1
    && box.y + box.height <= context.height + 1);
  const png = await screenshot(page, path.join(output,
    `runtime-${context.width}-${context.dpr}-${context.reduced}.png`), context);
  return { actual, player: box, screenshot: png };
}
async function editorViewportFlow(page, editor, context) {
  await page.goto(editor.url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some(n => !n.disabled));
  await page.locator(".project-import-button input").first().setInputFiles(path.join(output, "saved.vnproj"));
  await page.locator(".editor-toolbar").waitFor();
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
  await idle(page); await selectScene(page);
  const card = await openCommand(page);
  const id = (await graph(page))[1].animation_asset_id;
  await choose(page, card, id);
  const button = card.locator('[data-help-key="command.animation.animationId.openPicker"]');
  await button.scrollIntoViewIfNeeded();
  const geometry = await button.evaluate(node => {
    const r = node.getBoundingClientRect();
    return { rect: r.toJSON(), hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      inert: Boolean(node.closest("[inert]")), overflow: node.scrollWidth - node.clientWidth };
  });
  assert(geometry.hit && !geometry.inert && geometry.rect.x >= 0
    && geometry.rect.right <= context.width + 1 && geometry.rect.bottom <= context.height + 1);
  assert(geometry.overflow <= 1);
  await button.focus(); assert(await button.evaluate(node => document.activeElement === node));
  const png = await screenshot(page, path.join(output,
    `editor-${context.width}-${context.dpr}-${context.reduced}.png`), context);
  return { geometry, screenshot: png, selectedAsset: id };
}
async function loadRaces(page) {
  return page.evaluate(async () => {
    const store = window.__qaStore, original = window.__qaGame;
    const asset = original.manifest.assets.find(a => a.asset_type === "animation");
    const realFetch = window.fetch, pending = new Map();
    window.fetch = function (url, ...rest) {
      if (typeof url === "string" && url.startsWith("https://animation-qa.invalid/"))
        return new Promise((resolve, reject) => pending.set(url, { resolve, reject }));
      return realFetch.call(this, url, ...rest);
    };
    const clone = id => ({ ...original, game_id: id, install_id: id });
    const delayed = (id, url) => {
      const game = clone(id); game.assetUrls = { ...original.assetUrls, [asset.asset_id]: url }; return game;
    };
    try {
      const oldA = store.getState().loadLivePreview(delayed("A", "https://animation-qa.invalid/old-a"));
      await store.getState().loadLivePreview(clone("B"));
      await store.getState().loadLivePreview(clone("A"));
      pending.get("https://animation-qa.invalid/old-a").reject(new Error("受控迟到失败"));
      await oldA;
      if (store.getState().currentGame.game_id !== "A") throw new Error("Stale failure changed owner");
      const oldB = store.getState().loadGame(delayed("old-B", "https://animation-qa.invalid/old-b"));
      await store.getState().loadGame(clone("current-C"));
      const text = await (await realFetch(original.assetUrls[asset.asset_id])).text();
      pending.get("https://animation-qa.invalid/old-b").resolve(new Response(text));
      await oldB;
      if (store.getState().currentGame.game_id !== "current-C") throw new Error("Stale success changed owner");
      const before = store.getState().currentGame;
      const bad = delayed("invalid", "data:application/json,%7B%7D");
      let message;
      try { await store.getState().loadLivePreview(bad); }
      catch (error) { message = String(error); }
      if (!message?.includes("duration_ms") || store.getState().currentGame !== before)
        throw new Error("Invalid animation must fail before changing current game");
      return { staleFailure: true, staleSuccess: true, invalidLoadPreservesGame: true, message };
    } finally { window.fetch = realFetch; }
  });
}
(async () => {
  let editor, runtime, browser, current;
  try {
    editor = await startEditorAcceptance(undefined, { isolateBackendWorkingDirectory: true });
    runtime = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(output, "runtime.log") });
    report.owner = { editor: { url: editor.url, pid: editor.server.pid }, backendPid: editor.backendPid,
      runtime: { url: runtime.url, pid: runtime.pid } };
    browser = await chromium.launch();
    current = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await editor.server.run(() => editorFlow(current, editor));
    await current.close();
    const contexts = [];
    for (const [width, height] of baseline ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of baseline ? [1] : [1, 2]) for (const reduced of baseline ? [false] : [false, true])
        contexts.push({ width, height, dpr, reduced });
    for (const context of contexts) {
      current = await browser.newPage({ viewport: { width: context.width, height: context.height },
        deviceScaleFactor: context.dpr, reducedMotion: context.reduced ? "reduce" : "no-preference" });
      current.on("pageerror", error => report.errors.push({ ...context, error: String(error) }));
      await check("EDITOR_SELECTION_GEOMETRY_AND_FOCUS", context,
        () => editor.server.run(() => editorViewportFlow(current, editor, context)));
      await current.close();
      current = await browser.newPage({ viewport: { width: context.width, height: context.height },
        deviceScaleFactor: context.dpr, reducedMotion: context.reduced ? "reduce" : "no-preference" });
      current.on("pageerror", error => report.errors.push({ ...context, error: String(error) }));
      await check("RUNTIME_FILE_PLAYBACK_AND_INPUT", context,
        () => runtime.run(() => runtimeFlow(current, runtime, context)));
      if (context === contexts[0]) await check("LOAD_OWNER_AND_INVALID_FILE", {}, () => loadRaces(current));
      await current.close(); current = undefined;
    }
    assert.equal(report.cases.length, baseline ? 8 : 30);
    assert.equal(report.errors.length, 0);
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
    if (current && !current.isClosed()) {
      report.failureText = await current.locator("body").innerText().catch(() => "");
      await current.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    }
  } finally {
    await browser?.close(); await editor?.stop(); await runtime?.stop();
    report.cleanup = { browserClosed: true, ownedServicesStopped: true };
    report.finishedAt = new Date().toISOString(); persist();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output }));
  }
})();
