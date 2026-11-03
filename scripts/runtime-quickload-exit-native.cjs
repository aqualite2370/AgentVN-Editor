"use strict";
// Real built Windows Player and disk saves; not Release installation or Android.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { NarrativePlayer } = require("./lib/dev-narrative-player.cjs");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, "..");
const base = "F:\\AgentVN\\QA\\Android-Package-20261021-01";
const buildFile = path.join(base, "exit-after-quickload-build-01/report.json");
const exportFile = path.join(base, "editor-19/report.json");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = fileEvidence;
function validateBuild(build) {
  assert.equal(build.status, "PASS"); assert(build.finishedAt);
  assert.deepEqual(build.commands.map(c => c.name), ["editor-typecheck", "editor-build", "gamecli-build", "full-dev"]);
  for (const row of build.commands) { assert.equal(row.status, "PASS"); assert.equal(row.code, 0); }
  assert.equal(build.matrix.length, 4);
  assert(build.matrix.every(row => row.cases === 6));
  assert.equal(path.resolve(build.player.path), path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
  assert.equal(build.bundled.length, 10);
}
function validatePreparation(prep) {
  const build = read(buildFile); validateBuild(build);
  assert.equal(prep.scope, "CURRENT_DEV_QUICKLOAD_EXIT_NATIVE_NOT_INSTALLED_OR_ANDROID");
  assert.equal(path.dirname(prep.sessionRoot), "F:\\AgentVN\\QA\\Native-Runtime-State-20261020-01");
  assert.match(path.basename(prep.sessionRoot), /^quickload-exit-20261025-\d{2}$/);
  assert.equal(prep.webview, path.join(prep.sessionRoot, "webview"));
  assert.equal(prep.temporary, path.join(prep.sessionRoot, "temporary"));
  assert.equal(prep.build.path, buildFile);
  assert.equal(prep.executable.sha256, build.player.sha256);
  assert.equal(prep.cartridges.length, 1); assert.equal(prep.cartridges[0].layout, "renpy");
  const exported = read(exportFile);
  assert.equal(exported.cartridge.sha256, prep.cartridges[0].sha256);
  for (const row of [prep.build, prep.executable, prep.exported, ...prep.cartridges,
    build.dev, ...build.sources, ...build.bundled, ...build.frozen, ...build.matrix])
    assert.equal(desc(row.path).sha256, row.sha256, row.path);
}
async function main() {
  if (process.argv[2] === "--self-test") {
    const good = { status: "PASS", finishedAt: "done", matrix: Array.from({ length: 4 }, () => ({ cases: 6 })),
      commands: ["editor-typecheck", "editor-build", "gamecli-build", "full-dev"]
        .map(name => ({ name, status: "PASS", code: 0 })),
      player: { path: path.join(root, "editor/src-tauri/binaries/agentvn-player.exe") }, bundled: Array(10).fill({}) };
    validateBuild(good);
    const bad = [r => { r.status = "RUNNING"; }, r => { delete r.finishedAt; },
      r => { r.commands.pop(); }, r => { r.commands[0].code = 1; },
      r => { r.matrix[0].cases = 0; }, r => { r.bundled.pop(); }];
    for (const change of bad) { const value = structuredClone(good); change(value); assert.throws(() => validateBuild(value)); }
    console.log(JSON.stringify({ status: "PASS", rejectedInvalidBuilds: bad.length, nativeOperations: 0 }));
    return;
  }
  const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
  const build = read(buildFile), exported = read(exportFile);
  const out = path.join("F:\\AgentVN\\QA\\Native-Runtime-State-20261020-01", "quickload-exit-20261025-" + attempt);
  const prep = { scope: "CURRENT_DEV_QUICKLOAD_EXIT_NATIVE_NOT_INSTALLED_OR_ANDROID", sessionRoot: out,
    defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
    build: desc(buildFile), exported: desc(exportFile), executable: build.player,
    cartridges: [{ ...exported.cartridge, layout: "renpy" }],
    webview: path.join(out, "webview"), temporary: path.join(out, "temporary") };
  validatePreparation(prep);
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
  fs.mkdirSync(out); fs.mkdirSync(prep.temporary);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), scope: prep.scope, prep,
    cells: [], launches: [], screenshots: [], knownProcesses: [], pageErrors: [], commands: [],
    modelRequests: 0, productChanges: 0, limitations: [
      "New Dev-resource native Player, not installed Release or Android",
      "Historical installed Editor UI cartridge imported using public native API",
      "Protected physical Codex roaming and isolated WebView; not default ordinary-user profile acceptance",
      "1920x1080 viewport simulation within native WebView; not full native display matrix",
    ] };
  const tools = [__filename, path.join(root, "scripts/lib/dev-narrative-player.cjs"),
    path.join(root, "scripts/native-dev-preview-profile.ps1")].map(desc);
  r.tools = tools;
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  const player = new NarrativePlayer(prep, r, save, validatePreparation);
  let prepared = false;
  async function profile(action) {
    const row = { action, status: "RUNNING", log: path.join(out, "profile-" + action.toLowerCase() + ".log") };
    r.commands.push(row); save();
    const fd = fs.openSync(row.log, "wx");
    try {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out,
        "-CodexCacheView", "-Storage", "NativeRoaming"], { windowsHide: true, stdio: ["ignore", fd, fd] });
      row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      assert.equal(row.exitCode, 0, row.log); row.status = "PASS";
    } finally { fs.closeSync(fd); save(); }
  }
  async function position() {
    await player.page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
    return player.page.locator(".story-player").evaluate(e => ({
      scene: e.dataset.currentSceneId, command: Number(e.dataset.currentCommandIndex),
      type: e.dataset.currentCommandType, text: document.querySelector(".dialog-text")?.textContent,
    }));
  }
  function disk(label) {
    const directory = player.launch.storage.targetDirectory;
    const result = fs.existsSync(directory) ? fs.readdirSync(directory).filter(f => f.endsWith(".json"))
      .map(f => ({ ...desc(path.join(directory, f)), data: read(path.join(directory, f)) })) : [];
    fs.writeFileSync(path.join(out, label + ".json"), JSON.stringify(result, null, 2), { flag: "wx" });
    return result;
  }
  async function exit(cell, label) {
    await player.page.getByTestId("renpy-quick-settings").click(); await player.ready("settings");
    await player.page.getByTestId("open-exit-confirmation").click();
    await player.page.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor();
    await player.shot(label);
    const child = player.child, started = Date.now();
    try { await player.page.getByTestId("confirm-exit-game").click(); }
    catch (error) { if (child.exitCode === null || !/closed/i.test(String(error))) throw error; }
    await until(() => child.exitCode !== null || child.signalCode !== null, "real confirmed native process exit", 15000);
    assert.equal(child.exitCode, 0); assert.equal(child.signalCode, null);
    cell.exits.push({ pid: child.pid, code: child.exitCode, elapsedMs: Date.now() - started, forcedBeforeExit: false });
    await player.stop();
    assert.equal(r.launches.at(-1).cleanup.method, "PROCESS_ALREADY_EXITED_BEFORE_CLEANUP"); save();
  }
  try {
    save(); prepared = true; await profile("Prepare");
    for (const loop of [false, true]) {
      const cell = { name: loop ? "quickload-branch-loop-exit" : "quickload-direct-exit",
        status: "RUNNING", exits: [] };
      r.cells.push(cell); save();
      const args = { layout: "renpy", installId: `qa_quickload_exit_20261025_${attempt}_${Number(loop)}`,
        cell: cell.name, viewport: { width: 1920, height: 1080, dpr: 1, reduced: false } };
      await player.start(args);
      await player.page.getByTestId("open-settings").click(); await player.ready("settings");
      await player.page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
      await player.page.getByRole("checkbox", { name: "自动存档", exact: true }).setChecked(true);
      await player.page.locator(".settings-tabs").getByRole("button", { name: "文字", exact: true }).click();
      await player.page.getByRole("slider", { name: "Text speed", exact: true }).focus();
      await player.page.keyboard.press("Home");
      await player.page.getByTestId("settings-finish").click(); await player.ready("title_menu");
      await player.page.getByTestId("start-new-game").click(); await player.ready("playing");
      cell.first = await position(); assert.equal(cell.first.command, 0);
      await player.page.getByTestId("renpy-quick-save").click();
      await until(async () => (await player.saves()).some(s => s.save_kind === "quick"), "real quick-save written");
      await player.page.locator(".dialog-box").click();
      await player.page.waitForFunction(() => document.querySelectorAll(".choice-panel button").length === 2);
      cell.beforeQuickload = disk(cell.name + "-before-quickload");
      assert(cell.beforeQuickload.some(f => f.data.save_kind === "auto" && f.data.command_index === 1));
      await player.page.getByTestId("renpy-quick-load").click();
      await player.page.getByTestId("confirm-quick-load").click(); await player.ready("playing");
      assert.deepEqual(await position(), cell.first);
      if (loop) {
        await player.page.locator(".dialog-box").click();
        await player.page.locator(".choice-panel button").first().waitFor();
        await player.page.locator(".choice-panel button").first().click();
        await player.page.waitForFunction(() => document.querySelector(".story-player")?.dataset.currentCommandIndex === "0");
        assert.deepEqual(await position(), cell.first);
      }
      await player.page.getByTestId("renpy-quick-history").click(); await player.ready("history");
      cell.expectedHistory = await player.page.locator(".history-list article p").allTextContents();
      assert.equal(cell.expectedHistory.length, loop ? 2 : 1);
      await player.page.getByTestId("renpy-menu-return").click(); await player.ready("playing");
      cell.before = await position();
      await exit(cell, "first-exit");
      cell.afterExit = disk(cell.name + "-after-exit");
      const matches = cell.afterExit.filter(f => f.data.save_kind === "auto"
        && f.data.scene_id === cell.before.scene && f.data.command_index === cell.before.command
        && JSON.stringify(f.data.history.map(h => h.text)) === JSON.stringify(cell.expectedHistory));
      assert(matches.length, "Current command and complete post-quickload history must be on disk");
      await player.start({ ...args, restart: true });
      await player.page.getByTestId("continue-game").click(); await player.ready("playing");
      cell.restored = await position(); assert.deepEqual(cell.restored, cell.before);
      await player.page.getByTestId("renpy-quick-history").click(); await player.ready("history");
      assert.deepEqual(await player.page.locator(".history-list article p").allTextContents(), cell.expectedHistory);
      await player.page.getByTestId("renpy-menu-return").click(); await player.ready("playing");
      await exit(cell, "restart-exit");
      cell.afterRestartExit = disk(cell.name + "-after-restart-exit");
      assert(cell.afterRestartExit.some(f => f.data.save_kind === "auto" && f.data.command_index === cell.before.command
        && JSON.stringify(f.data.history.map(h => h.text)) === JSON.stringify(cell.expectedHistory)));
      cell.status = "PASS"; save(); console.log("PASS " + cell.name);
    }
    assert.equal(r.cells.length, 2); assert(r.cells.every(c => c.status === "PASS" && c.exits.length === 2));
    assert.deepEqual(r.pageErrors, []); r.status = "PASS";
  } catch (error) {
    r.status = "FAILED"; r.error = String(error.stack || error); process.exitCode = 1;
    if (r.cells.at(-1)?.status === "RUNNING") r.cells.at(-1).status = "FAILED";
  } finally {
    try {
      await player.stop();
      assert(!rows().some(p => r.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
      assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
      if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
        await profile("Restore"); assert.equal(read(path.join(out, "profile-restoration.json")).status, "PASS");
      }
      validatePreparation(prep);
      for (const row of tools) assert.equal(desc(row.path).sha256, row.sha256);
      r.cleanup = "PASS";
    } catch (error) { r.status = "FAILED"; r.cleanupError = String(error.stack || error); process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, error: r.error, cleanupError: r.cleanupError }));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { validateBuild, validatePreparation };
