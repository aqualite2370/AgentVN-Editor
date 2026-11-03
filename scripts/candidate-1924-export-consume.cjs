"use strict";
// Consume fresh, actually UI-exported cartridges in the actual installed
// Player. This is library mode, not a standalone/setup or Android claim.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { NarrativePlayer } = require("./lib/dev-narrative-player.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { validateCartridge } = require("./installed-narrative-1922-export.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/fresh-export-installed-1924-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), out,
  scope: "INSTALLED_1_9_24_FRESH_UI_EXPORT_LIBRARY_CONSUMPTION_NOT_STANDALONE_OR_ANDROID",
  cells: [], stories: [], cartridges: [], launches: [], screenshots: [], knownProcesses: [], pageErrors: [],
  modelRequests: 0, productChanges: 0, builds: 0, commands: [], normalCloseClaimed: false,
  tools: [__filename, "scripts/lib/dev-narrative-player.cjs", "scripts/native-dev-preview-profile.ps1",
    "scripts/lib/voice-runtime-observer.cjs", "scripts/lib/current-native-capture.cjs",
    "scripts/lib/current-native-editor-session.cjs", "scripts/lib/owned-process-tree.cjs",
    "scripts/lib/owned-process-stop.cjs", "scripts/lib/installed-runtime-session.cjs",
    "scripts/lib/installed-acceptance.cjs", "scripts/installed-narrative-1922-export.cjs"].map(desc) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let player, prep, author, installed, prepared = false;
function validate(p) {
  assert.equal(author.status, "PASS"); assert(author.finishedAt && !author.cleanupError);
  assert.equal(author.scope, "ACTUAL_INSTALLED_1_9_24_FRESH_UI_EXPORT_NARRATIVE_AND_TITLE_NOT_STANDALONE_OR_ANDROID");
  assert.equal(author.steps.length, 5); assert(author.steps.every(s => s.status === "PASS"));
  assert.equal(author.cartridges.length, 2);
  assert.equal(installed.status, "PASS"); assert.equal(installed.metadataRestoration, "PASS");
  assert.equal(installed.executable.version, "1.9.24");
  assert.equal(path.resolve(p.executable.path), path.resolve(installed.installRoot, "agentvn-player.exe"));
  assert.equal(path.resolve(p.sessionRoot), out);
  assert.deepEqual(p.cartridges, author.cartridges);
  assert.deepEqual(p.fixture, author.fixture);
  for (const f of [report.author, report.installation, installed.executable, ...installed.resources,
    ...installed.protectedFiles, ...author.cartridges, ...author.tools, ...report.tools])
    assert.equal(sha(f.path), f.sha256, f.path);
}
function profile(action) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/native-dev-preview-profile.ps1",
    "-Action", action, "-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"];
  const result = spawnSync("powershell.exe", args, {
    cwd: path.resolve(__dirname, ".."), windowsHide: true, encoding: "utf8", timeout: 45000,
  });
  const log = path.join(out, `profile-${action}.log`);
  fs.writeFileSync(log, result.stdout + result.stderr, { flag: "wx" });
  report.commands.push({ command: ["powershell.exe", ...args], exitCode: result.status, log }); save();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
