"use strict";
// Full production-minified Editor + isolated real backend. No motion overrides.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), zlib = require("node:zlib");
const assert = require("node:assert/strict"), { createHash, randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { beginEditorMotion, finishEditorMotion } = require("./lib/installed-editor-motion-sampler.cjs");
const { workspaceSequenceFailures, policy } = require("./lib/installed-editor-motion-workspace-policy.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2], smoke = process.argv.includes("--smoke");
assert.match(attempt, /^(?:red|green)-\d{2}$/);
const base = "F:/AgentVN/QA/Editor-Sibling-Time-20261024-01", out = path.join(base, attempt);
const cp = JSON.parse(fs.readFileSync("F:/AgentVN/Checkpoints/Editor-Sibling-Time-20261024-01/manifest.json", "utf8"));
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const input = cp.input.path; assert.equal(sha(input), cp.input.sha256);
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary); process.env.TEMP = temporary; process.env.TMP = temporary;
const executed = fs.readFileSync(__filename);
const sourceFiles = ["editor/src/utils/editorTransitionPresentation.ts", "editor/src/components/advanced/AdvancedToolsPanel.tsx",
  "editor/src/components/editor/EditorToolbar.tsx", "editor/src/styles/variables.css", "editor/src/app/App.css"];
const r = { status: "RUNNING", startedAt: new Date().toISOString(), smoke,
  scope: "SOURCE_PRODUCTION_MINIFIED_BROWSER_NOT_INSTALLED_OR_NATIVE_DEV",
  noAnimationOrClockOverrides: true, modelRequests: 0, input: cp.input,
  tool: { path: __filename, sha256: createHash("sha256").update(executed).digest("hex") },
  sources: sourceFiles.map(file => ({ file, sha256: sha(path.join(root, file)) })),
  protected: cp.entries.filter(e => e.file.startsWith("GameCli_framework/") || e.file === "editor/src/app/App.css"),
  matrix: [], screenshots: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
let env, server, browser, page;
async function idle(tab) {
  await page.waitForFunction(tab => {
    const p = document.querySelector(".advanced-tools-panel");
    return p?.classList.contains("is-tab-idle") && p.querySelector(".advanced-tab-content.is-active")?.dataset.tab === tab;
  }, tab);
  await settleEditor(page);
}
async function click(tab, keyboard = false) {
  const b = page.locator(`[data-help-key="advanced.tab.${tab}"]:visible`);
  if (keyboard) { await b.focus(); await page.keyboard.press("Enter"); } else await b.click();
}
function milliseconds(value) {
  const m = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/.exec(value.trim());
  assert(m, `Expected actual computed CSS time: ${value}`);
  return Number(m[1]) * (m[2] === "s" ? 1000 : 1);
}
async function episode(cell, name, from, to, action, baseline) {
  const c = { name, from, to, status: "RUNNING" }; cell.episodes.push(c); save();
  await beginEditorMotion(page, name);
  let trace;
  try { await action(); await idle(to); }
  catch (e) { c.actionError = String(e.stack || e); }
  finally {
    trace = await finishEditorMotion(page);
    const file = path.join(out, `${cell.key}-${name}.json.gz`), bytes = zlib.gzipSync(Buffer.from(JSON.stringify(trace)));
    fs.writeFileSync(file, bytes, { flag: "wx" }); c.trace = { path: file, sha256: sha(file), frames: trace.frames.length }; save();
  }
  try {
    assert(!c.actionError, c.actionError);
    const f = trace.frames;
    assert(f.length >= 3 && !trace.limitReached && trace.inputs.some(i => i.trusted));
    assert(f.every(v => !v.pageHidden && v.visibilityState === "visible" && v.width === cell.width
      && v.height === cell.height && v.dpr === cell.dpr && v.reduced === cell.reduced && v.overflow <= 1));
    const errors = workspaceSequenceFailures(f.filter(v => v.palette && v.flow && v.inspector), baseline, cell, policy);
    assert.deepEqual(errors, [], "Tracks, clear node rail, bounds and approved workbench envelope");
    assert(f.every(v => !v.focus.inUnavailable && !v.focus.inClosingPanel));
    assert(f.every(v => v.ghosts.every(g => g.inert && g.pointerEvents === "none")));
    const cross = f.filter(v => v.phase?.includes("crossfading"));
    const visible = cross.filter(v => v.layers.some(l => l.tab === to && l.opacity > .01 && l.opacity < .99));
    c.renderedIntermediateFrames = visible.length;
    const tokens = f[0].editorMotionTokens;
    c.expectedDurationMs = milliseconds(tokens[cell.reduced ? "--motion-editor-sibling-reduced" : "--motion-editor-sibling"])
      * (cell.reduced ? 1 : Math.max(.25, Number(tokens["--motion-scale"])))
      / Number(tokens["--editor-workspace-playback-rate"]);
    c.observedDurationsMs = [...new Set(cross.flatMap(v => v.layers.flatMap(l => l.animations
      .filter(a => a.name === "WAAPI").map(a => a.duration))))];
    c.actualTokens = tokens; save();
    assert(c.observedDurationsMs.length > 0 && c.observedDurationsMs.every(ms => Math.abs(ms - c.expectedDurationMs) < .001),
      `Actual WAAPI must honor CSS time units: ${JSON.stringify(c)}`);
    assert(visible.length >= 2, "Ordinary and reduced modes both need real visible intermediate frames");
    assert(cross.length >= 2 && cross.every(v => {
      const present = v.layers.filter(l => !l.className.includes("is-warm") && !l.className.includes("is-inactive") && !l.className.includes("is-preparing"));
      const total = present.reduce((sum, l) => sum + l.opacity, 0);
      return total >= .9 && total <= 1.1 && v.layers.filter(l => !l.inert && l.interactive === "true").length === 1
        && v.layers.filter(l => l.inert).every(l => l.pointerEvents === "none");
    }), "No blank flash, stacked-opacity flash or competing input owners");
    const nav = f.find(v => v.buttons.length === 8)?.buttons; assert(nav);
    assert(f.filter(v => v.buttons.length).every(v => v.buttons.length === 8 && v.buttons.every((b, i) =>
      b.width === nav[i].width && b.height === nav[i].height)), "Navigation layout sizes remain stable");
    const end = f.at(-1); assert.equal(end.activeTab, to);
    assert.deepEqual(end.layers.filter(l => l.opacity > .01 && !l.className.includes("is-warm")).map(l => l.tab), [to]);
    assert.equal(end.layers.filter(l => !l.inert && l.interactive === "true").length, 1);
    c.visibleSpanMs = visible.at(-1).at - visible[0].at; c.status = "PASS";
  } catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  finally { save(); console.log(JSON.stringify({ cell: cell.key, episode: name, status: c.status })); }
}
async function shot(cell, name) {
  const metrics = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const before = await metrics(), file = path.join(out, `${cell.key}-${name}.png`);
  await page.screenshot({ path: file }); const after = await metrics(), bytes = fs.readFileSync(file);
  assert.deepEqual(before, after); assert.deepEqual(before, { width: cell.width, height: cell.height, dpr: cell.dpr, reduced: cell.reduced });
  assert.equal(bytes.readUInt32BE(16), cell.width * cell.dpr); assert.equal(bytes.readUInt32BE(20), cell.height * cell.dpr);
  r.screenshots.push({ path: file, sha256: sha(file), before, after }); save();
}
(async () => {
  try {
    save(); env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
    r.owner = { url: env.url, backendUrl: env.backendUrl, processes: rows().filter(p => p.ProcessId === env.backendPid || p.ProcessId === env.server.pid) };
    assert.equal(r.owner.processes.length, 2);
    const frontend = path.join(out, "frontend"), previous = process.env.VITE_BACKEND_URL;
    process.env.VITE_BACKEND_URL = env.backendUrl;
    try {
      const vite = await import(pathToFileURL(path.join(root, "editor/node_modules/vite/dist/node/index.js")).href);
      await vite.build({ root: path.join(root, "editor"), configFile: path.join(root, "editor/vite.config.ts"), configLoader: "native",
        logLevel: "warn", build: { outDir: frontend, emptyOutDir: false } });
    } finally { if (previous === undefined) delete process.env.VITE_BACKEND_URL; else process.env.VITE_BACKEND_URL = previous; }
    r.frontend = fs.readdirSync(path.join(frontend, "assets")).filter(f => /\.(?:js|css)$/.test(f))
      .map(f => ({ path: path.join(frontend, "assets", f), sha256: sha(path.join(frontend, "assets", f)) }));
    const runtime = path.join(root, "GameCli_framework/dist");
    assert(fs.existsSync(path.join(runtime, "index.html")));
    r.runtimeAssets = fs.readdirSync(path.join(runtime, "assets")).filter(f => /\.(?:js|css)$/.test(f))
      .map(f => ({ path: path.join(runtime, "assets", f), sha256: sha(path.join(runtime, "assets", f)) }));
    const runId = randomUUID();
    server = http.createServer((req, res) => {
      if (req.url === `/__owner/${runId}`) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ pid: process.pid, runId })); return; }
      try {
        const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/^\/+/, "");
        const runtimeRequest = name.startsWith("gamecli-preview/");
        const servingRoot = runtimeRequest ? runtime : frontend;
        const relative = runtimeRequest ? name.slice("gamecli-preview/".length) : name;
        let file = path.resolve(servingRoot, relative || "index.html");
        assert(file.startsWith(servingRoot + path.sep));
        if (!fs.existsSync(file)) {
          if (path.extname(relative)) { res.statusCode = 404; res.end(); return; }
          file = path.join(servingRoot, "index.html");
        }
        const type = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".json": "application/json" }[path.extname(file)] || "application/octet-stream";
        res.setHeader("content-type", type); res.setHeader("cache-control", "no-store"); res.end(fs.readFileSync(file));
      } catch { res.statusCode = 400; res.end(); }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const url = `http://127.0.0.1:${server.address().port}`; r.productionServer = { url, pid: process.pid, runId };
    assert.deepEqual(await (await fetch(`${url}/__owner/${runId}`)).json(), { pid: process.pid, runId }); save();
    browser = await chromium.launch();
    const cells = smoke ? [[1920, 1080, 1, false]]
      : [1920, 2560, 3840].flatMap((w, i) => [1, 2].flatMap(d => [false, true].map(v => [w, [1080, 1440, 2160][i], d, v])));
    for (const [width, height, dpr, reduced] of cells) {
      const cell = { width, height, dpr, reduced, key: `${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}`, status: "RUNNING", episodes: [] };
      r.matrix.push(cell); save();
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: reduced ? "reduce" : "no-preference" });
      page = await context.newPage(); page.setDefaultTimeout(30000); page.on("pageerror", e => r.errors.push(String(e)));
      page.on("request", req => { if (req.method() === "POST" && /\/api\/(?:assistant\/(?:chat|creation)|novel)/.test(req.url())) { r.modelRequests++; save(); } });
      await env.server.run(async () => {
        await page.goto(url);
        await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
          .some(node => node instanceof HTMLInputElement && !node.disabled));
        await page.locator(".project-import-button input").first().setInputFiles(input);
        await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
        const baseline = await page.evaluate(() => {
          const rect = s => document.querySelector(s).getBoundingClientRect().toJSON();
          return { paletteRect: rect(".node-palette"), flowRect: rect(".flow-surface"), inspectorRect: rect(".scene-editor-pane") };
        });
        await page.locator('[data-workspace-surface="options"]:visible').click(); await idle("settings");
        // Warm actual pages through navigation; cold-first-click performance is user-deferred.
        for (const tab of smoke ? ["history", "settings"] : ["layout", "theme", "assets", "providers", "history", "settings"]) {
          await click(tab); await idle(tab);
        }
        if (!smoke) {
          await click("layout"); await idle("layout");
          await episode(cell, "layout-theme", "layout", "theme", () => click("theme"), baseline);
          await episode(cell, "theme-assets", "theme", "assets", () => click("assets"), baseline);
          await click("providers"); await idle("providers");
          await episode(cell, "providers-history", "providers", "history", () => click("history"), baseline);
        } else { await click("history"); await idle("history"); }
        await episode(cell, "history-settings", "history", "settings", () => click("settings"), baseline);
        if (!smoke) {
          await episode(cell, "keyboard-settings-history", "settings", "history", () => click("history", true), baseline);
          await click("settings"); await idle("settings");
          await episode(cell, "rapid-repeat-reversal", "settings", "history", async () => {
            await click("history");
            await page.waitForFunction(() => {
              const n = document.querySelector('.advanced-tab-content.is-active[data-tab="history"]');
              const opacity = n && Number(getComputedStyle(n).opacity); return opacity > .05 && opacity < .8;
            });
            await click("settings"); await click("history"); await click("history");
          }, baseline);
        }
        await shot(cell, "final"); cell.status = "PASS"; save();
      });
      await context.close(); page = undefined;
    }
    assert.equal(r.matrix.length, smoke ? 1 : 12);
    assert(r.matrix.every(c => c.status === "PASS" && c.episodes.length === (smoke ? 1 : 6) && c.episodes.every(e => e.status === "PASS")));
    assert.deepEqual(r.errors, []); assert.equal(r.modelRequests, 0);
  } catch (e) {
    r.error = String(e.stack || e); process.exitCode = 1;
    if (page) await shot(r.matrix.at(-1), "failure").catch(e => { r.captureError = String(e); });
  } finally {
    try {
      const results = await Promise.allSettled([browser?.close(), env?.stop(),
        server && new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()))]);
      assert(results.every(p => p.status === "fulfilled"));
      const ports = [r.owner?.url, r.owner?.backendUrl, r.productionServer?.url].filter(Boolean).map(u => Number(new URL(u).port));
      assert.deepEqual(listeners(ports), []);
      if (r.owner) assert(!rows().some(p => r.owner.processes.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
      assert.equal(sha(__filename), r.tool.sha256);
      for (const s of r.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
      for (const s of r.protected) assert.equal(sha(path.join(root, s.file)), s.sha256);
      for (const s of r.runtimeAssets || []) assert.equal(sha(s.path), s.sha256);
      for (const p of cp.products) assert.equal(sha(p.path), p.sha256, "No Dev/frozen binary writes during behavior tests");
      r.cleanup = { status: "PASS", absentPorts: ports, browserClosed: true }; r.status = r.error ? "FAILED" : "PASS";
    } catch (e) { r.status = "FAILED"; r.cleanupError = String(e.stack || e); process.exitCode = 1; }
    fs.writeFileSync(path.join(out, "executed.cjs"), executed, { flag: "wx" }); r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, error: r.error, cleanupError: r.cleanupError }));
  }
})();
