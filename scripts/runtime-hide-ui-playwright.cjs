"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { createHash } = require("node:crypto"), { gzipSync } = require("node:zlib");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const JSZip = require("../editor/node_modules/jszip");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
const functionalOnly = process.argv.includes("--functional-only");
assert.match(attempt, /^(red|green|matrix|functional)-\d{2}$/);
const out = `F:/AgentVN/QA/Renpy-Redesign-20261021-01/hide-ui-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const mod = { exports: {} };
new Function("module", "exports", "require", buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";
export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";
export { exportEditorCartridge } from "./editor/src/cartridge/exportCartridge";` },
  bundle: true, platform: "node", packages: "external", format: "cjs", write: false }).outputFiles[0].text
)(mod, mod.exports, require("node:module").createRequire(path.join(root, "editor/package.json")));
const report = { status: "RUNNING", scope: "EXPORTED_CARTRIDGE_SOURCE_BROWSER_NOT_INSTALLED",
  layer: "GameCLI Runtime", startedAt: new Date().toISOString(), modelRequests: 0,
  acceptanceMode: functionalOnly ? "FUNCTIONAL_STATE_AND_INPUT" : "FULL_VISUAL_AND_FUNCTIONAL",
  motionFrameAssertions: functionalOnly ? "DEFERRED_OPTIONAL" : "ENABLED",
  pointerMode: process.argv.includes("--touch") ? "browser-touch-not-device" : "mouse",
  cases: [], artifacts: [] };