async function hit(locator) {
  await locator.waitFor({ state: "visible" });
  const actual = await locator.evaluate(e => {
    const r = e.getBoundingClientRect();
    return { rect: r.toJSON(), width: innerWidth, height: innerHeight, enabled: !e.disabled,
      hit: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  const r = actual.rect;
  assert(r.width > 0 && r.height > 0 && r.x >= -1 && r.y >= -1 &&
    r.right <= actual.width + 1 && r.bottom <= actual.height + 1 && actual.hit && actual.enabled && actual.overflow <= 1);
  await locator.click(); return actual;
}
async function done(scene, index) {
  await player.page.waitForFunction(({ scene, index }) => {
    const state = document.querySelector('[data-testid="game-state-playing"]');
    return state?.dataset.currentSceneId === scene && +state.dataset.currentCommandIndex === index &&
      document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true";
  }, { scene, index });
}
(async () => {
  save();
  const followup = read(path.join(base, `narrative-followup-${attempt}/report.json`));
  assert.equal(followup.status, "PASS"); assert(followup.finishedAt);
  report.followup = desc(path.join(base, `narrative-followup-${attempt}/report.json`));
  report.author = desc(path.join(base, `author-export-${attempt}/report.json`)); author = read(report.author.path);
  report.installation = desc(path.join(base, "installation.json")); installed = read(report.installation.path);
  prep = { sessionRoot: out, executable: installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),
    cartridges: author.cartridges, fixture: author.fixture, webview: path.join(out, "webview"),
    temporary: path.join(out, "temporary") };
  validate(prep); report.prep = prep;
  report.environment = { AGENTVN_TEST_PROJECT: author.fixture.input, AGENTVN_WORKSPACE_OUTPUT: out }; save();
  for (const cart of prep.cartridges) {
    const actual = await validateCartridge(cart.path, prep.fixture, cart.layout);
    assert.equal(actual.scriptSha256, cart.scriptSha256); assert.equal(actual.layoutSha256, cart.layoutSha256);
    report.cartridges.push(actual);
  }
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  fs.mkdirSync(prep.temporary); prepared = true; profile("Prepare");
  player = new NarrativePlayer(prep, report, save, validate);
  const matrix = [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
    [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
  for (const layout of ["agentvn", "renpy"]) {
    await player.start({ layout, installId: `qa_fresh_1924_${attempt}_${layout}`, cell: layout, viewport: matrix[0] });
    const page = player.page;
    for (const viewport of matrix) {
      const row = { layout, ...viewport, status: "RUNNING" }; report.cells.push(row); save();
      await player.metrics(viewport); await settleRuntime(page);
      if (layout === "renpy") {
        await page.getByTestId("renpy-title-view").waitFor();
        assert.equal(await page.locator(".renpy-title-heading h1,.renpy-title-heading p").count(), 0);
        assert.equal(await page.getByTestId("main-menu-actions").count(), 1);
        row.titleHidden = true;
      } else {
        assert.equal(await page.locator(".menu-hero h1").innerText(), author.fixture.title);
        assert.equal(await page.getByTestId("renpy-title-view").count(), 0);
        row.agentvnTitle = author.fixture.title;
      }
      row.openSettingsHit = await hit(page.getByTestId("open-settings")); await player.ready("settings");
      row.backHit = await hit(page.getByTestId("settings-finish")); await player.ready("title_menu");
      row.screenshot = await player.shot(`${viewport.width}-${viewport.dpr}-${viewport.reduced}`);
      row.status = "PASS"; save();
      console.log(`PASS fresh ${layout} ${viewport.width} DPR${viewport.dpr} reduced=${viewport.reduced}`);
    }
    await player.metrics(matrix[0]);
    await hit(page.getByTestId("open-settings")); await player.ready("settings");
    await hit(page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }));
    await page.getByRole("checkbox", { name: "自动存档", exact: true }).uncheck();
    await hit(page.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true }));
    await page.getByRole("slider", { name: "Text speed", exact: true }).focus(); await page.keyboard.press("Home");
    await hit(page.getByTestId("settings-finish")); await player.ready("title_menu");
    const story = { layout, status: "RUNNING" }; report.stories.push(story); save();
    story.startHit = await hit(page.getByTestId("start-new-game")); await player.ready("playing");
    await done("narrative_entry", 0); await hit(page.locator(".dialog-box"));
    story.branchHit = await hit(page.getByRole("button", { name: "选择：voice_dialog", exact: true }));
    await done("voice_dialog", 0);
    await until(async () => {
      const voice = await page.evaluate(() => window.__QA_VOICE__);
      return voice.calls.length === 1 && voice.calls[0].settlement === "resolved" &&
        voice.events.some(e => e.event === "playing") && voice.events.some(e => e.event === "timeupdate" && e.time > 0);
    }, "fresh exported voice really decodes and plays");
    const first = await page.locator(".dialog-box").evaluate(n => ({
      page: +n.dataset.dialogPage, pages: +n.dataset.dialogPages, text: n.querySelector(".dialog-text")?.textContent,
    }));
    assert.equal(first.page, 1); assert(first.pages > 1);
    assert(author.fixture.longTexts.voice_dialog.startsWith(first.text));
    await hit(page.locator(".dialog-box")); await done("voice_dialog", 0);
    const second = await page.locator(".dialog-box").evaluate(n => ({
      page: +n.dataset.dialogPage, text: n.querySelector(".dialog-text")?.textContent,
    }));
    assert.equal(second.page, 2);
    assert(author.fixture.longTexts.voice_dialog.startsWith(first.text + second.text));
    story.first = first; story.second = second;
    await page.keyboard.press("Escape"); await player.ready("main_menu");
    await hit(page.getByTestId("continue-game")); await player.ready("playing"); await done("voice_dialog", 0);
    assert.equal(await page.locator(".dialog-box").getAttribute("data-dialog-page"), "2");
    story.voice = await page.evaluate(() => window.__QA_VOICE__);
    assert.equal(story.voice.calls.length, 1); assert(!story.voice.events.some(e => e.event === "error"));
    story.status = "PASS"; save(); await player.stop();
  }
  assert.equal(report.cells.length, 24); assert(report.cells.every(c => c.status === "PASS"));
  assert.equal(report.stories.length, 2); assert(report.stories.every(s => s.status === "PASS"));
  assert.deepEqual(report.pageErrors, []); assert(!report.observerError); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (player?.page) await player.shot("failure").catch(() => {});
}).finally(async () => {
  try { await player?.stop(); }
  catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  try {
    assert(!rows().some(p => p.Name === "agentvn-player.exe" ||
      p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
    if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profile("Restore"); report.restoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.restoration.path).status, "PASS");
    }
    if (prep) validate(prep);
    assert.deepEqual(listeners(report.launches.map(l => l.port)), []);
  } catch (error) {
    report.status = "FAILED"; report.cleanupError = [report.cleanupError, String(error.stack || error)].filter(Boolean).join("\n");
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
