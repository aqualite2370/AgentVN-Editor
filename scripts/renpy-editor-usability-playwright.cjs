"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { createHash } = require("node:crypto");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const A = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const attempt = process.argv[2];
assert.match(attempt, /^(red|green)-\d{2}$/);
const root = path.resolve(__dirname, "..");
const installed = process.argv[3] === "--installed";
const preflightOnly = installed && process.argv[6] === "--preflight";
assert(process.argv.length === (installed ? (preflightOnly ? 7 : 6) : 3),
  "Use attempt [--installed actual-installation-audit fresh-output [--preflight]]");
const out = installed ? path.resolve(process.argv[5]) : `F:/AgentVN/QA/Renpy-Editor-Usability-20261026/${attempt}`;
let installation;
if (installed) {
  assert.notEqual(process.env.E5_LIFECYCLE_SOURCE, "1", "Installed acceptance cannot use the source lifecycle override");
  assert(A.inside("F:/AgentVN/QA", out), "Installed QA output must remain under F:/AgentVN/QA");
  installation = JSON.parse(fs.readFileSync(path.resolve(process.argv[4]), "utf8"));
  assert.equal(installation.status, "PASS");
  const deployments = installation.deployments.filter(item => item.kind === "NSIS actual isolated installation");
  assert.equal(deployments.length, 1, "Require an actual installation; extracted payloads are not installed evidence");
  const deployment = deployments[0];
  const payloads = installation.deployments.filter(item => item.kind === "NSIS actual payload"
    && item.executable?.sha256 === deployment.executable?.sha256);
  assert.equal(payloads.length, 1, "Actual installation must match one verified NSIS payload");
  const installationProof = JSON.parse(fs.readFileSync(deployment.installationReport, "utf8"));
  assert.equal(installationProof.status, "PASS");
  assert.equal(installationProof.registryRestored, true, "Prior installation registry cleanup must have completed");
  assert.equal(path.resolve(installationProof.installRoot), path.resolve(deployment.installedRoot));
  assert.equal(installationProof.executable.sha256, deployment.executable.sha256);
  const provenance = payloads[0].runtimeProvenance;
  assert(provenance?.some(item => item.name === "creator-backend.exe"), "Backend provenance is required");
  for (const artifact of [deployment.executable, ...provenance]) {
    assert.equal(A.sha256(fs.readFileSync(path.join(deployment.installedRoot,
      artifact.name || "agentvn-editor.exe"))), artifact.sha256, "Installed bytes differ from the verified deployment");
  }
  if (preflightOnly) {
    console.log(JSON.stringify({ status: "PASS", scope: "READ_ONLY_INSTALLED_BYTES_PREFLIGHT; no launch or UI acceptance",
      version: installation.version, installRoot: deployment.installedRoot,
      artifacts: [{ name: "agentvn-editor.exe", sha256: deployment.executable.sha256 },
        ...provenance.map(({ name, sha256 }) => ({ name, sha256 }))] }));
    process.exit(0);
  }
}
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
if (installed) fs.copyFileSync(path.resolve(process.argv[4]), path.join(out, "installer-resource-report.json"));
const mod = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export {createRenpyUILayout} from "./shared/cartridge/uiLayoutProfiles"; export {getDefaultUISkinLayout} from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports);
const project = fixture(`qa-renpy-usability-${attempt}`), renpy = mod.exports.createRenpyUILayout();
project.editor_settings.runtimeUILayoutProfiles = { version: 1, activeType: "renpy",
  profiles: { agentvn: mod.exports.getDefaultUISkinLayout(), renpy } };
project.editor_settings.runtimeUILayout = structuredClone(renpy);
const input = path.join(out, "qa-usability.vnproj");
fs.writeFileSync(input, JSON.stringify(project));
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
const report = { status: "RUNNING", scope: installed
  ? "ACTUAL_NSIS_INSTALLED_EDITOR_AND_BACKEND; isolated fixture imported via public API; WebView emulated display matrix; no paid model"
  : "SOURCE_REAL_BROWSER_EDITOR_ONLY", cases: [], failures: [], captures: [],
  startedAt: new Date().toISOString(), modelRequests: 0 };
