"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process"), { createHash } = require("node:crypto");
const { NarrativePlayer } = require("./lib/dev-narrative-player.cjs");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Native-Runtime-State-20261020-01", attempt = process.argv[2] || "03";
assert.match(attempt, /^\d{2}$/);
const installationFile = "F:/AgentVN/QA/Editor-1.9.25-20261025-01/installation.json";
const base = path.join(qa, `quickload-exit-20261025-${attempt}`);
assert(!fs.existsSync(base)); fs.mkdirSync(base, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedUtc: fs.statSync(f).mtime.toISOString() });
const installation = read(installationFile), exported = read("F:/AgentVN/QA/Android-Package-20261021-01/editor-19/report.json");
assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, "1.9.25");
const player = installation.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
assert(player && fs.existsSync(player.path)); assert.equal(sha(player.path), player.sha256);
const cartridge = { ...exported.cartridge, layout: "renpy" };
assert.equal(sha(cartridge.path), cartridge.sha256);
const prep = { scope: "CURRENT_INSTALLED_RELEASE_QUICKLOAD_EXIT_NOT_ANDROID",
  sessionRoot: base, executable: player, webview: path.join(base, "webview"),
  temporary: path.join(base, "temporary"), cartridges: [cartridge] };
const report = { status: "RUNNING", startedAt: new Date().toISOString(), scope: prep.scope,
  candidateVersion: "1.9.25", modelRequests: 0, productChanges: 0, cells: [], launches: [],
  screenshots: [], knownProcesses: [], pageErrors: [], commands: [], prep: {
    ...prep, executable: desc(player.path), cartridge: desc(cartridge.path), installation: desc(installationFile),
  } };
const save = () => fs.writeFileSync(path.join(base, "report.json"), JSON.stringify(report, null, 2));
const tools = [__filename, path.join(root, "scripts/lib/dev-narrative-player.cjs"),
  path.join(root, "scripts/native-dev-preview-profile.ps1")]
  .map(f => ({ path: path.resolve(f), sha256: sha(path.resolve(f)) }));
