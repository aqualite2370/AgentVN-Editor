"use strict";
// Current built Player, real library saves and confirmed native exit. No IO mocks.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { NarrativePlayer } = require("./lib/dev-narrative-player.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const buildAttempt = process.argv.slice(3).find(arg => /^\d{2}$/.test(arg)) || "01";
const buildFile = `F:/AgentVN/QA/Android-Exit-20261024-01/build-${buildAttempt}/report.json`;
const exportFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-49/report.json";
function validatePreparation(p) {
  assert.equal(p.scope, "CURRENT_DEV_NATIVE_EXIT_NOT_INSTALLED_OR_ANDROID");
  assert.equal(p.defaultStorage, "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION");
  assert.equal(path.dirname(p.sessionRoot), "F:\\AgentVN\\QA\\Native-Runtime-State-20261020-01");
  assert.match(path.basename(p.sessionRoot), /^android-exit-20261024-\d{2}$/);
  assert.equal(path.resolve(p.build.path), path.resolve(buildFile));
  const build = read(p.build.path);
  assert.equal(build.status, "PASS"); assert(build.finishedAt);
  assert.equal(build.commands.length, 4); assert(build.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  assert.equal(p.executable.sha256, build.player.sha256);
  for (const f of [p.build, p.executable, p.exported, ...build.sources, ...build.frozen,
    ...build.bundled, build.dev, ...p.cartridges]) assert.equal(sha(f.path), f.sha256);
  assert.equal(sha(p.fixture.input), p.fixture.inputSha256);
  assert.equal(p.webview, path.join(p.sessionRoot, "webview"));
  assert.equal(p.temporary, path.join(p.sessionRoot, "temporary"));
  return true;
}
async function main() {
  const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
  const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/android-exit-20261024-${attempt}`);
  assert(!fs.existsSync(out));
  const build = read(buildFile), exported = read(exportFile);
  assert.equal(exported.status, "PASS"); assert(exported.finishedAt && !exported.cleanupError);
  const prep = { scope: "CURRENT_DEV_NATIVE_EXIT_NOT_INSTALLED_OR_ANDROID",
    defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION", sessionRoot: out,
    build: desc(buildFile), exported: desc(exportFile), executable: build.player,
    fixture: exported.fixture, cartridges: exported.cartridges,
    webview: path.join(out, "webview"), temporary: path.join(out, "temporary") };
  validatePreparation(prep);
  if (process.argv.includes("--validate-only")) { console.log("PASS current exit build/preparation; no native mutation"); return; }
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
  fs.mkdirSync(out); fs.mkdirSync(prep.temporary);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), scope: prep.scope,
    prep, cells: [], launches: [], screenshots: [], knownProcesses: [], pageErrors: [], commands: [],
    modelRequests: 0, productChanges: 0, limitations: ["Explicit protected Codex Roaming profile, not normal-user default installation",
      "Historical real Editor UI exports imported through public native API, not a fresh export or picker",
      "1080p native exit regression, not full Release display matrix or Android", "No physical Alt+F4 claim"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  const tools = [__filename, path.resolve("scripts/lib/dev-narrative-player.cjs"),
    path.resolve("scripts/native-dev-preview-profile.ps1")].map(desc);
  r.tools = tools;
  const player = new NarrativePlayer(prep, r, save, validatePreparation);
  let prepared = false;
  async function profile(action) {
    const log = path.join(out, "profile-" + action.toLowerCase() + ".log"), fd = fs.openSync(log, "wx");
    const c = { action, log, status: "RUNNING" }; r.commands.push(c); save();
    try {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        "D:/AgentVN/scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out,
        "-CodexCacheView", "-Storage", "NativeRoaming"], { windowsHide: true, stdio: ["ignore", fd, fd] });
      c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      assert.equal(c.exitCode, 0, log); c.status = "PASS";
    } finally { fs.closeSync(fd); save(); }
  }
  async function settings(auto) {
    const screen = await player.page.locator("[data-runtime-screen-transition]").getAttribute("data-runtime-presented-screen");
    if (screen === "playing") { await player.page.keyboard.press("Escape"); await player.ready("main_menu"); }
    await player.page.getByTestId("open-settings").click(); await player.ready("settings");
    if (auto !== undefined) {
      await player.page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
      await player.page.getByRole("checkbox", { name: "自动存档", exact: true }).setChecked(auto);
    }
  }
  async function confirmExit(cell, name) {
    await settings();
    await player.page.getByTestId("open-exit-confirmation").click();
    await player.page.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor();
    await player.shot(name);
    const child = player.child, started = Date.now();
    try { await player.page.getByTestId("confirm-exit-game").click(); }
    catch (e) { if (child.exitCode === null || !/closed/i.test(String(e))) throw e; }
    await until(() => child.exitCode !== null || child.signalCode !== null, "real confirmed native process exit", 15000);
    assert.equal(child.exitCode, 0); assert.equal(child.signalCode, null);
    cell.exits.push({ pid: child.pid, code: child.exitCode, elapsedMs: Date.now() - started,
      forcedBeforeExit: false, confirmationClicks: 1 });
    await player.stop();
    assert.equal(r.launches.at(-1).cleanup.method, "PROCESS_ALREADY_EXITED_BEFORE_CLEANUP"); save();
  }
  async function position() {
    await player.page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
    return player.page.locator('[data-testid="game-state-playing"]').evaluate(e => ({
      scene: e.dataset.currentSceneId, command: Number(e.dataset.currentCommandIndex),
      text: document.querySelector(".dialog-text")?.textContent }));
  }
  try {
    save(); prepared = true; await profile("Prepare");
    for (const layout of ["agentvn", "renpy"]) for (const mode of ["title_auto_off", "playing_auto_off", "playing_auto_on"]) {
      const cell = { name: `${layout}-${mode}`, layout, mode, status: "RUNNING", exits: [] }; r.cells.push(cell); save();
      const installId = `qa_exit_repair_20261024_${attempt}_${layout}_${mode}`;
      const args = { layout, installId, cell: cell.name, viewport: { width: 1920, height: 1080, dpr: 1, reduced: false } };
      await player.start(args); await settings(mode === "playing_auto_on");
      await player.page.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true }).click();
      await player.page.getByRole("slider", { name: "Text speed", exact: true }).focus();
      await player.page.keyboard.press("Home");
      await player.page.getByTestId("settings-finish").click(); await player.ready("title_menu");
      if (mode !== "title_auto_off") {
        await player.page.getByTestId("start-new-game").click(); await player.ready("playing");
        cell.before = await position();
      } else assert.equal(await player.page.locator(".story-player").count(), 0);
      await confirmExit(cell, "confirm-first");
      const dir = r.launches.at(-1).storage.targetDirectory;
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".json")) : [];
      cell.disk = files.map(f => ({ ...desc(path.join(dir, f)), data: read(path.join(dir, f)) }));
      if (mode === "playing_auto_on") assert(cell.disk.some(f => f.data.save_kind === "auto"
        && f.data.scene_id === cell.before.scene && f.data.command_index === cell.before.command));
      else assert.equal(cell.disk.length, 0, "disabled auto-save must not create a snapshot");
      await player.start({ ...args, restart: true });
      if (mode === "playing_auto_on") {
        await player.page.getByTestId("continue-game").click(); await player.ready("playing");
        cell.restored = await position(); assert.deepEqual(cell.restored, cell.before);
      } else {
        assert.equal((await player.saves()).length, 0);
        assert.equal(await player.page.getByTestId("continue-game").count(), 0);
      }
      await confirmExit(cell, "confirm-restart");
      cell.status = "PASS"; save();
    }
    assert.equal(r.cells.length, 6); assert(r.cells.every(c => c.status === "PASS" && c.exits.length === 2));
    assert.deepEqual(r.pageErrors, []); r.status = "PASS";
  } catch (e) {
    r.status = "FAILED"; r.error = String(e.stack || e);
    if (r.cells.at(-1)?.status === "RUNNING") {
      r.cells.at(-1).status = "FAILED"; r.cells.at(-1).error = r.error;
    }
    process.exitCode = 1;
  }
  finally {
    try {
      await player.stop();
      assert(!rows().some(p => r.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
      assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
      if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
        await profile("Restore"); assert.equal(read(path.join(out, "profile-restoration.json")).status, "PASS");
      }
      validatePreparation(prep); for (const f of tools) assert.equal(sha(f.path), f.sha256);
      r.cleanup = "PASS";
    } catch (e) { r.status = "FAILED"; r.cleanupError = String(e.stack || e); process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, error: r.error, cleanupError: r.cleanupError }));
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { validatePreparation };
