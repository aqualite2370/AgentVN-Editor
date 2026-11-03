"use strict";
// Editor only: actual top Options entry and tab clicks, unmodified RAF observer.
// No time stretching, internal navigation events, store writes, or model calls.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { gzipSync } = require("node:zlib");
const { spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { beginEditorMotion, finishEditorMotion } = require("./lib/installed-editor-motion-sampler.cjs");
assert(process.env.AGENTVN_TEST_PROJECT && process.env.AGENTVN_WORKSPACE_OUTPUT);
const output = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT);
const root = path.resolve(__dirname, "..");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const report = { status: "RUNNING", at: new Date().toISOString(), layer: "Editor",
  scope: "source Chromium, not native Dev or installed Release", modelSubmissions: 0,
  input: process.env.AGENTVN_TEST_PROJECT, testSha256: sha(fs.readFileSync(__filename)), cases: [],
  sourceHashes: ["editor/src/components/editor/EditorToolbar.tsx",
    "editor/src/utils/editorTransitionPresentation.ts", "editor/src/styles/editor-topbar.css",
    "editor/src/components/advanced/AdvancedToolsPanel.tsx"].map(file =>
    ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) })) };
const selector = ".workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)";
const interactionMode = process.env.AGENTVN_MORPH_BOUNDS_INTERACTIONS === "1";
let host, browser;
function processRows() {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId," +
    "ParentProcessId,ExecutablePath,@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})"],
  { encoding: "utf8", windowsHide: true, timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}