function validatePreparation(value) {
  assert.equal(value.scope, prep.scope); assert.equal(sha(value.executable.path), value.executable.sha256);
  assert.equal(sha(value.cartridges[0].path), value.cartridges[0].sha256);
  assert.equal(path.resolve(value.executable.path), path.resolve(player.path));
}
async function profile(action) {
  const log = path.join(base, `profile-${action.toLowerCase()}.log`), fd = fs.openSync(log, "wx");
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", base,
    "-CodexCacheView", "-Storage", "NativeRoaming"], { windowsHide: true, stdio: ["ignore", fd, fd] });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  fs.closeSync(fd); assert.equal(code, 0, log);
}
async function position(runtime) {
  await runtime.page.waitForFunction(() => document.querySelector(".dialog-box")?.dataset.dialogPageDone === "true");
  return runtime.page.locator(".story-player").evaluate(e => ({
    scene: e.dataset.currentSceneId, command: Number(e.dataset.currentCommandIndex),
    type: e.dataset.currentCommandType, text: document.querySelector(".dialog-text")?.textContent,
  }));
}
function disk(runtime, label) {
  const dir = runtime.storage.targetDirectory;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => ({
    ...desc(path.join(dir, f)), data: read(path.join(dir, f)),
  })) : [];
  fs.writeFileSync(path.join(base, `${label}.json`), JSON.stringify(files, null, 2), { flag: "wx" });
  return files;
}
async function realExit(runtime, cell, label) {
  await runtime.page.getByTestId("renpy-quick-settings").click(); await runtime.ready("settings");
  await runtime.page.getByTestId("open-exit-confirmation").click();
  await runtime.page.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor();
  await runtime.shot(label);
  const child = runtime.child, started = Date.now();
  try { await runtime.page.getByTestId("confirm-exit-game").click(); }
  catch (error) { if (child.exitCode === null || !/closed/i.test(String(error))) throw error; }
  await until(() => child.exitCode !== null || child.signalCode !== null, "installed Player exit", 15000);
  assert.equal(child.exitCode, 0); assert.equal(child.signalCode, null);
  cell.exits.push({ pid: child.pid, elapsedMs: Date.now() - started });
  await runtime.stop(); assert.equal(report.launches.at(-1).cleanup.method, "PROCESS_ALREADY_EXITED_BEFORE_CLEANUP");
}
let runtime, prepared = false;
(async () => {
  save(); validatePreparation(prep); await profile("Prepare"); prepared = true;
  for (const branch of [false, true]) {
    const cell = { name: branch ? "quickload-branch-loop-exit" : "quickload-direct-exit", status: "RUNNING", exits: [] };
    report.cells.push(cell); save();
    const args = { layout: "renpy", installId: `qa_installed_1925_${attempt}_${Number(branch)}`,
      cell: cell.name, viewport: { width: 1920, height: 1080, dpr: 1, reduced: false } };
    runtime = new NarrativePlayer(prep, report, save, validatePreparation);
    await runtime.start(args);
    await runtime.page.getByTestId("open-settings").click(); await runtime.ready("settings");
    await runtime.page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
    await runtime.page.getByRole("checkbox", { name: "自动存档", exact: true }).setChecked(true);
    await runtime.page.getByTestId("settings-finish").click(); await runtime.ready("title_menu");
    await runtime.page.getByTestId("start-new-game").click(); await runtime.ready("playing");
    cell.first = await position(runtime); assert.equal(cell.first.command, 0);
    await runtime.page.getByTestId("renpy-quick-save").click();
    await until(async () => (await runtime.saves()).some(s => s.save_kind === "quick"), "installed quick save");
    await runtime.page.locator(".dialog-box").click(); await runtime.page.locator(".choice-panel button").first().waitFor();
    await runtime.page.getByTestId("renpy-quick-load").click(); await runtime.page.getByTestId("confirm-quick-load").click();
    await runtime.ready("playing"); assert.deepEqual(await position(runtime), cell.first);
    if (branch) {
      await runtime.page.locator(".dialog-box").click(); await runtime.page.locator(".choice-panel button").first().click();
      await runtime.page.waitForFunction(() => document.querySelector(".story-player")?.dataset.currentCommandIndex === "0");
      assert.deepEqual(await position(runtime), cell.first);
    }
    await runtime.page.getByTestId("renpy-quick-history").click(); await runtime.ready("history");
    cell.expectedHistory = await runtime.page.locator(".history-list article p").allTextContents();
    await runtime.page.getByTestId("renpy-menu-return").click(); await runtime.ready("playing");
    cell.before = await position(runtime); await realExit(runtime, cell, `${cell.name}-exit`);
    cell.afterExit = disk(runtime, `${cell.name}-after-exit`);
    assert(cell.afterExit.some(f => f.data.save_kind === "auto" && f.data.command_index === cell.before.command
      && JSON.stringify(f.data.history.map(h => h.text)) === JSON.stringify(cell.expectedHistory)));
    runtime = new NarrativePlayer(prep, report, save, validatePreparation);
    await runtime.start({ ...args, restart: true }); await runtime.page.getByTestId("continue-game").click(); await runtime.ready("playing");
    assert.deepEqual(await position(runtime), cell.before);
    await runtime.page.getByTestId("renpy-quick-history").click(); await runtime.ready("history");
    assert.deepEqual(await runtime.page.locator(".history-list article p").allTextContents(), cell.expectedHistory);
    await runtime.page.getByTestId("renpy-menu-return").click(); await runtime.ready("playing");
    await realExit(runtime, cell, `${cell.name}-restart-exit`);
    cell.afterRestartExit = disk(runtime, `${cell.name}-after-restart-exit`);
    assert(cell.afterRestartExit.some(f => f.data.save_kind === "auto" && f.data.command_index === cell.before.command
      && JSON.stringify(f.data.history.map(h => h.text)) === JSON.stringify(cell.expectedHistory)));
    cell.status = "PASS"; save();
  }
  report.status = "PASS"; assert(report.cells.every(c => c.status === "PASS" && c.exits.length === 2));
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(async () => {
  try { await runtime?.stop(); if (prepared) { await profile("Restore"); report.profileRestore = "PASS"; }
    assert(!rows().some(p => report.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
    assert.equal(listeners(report.launches.map(l => l.port)).length, 0);
    for (const tool of tools) assert.equal(sha(tool.path), tool.sha256);
    report.cleanup = "PASS";
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out: base, error: report.error, cleanupError: report.cleanupError }));
});
