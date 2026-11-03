"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { buildSync } = require("../editor/node_modules/esbuild");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const output = process.env.AGENTVN_RUNTIME_EXIT_OUTPUT
  || path.join(root, "output/playwright/runtime-exit-behavior", new Date().toISOString().replace(/[:.]/g, "-"));
const compiled = buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text;
const exported = { exports: {} };
new Function("module", "exports", compiled)(exported, exported.exports);
const report = { status: "RUNNING", evidenceScope: "real-browser-real-runtime-store-with-controlled-native-IO-not-installed-native-acceptance", cases: [] };

function fixture(renpy) {
  const id = "exit-save-behavior";
  return {
    manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.9.0",
      game_id: id, title: "退出保存安全", author: "QA", version: "1.0.0", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "main", assets: [],
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    script: { schema_version: "1.1.0", game_id: id, title: "退出保存安全", entry_scene_id: "main",
      characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [],
        commands: [{ type: "narration", text: "退出前等待此句的实际存档写入。" },
          { type: "narration", text: "下一句用于验证进度仍然保留。" }] }] },
    uiSkin: renpy ? exported.exports.createRenpyUILayout() : undefined,
    assetUrls: {},
  };
}

async function idle(page) {
  await page.waitForFunction(() => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-screen-transition") === "idle" && !document.querySelector(".game-launch-blackout"));
}

function installNativeIO() {
  // Fault injection stays at the public native IO/event boundary. App, store,
  // snapshot creation, queueing, exit UI and settings remain production code.
  window.__exitIO = { writes: [], saves: [], pending: [], mode: "hold", destroys: 0,
    callbacks: {}, listeners: {}, sequence: 0 };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event, eventId) { delete window.__exitIO.listeners[eventId]; },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" } },
    invoke: async (command, args = {}) => {
      const io = window.__exitIO;
      if (command === "list_saves") return structuredClone(io.saves);
      if (command === "read_save") return structuredClone(io.saves.find(save =>
        save.save_kind === args.kind && save.slot === args.slot) ?? null);
      if (command === "list_gallery_unlocks") return [];
      if (command === "append_frontend_error") return;
      if (command === "write_save") {
        io.writes.push(structuredClone(args));
        if (io.mode === "fail") throw new Error(io.errorMessage || "测试磁盘写入失败");
        if (io.mode === "hold") await new Promise((resolve, reject) => io.pending.push({ resolve, reject }));
        io.saves = [args.save, ...io.saves.filter(save => !(save.save_kind === args.kind && save.slot === args.slot))];
        return;
      }
      // Retain the legacy counter name in this QA fixture; count only the
      // platform-aware confirmed exit, never substitute Android window destroy.
      if (command === "exit_runtime") { io.destroys += 1; return; }
      if (command === "plugin:window|destroy") throw new Error("Android window destroy must not be the confirmed-exit path");
      if (command === "plugin:window|close") throw new Error("不得重新触发原生 close-request");
      if (command === "plugin:event|listen") {
        const id = ++io.sequence; io.listeners[id] = args; return id;
      }
      if (command === "plugin:event|unlisten") { delete io.listeners[args.eventId]; return; }
      if (command === "plugin:window|set_title") return;
      throw new Error(`Unexpected native call: ${command}`);
    },
    transformCallback(callback) {
      const id = ++window.__exitIO.sequence;
      window.__exitIO.callbacks[id] = callback;
      return id;
    },
    unregisterCallback(id) { delete window.__exitIO.callbacks[id]; },
  };
}

