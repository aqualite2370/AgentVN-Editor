"use strict";
// A bounded observation of the failed NVL interior-page comparison.
// This is not a replacement full matrix, and never changes the old report.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { NarrativePlayer } = require("./lib/dev-narrative-player.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateDevNarrativePreparation } = require("./lib/dev-narrative-preparation.cjs");
const { assertRestoredNarrativeState } = require("./lib/narrative-restoration-state.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
const root = path.resolve(__dirname, "..");

async function observe(page) {
  return page.evaluate(async () => {
    const rect = node => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const style = node => {
      if (!node) return null;
      const s = getComputedStyle(node);
      return Object.fromEntries(["fontFamily", "fontSize", "fontWeight", "lineHeight", "paddingBottom",
        "height", "maxHeight", "transform", "transitionProperty", "transitionDuration"].map(k => [k, s[k]]));
    };
    function sample() {
      const panel = document.querySelector(".dialog-box");
      const text = panel?.querySelector('[data-nvl-current="true"] .nvl-page-text')
        || panel?.querySelector(".dialog-text");
      const region = panel?.querySelector(".nvl-page") || text;
      const state = document.querySelector('[data-testid="game-state-playing"]');
      const range = document.createRange();
      if (text) range.selectNodeContents(text);
      return { at: performance.now(), fontStatus: document.fonts.status,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
        scene: state?.getAttribute("data-current-scene-id"),
        command: state?.getAttribute("data-current-command-index"),
        mode: panel?.getAttribute("data-dialogue-layout-mode"), textStyle: style(text),
        page: panel?.getAttribute("data-dialog-page"), pages: panel?.getAttribute("data-dialog-pages"),
        done: panel?.getAttribute("data-dialog-page-done"), text: text?.textContent,
        panel: rect(panel), region: rect(region), panelStyle: style(panel), regionStyle: style(region),
        advance: rect(panel?.querySelector(".nvl-advance-surface")),
        advanceStyle: style(panel?.querySelector(".nvl-advance-surface")),
        runtimeScale: panel && getComputedStyle(panel).getPropertyValue("--runtime-ui-scale"),
        preferenceSpacing: panel && getComputedStyle(panel).getPropertyValue("--runtime-preference-line-spacing"),
        lines: [...(region?.querySelectorAll("[data-nvl-line]") ?? [])].map(n => ({
          text: n.textContent, rect: rect(n), style: style(n),
          textStyle: style(n.querySelector(".nvl-page-text")),
        })),
        glyphs: text ? [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
          .map(r => ({ x: r.x, y: r.y, right: r.right, bottom: r.bottom })) : [],
        overflow: document.documentElement.scrollWidth - innerWidth,
        animations: panel?.getAnimations({ subtree: true }).map(a => ({
          name: a.animationName || a.transitionProperty || "", state: a.playState,
          at: a.currentTime, timing: a.effect?.getComputedTiming(),
        })) ?? [] };
    }
    const frames = [sample()];
    // Observation window only. Keep the very first sample and every failing
    // frame; these samples do not delay or replace any acceptance assertion.
    for (let i = 0; i < 90; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      frames.push(sample());
    }
    return frames;
  });
}

async function child(preparationFile) {
  const prep = read(preparationFile); validateDevNarrativePreparation(prep);
  assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), prep.sessionRoot);
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(prep.fixture.input));
  const report = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: prep.originalSaves ? "ORIGINAL_THREE_NATIVE_SAVES_SCOPED_RESTORATION_NOT_FULL_MATRIX"
      : "FOCUSED_NATIVE_DEV_NVL_RESTORATION_OBSERVATION_NOT_ACCEPTANCE",
    launches: [], knownProcesses: [], screenshots: [], pageErrors: [], traces: [], modelRequests: 0 };
  const save = () => fs.writeFileSync(path.join(prep.sessionRoot, "observation.json"), JSON.stringify(report, null, 2));
  const player = new NarrativePlayer(prep, report, save);
  const args = { layout: "renpy", cell: "2560x1440-dpr1-normal-renpy",
    viewport: { width: 2560, height: 1440, dpr: 1, reduced: false },
    installId: prep.originalSaves?.installId ?? `qa_dev_nvl_restore_${path.basename(prep.sessionRoot).slice(-2)}` };
  async function record(name, expected) {
    const frames = await observe(player.page);
    report.traces.push({ name, frames }); save();
    assert.equal(frames.length, 91);
    for (const f of expected ? frames : [frames[0], frames.at(-1)]) {
      assert.equal(f.scene, expected?.scene ?? "voice_nvl"); assert.equal(f.command, "0"); assert.equal(f.page, "2");
      assert(f.text && f.glyphs.length && f.region);
      assert.equal(f.viewport.width, 2560); assert.equal(f.viewport.height, 1440);
      assert(Math.abs(f.viewport.dpr - 1) <= 1e-6 && !f.viewport.reduced);
      if (expected) assertRestoredNarrativeState({
        scene: f.scene, command: Number(f.command), mode: f.mode, page: Number(f.page), pages: Number(f.pages),
        text: f.text, font: parseFloat(f.textStyle.fontSize), rect: f.panel, region: f.region,
        glyphs: f.glyphs, overflow: f.overflow,
        nvl: f.lines.map(n => ({ text: n.text, font: parseFloat(n.textStyle.fontSize), rect: n.rect })),
      }, expected, args.viewport);
    }
    return frames;
  }
  async function done() {
    // Match the original failed runner's sampling order. This is its typing
    // completion marker, deliberately not a new geometric-stability wait.
    await player.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await player.page.waitForFunction(() => document.querySelector(".dialog-box")
      ?.getAttribute("data-dialog-page-done") === "true");
  }
  async function load(fromTitle = false, slot = 2) {
    if (!fromTitle) { await player.page.keyboard.press("Escape"); await player.ready("main_menu"); }
    await player.page.getByTestId("open-save-load").click(); await player.ready("save_load");
    await player.page.getByRole("tab", { name: "手动", exact: true }).click();
    await player.page.getByRole("button", { name: "读取", exact: true }).click();
    await player.page.getByTestId(`save-slot-manual-${slot}`).locator(".save-card-main").click();
    await player.ready("playing"); await done();
  }
  try {
    save(); await player.start(args);
    await player.page.getByTestId("start-new-game").click(); await player.ready("playing");
    await player.page.keyboard.press("Escape"); await player.ready("main_menu");
    await player.page.getByTestId("open-settings").click(); await player.ready("settings");
    await player.page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
    await player.page.locator('[data-settings-tab-current="system"]').waitFor();
    await player.page.getByRole("checkbox", { name: "自动存档", exact: true }).uncheck();
    await player.page.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true }).click();
    await player.page.locator('[data-settings-tab-current="text"]').waitFor();
    await player.page.getByRole("slider", { name: "Text speed", exact: true }).focus();
    await player.page.keyboard.press("Home");
    await player.page.getByTestId("settings-finish").click(); await player.ready("main_menu");
    await player.page.getByTestId("continue-game").click(); await player.ready("playing"); await done();
    if (prep.originalSaves) {
      const raw = read(prep.originalSaves.raw.path);
      assert.equal(sha(prep.originalSaves.raw.path), prep.originalSaves.raw.sha256);
      const original = raw.cells.find(c => c.name === args.cell);
      assert.equal(original.status, "FAILED"); assert.equal(original.saved.length, 3);
      report.replayedSources = [];
      for (const saved of original.saved) {
        const f = raw.nativeSaves.find(n => n.data.save_id === saved.saveId);
        assert(f && sha(f.retained) === f.sha256);
        const data = read(f.retained); assert.equal(data.install_id, args.installId);
        assert.equal(data.slot, saved.slot); assert.equal(data.save_kind, "manual");
        await player.native("write_save", { installId: args.installId, kind: "manual", slot: saved.slot, save: data });
        const target = path.join(player.storage.targetDirectory, path.basename(f.source));
        assert.deepEqual(read(target), data);
        report.replayedSources.push({ source: desc(f.retained), target: desc(target), slot: saved.slot, saveId: saved.saveId });
      }
      report.nativeSaves = await player.saves(); save();
      const oldPid = player.launch.pid; await player.stop(); await player.start({ ...args, restart: true });
      assert.notEqual(player.launch.pid, oldPid); assert.deepEqual(await player.saves(), report.nativeSaves);
      report.silentWindows = [];
      for (const [index, saved] of original.saved.entries()) {
        await load(index === 0, saved.slot); await record(`original-${saved.name}-new-process`, saved.interior);
        const at = Date.now(); await new Promise(resolve => setTimeout(resolve, 2200));
        const q = await player.page.evaluate(() => window.__QA_VOICE__);
        assert.equal(q.calls.length, 0); assert(!q.events.some(e => e.event === "error"));
        report.silentWindows.push({ name: saved.name, ms: Date.now() - at, calls: 0 }); save();
        await player.shot(`original-${saved.name}`);
      }
      assert.deepEqual(report.pageErrors, []);
      report.status = "ORIGINAL_SAVES_RESTORATION_PASS_NOT_FULL_MATRIX"; return;
    }
    await player.page.locator(".dialog-box").click();
    await player.page.getByRole("button", { name: "选择：voice_nvl", exact: true }).click();
    await player.page.waitForFunction(() => {
      const s = document.querySelector('[data-testid="game-state-playing"]');
      return s?.getAttribute("data-current-scene-id") === "voice_nvl"
        && s.getAttribute("data-current-command-index") === "0";
    });
    await done();
    await player.page.waitForFunction(() => {
      const q = window.__QA_VOICE__;
      return q.calls.length === 1 && q.calls[0].settlement === "resolved"
        && q.events.some(e => e.id === 1 && e.event === "playing")
        && q.events.some(e => e.id === 1 && e.event === "timeupdate" && e.time > 0);
    });
    await player.page.locator(".dialog-box").click();
    await player.page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page") === "2");
    await done(); await record("interior-before-save");
    await player.page.getByTestId("renpy-quick-save-load").click(); await player.ready("save_load");
    await player.page.getByRole("tab", { name: "手动", exact: true }).click();
    await player.page.getByTestId("save-slot-manual-2").locator(".save-card-main").click();
    await player.page.waitForFunction(() => document.querySelector(".save-operation-status")?.classList.contains("is-saved"));
    report.nativeSaves = await player.saves(); assert.equal(report.nativeSaves.length, 1); save();
    await player.page.keyboard.press("Escape"); await player.ready("playing"); await done();
    await record("after-save-menu");
    await load(); await record("same-process-load");
    const oldPid = player.launch.pid; await player.stop(); await player.start({ ...args, restart: true });
    assert.notEqual(player.launch.pid, oldPid); assert.deepEqual(await player.saves(), report.nativeSaves);
    await load(true); await record("new-process-load"); await player.shot("restored-observation");
    assert.deepEqual(report.pageErrors, []);
    report.status = "OBSERVATION_COMPLETE_NOT_ACCEPTANCE";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try { await player.stop(); } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, traces: report.traces.map(t => t.name), error: report.error }));
  }
}

