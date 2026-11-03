"use strict";
// Narrow reproduction of an actual installed React #185, without model calls,
// product modifications or repeating the authoring display matrix. Optional
// real UI exports and read-only React probes are explicitly diagnostic only.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { installedFeatureSession } = require("./lib/installed-candidate-feature-session.cjs");
const { settleEditor, settleRuntime, select } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Installed-Portrait-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const pendingPreview = process.argv.includes("--pending-preview");
const actualExport = process.argv.includes("--actual-export");
const traceReact = process.argv.includes("--trace-react");
const refreshDraft = process.argv.includes("--refresh-draft");
assert(!refreshDraft || !pendingPreview, "Draft refresh requires an initialized preview first");
const { runtimeRenderDiagnosticInit } = require("./lib/runtime-render-diagnostic.cjs");
const iterationsArg = process.argv.find(s => s.startsWith("--iterations="));
const iterations = iterationsArg ? Number(iterationsArg.split("=")[1]) : 3;
assert(Number.isInteger(iterations) && iterations >= 1 && iterations <= 9);
const JSZip = require("../editor/node_modules/jszip");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const sourcePath = path.join(qa, "editor-03/report.json"), source = read(sourcePath), prep = read(path.join(qa, "preparation.json"));
assert.equal(source.status, "FAILED"); assert(source.errors.some(e => e.includes("#185")));
assert.equal(source.cleanupError, undefined); assert.equal(source.steps.length, 6); assert(source.steps.every(s => s.status === "PASS"));
const out = path.join(qa, `diagnostic-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), steps: [], launches: [], cleanups: [], errors: [],
  pendingPreview, actualExport, traceReact, refreshDraft, iterations,
  screenshots: [], modelRequests: 0, source: { path: sourcePath, sha256: sha(sourcePath) },
  scope: "NARROW_ACTUAL_INSTALLED_LAYOUT_PREVIEW_PUBLISH_RENDER_ERROR_REPRO_NOT_ACCEPTANCE" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedFeatureSession({ out, report, save, profileRoot: path.dirname(source.launches[0].data), testProject: prep.input.path });
let page, protectedCache = false;
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.resolve(__dirname, "installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 30000 }); assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function action(name, fn) {
  report.currentAction = name; const item = { name, startedAt: new Date().toISOString() }; report.steps.push(item); save();
  try {
    await fn();
    if (traceReact) {
      item.renderTraces = [];
      for (const frame of page.frames().filter(f => f.url().includes("/gamecli-preview/"))) {
        try { item.renderTraces.push(await frame.evaluate(() => ({ url: location.href,
          ghost: !!frameElement?.closest(".toolbar-popover-morph-ghost"), trace: window.__agentvnRenderTrace }))); }
        catch (error) { item.renderTraces.push({ transientDetachedFrame: String(error) }); }
      }
    }
    item.frames = page.frames().map(f => f.url()); item.errors = report.errors.length; item.status = "COMPLETED";
    if (report.errors.length) throw Error("Observed installed render exception");
  } finally { item.finishedAt = new Date().toISOString(); save(); }
}
async function exportCartridge(type, iteration) {
  for (const [key, value] of [["gameId", prep.projectId], ["title", "头像布局安装版验收"],
    ["author", "AgentVN QA"], ["description", "隔离小工程，专用对白头像布局。"]])
    await page.locator(`[data-help-key="package.${key}"]`).fill(value);
  const warning = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warning.isVisible()) await warning.click();
  const consent = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await consent.isVisible()) await consent.check();
  const directory = path.join(out, `export-${iteration}-${type}`); fs.mkdirSync(directory);
  await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory, eventsEnabled: true });
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-help-key="package.export"]').click()]);
  const name = download.suggestedFilename(); assert.equal(path.basename(name), name);
  const file = path.join(directory, name);
  await until(() => fs.existsSync(file) && !fs.existsSync(file + ".crdownload"), "real UI export", 60000);
  assert.equal(await download.failure(), null);
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  assert.equal(layout.layout_type ?? "agentvn", type); assert.deepEqual(layout.dialogPortrait, prep.values[type]);
  (report.exports ??= []).push({ type, iteration, path: file, sha256: sha(file), at: new Date().toISOString() }); save();
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
  cache("Prepare"); protectedCache = true;
  page = await host.start();
  if (traceReact) await page.context().addInitScript(runtimeRenderDiagnosticInit);
  await page.exposeFunction("__portraitDiagnosticError", details => {
    (report.frameErrors ??= []).push({ at: new Date().toISOString(), action: report.currentAction, ...details }); save();
  });
  await page.context().addInitScript(() => {
    // Read-only telemetry for new preview frames, including presentation clones.
    addEventListener("error", event => {
      const node = document.querySelector(".dialog-box");
      let owner;
      try {
        owner = { ghost: !!frameElement?.closest(".toolbar-popover-morph-ghost"),
          parentClass: frameElement?.parentElement?.className, frameRect: frameElement?.getBoundingClientRect().toJSON() };
      } catch { owner = { inaccessible: true }; }
      void window.__portraitDiagnosticError?.({ url: location.href, message: event.message,
        renderTrace: window.__agentvnRenderTrace,
        stack: event.error?.stack, owner, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        dialog: node ? { rect: node.getBoundingClientRect().toJSON(), pages: node.getAttribute("data-dialog-pages") } : null });
    });
  });
  for (const event of ["frameattached", "framenavigated", "framedetached"]) page.on(event, frame => {
    (report.frameLifecycle ??= []).push({ event, at: new Date().toISOString(), action: report.currentAction, url: frame.url() }); save();
  });
  page.on("console", msg => {
    if (!/Maximum update depth|Minified React error|above error occurred/i.test(msg.text())) return;
    (report.reactConsole ??= []).push({ at: new Date().toISOString(), action: report.currentAction,
      type: msg.type(), location: msg.location(), text: msg.text().slice(0, 14000) }); save();
  });
  await host.cdp.send("Runtime.enable");
  host.cdp.on("Runtime.exceptionThrown", e => {
    (report.exceptions ??= []).push({ at: new Date().toISOString(), action: report.currentAction, details: e.exceptionDetails }); save();
  });
  await settleEditor(page);
  await action("home-open-isolated-project", async () => {
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: prep.title }).click(); await settleEditor(page);
  });
  for (let iteration = 0; iteration < iterations; iteration++) for (const type of ["agentvn", "renpy"]) {
    await action(`${iteration}-${type}-open-options-and-layout`, async () => {
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
      const button = page.locator(`[data-layout-type-option="${type}"]:visible`);
      if (await button.getAttribute("aria-pressed") !== "true") await button.click();
      await page.locator(`.runtime-layout-designer[data-layout-type="${type}"]`).waitFor();
      await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
      await settleEditor(page);
    });
    await action(`${iteration}-${type}-${pendingPreview ? "player-no-extra-preview-wait" : "player-preview-ready"}`, async () => {
      const entry = page.getByTestId("renpy-player-layout-entry"); if (await entry.isVisible()) await entry.click();
      await page.locator('[data-help-key="layout.screen"]:visible').getByText("播放页", { exact: true }).click();
      await settleEditor(page);
      const toggle = page.getByRole("button", { name: "实际 Runtime 预览", exact: true });
      if (await toggle.isVisible()) await toggle.click();
      const target = page.locator('.renpy-editor-runtime-viewport iframe');
      await target.waitFor({ state: "attached" });
      (report.previewMounts ??= []).push({ iteration, type, at: new Date().toISOString(),
        pending: pendingPreview, ...await target.evaluate(node => ({
          ghost: !!node.closest(".toolbar-popover-morph-ghost"), src: node.getAttribute("src"),
          phase: node.closest("[data-preview-phase]")?.getAttribute("data-preview-phase"),
          rect: node.getBoundingClientRect().toJSON(),
        })) });
      assert.equal(report.previewMounts.at(-1).ghost, false);
      assert(report.previewMounts.at(-1).src.includes("/gamecli-preview/")); save();
      if (pendingPreview) {
        const controls = page.getByTestId("dialog-portrait-layout-editor"); await controls.waitFor();
        if (!await controls.evaluate(n => n.open)) await controls.locator("summary").click();
        return;
      }
      await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
      const frame = await (await target.elementHandle()).contentFrame();
      assert(frame); await settleRuntime(frame);
      await frame.locator('img[data-portrait-ready="true"]').waitFor();
      if (traceReact && !report.packagedChunk) {
        const chunkUrl = "/gamecli-preview/assets/StoryPlayer-CN3mkFec.js";
        const text = await frame.evaluate(async url => {
          const response = await fetch(url);
          if (!response.ok) throw Error(`Installed asset ${response.status}`);
          return response.text();
        }, chunkUrl);
        const file = path.join(out, "installed-StoryPlayer-CN3mkFec.js"); fs.writeFileSync(file, text, { flag: "wx" });
        const local = path.resolve(__dirname, "../editor/dist", chunkUrl.slice(1));
        assert.equal(sha(file), sha(local));
        report.packagedChunk = { path: file, sha256: sha(file), actualAssetUrl: frame.url().split("?")[0] + "assets/StoryPlayer-CN3mkFec.js",
          source: "ACTUAL_INSTALLED_WEBVIEW_TAURI_ASSET_FETCH", localSameBytes: local }; save();
      }
      if (refreshDraft) {
        const controls = page.getByTestId("dialog-portrait-layout-editor");
        if (!await controls.evaluate(n => n.open)) await controls.locator("summary").click();
        const input = controls.getByRole("spinbutton", { name: "头像水平偏移", exact: true });
        const initialValue = await input.inputValue(); assert.equal(Number(initialValue), prep.values[type].offsetX);
        await input.fill(String(Number(initialValue) - 1)); await input.press("Tab");
        await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="loading"]').waitFor();
        await input.fill(initialValue); await input.press("Tab");
        (report.pendingDraftRefreshes ??= []).push({ type, iteration, at: new Date().toISOString(),
          initialValue, restoredValue: await input.inputValue(),
          phase: await page.locator(".renpy-editor-runtime-viewport").getAttribute("data-preview-phase"),
          realAuthorInput: true, waitForRefreshedRuntimeReady: false }); save();
      }
    });
    await action(`${iteration}-${type}-save-current-layout`, async () => {
      await page.locator('[data-help-key="layout.save"]:visible').click();
      await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
    });
    await action(`${iteration}-${type}-publish${actualExport ? "-export" : ""}-and-close`, async () => {
      await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
      const modal = page.getByTestId("package-environment-operation-dialog");
      await until(async () => {
        if (await modal.isVisible()) return ["completed", "failed"].includes(await modal.getAttribute("data-environment-phase"));
        const settings = page.locator('[data-package-stage="settings"]');
        if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") {
          await settings.click(); return false;
        }
        const mode = page.locator('[data-help-key="package.mode"]');
        if (await mode.isVisible() && (await mode.innerText()).includes(".vncart")) return true;
        const button = page.locator('[data-help-key="package.export"]');
        return await button.count() && ["passed", "failed"].includes(await button.getAttribute("data-environment-status"));
      }, "environment terminal before publishing navigation", 60000);
      if (await modal.isVisible()) {
        const phase = await modal.getAttribute("data-environment-phase");
        (report.environmentChecks ??= []).push({ at: new Date().toISOString(), phase, text: await modal.innerText(),
          scope: "Protected native cache Junction; not normal-path Windows export" }); save();
        await modal.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
        await modal.waitFor({ state: "detached" });
      }
      await page.locator('[data-package-stage="settings"]').click();
      await page.locator('[data-help-key="package.mode"]').waitFor();
      await page.locator('[data-help-key="package.mode"]').click();
      await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
      if (actualExport) await exportCartridge(type, iteration);
      await page.locator('[data-help-key="package.close"]:visible').click(); await settleEditor(page);
    });
  }
  assert.equal(report.previewMounts.length, iterations * 2);
  if (traceReact) {
    const traces = report.steps.flatMap(s => s.renderTraces ?? []).filter(t => t.trace?.rendererCount > 0);
    assert(traces.some(t => t.trace.snapshots.some(s => s.dialogs.length)),
      "QA probe must observe a real Runtime DialogBox commit, not only an empty or uninitialized iframe");
    assert(traces.every(t => t.trace.errors.length === 0), "QA probe must not throw");
    report.traceCoverage = { actualRendererFrames: traces.length,
      dialogCommitsObserved: traces.flatMap(t => t.trace.snapshots).filter(s => s.dialogs.length).length };
  }
  assert.equal(report.modelRequests, 0); report.status = "NOT_REPRODUCED_ORIGINAL_FAILURE_REMAINS_OPEN";
})().catch(async e => {
  report.error = String(e.stack || e); report.status = report.errors.some(e => e.includes("#185")) ? "REPRODUCED" : "DIAGNOSTIC_FAILED";
  if (page && !page.isClosed()) {
    report.failureDOM = await page.locator("body").innerText().catch(String);
    await host.shot("observed").catch(e => { report.screenshotError = String(e); });
  }
    if (report.status === "DIAGNOSTIC_FAILED") process.exitCode = 1;
}).finally(async () => {
    try {
      await host.stop("End narrow installed render diagnostic");
      if (protectedCache) {
        cache("Restore"); report.nativeCacheRestoration = path.join(out, "native-cache-restoration.json");
      }
      for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256);
    }
  catch (e) { report.cleanupError = String(e.stack || e); report.status = "DIAGNOSTIC_FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, errors: report.errorEvents, error: report.error, cleanupError: report.cleanupError }));
});
