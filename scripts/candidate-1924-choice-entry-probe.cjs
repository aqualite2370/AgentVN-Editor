"use strict";
// Read-only diagnosis against the installed candidate and the exact new UI
// exports. A Playwright visibility result is sampled before actionability.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { NarrativePlayer } = require("./lib/dev-narrative-player.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/choice-entry-probe-1924-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), out,
  scope: "READ_ONLY_INSTALLED_1924_FRESH_EXPORT_CHOICE_ENTRY_DIAGNOSIS_NOT_FULL_ACCEPTANCE",
  cells: [], launches: [], knownProcesses: [], screenshots: [], pageErrors: [], commands: [],
  modelRequests: 0, productChanges: 0, builds: 0, normalCloseClaimed: false,
  author: desc(path.join(base, "author-export-01/report.json")),
  installation: desc(path.join(base, "installation.json")),
  failedSource: desc("F:/AgentVN/QA/Native-Runtime-State-20261020-01/fresh-export-installed-1924-01/report.json"),
  tools: [__filename, "scripts/lib/dev-narrative-player.cjs", "scripts/native-dev-preview-profile.ps1",
    "scripts/lib/current-native-editor-session.cjs", "scripts/lib/current-native-capture.cjs",
    "scripts/lib/installed-runtime-session.cjs", "scripts/lib/installed-acceptance.cjs",
    "scripts/lib/voice-runtime-observer.cjs", "scripts/lib/owned-process-tree.cjs",
    "scripts/lib/owned-process-stop.cjs"].map(desc) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const author = read(report.author.path), installed = read(report.installation.path);
let player, prepared = false;
const prep = { sessionRoot: out, executable: installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),
  cartridges: author.cartridges, fixture: author.fixture, webview: path.join(out, "webview"), temporary: path.join(out, "temporary") };
