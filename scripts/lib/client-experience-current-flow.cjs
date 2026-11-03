"use strict";
// Active replacement for legacy final-e2e's force/store-injection path.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto"), net = require("node:net"), { execFileSync } = require("node:child_process");
const { chromium } = require("../../editor/node_modules/playwright");
const JSZip = require("../../editor/node_modules/jszip");
const { startEditorAcceptance } = require("./editor-ui-acceptance.cjs");
const { startOwnedViteServer } = require("./owned-vite-server.cjs");
const { settleEditor, settleRuntime } = require("./installed-acceptance.cjs");
const { captureSourceBrowser } = require("./source-browser-capture.cjs");
const root = path.resolve(__dirname, "../..");
const qa = "F:/AgentVN/QA/Client-Experience-Safe-20261020-01";
const summary = path.join(root, "output/client-experience-safe-20261020-01");
const legacyInput = path.join(qa, "客户端完整流程临时工程.vnproj");
const input = path.join(qa, "客户端完整流程base64临时工程.vnproj");
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const matrices = [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
  [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced,
    key: `${width}-dpr${dpr}-${reduced ? "reduce" : "normal"}` }))));
function identity(service) {
  const pids = [service.server?.pid || service.pid, service.backendPid].filter(Boolean);
  const ports = [service.url, service.backendUrl].filter(Boolean).map(u => Number(new URL(u).port));
  const result = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$rows=@(Get-CimInstance Win32_Process -Filter '${pids.map(n => `ProcessId=${n}`).join(" OR ")}'|Select-Object ProcessId,ExecutablePath,CreationDate);` +
    `$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess);` +
    `@{processes=$rows;listeners=$listeners}|ConvertTo-Json -Compress -Depth 5`],
  { encoding: "utf8", windowsHide: true }));
  assert.equal(result.processes.length, pids.length);
  for (const port of ports) assert(result.listeners.some(r => r.LocalPort === port && pids.includes(r.OwningProcess)));
  return result;
}
async function stopEvidence(services) {
  const ports = [];
  for (const s of services.filter(Boolean)) for (const url of [s.url, s.backendUrl].filter(Boolean)) {
    const port = Number(new URL(url).port);
    const listening = await new Promise(resolve => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
      socket.setTimeout(1000, () => { socket.destroy(); resolve(true); });
    });
    ports.push({ port, listening });
  }
  return { status: ports.every(p => !p.listening) ? "PASS" : "FAILED", ports };
}
async function safeHit(locator) {
  await locator.scrollIntoViewIfNeeded(); await locator.click({ trial: true });
  const value = await locator.evaluate(n => {
    const r = n.getBoundingClientRect();
    return { rect: r.toJSON(), hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      inViewport: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  });
  assert(value.hit && value.inViewport, JSON.stringify(value)); return value;
}
async function line(page, text) {
  await page.waitForFunction(text => {
    const box = document.querySelector(".dialog-box");
    return box?.getAttribute("aria-label")?.includes(text)
      && box.dataset.dialogPageDone === "true" && box.querySelector(".dialog-text")?.textContent?.includes(text);
  }, text, { timeout: 20000 });
}
async function sceneTransition(page, { name, kind, previous, current, sprite = false, exit = false }) {
  // Arm before actual input so a short but valid presentation cannot race
  // the observer. This is read-only per-frame instrumentation.
  await page.evaluate(({ kind, previous, current, sprite, exit }) => {
    window.__clientTransition = { frames: [], done: false, matched: false, startedAt: performance.now() };
    const sample = () => {
      const result = window.__clientTransition;
      const node = document.querySelector(sprite ? '.sprite-slot[data-character-id="hero"]' : ".background-layer");
      const frames = [...(node?.querySelectorAll(sprite ? ".sprite-replacement-frame" : ".background-transition-frame") || [])];
      const active = exit ? node?.getAttribute("data-runtime-animation-active") === "true"
        : sprite ? node?.getAttribute("data-sprite-replacement-active") === "true"
        : node?.getAttribute("data-transition-phase") === "active";
      const sameKind = exit || node?.getAttribute(sprite ? "data-sprite-transition-kind" : "data-transition-kind") === kind;
      const ids = frames.map(f => f.getAttribute(sprite ? "data-sprite-id" : "data-background-id"));
      const matched = active && sameKind && (exit || (ids.includes(previous) && ids.includes(current)));
      if (matched) result.matched = true;
      if (result.matched) result.frames.push({
        at: performance.now(), active, matched, ids, effectId: node?.getAttribute("data-runtime-effect-id"),
        values: (exit && node ? [...node.querySelectorAll(".sprite-animation-frame")] : frames).map(n => {
          const s = getComputedStyle(n);
          return { opacity: s.opacity, transform: s.transform, rect: n.getBoundingClientRect().toJSON() };
        }),
      });
      if (result.matched && !active) { result.done = true; return; }
      if (result.frames.length < 2000) result.raf = requestAnimationFrame(sample);
    };
    window.__clientTransition.raf = requestAnimationFrame(sample);
  }, { kind, previous, current, sprite, exit });
  await page.locator(".dialog-text").click();
  try {
    await page.waitForFunction(() => window.__clientTransition?.done, null, { timeout: 10000 });
    const observation = await page.evaluate(() => window.__clientTransition);
    const active = observation.frames.filter(f => f.matched);
    assert(active.length >= 2, `${name}: no continuous intermediate presentation`);
    const presentations = new Set(active.map(f => JSON.stringify(f.values.map(v => [v.opacity, v.transform]))));
    const reducedAuthoredExit = exit && await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    let policy = "CONTINUOUS_AUTHORED_TRANSITION", probe;
    if (reducedAuthoredExit) {
      // This is an authored scene effect, not a UI page/container transition.
      // Runtime intentionally settles custom WAAPI effects in reduced motion.
      // Verify the actual declared policy and final removal; never exempt the
      // other four transitions or ordinary-mode visuals from interpolation.
      probe = await page.evaluate(start => (window.__AGENTVN_RUNTIME_ANIMATION_LOG__ || [])
        .filter(e => e.time >= start), observation.startedAt);
      const effectIds = new Set(active.map(f => f.effectId).filter(Boolean));
      assert.equal(effectIds.size, 1, `${name}: expected one authored effect owner`);
      assert(probe.some(e => effectIds.has(e.effect_id) && e.event === "skipped"
        && e.details?.reason === "prefers-reduced-motion"), `${name}: no real reduced-motion skip event`);
      assert(!probe.some(e => effectIds.has(e.effect_id) && e.event === "animate-start"),
        `${name}: reduced effect unexpectedly started`);
      assert.equal(presentations.size, 1, `${name}: reduced effect not consistently settled`);
      policy = "REDUCED_AUTHORED_EFFECT_SETTLED";
    } else assert(presentations.size >= 2, `${name}: active flags without rendered visual change`);
    if (exit) assert.equal(await page.locator('.sprite-slot[data-character-id="hero"]').count(), 0);
    else {
      const final = observation.frames.at(-1);
      assert.deepEqual(final.ids, [current], `${name}: outgoing visual must be removed`);
    }
    return { name, policy, activeFrames: active.length, distinctPresentations: presentations.size, observation, probe };
  } finally { await page.evaluate(() => cancelAnimationFrame(window.__clientTransition?.raf)); }
}
async function run(api, options = {}) {
  const qa = options.qa || "F:/AgentVN/QA/Client-Experience-Safe-20261020-01";
  const summary = options.summary || path.join(root, "output/client-experience-safe-20261020-01");
  const input = options.input || path.join(qa, "客户端完整流程base64临时工程.vnproj");
  assert(path.resolve(qa).toLowerCase().startsWith("f:\\agentvn\\qa\\"));
  assert(path.resolve(input).startsWith(path.resolve(qa) + path.sep));
  if (Object.keys(options).length)
    assert(!process.argv.includes("--prepare") && !process.argv.includes("--prepare-base64"),
      "Repair overrides cannot prepare or replace fixtures");
  if (process.argv.includes("--prepare")) {
    const project = api.buildProject();
    project.project_id = "client-experience-safe-20261020-01";
    project.title = "标题按钮与演出完整流程 临时工程";
    fs.writeFileSync(input, JSON.stringify(project, null, 2), { flag: "wx" });
    fs.writeFileSync(path.join(summary, "fixture.json"), JSON.stringify({
      input, sha256: sha(input), projectId: project.project_id, generatedAt: new Date().toISOString(),
    }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: "PASS", input })); return;
  }
  if (process.argv.includes("--prepare-base64")) {
    const project = JSON.parse(fs.readFileSync(legacyInput));
    const assets = project.asset_manifest.map(asset => {
      const old = asset.metadata.data_url;
      assert(old.startsWith("data:image/svg+xml;charset=utf-8,"));
      const bytes = Buffer.from(decodeURIComponent(old.slice(old.indexOf(",") + 1)), "utf8");
      asset.metadata.data_url = `data:image/svg+xml;base64,${bytes.toString("base64")}`;
      asset.metadata.blob_url = asset.metadata.data_url;
      assert.deepEqual(Buffer.from(asset.metadata.data_url.split(",")[1], "base64"), bytes);
      return { id: asset.asset_id, bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
    });
    fs.writeFileSync(input, JSON.stringify(project, null, 2), { flag: "wx" });
    fs.writeFileSync(path.join(summary, "fixture-base64.json"), JSON.stringify({
      input, sha256: sha(input), originalInput: legacyInput, originalSha256: sha(legacyInput),
      assets, generatedAt: new Date().toISOString(),
      limitation: "Charset data URL loss remains FAILED in smoke-01/02/03; this byte-equivalent fixture only unblocks independent base64 workflow.",
    }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: "PASS", input, assets: assets.length })); return;
  }
  assert(process.env.AGENTVN_TEST_PROJECT && path.resolve(process.env.AGENTVN_TEST_PROJECT) === path.resolve(input),
    "Explicit isolated test project required");
  assert.equal(sha(input), JSON.parse(fs.readFileSync(options.fixtureManifest || path.join(summary, "fixture-base64.json"))).sha256);
  const output = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || "");
  assert(output.startsWith(path.resolve(qa) + path.sep) && !fs.existsSync(output), "Fresh isolated output required");
  const report = { status: "RUNNING", at: new Date().toISOString(), cases: [], checks: api.checks,
    modelRequests: 0, scope: "SOURCE_EDITOR_REAL_BACKEND_AND_RUNTIME_WEB_IMPORT_NOT_INSTALLED_NOT_NATIVE",
    testSources: ["scripts/client-experience-final-e2e-playwright.cjs", "scripts/lib/client-experience-current-flow.cjs"]
      .map(file => ({ file, sha256: sha(path.join(root, file)) })),
    fixture: { input, sha256: sha(input) } };
  const auditFile = options.auditFile || "F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-06/audit.json";
  if (options.auditFile) assert(path.resolve(auditFile).startsWith(path.resolve(qa) + path.sep));
  report.productSources = JSON.parse(fs.readFileSync(auditFile)).sourceChecks
    .filter(s => !s.path.includes(`${path.sep}scripts${path.sep}`))
    .map(s => {
      assert.equal(sha(s.path), s.actualSha256, `Candidate source changed: ${s.path}`);
      return { path: s.path, sha256: sha(s.path) };
    });
  for (const file of ["GameCli_framework/src/components/player/BackgroundLayer.tsx",
    "GameCli_framework/src/components/player/SpriteLayer.tsx",
    "GameCli_framework/src/components/player/runtimeAnimation.ts",
    "editor/src/utils/projectBundle.ts", "backend/app/services/project_state_service.py"]) {
    const source = path.join(root, file);
    assert(fs.existsSync(source), file);
    if (!report.productSources.some(s => s.path === source))
      report.productSources.push({ path: source, sha256: sha(source) });
  }
  const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  const before = ["AgentVN Dev.exe", "editor/src-tauri/binaries/agentvn-player.exe"].map(file => ({ file, sha256: sha(path.join(root, file)) }));
  let editor, runtime, browser, page;
  try {
    editor = await startEditorAcceptance(output);
    runtime = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(output, "runtime.log") });
    report.services = [
      { pid: editor.server.pid, backendPid: editor.backendPid, url: editor.url, backendUrl: editor.backendUrl, identity: identity(editor) },
      { pid: runtime.pid, url: runtime.url, identity: identity(runtime) },
    ]; persist();
    browser = await chromium.launch();
    const matrix = process.argv.includes("--smoke") ? matrices.slice(0, 1) : matrices;
    for (const m of matrix) {
      const row = { ...m, status: "RUNNING", checks: [], screenshots: [], transitions: [], findings: [], inputEvents: [], requests: [] };
      report.cases.push(row); persist();
      const context = await browser.newContext({ viewport: { width: m.width, height: m.height },
        deviceScaleFactor: m.dpr, reducedMotion: m.reduced ? "reduce" : "no-preference", acceptDownloads: true });
      page = await context.newPage(); page.setDefaultTimeout(30000);
      const errors = []; page.on("pageerror", e => errors.push(String(e)));
      await page.exposeFunction("__clientInputEvidence", e => row.inputEvents.push(e));
      await page.addInitScript(() => {
        for (const type of ["pointerdown", "pointerup", "click"]) document.addEventListener(type, e => {
          const target = e.target instanceof Element ? e.target.closest("button") : null;
          if (target?.matches('[data-help-key="toolbar.saveProject"]'))
            window.__clientInputEvidence({ type, trusted: e.isTrusted, text: target.textContent,
              rect: target.getBoundingClientRect().toJSON(), at: performance.now() });
        }, true);
      });
      page.on("requestfailed", r => row.requests.push({ url: r.url(), failure: r.failure() }));
      page.on("response", r => {
        if (r.url().includes("/api/"))
          row.requests.push({ url: r.url(), status: r.status(), method: r.request().method() });
      });
      await context.route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
        if (route.request().method() !== "POST") return route.continue();
        report.modelRequests++; return route.abort();
      });
      try {
        await editor.server.run(async () => {
          await editor.open(page); await settleEditor(page);
          await page.evaluate(async () => {
            const store = (await import("/src/store/editorStore.ts")).useEditorStore;
            window.__clientNotices = [];
            store.subscribe((state, previous) => {
              if (state.lastError !== previous.lastError && state.lastError)
                window.__clientNotices.push({ at: performance.now(), notice: state.lastError });
            });
          });
          await page.locator('[data-workspace-surface="options"]:visible').click();
          await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
          await page.locator('[data-help-key="layout.screen"]:visible').getByText("标题主页", { exact: true }).click();
          const component = page.locator('.runtime-layout-component-list button[data-component-id="title_custom_text_e2e"]');
          await safeHit(component); await component.click();
          const label = page.locator('[data-help-key="layout.customButton.label"]');
          await label.fill("官网入口"); await label.press("Tab");
          await page.locator('[data-help-key="layout.save"]:visible').click();
          await page.waitForFunction(() => document.querySelector('[data-help-key="layout.save"]')?.getAttribute("data-save-state") === "saved");
          row.checks.push("Real top options/layout/component input and save");
          row.screenshots.push(await captureSourceBrowser(page, path.join(output, `${m.key}-editor.png`),
            { width: m.width, height: m.height, dpr: m.dpr, reduced: m.reduced }));
          await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
          const pendingSave = page.waitForEvent("download");
          await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
          const saved = path.join(output, `${m.key}.vnproj`); await (await pendingSave).saveAs(saved);
          await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
          const z = await JSZip.loadAsync(fs.readFileSync(saved)), p = JSON.parse(await z.file("project.json").async("string"));
          assert.equal(p.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "title")
            .components.find(c => c.component_id === "title_custom_text_e2e").label, "官网入口");
          row.project = { path: saved, sha256: sha(saved) }; row.checks.push("Real portable download contains authored label");
          await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
          await page.locator('[data-package-stage="settings"]').click();
          await page.locator('[data-help-key="package.mode"]').click();
          await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
          const warning = page.getByRole("button", { name: "查看并确认警告", exact: true });
          if (await warning.isVisible()) await warning.click();
          const consent = page.locator('[data-help-key="package.confirmWarnings"]');
          if (await consent.isVisible()) await consent.check();
          const exportButton = page.locator('[data-help-key="package.export"]:visible');
          await safeHit(exportButton); const pending = page.waitForEvent("download"); await exportButton.click();
          const file = path.join(output, `${m.key}.vncart`); await (await pending).saveAs(file);
          const verified = await api.verifyCartridge(file);
          row.cartridge = { path: file, sha256: sha(file), gameId: verified.manifest.game_id };
          row.checks.push("Real publishing download preserves assets, custom actions and authored transition configs");
        });
        await runtime.run(async () => {
          await api.installWindowOpenInterceptor(context);
          await page.goto(`${runtime.url}/?mode=library`); await settleRuntime(page);
          await page.evaluate(async () => { window.__safeClientLibrary = (await import("/src/store/libraryStore.ts")).useLibraryStore; });
          await page.getByTestId("web-cartridge-file").setInputFiles(row.cartridge.path);
          await page.waitForFunction(gameId => {
            const s = window.__safeClientLibrary.getState();
            const game = s.games.find(g => g.install_id === s.selectedInstallId);
            return !s.importing && !s.loading && !s.error && game?.manifest.game_id === gameId;
          }, row.cartridge.gameId);
          await page.getByRole("button", { name: "启动卡带", exact: true }).click(); await settleRuntime(page);
          for (const id of ["title_custom_text_e2e", "title_custom_image_e2e", "title_custom_link_e2e"])
            await safeHit(page.locator(`[data-ui-component-id="${id}"]`));
          await api.verifyTitleButtonsAndLink(page);
          row.checks.push("Real player file/library/title consumes custom text/image; intercepted safe external action");
          row.screenshots.push(await captureSourceBrowser(page, path.join(output, `${m.key}-title.png`),
            { width: m.width, height: m.height, dpr: m.dpr, reduced: m.reduced }));
          await page.getByTestId("start-new-game").click(); await settleRuntime(page);
          await line(page, "背景 A 已就位");
          for (const [text, config] of [
            ["背景 B 已进入", { name: "background-crossfade", kind: "crossfade", previous: "bg_a", current: "bg_b" }],
            ["背景 C 完成", { name: "background-slide", kind: "slide_left", previous: "bg_b", current: "bg_c" }],
          ]) { row.transitions.push(await sceneTransition(page, config)); await line(page, text); }
          await page.locator(".dialog-text").click(); await line(page, "角色 A 已显示");
          await page.locator('.sprite-slot[data-character-id="hero"][data-sprite-id="hero_a"]').waitFor();
          for (const [text, config] of [
            ["角色 B 完成", { name: "sprite-crossfade", kind: "crossfade", previous: "hero_a", current: "hero_b", sprite: true }],
            ["角色 C 完成", { name: "sprite-slide", kind: "slide_up", previous: "hero_b", current: "hero_c", sprite: true }],
            ["角色退出动画完成", { name: "sprite-exit", kind: "fade", current: "hero_c", sprite: true, exit: true }],
          ]) {
            try { row.transitions.push({ ...await sceneTransition(page, config), status: "PASS" }); }
            catch (e) {
              const observation = await page.evaluate(() => window.__clientTransition);
              row.transitions.push({ name: config.name, status: "FAILED", error: String(e.stack || e), observation });
              row.findings.push({ name: config.name, error: String(e.message || e) });
            }
            await line(page, text);
          }
          row.checks.push(row.findings.length === 0
            ? "Five authored background/sprite/exit transitions have real intermediate frames and single final owner"
            : "Five authored transitions sampled; visual failures retained in findings, not treated as PASS");
          assert.deepEqual(errors, []);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
          row.screenshots.push(await captureSourceBrowser(page, path.join(output, `${m.key}-end.png`),
            { width: m.width, height: m.height, dpr: m.dpr, reduced: m.reduced }));
          row.checks.push("Final dialogue reached with clean exceptions and no horizontal overflow");
        });
        assert.equal(row.checks.length, 6); row.status = row.findings.length ? "FAILED" : "PASS"; persist();
        console.log(`${row.status} ${m.key}`);
      } catch (e) {
        row.status = "FAILED"; row.error = String(e.stack || e);
        row.failedTransitionObservation = await page.evaluate(() => window.__clientTransition).catch(() => null);
        row.diagnostic = await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 3500),
          notices: window.__clientNotices, tauri: "__TAURI_INTERNALS__" in window })).catch(() => null);
        await page.screenshot({ path: path.join(output, `${m.key}-failure.png`), scale: "device" }).catch(() => {});
        persist();
      } finally { await context.close(); }
    }
    assert.equal(report.cases.length, matrix.length); assert.equal(report.modelRequests, 0);
    report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
    if (report.status !== "PASS") process.exitCode = 1;
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    await browser?.close();
    await runtime?.stop(); await editor?.stop();
    if (!fs.existsSync(output)) fs.mkdirSync(output, { recursive: true });
    report.cleanup = await stopEvidence([editor, runtime]);
    if (report.cleanup.status !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
    for (const a of before) assert.equal(sha(path.join(root, a.file)), a.sha256);
    for (const a of report.productSources) assert.equal(sha(a.path), a.sha256);
    report.productsUnchanged = before; report.finishedAt = new Date().toISOString(); persist();
    console.log(JSON.stringify({ status: report.status, output, error: report.error }));
  }
}
module.exports = { run, sceneTransition, line };
