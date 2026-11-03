"use strict";
// Hold only delivery of a real native write result. Never synthesize a save
// response, modify its arguments, or claim this simulates physical disk latency.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { build: runtimeBuild } = require("./current-runtime-quick-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const native = require("./lib/windows-repository-native.cjs");
const attempt = process.env.AGENTVN_PENDING_EXIT_ATTEMPT || "01";
assert(["01", "02"].includes(attempt));
const qa = "F:/AgentVN/QA/Exit-1.9.35-20261102-01/pending-" + attempt;
const out = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/exit-pending-installed-1935-" + attempt;
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const exportedFile = "F:/AgentVN/QA/Installed-Layout-20261101-01/editor-05/report.json";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function validatePreparation(prep, output) {
  const installed = descriptor(), exported = read(exportedFile);
  assert.equal(path.resolve(output), path.resolve(out));
  assert.equal(prep.sessionRoot, path.resolve(out));
  assert.equal(prep.status, "PASS"); assert.equal(prep.defaultStorage, "PHYSICAL_DEFAULT_PATH");
  assert.equal(prep.installId, "qa_pending_exit_1935_" + attempt);
  assert.deepEqual(prep.executable, installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"));
  assert.deepEqual(prep.cartridges, exported.cartridges); assert.deepEqual(prep.fixture, exported.fixture);
  assert.equal(sha(prep.fixture.input), prep.fixture.inputSha256);
  for (const f of prep.cartridges) assert.equal(sha(f.path), f.sha256);
}
function runtimeSource() {
  const file = path.join(__dirname, "lib/installed-runtime-session.cjs");
  const result = runtimeBuild("runtime", fs.readFileSync(file, "utf8"));
  const before = `require(${JSON.stringify(path.join(__dirname, "current-runtime-quick-closure.cjs"))}).validatePreparation(prep, out);`;
  assert.equal(result.source.split(before).length - 1, 1);
  return { file, source: result.source.replace(before,
    `require(${JSON.stringify(__filename)}).validatePreparation(prep, out);`) };
}
function sessionClass(source) {
  const worker = new Module(source.file, module);
  Object.assign(worker, { filename: source.file, paths: Module._nodeModulePaths(path.dirname(source.file)) });
  worker._compile(source.source, source.file);
  return worker.exports.InstalledRuntimeSession;
}
function profile(action) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-Action", action,
    "-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"];
  const result = spawnSync("powershell.exe", args, { windowsHide: true, encoding: "utf8", timeout: 30000 });
  fs.writeFileSync(qa + "/profile-" + action + ".log", result.stdout + result.stderr, { flag: "wx" });
  assert.equal(result.status, 0, result.stderr);
  return { command: ["powershell.exe", ...args], exitCode: result.status };
}
async function installResultGate(page) {
  await page.evaluate(() => {
    const api = window.__TAURI_INTERNALS__, original = window.fetch;
    const target = api.convertFileSrc("write_save", "ipc");
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const state = { calls: 0, received: false, delivered: false, released: false,
      method: "UNCHANGED_NATIVE_FETCH_RESPONSE_DELIVERY", target };
    window.__qaWriteAcknowledgment = { state, release: () => {
      state.released = true; state.releasedAt = Date.now(); release();
    }, restore: () => { window.fetch = original; } };
    const gated = async function(input, init) {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== target) return original.call(window, input, init);
      state.calls++; state.startedAt = Date.now();
      const actual = await original.call(window, input, init);
      state.received = true; state.receivedAt = Date.now();
      await gate; state.delivered = true; state.deliveredAt = Date.now();
      return actual;
    };
    window.fetch = gated;
    if (window.fetch !== gated) throw new Error("Native fetch acknowledgment gate was not installed");
  });
}
async function run() {
  assert(!fs.existsSync(qa)); assert(!fs.existsSync(out));
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  const installed = descriptor(), exported = read(exportedFile), source = runtimeSource();
  fs.mkdirSync(qa); fs.mkdirSync(out); fs.mkdirSync(out + "/temporary");
  fs.copyFileSync(__filename, qa + "/executed-test.cjs", fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(qa + "/runtime-executed.cjs", source.source, { flag: "wx" });
  const report = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "ACTUAL_INSTALLED_PENDING_NATIVE_RESULT_AUTOSAVE_OFF_WM_CLOSE_AND_RESTART",
    controlledBoundary: "Real write_save is called unchanged; only its fulfilled promise delivery is held. Not physical disk latency.",
    productChanges: 0, builds: 0, modelRequests: 0, cases: [], launches: [], screenshots: [],
    pageErrors: [], commands: [], products: [installed.executable, ...installed.resources],
    installation: installed.actualInstallation, tool: desc(qa + "/executed-test.cjs"),
    runtime: desc(qa + "/runtime-executed.cjs"), runtimeOriginal: desc(source.file) };
  const save = () => fs.writeFileSync(qa + "/report.json", JSON.stringify(report, null, 2));
  const Runtime = sessionClass(source);
  let prepared = false, s;
  try {
    save(); prepared = true; report.commands.push(profile("Prepare"));
    const protection = read(out + "/profile-protection.json");
    const prep = { status: "PASS", sessionRoot: path.resolve(out), defaultStorage: "PHYSICAL_DEFAULT_PATH",
      executable: installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),
      fixture: exported.fixture, cartridges: exported.cartridges, installId: "qa_pending_exit_1935_" + attempt,
      profiles: protection.records.filter(p => p.existed), allProfiles: protection.records,
      webview: out + "/webview", temporary: out + "/temporary" };
    validatePreparation(prep, out);
    for (const [layout, kind] of [["agentvn", "manual"], ["renpy", "manual"], ["renpy", "quick"]]) {
      const entry = { layout, kind, status: "RUNNING", installId: prep.installId + "_" + layout + "_" + kind };
      report.cases.push(entry); save();
      s = new Runtime({ prep, fixture: prep.fixture, cartridges: prep.cartridges, out,
        report, save, installId: entry.installId, currentNative: true });
      await s.start(layout, false);
      await s.page.getByTestId("start-new-game").click(); await s.ready("playing");
      await s.setAuto(false, true); await s.command("ordinary_nvl", 0);
      assert.equal((await s.prefs()).autoSaveEnabled, false);
      assert.deepEqual(s.files(), []);
      await installResultGate(s.page);
      if (kind === "quick") await s.page.getByTestId("renpy-quick-save").click();
      else {
        if (layout === "renpy") await s.page.getByTestId("renpy-quick-save-load").click();
        else {
          await s.page.getByTestId("quick-menu-toggle").click();
          await s.page.getByRole("button", { name: "打开存档读档", exact: true }).click();
        }
        await s.ready("save_load");
        await s.page.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
      }
      await s.page.waitForFunction(() => window.__qaWriteAcknowledgment.state.received);
      entry.beforeExit = s.files(); assert.equal(entry.beforeExit.length, 1);
      const written = read(entry.beforeExit[0].path);
      assert.equal(written.save_kind, kind); assert.equal(written.command_index, 0);
      const identity = rows().find(p => p.ProcessId === s.child.pid);
      assert(identity && path.resolve(identity.ExecutablePath) === path.resolve(s.exe));
      const request = native.freshRequest(out, kind + "-" + layout, identity);
      entry.closeRequest = request; entry.closeSent = native.sendClose(request, out); save();
      await s.page.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor();
      assert((await s.page.getByRole("dialog", { name: "退出游戏？", exact: true }).innerText()).includes("自动保存已关闭"));
      await s.page.getByTestId("confirm-exit-game").click();
      await s.page.waitForFunction(() => document.querySelector('[data-testid="confirm-exit-game"]')?.disabled);
      await s.page.waitForTimeout(650);
      assert.equal(s.child.exitCode, null);
      assert(rows().some(p => p.ProcessId === identity.ProcessId && p.Created === identity.Created));
      entry.held = await s.page.evaluate(() => ({ ...window.__qaWriteAcknowledgment.state }));
      assert.equal(entry.held.calls, 1); assert(entry.held.received && !entry.held.delivered && !entry.held.released);
      assert.deepEqual(s.files(), entry.beforeExit);
      await s.shot(kind + "-pending-exit");
      await s.page.evaluate(() => window.__qaWriteAcknowledgment.release());
      const closed = s.child; await s.stop(true);
      assert.equal(closed.exitCode, 0);
      entry.afterExit = s.files(); assert.deepEqual(entry.afterExit, entry.beforeExit);
      const retained = path.join(out, kind + "-" + layout + ".json");
      fs.copyFileSync(entry.afterExit[0].path, retained, fs.constants.COPYFILE_EXCL);
      entry.retained = desc(retained); assert.equal(entry.retained.sha256, entry.beforeExit[0].sha256);
      await s.start(layout, false); await s.page.getByTestId("continue-game").click();
      await s.ready("playing"); await s.command("ordinary_nvl", 0);
      assert.equal((await s.prefs()).autoSaveEnabled, false);
      entry.reopened = await s.saves();
      assert.equal(entry.reopened.length, 1); assert.equal(entry.reopened[0].save_kind, kind);
      assert.deepEqual(s.files(), entry.afterExit); await s.shot(kind + "-pending-restart");
      await s.stop(); entry.status = "PASS"; save();
      console.log("PASS pending save exit " + layout + "/" + kind);
    }
    assert.equal(report.cases.length, 3); assert.deepEqual(report.pageErrors, []);
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
    if (s?.page) {
      report.failureText = (await s.page.locator("body").innerText().catch(() => "")).slice(-5000);
      report.gateAtFailure = await s.page.evaluate(() => window.__qaWriteAcknowledgment?.state).catch(() => null);
    }
  } finally {
    try {
      if (s?.page) await s.page.evaluate(() => {
        window.__qaWriteAcknowledgment?.release(); window.__qaWriteAcknowledgment?.restore();
      }).catch(() => {});
      await s?.stop();
      assert(!rows().some(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
      if (prepared) {
        report.commands.push(profile("Restore"));
        report.restoration = desc(out + "/profile-restoration.json");
        assert.equal(read(report.restoration.path).status, "PASS");
      }
      assert.deepEqual(listeners(report.launches.map(l => l.port)), []);
      for (const f of report.products) assert.equal(sha(f.path), f.sha256);
      report.cleanupVerified = true;
    } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, report: qa + "/report.json", error: report.error,
      cleanupError: report.cleanupError }));
  }
}
module.exports = { validatePreparation };
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