function validate(p) {
  assert.equal(author.status, "PASS"); assert.equal(author.steps.length, 5);
  assert(author.steps.every(s => s.status === "PASS")); assert.equal(author.cartridges.length, 2);
  assert.equal(installed.status, "PASS"); assert.equal(installed.executable.version, "1.9.24");
  assert.equal(installed.metadataRestoration, "PASS");
  assert.equal(path.resolve(p.executable.path), path.resolve(installed.installRoot, "agentvn-player.exe"));
  assert.equal(path.resolve(p.sessionRoot), out); assert.deepEqual(p.cartridges, author.cartridges);
  for (const f of [report.author, report.installation, report.failedSource,
    installed.executable, ...installed.resources, ...installed.protectedFiles, ...author.tools, ...author.cartridges, ...report.tools])
    assert.equal(sha(f.path), f.sha256, f.path);
}
function profile(action) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/native-dev-preview-profile.ps1",
    "-Action", action, "-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"];
  const r = spawnSync("powershell.exe", args, { cwd: path.resolve(__dirname, ".."), windowsHide: true,
    encoding: "utf8", timeout: 45000 });
  const log = path.join(out, `profile-${action}.log`); fs.writeFileSync(log, r.stdout + r.stderr, { flag: "wx" });
  report.commands.push({ command: ["powershell.exe", ...args], exitCode: r.status, log }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
function predicates(v) {
  const r = v.rect;
  return { positiveSize: r.width > 0 && r.height > 0, leftTop: r.x >= -1 && r.y >= -1,
    rightBottom: r.right <= v.width + 1 && r.bottom <= v.height + 1,
    hit: v.hit, enabled: v.enabled, noHorizontalOverflow: v.overflow <= 1 };
}
function sample(e) {
  const r = e.getBoundingClientRect(), s = getComputedStyle(e), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const describe = n => n ? { tag: n.tagName, cls: String(n.className), testid: n.getAttribute("data-testid"),
    text: n.textContent?.slice(0, 90) } : null;
  const ancestors = [];
  for (let n = e; n && ancestors.length < 7; n = n.parentElement) {
    const c = getComputedStyle(n); ancestors.push({ ...describe(n), opacity: c.opacity, pointerEvents: c.pointerEvents,
      inert: n.inert, visibility: c.visibility, overflowX: c.overflowX, overflowY: c.overflowY });
  }
  return { at: performance.now(), rect: r.toJSON(), width: innerWidth, height: innerHeight,
    enabled: !e.disabled, hit: e.contains(hit), hitElement: describe(hit),
    overflow: document.documentElement.scrollWidth - innerWidth, opacity: s.opacity, transform: s.transform,
    pointerEvents: s.pointerEvents, ancestors,
    animations: e.getAnimations().map(a => ({ name: a.animationName, state: a.playState, time: a.currentTime,
      timing: a.effect?.getComputedTiming() })) };
}
(async () => {
  save(); validate(prep);
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  fs.mkdirSync(prep.temporary); prepared = true; profile("Prepare");
  player = new NarrativePlayer(prep, report, save, validate);
  for (const layout of ["agentvn", "renpy"]) for (const reduced of [false, true]) {
    const key = `${layout}-${reduced ? "reduced" : "normal"}`, row = { key, layout, reduced, status: "RUNNING" };
    report.cells.push(row); save();
    await player.start({ layout, installId: `qa_choice_probe_1924_${attempt}_${key}`, cell: key,
      viewport: { width: 1920, height: 1080, dpr: 1, reduced } });
    const page = player.page;
    await page.getByTestId("open-settings").click(); await player.ready("settings");
    await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
    await page.getByRole("checkbox", { name: "自动存档", exact: true }).uncheck();
    await page.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true }).click();
    await page.getByRole("slider", { name: "Text speed", exact: true }).focus(); await page.keyboard.press("Home");
    await page.getByTestId("settings-finish").click(); await player.ready("title_menu");
    await page.getByTestId("start-new-game").click(); await player.ready("playing");
    await page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
    await page.locator(".dialog-box").click();
    await page.evaluate(() => {
      window.__QA_CHOICE_ENTRY__ = { frames: [], running: true };
      const tick = () => {
        const q = window.__QA_CHOICE_ENTRY__; if (!q.running) return;
        const e = document.querySelector('.choice-option[aria-label="选择：voice_dialog"]');
        const r = e?.getBoundingClientRect(), s = e ? getComputedStyle(e) : null;
        q.frames.push({ at: performance.now(), exists: Boolean(e), disabled: e?.disabled,
          opacity: s?.opacity, transform: s?.transform, rect: r?.toJSON(),
          hit: r ? e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) : false,
          entering: e?.closest(".choice-panel")?.classList.contains("is-entering") });
        if (q.frames.length < 1800) requestAnimationFrame(tick);
      }; requestAnimationFrame(tick);
    });
    const locator = page.getByRole("button", { name: "选择：voice_dialog", exact: true });
    await locator.waitFor({ state: "visible" });
    row.atVisibility = await locator.evaluate(sample); row.visibilityPredicates = predicates(row.atVisibility); save();
    await locator.click({ trial: true });
    row.afterActionability = await locator.evaluate(sample);
    row.actionabilityPredicates = predicates(row.afterActionability);
    row.trace = await page.evaluate(() => { const q = window.__QA_CHOICE_ENTRY__; q.running = false; return q.frames; });
    save();
    assert(Object.values(row.actionabilityPredicates).every(Boolean), JSON.stringify(row.afterActionability));
    await locator.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="game-state-playing"]')?.dataset.currentSceneId === "voice_dialog");
    row.selectedExpectedScene = true; row.status = "PASS"; save();
    console.log(JSON.stringify({ key, initial: row.visibilityPredicates, actionable: row.actionabilityPredicates,
      waitMs: row.afterActionability.at - row.atVisibility.at, frames: row.trace.length }));
    await player.stop();
  }
  assert.equal(report.cells.length, 4); assert(report.cells.every(c => c.status === "PASS"));
  assert.deepEqual(report.pageErrors, []); assert(!report.observerError); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (player?.page) await player.shot("failure").catch(() => {});
}).finally(async () => {
  try { await player?.stop(); } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  try {
    assert(!rows().some(p => p.Name === "agentvn-player.exe" || p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
    if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profile("Restore"); report.restoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.restoration.path).status, "PASS");
    }
    validate(prep); assert.deepEqual(listeners(report.launches.map(l => l.port)), []);
  } catch (e) { report.status = "FAILED"; report.cleanupError = [report.cleanupError, String(e.stack || e)].filter(Boolean).join("\n"); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
