"use strict";
// Real shared Runtime components, isolated in-memory cartridge; no user project or AI calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { currentAcceptanceViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/renpy-native-navigation", runId);
const fast = process.env.RENPY_NATIVE_FAST === "1";
const viewports = currentAcceptanceViewports(process.env.RENPY_NATIVE_VIEWPORTS
  ? JSON.parse(process.env.RENPY_NATIVE_VIEWPORTS) : fast ? [[1920, 1080]] : undefined)
  .map(([width, height]) => ({ width, height }));
const report = { runId, status: "RUNNING", scope: "E4 shared Runtime title/navigation, not installed acceptance",
  isolation: "In-memory synthetic cartridge; fresh browser contexts; owned Vite on independent port", cases: [] };
const loaded = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts",
    contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(loaded, loaded.exports);

function fixture(variant) {
  const skin = loaded.exports.createRenpyUILayout();
  if (variant !== "default") {
    const role = (width, height, fontSize) => ({
      geometry: { width, height, fontSize, paddingX: 6, paddingY: 3 },
      states: variant === "text-only" ? { normal: { textColor: "#81bbcc" },
        hover: { textColor: "#ddeeff" }, selected: { textColor: "#eeeecc" } } : {
        normal: { backgroundColor: "#102030", borderWidth: 2, borderColor: "#aabbcc", textColor: "#ddeeff" },
        hover: { backgroundColor: "#203040", borderWidth: 3, borderColor: "#bbccdd",
          geometry: { width: width + 12, height: height + 4 } },
        selected: { backgroundColor: "#304050", borderWidth: 2, borderColor: "#ccddee" },
        disabled: { backgroundColor: "#405060", borderWidth: 2, borderColor: "#ddeeff", opacity: .4 },
      },
    });
    skin.renpy = { shared: { buttonRoles: {
      title_action: role(220, 48, 22), page_navigation: role(180, 44, 20),
    } } };
  }
  return {
    uiSkin: skin,
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.14.0",
      game_id: `e4-native-${variant}`, title: "标题与导航验收", author: "QA", version: "1.0.0",
      language: "zh-CN", entry_script: "script.json", entry_scene_id: "main", assets: [] },
    script: { schema_version: "1.1.0", game_id: `e4-native-${variant}`, title: "隔离小卡带",
      entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "主场景",
        chapter: 1, tags: [], commands: [{ type: "narration", text: "本轮只验收默认和显式按钮样式。" }] }] },
  };
}
async function settle(page) {
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle");
  await page.waitForFunction(() => !document.querySelector(".game-launch-blackout"));
  await page.evaluate(async () => {
    const animations = document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  });
}
async function snapshot(button) {
  return button.evaluate(node => {
    const c = getComputedStyle(node), r = node.getBoundingClientRect();
    // Resolve color-mix and rgba to the same actual pixel representation.
    const rgba = color => {
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    return { rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      color: rgba(c.color), background: rgba(c.backgroundColor), fontSize: parseFloat(c.fontSize),
      // Same independent color reader for the pinned template literal avoids
      // premultiplied-alpha quantization (85 becomes 86 at alpha=128).
      templateDisabled: rgba("#55555580"),
      borderWidth: c.borderTopWidth, borderColor: rgba(c.borderTopColor),
      shadow: c.boxShadow, underline: c.textDecorationLine, outline: c.outlineStyle,
      image: c.backgroundImage, focused: document.activeElement === node };
  });
}
async function geometry(page, selector) {
  const result = await page.locator(selector).evaluate(nav => {
    const frame = nav.closest(".runtime-layout-frame")?.getBoundingClientRect()
      ?? nav.closest(".renpy-title-view").getBoundingClientRect();
    const buttons = [...nav.querySelectorAll("button")].map(node => {
      const r = node.getBoundingClientRect();
      return { label: node.textContent, r: r.toJSON(),
        clipped: node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
        hit: node.disabled || node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    });
    return { frame: frame.toJSON(), buttons, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert(result.overflow <= 1, "页面横向溢出");
  for (let i = 0; i < result.buttons.length; i++) {
    const b = result.buttons[i], f = result.frame;
    assert(b.hit && !b.clipped && b.r.width > 0 && b.r.height > 0, `按钮裁切或不可点击: ${b.label}`);
    assert(b.r.left >= f.left - 1 && b.r.top >= f.top - 1
      && b.r.right <= f.right + 1 && b.r.bottom <= f.bottom + 1, `按钮越界: ${b.label}`);
    if (i) assert(b.r.top >= result.buttons[i - 1].r.bottom - 1, "导航按钮重叠");
  }
  return result;
}
async function inspectStates(button, variant, label) {
  const page = button.page();
  await page.mouse.move(1, 1);
  await page.evaluate(() => document.activeElement?.blur?.());
  await settle(page);
  const normal = await snapshot(button);
  await button.hover();
  await settle(page);
  const hover = await snapshot(button);
  await page.mouse.move(1, 1);
  // Keyboard modality must be established by real input; programmatic focus
  // after hover alone intentionally does not imply :focus-visible in Chromium.
  await page.keyboard.press("Tab");
  await button.focus();
  await settle(page);
  const focus = await snapshot(button);
  assert(focus.focused && focus.outline !== "none"
    && await button.evaluate(node => node.matches(":focus-visible")), `${label} 键盘焦点不可见`);
  await button.evaluate(node => { node.disabled = true; });
  await settle(page);
  const disabled = await snapshot(button);
  await button.evaluate(node => { node.disabled = false; });
  await page.evaluate(() => document.activeElement?.blur?.());
  await settle(page);
  for (const state of [hover, focus, disabled])
    assert.deepEqual(state.rect, normal.rect, `${label} 状态改变按钮几何`);
  if (variant !== "explicit") {
    for (const [name, state] of Object.entries({ normal, hover, focus, disabled })) {
      assert.equal(state.borderWidth, "0px", `${label}/${name} 默认文字按钮不应附带边框`);
      assert.equal(state.background[3], 0, `${label}/${name} 不应附带默认底色`);
      assert.equal(state.shadow, "none", `${label}/${name} 不应附带玻璃内阴影`);
    }
    assert.notDeepEqual(hover.color, normal.color, `${label} 悬停文字反馈缺失`);
    assert.deepEqual(focus.color, hover.color, `${label} 键盘焦点应有悬停文字反馈`);
    if (variant === "default") {
      assert.deepEqual(normal.color, [136, 136, 136, 255], `${label} 默认文字色偏离模板`);
      assert.deepEqual(hover.color, [153, 227, 231, 255], `${label} 默认悬停色应为强调色tint(.6)`);
      assert.deepEqual(disabled.color, disabled.templateDisabled, `${label} 默认禁用色应继承模板`);
    } else {
      assert.deepEqual(normal.color, [129, 187, 204, 255], `${label} 文字角色覆盖丢失`);
      assert.deepEqual(hover.color, [221, 238, 255, 255], `${label} 悬停角色覆盖丢失`);
    }
  } else {
    assert.deepEqual(normal.background, [16, 32, 48, 255], `${label} 显式背景被清除`);
    assert.deepEqual(hover.background, [32, 48, 64, 255], `${label} 显式hover背景丢失`);
    assert(parseFloat(normal.borderWidth) > 0, `${label} 显式边框被清除`);
    assert.deepEqual(normal.borderColor, [170, 187, 204, 255], `${label} 显式边框色丢失`);
    assert.deepEqual(disabled.background, [64, 80, 96, 255], `${label} 显式disabled背景丢失`);
  }
  return { normal, hover, focus, disabled };
}
async function runCase(server, browser, viewport, dpr, reduced, variant) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr,
    reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await context.newPage();
  const entry = { viewport, dpr, reduced, variant, status: "RUNNING" };
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  try {
    await server.run(async () => {
      await page.goto(`${server.url}/?mode=preview`);
      await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
      await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init",
        protocolVersion: 2, sessionId: `e4-${Date.now()}`, revision: 1,
        requestId: "native-nav", runId: "native-nav", screen: "title_menu", ...payload }, "*"), fixture(variant));
      await page.getByTestId("renpy-title-view").waitFor();
      await settle(page);
      entry.titleGeometry = await geometry(page, ".renpy-title-navigation");
      entry.titleStates = await inspectStates(page.getByTestId("start-new-game"), variant, "标题");
      await page.screenshot({ path: path.join(output, `${viewport.width}-dpr${dpr}-${reduced}-${variant}-title.png`) });
      await page.getByTestId("open-settings").click();
      await page.locator('[data-ui-screen="preferences"]').waitFor();
      await settle(page);
      entry.menuGeometry = await geometry(page, ".renpy-menu-navigation");
      entry.menuStates = await inspectStates(page.getByTestId("renpy-menu-about"), variant, "页面导航");
      if (variant === "default") {
        entry.menuScale = await page.locator("[data-renpy-menu-frame]").evaluate(node => {
          const c = getComputedStyle(node);
          const width = node.clientWidth - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight);
          const height = node.clientHeight - parseFloat(c.paddingTop) - parseFloat(c.paddingBottom);
          return { expected: Math.min(width / 1280, height / 720),
            actual: Number(node.dataset.renpyMenuScale), width, height };
        });
        assert(Math.abs(entry.menuScale.actual - entry.menuScale.expected) < .003,
          `正常桌面导航应按完整安全画布缩放，不应锁在旧1.5上限: ${JSON.stringify(entry.menuScale)}`);
        assert(Math.abs(entry.menuStates.normal.fontSize - 22 * entry.menuScale.expected) < .1,
          "菜单字号应与同一1280×720参考画布保持比例");
      }
      const selected = await snapshot(page.getByTestId("renpy-menu-settings"));
      entry.selected = selected;
      if (variant === "default") {
        assert.deepEqual(selected.color, [255, 255, 255, 255], "默认选中状态应为白色");
        assert.equal(selected.background[3], 0, "选中状态不附加底色");
        assert.equal(selected.underline, "none", "选中状态不附加非模板下划线");
      } else if (variant === "text-only") {
        assert.deepEqual(selected.color, [238, 238, 204, 255], "显式selected文字色丢失");
        assert.equal(selected.background[3], 0, "文字覆盖不应引入选中底色");
      } else {
        assert.deepEqual(selected.background, [48, 64, 80, 255], "显式selected背景丢失");
      }
      await page.screenshot({ path: path.join(output, `${viewport.width}-dpr${dpr}-${reduced}-${variant}-menu.png`) });
      // Real keyboard navigation, then actual return; no store/event shortcuts.
      await page.getByTestId("renpy-menu-about").focus();
      await page.keyboard.press("Tab");
      assert(await page.getByTestId("renpy-menu-help").evaluate(node => node === document.activeElement),
        "Tab未按真实导航顺序移动");
      await page.keyboard.press("Enter");
      await page.locator('[data-ui-screen="help"]').waitFor();
      await settle(page);
      await geometry(page, ".renpy-menu-navigation");
      await page.getByTestId("renpy-menu-return").click();
      await page.getByTestId("renpy-title-view").waitFor();
      await settle(page);
      await page.getByTestId("start-new-game").click();
      await page.locator('[data-ui-screen="player"]').waitFor();
      await settle(page);
      assert.deepEqual(errors, [], "Runtime未处理错误");
    });
    entry.status = "PASS";
  } catch (error) {
    entry.status = "FAILED"; entry.error = String(error.stack || error);
    await page.screenshot({ path: path.join(output, `${viewport.width}-dpr${dpr}-${reduced}-${variant}-failure.png`) })
      .catch(() => {});
  } finally {
    report.cases.push(entry);
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await context.close();
  }
  console.log(`${entry.status} ${viewport.width}x${viewport.height} DPR${dpr} reduced=${reduced} ${variant}`);
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  let server, browser;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), port: 0,
      logFile: path.join(output, "server.log") });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch({ headless: process.env.RENPY_NATIVE_HEADFUL !== "1" });
    for (const viewport of viewports) for (const dpr of fast ? [1] : [1, 2])
      for (const reduced of fast ? [false] : [false, true])
        for (const variant of ["default", "text-only", "explicit"])
          await runCase(server, browser, viewport, dpr, reduced, variant);
    assert.equal(report.cases.length, viewports.length * (fast ? 3 : 12), "矩阵为空或缺项");
    assert(report.cases.every(entry => entry.status === "PASS"), "原生文字按钮/显式覆盖存在失败");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    await browser?.close();
    await server?.stop();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
