"use strict";
// Actual current Dev UI export -> unchanged external Player. No paid models.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const net = require("node:net"), assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright"), JSZip = require("../editor/node_modules/jszip");
const { nativeSession, until, rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const A = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-01";
const checkpoint = "F:/AgentVN/Checkpoints/Native-Assistant-Consume-20261020-01";
const summary = path.join(root, "output/native-assistant-consume-20261020-01");
const oldReport = "F:/AgentVN/QA/Native-Assistant-Review-20261020-01/session-06/report.json";
const load = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(root, f), sha256: sha(path.resolve(root, f)) });
function prepare() {
  assert(!fs.existsSync(checkpoint) && !fs.existsSync(summary));
  fs.mkdirSync(checkpoint, { recursive: true }); fs.mkdirSync(summary, { recursive: true });
  const prior = load(oldReport); assert.equal(prior.status, "CURRENT_NATIVE_CONTROLLED_WINDOW_REVIEW_MERGE_PASS");
  const snapshots = [];
  for (const f of ["scripts/native-assistant-consume.cjs", "scripts/lib/current-native-editor-session.cjs",
    "scripts/native-dev-preview-profile.ps1", "scripts/lib/owned-process-tree.cjs",
    "editor/src/components/assistant/AssistantCreationWorkbenchWindow.tsx",
    "editor/src/components/assistant/assistant-creation-workbench.css", "editor/src/cartridge/exportCartridge.ts",
    "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
    const target = path.join(checkpoint, f); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, f), target, fs.constants.COPYFILE_EXCL); snapshots.push(desc(target));
  }
  assert.equal(sha(prior.projectArtifact.path), prior.projectArtifact.sha256);
  fs.copyFileSync(prior.projectArtifact.path, path.join(checkpoint, "input.vnproj"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(summary, "preparation.json"), JSON.stringify({ at: new Date().toISOString(),
    input: desc(path.join(checkpoint, "input.vnproj")), prior: desc(oldReport), products: prior.products,
    sources: prior.sources, snapshots }, null, 2), { flag: "wx" });
}
async function run(iteration) {
  assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, `assistant-consume-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = load(path.join(summary, "preparation.json")), prior = load(prep.prior.path);
  const report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "CURRENT_DEV_REAL_UI_EXPORT_AND_CURRENT_PREVIEW_PLAYER_NOT_RELEASE_INSTALL_SETUP_ANDROID",
    products: prep.products, sources: prep.sources, input: prep.input, prior: prep.prior,
    launches: [], cleanups: [], errors: [], screenshots: [], steps: [], gestures: [], modelRequests: 0,
    productChanges: 0, devPublicationBuilds: 0, boundary: "Public import setup; actual DOM input; no native file-picker proof." };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const editor = nativeSession({ out, input: prep.input.path, report, save });
  let page, player, playerRoot, playerBrowser, playerPage, playerCdp, journal = false;
  const knownPlayer = new Map(), identity = p => `${p.ProcessId}:${p.Created}`;
  const tool = path.join(root, "scripts/native-dev-preview-profile.ps1");
  const view = { width: 1920, height: 1080, dpr: 1, reduced: false };
  function profile(action) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tool,
      "-Action", action, "-RunDirectory", out, "-Storage", "Junction"], { encoding: "utf8", windowsHide: true, timeout: 45000 });
    fs.writeFileSync(path.join(out, `profile-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
    assert.equal(r.status, 0, r.stderr);
  }
  function rememberPlayer() {
    const now = rows(); if (player) {
      const tree = ownedProcessTree(now, player.pid, playerRoot?.Created);
      if (tree.length) playerRoot = tree[0];
      for (const p of tree) knownPlayer.set(identity(p), p);
    }
    report.playerKnown = [...knownPlayer.values()]; save(); return now;
  }
  async function step(name, fn) {
    const row = { name, status: "RUNNING" }; report.steps.push(row); save(); console.log(`START ${name}`);
    try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; } finally { save(); }
  }
  async function move(locator, dx, dy) {
    const r = await locator.boundingBox(); assert(r);
    const x = r.x + Math.min(30, r.width / 2), y = r.y + r.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
  }
  const rect = w => w.evaluate(n => ({ rect: n.getBoundingClientRect().toJSON(),
    style: n.getAttribute("style"), transform: getComputedStyle(n).transform,
    animations: n.getAnimations().map(a => ({ state: a.playState, time: a.currentTime })) }));
  try {
    for (const f of [...prep.products, ...prep.sources, prep.input, prep.prior]) assert.equal(sha(f.path), f.sha256);
    page = await editor.start();
    page.on("request", r => {
      if (r.method() === "POST" && /\/api\/assistant\/(creation\/processes|chat)/.test(r.url())) report.modelRequests++;
    });
    const imported = await fetch(`http://127.0.0.1:${editor.current.ports[0]}/api/project/projects/import`, { method: "POST",
      headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": "input.vnproj" },
      body: fs.readFileSync(prep.input.path), signal: AbortSignal.timeout(30000) });
    assert(imported.ok && (await imported.json()).ok);
    await page.reload(); await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: prior.baseline.id ? "Dev审核隔离 A" : "never" }).click();
    await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
    const projectId = prior.baseline.id;
    const importedProject = (await editor.api(`/api/project/projects/${projectId}`)).data;
    report.importedProject = importedProject;
    assert.deepEqual(importedProject.editor_settings.runtimeUILayoutProfiles, prior.merged.settings.runtimeUILayoutProfiles);
    await step("window-fast-gesture-observation", async () => {
      await page.locator('[data-workspace-surface="assistant"]:visible').click(); await A.settleEditor(page);
      const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
      await panel.getByRole("button", { name: "创造模式", exact: true }).click();
      await page.evaluate(() => {
        window.__QA_FAST_GESTURE__ = { events: [], styles: [], attempt: 0 };
        const state = window.__QA_FAST_GESTURE__;
        for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "gotpointercapture", "lostpointercapture"]) {
          const fn = e => {
            const host = e.target instanceof Element && e.target.closest('[data-testid="assistant-creation-workbench-window"]');
            if (host) state.events.push({ attempt: state.attempt, type, time: performance.now(), x: e.clientX, y: e.clientY,
              id: e.pointerId, buttons: e.buttons, target: e.target.className, style: host.getAttribute("style") });
          };
          document.addEventListener(type, fn, true);
          (state.listeners ??= []).push([type, fn]);
        }
        const observer = new MutationObserver(changes => {
          for (const m of changes) if (m.target.matches?.('[data-testid="assistant-creation-workbench-window"]'))
            state.styles.push({ attempt: state.attempt, time: performance.now(), style: m.target.getAttribute("style"),
              gesture: m.target.dataset.gestureActive });
        });
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["style", "data-gesture-active"] });
        state.observer = observer;
      });
      for (let i = 0; i < 20; i++) {
        await page.evaluate(i => { window.__QA_FAST_GESTURE__.attempt = i; }, i);
        if (i > 0) {
          await page.locator('[data-workspace-surface="assistant"]:visible').click(); await A.settleEditor(page);
          await panel.getByRole("button", { name: "创造模式", exact: true }).click();
        }
        await panel.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true }).click();
        const w = page.getByTestId("assistant-creation-workbench-window"); await w.getByLabel("向大模型助手提问", { exact: true }).waitFor();
        const before = await rect(w);
        await move(w.locator(".assistant-creation-workbench-titlebar"), 90, 55);
        const dragged = await rect(w);
        await move(w.getByRole("separator", { name: "调整创造工作台大小", exact: true }), -100, -80);
        const resized = await rect(w);
        const row = { attempt: i, before, dragged, resized,
          widthPass: Math.abs(resized.rect.width - dragged.rect.width + 100) < 2,
          heightPass: Math.abs(resized.rect.height - dragged.rect.height + 80) < 2 };
        report.gestures.push(row); save();
        await w.getByRole("button", { name: "恢复默认位置和尺寸", exact: true }).click();
        await w.getByRole("button", { name: "关闭工作台", exact: true }).click(); await w.waitFor({ state: "detached" });
      }
      report.gestureTrace = await page.evaluate(() => {
        const s = window.__QA_FAST_GESTURE__;
        s.observer.disconnect(); for (const [type, fn] of s.listeners) document.removeEventListener(type, fn, true);
        return { events: s.events, styles: s.styles };
      });
      const bad = report.gestures.filter(g => !g.widthPass || !g.heightPass);
      report.windowObservation = { attempts: 20, mismatches: bad.length,
        status: bad.length ? "REPRODUCED" : "NOT_REPRODUCED_ORIGINAL_UNRESOLVED" };
      // Diagnostic result, not a product PASS merely because the collector ran.
      return report.windowObservation;
    }).catch(error => {
      report.windowObservation = { status: "COLLECTOR_FAILED", attempts: report.gestures.length,
        mismatches: report.gestures.filter(g => !g.widthPass || !g.heightPass).length, error: String(error) };
      save();
    });
    await step("actual-dev-publish-ui-exports-merged-candidates-and-byte-exact-dependencies", async () => {
      await page.locator('[data-workspace-surface="publish"]:visible').click(); await A.settleEditor(page);
      const environment = page.getByRole("dialog").filter({ hasText: "环境检测已完成" });
      await environment.waitFor({ timeout: 60000 }); await A.dismissEnvironmentCompletion(page);
      await page.locator('[data-help-key="package.mode"]').click();
      await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
      const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
      if (await warnings.isVisible()) await warnings.click();
      const confirm = page.locator('[data-help-key="package.confirmWarnings"]');
      if (await confirm.isVisible()) await confirm.check();
      const destination = path.join(out, "cartridge"); fs.mkdirSync(destination);
      report.cartridge = await A.realDownload(page, editor.cdp, destination, page.locator('[data-help-key="package.export"]'));
      report.cartridge.source = "Actual current Dev WebView publish click and completed download; not installed Release";
      const zip = await JSZip.loadAsync(fs.readFileSync(report.cartridge.path), { checkCRC32: true });
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      const bytes = await zip.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(bytes.toString("utf8"));
      assert.equal(manifest.game_id, projectId);
      const components = layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
      const expected = importedProject.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
      assert.equal(components.length, 2); assert.deepEqual(components, expected); assert(!JSON.stringify(components).includes("排除候选"));
      report.cartridge.layoutSha256 = A.sha256(bytes); report.cartridge.assets = [];
      for (const a of manifest.assets) {
        const payload = await zip.file(a.path).async("nodebuffer"); assert.equal(A.sha256(payload), prior.image.sha256);
        report.cartridge.assets.push({ id: a.asset_id, path: a.path, sha256: A.sha256(payload), bytes: payload.length });
      }
      assert.equal(report.cartridge.assets.length, 2, "Only two actually referenced authorized image copies should be exported");
      await editor.shot("real-ui-export-complete"); return report.cartridge;
    });
    await editor.stop("Editor export complete; exact ownership cleanup, not normal close");
    journal = true; profile("Prepare");
    await step("external-current-player-renders-exported-components-and-executes-whitelisted-actions", async () => {
      const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => {
        const p = s.address().port; s.close(() => resolve(p)); }); });
      assert.equal(listeners([port]).length, 0);
      const exe = prep.products.find(p => p.path.endsWith("agentvn-player.exe"));
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/.test(k)) delete env[k];
      Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "player-webview"),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary") });
      player = spawn(exe.path, ["--mode", "preview", "--cartridge", report.cartridge.path],
        { cwd: out, env, windowsHide: true, stdio: "ignore" });
      report.player = { pid: player.pid, port, exe, mode: "preview", notStandaloneSetup: true }; save(); rememberPlayer();
      await until(async () => { rememberPlayer(); assert.equal(player.exitCode, null);
        return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }, "current Player CDP", 60000);
      assert(listeners([port]).every(l => [...knownPlayer.values()].some(p => p.ProcessId === l.OwningProcess)));
      playerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      playerPage = playerBrowser.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tauri.localhost")); assert(playerPage);
      playerPage.setDefaultTimeout(30000); playerPage.on("pageerror", e => report.errors.push(String(e)));
      playerCdp = await playerPage.context().newCDPSession(playerPage);
      await playerCdp.send("Emulation.setDeviceMetricsOverride", { width: view.width, height: view.height, deviceScaleFactor: 1, mobile: false });
      await playerPage.emulateMedia({ reducedMotion: "no-preference" }); await readInstalledViewport(playerPage, view);
      await playerPage.getByTestId("game-state-title").waitFor(); await A.settleRuntime(playerPage);
      assert.equal(await playerPage.getByTestId("runtime-custom-component").count(), 2);
      assert.equal(await playerPage.getByRole("button", { name: "排除候选操作", exact: true }).count(), 0);
      for (const name of ["审核关于卡徽章", "审核帮助卡徽章"])
        await playerPage.getByRole("img", { name, exact: true }).evaluate(img => img.decode());
      report.playerActions = [];
      for (const [name, screen] of [["审核关于卡操作", "about"], ["审核帮助卡操作", "help"]]) {
        const button = playerPage.getByRole("button", { name, exact: true });
        const geometry = await button.evaluate(n => { const r = n.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { rect: r.toJSON(), hit: h === n || n.contains(h), overflow: document.documentElement.scrollWidth - innerWidth }; });
        assert(geometry.hit && geometry.overflow <= 1); await button.click();
        await playerPage.waitForFunction(s => document.querySelector("[data-runtime-screen-transition]")
          ?.getAttribute("data-runtime-presented-screen") === s, screen);
        await A.settleRuntime(playerPage);
        report.playerActions.push({ name, screen, geometry, status: "PASS" });
        await playerPage.keyboard.press("Escape"); await playerPage.getByTestId("game-state-title").waitFor(); await A.settleRuntime(playerPage);
      }
      report.screenshots.push(await captureInstalledWebview(playerPage, playerCdp, path.join(out, "external-player-two-components.png"), view));
      await playerPage.getByTestId("start-new-game").click(); await playerPage.getByTestId("game-state-playing").waitFor(); await A.settleRuntime(playerPage);
      assert.match(await playerPage.locator("body").innerText(), /本轮独立 UI 验收/);
      report.player.originalStoryAction = "PASS"; rememberPlayer();
      return { components: 2, actions: report.playerActions, storyStarted: true };
    });
    assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []);
    report.status = report.windowObservation.status === "COLLECTOR_FAILED"
      ? "EXPORT_CONSUMPTION_PASS_WINDOW_COLLECTOR_FAILED"
      : report.windowObservation.mismatches ? "EXPORT_CONSUMPTION_PASS_WINDOW_FAILURE_REPRODUCED"
        : "EXPORT_CONSUMPTION_PASS_WINDOW_ORIGINAL_FAILURE_UNRESOLVED";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-6000);
      await editor.shot("failure").catch(() => {});
    }
  } finally {
    try { await editor.stop("final exact owned Editor cleanup"); }
    catch (e) { report.editorCleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    try {
      await playerBrowser?.close().catch(() => {});
      rememberPlayer(); const killed = [];
      for (const p of [...knownPlayer.values()].reverse()) {
        if (!rows().some(a => identity(a) === identity(p))) continue;
        ps(`$owned=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
          `if($owned -and $owned.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
        killed.push(identity(p));
      }
      const current = rows();
      report.playerCleanup = { killed, normalCloseClaimed: false,
        survivors: [...knownPlayer.values()].filter(p => current.some(n => identity(n) === identity(p))),
        listeners: report.player ? listeners([report.player.port]) : [] };
      assert.equal(report.playerCleanup.survivors.length, 0); assert.equal(report.playerCleanup.listeners.length, 0);
      if (journal && fs.existsSync(path.join(out, "profile-protection.json"))) {
        profile("Restore"); report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
      }
    } catch (e) { report.playerCleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    try { for (const f of [...prep.products, ...prep.sources, prep.input, prep.prior]) assert.equal(sha(f.path), f.sha256); }
    catch (e) { report.immutabilityError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, window: report.windowObservation }));
  }
}
(async () => { if (process.argv[2] === "prepare") prepare(); else await run(process.argv[2]); })()
  .catch(e => { console.error(e); process.exitCode = 1; });
