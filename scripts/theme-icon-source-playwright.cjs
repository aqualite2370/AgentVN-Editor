"use strict";
// HOST-01: real Editor toolbar in an owned SOURCE browser, not installed WebView evidence.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { root, fixture, resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const qa = "F:/AgentVN/QA/Theme-Icon-Source-20261020-01";
const checkpoint = "F:/AgentVN/Checkpoints/Theme-Icon-Source-20261020-01";
const out = path.join(root, "output/theme-icon-source-20261020-01");
const input = path.join(qa, "主题图标 隔离小工程.vnproj");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sources = ["editor/src/styles/layout.css", "editor/src/components/editor/ThemeToneSelector.tsx",
  "editor/src/store/themeStore.ts", "editor/src/styles/variables.css", "editor/src/styles/editor-tokens.css",
  "editor/src/styles/editor-topbar.css", "editor/src/styles/editor-shell.css", "editor/src/app/App.css"];
const info = file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))), bytes: fs.statSync(path.join(root, file)).size });
function prepare() {
  for (const dir of [qa, checkpoint, out]) { assert(!fs.existsSync(dir), `Never overwrite ${dir}`); fs.mkdirSync(dir, { recursive: true }); }
  const saved = [...sources, "AGENTS.md", "plans/ACTIVE_TASKS.md", "AgentVN Dev.exe",
    "scripts/host-theme-icon-alignment-test.cjs", "output/host-upgrade-20261018-02/theme-icon-new/report.json",
    "output/host-upgrade-20261018-02/theme-icon-old/report.json"].map(file => {
    const dest = path.join(checkpoint, file); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, file), dest, fs.constants.COPYFILE_EXCL); return info(file);
  });
  const project = fixture("theme-icon-source-20261020-01"); project.title = "主题图标隔离验收";
  fs.writeFileSync(input, JSON.stringify(project, null, 2), { flag: "wx" });
  fs.writeFileSync(path.join(out, "preparation.json"), JSON.stringify({
    at: new Date().toISOString(), checkpoint, qa, input, inputSha256: sha(fs.readFileSync(input)), saved, modelRequests: 0,
  }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ checkpoint, qa, out, input }));
}
async function readGeometry(page) {
  return page.locator('[data-help-key="toolbar.theme"]:visible').evaluate(button => {
    const track = button.querySelector(".theme-switch-track"), thumb = button.querySelector(".theme-switch-thumb");
    const rect = n => n.getBoundingClientRect().toJSON(), t = rect(thumb);
    const css = n => { const s = getComputedStyle(n); return Object.fromEntries(
      ["position", "top", "right", "bottom", "left", "width", "height", "margin", "transform",
        "opacity", "transitionProperty", "transitionDuration", "transitionTimingFunction"].map(k => [k, s[k]])); };
    const b = rect(button), label = rect(button.querySelector(".theme-switch-label")), tr = rect(track);
    return { at: performance.now(), pressed: button.getAttribute("aria-pressed"), button: b, track: tr, thumb: t,
      thumbStyle: css(thumb), label, focused: button === document.activeElement, labelText: button.textContent,
      hit: button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
      overflow: document.documentElement.scrollWidth - innerWidth, trackStyle: css(track),
      saved: localStorage.getItem("agentvn.themeTone"),
      icons: [...thumb.querySelectorAll(".theme-icon")].map(icon => {
        const r = rect(icon), s = css(icon);
        return { className: icon.getAttribute("class"), rect: r, style: s, opacity: Number(s.opacity),
          deltaX: r.x + r.width / 2 - (t.x + t.width / 2), deltaY: r.y + r.height / 2 - (t.y + t.height / 2),
          outsideThumb: r.left < t.left - .75 || r.right > t.right + .75 || r.top < t.top - .75 || r.bottom > t.bottom + .75,
          outsideTrack: r.left < tr.left - .75 || r.right > tr.right + .75 || r.top < tr.top - .75 || r.bottom > tr.bottom + .75 };
      }) };
  });
}
async function settleTheme(page) {
  await page.locator('[data-help-key="toolbar.theme"]:visible').evaluate(async button => {
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      // Root theme colors can keep retargeting descendant color/shadow transitions.
      // Wait for actual geometry/visibility owners, not unrelated decorative color tails.
      const active = button.getAnimations({ subtree: true }).filter(a =>
        ["transform", "opacity"].includes(a.transitionProperty)
        && a.effect.getComputedTiming().iterations !== Infinity && ["running", "pending"].includes(a.playState));
      if (!active.length) return;
      await Promise.all(active.map(a => a.finished.catch(() => {})));
    }
    throw new Error("Theme animations never settled");
  });
}
async function recordStart(page) {
  await page.evaluate(() => {
    const button = document.querySelector('[data-help-key="toolbar.theme"]');
    const data = { frames: [], events: [], startedAt: performance.now(), done: false };
    window.__themeIconAcceptance = data;
    const handler = e => { if (e.target.closest?.(".theme-switch-thumb")) data.events.push({
      type: e.type, property: e.propertyName, at: performance.now(), elapsed: e.elapsedTime }); };
    for (const event of ["transitionrun", "transitionend", "transitioncancel"]) button.addEventListener(event, handler);
    data.stop = () => {
      data.done = true;
      for (const event of ["transitionrun", "transitionend", "transitioncancel"]) button.removeEventListener(event, handler);
    };
    const sample = () => {
      if (data.done) return;
      const thumb = button.querySelector(".theme-switch-thumb"), t = thumb.getBoundingClientRect();
      const tr = button.querySelector(".theme-switch-track").getBoundingClientRect();
      const icons = [...thumb.querySelectorAll(".theme-icon")].map(icon => {
        const r = icon.getBoundingClientRect(), s = getComputedStyle(icon);
        return { opacity: Number(s.opacity), transform: s.transform,
          deltaX: r.x + r.width / 2 - (t.x + t.width / 2), deltaY: r.y + r.height / 2 - (t.y + t.height / 2),
          outsideTrack: r.left < tr.left - .75 || r.right > tr.right + .75 || r.top < tr.top - .75 || r.bottom > tr.bottom + .75 };
      });
      data.frames.push({ at: performance.now(), pressed: button.getAttribute("aria-pressed"),
        thumbTransform: getComputedStyle(thumb).transform, thumbCenter: [t.x + t.width / 2, t.y + t.height / 2], icons });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}
async function recordEnd(page) {
  await settleTheme(page);
  return page.evaluate(() => {
    const data = window.__themeIconAcceptance; data.stop();
    const { stop, ...result } = data; delete window.__themeIconAcceptance; return result;
  });
}
function check(item, name, fn) {
  try { fn(); item.checks.push({ name, status: "PASS" }); }
  catch (e) { item.checks.push({ name, status: "FAILED", error: String(e.stack || e) }); }
}
function assertSettled(g, light, width, height, initial = false) {
  assert.equal(g.pressed, String(light));
  if (!initial || g.saved !== null) assert.equal(g.saved, light ? "white_gray" : "blue_gray");
  assert(g.labelText.includes(light ? "浅色" : "深色")); assert(g.hit); assert(g.overflow <= 1);
  assert(g.button.left >= 0 && g.button.top >= 0 && g.button.right <= width && g.button.bottom <= height);
  assert(g.track.right <= g.label.left + .75, "Theme label overlaps slider");
  const visible = g.icons.filter(i => i.opacity > .99); assert.equal(visible.length, 1);
  const icon = visible[0]; assert(icon.className.includes(light ? "sun" : "moon"));
  assert(Math.abs(icon.deltaX) <= .75 && Math.abs(icon.deltaY) <= .75 && !icon.outsideThumb && !icon.outsideTrack,
    `Theme icon is not centered/contained: ${JSON.stringify(icon)}`);
  assert(Math.abs(icon.rect.width - 16) <= .75 && Math.abs(icon.rect.height - 16) <= .75, "Do not shrink icon to disguise offset");
}
function assertFrames(trace) {
  assert(trace.frames.length >= 3, "No frame sequence");
  assert(trace.events.some(e => e.type === "transitionrun" && e.property === "transform"), "No transform handoff");
  assert(trace.events.some(e => e.type === "transitionend" && e.property === "transform"), "No settled transform event");
  assert(trace.frames.some(f => f.icons.some(i => i.opacity > .02 && i.opacity < .98)), "No actual intermediate opacity");
  const transforms = new Set(trace.frames.map(f => f.thumbTransform)); assert(transforms.size >= 3, "No continuous thumb motion");
  for (const frame of trace.frames) for (const icon of frame.icons.filter(i => i.opacity > .02)) {
    assert(Math.abs(icon.deltaX) <= .75 && Math.abs(icon.deltaY) <= .75, "Icon leaves thumb center during transition");
    assert(!icon.outsideTrack, "Rotating icon clips against slider track");
  }
}
async function projectSnapshot(page) {
  return page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const { useEditorStore } = await import("/src/store/editorStore.ts");
    const p = useProjectStore.getState(), e = useEditorStore.getState();
    return { projectId: p.projectId, settings: p.settings, assets: p.assetManifest, nodes: e.nodes, edges: e.edges };
  });
}
async function main() {
  const isolation = resolveAcceptancePaths(), smoke = process.argv.includes("--smoke"), probe = process.argv.includes("--probe");
  const smokeReduced = process.argv.includes("--reduced-only");
  assert.equal(path.resolve(isolation.input), path.resolve(input));
  const prep = JSON.parse(fs.readFileSync(path.join(out, "preparation.json")));
  assert.equal(sha(fs.readFileSync(input)), prep.inputSha256);
  const report = { status: "RUNNING", at: new Date().toISOString(), isolation, cases: [], modelRequests: 0,
    scope: "HOST-01 SOURCE browser only; not native Dev UI, installed Release, Windows game or Android",
    testSha256: sha(fs.readFileSync(__filename)), sources: sources.map(info) };
  let browser, host;
  try {
    host = await startEditorAcceptance(isolation.output);
    fs.copyFileSync(__filename, path.join(isolation.output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
    report.service = { url: host.url, backendUrl: host.backendUrl, backendPid: host.backendPid,
      frontendPid: host.server.pid, runId: host.server.runId };
    browser = await chromium.launch();
    for (const [width, height] of smoke ? desktopViewports.slice(0, 1) : desktopViewports)
      for (const dpr of smoke ? [1] : [1, 2]) for (const reduced of smoke ? [smokeReduced] : [false, true]) {
        const item = { key: `${width}-dpr${dpr}-${reduced ? "reduce" : "normal"}`, width, height, dpr, reduced,
          checks: [], states: [], transitions: [], pageErrors: [], status: "RUNNING" }; report.cases.push(item);
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
          reducedMotion: reduced ? "reduce" : "no-preference" });
        const page = await context.newPage(); page.setDefaultTimeout(45000);
        page.on("pageerror", e => item.pageErrors.push(String(e)));
        await page.route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
          if (route.request().method() !== "POST") return route.continue();
          report.modelRequests++; return route.abort();
        });
        try {
          await host.open(page); await settleEditor(page); await settleTheme(page);
          const before = await projectSnapshot(page), toggle = page.locator('[data-help-key="toolbar.theme"]:visible');
          const initial = await readGeometry(page); item.states.push({ name: "initial-light", geometry: initial });
          check(item, "initial-sun-centered-and-contained", () => assertSettled(initial, true, width, height, true));
          if (probe) {
            item.probe = { purpose: "Temporary diagnostic CSS; NEVER counted as product acceptance" };
            const style = await page.addStyleTag({ content: ".theme-icon { inset:0; margin:auto; }" });
            item.probe.centeredOnly = await readGeometry(page); await style.evaluate(node => node.remove());
            item.probe.restored = await readGeometry(page);
          }
          await recordStart(page); await toggle.click(); item.transitions.push({ name: "pointer-dark", ...await recordEnd(page) });
          const dark = await readGeometry(page); item.states.push({ name: "pointer-dark", geometry: dark });
          check(item, "pointer-moon-centered-and-contained", () => assertSettled(dark, false, width, height));
          check(item, "pointer-continuous-center-and-track", () => assertFrames(item.transitions.at(-1)));
          await recordStart(page); await toggle.focus(); await page.keyboard.press("Space");
          item.transitions.push({ name: "keyboard-light", ...await recordEnd(page) });
          const light = await readGeometry(page); item.states.push({ name: "keyboard-light", geometry: light });
          check(item, "keyboard-sun-centered-contained-and-focused", () => { assertSettled(light, true, width, height); assert(light.focused); });
          check(item, "keyboard-continuous-center-and-track", () => assertFrames(item.transitions.at(-1)));
          await recordStart(page); await toggle.click();
          await page.waitForFunction(() => window.__themeIconAcceptance.frames.some(f =>
            f.icons.some(i => i.opacity > .05 && i.opacity < .95)));
          await toggle.click(); item.transitions.push({ name: "reverse-light", ...await recordEnd(page) });
          check(item, "rapid-reverse-cancels-and-returns-without-jump", () => {
            assertFrames(item.transitions.at(-1));
            assert(item.transitions.at(-1).events.some(e => e.type === "transitioncancel"), "No real interruption exercised");
          });
          const reversed = await readGeometry(page); item.states.push({ name: "reverse-light", geometry: reversed });
          check(item, "reverse-final-owner-unique-and-focused", () => { assertSettled(reversed, true, width, height); assert(reversed.focused); });
          await toggle.click(); await settleTheme(page); await page.reload({ waitUntil: "domcontentloaded" });
          // Existing isolated project is loaded through the real recent-project entry, not store injection.
          await page.waitForFunction(() => document.querySelector(".editor-toolbar")
            || [...document.querySelectorAll(".project-import-button input")].some(n => !n.disabled));
          if (!await page.locator(".editor-toolbar").isVisible()) {
            await page.locator(".project-import-button input").first().setInputFiles(input);
            await page.locator(".editor-toolbar").waitFor();
          }
          await settleEditor(page); await settleTheme(page);
          const restored = await readGeometry(page); item.states.push({ name: "reload-dark", geometry: restored });
          check(item, "reload-restores-real-local-theme", () => assertSettled(restored, false, width, height));
          await page.locator('[data-workspace-surface="options"]:visible').click(); await settleEditor(page);
          await page.locator('[data-help-key="advanced.tab.settings"]:visible').waitFor();
          const inOptions = await readGeometry(page); item.states.push({ name: "options-dark", geometry: inOptions });
          check(item, "real-options-entry-keeps-theme-clickable", () => assertSettled(inOptions, false, width, height));
          await toggle.click(); await settleTheme(page);
          const after = await projectSnapshot(page);
          check(item, "theme-changes-do-not-mutate-project", () => assert.deepEqual(after, before));
          item.screenshot = await captureSourceBrowser(page, path.join(isolation.output, `${item.key}.png`), { width, height, dpr, reduced });
          check(item, "actual-viewport-DPR-media-and-PNG", () => assert(item.screenshot));
          await host.server.assertAlive();
        } catch (e) { item.error = String(e.stack || e); }
        finally {
          item.status = !item.error && item.pageErrors.length === 0 && item.checks.length === 11
            && item.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
          if (!item.screenshot) try {
            item.screenshot = await captureSourceBrowser(page, path.join(isolation.output, `${item.key}-failure.png`), { width, height, dpr, reduced });
          } catch (e) { item.captureError = String(e); }
          await context.close();
          fs.writeFileSync(path.join(isolation.output, "progress.json"), JSON.stringify(report, null, 2));
          console.log(JSON.stringify({ key: item.key, status: item.status, error: item.error,
            failed: item.checks.filter(c => c.status === "FAILED").map(c => c.name) }));
        }
      }
    assert.equal(report.cases.length, smoke ? 1 : 12); assert.equal(report.modelRequests, 0);
    for (const s of report.sources) assert.equal(info(s.file).sha256, s.sha256, "Product changed during test");
    report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); }
  finally {
    await browser?.close(); await host?.stop();
    const responds = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } };
    report.cleanup = { frontendResponds: host ? await responds(host.url) : false,
      backendResponds: host ? await responds(`${host.backendUrl}/api/health`) : false };
    report.cleanup.status = !report.cleanup.frontendResponds && !report.cleanup.backendResponds ? "PASS" : "FAILED";
    if (report.cleanup.status !== "PASS") report.status = "FAILED";
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(isolation.output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output: isolation.output }));
    if (report.status !== "PASS") process.exitCode = 1;
  }
}
if (require.main === module) {
  if (process.argv.includes("--prepare")) prepare();
  else main().catch(e => { console.error(e); process.exitCode = 1; });
}
module.exports = { root, qa, checkpoint, out, input, sources, sha, info };