async function initialize(page, url, renpy, autoSaveEnabled) {
  await page.goto(`${url}/?mode=preview`);
  await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
  await page.evaluate(payload => window.postMessage({
    type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "exit-behavior",
    revision: 1, requestId: "exit", runId: "exit", screen: "title_menu", ...payload,
  }, "*"), fixture(renpy));
  try {
    await page.getByTestId("game-state-title").waitFor();
  } catch (cause) {
    const runtimeDiagnostic = await page.evaluate(async () => {
      const [{ useRuntimeStore }, { useSettingsStore }] = await Promise.all([
        import("/src/store/runtimeStore.ts"),
        import("/src/store/settingsStore.ts"),
      ]);
      const state = useRuntimeStore.getState();
      const transition = document.querySelector("[data-runtime-screen-transition]");
      return {
        url: location.href,
        runtimeMode: state.runtimeMode,
        screen: state.screen,
        currentGame: state.currentGame?.install_id,
        launchTransition: state.launchTransition,
        pendingScreenNavigation: state.pendingScreenNavigation,
        transitionPhase: transition?.getAttribute("data-runtime-transition-phase"),
        transitionFrom: transition?.getAttribute("data-runtime-transition-from"),
        transitionTo: transition?.getAttribute("data-runtime-transition-to"),
        transitionGeneration: transition?.getAttribute("data-runtime-transition-generation"),
        transitionToken: transition?.getAttribute("data-runtime-transition-token"),
        transitionReady: transition?.getAttribute("data-runtime-transition-ready"),
        runtimeStatus: [...document.querySelectorAll(".runtime-navigation-status")]
          .map(node => node.textContent),
        bootStatus: document.querySelector(".boot-overlay")?.textContent,
        nativeMock: window.__exitIO && {
          saves: window.__exitIO.saves.length,
          writes: window.__exitIO.writes.length,
          destroys: window.__exitIO.destroys,
        },
        autosave: useSettingsStore.getState().settings.autoSaveEnabled,
      };
    });
    throw new Error(`${String(cause)}\nRuntime diagnostic: ${JSON.stringify(runtimeDiagnostic)}`);
  }
  await idle(page);
  await page.waitForFunction(() => Object.values(window.__exitIO.listeners)
    .some(listener => listener.event === "tauri://close-requested"));
  await page.evaluate(async enabled => {
    const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
    const { useSettingsStore } = await import("/src/store/settingsStore.ts");
    useRuntimeStore.getState().setRuntimeMode("fixed");
    useSettingsStore.getState().updateSettings({ autoSaveEnabled: enabled, textSpeedCps: 0 });
  }, autoSaveEnabled);
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor();
  await idle(page);
}

async function openExit(page) {
  await page.keyboard.press("Escape");
  await page.getByTestId("main-menu").waitFor();
  await idle(page);
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-screen").waitFor();
  await idle(page);
  await page.getByTestId("open-exit-confirmation").click();
  await page.getByRole("dialog", { name: "退出游戏？" }).waitFor();
}

