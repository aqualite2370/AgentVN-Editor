"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const req = createRequire(path.join(root, "editor/package.json"));
const { chromium } = req("playwright");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/runtime-window-close-native", runId);
const exe = path.join(root, "editor/src-tauri/binaries/agentvn-player.exe");
const persistSave = process.argv.includes("--persist-save");
const computerObserve = process.argv.includes("--computer-observe");
const installId = `native-save-${crypto.randomUUID()}`;
const report = { runId, status: "RUNNING", scope: "native-player-help-and-close-not-installed-final",
  saveEvidence: persistSave
    ? "real native library mode; owned test cartridge; exit autosave read back after process restart"
    : "preview mode skips autosave; this run verifies native close wiring, not native save persistence",
  cases: [] };
const compiled = req("esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export { createRenpyUILayout } from './shared/cartridge/uiLayoutProfiles';
    export { exportEditorCartridge } from './editor/src/cartridge/exportCartridge';
  ` },
  bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
}).outputFiles[0].text;
const mod = { exports: {} };
new Function("module", "exports", "require", compiled)(mod, mod.exports, req);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function captureGlobalBlackout(page, action, expectedScreen) {
  await page.evaluate(() => {
    window.__nativeBlackoutCapture = true;
    window.__nativeBlackoutFrames = [];
    const sample = () => {
      const seam = document.querySelector("[data-runtime-screen-transition]");
      if (seam) {
        const rect = seam.getBoundingClientRect();
        window.__nativeBlackoutFrames.push({
          phase: seam.getAttribute("data-runtime-transition-phase"),
          presented: seam.getAttribute("data-runtime-presented-screen"),
          committed: seam.getAttribute("data-runtime-committed-screen"),
          opacity: Number(getComputedStyle(seam, "::before").opacity),
          viewport: { width: innerWidth, height: innerHeight },
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        });
      }
      if (window.__nativeBlackoutCapture) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await action();
  await page.waitForFunction(screen => {
    const seam = document.querySelector("[data-runtime-screen-transition]");
    return seam?.getAttribute("data-runtime-presented-screen") === screen
      && seam?.getAttribute("data-runtime-screen-transition") === "idle";
  }, expectedScreen, { timeout: 20000 });
  const frames = await page.evaluate(() => {
    window.__nativeBlackoutCapture = false;
    return window.__nativeBlackoutFrames;
  });

  const phases = new Set(frames.map(frame => frame.phase));
  assert(phases.has("covering") && phases.has("swap") && phases.has("revealing"),
    `native Player ${expectedScreen} navigation must cover, swap, and reveal`, frames);
  assert(frames.some(frame => frame.phase === "covering" && frame.opacity > 0 && frame.opacity < 1),
    `native Player ${expectedScreen} navigation must visibly cover with black`, frames);
  assert(frames.some(frame => frame.phase === "swap" && frame.opacity >= 0.99
    && frame.presented === expectedScreen && frame.committed === expectedScreen),
  `native Player ${expectedScreen} must swap beneath an opaque black cover`, frames);
  assert(frames.some(frame => frame.phase === "revealing" && frame.opacity > 0 && frame.opacity < 1),
    `native Player ${expectedScreen} navigation must visibly reveal from black`, frames);
  assert(frames.every(frame => frame.rect.x <= 0.5 && frame.rect.y <= 0.5
    && Math.abs(frame.rect.width - frame.viewport.width) <= 1
    && Math.abs(frame.rect.height - frame.viewport.height) <= 1),
  "native Player blackout surface must cover the full viewport", frames);
  return {
    expectedScreen,
    samples: frames.length,
    phases: [...phases],
    coverFrames: frames.filter(frame => frame.phase === "covering").length,
    opaqueSwapFrames: frames.filter(frame => frame.phase === "swap" && frame.opacity >= 0.99).length,
    revealFrames: frames.filter(frame => frame.phase === "revealing").length,
    maxOpacity: Math.max(...frames.map(frame => frame.opacity)),
  };
}
function stop(child) {
  if (child?.pid && child.exitCode === null)
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  let child, browser, page, port, baselineRecords, imported = false, record;
  async function connect() {
    child = spawn(exe, ["--mode", persistSave ? "library" : "preview",
      ...(!persistSave ? ["--cartridge", report.cartridge.path] : [])], {
      cwd: output, windowsHide: true, stdio: "ignore", env: { ...process.env,
        WEBVIEW2_USER_DATA_FOLDER: path.join(output, "webview"),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      },
    });
    report.pid = child.pid;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, "本轮 Runtime 提前退出");
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch {}
      await pause(300);
    }
    assert(browser, "本轮原生 WebView 未连通");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(10000);
  }
  const native = (command, args) => page.evaluate(({ command, args }) =>
    window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  async function launchOwnedCard() {
    await page.getByTestId("game-state-library").waitFor({ timeout: 60000 });
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.locator(".cartridge-spine").filter({ hasText: record.title }).click();
    await page.locator(".launch-panel").getByRole("button", { name: "启动卡带", exact: true }).click();
    await page.getByTestId("game-state-title").waitFor({ timeout: 60000 });
    await page.locator('[data-runtime-screen-transition="idle"]').waitFor();
  }
  try {
    port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const port = probe.address().port;
        probe.close(error => error ? reject(error) : resolve(port));
      });
    });
    const gameId = `native-exit-${runId}`;
    const title = `原生退出确认验收 ${runId}`;
    const uiSkin = mod.exports.createRenpyUILayout();
    uiSkin.screens.find(screen => screen.screen_id === "help").components[0].style = { color: "#12abcd" };
    const packed = await mod.exports.exportEditorCartridge({
      gameId, title, author: "QA", projectAssets: [], projectAssetRefs: [],
      uiSkin,
      script: { schema_version: "1.1.0", game_id: gameId, title, entry_scene_id: "main",
        characters: [], scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [],
          commands: [
            { type: "narration", text: "检查点一：本轮原生关窗测试，不使用玩家工程及存档。" },
            { type: "narration", text: "检查点二：此句必须在退出后重启恢复。" },
            { type: "narration", text: "检查点三：不能误读到此句。" },
          ] }] },
    });
    assert.deepEqual(packed.errors, []);
    const cartridge = path.join(output, "exit-native.vncart");
    fs.writeFileSync(cartridge, Buffer.from(await packed.blob.arrayBuffer()));
    report.cartridge = { path: cartridge, gameId, title,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(cartridge)).digest("hex"),
      generatedAt: fs.statSync(cartridge).birthtime.toISOString() };
    report.executable = { path: exe, modifiedAt: fs.statSync(exe).mtime.toISOString(),
      sha256: crypto.createHash("sha256").update(fs.readFileSync(exe)).digest("hex") };
    await connect();
    if (persistSave) {
      await page.getByTestId("game-state-library").waitFor({ timeout: 60000 });
      assert.equal((await native("get_launch_config")).mode, "library");
      baselineRecords = await native("list_installed_cartridges");
      assert(!baselineRecords.some(item => item.installId === installId || item.gameId === gameId),
        "测试 ID 不得占用已有玩家卡带");
      const now = new Date().toISOString();
      record = { installId, gameId, title, author: "QA", version: "1.0.0", language: "zh-CN",
        description: "Owned exit persistence test", coverAssetId: null, sourceFileName: path.basename(cartridge),
        installedAt: now, updatedAt: now, cartridgePath: "" };
      // Public native import boundary sets up only this unique test cartridge.
      // All subsequent navigation, saving and loading use production UI.
      imported = true; // finally must attempt cleanup even if import partly fails
      record = await native("import_cartridge_from_path", { sourcePath: cartridge, record });
      report.installId = installId;
      report.installedCartridgePath = record.cartridgePath;
      await launchOwnedCard();
    }
    await page.getByTestId("game-state-title").waitFor({ timeout: 60000 });
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await page.locator(".boot-overlay").waitFor({ state: "detached", timeout: 60000 });
    if (computerObserve) {
      fs.writeFileSync(path.join(output, "computer-use-ready.json"),
        JSON.stringify({ pid: child.pid, title, output, port }));
      console.log(`READY_FOR_COMPUTER_USE ${output}`);
      const deadline = Date.now() + 240000;
      while (!fs.existsSync(path.join(output, "computer-use-continue.json"))) {
        assert(Date.now() < deadline, "Computer Use observation timed out");
        assert.equal(child.exitCode, null, "观察期间自有 Runtime 提前退出");
        await pause(400);
      }
      report.computerUse = JSON.parse(fs.readFileSync(path.join(output, "computer-use-continue.json"), "utf8"));
    }
    report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      devicePixelRatio, physicalWidth: screen.width, physicalHeight: screen.height }));
    const helpTransition = await captureGlobalBlackout(
      page,
      () => page.getByTestId("open-help").click(),
      "help",
    );
    await page.locator('[data-ui-screen="help"]').waitFor();
    assert.equal(await page.locator(".help-card").evaluate(node => getComputedStyle(node).color),
      "rgb(18, 171, 205)", "真实原生帮助页必须使用独立布局样式");
    assert.match(await page.locator(".help-card").innerText(), /PageDown 恢复已回退的进度/);
    await page.screenshot({ path: path.join(output, "native-help.png") });
    report.cases.push({
      case: "native-help-independent-layout-and-global-blackout",
      status: "PASS",
      transition: helpTransition,
    });
    const titleTransition = await captureGlobalBlackout(
      page,
      () => page.getByTestId("renpy-menu-return").click(),
      "title_menu",
    );
    await page.getByTestId("game-state-title").waitFor();
    report.cases.push({
      case: "native-help-return-global-blackout",
      status: "PASS",
      transition: titleTransition,
    });
    const settingsTransition = await captureGlobalBlackout(
      page,
      () => page.getByTestId("open-settings").click(),
      "settings",
    );
    await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
    if (persistSave)
      await page.getByRole("checkbox", { name: "自动存档", exact: true }).check();
    const settingsReturnTransition = await captureGlobalBlackout(
      page,
      () => page.getByTestId("settings-finish").click(),
      "title_menu",
    );
    report.cases.push({
      case: "native-settings-roundtrip-global-blackout",
      status: "PASS",
      transitions: [settingsTransition, settingsReturnTransition],
    });
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }));
    const dialog = page.getByRole("dialog", { name: "退出游戏？", exact: true });
    await dialog.waitFor();
    assert.equal(child.exitCode, null, "未经确认不得关闭原生进程");
    assert(await dialog.evaluate(node => node.contains(document.activeElement)), "原生退出框未获得焦点");
    report.geometry = await dialog.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const buttons = [...node.querySelectorAll("button")].map(button => {
        const r = button.getBoundingClientRect();
        return { rect: r.toJSON(), clipped: button.scrollWidth > button.clientWidth + 1,
          hit: button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
      });
      return { rect: rect.toJSON(), buttons, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert(report.geometry.rect.left >= 0 && report.geometry.rect.top >= 0
      && report.geometry.rect.right <= report.viewport.width + 1
      && report.geometry.rect.bottom <= report.viewport.height + 1, "原生退出确认框越界");
    assert(report.geometry.overflow <= 1 && report.geometry.buttons.every(button => button.hit && !button.clipped),
      "原生退出确认按钮不可点击/裁切，或页面横向溢出");
    await page.screenshot({ path: path.join(output, "title-close-confirmation.png") });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(child.exitCode, null, "取消不得关闭窗口");
    report.cases.push({ case: "native-close-requires-confirmation-and-cancel-keeps-window", status: "PASS" });
    await page.getByTestId("start-new-game").click();
    await page.getByTestId("game-state-playing").waitFor();
    if (persistSave) {
      await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.includes("检查点一"));
      for (let attempt = 0; attempt < 4; attempt++) {
        if ((await page.locator(".dialog-text").innerText()).includes("检查点二")) break;
        await page.locator(".dialog-box").click();
        await pause(300);
      }
      await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.includes("检查点二"));
      report.savesBeforeExit = await native("list_saves", { installId });
      assert.equal(report.savesBeforeExit.length, 0,
        "需确认本次进度尚未落盘，不能把已存在存档当成退出保存证据");
    }
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }));
    await dialog.waitFor();
    await page.screenshot({ path: path.join(output, "playing-close-confirmation.png") });
    const exited = new Promise(resolve => child.once("exit", code => resolve(code)));
    await dialog.getByTestId("confirm-exit-game").click().catch(error => {
      if (!/closed/i.test(String(error))) throw error;
    });
    let timeout;
    const code = await Promise.race([exited, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("确认保存退出后原生进程未结束")), 20000);
    })]).finally(() => clearTimeout(timeout));
    assert.equal(code, 0, "已确认关窗必须正常退出");
    report.cases.push({ case: persistSave ? "confirmed-close-exits-native-after-current-checkpoint"
      : "playing-confirmation-destroys-native-window-preview-autosave-skipped", status: "PASS" });
    if (persistSave) {
      await browser.close().catch(() => {});
      browser = undefined; page = undefined;
      await connect();
      await page.getByTestId("game-state-library").waitFor({ timeout: 60000 });
      report.savesAfterRestart = await native("list_saves", { installId });
      const saved = report.savesAfterRestart.filter(save => save.save_kind === "auto");
      assert.equal(saved.length, 1, "重启后必须读到真实退出流程写入的自动存档");
      assert(JSON.stringify(saved[0]).includes("检查点二"), "退出保存不得落盘错误的推进位置");
      await launchOwnedCard();
      await page.getByTestId("continue-game").click();
      await page.getByTestId("game-state-playing").waitFor();
      await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.includes("检查点二"));
      await page.screenshot({ path: path.join(output, "restart-restored-checkpoint.png") });
      report.cases.push({ case: "restart-real-disk-autosave-and-UI-continue-restores-checkpoint", status: "PASS" });
      const savePath = path.join(path.dirname(path.dirname(record.cartridgePath)), "..", "saves", installId,
        `auto-${String(saved[0].slot).padStart(2, "0")}.json`);
      assert(fs.existsSync(savePath), "存档公开读取通过还需记录实际落盘路径");
      report.saveArtifact = { path: path.resolve(savePath),
        sha256: crypto.createHash("sha256").update(fs.readFileSync(savePath)).digest("hex"),
        generatedAt: fs.statSync(savePath).birthtime.toISOString(),
        cleanupScope: "owned test install only" };
      await page.keyboard.press("Escape");
      await page.getByTestId("main-menu").waitFor();
      await page.getByTestId("open-settings").click();
      await page.getByTestId("settings-screen").waitFor();
      await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
      await page.getByRole("checkbox", { name: "自动存档", exact: true }).uncheck();
      await page.getByTestId("settings-finish").click();
      // Settings returns to the game menu, not directly to narration.
      await page.getByTestId("main-menu").waitFor();
      await page.getByTestId("continue-game").click();
      await page.getByTestId("game-state-playing").waitFor();
      for (let attempt = 0; attempt < 4; attempt++) {
        if ((await page.locator(".dialog-text").innerText()).includes("检查点三")) break;
        await page.locator(".dialog-box").click();
        await pause(300);
      }
      await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent?.includes("检查点三"));
      await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }));
      const disabledDialog = page.getByRole("dialog", { name: "退出游戏？", exact: true });
      await disabledDialog.waitFor();
      assert.match(await disabledDialog.innerText(), /自动保存已关闭.*不会新建自动存档/);
      await page.screenshot({ path: path.join(output, "autosave-disabled-close-warning.png") });
      const disabledExit = new Promise(resolve => child.once("exit", code => resolve(code)));
      await disabledDialog.getByTestId("confirm-exit-game").click().catch(error => {
        if (!/closed/i.test(String(error))) throw error;
      });
      let disabledTimer;
      assert.equal(await Promise.race([disabledExit, new Promise((_, reject) => {
        disabledTimer = setTimeout(() => reject(Error("关闭自动保存后确认退出未结束")), 20000);
      })]).finally(() => clearTimeout(disabledTimer)), 0);
      assert.equal(crypto.createHash("sha256").update(fs.readFileSync(savePath)).digest("hex"),
        report.saveArtifact.sha256, "自动保存关闭后退出不得新建或改写原存档");
      await browser.close().catch(() => {});
      browser = undefined; page = undefined;
      await connect();
      await page.getByTestId("game-state-library").waitFor({ timeout: 60000 });
      assert.deepEqual(await native("list_saves", { installId }), report.savesAfterRestart,
        "关闭自动保存的退出不能静默追加新存档");
      report.cases.push({ case: "native-autosave-disabled-warning-exit-preserves-existing-save-bytes", status: "PASS" });
    }
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error);
    await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    if (imported) {
      try {
        if (!page || page.isClosed() || child?.exitCode !== null) {
          await browser?.close().catch(() => {});
          browser = undefined;
          await connect();
          await page.getByTestId("game-state-library").waitFor({ timeout: 60000 });
        }
        const remaining = await native("remove_installed_cartridge", { installId, deleteSaves: true });
        assert.deepEqual(remaining, baselineRecords, "必须保留原卡带库的全部玩家记录");
        assert.equal((await native("list_saves", { installId })).length, 0);
        if (record?.cartridgePath) {
          assert(!fs.existsSync(record.cartridgePath), "本轮测试卡带副本未清理");
        }
        report.testCartridgeCleanup = "PASS; own cartridge/saves removed; original library records preserved";
        if (report.saveArtifact) report.saveArtifact.cleaned = !fs.existsSync(report.saveArtifact.path);
      } catch (error) {
        report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1;
      }
    }
    stop(child);
    await browser?.close().catch(() => {});
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => {
        const finished = () => { clearTimeout(timer); child.removeListener("exit", finished); resolve(); };
        const timer = setTimeout(finished, 5000);
        child.once("exit", finished);
      });
    }
    report.cleanup = { ownedProcessStopped: !child || child.exitCode !== null || child.signalCode !== null };
    if (!report.cleanup.ownedProcessStopped) {
      report.status = "FAILED";
      report.cleanupError = "本轮原生 player 进程未结束";
      process.exitCode = 1;
    }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
    console.log(JSON.stringify({ status: report.status, cases: report.cases, error: report.error }));
  }
})();
