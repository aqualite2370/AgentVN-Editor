"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), req = createRequire(path.join(root, "editor/package.json"));
const attempt = process.argv[2]; assert.match(attempt, /^(?:red|green|matrix)-\d{2}$/);
const out = `F:/AgentVN/QA/Renpy-Redesign-20261021-01/runtime-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const mod = { exports: {} };
new Function("module", "exports", "require", req("esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles";
    export {exportEditorCartridge} from "./editor/src/cartridge/exportCartridge";` },
  bundle: true, platform: "node", packages: "external", format: "cjs", write: false,
}).outputFiles[0].text)(mod, mod.exports, req);
const report = { status: "RUNNING", scope: "EXPORTED_ZIP_SOURCE_RUNTIME_BROWSER_NOT_INSTALLED",
  startedAt: new Date().toISOString(), artifacts: [], cases: [], modelRequests: 0 };
const sourceHash = () => {
  const hash = createHash("sha256");
  for (const folder of ["GameCli_framework/src", "shared"]) for (const name of fs.readdirSync(path.join(root, folder), { recursive: true }).sort())
    if (/\.(?:ts|tsx|css)$/.test(name)) hash.update(folder + "/" + name).update(fs.readFileSync(path.join(root, folder, name)));
  return hash.digest("hex");
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let server, browser, page;
(async () => {
  report.sourceSHA256 = sourceHash(); save(); const api = mod.exports;
  const skin = api.createRenpyUILayout(); skin.advancedPresentationEnabled = true;
  const start = skin.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === "title_start_button");
  if (process.argv.includes("--title-controls")) for (const id of ["title_help_button", "title_exit_button"]) {
    const control = skin.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === id);
    assert(control, `Visible title control missing: ${id}`);
    control.presentation = { version: 1, html: '<span class="root"><slot name="content"></slot></span>',
      css: ".root { color: #aaffdd; }" };
  }
  start.stateStyles = { normal: { opacity: 0.83 }, hover: { color: "#aaffcc" } };
  start.presentation = { version: 1,
    html: '<span class="root"><img class="icon" data-asset="code_icon"/><span class="body"><slot name="content"></slot></span></span>',
    css: ".root { background-color: #742b59; border-radius: 6px; } .icon { width: 20px; height: 20px; } .body { color: white; }" };
  const about = skin.screens.find(s => s.screen_id === "about").components.find(c => c.component_type === "about_panel");
  about.presentation = { version: 1, html: '<div class="root"><slot name="content"></slot></div>',
    css: ".root { color: #44ddcc; }" };
  if (process.argv.includes("--decorations")) {
    for (const screenId of ["title", "about"]) {
      skin.screens.find(s => s.screen_id === screenId).components.push({
        component_id: `qa_${screenId}_mask`, component_type: "mask", visible: true,
        rect: { x: 90, y: 1, width: 4, height: 3 }, style: { maskMode: "blur", backdropBlur: 0 },
        presentation: { version: 1, html: '<span class="root"><slot name="content"></slot></span>',
          css: ".root { background-color: #665544; }" },
      });
    }
    skin.screens.find(s => s.screen_id === "about").components.push({
      component_id: "qa_component", component_type: "custom_component", visible: true,
      rect: { x: 65, y: 80, width: 20, height: 8 }, zIndex: 80,
      customComponent: { schemaVersion: 1, root: { tag: "div", className: "root",
        children: [{ tag: "button", className: "button", action: "open_help", text: "组件帮助入口", children: [] }] },
        styles: { ".root": { color: "white" } } },
      presentation: { version: 1, html: '<span class="root"><span class="body"><slot name="content"></slot></span></span>',
        css: ".root { border-radius: 11px; }" },
    });
  }
  const playerControls = skin.screens.find(s => s.screen_id === "player").components;
  if (process.argv.includes("--stage")) {
    const stage = playerControls.find(c => c.component_type === "stage_background");
    stage.style = { ...stage.style, backgroundColor: "#314573", borderRadius: 5 };
    stage.presentation = { version: 1, html: '<div class="root"><slot name="content"></slot></div>',
      css: ".root { border-radius: 9px; }" };
  }
  playerControls.find(c => c.component_type === "quick_menu").style.backgroundColor = "#215779";
  playerControls.find(c => c.component_id === "quick_auto_button").presentation = {
    version: 1, html: '<span class="root"><slot name="content"></slot></span>',
    css: ".root { background-color: #4c3258; border-radius: 4px; }",
  };
  if (process.argv.includes("--choices")) {
    const choice = playerControls.find(c => c.component_type === "choice_option");
    choice.stateStyles = { hover: { color: "#aaffcc" } };
    choice.presentation = { version: 1, html: '<span class="root"><span class="body"><slot name="content"></slot></span></span>',
      css: ".root { color: #77ffcc; border-radius: 7px; }" };
  }
  if (process.argv.includes("--regions")) {
    const panelSource = { version: 1, html: '<div class="root"><span class="body"><slot name="content"></slot></span></div>',
      css: ".root { border-color: #44ddcc; } .body { display: flex; flex-direction: column; flex: 1; min-height: 0; }" };
    const textSource = { version: 1, html: '<span class="root"><span class="body"><slot name="content"></slot></span></span>',
      css: ".root { color: #88ffcc; } .body { color: #88ffcc; }" };
    skin.confirmationLayout = { panelPresentation: { ...panelSource, css: ".root { background-color: #243951; }" },
      titlePresentation: textSource };
    skin.dialogueLayouts = { nvl: { panelPresentation: panelSource, textPresentation: textSource },
      bubble: { panelPresentation: panelSource, textPresentation: textSource } };
    playerControls.find(c => c.component_type === "dialog_panel").presentation = panelSource;
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#77bbff"/></svg>';
  const asset = { asset_id: "code_icon", asset_type: "ui", path: "assets/ui/code_icon.svg",
    filename: "图标.svg", mime_type: "image/svg+xml", size_bytes: Buffer.byteLength(svg), preload: false };
  const script = { schema_version: "1.1.0", game_id: `control-presentation-${attempt}`, title: "安全控件代码验收",
    entry_scene_id: "main", characters: [{ character_id: "qa_speaker", name: "验收角色" }],
    scenes: [{ scene_id: "main", title: "测试场景", chapter: 1, tags: [],
      commands: [{ type: "narration", text: "验证原生按钮动作没有被代码覆盖破坏。" },
        ...(process.argv.includes("--regions") ? [
          { type: "dialog", character_id: "qa_speaker", presentation_mode: "nvl", text: "NVL代码覆盖：第一句，确认累积文字能够显示。" },
          { type: "dialog", character_id: "qa_speaker", presentation_mode: "nvl", text: "NVL代码覆盖：第二句，前一句必须仍然保留。" },
          { type: "dialog", character_id: "qa_speaker", presentation_mode: "bubble", text: "气泡代码覆盖：角色离场时保持安全位置，正文必须完整可读。" },
        ] : []), { type: "narration", text: "第二句。" },
        ...(process.argv.includes("--choices") ? [{ type: "choice", choices: [
          { choice_id: "sample", text: "测试原生分支", target_scene_id: "branch", conditions: [] },
        ] }] : [])] },
      ...(process.argv.includes("--choices") ? [{ scene_id: "branch", title: "分支结果", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "已进入正确分支。" }] }] : [])] };
  const variants = {};
  for (const enabled of [true, false]) {
    skin.advancedPresentationEnabled = enabled;
    const result = await api.exportEditorCartridge({ gameId: script.game_id, title: script.title, author: "QA", script,
      uiSkin: skin, projectAssets: [asset], projectAssetRefs: [{ asset_id: "code_icon", asset_type: "ui",
        metadata: { filename: "图标.svg", mime_type: "image/svg+xml", data_url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` } }] });
    assert.deepEqual(result.errors, []);
    const bytes = Buffer.from(await result.blob.arrayBuffer());
    fs.writeFileSync(path.join(out, `${enabled ? "enabled" : "disabled"}.vncart`), bytes, { flag: "wx" });
    const zip = await req("jszip").loadAsync(bytes);
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const uiSkin = JSON.parse(await zip.file("ui/layout.json").async("string"));
    report.artifacts.push({ enabled, bytes: bytes.length, generatedAt: new Date().toISOString(),
      cartridgeSHA256: createHash("sha256").update(bytes).digest("hex"),
      layoutSHA256: createHash("sha256").update(await zip.file("ui/layout.json").async("nodebuffer")).digest("hex") });
    const packedStart = uiSkin.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === start.component_id);
    assert.equal(Boolean(packedStart.presentation), enabled);
    assert.equal(manifest.runtime_version, "0.25.0", "The approved nine-action quickbar, including Hide, requires Runtime 0.25");
    assert(uiSkin.screens.find(s => s.screen_id === "player").components
      .some(c => c.component_id === "quick_hide_ui_button" && c.visible !== false),
    "Do not satisfy an old minimum-version assertion by dropping the approved Hide control");
    assert.equal(manifest.assets.some(a => a.asset_id === "code_icon"), enabled, "Disabled code must not retain its unused image");
    const assetUrls = {};
    for (const a of manifest.assets) {
      const buffer = await zip.file(a.path).async("nodebuffer");
      if (a.asset_id === "code_icon") assert.equal(buffer.toString(), svg, "Real exported icon bytes");
      assetUrls[a.asset_id] = `data:${a.mime_type};base64,${buffer.toString("base64")}`;
    }
    variants[String(enabled)] = { manifest, script: JSON.parse(await zip.file("script.json").async("string")), uiSkin, assetUrls };
    assert(start.presentation, "Export cannot erase project source code");
  }
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), configFile: path.join(root, "GameCli_framework/vite.config.cjs"),
    logFile: path.join(out, "runtime.log") });
  report.owner = { pid: server.pid, url: server.url }; save();
  browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
  const matrix = process.env.PRESENTATION_RUNTIME_MATRIX === "1"
    ? [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) => [1, 2].flatMap(dpr =>
      [false, true].map(reduced => ({ width, height, dpr, reduced }))))
    : [{ width: 1920, height: 1080, dpr: 1, reduced: false }];
  for (const m of matrix.filter(m => !process.argv.includes("--reduced-only") || m.reduced)) for (const enabled of [true, false]) {
    const context = await browser.newContext({ viewport: { width: m.width, height: m.height }, deviceScaleFactor: m.dpr,
      reducedMotion: m.reduced ? "reduce" : "no-preference" });
    page = await context.newPage(); page.setDefaultTimeout(20000);
    await server.run(async () => {
      await page.goto(`${server.url}/?mode=preview`);
      await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
      await page.evaluate(async () => {
        const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
        window.__presentationInputTrace = [];
        window.__presentationSnapshot = () => {
          const state = useRuntimeStore.getState(), box = document.querySelector(".dialog-box");
          return { index: state.engineState.currentCommandIndex, typing: state.engineState.isTyping,
            text: state.engineState.dialog?.text, pageDone: box?.getAttribute("data-dialog-page-done"),
            mode: box?.getAttribute("data-dialogue-layout-mode"), focus: document.activeElement?.className,
            modal: Boolean(document.querySelector('[data-runtime-modal="true"]')) };
        };
        for (const name of ["pointerdown", "pointerup", "click", "keydown"]) document.addEventListener(name, event => {
          if (!event.target.closest?.(".dialog-box, [data-runtime-modal]")) return;
          const row = { name, detail: event.detail, key: event.key, target: event.target.className,
            before: window.__presentationSnapshot() };
          window.__presentationInputTrace.push(row);
          queueMicrotask(() => { row.after = window.__presentationSnapshot(); });
          if (window.__presentationInputTrace.length > 40) window.__presentationInputTrace.shift();
        }, true);
      });
      await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
        sessionId: "control", revision: 1, requestId: "control", runId: "control", screen: "title_menu", ...payload }, "*"), variants[String(enabled)]);
      const startButton = page.getByTestId("start-new-game");
      await startButton.waitFor();
      await settleRuntime(page);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      if (process.argv.includes("--title-controls")) {
        for (const action of ["open-help", "open-exit-confirmation"]) {
          const button = page.getByTestId(action);
          assert.equal((await button.evaluate(e => getComputedStyle(e).color)) === "rgb(170, 255, 221)", enabled);
          await button.click();
          if (action === "open-help") {
            await page.getByTestId("help-screen").waitFor();
            await page.getByTestId("renpy-menu-return").click();
            await page.getByTestId("game-state-title").waitFor();
            await page.locator('[data-runtime-screen-transition="idle"]').waitFor();
          } else {
            await page.locator('[data-runtime-modal="true"]').waitFor();
            await page.keyboard.press("Escape");
            await page.locator('[data-runtime-modal="true"]').waitFor({ state: "detached" });
          }
        }
      }
      if (process.argv.includes("--decorations"))
        assert.equal((await page.locator('[data-ui-mask-id="qa_title_mask"]').evaluate(e =>
          getComputedStyle(e).backgroundColor)) === "rgb(102, 85, 68)", enabled,
          "A selectable title mask cannot silently ignore its code override");
      const color = await startButton.evaluate(e => getComputedStyle(e).backgroundColor);
      assert.equal(color === "rgb(116, 43, 89)", enabled);
      assert.equal(await startButton.getAttribute("data-control-slot-count"), enabled ? "1" : null);
      if (enabled) assert.equal(await startButton.locator("img").evaluate(e => e.complete && e.naturalWidth === 20), true);
      const stateGeometry = await startButton.boundingBox();
      await startButton.hover();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="start-new-game"]')).color === "rgb(170, 255, 204)");
      assert.equal(await startButton.evaluate(e => Number(getComputedStyle(e).opacity)), 0.83,
        "Hover inherits the authored normal state's properties, instead of resetting them");
      assert.deepEqual(await startButton.boundingBox(), stateGeometry, "State changes cannot move the click target");
      await page.mouse.move(0, 0);
      const geometry = await startButton.evaluate(e => {
        const r = e.getBoundingClientRect();
        return { rect: r.toJSON(), hit: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert(geometry.hit && geometry.rect.right <= m.width && geometry.rect.bottom <= m.height && geometry.overflow <= 1);
      await page.getByTestId("open-about").click();
      await page.locator('[data-runtime-screen-transition="idle"]').waitFor();
      await page.getByTestId("about-screen").waitFor();
      assert.equal((await page.locator(".about-card").evaluate(e => getComputedStyle(e).color)) === "rgb(68, 221, 204)", enabled);
      assert.match(await page.locator(".about-card").innerText(), /安全控件代码验收/);
      if (process.argv.includes("--decorations")) {
        assert.equal((await page.locator('[data-ui-mask-id="qa_about_mask"]').evaluate(e =>
          getComputedStyle(e).backgroundColor)) === "rgb(102, 85, 68)", enabled);
        const custom = page.locator('[data-component-id="qa_component"]');
        assert.equal(Boolean(await custom.getAttribute("data-control-presentation")), enabled,
          "Custom components keep their own structure and actions under the optional override");
        if (enabled) assert.equal(await custom.evaluate(e => getComputedStyle(e).borderRadius), "11px");
        await custom.getByRole("button", { name: "组件帮助入口", exact: true }).click();
        await page.getByTestId("help-screen").waitFor();
        await page.getByTestId("renpy-menu-return").click();
        await page.getByTestId("game-state-title").waitFor();
        await page.locator('[data-runtime-screen-transition="idle"]').waitFor();
        await page.getByTestId("open-about").click();
        await page.getByTestId("about-screen").waitFor();
        await page.locator('[data-runtime-screen-transition="idle"]').waitFor();
      }
      await page.getByTestId("renpy-menu-return").click();
      await page.getByTestId("game-state-title").waitFor();
      await page.locator('[data-runtime-screen-transition="idle"]').waitFor();
      await startButton.click();
      await page.getByTestId("game-state-playing").waitFor();
      await page.locator('[data-runtime-screen-transition="idle"]').waitFor();
      assert.equal(await page.locator(".dialog-box").count(), 1, "No duplicate engine/dialog from presentation");
      if (process.argv.includes("--stage")) {
        const stage = page.locator(".background-layer");
        assert.match(await stage.evaluate(e => getComputedStyle(e).backgroundColor), /^rgba?\(49, 69, 115(?:, 0\.78)?\)$/,
          "The editable stage must render its ordinary background style");
        assert.equal(Boolean(await stage.getAttribute("data-control-presentation")), enabled,
          "The editable stage must render its safe code only while advanced effects are enabled");
        if (enabled) assert.equal(await stage.evaluate(e => getComputedStyle(e).borderRadius), "9px");
      }
      await page.waitForFunction(() => document.querySelector(".dialog-box")?.textContent?.includes("验证原生按钮"));
      assert.match(await page.locator(".dialog-box").innerText(), /验证原生按钮/);
      assert.match(await page.getByTestId("renpy-quick-bar").evaluate(e => getComputedStyle(e).backgroundColor),
        /^rgba?\(33, 87, 121(?:, 0\.66)?\)$/, "Ordinary quick-bar material honors its background and existing material opacity");
      const auto = page.getByTestId("renpy-quick-auto");
      assert.equal((await auto.evaluate(e => getComputedStyle(e).backgroundColor)) === "rgb(76, 50, 88)", enabled,
        "A quick button's own code cannot be ignored by the Runtime adapter");
      await auto.click();
      assert.equal(await auto.getAttribute("aria-pressed"), "true", "Native automatic action still works through the slot");
      await auto.click();
      assert.equal(await auto.getAttribute("aria-pressed"), "false");
      const changedSkin = structuredClone(variants[String(enabled)].uiSkin);
      changedSkin.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "quick_menu").style.backgroundColor = "#335522";
      await page.evaluate(() => { window.__originalDialogue = document.querySelector(".dialog-box"); });
      const response = await page.evaluate(uiSkin => new Promise(resolve => {
        const receive = event => {
          if (event.data?.sessionId !== "control" || event.data?.requestId !== "appearance"
            || !["agentvn.live-preview.ready", "agentvn.live-preview.error"].includes(event.data?.type)) return;
          window.removeEventListener("message", receive); resolve(event.data);
        };
        window.addEventListener("message", receive);
        window.postMessage({ type: "agentvn.live-preview.patch", protocolVersion: 2,
          sessionId: "control", revision: 2, requestId: "appearance", runId: "control",
          presentationOnly: true, uiSkin }, "*");
      }), changedSkin);
      assert.equal(response.type, "agentvn.live-preview.ready");
      await page.waitForFunction(() => /^rgba?\(51, 85, 34/.test(getComputedStyle(document.querySelector('[data-testid="renpy-quick-bar"]')).backgroundColor));
      assert.equal(await page.evaluate(() => document.querySelector(".dialog-box") === window.__originalDialogue), true,
        "Appearance patches must preserve the mounted native dialogue and engine");
      assert.equal(await page.getByTestId("game-launch-blackout").count(), 0,
        "Changing only an appearance cannot introduce a launch transition");
      if (process.argv.includes("--regions")) {
        await page.getByTestId("renpy-quick-load").click();
        // Without a quick save, Runtime supplies feedback rather than a phantom dialog.
        await page.getByTestId("renpy-quick-save").click();
        await page.waitForFunction(() => document.querySelector('[data-testid="renpy-quick-save"]')?.getAttribute("aria-busy") !== "true");
        await page.getByTestId("renpy-quick-load").click();
        const modal = page.locator('[data-runtime-modal="true"]');
        await modal.waitFor();
        assert.equal((await modal.evaluate(e => getComputedStyle(e).backgroundColor)) === "rgb(36, 57, 81)", enabled);
        assert.equal(await modal.locator("button").count() > 0, true, "Confirmation retains native actions");
        assert.equal(await modal.evaluate(e => e.contains(document.activeElement)), true, "Wrapped panel retains focus containment");
        await page.keyboard.press("Escape"); await modal.waitFor({ state: "detached" });
        for (const [mode, token, count] of [["nvl", "第一句", 1], ["nvl", "第二句", 2], ["bubble", "气泡代码覆盖", 0]]) {
          const dialog = page.locator(".dialog-box");
          // Never conditionally "reveal" based on an earlier render: the typewriter
          // can finish between that observation and pointerdown, making it advance.
          await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true"
            && document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-is-typing") === "false");
          const priorIndex = Number(await page.getByTestId("game-state-playing").getAttribute("data-current-command-index"));
          if (await dialog.getAttribute("data-dialogue-layout-mode") === "nvl")
            await page.locator(".nvl-advance-surface").click();
          else await dialog.click();
          await page.waitForFunction(({ mode, token }) => {
            const box = document.querySelector(".dialog-box");
            const visible = mode === "nvl" ? [...box?.querySelectorAll(".nvl-page .nvl-page-text") ?? []].at(-1)
              : box?.querySelector(".dialog-text");
            return box?.getAttribute("data-dialogue-layout-mode") === mode && visible?.textContent.includes(token)
              && visible.getBoundingClientRect().width > 0 && getComputedStyle(box).visibility !== "hidden";
          }, { mode, token });
          assert.equal(Number(await page.getByTestId("game-state-playing").getAttribute("data-current-command-index")),
            priorIndex + 1, "One completed-line click consumes exactly one narrative command");
          if (count) assert.equal(await page.locator('[data-testid="nvl-page"] [data-nvl-line]').count(), count);
          assert.equal(Boolean(await dialog.getAttribute("data-control-presentation")), enabled);
          const text = page.locator(mode === "nvl" ? ".nvl-page:not(.nvl-page-measure) .nvl-page-text" : ".dialog-text").last();
          assert.equal((await text.evaluate(e => getComputedStyle(e).color)) === "rgb(136, 255, 204)", enabled);
          const bounds = await dialog.evaluate(e => {
            const r = e.getBoundingClientRect(), text = e.querySelector(".dialog-text, .nvl-page-text");
            const t = text.getBoundingClientRect();
            return { rect: r.toJSON(), text: t.toJSON(), viewport: { width: innerWidth, height: innerHeight },
              overflow: document.documentElement.scrollWidth - innerWidth };
          });
          assert(bounds.rect.left >= -1 && bounds.rect.right <= bounds.viewport.width + 1
            && bounds.rect.top >= -1 && bounds.rect.bottom <= bounds.viewport.height + 1
            && bounds.text.width > 0 && bounds.text.height > 0 && bounds.overflow <= 1,
            `Authored ${mode} preserves visible readable bounds: ${JSON.stringify(bounds)}`);
        }
      }
      if (process.argv.includes("--choices")) {
        for (let step = 0; step < 2; step++) {
          await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true"
            && document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-is-typing") === "false");
          const priorIndex = Number(await page.getByTestId("game-state-playing").getAttribute("data-current-command-index"));
          await page.locator(".dialog-box").click();
          await page.waitForFunction(index => Number(document.querySelector('[data-testid="game-state-playing"]')
            ?.getAttribute("data-current-command-index")) === index + 1, priorIndex);
        }
        const choice = page.getByRole("button", { name: "选择：测试原生分支", exact: true });
        await choice.waitFor(); await choice.hover();
        await page.waitForFunction(color => getComputedStyle(document.querySelector(".choice-option")).color === color,
          enabled ? "rgb(119, 255, 204)" : "rgb(170, 255, 204)");
        await choice.click();
        await page.waitForFunction(() => document.querySelector('[data-testid="game-state-playing"]')
          ?.getAttribute("data-current-scene-id") === "branch");
      }
      const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      assert.deepEqual(actual, m);
      let screenshot;
      if (enabled) {
        screenshot = `${m.width}x${m.height}-dpr${m.dpr}-${m.reduced ? "reduced" : "ordinary"}.png`;
        const png = await page.screenshot({ path: path.join(out, screenshot) });
        assert.equal(png.readUInt32BE(16), m.width * m.dpr);
        assert.equal(png.readUInt32BE(20), m.height * m.dpr);
      }
      assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches })), actual);
      report.cases.push({ ...m, enabled, status: "PASS", geometry, actual, screenshot }); save();
    });
    await context.close(); page = undefined;
  }
  assert.equal(report.cases.length, matrix.filter(m => !process.argv.includes("--reduced-only") || m.reduced).length * 2);
  assert.equal(sourceHash(), report.sourceSHA256, "Runtime sources changed during the acceptance run");
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  report.diagnostics = await page?.evaluate(() => {
    const choice = document.querySelector(".choice-option");
    return { snapshot: window.__presentationSnapshot?.(), events: window.__presentationInputTrace,
      choice: choice && { html: choice.outerHTML, color: getComputedStyle(choice).color,
        hovered: choice.matches(":hover"), disabled: choice.disabled },
      codeStyles: [...document.querySelectorAll("style")].map(e => e.textContent)
        .filter(text => text.includes("@layer agentvn-control-code")).slice(-10) };
  }).catch(() => undefined);
  await page?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
}).finally(async () => {
  await browser?.close(); await server?.stop();
  let remaining = false;
  if (server) try { await fetch(server.url, { signal: AbortSignal.timeout(700) }); remaining = true; } catch {}
  report.cleanup = remaining ? "FAILED" : "PASS";
  if (remaining) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
