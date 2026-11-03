"use strict";
// Ship-bound verification: actual installed Editor UI exports both layouts;
// the installed native Player consumes those bytes. No source Vite or store API.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { spawn, spawnSync } = require("node:child_process"), net = require("node:net");
const { gzipSync } = require("node:zlib");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const [auditFile, portableFile, output] = process.argv.slice(2), out = path.resolve(output || "");
assert(auditFile && portableFile && output && out.startsWith("F:\\AgentVN\\QA\\") && !fs.existsSync(out));
assert(!process.env.E5_LIFECYCLE_SOURCE);
fs.mkdirSync(out);
fs.copyFileSync(auditFile, path.join(out, "installer-resource-report.json"));
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "INSTALLED_EDITOR_REAL_UI_EXPORT_INSTALLED_PLAYER_MIXED_PRESENTATION_HIDE_MATRIX",
  modelRequests: 0, artifacts: [], cases: [], cleanup: [], screenshots: [],
  boundaries: { physical4K: false, Android: false, nativePicker: false, avatar: false,
    inputs: "mouse/keyboard; controlled system-back event explicitly labelled; no injected runtime store",
    storyFixture: "controlled temporary project via public backend import",
    UIChanges: false, fullRuntimeAcceptance: false } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let owner, browser, editor, editorCdp, player, playerBrowser, target, runtimeCdp;