async function geometry(page, label) {
  const result = await page.getByRole("dialog", { name: label, exact: true }).evaluate(panel => {
    const rect = panel.getBoundingClientRect();
    const buttons = [...panel.querySelectorAll("button")].map(button => {
      const r = button.getBoundingClientRect();
      return { label: button.textContent || button.getAttribute("aria-label"), rect: r.toJSON(),
        hit: button.disabled || button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
        clipped: button.scrollWidth > button.clientWidth + 1 };
    });
    return { rect: rect.toJSON(), buttons, width: innerWidth, height: innerHeight,
      focusInside: panel.contains(document.activeElement), overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert(result.rect.left >= 0 && result.rect.top >= 0 && result.rect.right <= result.width + 1
    && result.rect.bottom <= result.height + 1 && result.overflow <= 1, `${label}越界/横向溢出`);
  assert(result.focusInside, `${label}焦点不在最上层弹窗`);
  for (const button of result.buttons) {
    const r = button.rect;
    assert(button.hit && !button.clipped && r.left >= result.rect.left - 1
      && r.right <= result.rect.right + 1 && r.top >= result.rect.top - 1 && r.bottom <= result.rect.bottom + 1,
    `${label}按钮被遮挡/裁切：${button.label}`);
  }
  for (let i = 0; i < result.buttons.length; i++) for (let j = i + 1; j < result.buttons.length; j++) {
    const a = result.buttons[i].rect, b = result.buttons[j].rect;
    assert(!(Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1), `${label}按钮重叠`);
  }
  return result;
}

async function releaseWrites(page) {
  await page.evaluate(() => { window.__exitIO.mode = "ok"; window.__exitIO.pending.splice(0).forEach(item => item.resolve()); });
}

async function test(page, url, renpy, viewport) {
  const result = { viewport, layout: renpy ? "renpy" : "agentvn" };
  await page.addInitScript(installNativeIO);
  await initialize(page, url, renpy, true);
  await page.evaluate(() => {
    const listener = Object.values(window.__exitIO.listeners).find(item => item.event === "tauri://close-requested");
    window.__exitIO.callbacks[listener.handler]({ event: "tauri://close-requested", id: 100, payload: null });
  });
  await page.getByRole("dialog", { name: "退出游戏？" }).waitFor();
  assert.equal(await page.evaluate(() => window.__exitIO.destroys), 0, "App 的原生关闭监听必须阻止未确认关窗");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "退出游戏？" }).waitFor({ state: "hidden" });
  assert(await page.getByTestId("game-state-playing").isVisible(), "取消原生关窗不得退出剧情");
  result.nativeCloseWiring = "PASS";
  await openExit(page);
  await page.getByTestId("confirm-exit-game").dblclick();
  await page.waitForFunction(() => window.__exitIO.writes.length === 1);
  assert.equal(await page.evaluate(() => window.__exitIO.destroys), 0, "延迟保存完成前不得关窗");
  assert.equal(await page.getByTestId("confirm-exit-game").isDisabled(), true, "保存中禁止重复提交");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "退出游戏？" }).count(), 1, "保存中返回不得卸载退出流程");
  await releaseWrites(page);
  await page.waitForFunction(() => window.__exitIO.destroys === 1);
  assert.equal(await page.evaluate(() => window.__exitIO.saves[0]?.current_scene_id ?? window.__exitIO.saves[0]?.scene_id), "main",
    "退出必须写入真实剧情快照");
  result.delayedAutoSave = "PASS";

  await initialize(page, url, renpy, true);
  await page.evaluate(() => {
    window.__exitIO.mode = "fail";
    window.__exitIO.errorMessage = "中文目录写入失败 C:\\用户数据\\" + "保存路径不可用".repeat(60);
  });
  await openExit(page);
  await page.getByTestId("confirm-exit-game").click();
  await page.getByTestId("retry-exit-save").waitFor();
  assert.equal(await page.evaluate(() => window.__exitIO.destroys), 0, "失败不得关窗");
  result.failedGeometry = await geometry(page, "退出游戏？");
  await page.getByTestId("discard-exit-save").click();
  result.discardGeometry = await geometry(page, "确认放弃保存？");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  assert(await page.getByRole("dialog", { name: "确认放弃保存？" }).evaluate(panel => panel.contains(document.activeElement)),
    "嵌套确认焦点必须围栏在最上层");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("agentvn:system-back", { cancelable: true })));
  await page.getByRole("dialog", { name: "确认放弃保存？" }).waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("dialog", { name: "退出游戏？" }).count(), 1, "返回只关闭二次确认");
  await page.evaluate(() => { window.__exitIO.mode = "ok"; });
  await page.getByTestId("retry-exit-save").click();
  await page.waitForFunction(() => window.__exitIO.destroys === 1);
  result.retry = "PASS";

  await initialize(page, url, renpy, true);
  await page.evaluate(() => { window.__exitIO.mode = "fail"; });
  await openExit(page);
  await page.getByTestId("confirm-exit-game").click();
  await page.getByTestId("discard-exit-save").waitFor();
  await page.getByTestId("discard-exit-save").click();
  await page.getByTestId("confirm-discard-exit").click();
  await page.waitForFunction(() => window.__exitIO.destroys === 1);
  assert.equal(await page.evaluate(() => window.__exitIO.writes.length), 1, "明确放弃不重试写入");
  result.discard = "PASS";

  await initialize(page, url, renpy, false);
  await page.evaluate(async () => {
    const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
    window.__pendingManualSave = useRuntimeStore.getState().save({ kind: "manual", slot: 1 });
  });
  await page.waitForFunction(() => window.__exitIO.writes.length === 1);
  await openExit(page);
  assert.match(await page.getByRole("dialog", { name: "退出游戏？" }).innerText(), /自动保存已关闭.*不会新建/);
  await page.getByTestId("confirm-exit-game").click();
  // Wait two animation frames: the absence of an early close is a behavioral
  // assertion on the pending write, not a screenshot or an arbitrary sleep.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.__exitIO.destroys), 0, "关闭自动保存仍须等已有手动写入完成");
  await releaseWrites(page);
  await page.waitForFunction(() => window.__exitIO.destroys === 1);
  assert.equal(await page.evaluate(() => window.__exitIO.writes.length), 1, "禁用自动保存不得新建自动存档");
  result.disabledWaitsManual = "PASS";

  await initialize(page, url, renpy, false);
  await openExit(page);
  await page.getByTestId("confirm-exit-game").click();
  await page.waitForFunction(() => window.__exitIO.destroys === 1);
  assert.equal(await page.evaluate(() => window.__exitIO.writes.length), 0,
    "自动保存关闭且没有已有任务时，不能强制创建存档");
  result.disabledDoesNotSave = "PASS";
  if (renpy) {
    await initialize(page, url, renpy, true);
    await page.evaluate(() => { window.__exitIO.mode = "ok"; });
    await page.getByTestId("renpy-quick-save").click();
    await page.waitForFunction(() => window.__exitIO.saves.some(save => save.save_kind === "quick"));
    await page.locator(".dialog-box").click();
    await page.waitForFunction(() => document.querySelector(".story-player")?.getAttribute("data-current-command-index") === "1");
    await page.getByTestId("renpy-quick-load").click();
    await page.getByTestId("confirm-quick-load").click();
    await page.waitForFunction(() => document.querySelector(".story-player")?.getAttribute("data-current-command-index") === "0"
      && !document.querySelector(".game-launch-blackout"));
    await idle(page);
    const beforeExitWrites = await page.evaluate(() => {
      window.__exitIO.mode = "hold";
      return window.__exitIO.writes.length;
    });
    await openExit(page);
    await page.getByTestId("confirm-exit-game").click();
    await page.waitForFunction(count => window.__exitIO.writes.length === count + 1, beforeExitWrites);
    assert.equal(await page.evaluate(() => window.__exitIO.destroys), 0, "快读后的退出也必须等待当前自动档落盘");
    const pendingSave = await page.evaluate(() => {
      const save = window.__exitIO.writes.at(-1).save;
      return { kind: save.save_kind, scene: save.scene_id, command: save.command_index };
    });
    assert.deepEqual(pendingSave, { kind: "auto", scene: "main", command: 0 },
      "读取快存的去重标记不能让退出省略当前快照");
    await releaseWrites(page);
    await page.waitForFunction(() => window.__exitIO.destroys === 1);
    result.quickLoadExitSnapshot = { status: "PASS", actualUI: true, pendingSave };
  }
  const display = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const before = await display();
  assert.equal(before.width, viewport.width); assert.equal(before.height, viewport.height);
  assert.equal(before.dpr, Number(process.env.PROFILE_DPR || 1));
  assert.equal(before.reduced, process.env.EXIT_REDUCED === "1");
  const screenshot = path.join(output, `${renpy ? "renpy" : "agentvn"}-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: screenshot });
  assert.deepEqual(await display(), before);
  const png = fs.readFileSync(screenshot);
  assert.equal(png.readUInt32BE(16), before.width * before.dpr);
  assert.equal(png.readUInt32BE(20), before.height * before.dpr);
  result.display = before;
  result.screenshot = { path: screenshot, sha256: createHash("sha256").update(png).digest("hex") };
  return result;
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  let server, browser, page;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(output, "server.log") });
    report.service = { pid: server.pid, runId: server.runId, url: server.url };
    browser = await chromium.launch({args:process.env.RUNTIME_QA_GPU==="1"?["--use-angle=d3d11"]:[]});
    const viewports = process.env.EXIT_VIEWPORTS
      ? process.env.EXIT_VIEWPORTS.split(",").map(item => {
        const [width, height] = item.split("x").map(Number); return { width, height };
      })
        : process.env.EXIT_FAST === "1" ? [{ width: 1920, height: 1080 }] :
        [[1920, 1080], [2560, 1440], [3840, 2160]].map(([width, height]) => ({ width, height }));
    for (const viewport of viewports) for (const renpy of [true, false]) {
      await server.assertAlive();
      page = await browser.newPage({ viewport, hasTouch: viewport.width <= 915, deviceScaleFactor: Number(process.env.PROFILE_DPR || 1),
        reducedMotion: process.env.EXIT_REDUCED === "1" ? "reduce" : "no-preference" });
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      const result = await server.run(() => test(page, server.url, renpy, viewport));
      assert.deepEqual(errors, [], "退出流程不得产生未处理错误");
      await server.assertAlive();
      report.cases.push({ ...result, status: "PASS" });
      console.log(`PASS exit ${result.layout} ${viewport.width}x${viewport.height}`);
      await page.close(); page = undefined;
    }
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    await browser?.close(); await server?.stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