const sources = ["RuntimeLayoutDesigner.tsx", "RenpyTitleEditor.tsx", "RenpyTitleTextEditor.tsx",
  "ControlPresentationEditor.tsx", "RenpyControlAppearanceEditor.tsx", "RenpySettingHelp.tsx", "renpy-title-editor.css"];
const hashSource = () => sources.map(name => [name, createHash("sha256").update(
  fs.readFileSync(path.join(root, "editor/src/components/advanced", name))).digest("hex")]);
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let env, browser, activePage, nativeSession, nativeUrl;
async function check(name, m, run) {
  try { const details = await run(); report.cases.push({ name, ...m, status: "PASS", ...details }); }
  catch (error) {
    report.failures.push({ name, ...m, error: String(error.stack || error) });
    const file = path.join(out, `${m.width}-${m.dpr}-${m.reduced}-${name}-failure.png`);
    try {
      if (installed) await captureInstalledWebview(activePage, nativeSession, file, m);
      else await activePage.screenshot({ path: file });
    } catch (captureError) {
      report.failures.at(-1).captureError = String(captureError.stack || captureError);
    }
  }
  save();
}
async function scrollMeasurement(page) {
  return page.getByTestId("control-presentation-editor").evaluate(node => {
    const panel = node.closest(".runtime-layout-inspector"), rect = node.getBoundingClientRect();
    const host = panel.getBoundingClientRect(), heading = node.querySelector("h4").getBoundingClientRect();
    return { component: node.dataset.presentationFor, top: rect.top, headingBottom: heading.bottom,
      panelTop: host.top, panelBottom: host.bottom, scrollTop: panel.scrollTop,
      maxScroll: panel.scrollHeight - panel.clientHeight,
      focus: node.contains(document.activeElement), overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
(async () => {
  report.sources = hashSource();
  if (installed) {
    env = await startInstalledEditor(out);
    const verified = A.readInstalledSession(out);
    report.owner = { ...env.state, exeSha256: verified.exeSha256,
      version: installation.version, backendUrl: `http://127.0.0.1:${env.state.backendPort}` };
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${env.state.cdpPort}`);
    const readyDeadline = Date.now() + 30000;
    while (Date.now() < readyDeadline) {
      activePage = browser.contexts().flatMap(context => context.pages()).find(page => /tauri\.localhost/.test(page.url()));
      if (activePage) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(activePage, "The owned installed Editor has no Runtime WebView");
    nativeUrl = activePage.url();
    nativeSession = await activePage.context().newCDPSession(activePage);
  } else {
    env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
    report.owner = { url: env.url, backendUrl: env.backendUrl, pid: env.server.pid, backendPid: env.backendPid };
    browser = await chromium.launch();
  }
  const matrix = installed || process.env.RENPY_USABILITY_MATRIX === "1"
    ? desktopViewports.flatMap(([width, height]) => [1, 2].flatMap(dpr =>
      [false, true].map(reduced => ({ width, height, dpr, reduced }))))
    : [{ width: 1920, height: 1080, dpr: 1, reduced: false }];
  for (const m of matrix) {
    const context = installed ? activePage.context() : await browser.newContext({ viewport: { width: m.width, height: m.height },
      deviceScaleFactor: m.dpr, reducedMotion: m.reduced ? "reduce" : "no-preference" });
    const page = installed ? activePage : activePage = await context.newPage(); page.setDefaultTimeout(8000);
    const run = async operation => installed ? operation() : env.server.run(operation);
    await run(async () => {
      if (installed) {
        // Unmount the previous QA UI before replacing this isolated fixture.
        // No user database, preferences or WebView profile participates.
        if (/tauri\.localhost/.test(page.url())) await page.evaluate(() => localStorage.clear());
        await page.goto("about:blank");
        const imported = await fetch(`${report.owner.backendUrl}/api/project/projects/import`, {
          method: "POST", headers: { "content-type": "application/octet-stream",
            "X-AgentVN-Filename": encodeURIComponent("属性可用性隔离工程.vnproj") },
          body: fs.readFileSync(input), signal: AbortSignal.timeout(10000) });
        assert(imported.ok, `Isolated project setup failed: HTTP ${imported.status}`);
        await page.setViewportSize({ width: m.width, height: m.height });
        await page.emulateMedia({ reducedMotion: m.reduced ? "reduce" : "no-preference" });
        await nativeSession.send("Emulation.setDeviceMetricsOverride", {
          width: m.width, height: m.height, deviceScaleFactor: m.dpr, mobile: false });
        await page.goto(nativeUrl);
        await page.locator(".recent-project-open:not(:disabled):visible")
          .filter({ hasText: project.title }).first().click();
        await page.locator(".editor-toolbar").waitFor();
        await readInstalledViewport(page, m);
      } else await env.open(page);
      await settleEditor(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await page.getByTestId("renpy-title-editor").waitFor(); await settleEditor(page);
      await check("disclosure-feedback", m, async () => {
        const summary = page.locator(".renpy-shared-typography > summary");
        const base = await summary.evaluate(n => {
          const s = getComputedStyle(n), r = n.getBoundingClientRect();
          // Native WebView at Windows scaling can quantize a declared 1px
          // border to 0.8 CSS px, even under explicit CDP DPR=1.
          // Compare with a real 1px reference in the same rendering context.
          const reference = document.createElement("div");
          reference.style.cssText = "position:fixed;left:-10000px;top:0;border:1px solid red";
          n.parentElement.append(reference);
          const onePixelBorder = getComputedStyle(reference).borderTopWidth;
          reference.style.borderWidth = "0";
          const zeroBorder = getComputedStyle(reference).borderTopWidth;
          reference.remove();
          return { cursor: s.cursor, border: s.borderTopWidth, background: s.backgroundImage,
            borderStyle: s.borderTopStyle, onePixelBorder, zeroBorder,
            height: r.height, width: r.width, x: r.x, y: r.y };
        });
        assert.equal(base.cursor, "pointer");
        assert(base.height >= 36 && parseFloat(base.border) > 0
          && parseFloat(base.border) >= parseFloat(base.onePixelBorder)
          && parseFloat(base.zeroBorder) === 0 && base.borderStyle === "solid"
          && base.background !== "none", "Disclosure needs a full-row tangible surface and a real one-pixel border");
        await summary.focus();
        await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
        const focus = await summary.evaluate(n => ({ focus: n.matches(":focus-visible"), outline: getComputedStyle(n).outlineStyle }));
        assert(focus.focus && focus.outline !== "none", "Keyboard focus must be visible");
        await summary.evaluate(n => {
          window.__disclosureFrames = [];
          window.__disclosureSampling = true;
          const details = n.parentElement;
          function frame() {
            window.__disclosureFrames.push(details.getBoundingClientRect().height);
            if (window.__disclosureSampling) requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
        await summary.press("Enter");
        assert(await summary.evaluate(n => n.parentElement.open), "Enter must expand native details");
        await page.getByRole("combobox", { name: "Ren'Py（进阶）全局界面字体", exact: true }).waitFor();
        await summary.evaluate(async n => { await Promise.all(n.parentElement.getAnimations({ subtree: true })
          .map(a => a.finished.catch(() => {}))); });
        const frames = await page.evaluate(() => { window.__disclosureSampling = false; return window.__disclosureFrames; });
        assert(new Set(frames.map(Math.round)).size >= 3, "Disclosure must show continuous expansion frames");
        const hit = await summary.evaluate(n => {
          const r = n.getBoundingClientRect(); return n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        });
        assert(hit, "The disclosure surface must receive clicks");
        await summary.press("Enter");
        assert.equal(await summary.evaluate(n => n.parentElement.open), false);
        return { base, focus, frames, hit };
      });
      await check("on-demand-help", m, async () => {
        assert.equal(await page.getByText("导航采用结构化位置，不支持任意拖拽；保存布局后写入当前工程。", { exact: true }).count(), 0);
        assert.equal(await page.getByText("覆盖检查在本机完成，不会上传项目文本或字体文件。", { exact: true }).count(), 0);
        const help = page.getByRole("button", { name: "当前控件外观帮助", exact: true });
        const note = page.getByTestId("renpy-appearance-help");
        assert.equal(await note.isVisible(), false, "Explanations start collapsed");
        await help.click();
        assert.equal(await help.getAttribute("aria-expanded"), "true");
        assert(await note.isVisible());
        await help.click();
        await page.locator(".renpy-region-list button").first().focus();
        await note.waitFor({ state: "hidden" });
        const field = page.getByRole("combobox", { name: "背景图适配", exact: true });
        await field.focus();
        await page.getByTestId("renpy-background-fit-help").waitFor();
        assert(await page.getByTestId("renpy-background-fit-help").isVisible(), "Focused setting provides targeted help");
        return {};
      });
      await check("advanced-reveal-current-control", m, async () => {
        const inspector = page.locator(".renpy-title-editor .runtime-layout-inspector");
        await inspector.evaluate(n => { n.scrollTop = 0; });
        await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_start_button"]').click();
        await page.evaluate(() => {
          window.__revealFrames = [];
          window.__revealSampling = true;
          function frame() {
            const p = document.querySelector(".renpy-title-editor .runtime-layout-inspector");
            if (p) window.__revealFrames.push({ t: performance.now(), y: p.scrollTop });
            if (window.__revealSampling) requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
        const advanced = page.getByRole("checkbox", { name: "Ren’Py进阶代码编辑", exact: true });
        await advanced.check();
        await page.waitForFunction(() => {
          const code = document.querySelector('[data-testid="control-presentation-editor"]');
          const p = code?.closest(".runtime-layout-inspector");
          if (!p) return false;
          const r = code.getBoundingClientRect(), h = p.getBoundingClientRect();
          const expected = Math.min(p.scrollHeight - p.clientHeight, Math.max(0, p.scrollTop + r.top - h.top - 12));
          return Math.abs(p.scrollTop - expected) < 1 && r.top >= h.top - 1 && r.top + 45 <= h.bottom && code.contains(document.activeElement);
        });
        const measured = await scrollMeasurement(page);
        assert.equal(measured.component, "title_start_button");
        assert((measured.scrollTop > 0 || measured.maxScroll === 0) && measured.focus && measured.overflow <= 1);
        const frames = await page.evaluate(() => { window.__revealSampling = false; return window.__revealFrames; });
        if (measured.scrollTop > 1)
          assert(new Set(frames.map(f => Math.round(f.y))).size >= 3, "Actual scroll must have intermediate positions, including reduced motion");
        await page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true }).click();
        await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).fill(".root { color: #aaffdd; }");
        assert.equal(await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).inputValue(), ".root { color: #aaffdd; }");
        await advanced.uncheck(); await advanced.check();
        await page.waitForFunction(() => document.querySelector('[data-testid="control-presentation-editor"]')?.contains(document.activeElement));
        assert.equal(await page.getByRole("textbox", { name: "当前控件 CSS", exact: true }).inputValue(), ".root { color: #aaffdd; }");
        // No delayed reveal may pull focus back from the user's next control.
        await advanced.uncheck(); await advanced.check();
        await page.locator('.renpy-editor-page-list button').filter({ hasText: /^关于$/ }).click();
        await settleEditor(page);
        assert.equal(await page.getByTestId("renpy-menu-editor").getAttribute("data-editor-page"), "about");
        assert.equal(await page.getByTestId("control-presentation-editor").getAttribute("data-presentation-for"), "about_panel");
        assert.equal(await page.getByTestId("control-presentation-editor").evaluate(n => n.contains(document.activeElement)), false);
        const specialized = [];
        await advanced.uncheck();
        await page.getByTestId("renpy-player-layout-entry").click();
        for (const [mode, name] of [["dialog", "普通对白"], ["nvl", "NVL 累积阅读"], ["bubble", "气泡对白"]]) {
          await page.getByRole("combobox", { name: "对白布局模式", exact: true }).click();
          await page.getByRole("option", { name, exact: true }).click();
          await advanced.check();
          await page.waitForFunction(() => {
            const n = document.querySelector('[data-testid="control-presentation-editor"]');
            if (!n || !n.contains(document.activeElement)) return false;
            const p = n.closest(".runtime-layout-inspector"), r = n.getBoundingClientRect(), h = p.getBoundingClientRect();
            const expected = Math.min(p.scrollHeight - p.clientHeight, Math.max(0, p.scrollTop + r.top - h.top - 12));
            return Math.abs(p.scrollTop - expected) < 1 && r.top >= h.top - 1 && r.top + 45 <= h.bottom;
          });
          specialized.push({ mode, ...await scrollMeasurement(page) });
          await advanced.uncheck();
        }
        await page.getByRole("button", { name: "返回页面导航", exact: true }).click();
        await page.getByTestId("renpy-confirmation-layout-entry").click();
        await advanced.check();
        await page.waitForFunction(() => {
          const n = document.querySelector('[data-testid="control-presentation-editor"]');
          return n?.dataset.presentationFor === "confirmation_panelStyle" && n.contains(document.activeElement);
        });
        specialized.push({ mode: "confirmation", ...await scrollMeasurement(page) });
        await advanced.uncheck();
        return { measured, frames, specialized };
      });
      if (installed) {
        report.captures.push(await captureInstalledWebview(page, nativeSession,
          path.join(out, `${m.width}-dpr${m.dpr}-${m.reduced}.png`), m));
      } else {
      const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      assert.deepEqual(actual, m);
      const png = await page.screenshot({ path: path.join(out, `${m.width}-dpr${m.dpr}-${m.reduced}.png`) });
      assert.equal(png.readUInt32BE(16), m.width * m.dpr); assert.equal(png.readUInt32BE(20), m.height * m.dpr);
      assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches })), m);
      }
    });
    if (!installed) { await context.close(); activePage = undefined; }
  }
  assert.equal(report.cases.length + report.failures.length, matrix.length * 3);
  assert.equal(report.failures.length, 0, "User-reported usability checks failed; see individual failures");
  assert.deepEqual(hashSource(), report.sources, "Source must stay unchanged throughout the matrix");
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    // Close only the owned isolated instance; never the user's preexisting Editor.
    const stopped = await Promise.allSettled([browser?.close()]);
    const ownerStopped = await Promise.allSettled([env?.stop()]);
    stopped.push(...ownerStopped);
    const ports = installed && env ? [report.owner?.backendUrl, `http://127.0.0.1:${env.state.cdpPort}/json/version`]
      .filter(Boolean) : [env?.url, env?.backendUrl].filter(Boolean);
    const reachable = await Promise.all(ports.map(async url => {
      try { await fetch(url, { signal: AbortSignal.timeout(700) }); return url; } catch { return null; }
    }));
    report.cleanup = { status: stopped.every(r => r.status === "fulfilled") && !reachable.some(Boolean) ? "PASS" : "FAILED",
      absentServices: ports, owner: ownerStopped[0]?.value,
      errors: stopped.filter(r => r.status === "rejected").map(r => String(r.reason)) };
    if (installed && ownerStopped[0]?.value) {
      const cleanup = ownerStopped[0].value;
      if (cleanup.editor.exitCode !== 0 || cleanup.backend.exitCode !== 0
        || cleanup.peers.some(peer => peer.exitCode !== 0)) report.cleanup.status = "FAILED";
    }
    if (report.cleanup.status !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, passed: report.cases.length, failed: report.failures.length, out, error: report.error }));
  });