function killPlayer() {
  if (!player) return;
  const owned = player; player = undefined;
  const result = owned.exitCode !== null || owned.signalCode !== null ? 0
    : spawnSync("taskkill.exe", ["/PID", String(owned.pid), "/T", "/F"], { windowsHide: true }).status;
  report.cleanup.push({ kind: "player", pid: owned.pid, exitCode: result }); assert.equal(result, 0);
}
async function options() {
  const closePublish = editor.getByRole("button", { name: "关闭发布与打包", exact: true });
  if (await closePublish.isVisible()) {
    await closePublish.click();
    await editor.locator(".toolbar-popover.cartridge:not(.toolbar-popover-morph-ghost) .cartridge-export-panel")
      .waitFor({ state: "hidden" });
  }
  await editor.locator('[data-workspace-surface="options"]:visible').click();
  await editor.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(editor);
}
async function position() {
  return target.locator(".story-player").evaluate(e => ({
    scene: e.getAttribute("data-current-scene-id"), index: e.getAttribute("data-current-command-index"),
    text: document.querySelector(".dialog-box")?.textContent,
    nvl: document.querySelector(".nvl-page")?.getAttribute("data-nvl-total-lines"),
    background: document.querySelector(".background-layer")?.getAttribute("data-background-id"),
    mode: document.querySelector(".dialog-box")?.getAttribute("data-dialogue-layout-mode"),
  }));
}
async function readyText() {
  await target.waitForFunction(() => document.querySelector(".story-player")?.getAttribute("data-is-typing") === "false");
}
async function expand(layout) {
  if (layout === "agentvn" && await target.getByTestId("quick-menu-toggle").getAttribute("aria-expanded") !== "true") {
    await target.getByTestId("quick-menu-toggle").click(); await A.settleRuntime(target);
  }
}
function hideControl(layout) {
  return layout === "renpy" ? target.getByTestId("renpy-quick-hide")
    : target.getByRole("button", { name: "隐藏界面", exact: true });
}
async function transition(action, hidden) {
  await target.evaluate(() => {
    window.__installedHideTrace = { done: false, frames: [] };
    const collect = time => {
      const trace = window.__installedHideTrace; if (trace.done) return;
      const e = document.querySelector(".story-interface"), r = e?.getBoundingClientRect();
      trace.frames.push({ time, opacity: e ? Number(getComputedStyle(e).opacity) : null, inert: e?.inert,
        rect: r?.toJSON(), scenes: document.querySelectorAll(".story-player").length,
        invalidFocus: Boolean(document.activeElement?.closest("[inert],[aria-hidden=true]")),
        overflow: document.documentElement.scrollWidth - innerWidth });
      if (trace.frames.length < 600) requestAnimationFrame(collect);
    };
    requestAnimationFrame(collect);
  });
  await action();
  await target.waitForFunction(value => {
    const e = document.querySelector(".story-interface");
    return e && Number(getComputedStyle(e).opacity) === (value ? 0 : 1) && e.inert === value;
  }, hidden);
  const frames = await target.evaluate(() => {
    window.__installedHideTrace.done = true; return window.__installedHideTrace.frames;
  });
  assert(frames.filter(f => f.opacity > .001 && f.opacity < .999).length >= 2, "Actual continuous opacity frames");
  assert(frames.every(f => f.scenes === 1 && !f.invalidFocus && f.overflow <= 1));
  return frames;
}
async function hiddenUi() {
  assert.equal(await target.getByTestId("story-interface").getAttribute("aria-hidden"), "true");
  const leaks = await target.locator(".dialog-box,.playback-controls,.choice-panel,.runtime-custom-component").evaluateAll(elements =>
    elements.filter(e => {
      let opacity = 1, blocked = false;
      for (let p = e; p; p = p.parentElement) {
        const style = getComputedStyle(p); opacity *= Number(style.opacity);
        blocked ||= p.inert || style.display === "none" || style.visibility === "hidden";
      }
      return opacity > .001 || !blocked;
    }).map(e => e.className));
  assert.deepEqual(leaks, []);
}
async function startGame() {
  await target.getByTestId("start-new-game").waitFor(); await A.settleRuntime(target);
  await target.getByTestId("start-new-game").click();
  await target.getByTestId("game-state-playing").waitFor(); await A.settleRuntime(target); await readyText();
}
async function assertMenu(layout, expected) {
  await expand(layout);
  const selector = layout === "renpy" ? ".renpy-quick-bar button" : ".quick-menu-action-layer button";
  const boxes = await target.locator(selector).evaluateAll(elements => elements.map(e => {
    const r = e.getBoundingClientRect();
    return { ...r.toJSON(), disabled: e.disabled,
      hit: e.disabled || e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
  }));
  assert.equal(boxes.length, layout === "renpy" ? 9 : 7);
  assert(boxes.every(r => r.hit && r.left >= 0 && r.top >= 0 && r.right <= expected.width && r.bottom <= expected.height));
  for (let i = 1; i < boxes.length; i++) {
    if (layout === "renpy") {
      assert(Math.abs(boxes[i].top - boxes[0].top) < 1);
      assert(boxes[i].left >= boxes[i - 1].right - 1);
    } else {
      assert(Math.abs(boxes[i].left - boxes[0].left) < 1);
      assert(boxes[i].top >= boxes[i - 1].bottom - 1);
    }
  }
  if (layout === "agentvn") {
    const collapse = await target.getByTestId("quick-menu-toggle").boundingBox(); assert(collapse);
    assert(collapse.x >= 0 && collapse.y >= 0 && collapse.x + collapse.width <= expected.width
      && collapse.y + collapse.height <= expected.height);
    assert.equal(await target.locator(".playback-controls").getAttribute("data-quick-menu-direction"), "up");
  }
  return boxes;
}
(async () => {
  const packed = await JSZip.loadAsync(fs.readFileSync(portableFile));
  const project = JSON.parse(await packed.file("project.json").async("string"));
  const fixture = structuredClone(project);
  fixture.project_id = `installed_hide_${path.basename(out)}`; fixture.title = "安装版显隐矩阵隔离工程";
  fixture.nodes.find(n => n.type === "sceneNode").data.scene.commands = [
    { type: "background", background_id: "qa_background" },
    { type: "narration", text: "普通对白。" },
    { type: "narration", presentation_mode: "nvl", text: "累积第一句。" },
    { type: "narration", presentation_mode: "nvl", text: "累积第二句。" },
    { type: "narration", presentation_mode: "bubble", text: "上部安全气泡。" },
    ...Array.from({ length: 20 }, (_, i) => ({ type: "narration", text: `后续第${i + 1}句。` })),
  ];
  for (const asset of fixture.asset_manifest) {
    const bytes = await packed.file(asset.metadata.project_path).async("nodebuffer");
    asset.metadata.data_url = `data:${asset.metadata.mime_type};base64,${bytes.toString("base64")}`;
    for (const key of ["project_path", "backend_asset_path", "url"]) delete asset.metadata[key];
  }
  const input = path.join(out, "安装版显隐矩阵.vnproj"); fs.writeFileSync(input, JSON.stringify(fixture), { flag: "wx" });
  process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = out;
  report.environment = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out };
  report.fixtureSource = { path: portableFile, sha256: A.sha256(fs.readFileSync(portableFile)) };
  owner = await startInstalledEditor(out); const state = owner.state;
  report.installedEditor = A.readInstalledSession(out).executable;
  const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`, {
    method: "POST", headers: { "content-type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input) });
  assert(response.ok, await response.text());
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  editor = browser.contexts()[0].pages().find(p => p.url().startsWith("http://tauri.localhost")); assert(editor);
  editor.setDefaultTimeout(30000); editorCdp = await browser.contexts()[0].newCDPSession(editor);
  await editorCdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await editor.reload();
  await editor.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: fixture.title }).click();
  await editor.locator(".editor-toolbar").waitFor(); await options();
  const before = await A.projectSnapshot(state.backendPort), exported = {};
  // Legacy projects may not have the dual-layout collection yet. The first
  // real save/export is the migration boundary; capture the resulting
  // collection there instead of dereferencing a missing legacy profile.
  let expectedProfiles = before.settings.runtimeUILayoutProfiles?.profiles
    ? structuredClone(before.settings.runtimeUILayoutProfiles.profiles) : undefined;
  for (const layout of ["agentvn", "renpy"]) {
    report.stage = `installed-editor-export-${layout}`; save();
    await options(); await editor.locator(`[data-layout-type-option="${layout}"]`).click();
    const confirm = editor.getByRole("button", { name: "放弃并切换", exact: true });
    if (await confirm.isVisible()) await confirm.click();
    await editor.waitForFunction(type => document.querySelector(`[data-layout-type-option="${type}"]`)?.getAttribute("aria-pressed") === "true", layout);
    await editor.locator('[data-help-key="layout.save"]:visible').click();
    await editor.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent.includes("已保存"));
    await editor.locator('[data-workspace-surface="publish"]:visible').click();
    const publish = editor.locator(".cartridge-export-panel"); await publish.waitFor();
    await editor.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
    await A.dismissEnvironmentCompletion(editor);
    // The publish workspace retains its last selected stage across openings.
    // Navigate through the visible settings entry before selecting the format.
    await publish.locator('[data-package-stage="settings"]').click();
    await publish.locator('[data-help-key="package.mode"]').click();
    await editor.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    await publish.locator('[data-package-stage="checks"]').click();
    const warning = publish.getByRole("checkbox", { name: /我已检查全部警告/ }); if (await warning.count()) await warning.check();
    const folder = path.join(out, layout); fs.mkdirSync(folder);
    const artifact = await A.realDownload(editor, editorCdp, folder, publish.locator(".package-primary-action"));
    const archive = await JSZip.loadAsync(fs.readFileSync(artifact.path));
    const skin = JSON.parse(await archive.file("ui/layout.json").async("string"));
    assert.equal(skin.layout_type || "agentvn", layout);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    assert.equal(manifest.runtime_version, "0.25.0");
    const after = await A.projectSnapshot(state.backendPort);
    const actualProfiles = after.settings.runtimeUILayoutProfiles?.profiles;
    assert(actualProfiles && actualProfiles[layout], `Saved layout profile missing: ${layout}`);
    assert.equal(actualProfiles[layout].target_runtime, manifest.runtime_version,
      "Active saved profile must declare the actual newly required Runtime");
    const missingExpectedProfile = !expectedProfiles || !expectedProfiles[layout];
    if (missingExpectedProfile) {
      expectedProfiles = structuredClone(actualProfiles);
      (report.derivedVersionUpdates ||= []).push({
        layout, kind: "legacy-profile-migration",
        missingBeforeSave: true,
      });
    } else {
      if (expectedProfiles[layout].target_runtime !== manifest.runtime_version) {
        (report.derivedVersionUpdates ||= []).push({ layout, from: expectedProfiles[layout].target_runtime, to: manifest.runtime_version });
        expectedProfiles[layout].target_runtime = manifest.runtime_version;
      }
      assert.deepEqual(actualProfiles, expectedProfiles,
        "Switch/save/export must preserve both authored profiles");
    }
    exported[layout] = artifact; report.artifacts.push({ layout, ...artifact }); save();
  }
  const matrix = [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
    [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
  for (const layout of ["agentvn", "renpy"]) {
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer(); probe.on("error", reject); probe.listen(0, "127.0.0.1", () => {
        const p = probe.address().port; probe.close(() => resolve(p)); });
    });
    const exe = path.join(state.installRoot, "agentvn-player.exe");
    report.playerExecutable = { path: exe, sha256: A.sha256(fs.readFileSync(exe)) };
    player = spawn(exe, ["--mode", "preview", "--cartridge", exported[layout].path], {
      cwd: state.installRoot, windowsHide: true, stdio: "ignore", env: { ...process.env,
        WEBVIEW2_USER_DATA_FOLDER: path.join(out, `${layout}-player-webview`),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
    const identity = { layout, pid: player.pid, port }; (report.players ||= []).push(identity); save();
    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      assert.equal(player.exitCode, null);
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready); playerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    target = playerBrowser.contexts()[0].pages()[0]; target.setDefaultTimeout(20000);
    runtimeCdp = await playerBrowser.contexts()[0].newCDPSession(target);
    const errors = []; target.on("pageerror", error => errors.push(String(error)));
    for (const expected of matrix) {
      report.stage = `${layout}-${expected.width}-${expected.dpr}-${expected.reduced}`; save(); console.log(`START ${report.stage}`);
      await runtimeCdp.send("Emulation.setDeviceMetricsOverride", { width: expected.width, height: expected.height,
        deviceScaleFactor: expected.dpr, mobile: false });
      await target.emulateMedia({ reducedMotion: expected.reduced ? "reduce" : "no-preference" });
      await target.reload(); await startGame();
      const buttons = await assertMenu(layout, expected), before = await position(), trace = [];
      assert.equal(before.background, "qa_background"); assert.equal(before.mode, "dialog");
      trace.push(...await transition(() => hideControl(layout).click(), true)); await hiddenUi();
      assert.deepEqual(await position(), before);
      trace.push(...await transition(() => target.mouse.click(expected.width / 2, expected.height / 3), false));
      assert.deepEqual(await position(), before, "Restoring pointer input must not advance");
      assert.equal(await hideControl(layout).evaluate(e => e === document.activeElement), true);
      for (const input of ["h", "Escape", "controlled-system-back"]) {
        trace.push(...await transition(() => target.keyboard.press("h"), true)); await hiddenUi();
        trace.push(...await transition(() => input === "controlled-system-back"
          ? target.evaluate(() => window.dispatchEvent(new Event("agentvn:system-back", { cancelable: true })))
          : target.keyboard.press(input), false));
        assert.deepEqual(await position(), before, `${input} only restores current UI`);
      }
      trace.push(...await transition(async () => {
        await target.keyboard.press("h");
        await target.waitForFunction(() => {
          const opacity = Number(getComputedStyle(document.querySelector(".story-interface")).opacity);
          return opacity > .05 && opacity < .95;
        });
        await target.keyboard.press("h");
      }, false));
      assert.deepEqual(await position(), before);
      for (const mode of ["nvl", "nvl", "bubble"]) {
        const previous = await position(); await readyText();
        await target.locator(".dialog-box").click();
        await target.waitForFunction(index => Number(document.querySelector(".story-player")?.getAttribute("data-current-command-index")) === Number(index) + 1, previous.index);
        await readyText(); const atMode = await position(); assert.equal(atMode.mode, mode);
        if (mode === "nvl") assert(Number(atMode.nvl) >= 1);
        trace.push(...await transition(() => target.keyboard.press("h"), true)); await hiddenUi();
        trace.push(...await transition(() => target.keyboard.press("Escape"), false));
        assert.deepEqual(await position(), atMode, `${mode} text and accumulation preserved`);
      }
      if (expected.width === 1920 && expected.dpr === 1 && !expected.reduced) {
        await expand(layout);
        const auto = layout === "renpy" ? target.getByTestId("renpy-quick-auto")
          : target.getByRole("button", { name: "开启自动播放", exact: true });
        await auto.click();
        const active = layout === "renpy" ? target.getByTestId("renpy-quick-auto")
          : target.getByRole("button", { name: "关闭自动播放", exact: true });
        assert.equal(await active.getAttribute("aria-pressed"), "true");
        const atAuto = await position();
        trace.push(...await transition(() => target.keyboard.press("h"), true));
        await target.waitForTimeout(5000); // Negative observation beyond the default automatic delay.
        assert.deepEqual(await position(), atAuto, "Automatic playback is suspended while hidden");
        trace.push(...await transition(() => target.keyboard.press("h"), false));
        assert.equal(await active.getAttribute("aria-pressed"), "true", "Original automatic mode resumes");
        await active.click();
      }
      fs.writeFileSync(path.join(out, `${report.stage}-frames.json.gz`), gzipSync(JSON.stringify(trace)), { flag: "wx" });
      report.screenshots.push(await captureInstalledWebview(target, runtimeCdp, path.join(out, `${report.stage}.png`), expected));
      assert.deepEqual(errors, []);
      report.cases.push({ layout, ...expected, status: "PASS", frameCount: trace.length, buttons }); save();
    }
    await playerBrowser.close(); playerBrowser = undefined; target = undefined; runtimeCdp = undefined; killPlayer();
  }
  assert.equal(report.cases.length, 24); assert.equal(report.artifacts.length, 2); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  const page = target || editor;
  try {
    const cdp = runtimeCdp || editorCdp, shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(out, "failure.png"), Buffer.from(shot.data, "base64"));
    if (target) fs.writeFileSync(path.join(out, "failure-state.json"), JSON.stringify(await position(), null, 2));
  } catch {}
}).finally(async () => {
  await playerBrowser?.close(); await browser?.close();
  try { killPlayer(); } catch (error) { report.status = "FAILED"; report.cleanupError = String(error); process.exitCode = 1; }
  if (owner) {
    const result = await owner.stop(); report.cleanup.push({ kind: "editor/backend", ...result });
    if (result.editor.exitCode || result.backend.exitCode) { report.status = "FAILED"; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, stage: report.stage, error: report.error, out }));
});