const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function sourceHash() {
  const h = createHash("sha256");
  for (const folder of ["GameCli_framework/src", "shared"])
    for (const name of fs.readdirSync(path.join(root, folder), { recursive: true }).sort())
      if (/\.(ts|tsx|css)$/.test(name)) h.update(folder + "/" + name).update(fs.readFileSync(path.join(root, folder, name)));
  return h.digest("hex");
}
let browser, server, page;
async function state(page) {
  return page.evaluate(async () => {
    const s = (await import("/src/store/runtimeStore.ts")).useRuntimeStore.getState();
    return { hidden: s.isUiHidden, screen: s.screen, index: s.engineState.currentCommandIndex,
      scene: s.engineState.currentSceneId, auto: s.engineState.isAutoMode, skip: s.engineState.isSkipMode,
      background: s.engineState.background,
      choices: s.engineState.choices.length, nvl: s.engineState.nvlPage.length,
      history: s.engineState.history.length, dialog: s.engineState.dialog?.text,
      preferences: (await import("/src/store/settingsStore.ts")).useSettingsStore.getState().settings };
  });
}
async function assertHiddenUi(page) {
  assert.equal(await page.locator("[data-testid='story-interface']").getAttribute("aria-hidden"), "true");
  const leak = await page.locator(".dialog-box,.choice-panel,.playback-controls,.runtime-custom-component")
    .evaluateAll(elements => elements.some(element => {
      let opacity = 1, blocked = false;
      for (let node = element; node; node = node.parentElement) {
        const s = getComputedStyle(node); opacity *= Number(s.opacity);
        blocked ||= node.inert || s.visibility === "hidden" || s.display === "none";
      }
      return opacity > .001 || !blocked;
    }));
  assert.equal(leak, false, "No native or custom story UI remains visible/interactive");
}
async function transition(page, action, hidden) {
  await page.evaluate(() => {
    const trace = { frames: [], done: false };
    window.__hideTrace = trace;
    const frame = at => {
      if (trace.done) return;
      const layer = document.querySelector("[data-testid='story-interface']");
      const r = layer?.getBoundingClientRect(), style = layer && getComputedStyle(layer);
      const focus = document.activeElement;
      trace.frames.push({ at, opacity: style ? Number(style.opacity) : null,
        inert: layer?.inert, rect: r?.toJSON(), sceneCount: document.querySelectorAll(".story-player").length,
        invalidFocus: Boolean(focus?.closest("[inert],[aria-hidden='true']")),
        overflow: document.documentElement.scrollWidth - innerWidth });
      if (trace.frames.length < 500) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await action();
  await page.waitForFunction(hidden => {
    const layer = document.querySelector("[data-testid='story-interface']");
    return layer && Number(getComputedStyle(layer).opacity) === (hidden ? 0 : 1) && layer.inert === hidden;
  }, hidden).catch(async error => {
    const frames = await page.evaluate(() => { window.__hideTrace.done = true; return window.__hideTrace.frames; });
    fs.writeFileSync(path.join(out, "failure-frames.json.gz"), gzipSync(JSON.stringify(frames)), { flag: "wx" });
    throw error;
  });
  const trace = await page.evaluate(() => { window.__hideTrace.done = true; return window.__hideTrace.frames; });
  if (!functionalOnly)
    assert(trace.filter(f => f.opacity > .001 && f.opacity < .999).length >= 2, "Continuous real opacity frames");
  assert(trace.every(f => f.sceneCount === 1 && f.overflow <= 1 && !f.invalidFocus),
    "Single scene, no unavailable focus or overflow during transition");
  return trace;
}
async function hideButton(page, layout) {
  if (layout === "agentvn") {
    const toggle = page.getByTestId("quick-menu-toggle");
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    await page.getByRole("button", { name: "隐藏界面", exact: true }).click();
  } else await page.getByTestId("renpy-quick-hide").click();
}
async function init(page, payload) {
  await page.goto(`${server.url}/?mode=preview`);
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
  await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
    sessionId: "hide-ui", revision: 1, requestId: "hide-ui", runId: "hide-ui",
    screen: "title_menu", ...payload }, "*"), payload);
  await page.getByTestId("start-new-game").waitFor(); await settleRuntime(page);
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor(); await settleRuntime(page);
  await page.waitForFunction(() => document.querySelector(".story-player")?.getAttribute("data-is-typing") === "false");
}
(async () => {
  report.sourceSHA256 = sourceHash(); persist();
  const variants = {};
  for (const layout of ["agentvn", "renpy"]) {
    const image = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#326b83"/></svg>';
    const assets = [["qa_background", "background"], ["qa_portrait", "portrait"]].map(([asset_id, asset_type]) => ({
      asset_id, asset_type, path: `assets/${asset_type}/${asset_id}.svg`, filename: `${asset_id}.svg`,
      mime_type: "image/svg+xml", size_bytes: Buffer.byteLength(image), preload: true,
    }));
    const skin = layout === "renpy" ? mod.exports.createRenpyUILayout() : mod.exports.getDefaultUISkinLayout();
    skin.screens.find(s => s.screen_id === "player").components.push({
      component_id: "qa_custom_player_button", component_type: "custom_component", visible: true,
      rect: { x: 75, y: 10, width: 20, height: 8 }, zIndex: 90,
      customComponent: { schemaVersion: 1, root: { tag: "div", className: "root", children: [
        { tag: "button", className: "button", action: "open_history", text: "测试自定义历史", children: [] },
      ] }, styles: { ".root": { color: "white" } } },
    });
    const script = { schema_version: "1.5.0", game_id: `hide-ui-${layout}`, title: "隐藏界面隔离小工程",
      entry_scene_id: "main", characters: [{ character_id: "speaker", name: "验收角色" }],
      scenes: [{ scene_id: "main", title: "普通/NVL/气泡/分支", chapter: 1, tags: [], commands: [
        { type: "background", background_id: "qa_background" },
        { type: "dialog", character_id: "speaker", portrait: "qa_portrait",
          text: "隐藏时画面保持显示，恢复这一次输入不能推进。" },
        { type: "dialog", character_id: "speaker", presentation_mode: "nvl", text: "NVL累积第一句。" },
        { type: "dialog", character_id: "speaker", presentation_mode: "nvl", text: "NVL累积第二句。" },
        { type: "dialog", character_id: "speaker", presentation_mode: "bubble", text: "气泡应一起隐藏，恢复仍为同一句。" },
        { type: "choice", choices: [{ choice_id: "branch", text: "保留当前分支", target_scene_id: "branch", conditions: [] }] },
      ] }, { scene_id: "branch", title: "分支结果", chapter: 1, tags: [], commands: [
        { type: "narration", text: "进入正确分支。" }, { type: "narration", text: "后续对白。" },
      ] }] };
    const exported = await mod.exports.exportEditorCartridge({ gameId: script.game_id, title: script.title,
      author: "QA", script, uiSkin: skin, projectAssets: assets, projectAssetRefs: assets.map(asset => ({
        asset_id: asset.asset_id, asset_type: asset.asset_type, metadata: { filename: asset.filename,
          mime_type: asset.mime_type, data_url: `data:image/svg+xml;base64,${Buffer.from(image).toString("base64")}` },
      })) });
    assert.deepEqual(exported.errors, []);
    const bytes = Buffer.from(await exported.blob.arrayBuffer()), file = path.join(out, `${layout}.vncart`);
    fs.writeFileSync(file, bytes, { flag: "wx" });
    const zip = await JSZip.loadAsync(bytes);
    const assetUrls = {};
    for (const asset of assets) {
      const bytes = await zip.file(asset.path).async("nodebuffer");
      assert.equal(bytes.toString(), image, "The actual exported bytes are used by the player");
      assetUrls[asset.asset_id] = `data:${asset.mime_type};base64,${bytes.toString("base64")}`;
    }
    variants[layout] = { manifest: JSON.parse(await zip.file("manifest.json").async("string")),
      script: JSON.parse(await zip.file("script.json").async("string")),
      uiSkin: JSON.parse(await zip.file("ui/layout.json").async("string")), assetUrls };
    assert.equal(variants[layout].manifest.runtime_version, "0.25.0");
    report.artifacts.push({ layout, path: file, sha256: sha(bytes), bytes: bytes.length,
      generatedAt: fs.statSync(file).mtime.toISOString() });
  }
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
    configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(out, "runtime.log") });
  report.service = { pid: server.pid, runId: server.runId, url: server.url }; persist();
  browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
  const matrix = process.argv.includes("--matrix")
    ? [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
      [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))))
    : [{ width: 1920, height: 1080, dpr: 1, reduced: false }];
  const layouts = process.argv.includes("--agentvn-only") ? ["agentvn"] : ["renpy", "agentvn"];
  for (const m of matrix) for (const layout of layouts) {
    const context = await browser.newContext({ viewport: { width: m.width, height: m.height },
      deviceScaleFactor: m.dpr, hasTouch: process.argv.includes("--touch"),
      reducedMotion: m.reduced ? "reduce" : "no-preference" });
    page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.addInitScript(() => {
      window.__hideFocusTrace = [];
      for (const type of ["focusin", "focusout"]) document.addEventListener(type, event => {
        window.__hideFocusTrace.push({ type, at: performance.now(),
          target: event.target?.getAttribute?.("data-testid") ?? event.target?.getAttribute?.("aria-label"),
          inert: Boolean(event.target?.closest?.("[inert]")) });
      }, true);
    });
    const errors = []; page.on("pageerror", error => errors.push(String(error)));
    await server.run(async () => {
      await init(page, variants[layout]);
      if (layout === "renpy") {
        const buttons = await page.locator(".renpy-quick-bar button").evaluateAll(buttons => buttons.map(button => {
          const r = button.getBoundingClientRect();
          return { text: button.textContent, ...r.toJSON(),
            hit: button.disabled || button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
        }));
        assert.equal(buttons.length, 9, "Ren’Py retains eight actions and adds Hide");
        assert(buttons.every(b => Math.abs(b.top - buttons[0].top) < 1 && b.left >= 0 && b.right <= m.width
          && b.bottom <= m.height && b.hit), "All nine actions remain in one row and have independent hit areas");
      }
      const before = await state(page);
      assert.equal(before.background, "qa_background");
      await page.waitForFunction(() => document.querySelector(".dialog-portrait")?.getAttribute("data-portrait-ready") === "true");
      const traces = [];
      traces.push(...await transition(page, () => hideButton(page, layout), true));
      const hidden = await state(page);
      assert(hidden.hidden);
      await assertHiddenUi(page);
      assert.equal(hidden.index, before.index);
      assert.equal(hidden.background, before.background, "Scene stays visible and unchanged");
      await page.screenshot({ path: path.join(out, `${layout}-${m.width}-${m.dpr}-${m.reduced}-hidden.png`) });
      assert.deepEqual(hidden.preferences, before.preferences);
      traces.push(...await transition(page, () => process.argv.includes("--touch")
        ? page.touchscreen.tap(m.width / 2, m.height / 3)
        : page.mouse.click(m.width / 2, m.height / 3), false));
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")
        ?? document.activeElement?.getAttribute("aria-label")),
      layout === "renpy" ? "renpy-quick-hide" : "隐藏界面",
      "Restoring returns focus to the original Hide action");
      const restored = await state(page);
      assert.equal(restored.index, before.index, "Restore pointer must not also advance");
      assert.equal(restored.dialog, before.dialog);
      assert.deepEqual(restored.preferences, before.preferences);
      for (const key of ["h", "Escape", "system-back"]) {
        traces.push(...await transition(page, () => page.keyboard.press("h"), true));
        traces.push(...await transition(page, () => key === "system-back"
          ? page.evaluate(() => window.dispatchEvent(new Event("agentvn:system-back", { cancelable: true })))
          : page.keyboard.press(key), false));
        const afterKey = await state(page);
        assert.equal(afterKey.screen, "playing", `${key} restores, without opening a menu`);
        assert.equal(afterKey.index, before.index, `${key} restores, without advancing`);
      }
      traces.push(...await transition(page, async () => {
        await page.keyboard.press("h");
        await page.waitForFunction(() => {
          const opacity = Number(getComputedStyle(document.querySelector("[data-testid='story-interface']")).opacity);
          return opacity > .05 && opacity < .95;
        });
        await page.keyboard.press("h");
      }, false));
      assert.equal((await state(page)).index, before.index, "Mid-fade reversal keeps the same story position");
      // Controlled same-tick timing: arm both modes before hiding, so no
      // Playwright round-trip can advance the story before the hidden state.
      await page.evaluate(async () => {
        const r = (await import("/src/store/runtimeStore.ts")).useRuntimeStore.getState();
        const settings = (await import("/src/store/settingsStore.ts")).useSettingsStore.getState();
        settings.updateSettings({ autoForwardTime: 0.1, skipUnread: true });
        r.toggleAuto(); r.toggleSkip(); r.setUiHidden(true);
      });
      const pausedAt = await state(page);
      await page.waitForTimeout(650); // Negative assertion beyond both 60ms skip and >=300ms auto timers.
      const pausedAfter = await state(page);
      assert(pausedAfter.hidden && pausedAfter.index === pausedAt.index && pausedAfter.scene === pausedAt.scene,
        "Hidden UI must suspend auto/skip advancement");
      await page.keyboard.press("h");
      const resumed = await state(page);
      assert(resumed.auto && resumed.skip, "Restoring returns both original modes");
      await page.evaluate(async () => {
        const r = (await import("/src/store/runtimeStore.ts")).useRuntimeStore.getState();
        r.toggleAuto(); r.disableSkip();
      });
      // Actual scene input through NVL accumulation, bubble and an active choice.
      for (const mode of ["nvl", "nvl", "bubble", "choice"]) {
        const prior = await state(page);
        await page.waitForFunction(() => document.querySelector(".story-player")?.getAttribute("data-is-typing") === "false");
        await page.locator(".dialog-box").click();
        await page.waitForFunction(index => Number(document.querySelector(".story-player")?.getAttribute("data-current-command-index")) === index + 1, prior.index);
        await page.waitForFunction(() => document.querySelector(".story-player")?.getAttribute("data-is-typing") === "false");
        const atMode = await state(page);
        if (mode === "choice") assert.equal(atMode.choices, 1);
        else assert.equal(await page.locator(".dialog-box").getAttribute("data-dialogue-layout-mode"), mode);
        traces.push(...await transition(page, () => page.keyboard.press("h"), true));
        await assertHiddenUi(page);
        traces.push(...await transition(page, () => page.keyboard.press("Escape"), false));
        const afterMode = await state(page);
        assert.equal(afterMode.index, atMode.index);
        assert.equal(afterMode.nvl, atMode.nvl, "NVL accumulation is retained without re-adding a sentence");
        assert.equal(afterMode.history, atMode.history);
        assert.equal(afterMode.choices, atMode.choices);
      }
      await page.getByRole("button", { name: "选择：保留当前分支", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".story-player")?.getAttribute("data-current-scene-id") === "branch");
      await page.waitForFunction(() => document.querySelector(".story-player")?.getAttribute("data-is-typing") === "false");
      traces.push(...await transition(page, () => page.keyboard.press("h"), true));
      const atModal = await state(page);
      for (const dismiss of ["Escape", "system-back"]) {
        // Controlled native-close equivalent while the story UI is hidden.
        await page.evaluate(async () => (await import("/src/store/runtimeStore.ts")).useRuntimeStore.getState().openExitConfirmation());
        await page.locator("[data-runtime-modal='true']").waitFor();
        if (dismiss === "Escape") await page.keyboard.press("Escape");
        else await page.evaluate(() => window.dispatchEvent(new Event("agentvn:system-back", { cancelable: true })));
        await page.locator("[data-runtime-modal='true']").waitFor({ state: "detached" });
        const after = await state(page);
        assert(after.hidden && after.index === atModal.index, "The top modal consumes Back before hidden UI");
      }
      const saved = await page.evaluate(async () => {
        const r = (await import("/src/store/runtimeStore.ts")).useRuntimeStore;
        await r.getState().quickSave();
        return r.getState().saves.find(s => s.save_kind === "quick");
      });
      assert(saved && !JSON.stringify(saved).includes("isUiHidden"), "Hidden state never enters a real save snapshot");
      await page.evaluate(async slot => (await import("/src/store/runtimeStore.ts")).useRuntimeStore.getState()
        .load({ kind: "quick", slot }), saved.slot);
      await settleRuntime(page);
      const afterLoad = await state(page);
      assert(!afterLoad.hidden && afterLoad.scene === atModal.scene && afterLoad.index === atModal.index,
        "Loading a hidden-time snapshot restores visible UI at the same story position");
      traces.push(...await transition(page, () => page.keyboard.press("h"), true));
      await init(page, variants[layout]);
      assert(!(await state(page)).hidden, "Restart/reopen never restores the temporary hidden state");
      const artifact = `${layout}-${m.width}-${m.dpr}-${m.reduced}`;
      fs.writeFileSync(path.join(out, `${artifact}-frames.json.gz`), gzipSync(JSON.stringify(traces)), { flag: "wx" });
      const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
        dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      assert.deepEqual(actual, m);
      const png = await page.screenshot({ path: path.join(out, `${artifact}.png`) });
      assert.equal(png.readUInt32BE(16), m.width * m.dpr); assert.equal(png.readUInt32BE(20), m.height * m.dpr);
      assert.deepEqual(errors, []);
      report.cases.push({ ...m, layout, status: "PASS", frames: traces.length }); persist();
    });
    await context.close(); page = undefined;
  }
  assert.equal(report.cases.length, matrix.length * layouts.length);
  assert.equal(sourceHash(), report.sourceSHA256);
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  report.focusTrace = await page?.evaluate(() => window.__hideFocusTrace).catch(() => null);
  await page?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
}).finally(async () => {
  await browser?.close(); await server?.stop();
  report.cleanup = "PASS";
  if (server) try { await fetch(server.url, { signal: AbortSignal.timeout(700) }); report.cleanup = "FAILED"; } catch {}
  if (report.cleanup !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); persist();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, out }));
});
