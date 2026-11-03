"use strict";
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib"), assert = require("node:assert/strict");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { beginRuntimeMotion, finishRuntimeMotion } = require("./lib/installed-runtime-motion-sampler.cjs");
const { check, common, transition, validateReport } = require("./lib/native-runtime-motion-oracle.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const index = process.argv.indexOf("--current-native-preparation"); assert(index >= 0);
const prepFile = path.resolve(process.argv[index + 1]), prep = read(prepFile), out = prep.sessionRoot;
const current1922 = prep.current1922Preview === true;
const { InstalledPreview1922Session } = require("./lib/installed-runtime-preview-1922-session.cjs");
const { validateQuickBar } = require("./lib/installed-runtime-motion-1922-policy.cjs");
const smoke = process.argv.includes("--smoke"), reportFile = path.join(out, "motion.json");
assert(!fs.existsSync(reportFile)); assert.equal(prep.defaultStorage, current1922
  ? "CODEX_EXPLICIT_PROFILE_JUNCTION_PREVIEW" : "PHYSICAL_DEFAULT_PATH");
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(prep.fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(out));
const traceRoot = path.join(out, "traces"); fs.mkdirSync(traceRoot);
const report = { status: "RUNNING", at: new Date().toISOString(),
  scope: current1922 ? "ACTUAL_1922_NSIS_SHIPPED_PLAYER_PREVIEW_MOTION_NOT_STANDALONE_SETUP_ANDROID"
    : "CURRENT_NATIVE_LIBRARY_MOTION_NOT_INSTALL_SETUP_UPGRADE_ANDROID", smoke,
  matrix: [], launches: [], screenshots: [], pageErrors: [], productChanges: 0, builds: 0, modelRequests: 0,
  sources: [prepFile, prep.fixture.input, ...prep.cartridges.map(c => c.path)].map(file => ({ path: file, sha256: sha(file) })),
  notRun: ["Editor transitions", "New Editor export or Release installation", "Windows setup/upgrade", "Android native back",
    "Physical native window close", "Physical 4K display"],
  error: null, cleanupError: null };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
let s, current, serial = 0;
async function episode(name, action, verify) {
  const row = { name, status: "RUNNING", checks: [] }; current.episodes.push(row); save();
  await beginRuntimeMotion(s.page, name);
  try { await action(); } catch (e) { row.actionError = String(e.stack || e); }
  const trace = await finishRuntimeMotion(s.page);
  const file = path.join(traceRoot, `${++serial}-${current.key}-${name}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(trace))), { flag: "wx" });
  row.trace = { path: file, sha256: sha(file), frames: trace.frames.length };
  common(row, trace, current);
  if (row.actionError) check(row, "Actual UI reaches requested state", false, row.actionError);
  try { await verify(row, trace); }
  catch (e) { check(row, "Verifier has complete evidence", false, String(e.stack || e)); }
  row.status = row.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  save(); console.log(`${row.status}: ${current.key}/${name}`);
  if (row.actionError) throw new Error(`DEPENDENT_FLOW_STOP:${name}\n${row.actionError}`);
}
function navigate(name, button, from, to, options = {}) {
  return episode(name, async () => {
    if (options.keyboard) { await button.focus(); await s.page.keyboard.press("Enter"); }
    else await button.click();
    await s.ready(to);
  }, (r, t) => transition(r, t, current, { from, to, style:
    current.layout === "renpy" && from !== "playing" && to !== "playing" ? "crossfade" : "blackout", ...options }));
}
function launch(name, action) {
  return episode(name, async () => { await action(); await s.ready("playing"); }, (r, t) => {
    const cover = t.frames.filter(f => f.launchClass?.includes("is-covering"));
    const reveal = t.frames.filter(f => f.launchClass?.includes("is-revealing"));
    check(r, "Story launch has visible covering and revealing frames",
      cover.some(f => f.launch.opacity > .01 && f.launch.opacity < .99)
      && reveal.some(f => f.launch.opacity > .01 && f.launch.opacity < .99),
    { cover: cover.slice(0, 2), reveal: reveal.slice(0, 2) });
    check(r, "Story entry owns the sole curtain and final player",
      t.frames.filter(f => f.launch).every(f => f.black < .01)
      && t.frames.at(-1).screen === "playing" && !t.frames.at(-1).launch && t.frames.at(-1).playerCount === 1);
  });
}
async function modal(interrupted) {
  await episode(interrupted ? "exit-modal-interrupted-close-reopen" : "exit-modal-open-cancel", async () => {
    await s.page.getByTestId("open-exit-confirmation").click();
    const dialog = s.page.getByRole("dialog", { name: "退出游戏？", exact: true }); await dialog.waitFor();
    await settleRuntime(s.page);
    await s.page.keyboard.press("Tab"); await s.page.keyboard.press("Shift+Tab");
    await s.page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
    if (interrupted) {
      await s.page.waitForFunction(() => [...document.querySelectorAll("[data-runtime-modal-exit]")]
        .some(n => { const a = Number(getComputedStyle(n).opacity); return a > .2 && a < .8; }));
      await s.page.getByTestId("open-exit-confirmation").click(); await dialog.waitFor();
      await settleRuntime(s.page);
      await s.page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
    }
    await s.ready("settings");
  }, (r, t) => {
    const live = t.frames.filter(f => f.modal), leaving = t.frames.filter(f => f.modalExits.length);
    check(r, "Modal traps focus, keeps lower siblings inert and stays in viewport", live.length >= 2 && live.every(f =>
      f.modalFocus && f.modalSiblingsInert && f.modal.rect.left >= -1 && f.modal.rect.top >= -1
      && f.modal.rect.right <= current.width + 1 && f.modal.rect.bottom <= current.height + 1), live.slice(0, 2));
    check(r, "Modal opening and exit both have visible intermediate opacity",
      live.filter(f => f.backdrop.opacity > .01 && f.backdrop.opacity < .99).length >= 2
      && leaving.filter(f => f.modalExits.some(s => s.opacity > .01 && s.opacity < .99)).length >= 2,
    { liveFrames: live.length, exitFrames: leaving.length });
    check(r, "Escape closes only dialog, cleans ghosts and restores an available focus owner",
      t.frames.at(-1).screen === "settings" && t.frames.at(-1).modalCount === 0
      && !t.frames.at(-1).modalExits.length && !t.frames.at(-1).unavailableFocus
      && t.frames.at(-1).focusTag !== "BODY", t.frames.at(-1));
    if (interrupted) check(r, "Close/reopen consumed genuine inputs without a second functional dialog",
      t.inputs.filter(i => i.key === "Escape" && i.trusted).length === 2
      && t.inputs.filter(i => i.target === "open-exit-confirmation" && i.trusted).length === 2
      && t.frames.every(f => f.modalCount <= 1) && live.some(f => f.backdrop.opacity > .01 && f.backdrop.opacity < .99));
  });
}
async function quick() {
  if (current.layout === "renpy") {
    current.quickGeometry = await s.page.getByTestId("renpy-quick-bar").evaluate(nav => {
      const rect = nav.getBoundingClientRect().toJSON();
      return { rect, buttons: [...nav.querySelectorAll("button")].map(b => {
        const r = b.getBoundingClientRect(); return { label: b.textContent, id: b.getAttribute("data-testid")?.replace("renpy-quick-", ""), rect: r.toJSON(), disabled: b.disabled,
          hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      }) };
    });
    const g = current.quickGeometry;
    g.status = current1922 ? validateQuickBar({ ...g, width: current.width }).status : g.buttons.length === 8 && g.buttons.every(b => b.hit
      && Math.abs(b.rect.top - g.buttons[0].rect.top) <= 1 && b.rect.left >= -1 && b.rect.right <= current.width + 1)
      ? "PASS" : "FAILED";
    return;
  }
  await episode("quick-menu-expand-collapse", async () => {
    const button = s.page.getByTestId("quick-menu-toggle");
    await button.click(); await s.page.locator(".playback-controls.is-expanded").waitFor(); await settleRuntime(s.page);
    await button.click(); await s.page.locator(".playback-controls.is-collapsed").waitFor(); await settleRuntime(s.page);
  }, (r, t) => {
    const clip = t.frames.filter(f => f.quickSurface?.animations.some(a => a.name === "clip-path" && a.state === "running"));
    const fade = t.frames.filter(f => f.quickButtons.some(b => b.opacity > .01 && b.opacity < .99));
    check(r, "Quick menu retains independent normal/reduced visible intermediate feedback",
      current.reduced ? fade.length >= 2 : clip.length >= 2 && new Set(clip.map(f => f.quickSurface.clipPath)).size >= 3,
    { clipFrames: clip.length, clipPaths: [...new Set(clip.map(f => f.quickSurface.clipPath))].slice(0, 6), fadeFrames: fade.length });
    check(r, "Quick menu never replaces story or adds blackout", t.frames.every(f => f.screen === "playing" && f.black < .01));
  });
}
async function flow() {
  const p = s.page, title = "title_menu";
  await navigate("title-to-settings", p.getByTestId("open-settings"), title, "settings");
  for (const [id, label] of [["text", "文字"], ["audio", "音频"], ["skip", "跳过"], ["system", "系统"]])
    await episode(`settings-category-${id}`, async () => {
      await p.locator(".settings-tabs").getByRole("button", { name: label, exact: true }).click();
      await p.waitForFunction(id => document.querySelector("[data-settings-tab-current]")?.getAttribute("data-settings-tab-current") === id
        && document.querySelector("[data-settings-transition]")?.getAttribute("data-settings-transition") === "idle", id);
      await settleRuntime(p);
    }, (r, t) => {
      const fade = t.frames.filter(f => f.categoryPhase === "crossfading");
      check(r, "Category uses same total duration without black flash", fade.length >= 3
        && fade.every(f => f.categoryDuration === (current.reduced ? 816 : 1632) && f.black < .01)
        && fade.some(f => f.category.opacity > .01 && f.category.opacity < .99));
      check(r, "Category final target and focus are correct", t.frames.at(-1).categoryId === id && !t.frames.at(-1).unavailableFocus);
    });
  await modal(false); await modal(true);
  if (current.layout === "renpy") {
    await navigate("settings-to-about", p.getByTestId("renpy-menu-about"), "settings", "about", { stableNav: true });
    await navigate("about-to-help-keyboard", p.getByTestId("renpy-menu-help"), "about", "help", { stableNav: true, keyboard: true });
    await navigate("help-to-history", p.getByTestId("renpy-menu-history"), "help", "history", { stableNav: true });
    await navigate("history-to-save-load", p.getByTestId("renpy-menu-save-load"), "history", "save_load", { stableNav: true });
    await episode("rapid-menu-redirect", async () => {
      await p.getByTestId("renpy-menu-settings").click();
      await p.waitForFunction(() => {
        const n = document.querySelector("[data-runtime-motion-surface]");
        return n && document.querySelector("[data-runtime-transition-phase='crossfading']")
          && Number(getComputedStyle(n).opacity) > .2 && Number(getComputedStyle(n).opacity) < .8;
      });
      for (const id of ["renpy-menu-help", "renpy-menu-history", "renpy-menu-about"]) await p.getByTestId(id).click();
      await s.ready("about");
    }, (r, t) => {
      check(r, "Latest request wins and leaves no snapshot/focus in old content", t.frames.at(-1).screen === "about"
        && t.frames.at(-1).committed === "about" && t.frames.at(-1).phase === "idle"
        && !t.frames.at(-1).snapshots.length && !t.frames.at(-1).unavailableFocus);
      check(r, "Interrupted menu retains rail and visible fade, never black", t.frames.every(f => f.black < .01 && f.sameNavigation)
        && t.frames.some(f => f.surface.opacity > .01 && f.surface.opacity < .99));
    });
    await navigate("menu-to-title", p.getByTestId("renpy-menu-return"), "about", title);
  } else {
    await navigate("settings-to-title", p.getByTestId("settings-finish"), "settings", title);
    await navigate("title-to-about", p.getByTestId("open-about"), title, "about");
    await navigate("about-to-title", p.getByTestId("back-to-main-menu"), "about", title);
    await navigate("title-to-save-load", p.getByTestId("open-save-load"), title, "save_load");
    await navigate("save-load-to-title", p.getByTestId("back-to-player"), "save_load", title);
  }
  await launch("title-to-playing", () => p.getByTestId("start-new-game").click());
  await quick();
  await episode("playing-to-main-menu-Escape", async () => { await p.keyboard.press("Escape"); await s.ready("main_menu"); },
    (r, t) => transition(r, t, current, { from: "playing", to: "main_menu", style: "blackout" }));
  await navigate("main-menu-to-settings", p.getByTestId("open-settings"), "main_menu", "settings");
  await navigate("settings-to-main-menu", p.getByTestId("settings-finish"), "settings", "main_menu");
  await launch("main-menu-continue-playing", () => p.getByTestId("continue-game").click());
  await episode("Escape-during-menu-cover", async () => {
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => document.querySelector("[data-runtime-transition-phase='covering']"));
    await p.keyboard.press("Escape"); await settleRuntime(p);
  }, (r, t) => {
    check(r, "Second genuine Escape during cover returns to the same story",
      t.inputs.filter(i => i.key === "Escape" && i.trusted).length === 2
      && t.frames.at(-1).screen === "playing" && t.frames.at(-1).phase === "idle" && t.frames.at(-1).playerCount === 1,
    t.frames.at(-1));
  });
}
async function reloadTitle() {
  await s.page.reload({ waitUntil: "domcontentloaded" });
  if (current1922) { await s.ready("title_menu"); return; }
  await s.page.getByTestId("game-state-library").waitFor();
  const ordered = await s.native("list_installed_cartridges");
  await s.page.waitForFunction(n => document.querySelectorAll(".cartridge-spine").length === n, ordered.length);
  assert.deepEqual(await s.page.locator(".cartridge-spine strong").allTextContents(), ordered.map(r => r.title));
  const selected = ordered.findIndex(r => r.installId === s.installId); assert(selected >= 0);
  await s.page.locator(".cartridge-spine").nth(selected).click();
  await s.page.getByRole("button", { name: "启动卡带", exact: true }).click(); await s.ready("title_menu");
}
(async () => {
  save();
  for (const layout of ["agentvn", "renpy"]) {
    const Session = current1922 ? InstalledPreview1922Session : InstalledRuntimeSession;
    s = new Session({ prep, fixture: prep.fixture, cartridges: prep.cartridges, out, report, save,
      installId: `${prep.installId}_${layout}`, currentNative: true });
    await s.start(layout, false);
    for (const [width, height] of (smoke ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]]))
      for (const dpr of (smoke ? [1] : [1, 2])) for (const reduced of [false, true]) {
        current = { width, height, dpr, reduced, layout, key: `${layout}-${width}-${dpr}-${reduced}`,
          status: "RUNNING", episodes: [] }; report.matrix.push(current); save();
        try {
          await s.viewport(current); await reloadTitle(); await flow(); await s.shot(`${current.key}-final`);
          current.status = current.episodes.length === 19 && current.episodes.every(r => r.status === "PASS")
            && current.quickGeometry?.status !== "FAILED" ? "PASS" : "FAILED";
        } catch (e) {
          current.status = "FAILED"; current.error = String(e.stack || e);
          await s.shot(`${current.key}-failure`).catch(() => {});
          await s.page.evaluate(() => window.__qaRuntimeMotion?.stop?.()).catch(() => {});
        }
        save(); console.log(`COMBINATION ${current.key}: ${current.status}`);
      }
    await s.stop();
  }
  report.status = report.matrix.every(m => m.status === "PASS") && !report.pageErrors.length ? "PASS" : "FAILED";
  if (current1922) report.provenance = "ACTUAL_1922_NSIS_SHIPPED_PLAYER_PREVIEW";
  if (report.status === "PASS") validateReport(report, smoke, { preview1922: current1922 });
  else process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    await s?.page?.evaluate(() => window.__qaRuntimeMotion?.stop?.()).catch(() => {});
    await s?.stop();
    for (const f of report.sources) assert.equal(sha(f.path), f.sha256);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, matrix: report.matrix.length, episodes: report.matrix.reduce((n,m) => n+m.episodes.length,0),
    failed: report.matrix.flatMap(m => m.episodes.filter(e => e.status === "FAILED").map(e => `${m.key}/${e.name}`)),
    error: report.error, cleanupError: report.cleanupError, out }));
});