async function idle(page, tab) {
  await page.waitForFunction(({ selector, tab }) => {
    const panel = document.querySelector(selector);
    return panel && !panel.classList.contains("is-morphing")
      && !panel.getAnimations().some(a => a.playState === "running")
      && !document.querySelector(".toolbar-popover-morph-ghost")
      && panel.querySelector(".advanced-tools-panel.is-tab-idle")
      && panel.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab") === tab
      && !panel.querySelector(".advanced-tab-content.is-active .advanced-tab-loading");
  }, { selector, tab }, { timeout: 60000 });
}
async function tab(page, target) {
  await page.locator(`${selector} [data-help-key="advanced.tab.${target}"]`).click();
  await idle(page, target);
}
function check(row, name, condition, detail) {
  row.checks.push({ name, status: condition ? "PASS" : "FAILED", detail });
}
function verify(row, trace, target, expected) {
  const frames = trace.frames;
  check(row, "Nonempty complete real-frame capture", frames.length >= 3 && !trace.limitReached,
    { frames: frames.length, limitReached: trace.limitReached });
  check(row, "Actual viewport/DPR/motion match declaration", frames.length > 0 && frames.every(f =>
    f.width === expected.width && f.height === expected.height && f.dpr === expected.dpr && f.reduced === expected.reduced));
  const panels = frames.filter(f => f.panel);
  const morphing = panels.filter(f => f.panel.animations.some(a => a.name === "WAAPI" && a.state === "running"));
  const transforms = new Set(morphing.map(f => f.panel.transform));
  check(row, "Independent continuous morph evidence in this motion mode",
    morphing.length >= 3 && transforms.size >= 3,
    { frames: morphing.length, distinctTransforms: transforms.size,
      motionMode: expected.reduced ? "reduce" : "normal",
      clocks: morphing[0]?.panel.animations });
  const overlap = panels.filter(f => f.inspector && f.panel.rect.right > f.inspector.rect.left + 1);
  check(row, "Every animated rectangle remains before Inspector", overlap.length === 0,
    { failedFrames: overlap.length, maxOverlap: Math.max(0, ...panels.map(f =>
      f.inspector ? f.panel.rect.right - f.inspector.rect.left : 0)),
      examples: overlap.slice(0, 3).map(f => ({ at: f.at, rect: f.panel.rect,
        inspector: f.inspector.rect, transform: f.panel.transform })) });
  const hitFailures = panels.filter(f => f.inspectorOverlapHit?.belongsToPanel);
  check(row, "No live intermediate frame intercepts Inspector pixels", hitFailures.length === 0,
    { failedFrames: hitFailures.length, examples: hitFailures.slice(0, 3).map(f => f.inspectorOverlapHit) });
  check(row, "No viewport clipping or horizontal overflow", frames.every(f => f.overflow <= 1)
    && panels.every(f => f.panel.rect.left >= -1 && f.panel.rect.top >= -1
      && f.panel.rect.right <= expected.width + 1 && f.panel.rect.bottom <= expected.height + 1));
  const before = panels[0];
  const sameTrack = key => panels.every(f => f[key]?.rect && before[key]?.rect
    && ["left", "top", "width", "height"].every(p => Math.abs(f[key].rect[p] - before[key].rect[p]) <= 0.5));
  check(row, "Node rail/Canvas/Inspector keep their tracks",
    ["palette", "flow", "inspector"].every(sameTrack));
  check(row, "Node rail stays clear and visible", panels.every(f => f.palette
    && f.palette.opacity > .99 && f.palette.visibility !== "hidden" && f.palette.display !== "none"
    && f.paletteFilteredAncestors.length === 0));
  check(row, "Leaving/ghost layers never capture focus or input", frames.every(f => !f.focus.inUnavailable
    && f.ghosts.every(g => g.inert && g.pointerEvents === "none")
    && f.layers.filter(l => l.className.includes("is-leaving")).every(l => l.inert && l.interactive !== "true")));
  const last = frames.at(-1);
  const owners = last?.layers.filter(l => l.interactive === "true" && !l.inert) || [];
  check(row, "One ready final owner; no remaining animation snapshot", owners.length === 1
    && owners[0].tab === target && last.activeTab === target && last.ghosts.length === 0
    && !last.panel?.animations.some(a => a.state === "running"));
  check(row, "Navigation uses actual trusted input", trace.inputs.some(i => i.trusted
    && i.type === "click" && i.help === `advanced.tab.${target}`));
  row.frames = frames.length;
  row.status = row.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
}
(async () => {
  host = await startEditorAcceptance(output);
  fs.copyFileSync(__filename, path.join(output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const all = processRows(), owned = new Set([host.backendPid, host.server.pid]);
  for (let previous = -1; previous !== owned.size;) {
    previous = owned.size; all.filter(p => owned.has(p.ParentProcessId)).forEach(p => owned.add(p.ProcessId));
  }
  report.service = { backendPid: host.backendPid, frontendPid: host.server.pid,
    backendUrl: host.backendUrl, frontendUrl: host.url, runId: host.server.runId,
    processes: all.filter(p => owned.has(p.ProcessId)) };
  browser = await chromium.launch();
  const smoke = process.env.AGENTVN_MORPH_BOUNDS_SMOKE === "1";
  report.testMode = interactionMode ? "keyboard-and-live-reversal" : "original-two-paths";
  for (const [width, height] of smoke ? [desktopViewports[0]] : desktopViewports)
    for (const dpr of smoke ? [1] : [1, 2]) for (const reduced of smoke ? [true] : [false, true]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
        reducedMotion: reduced ? "reduce" : "no-preference" });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      const item = { width, height, dpr, reduced, status: "RUNNING", paths: [], errors: [] };
      report.cases.push(item);
      page.on("pageerror", e => item.errors.push(String(e)));
      await page.route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel.*\/(?:start|execute))(?:[/?]|$)/,
        route => {
          if (route.request().method() !== "POST") return route.continue();
          report.modelSubmissions++; return route.abort();
        });
      try {
        await host.open(page);
        await page.locator('[data-workspace-surface="options"]').click();
        await idle(page, "settings");
        const paths = interactionMode
          ? [["animation", "providers"], ["assets", "assets"]]
          : [["assets", "library"], ["animation", "providers"]];
        for (const [from, target] of paths) {
          await tab(page, from);
          const name = `${width}-dpr${dpr}-${reduced ? "reduce" : "normal"}-${from}-to-${target}${interactionMode ? "-keyboard" : ""}`;
          const row = { name, from, target, checks: [], status: "RUNNING" };
          item.paths.push(row);
          await beginEditorMotion(page, name);
          if (!interactionMode) await tab(page, target);
          else {
            // The settled source tab was focused by its real pointer click.
            // Its next sibling is library/providers; native keyboard activation
            // does not wait for transform stability like locator.click().
            await page.keyboard.press("Tab");
            const next = from === "assets" ? "library" : target;
            assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-help-key")),
              `advanced.tab.${next}`);
            await page.keyboard.press("Enter");
            if (target === from) {
              await page.waitForFunction(selector => {
                const panel = document.querySelector(selector);
                return panel?.getAnimations().some(a => a.playState === "running"
                  && Number(a.currentTime) > 0 && Number(a.currentTime) < Number(a.effect?.getTiming().duration) * .8);
              }, selector);
              await page.keyboard.press("Shift+Tab");
              assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-help-key")),
                `advanced.tab.${target}`);
              row.reverseDuringRunningMorph = await page.locator(selector).evaluate(panel =>
                panel.getAnimations().some(a => a.playState === "running"));
              await page.keyboard.press("Enter");
            }
            await idle(page, target);
          }
          const trace = await finishEditorMotion(page);
          const bytes = gzipSync(Buffer.from(JSON.stringify(trace)));
          const file = path.join(output, `${name}.json.gz`);
          fs.writeFileSync(file, bytes, { flag: "wx" });
          row.trace = { path: file, sha256: sha(bytes), bytes: bytes.length };
          verify(row, trace, target, item);
          if (interactionMode) {
            check(row, "Trusted keyboard activation retains continuous handoff",
              trace.inputs.some(i => i.trusted && i.type === "keydown" && i.key === "Enter"
                && i.help === `advanced.tab.${target}`));
            if (from === target) {
              check(row, "Reversal interrupts a genuinely running morph",
                row.reverseDuringRunningMorph === true
                  && trace.events.some(e => e.type === "cancel" && e.name === "WAAPI"));
            }
            row.status = row.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
          }
        }
        const pngFile = path.join(output, `${width}-dpr${dpr}-${reduced ? "reduce" : "normal"}.png`);
        const png = await page.screenshot({ path: pngFile });
        assert.equal(png.readUInt32BE(16), width * dpr);
        assert.equal(png.readUInt32BE(20), height * dpr);
        item.screenshot = { path: pngFile, sha256: sha(png), pixels: [png.readUInt32BE(16), png.readUInt32BE(20)] };
        assert.equal(item.paths.length, 2);
        item.status = item.paths.every(p => p.status === "PASS") && item.errors.length === 0 ? "PASS" : "FAILED";
      } catch (error) {
        item.status = "FAILED"; item.error = String(error.stack || error);
        await page.evaluate(() => window.__qaInstalledEditorMotion?.stop?.()).catch(() => {});
      } finally { await context.close(); }
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ width, dpr, reduced, status: item.status,
        failed: item.paths.flatMap(p => p.checks.filter(c => c.status !== "PASS").map(c => `${p.from}->${p.target}: ${c.name}`)),
        error: item.error?.split("\n")[0] }));
    }
  assert.equal(report.cases.length, smoke ? 1 : 12);
  assert(report.cases.every(c => c.paths.length === 2), "No missing paths may PASS");
  assert.equal(report.modelSubmissions, 0);
  report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(error => {
  report.status = "TOOL_FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  await browser?.close(); await host?.stop();
  const running = processRows();
  report.cleanupSurvivors = (report.service?.processes || []).filter(before =>
    running.some(now => now.ProcessId === before.ProcessId && now.Created === before.Created));
  if (report.cleanupSurvivors.length) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output }));
});
