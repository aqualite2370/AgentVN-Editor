"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { spawnSync } = require("node:child_process");
const { gzipSync } = require("node:zlib"), JSZip = require("../editor/node_modules/jszip");
const { buildSync } = require("../editor/node_modules/esbuild");
const { savePageNativePreview } = require("./lib/save-page-native-preview-session.cjs");
const { savePageNativeBuildEvidence } = require("./lib/save-page-native-build-evidence.cjs");
const { readInstalledViewport } = require("./lib/current-native-capture.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert(/^\d{2}$/.test(attempt || ""));
const handoff = process.argv.includes("--handoff");
const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/${handoff?"save-page-handoff-native03":"save-page-native-time01"}-${attempt}`;
const buildFile = handoff ? "F:/AgentVN/QA/Runtime-SavePage-Handoff-20261024-01/build-03/report.json"
  : "F:/AgentVN/QA/Runtime-SavePage-Time-20261024-01/build-01/report.json";
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const describe = file => ({ path: path.resolve(file), sha256: sha(file) });
const evidence = savePageNativeBuildEvidence(buildFile, out);
const report = { status: "RUNNING", handoff, startedAt: new Date().toISOString(), cases: [], launches: [], screenshots: [],
  modelRequests: 0, scope: "CURRENT_DEV_NATIVE_PLAYER_PREVIEW_NOT_INSTALLED_AUTHOR_EXPORT_STANDALONE_OR_ANDROID",
  boundaries: ["Public preview messages with a synthetic complete cartridge; not Editor authoring/export",
    "Real WebView simulated viewport; not physical 4K; exact process teardown, not normal close",
    "No store injection, fake animations, altered CSS tokens or source Vite server"],
  build: evidence.receipt, player: evidence.executable, fixtures: [],
  tools: [__filename, "scripts/lib/save-page-native-build-evidence.cjs", "scripts/lib/save-page-native-preview-session.cjs",
    "scripts/lib/current-native-capture.cjs", "scripts/native-dev-preview-profile.ps1"].map(describe) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let profilePrepared = false, session;
function profile(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), result.stdout + result.stderr, { flag: "wx" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
const compiled = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts", contents:
  'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles"; export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(compiled, compiled.exports);
async function fixture(layout) {
  const now = new Date().toISOString(), id = `qa-native-save-page-${layout}`;
  const manifest = { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.25.0",
    game_id: id, title: "存档翻页独立小工程", author: "QA", version: "0.1.0", language: "zh-CN",
    entry_script: "script.json", entry_scene_id: "main", created_at: now, updated_at: now,
    assets: [], ui_skin: { path: "ui/layout.json", version: "1.0.0", name: "QA" } };
  const script = { schema_version: "1.10.0", game_id: id, title: manifest.title, entry_scene_id: "main",
    scenes: [{ scene_id: "main", title: "隔离", chapter: 1, tags: [],
      commands: [{ type: "narration", text: "临时工程仅用于真实原生存档分页验收。" }] }] };
  const entries = new Map([["manifest.json", Buffer.from(JSON.stringify(manifest))],
    ["script.json", Buffer.from(JSON.stringify(script))],
    ["ui/layout.json", Buffer.from(JSON.stringify(layout === "renpy"
      ? compiled.exports.createRenpyUILayout() : compiled.exports.getDefaultUISkinLayout()))]]);
  const zip = new JSZip();
  for (const [name, bytes] of entries) zip.file(name, bytes);
  zip.file("checksum.json", JSON.stringify({ checksum_version: "1.0.0", algorithm: "sha256", generated_at: now,
    files: [...entries].map(([name, bytes]) => ({ path: name, size_bytes: bytes.length,
      hash_sha256: createHash("sha256").update(bytes).digest("hex") })) }));
  const file = path.join(out, `${layout}.vncart`);
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }), { flag: "wx" });
  report.fixtures.push(describe(file)); save();
  return file;
}
async function idle(page, target) {
  await page.waitForFunction(target => {
    const node = document.querySelector("[data-runtime-screen-transition]");
    return node?.getAttribute("data-runtime-screen-transition") === "idle"
      && node.getAttribute("data-runtime-presented-screen") === target
      && !document.querySelector(".game-launch-blackout");
  }, target);
}
async function record(page) {
  await page.evaluate(() => {
    window.__savePageFrames = []; window.__savePageRecording = true;
    const rect = node => node?.getBoundingClientRect().toJSON();
    const tick = () => {
      if (!window.__savePageRecording) return;
      const layers = [...document.querySelectorAll("[data-save-page-layer]")].map(node => ({
        page: node.getAttribute("data-save-page-layer"), inert: node.inert,
        opacity: Number(getComputedStyle(node).opacity), transform: getComputedStyle(node).transform,
        animations: node.getAnimations().map(a => ({ time: a.currentTime, playState: a.playState,
          duration: a.effect.getTiming().duration, easing: a.effect.getTiming().easing })),
      }));
      const focus = document.activeElement;
      window.__savePageFrames.push({ at: performance.now(), layers,
        viewport: rect(document.querySelector(".save-page-viewport")),
        screen: rect(document.querySelector(".save-load-screen")),
        navigation: rect(document.querySelector(".save-page-navigation")),
        toolbar: rect(document.querySelector(".save-load-toolbar")),
        back: rect(document.querySelector('[data-testid="renpy-menu-return"],[data-testid="back-to-player"]')),
        grids: document.querySelectorAll('[data-testid="save-slot-grid"]').length,
        overflow: document.documentElement.scrollWidth - innerWidth,
        unavailableFocus: !!focus?.closest("[inert],[aria-hidden='true']"),
        focus: focus?.getAttribute("data-testid"),
      }); requestAnimationFrame(tick);
    }; requestAnimationFrame(tick);
  });
}
async function finish(page) {
  return page.evaluate(() => { window.__savePageRecording = false; return window.__savePageFrames; });
}
async function flipIdle(page) {
  await page.waitForFunction(() => {
    const layers = [...document.querySelectorAll("[data-save-page-layer]")];
    return layers.length === 1 && !layers[0].getAnimations().some(a => a.playState === "running");
  });
}
async function trace(row, label, action, leave = false) {
  const page = session.page;
  await record(page);
  try { await action(); if (leave) await idle(page, "title_menu"); else await flipIdle(page); }
  finally {
    const frames = await finish(page);
    const file = path.join(out, `${report.cases.length}-${label}.json.gz`);
    fs.writeFileSync(file, gzipSync(JSON.stringify(frames)), { flag: "wx" });
    const moving = frames.filter(f => f.layers.some(l => l.opacity > .05 && l.opacity < .95 && l.transform !== "none"));
    row.traces.push({ label, ...describe(file), frames: frames.length, moving: moving.length });
    save();
    assert(frames.length >= 2);
    assert(moving.length >= 2, `${label}: continuous translated intermediate frames required`);
    const clocks = frames.flatMap(f => f.layers.flatMap(l => l.animations));
    assert(clocks.length && clocks.every(a => a.duration === (row.reduced ? 220 : 420)),
      `${label}: production CSS must yield real 420/220ms WAAPI clocks`);
    const liveFrames = frames.filter(f => f.layers.length);
    assert(liveFrames.length);
    assert(liveFrames.every(f => f.layers.filter(l => !l.inert).length === 1 && f.grids === 1));
    assert(frames.every(f => !f.unavailableFocus && f.overflow <= 1));
    for (const field of ["viewport", "screen", "navigation", "toolbar", "back"]) {
      const first = liveFrames[0][field]; assert(first, field);
      for (const f of liveFrames) for (const key of ["x", "y", "width", "height"])
        assert(Math.abs(f[field][key] - first[key]) <= .25, `${label}: ${field}.${key} must stay still`);
    }
    assert.equal(frames.at(-1).layers.length, leave ? 0 : 1);
  }
}
async function caseFlow(layout, viewport) {
  const row = { layout, ...viewport, status: "RUNNING", traces: [] }; report.cases.push(row); save();
  const page = session.page;
  try {
    row.before = await session.setViewport(viewport);
    await idle(page, "title_menu");
    await page.getByTestId("open-save-load").click(); await idle(page, "save_load");
    row.geometry = await page.locator(".save-load-screen").evaluate(screen => {
      const rect = n => n.getBoundingClientRect().toJSON();
      const hit = n => { const r = rect(n); return n.contains(document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)); };
      const grid = document.querySelector('[data-testid="save-slot-grid"]');
      const prev = document.querySelector('[data-testid="save-page-previous"]'), next = document.querySelector('[data-testid="save-page-next"]');
      const back = document.querySelector('[data-testid="renpy-menu-return"],[data-testid="back-to-player"]');
      return { screen: rect(screen), grid: rect(grid), prev: rect(prev), next: rect(next), back: rect(back),
        nav: rect(document.querySelector(".save-page-navigation")), backHit: hit(back), nextHit: hit(next),
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    const g = row.geometry;
    assert(g.nav.top >= g.grid.bottom - 1);
    assert(Math.abs(g.prev.left-g.grid.left)<28 && Math.abs(g.next.right-g.grid.right)<28);
    assert(g.back.top < viewport.height * .16 && g.back.left < viewport.width * .2);
    assert(g.backHit && g.nextHit && g.overflow <= 1);
    for (const value of [g.grid, g.nav, g.back]) assert(value.left >= -1 && value.top >= -1
      && value.right <= viewport.width + 1 && value.bottom <= viewport.height + 1);
    await trace(row, "next", () => page.getByTestId("save-page-next").click());
    await page.getByTestId("save-slot-manual-7").waitFor();
    assert(await page.getByTestId("save-page-previous").evaluate(n => n === document.activeElement));
    await trace(row, "rapid-reverse", async () => {
      await page.getByTestId("save-page-previous").click();
      await page.waitForFunction(() => [...document.querySelectorAll("[data-save-page-layer]")]
        .some(n => { const opacity = Number(getComputedStyle(n).opacity); return opacity > .1 && opacity < .9; }));
      await page.getByTestId("save-page-next").click();
    });
    await page.getByTestId("save-slot-manual-7").waitFor();
    await page.getByTestId("save-page-previous").focus();
    await trace(row, "keyboard", () => page.keyboard.press("Enter"));
    await page.getByTestId("save-slot-manual-1").waitFor();
    const screenshot = await session.shot(path.join(out, `save-page-${report.cases.length}.png`));
    report.screenshots.push(screenshot);
    await trace(row, "leave-during-flip", async () => {
      await page.getByTestId("save-page-next").click();
      // Consume a real visible flip before leaving, rather than cancelling
      // before its first presented frame and calling that motion acceptance.
      await page.waitForFunction(() => [...document.querySelectorAll("[data-save-page-layer]")]
        .some(n => { const opacity = Number(getComputedStyle(n).opacity); return opacity > .1 && opacity < .9; }));
      await page.keyboard.press("Escape");
    }, true);
    assert.equal(await page.locator("[data-save-page-layer]").count(), 0);
    row.after = await readInstalledViewport(page, viewport);
    assert.deepEqual(row.before, row.after);
    row.status = "PASS";
  } catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { save(); console.log(`${row.status}: ${layout}/${viewport.width}/DPR${viewport.dpr}/${viewport.reduced}`); }
}
(async () => {
  save(); profilePrepared = true; profile("Prepare");
  const matrix = [1, 2].flatMap(dpr => [false, true].flatMap(reduced =>
    [[1920,1080],[2560,1440],[3840,2160]].map(([width,height]) => ({ width,height,dpr,reduced }))));
  for (const layout of ["agentvn", "renpy"]) {
    const input = await fixture(layout), errors = [];
    session = await savePageNativePreview({ buildFile, out, report, save, viewport: matrix[0], input, layout });
    const page = session.page; page.setDefaultTimeout(20000); page.on("pageerror", error => errors.push(String(error)));
    try {
      await page.locator(".boot-card .project-entry-loader").waitFor();
      await page.evaluate(cartridgeBase64 => window.postMessage({ type: "agentvn.runtime.preview",
        cartridgeBase64, fileName: "save-page.vncart", previewNonce: "save-page-time01" }, "*"),
      fs.readFileSync(input).toString("base64"));
      await page.getByTestId("game-state-title").waitFor(); await idle(page, "title_menu");
      for (const viewport of matrix) await caseFlow(layout, viewport);
      assert.deepEqual(errors, []);
    } finally { await session.close(); session = undefined; }
  }
  assert.equal(report.cases.length, 24); assert(report.cases.every(c => c.status === "PASS" && c.traces.length === 4));
  assert.equal(report.screenshots.length, 24);
  savePageNativeBuildEvidence(buildFile, out);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(async () => {
  try {
    await session?.close();
    if (profilePrepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profile("Restore");
      report.profileRestoration = describe(path.join(out, "profile-restoration.json"));
    }
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error }));
});
