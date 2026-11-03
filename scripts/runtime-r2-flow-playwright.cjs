"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, ".."), baseline = process.argv.includes("--baseline");
const reducedBaseline = process.argv.includes("--reduced-baseline");
const loadBaseline = process.argv.includes("--load-baseline");
const fourKBaseline = process.argv.includes("--4k-baseline");
const output = path.join(root, "output/playwright/runtime-r2-flow", new Date().toISOString().replace(/[:.]/g, "-"));
const loaded = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(loaded, loaded.exports);
const mediumFor = width => "这是一段需要保持完整可读的对白，字体应该先自动调整而不是把内容裁掉。"
  .repeat(Math.round(6 * (width / 1920) ** 2));
const extremeText = "这是极长对白验收内容，达到安全字号下限后必须按同一尺寸分页，任何字符都不能遗漏。".repeat(140);
const report = { scope: "R2-real-browser-desktop-and-Android-UA-not-device-acceptance", status: "RUNNING",
  baseline, output, cases: [], pageErrors: [] };
const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
function fixture(authored, width) {
  const uiSkin = loaded.exports.getDefaultUISkinLayout();
  if (authored) {
    const menu = uiSkin.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "quick_menu");
    menu.rect = { x: 82, y: 51, width: 18, height: 8, anchor: "top_right" };
    menu.mobileRect = { ...menu.rect };
  }
  const now = new Date().toISOString(), id = `r2-${authored ? "authored" : "default"}`;
  return { manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.21.0",
    game_id: id, title: "R2 隔离移动工程", author: "QA", version: "1.0.0", language: "zh-CN",
    entry_script: "script.json", entry_scene_id: "main", assets: [], created_at: now, updated_at: now },
    script: { schema_version: "1.1.0", game_id: id, title: "R2 隔离移动工程", entry_scene_id: "main",
      characters: [{ character_id: "hero", name: "示例角色" }], scenes: [{ scene_id: "main", title: "Main", chapter: 1,
        tags: [], commands: ["短对白保持配置字号。", "第二句用于回退与存读档验收。", mediumFor(width), extremeText,
          "长文本分页结束，继续剧情。"].map(text => ({ type: "dialog", character_id: "hero", speaker: "示例角色", text })) }] },
    uiSkin, assetUrls: {} };
}
async function idle(page) {
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-screen-transition") === "idle"
    && !document.querySelector('[data-testid="game-launch-blackout"]'), undefined, { timeout: 30000 });
}
async function act(locator, mobile) { if (mobile) await locator.tap(); else await locator.click(); }
async function check(name, context, task) {
  const item = { name, ...context, status: "CHECKING" }; report.cases.push(item);
  try { await task(item); item.status = "PASS"; }
  catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); }
  persist();
}
async function init(page, url, mobile, authored) {
  await page.goto(`${url}/?mode=preview`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
  await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
    sessionId: payload.manifest.game_id, revision: 1, requestId: "init", runId: "init", screen: "title_menu", ...payload }, "*"), fixture(authored, page.viewportSize().width));
  await page.getByTestId("game-state-title").waitFor(); await idle(page);
  await act(page.getByTestId("open-settings"), mobile); await page.getByTestId("settings-screen").waitFor(); await idle(page);
  await act(page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "文字", exact: true }), mobile);
  await page.getByRole("slider", { name: "Text speed", exact: true }).focus(); await page.keyboard.press("Home");
  await act(page.getByTestId("settings-finish"), mobile); await page.getByTestId("game-state-title").waitFor(); await idle(page);
  await act(page.getByTestId("start-new-game"), mobile); await page.getByTestId("game-state-playing").waitFor(); await idle(page);
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
}
async function sample(page) {
  return page.evaluate(() => {
    const controls = document.querySelector(".playback-controls"), frame = controls.closest(".runtime-layout-frame");
    const rect = n => n.getBoundingClientRect().toJSON(), toggle = controls.querySelector('[data-testid="quick-menu-toggle"]');
    const actions = [...controls.querySelectorAll(".quick-menu-action-layer button")].map(n => {
      const r = rect(n), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { label: n.querySelector(".quick-menu-button-label").textContent, rect: r, disabled: n.disabled,
        hit: n.contains(hit), opacity: Number(getComputedStyle(n).opacity) };
    });
    return { frame: rect(frame), toggle: rect(toggle), root: rect(controls), dialog: rect(document.querySelector(".dialog-box")),
      surface: rect(controls.querySelector(".quick-menu-surface")), actions,
      inline: { left: controls.style.left, top: controls.style.top },
      formFactor: controls.closest(".ui-skin-scope").getAttribute("data-ui-form-factor"),
      mobileMetrics: controls.getAttribute("data-quick-menu-breakpoint"),
      overflow: document.documentElement.scrollWidth - innerWidth,
      surfaceScroll: controls.querySelector(".quick-menu-surface").scrollHeight - controls.querySelector(".quick-menu-surface").clientHeight,
      playthrough: document.querySelector('[data-testid="game-state-playing"]').getAttribute("data-playthrough-id"),
      viewport: { width: innerWidth, height: innerHeight, visualWidth: visualViewport?.width,
        visualHeight: visualViewport?.height, scale: visualViewport?.scale } };
  });
}
async function openMenu(page, mobile) {
  if (await page.getByTestId("quick-menu-toggle").getAttribute("aria-expanded") !== "true") await act(page.getByTestId("quick-menu-toggle"), mobile);
  await page.waitForFunction(() => [...document.querySelectorAll(".quick-menu-action-layer button")]
    .every(n => Number(getComputedStyle(n).opacity) >= .99));
}
async function dialogSample(page) {
  // Typewriter completion can be observed in the same commit that changes an
  // inherited span font. Sample the presented text after that paint settles.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => [...document.querySelectorAll('.dialog-text, .dialog-text *')]
    .every(n => n.getAnimations().every(a => a.playState !== 'running')));
  return page.locator(".dialog-box").evaluate(box => {
    const text = box.querySelector(".dialog-text"), r = text.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(text);
    return { mode: box.getAttribute("data-dialog-font-mode"), scale: Number(box.getAttribute("data-dialog-font-scale")),
      pages: Number(box.getAttribute("data-dialog-pages")), page: Number(box.getAttribute("data-dialog-page")),
      text: text.textContent, font: parseFloat(getComputedStyle(text).fontSize), scroll: text.scrollHeight - text.clientHeight,
      rect: r.toJSON(), client: { width: text.clientWidth, height: text.clientHeight },
      lines: [...range.getClientRects()].map(q => q.toJSON()) };
  });
}
async function run(page, server, context) {
  const { mobile, authored } = context; await init(page, server.url, mobile, authored);
  const mediumText = mediumFor(context.width);
  const mobileEmulation = mobile ? await page.context().newCDPSession(page) : null;
  const collapsed = await sample(page);
  await check("default-or-authored-placement", context, async item => {
    item.collapsed = collapsed;
    assert.equal(collapsed.formFactor, mobile ? "handheld" : "desktop");
    assert.equal(collapsed.mobileMetrics, mobile ? "mobile" : "desktop");
    if (authored) {
      assert(Math.abs(collapsed.toggle.right - (collapsed.frame.left + .82 * collapsed.frame.width)) <= 2, "Explicit menu x must survive the actual Runtime/dialog call chain");
      assert(Math.abs(collapsed.toggle.top - (collapsed.frame.top + .51 * collapsed.frame.height)) <= 2, "Explicit menu y must survive the actual Runtime/dialog call chain");
    } else {
      assert(Math.abs(collapsed.toggle.right - collapsed.dialog.right) <= 2);
      assert(Math.abs(collapsed.toggle.bottom - (collapsed.dialog.top - 8)) <= 2, "Default toggle must be outside-above dialogue");
    }
  });
  await openMenu(page, mobile); const expanded = await sample(page);
  await page.screenshot({ path: path.join(output, `menu-${context.width}-${context.dpr}-${context.reduced}-${mobile}-${authored}.png`) });
  await check("complete-menu-proportion-hit-and-no-overlap", context, async item => {
    item.expanded = expanded;
    assert.equal(expanded.actions.map(a => a.label).join("|"), "回退|自动|快进|存档|历史|隐藏|菜单");
    assert(expanded.actions.length === 7 && expanded.actions.every(a => a.hit || a.disabled));
    assert(expanded.overflow <= 1 && expanded.surfaceScroll <= 2);
    for (const a of expanded.actions) {
      assert(a.rect.left >= expanded.frame.left - 1 && a.rect.right <= expanded.frame.right + 1);
      assert(a.rect.top >= expanded.frame.top - 1 && a.rect.bottom <= expanded.dialog.top - 1, "Menu must not cover dialogue");
    }
    for (const key of ["x", "y", "width", "height"]) assert(Math.abs(expanded.toggle[key] - collapsed.toggle[key]) <= 2, `Toggle ${key} jumps on expansion`);
    if (!authored) assert(expanded.surface.width / expanded.frame.width >= (mobile ? .29 : .22), "Menu must preserve its readable relative size at 1080p/2K/4K instead of fixed pixels");
  });
  await check("toggle-edge-hit-and-restore-events", context, async item => {
    await act(page.getByTestId("quick-menu-toggle"), mobile);
    const r = (await sample(page)).toggle;
    const edge = { x: r.left + 2, y: r.top + r.height / 2 };
    if (mobile) await page.touchscreen.tap(edge.x, edge.y); else await page.mouse.click(edge.x, edge.y);
    await openMenu(page, mobile);
    await act(page.getByRole("button", { name: "开启自动播放", exact: true }), mobile);
    await act(page.getByRole("button", { name: "关闭自动播放", exact: true }), mobile);
    await page.evaluate(() => { window.dispatchEvent(new Event("pageshow")); document.dispatchEvent(new Event("visibilitychange")); });
    item.after = await sample(page);
    for (const key of ["x", "y", "width", "height"]) assert(Math.abs(item.after.toggle[key] - collapsed.toggle[key]) <= 2, `Toggle ${key} moves after actions/recovery`);
  });
  await act(page.getByTestId("quick-menu-toggle"), mobile);
  await check("horizontal-frame-resize-and-recovery", context, async item => {
    item.before = await sample(page);
    for (const size of [{ width: context.width === 1920 ? 2560 : 1920, height: context.width === 1920 ? 1440 : 1080 },
      { width: context.width, height: context.height }]) {
      await page.setViewportSize(size);
      // Chromium's mobile emulation preserves page zoom when the old native
      // document size is wider than the new device. Android surface recovery
      // is a resize, not a pinch zoom; reset only the emulator's zoom state.
      await mobileEmulation?.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
      await page.waitForFunction(() => {
        const frame = document.querySelector(".runtime-layout-frame").getBoundingClientRect();
        const scope = document.querySelector(".ui-skin-scope");
        const handheld = scope.getAttribute("data-ui-form-factor") === "handheld";
        const width = handheld ? visualViewport.width : innerWidth;
        const height = handheld ? visualViewport.height : innerHeight;
        const expectedWidth = Math.min(Math.round(width), Math.round(height) * 16 / 9);
        return Math.abs(frame.width - expectedWidth) < 2 && Math.abs(frame.height - expectedWidth * 9 / 16) < 2
          && scope.getAttribute("data-ui-viewport-phase") === "stable";
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const resized = await sample(page);
      (item.resizes ??= []).push({ requested: size, ...resized });
      assert(Math.abs(resized.frame.width / resized.frame.height - 16 / 9) < .01);
      const scale = resized.viewport.scale ?? 1;
      assert(resized.toggle.left >= 0 && resized.toggle.top >= 0
        && resized.toggle.right * scale <= size.width + 1 && resized.toggle.bottom * scale <= size.height + 1);
      assert.equal(resized.playthrough, item.before.playthrough);
    }
    item.after = await sample(page);
    for (const key of ["x", "y", "width", "height"]) assert(Math.abs(item.before.toggle[key] * item.before.viewport.scale
      - item.after.toggle[key] * item.after.viewport.scale) <= 3, `Resize/recovery changed rendered toggle ${key}`);
  });
  // A viewport test failure must not contaminate the independent text fixture.
  await page.setViewportSize({ width: context.width, height: context.height });
  await init(page, server.url, mobile, authored);
  await check("short-adaptive-and-extreme-dialog-completeness", context, async item => {
    item.short = await dialogSample(page); assert.equal(item.short.mode, "configured"); assert.equal(item.short.pages, 1);
    for (const expected of ["第二句用于回退与存读档验收。", mediumText]) {
      await act(page.locator(".dialog-box"), mobile);
      await page.waitForFunction(text => document.querySelector(".dialog-box")?.getAttribute("aria-label")?.includes(text), expected);
      await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
    }
    item.medium = await dialogSample(page);
    assert.equal(item.medium.mode, "adaptive");
    assert(item.medium.font < item.short.font && item.medium.pages === 1 && item.medium.text === mediumText);
    await act(page.locator(".dialog-box"), mobile);
    await page.waitForFunction(() => Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-pages")) > 1);
    item.extreme = []; let text = "";
    const count = Number(await page.locator(".dialog-box").getAttribute("data-dialog-pages"));
    assert(count > 1 && count < 100, "Extreme fixture must exercise bounded real pagination");
    for (let index = 1; index <= count; index++) {
      await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
      const entry = await dialogSample(page); item.extreme.push(entry); text += entry.text;
      assert(entry.font >= 12 && entry.scroll <= 2 && entry.page === index, "Each page must retain readable font and avoid clipping/scrolling");
      assert(entry.lines.every(r => r.left >= entry.rect.left - 1 && r.right <= entry.rect.right + 1 && r.bottom <= entry.rect.bottom + 2));
      if (index < count) { await act(page.locator(".dialog-box"), mobile);
        await page.waitForFunction(next => Number(document.querySelector(".dialog-box")?.getAttribute("data-dialog-page")) === next, index + 1); }
    }
    assert.equal(text, extremeText, "Pagination must preserve every original character");
  });
  await init(page, server.url, mobile, authored);
  await check("seven-actions-settings-and-save-load-roundtrip", context, async item => {
    await act(page.locator(".dialog-box"), mobile);
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.textContent.includes("第二句用于回退"));
    await openMenu(page, mobile);
    await act(page.getByRole("button", { name: "回退", exact: true }), mobile);
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.textContent.includes("短对白"));
    await act(page.locator(".dialog-box"), mobile);
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.textContent.includes("第二句用于回退"));
    await openMenu(page, mobile);
    await act(page.getByRole("button", { name: "开启快进", exact: true }), mobile);
    await act(page.getByRole("button", { name: "关闭快进", exact: true }), mobile);
    await act(page.getByRole("button", { name: "打开存档读档", exact: true }), mobile);
    await page.getByTestId("save-slot-grid").waitFor(); await idle(page);
    const emptySlot = page.getByRole("button", { name: /^保存到手动存档 / }).first();
    const slotLabel = await emptySlot.getAttribute("aria-label");
    item.slot = slotLabel.match(/\d+$/)[0];
    await act(emptySlot, mobile);
    await page.getByTestId(`save-slot-manual-${item.slot}`).locator(".save-card-main").waitFor();
    await page.waitForFunction(slot => document.querySelector(`[data-testid="save-slot-manual-${slot}"]`)?.classList.contains("has-save"), item.slot);
    await page.waitForFunction(slot => document.querySelector(`[data-testid="save-slot-manual-${slot}"] .save-card-main`)?.getAttribute('aria-busy') !== 'true', item.slot);
    item.saved = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => /save/i.test(key))
      .flatMap(([, value]) => JSON.parse(value)).map(save => ({ slot: save.slot, scene: save.scene_id,
        command: save.command_index, page: save.dialog_page_index, kind: save.save_kind })));
    assert(item.saved.length > 0 && item.saved.every(save => save.command >= 0 && save.command < 5),
      "Fast-forward must never leave an unsaveable command index past the final scene");
    await act(page.getByRole("button", { name: "读取", exact: true }), mobile);
    await page.waitForFunction(slot => document.querySelector(`[data-testid="save-slot-manual-${slot}"] .save-card-main`)?.getAttribute('aria-label') === `读取手动存档 ${slot}`, item.slot);
    await act(page.getByRole("button", { name: `读取手动存档 ${item.slot}`, exact: true }), mobile);
    try { await page.getByTestId("game-state-playing").waitFor(); await idle(page); }
    catch (error) {
      item.loadFailure = await page.evaluate(() => ({ text: document.body.innerText,
        transition: document.querySelector('[data-runtime-screen-transition]')?.outerHTML.slice(0, 1000),
        blackout: document.querySelector('[data-testid="game-launch-blackout"]')?.outerHTML,
        slots: [...document.querySelectorAll('.save-card-main')].map(n => ({ label: n.getAttribute('aria-label'), busy: n.getAttribute('aria-busy'), disabled: n.disabled })) }));
      await page.screenshot({ path: path.join(output, `load-failure-${context.width}-${context.dpr}-${context.reduced}-${mobile}-${authored}.png`) });
      throw error;
    }
    await openMenu(page, mobile);
    await act(page.getByRole("button", { name: "打开历史记录", exact: true }), mobile);
    await page.getByTestId("back-to-player").waitFor(); await idle(page);
    assert((await page.locator(".history-list").innerText()).includes("短对白"));
    await act(page.getByTestId("back-to-player"), mobile); await idle(page);
    await openMenu(page, mobile);
    await act(page.getByRole("button", { name: "隐藏界面", exact: true }), mobile);
    await page.locator(".dialog-box").waitFor({ state: "detached" });
    const player = page.getByTestId("game-state-playing");
    const command = await player.getAttribute("data-current-command-index");
    await act(player, mobile); await page.locator(".dialog-box").waitFor();
    assert.equal(await player.getAttribute("data-current-command-index"), command, "Restoring hidden UI must not advance story");
    await openMenu(page, mobile); item.before = await sample(page);
    await act(page.getByTestId("open-main-menu"), mobile); await page.getByTestId("main-menu").waitFor(); await idle(page);
    await act(page.getByTestId("open-settings"), mobile); await page.getByTestId("settings-screen").waitFor(); await idle(page);
    for (const label of ["文字", "音频", "跳过", "系统", "显示"]) {
      await act(page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: label, exact: true }), mobile);
      await page.waitForFunction(expected => document.querySelector(".settings-section-title")?.textContent === expected, label);
      await page.waitForFunction(() => [...document.querySelectorAll(".settings-content, .settings-content *")].every(n => n.getAnimations().every(a => a.playState !== "running")));
      assert(await page.locator(".settings-tabs button").evaluateAll(nodes => nodes.length === 5 && nodes.every(n => {
        const r = n.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
          && n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })), "All five real category targets must remain visible and hit-testable");
    }
    await act(page.getByTestId("settings-finish"), mobile); await idle(page);
    await act(page.getByTestId("continue-game"), mobile); await page.getByTestId("game-state-playing").waitFor(); await idle(page);
    await openMenu(page, mobile); item.after = await sample(page);
    for (const key of ["x", "y", "width", "height"]) assert(Math.abs(item.before.toggle[key] - item.after.toggle[key]) <= 2, `Roundtrip moved toggle ${key}`);
    assert.equal(item.after.playthrough, item.before.playthrough);
  });
  await page.screenshot({ path: path.join(output, `${context.width}-${context.dpr}-${context.reduced}-${mobile}-${authored}.png`) });
}
(async () => {
  fs.mkdirSync(output, { recursive: true }); let server, browser;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(output, "vite.log") });
    report.owner = { pid: server.pid, runId: server.runId, url: server.url }; browser = await chromium.launch();
    const contexts = [];
    for (const [width, height] of fourKBaseline ? desktopViewports.slice(2) : loadBaseline ? desktopViewports.slice(1, 2) : baseline || reducedBaseline ? desktopViewports.slice(0, 1) : desktopViewports)
      for (const [dpr, reduced] of reducedBaseline ? [[1, true]] : baseline || loadBaseline || fourKBaseline ? [[1, false]] : [[1, false], [2, false], [1, true], [2, true]])
        for (const mobile of reducedBaseline ? [false] : [false, true]) for (const authored of reducedBaseline || loadBaseline || fourKBaseline ? [false] : [false, true]) {
          contexts.push({ width, height, dpr, reduced, mobile, authored });
        }
    // Independent browser contexts share only the owned read-only Vite service.
    // Bound parallelism to keep 4K/DPR2 captures within the machine's memory.
    let nextContext = 0;
    const worker = async () => {
      while (nextContext < contexts.length) {
          const context = contexts[nextContext++];
          const { width, height, dpr, reduced, mobile } = context;
          console.log(`START ${JSON.stringify(context)}`);
          const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr,
            reducedMotion: reduced ? "reduce" : "no-preference", isMobile: mobile, hasTouch: mobile,
            userAgent: mobile ? "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/132 Mobile Safari/537.36" : undefined });
          page.on("pageerror", error => report.pageErrors.push({ ...context, error: String(error) }));
          try { await server.run(() => run(page, server, context)); } finally { await page.close(); }
      }
    };
    const workers = await Promise.allSettled(Array.from({ length: baseline ? 1 : 3 }, worker));
    const rejected = workers.find(result => result.status === "rejected");
    if (rejected) throw rejected.reason;
    assert.equal(report.cases.length, contexts.length * 6, "Each matrix entry must finish all six real behavior groups");
    assert.equal(report.pageErrors.length, 0);
    report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
    if (report.status === "FAILED") process.exitCode = 1;
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally { await browser?.close(); await server?.stop(); persist(); console.log(`Evidence: ${output}`); }
})();
