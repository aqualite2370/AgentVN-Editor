"use strict";
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib"), net = require("node:net"), assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process"), JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const { sha256, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const { beginRuntimeMotion, finishRuntimeMotion } = require("./lib/installed-runtime-motion-sampler.cjs");
const run = "D:/AgentVN/output/installed-runtime-motion-20261018-01", work = "F:/AgentVN-QA-InstalledRuntimeMotion-20261018-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const out = process.argv[2], probe = process.argv.includes("--probe");
assert(out && !fs.existsSync(out)); fs.mkdirSync(out);
const traceRoot = path.join(work, path.basename(out)); assert(!fs.existsSync(traceRoot)); fs.mkdirSync(traceRoot);
const prep = read(path.join(run, "preparation.json")); assert.equal(prep.status, "PASS"); assert.equal(prep.verifiedOriginalFiles, 55);
for (const p of prep.profiles) assert(fs.existsSync(p.held), "Protect all four original profiles before installed testing");
const installRoot = "F:/AgentVN-QA-HostUpgrade-20261018-02/installed-editor", exe = path.join(installRoot, "agentvn-player.exe");
const sourceReports = { agentvn: "D:/AgentVN/output/installed-assets-20261018-01/cartridge-02/report.json",
  renpy: "D:/AgentVN/output/installed-assistant-review-20261018-01/review-07/report.json" };
const sourceProjects = { agentvn: read("D:/AgentVN/output/installed-assets-20261018-01/fixtures.json").input,
  renpy: read("D:/AgentVN/output/installed-assistant-review-20261018-01/fixtures.json").input };
const report = { status: "RUNNING", at: new Date().toISOString(), scope: "ACTUAL_INSTALLED_PLAYER_UNMODIFIED_UI_EXPORTED_CARTRIDGES; NOT_WINDOWS_SETUP_OR_ANDROID",
  probeOnly: probe, matrix: [], launches: [], screenshots: [], sourceReports: [], pageErrors: [], realModelRequests: 0, productChanges: 0,
  environment: { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: process.env.AGENTVN_WORKSPACE_OUTPUT, sourceProjects },
  method: "Real native WebView CDP viewport simulation, trusted click/key input, raw native capture and read-only RAF; no store/style/time mock; not performance benchmark",
  error: null };
let page, browser, cdp, child, owned, current, expected, serial = 0;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const pause = ms => new Promise(r => setTimeout(r, ms));
function processInfo(pid) {
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"|Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate|ConvertTo-Json`],
  { encoding: "utf8", windowsHide: true });
  return raw.trim() ? JSON.parse(raw.replace(/^\uFEFF/, "")) : null;
}
function check(row, name, ok, detail) { row.checks.push({ name, status: ok ? "PASS" : "FAILED", ...(ok ? {} : { detail }) }); }
function common(row, trace) {
  check(row, "Nonempty visible native sequence and trusted input", trace.frames.length >= 3 && !trace.limitReached
    && trace.inputs.some(i => i.trusted) && trace.frames.every(f => !f.hidden), { frames: trace.frames.length, inputs: trace.inputs, cap: trace.limitReached });
  check(row, "Every actual frame matches this viewport/DPR/media", trace.frames.every(f => f.width === expected.width && f.height === expected.height && f.dpr === expected.dpr && f.reduced === expected.reduced));
  check(row, "No horizontal overflow or second functional layer/player", trace.frames.every(f => f.horizontalOverflow <= 1 && f.functionalLayerCount === 1 && f.playerCount <= 1),
    trace.frames.filter(f => f.horizontalOverflow > 1 || f.functionalLayerCount !== 1 || f.playerCount > 1).slice(0, 2));
  check(row, "Retained pixels cannot receive input/focus", trace.frames.every(f => !f.snapshotFocus
    && f.snapshots.every(s => s.inert && s.ariaHidden === "true" && s.pointerEvents === "none")));
}
async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected)); save(); }
async function episode(name, action, verify) {
  const row = { name, status: "RUNNING", checks: [] }; current.episodes.push(row); save();
  await beginRuntimeMotion(page, name);
  try { await action(); } catch (e) { row.actionError = String(e.stack || e); }
  const trace = await finishRuntimeMotion(page), file = path.join(traceRoot, `${++serial}-${current.key}-${name}.json.gz`);
  const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(trace))); fs.writeFileSync(file, bytes, { flag: "wx" });
  row.trace = { path: file, sha256: sha256(bytes), frames: trace.frames.length }; common(row, trace);
  if (row.actionError) check(row, "Actual UI action reaches expected state", false, row.actionError);
  try { await verify?.(row, trace); } catch (e) { check(row, "Verifier has complete evidence", false, String(e.stack || e)); }
  row.status = row.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  save(); console.log(`${row.status} ${current.key} ${name}`);
  if (row.actionError) throw new Error(`DEPENDENT_FLOW_STOP:${name}\n${row.actionError}`);
  return row;
}
async function screenReady(target) {
  await page.waitForFunction(target => {
    const root = document.querySelector("[data-runtime-screen-transition]");
    return root?.getAttribute("data-runtime-presented-screen") === target && root?.getAttribute("data-runtime-screen-transition") === "idle"
      && !document.querySelector('[data-testid="game-launch-blackout"]');
  }, target, { timeout: 30000 });
  await settleRuntime(page);
}
function transitionChecks(row, trace, { from, to, style, stableNav = false }) {
  const frames = trace.frames, changing = frames.filter(f => f.phase !== "idle" && f.phase !== "loading");
  const total = expected.reduced ? 816 : 1632;
  check(row, "Requested page commits once and reaches unique final state", frames.at(-1).screen === to && frames.at(-1).committed === to
    && frames.at(-1).phase === "idle" && !frames.at(-1).snapshots.length && !frames.at(-1).unavailableFocus,
  frames.at(-1));
  check(row, "Actual transition duration equals existing cover plus reveal token", changing.length >= 2
    && changing.every(f => f.duration === total && f.coverMs + f.revealMs === total), changing.slice(0, 2));
  if (style === "crossfade") {
    const cross = changing.filter(f => f.phase === "crossfading");
    check(row, "Non-gameplay Renpy pages crossfade without black curtain", cross.length >= 3 && changing.every(f => f.style === "crossfade" && f.black < .01),
      changing.slice(0, 2));
    check(row, "Real entering and inert outgoing intermediate pixels overlap without blank/double flash", cross.filter(f => f.surface?.opacity > .01 && f.surface.opacity < .99).length >= 2
      && cross.every(f => f.snapshots.some(s => !s.category && Math.abs(s.opacity + f.surface.opacity - 1) <= .1)), cross.slice(0, 2));
    if (stableNav) {
      const start = frames.find(f => f.nav)?.nav.rect;
      check(row, "Shared navigation stays mounted and geometrically fixed", Boolean(start) && frames.every(f => f.sameNavigation && f.nav
        && ["x", "y", "width", "height"].every(k => Math.abs(f.nav.rect[k] - start[k]) <= 1)), frames.filter(f => !f.sameNavigation).slice(0, 2));
    }
  } else {
    check(row, "AgentVN/gameplay screen seam retains cover, swap and reveal", ["covering", "swap", "revealing"].every(p => changing.some(f => f.phase === p))
      && changing.some(f => f.phase === "covering" && f.black > .01 && f.black < .99)
      && changing.some(f => f.phase === "revealing" && f.black > .01 && f.black < .99), changing.slice(0, 2));
    const committed = frames.find(f => f.screen === to && f.committed === to);
    check(row, "Screen replaces old page only behind full black", committed && committed.black >= .99, committed);
  }
  row.timings = { from, to, expectedMs: total, observedChangingSpanMs: changing.length ? changing.at(-1).at - changing[0].at : null };
}
async function navigation(name, button, from, to, options = {}) {
  await episode(name, async () => {
    if (options.keyboard) { await button.focus(); await page.keyboard.press("Enter"); } else await button.click();
    await screenReady(to);
  }, (row, trace) => transitionChecks(row, trace, { from, to,
    style: current.layout === "renpy" && from !== "playing" && to !== "playing" ? "crossfade" : "blackout", ...options }));
}
async function launchEpisode(name, action) {
  await episode(name, async () => { await action(); await page.getByTestId("game-state-playing").waitFor(); await screenReady("playing"); }, (row, trace) => {
    const cover = trace.frames.filter(f => f.launchClass?.includes("is-covering")), reveal = trace.frames.filter(f => f.launchClass?.includes("is-revealing"));
    check(row, "Dedicated gameplay launch cover and reveal retain visible intermediate opacity", cover.some(f => f.launch.opacity > .01 && f.launch.opacity < .99)
      && reveal.some(f => f.launch.opacity > .01 && f.launch.opacity < .99), { covering: cover.slice(0, 2), revealing: reveal.slice(0, 2) });
    check(row, "Dedicated launch does not stack a second screen curtain", trace.frames.filter(f => f.launch).every(f => f.black < .01));
    check(row, "Gameplay remains sole final page", trace.frames.at(-1).screen === "playing" && !trace.frames.at(-1).launch
      && trace.frames.at(-1).playerCount === 1 && trace.frames.at(-1).phase === "idle");
  });
}
async function categories() {
  for (const [id, label] of [["text", "文字"], ["audio", "音频"], ["skip", "跳过"], ["system", "系统"]]) {
    await episode(`settings-category-${id}`, async () => {
      await page.locator(".settings-tabs").getByRole("button", { name: label, exact: true }).click();
      await page.waitForFunction(id => document.querySelector("[data-settings-tab-current]")?.getAttribute("data-settings-tab-current") === id
        && document.querySelector("[data-settings-transition]")?.getAttribute("data-settings-transition") === "idle", id);
    }, (row, trace) => {
      const fade = trace.frames.filter(f => f.categoryPhase === "crossfading");
      check(row, "Settings category retains continuous same-token fade and no global curtain", fade.length >= 3
        && fade.every(f => f.categoryDuration === (expected.reduced ? 816 : 1632) && f.black < .01)
        && fade.some(f => f.category?.opacity > .01 && f.category.opacity < .99));
      check(row, "Category final target and focus ownership are valid", trace.frames.at(-1).categoryId === id && !trace.frames.at(-1).unavailableFocus);
    });
  }
}
async function modalCancel() {
  await episode("exit-modal-open-cancel", async () => {
    await page.getByTestId("open-exit-confirmation").click();
    const dialog = page.getByRole("dialog", { name: "退出游戏？", exact: true }); await dialog.waitFor();
    await page.evaluate(async () => {
      const n = document.querySelector("[data-runtime-modal='true']");
      await Promise.all(n.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
    await screenReady("settings");
  }, (row, trace) => {
    const modal = trace.frames.filter(f => f.modal);
    check(row, "Modal owns keyboard focus and remains within actual viewport", modal.length >= 2 && modal.every(f => f.modalFocus
      && f.modal.rect.left >= 0 && f.modal.rect.top >= 0 && f.modal.rect.right <= expected.width && f.modal.rect.bottom <= expected.height), modal.slice(0, 2));
    check(row, "Modal opening retains actual intermediate opacity or transform", modal.filter(f => f.modal.opacity > .01 && f.modal.opacity < .99
      || f.backdrop?.opacity > .01 && f.backdrop.opacity < .99
      || f.modal.transform !== "none").length >= 2, modal.slice(0, 2));
    check(row, "Escape closes only modal without leaving settings", trace.frames.at(-1).screen === "settings" && trace.frames.at(-1).modalCount === 0);
  });
}
async function quickMenu() {
  if (current.layout === "agentvn") {
    await episode("quick-menu-expand-collapse", async () => {
      const toggle = page.getByTestId("quick-menu-toggle"); await toggle.click();
      await page.locator(".playback-controls.is-expanded").waitFor(); await settleRuntime(page);
      await toggle.click(); await page.locator(".playback-controls.is-collapsed").waitFor(); await settleRuntime(page);
    }, (row, trace) => {
      const clips = trace.frames.filter(f => f.quickSurface?.animations.some(a => a.name === "clip-path" && a.state === "running"));
      const fading = trace.frames.filter(f => f.quickButtons.some(b => b.opacity > .01 && b.opacity < .99));
      check(row, "AgentVN quick menu has real intermediate presentation", expected.reduced ? fading.length >= 2
        : clips.length >= 2 && new Set(clips.map(f => f.quickSurface.clipPath)).size >= 3,
      { clipFrames: clips.length, clipPaths: [...new Set(clips.map(f => f.quickSurface.clipPath))].slice(0, 6),
        fadingFrames: fading.length, note: "Normal menu uses clip-path; reduced mode independently checks its80ms button opacity feedback." });
      check(row, "Quick menu does not change active story or add page curtain", trace.frames.every(f => f.screen === "playing" && f.black < .01));
    });
  } else {
    current.quickGeometry = await page.getByTestId("renpy-quick-bar").evaluate(nav => {
      const r = nav.getBoundingClientRect(), buttons = [...nav.querySelectorAll("button")].map(b => {
        const x = b.getBoundingClientRect(); return { label: b.textContent, rect: x.toJSON(),
          hit: b.disabled || b.contains(document.elementFromPoint(x.x + x.width / 2, x.y + x.height / 2)) };
      }); return { rect: r.toJSON(), buttons };
    });
    const q = current.quickGeometry;
    current.quickGeometry.status = q.buttons.length === 8 && q.buttons.every(b => b.hit && Math.abs(b.rect.top - q.buttons[0].rect.top) <= 1
      && b.rect.left >= 0 && b.rect.right <= expected.width) ? "PASS" : "FAILED";
  }
}
async function flow() {
  const title = "title_menu";
  await navigation("title-to-settings", page.getByTestId("open-settings"), title, "settings");
  await categories(); await modalCancel();
  if (current.layout === "renpy") {
    await navigation("settings-to-about", page.getByTestId("renpy-menu-about"), "settings", "about", { stableNav: true });
    await navigation("about-to-help-keyboard", page.getByTestId("renpy-menu-help"), "about", "help", { stableNav: true, keyboard: true });
    await navigation("help-to-history", page.getByTestId("renpy-menu-history"), "help", "history", { stableNav: true });
    await navigation("history-to-save-load", page.getByTestId("renpy-menu-save-load"), "history", "save_load", { stableNav: true });
    await episode("rapid-menu-redirect", async () => {
      await page.getByTestId("renpy-menu-settings").click();
      await page.waitForFunction(() => {
        const n = document.querySelector("[data-runtime-motion-surface]");
        return document.querySelector("[data-runtime-transition-phase='crossfading']") && Number(getComputedStyle(n).opacity) > .2 && Number(getComputedStyle(n).opacity) < .8;
      });
      for (const testId of ["renpy-menu-help", "renpy-menu-history", "renpy-menu-about"]) await page.getByTestId(testId).click();
      await screenReady("about");
    }, (row, trace) => {
      check(row, "Latest page wins during actual midfade redirects", trace.frames.at(-1).screen === "about" && trace.frames.at(-1).committed === "about"
        && trace.frames.at(-1).snapshots.length === 0 && trace.frames.at(-1).phase === "idle");
      check(row, "Interrupted menu retains shared rail, no black and continuous opacity", trace.frames.every(f => f.black < .01 && f.sameNavigation)
        && trace.frames.some(f => f.surface.opacity > .01 && f.surface.opacity < .99));
    });
    await navigation("menu-to-title", page.getByTestId("renpy-menu-return"), "about", title);
  } else {
    await navigation("settings-to-title", page.getByTestId("settings-finish"), "settings", title);
    await navigation("title-to-about", page.getByTestId("open-about"), title, "about");
    await navigation("about-to-title", page.getByTestId("back-to-main-menu"), "about", title);
    await navigation("title-to-save-load", page.getByTestId("open-save-load"), title, "save_load");
    await navigation("save-load-to-title", page.getByTestId("back-to-player"), "save_load", title);
  }
  await launchEpisode("title-to-playing", () => page.getByTestId("start-new-game").click());
  await quickMenu();
  await episode("playing-to-main-menu-Escape", async () => { await page.keyboard.press("Escape"); await screenReady("main_menu"); },
    (row, trace) => transitionChecks(row, trace, { from: "playing", to: "main_menu", style: "blackout" }));
  await navigation("main-menu-to-settings", page.getByTestId("open-settings"), "main_menu", "settings");
  await navigation("settings-to-main-menu", page.getByTestId("settings-finish"), "settings", "main_menu");
  await launchEpisode("main-menu-continue-playing", () => page.getByTestId("continue-game").click());
  await episode("Escape-during-menu-cover", async () => {
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("[data-runtime-transition-phase='covering']"));
    await page.keyboard.press("Escape");
    // Settle whatever the actual product commits, then assert the requested
    // gameplay result below. Do not spend30s re-waiting a known wrong target.
    await settleRuntime(page);
  }, (row, trace) => {
    check(row, "Escape during curtain is not swallowed and returns to gameplay", trace.inputs.filter(i => i.key === "Escape" && i.trusted).length === 2
      && trace.frames.at(-1).screen === "playing" && trace.frames.at(-1).phase === "idle" && trace.frames.at(-1).playerCount === 1);
  });
}
async function stopOwned() {
  await page?.evaluate(() => window.__qaRuntimeMotion?.stop?.()).catch(() => {}); await browser?.close().catch(() => {});
  browser = null; page = null; cdp = null;
  const item = report.launches.at(-1); if (!item) return;
  item.cleanup = { method: "ATTRIBUTED_OWNED_TERMINATION_NOT_NORMAL_CLOSE_ACCEPTANCE", status: "RUNNING" };
  if (child && child.exitCode === null) {
    const now = processInfo(child.pid);
    assert(now && now.ExecutablePath === owned.ExecutablePath && now.ParentProcessId === owned.ParentProcessId && now.CreationDate === owned.CreationDate, "Owned player changed");
    child.kill(); await new Promise(r => child.exitCode !== null ? r() : child.once("exit", r));
  }
  const deadline = Date.now() + 10000; let listening = true;
  while (Date.now() < deadline) {
    try { await fetch(`http://127.0.0.1:${item.cdpPort}/json/version`, { signal: AbortSignal.timeout(300) }); } catch { listening = false; break; }
    await pause(100);
  }
  item.cleanup.status = !processInfo(item.pid) && !listening ? "PASS" : "FAILED"; assert.equal(item.cleanup.status, "PASS");
  child = null; owned = null; save();
}
(async () => {
  assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
  assert.equal(sha256(fs.readFileSync(exe)), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
  report.exe = { path: exe, sha256: sha256(fs.readFileSync(exe)) };
  for (const layout of ["agentvn", "renpy"]) {
    const sourceFile = sourceReports[layout], source = read(sourceFile); assert.equal(source.status, "PASS");
    const cartridge = source.cartridge, bytes = fs.readFileSync(cartridge.path); assert.equal(sha256(bytes), cartridge.sha256);
    const zip = await JSZip.loadAsync(bytes), skin = JSON.parse(await zip.file("ui/layout.json").async("string"));
    assert.equal(skin.layout_type || "agentvn", layout);
    report.sourceReports.push({ path: sourceFile, sha256: sha256(fs.readFileSync(sourceFile)), cartridge, layoutSha256: sha256(await zip.file("ui/layout.json").async("nodebuffer")), layout });
    assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(sourceProjects.agentvn));
    const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
    const env = { ...process.env }; for (const name of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(name)) delete env[name];
    env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
    child = spawn(exe, ["--mode", "preview", "--cartridge", cartridge.path], { cwd: installRoot, env, windowsHide: true, stdio: "ignore" });
    owned = processInfo(child.pid); assert.equal(path.resolve(owned.ExecutablePath).toLowerCase(), path.resolve(exe).toLowerCase());
    report.launches.push({ layout, pid: child.pid, cdpPort: port, identity: owned, defaultIsolatedProfile: true, backendStarted: false });
    save(); const deadline = Date.now() + 45000; let ready = false;
    while (Date.now() < deadline && child.exitCode === null) { try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (ready) break; await pause(100); } assert(ready, "Owned installed player debugger unavailable");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost"));
    assert(page); page.setDefaultTimeout(30000); cdp = await page.context().newCDPSession(page);
    page.on("pageerror", e => report.pageErrors.push({ layout, error: String(e) }));
    for (const [width, height] of (probe ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]]))
      for (const dpr of (probe ? [1] : [1, 2])) for (const reduced of (probe ? [false] : [false, true])) {
        expected = { width, height, dpr, reduced }; current = { ...expected, layout, key: `${layout}-${width}-${dpr}-${reduced}`, status: "RUNNING", episodes: [] };
        report.matrix.push(current); save();
        try {
          await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
          await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" }); await readInstalledViewport(page, expected);
          await page.reload({ waitUntil: "domcontentloaded" }); await page.getByTestId("start-new-game").waitFor(); await screenReady("title_menu");
          await flow(); await shot(`${current.key}-playing-final`);
          current.status = current.episodes.every(e => e.status === "PASS") && current.quickGeometry?.status !== "FAILED" ? "PASS" : "FAILED";
        } catch (e) {
          current.status = "FAILED"; current.error = String(e.stack || e); await shot(`${current.key}-action-failure`).catch(() => {});
          await page.evaluate(() => window.__qaRuntimeMotion?.stop?.()).catch(() => {});
        }
        save(); console.log(`COMBINATION ${current.key} ${current.status}`);
      }
    assert.equal(sha256(fs.readFileSync(cartridge.path)), cartridge.sha256); await stopOwned();
  }
  assert.equal(report.matrix.length, probe ? 2 : 24);
  report.status = report.matrix.every(m => m.status === "PASS") && report.pageErrors.length === 0 ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try { await stopOwned(); } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, combinations: report.matrix.length, probeOnly: probe,
    failedEpisodes: report.matrix.flatMap(m => m.episodes.filter(e => e.status === "FAILED").map(e => `${m.key}/${e.name}`)),
    error: report.error, cleanupError: report.cleanupError, out }, null, 2));
});