async function main() {
  const attempt = process.argv[2]; assert.match(attempt, /^\d{2}$/);
  const source = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/dev-narrative-20261024-03";
  const prior = read(path.join(source, "session.json"));
  assert(prior.finishedAt && !prior.cleanupError, "Original matrix must be terminal and cleaned before diagnosis");
  const audit = read(`${source}-audit-01/report.json`); assert.equal(audit.status, "PASS");
  assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/dev-narrative-20261024-${attempt}`);
  assert(!fs.existsSync(out));
  const prep = { ...read(prior.preparation.path), sessionRoot: out,
    temporary: path.join(out, "temporary"), webview: path.join(out, "webview") };
  const replay = process.argv.includes("--original-saves");
  if (replay) {
    const previous = read(path.resolve(`${source}/../dev-narrative-20261024-04/diagnostic-session.json`));
    assert.equal(previous.status, "OBSERVATION_COMPLETE_NOT_ACCEPTANCE");
    assert(previous.finishedAt && !previous.cleanupError);
    assert.equal(sha(previous.restoration.path), previous.restoration.sha256);
    assert.equal(read(previous.restoration.path).status, "PASS");
    prep.originalSaves = { raw: prior.raw,
      installId: read(prior.raw.path).launches.find(l => l.cell === "2560x1440-dpr1-normal-renpy").installId };
  }
  validateDevNarrativePreparation(prep); fs.mkdirSync(out); fs.mkdirSync(prep.temporary);
  const preparationFile = path.join(out, "preparation.json");
  fs.writeFileSync(preparationFile, JSON.stringify(prep, null, 2), { flag: "wx" });
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), out,
    scope: replay ? "ORIGINAL_SAVES_SCOPED_FOLLOWUP_NOT_FULL_MATRIX_OR_INSTALLED_ACCEPTANCE"
      : "FOCUSED_RESTORATION_DIAGNOSTIC_NOT_MATRIX_OR_INSTALLED_ACCEPTANCE",
    source: desc(path.join(source, "session.json")), priorAudit: desc(`${source}-audit-01/report.json`),
    executable: prep.executable, tools: [__filename, "scripts/narrative-restoration-state-test.cjs",
      "scripts/lib/narrative-restoration-state.cjs", "scripts/lib/dev-narrative-player.cjs",
      "scripts/native-dev-preview-profile.ps1"].map(desc), commands: [], modelRequests: 0 };
  const save = () => fs.writeFileSync(path.join(out, "diagnostic-session.json"), JSON.stringify(report, null, 2));
  let prepared = false;
  async function command(label, exe, args, env = process.env) {
    const c = { label, command: [exe, ...args], startedAt: new Date().toISOString(), log: path.join(out, `${label}.log`) };
    report.commands.push(c); save(); const fd = fs.openSync(c.log, "wx");
    try {
      const p = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
      c.pid = p.pid; save();
      c.exitCode = await new Promise((resolve, reject) => { p.once("close", resolve); p.once("error", reject); });
      assert.equal(c.exitCode, 0, c.log); c.status = "PASS";
    } catch (e) { c.status = "FAILED"; throw e; }
    finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
  }
  const profile = action => command(`profile-${action.toLowerCase()}`, "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/native-dev-preview-profile.ps1",
      "-Action", action, "-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"]);
  try {
    save(); fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
    if (replay) await command("restoration-guard", process.execPath, ["scripts/narrative-restoration-state-test.cjs"]);
    prepared = true; await profile("Prepare");
    await command("observation", process.execPath, [__filename, "--child", preparationFile], { ...process.env,
      TEMP: prep.temporary, TMP: prep.temporary, AGENTVN_TEST_PROJECT: prep.fixture.input, AGENTVN_WORKSPACE_OUTPUT: out });
    const raw = read(path.join(out, "observation.json"));
    assert.equal(raw.status, replay ? "ORIGINAL_SAVES_RESTORATION_PASS_NOT_FULL_MATRIX"
      : "OBSERVATION_COMPLETE_NOT_ACCEPTANCE"); assert(raw.finishedAt && !raw.cleanupError);
    report.status = raw.status;
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      const rawFile = path.join(out, "observation.json");
      if (fs.existsSync(rawFile)) {
        const raw = read(rawFile); assert(raw.finishedAt && !raw.cleanupError);
        assert(raw.launches.every(l => l.cleanup?.status === "PASS"));
        assert(!rows().some(p => raw.knownProcesses.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
        report.absentPorts = raw.launches.map(l => l.port); assert.deepEqual(listeners(report.absentPorts), []);
      }
      if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
        await profile("Restore");
        report.restoration = desc(path.join(out, "profile-restoration.json"));
        assert.equal(read(report.restoration.path).status, "PASS");
      } else {
        assert(!prepared); report.profileNotChanged = true;
      }
      for (const f of [report.executable, ...report.tools]) assert.equal(sha(f.path), f.sha256);
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  }
}
if (require.main === module) (process.argv[2] === "--child" ? child(process.argv[3]) : main())
  .catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { observe };
