"use strict";
// Installed Editor only. Observe the real indicator during FLIP, not just its settled rect.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), zlib = require("node:zlib"), { spawnSync } = require("node:child_process");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { idle, beginSample, visiblePointerClick } = require("./editor-selection-mask-motion-playwright.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Editor-Motion-20261021-01";
const attempt = process.argv[2] || "02"; assert.match(attempt, /^\d{2}$/);
const filter = process.argv[3] || ""; assert(["", "--probe-only", "--4k-only", "--4k-dpr2-only"].includes(filter));
const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const installationFile = "F:/AgentVN/QA/Component-Preview-Release-20261021-02/installation.json";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const baselineFile = "F:/AgentVN/QA/Installed-Components-20261021-01/editor-08/report.json";
const baseline = read(baselineFile);
assert.equal(baseline.status, "PASS");
assert.equal(sha(baselineFile), "49efb535c8986d5f46d4782130690fdc7d7479beb72d0bc3178b25f1de1e7a2a");
const sourceFiles = ["scripts/installed-editor-mask-current.cjs", "scripts/editor-selection-mask-motion-playwright.cjs"];
const report = { status: "RUNNING", scope: "INSTALLED_RELEASE_EDITOR_DYNAMIC_SELECTION_MASK_NOT_RUNTIME",
  startedAt: new Date().toISOString(), launches: [], cleanups: [], screenshots: [], errors: [], modelRequests: 0,
  productChanges: 0, builds: 0, cases: [], protectedFiles: baseline.protectedFiles,
  baseline: desc(baselineFile), tools: sourceFiles.map(p => desc(path.join(root, p))),
  expectedWorkspacePlaybackRate: 1.5, filter, fullMatrix: filter === "" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, page, cachePrepared = false;
const popover = ".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)";
const tab = key => `${popover} [data-help-key="advanced.tab.${key}"]`;
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
function unchanged() {
  for (const f of [...report.protectedFiles, report.baseline, ...report.tools])
    assert.equal(sha(f.path), f.sha256, f.path);
}
const delta = (a, b) => Math.max(...["x", "y", "width", "height"].map(k => Math.abs(a[k] - b[k])));
(async () => {
  unchanged();
  for (const p of sourceFiles) fs.copyFileSync(path.join(root, p), path.join(out, path.basename(p)), fs.constants.COPYFILE_EXCL);
  const input = path.join(out, "选项遮罩 临时工程.vnproj"), project = fixture(`installed-editor-mask-${attempt}`);
  project.title = `实际安装Editor遮罩回测 ${attempt}`;
  fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" }); report.input = desc(input);
  save(); cache("SelfTest"); cachePrepared = true; cache("Prepare");
  host = installedReleaseSession({ installationFile, out, report, save, input }); page = await host.start();
  const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
    body: fs.readFileSync(input), signal: AbortSignal.timeout(30000) });
  assert(response.ok && (await response.json()).ok);
  await page.reload(); await page.locator(".project-home").waitFor(); await settleEditor(page);
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await page.locator('[data-workspace-surface="options"]:visible').click(); await idle(page, "settings");
  const scenarios = ["history", "library", "layout", "library", "assets", "history", "settings"]
    .map(key => ({ key, method: "pointer" }));
  scenarios.push({ key: "history", method: "keyboard" }, { key: "settings", method: "rapid-redirect" });
  for (const [width, height] of filter ? [[3840, 2160]] : [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of filter === "--probe-only" ? [1] : filter === "--4k-dpr2-only" ? [2] : [1, 2])
      for (const reduced of filter === "--probe-only" ? [false] : [false, true]) {
      const viewport = await host.metrics({ width, height, dpr, reduced }); await settleEditor(page); await idle(page, "settings");
      for (const { key, method } of scenarios) {
        const row = { viewport, target: key, method, status: "RUNNING", failures: [] };
        report.cases.push(row); save();
        await beginSample(page);
        await page.evaluate(() => {
          const inputs = [];
          const listener = e => {
            const n = e.target instanceof Element ? e.target.closest("button") : null;
            inputs.push({ at: performance.now(), type: e.type, trusted: e.isTrusted,
              key: e.key, x: e.clientX, y: e.clientY, tag: e.target?.tagName,
              morphing: n?.closest(".toolbar-popover")?.classList.contains("is-morphing"),
              help: n?.getAttribute("data-help-key"), label: n?.textContent.trim() });
          };
          document.addEventListener("click", listener, true); document.addEventListener("keydown", listener, true);
          window.__maskInputProbe = { stop: () => {
            document.removeEventListener("click", listener, true); document.removeEventListener("keydown", listener, true);
            return inputs;
          } };
        });
        let actionError;
        try {
          if (method === "keyboard") {
          for (let i = 0; i < 7; i++) await page.keyboard.press("Tab");
          assert(await page.locator(tab(key)).evaluate(n => n === document.activeElement));
          await page.keyboard.press("Enter");
        } else if (method === "rapid-redirect") {
          await visiblePointerClick(page, "layout");
          await page.waitForFunction(s => document.querySelector(s)?.classList.contains("is-morphing"), popover);
          await visiblePointerClick(page, "library"); await visiblePointerClick(page, key);
          } else await page.locator(tab(key)).click();
          await idle(page, key);
        } catch (e) { actionError = String(e.stack || e); }
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const data = await page.evaluate(() => window.__selectionMaskSample.stop());
        row.inputs = await page.evaluate(() => window.__maskInputProbe.stop());
        const file = path.join(out, `mask-${String(report.cases.length).padStart(3, "0")}.json.gz`);
        fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(data))), { flag: "wx" });
        row.trace = { ...desc(file), frames: data.frames.length };
        if (actionError) {
          row.status = "FAILED"; row.actionError = actionError; row.failures.push("Actual user action did not reach target");
          row.finalState = await page.evaluate(selector => {
            const n = document.querySelector(selector);
            return { active: n?.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab"),
              selected: n?.querySelector('[data-glass-selected="true"]')?.getAttribute("data-help-key"),
              classes: n?.className, phase: n?.querySelector(".advanced-tools-panel")?.className,
              pending: n?.querySelector(".advanced-tab-pending, .advanced-tab-loading, .advanced-tab-load-error")?.textContent,
              animations: n?.getAnimations().map(a => ({ state: a.playState, currentTime: a.currentTime,
                timing: a.effect?.getComputedTiming(), name: a.animationName })),
              focus: document.activeElement?.getAttribute("data-help-key") };
          }, popover);
          save(); await host.shot(`failed-${report.cases.length}-${method}`); throw Error(actionError);
        }
        assert(data.frames.length >= 3); assert.equal(data.viewport.width, width); assert.equal(data.viewport.height, height);
        assert(Math.abs(data.viewport.dpr - dpr) <= 1e-6); assert.equal(data.reduced, reduced);
        const frames = data.frames, last = frames.at(-1);
        row.settledDelta = delta(last.indicator, last.button);
        if (row.settledDelta > 2) row.failures.push("Settled mask/button mismatch over 2px");
        if (frames.some(f => f.indicator.x < f.nav.x - 3 || f.indicator.right > f.nav.right + 3))
          row.failures.push("Moving mask escapes navigation track");
        if (frames.some(f => delta(f.indicator, f.material) > 2 || delta(f.indicator, f.adapter) > 2))
          row.failures.push("Material/adapter double scaling or offset");
        if (frames.some(f => f.interactiveOwners.length > 1)) row.failures.push("Multiple interactive owners");
        if (frames.some(f => f.inspector && f.root.right > f.inspector.x + 1)) row.failures.push("Inspector covered");
        if (frames.some(f => f.palette && f.root.x < f.palette.right - 1)) row.failures.push("Node rail covered");
        if (method === "keyboard" && !frames.some(f => f.markerAnimations.some(a => a.state === "running")))
          row.failures.push("Keyboard marker hard cut");
        const content = frames.flatMap(f => f.contentAnimations).filter(a => a.state === "running");
        const morph = frames.flatMap(f => f.rootAnimations).filter(a => a.state === "running");
        row.contentDurations = [...new Set(content.map(a => a.timing))];
        row.morphDurations = [...new Set(morph.map(a => a.timing))];
        if ((method !== "rapid-redirect" && !content.length) || content.some(a => Math.abs(a.timing - 400 / 1.5) > 1))
          row.failures.push("Content category speed differs from approved 1.5x");
        if (frames.some(f => f.morphing) && (!morph.length || morph.some(a => Math.abs(a.timing - (reduced ? 640 : 960) / 1.5) > 1)))
          row.failures.push("Container category speed differs from approved 1.5x");
        const hit = await page.locator(tab(key)).evaluate(n => {
          const r = n.getBoundingClientRect();
          return n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
            && document.documentElement.scrollWidth <= innerWidth + 1;
        });
        if (!hit) row.failures.push("Actual target hit or horizontal overflow");
        row.status = row.failures.length ? "FAILED" : "PASS"; save();
        console.log(`${row.status} ${width}/${dpr}/${reduced} ${key}/${method}`);
      }
      await host.shot(`${width}-${dpr}-${reduced}-options-mask`);
    }
  assert.equal(report.cases.length, filter === "--probe-only" ? 9 : filter === "--4k-only" ? 36
    : filter === "--4k-dpr2-only" ? 18 : 108);
  assert(report.cases.every(c => c.status === "PASS"), "Dynamic mask failures; preserve trace evidence");
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); unchanged(); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    await page?.evaluate(() => window.__selectionMaskSample?.stop?.()).catch(() => {});
    await page?.evaluate(() => window.__maskInputProbe?.stop?.()).catch(() => {});
    await host?.stop("Installed dynamic mask finally; not physical window-close acceptance");
    if (cachePrepared) { cache("Restore"); assert.equal(read(path.join(out, "native-cache-restoration.json")).status, "PASS"); report.cacheRestored = true; }
    unchanged(); report.protectedUnchanged = true;
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
    failures: report.cases.filter(c => c.status === "FAILED").map(c => ({ viewport: c.viewport, target: c.target, method: c.method, failures: c.failures })),
    error: report.error, cleanupError: report.cleanupError, out }, null, 2));
});
