"use strict";
// Complete functional NVL capacity and voice restoration against frozen NSIS.
// Historical sources remain unchanged. No animation probes or product edits.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), { spawn } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNarrativeFixture } = require("./lib/installed-narrative-1922-fixture.cjs");
const story = require("./current-runtime-story-closure.cjs");
const layout = require("./current-layout-closure.cjs");
const qa = "F:/AgentVN/QA/Narrative-1.9.35-20261102-01";
const root = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/narrative-installed-1935-01";
const exportsRoot = "F:/AgentVN/QA/Installed-Layout-20261101-01";
const exportedFile = exportsRoot + "/editor-06/report.json";
const receipt = "F:/AgentVN/QA/Runtime-Story-1.9.35-20261101-01/derived-actual-installation.json";
const config = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/current-layout-candidate.json";
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const sources = { export: "installed-narrative-1922-export.cjs",
  flow: "installed-narrative-1922-playwright.cjs", player: "lib/installed-narrative-player.cjs" };
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
function build(mode, original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  if (mode === "export") {
    change('const root = "F:/AgentVN/QA/Installed-Layout-20261021-01";', `const root = ${JSON.stringify(exportsRoot)};`);
    change('path.join(config.qa, "derived-installed-01.json")', JSON.stringify(receipt), 2);
    change("assert(Array.isArray(installedReceipt.protectedFiles));",
      "assert(Array.isArray(installedReceipt.resources));");
    change("...installedReceipt.protectedFiles", "...(installedReceipt.protectedFiles || [])");
    change('page.locator(".recent-project-open:visible")',
      'page.locator(\'[data-help-key="home.recentProject"]:visible\')');
  } else {
    change('require("./lib/installed-narrative-1922-policy.cjs")', `require(${JSON.stringify(__filename)})`,
      mode === "flow" ? 1 : 0);
    if (mode === "player") {
      change('require("./installed-narrative-1922-policy.cjs")', `require(${JSON.stringify(__filename)})`);
      change('this.page = this.browser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost/.test(p.url())); assert(this.page);',
        'this.page = await require("./wait-native-runtime-page.cjs").waitNativeRuntimePage(this.browser);');
    } else {
      change('scope: "ACTUAL_1922_INSTALLED_LIBRARY_NVL_CAPACITY_AND_VOICE_RESTORATION",',
        'scope: "ACTUAL_1935_INSTALLED_LIBRARY_NVL_CAPACITY_AND_VOICE_RESTORATION",');
      change('const player = new NarrativePlayer(prep, report, save);',
        'const { assertRestoredNarrativeState } = require("./lib/narrative-restoration-state.cjs");\n' +
        'const player = new NarrativePlayer(prep, report, save);');
      change("assert.deepEqual(restored.nvl, choice.nvl);",
        "assertRestoredNarrativeState(restored, choice, cell.viewport);");
      change("assert.equal(restored.scene, name); assert.equal(restored.page, 2); assert.equal(restored.text, interior.text);",
        "assertRestoredNarrativeState(restored, interior, cell.viewport);");
      change("assert.deepEqual(forward.nvl, next.nvl);",
        "assertRestoredNarrativeState(forward, next, cell.viewport);");
      change("assert.deepEqual(s.nvl, saved.interior.nvl); geometry(s);",
        "assertRestoredNarrativeState(s, saved.interior, cell.viewport); geometry(s);");
      change("qa_narrative_1922_", "qa_narrative_1935_");
    }
  }
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function load(mode, args, execute = false) {
  const original = path.join(__dirname, sources[mode]), folder = qa + "/" + mode + "-preparation";
  fs.mkdirSync(folder, { recursive: false });
  const result = build(mode, fs.readFileSync(original, "utf8")), executed = folder + "/executed.cjs";
  fs.writeFileSync(executed, result.source, { flag: "wx" });
  fs.copyFileSync(__filename, folder + "/frozen-adapter.cjs", fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(folder + "/binding.json", JSON.stringify({ mode, args,
    original: describe(original), executed: describe(executed), adapter: describe(__filename),
    edits: result.edits, productChanges: 0 }, null, 2), { flag: "wx" });
  if (args) process.argv = [process.execPath, original, ...args];
  const worker = new Module(original, module); worker.filename = original;
  worker.paths = Module._nodeModulePaths(path.dirname(original));
  worker.require = function(request) {
    if (mode === "export" && request === "./candidate-layout-consumption.cjs")
      return { ...Module.prototype.require.call(this, request), validateCandidateConfig: layout.validateCandidateConfig };
    if (mode === "flow" && request === "./lib/installed-narrative-player.cjs") return load("player");
    return Module.prototype.require.call(this, request);
  };
  if (execute) { require.main = worker; process.mainModule = worker; }
  worker._compile(result.source, original); return worker.exports;
}
function validateNarrativePreparation(prep) {
  assert.equal(prep.status, "PASS"); assert.equal(prep.scope,
    "ACTUAL_1935_INSTALLED_LIBRARY_NVL_CAPACITY_AND_VOICE_RESTORATION");
  assert.equal(path.resolve(prep.sessionRoot), path.resolve(root));
  assert.equal(prep.defaultStorage, "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION");
  const actual = story.descriptor();
  assert.deepEqual(read(prep.installation.path), actual);
  assert.deepEqual(prep.executable, actual.resources.find(f => path.basename(f.path) === "agentvn-player.exe"));
  assert.equal(path.resolve(prep.exported.path), path.resolve(exportedFile));
  const exported = read(prep.exported.path);
  assert.equal(exported.status, "PASS"); assert(exported.finishedAt && !exported.error && !exported.cleanupError);
  assert.equal(exported.scope, "CURRENT_INSTALLED_EDITOR_NARRATIVE_BOUNDARY_UI_EXPORT");
  assert.equal(exported.candidateVersion, "1.9.35");
  assert.equal(exported.installation.sha256, prep.installation.sha256);
  assert.equal(exported.steps.length, 3); assert(exported.steps.every(s => s.status === "PASS"));
  assert.equal(exported.modelRequests, 0); assert.equal(exported.productChanges, 0);
  assert.deepEqual(prep.cartridges, exported.cartridges); assert.equal(prep.cartridges.length, 2);
  assert.deepEqual(prep.fixture, exported.fixture); assert.equal(prep.fixture.capacityVariant, "mixed-history-v2");
  validateNarrativeFixture(read(prep.fixture.input), prep.fixture, fs.readFileSync(prep.fixture.voice.path));
  for (const f of [prep.executable, prep.installation, prep.exported, ...prep.cartridges, ...prep.tools || []])
    assert.equal(sha(f.path), f.sha256);
  assert.equal(sha(prep.fixture.input), prep.fixture.inputSha256);
  assert.equal(sha(exported.restoration.path), exported.restoration.sha256);
  assert.equal(read(exported.restoration.path).status, "PASS");
  assert(exported.cleanups.length && exported.cleanups.every(c => c.status === "PASS"));
  assert.equal(path.resolve(prep.temporary), path.join(path.resolve(root), "temporary"));
  assert.equal(path.resolve(prep.webview), path.join(path.resolve(root), "webview"));
}
async function runSession() {
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  const installed = story.descriptor(), exported = read(exportedFile);
  assert(!fs.existsSync(root)); fs.mkdirSync(root);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), out: root, commands: [],
    scope: "ACTUAL_1935_INSTALLED_LIBRARY_NVL_CAPACITY_AND_VOICE_RESTORATION",
    productChanges: 0, modelRequests: 0, builds: 0, normalCloseClaimed: false,
    installation: describe(receipt), exported: describe(exportedFile), executable:
      installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),
    fixture: exported.fixture, cartridges: exported.cartridges, tools: [], smoke: false };
  const save = () => fs.writeFileSync(root + "/session.json", JSON.stringify(report, null, 2));
  const prep = { status: "PASS", sessionRoot: root, scope: report.scope,
    defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
    installation: report.installation, exported: report.exported, executable: report.executable,
    fixture: report.fixture, cartridges: report.cartridges,
    temporary: root + "/temporary", webview: root + "/webview" };
  let prepared = false;
  async function command(exe, args, label, env = process.env) {
    const c = { label, command: [exe, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
      log: root + "/" + label + ".log" }; report.commands.push(c); save();
    const fd = fs.openSync(c.log, "wx");
    try {
      const child = spawn(exe, args, { cwd: path.resolve(__dirname, ".."), env,
        windowsHide: true, stdio: ["ignore", fd, fd] }); c.pid = child.pid; save();
      c.exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject); child.once("close", resolve);
      });
      c.status = c.exitCode === 0 ? "PASS" : "FAILED";
    } finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
    assert.equal(c.exitCode, 0, c.log);
  }
  const profile = action => command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    helper, "-Action", action, "-RunDirectory", root, "-CodexCacheView", "-Storage", "NativeRoaming"],
  "profile-" + action.toLowerCase());
  try {
    save(); validateNarrativePreparation(prep);
    for (const name of [__filename, ...Object.values(sources).map(s => path.join(__dirname, s)),
      "scripts/lib/narrative-restoration-state.cjs", "scripts/lib/installed-narrative-1922-fixture.cjs",
      "scripts/lib/voice-runtime-observer.cjs", "scripts/lib/current-native-capture.cjs", helper]) {
      const f = describe(name), copy = root + "/tools/" + path.basename(name);
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(name, copy, fs.constants.COPYFILE_EXCL); report.tools.push({ ...f, copy });
    }
    prep.tools = report.tools; validateNarrativePreparation(prep);
    fs.writeFileSync(root + "/preparation.json", JSON.stringify(prep, null, 2), { flag: "wx" });
    report.preparation = describe(root + "/preparation.json");
    report.environment = { AGENTVN_TEST_PROJECT: prep.fixture.input, AGENTVN_WORKSPACE_OUTPUT: root }; save();
    fs.mkdirSync(prep.temporary); prepared = true; await profile("Prepare");
    await command(process.execPath, [__filename, "flow", root + "/preparation.json"], "narrative",
      { ...process.env, ...report.environment, TEMP: prep.temporary, TMP: prep.temporary });
    const raw = read(root + "/player.json");
    assert.equal(raw.status, "PASS"); assert(raw.finishedAt && !raw.cleanupError && !raw.observerError);
    assert.equal(raw.cells.length, 24);
    assert(raw.cells.every(c => c.status === "PASS" && c.checks.length === 5 && c.checks.every(k => k.status === "PASS")));
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    try {
      assert(!rows().some(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(root)));
      if (prepared && fs.existsSync(root + "/profile-protection.json")) {
        await profile("Restore"); report.restoration = describe(root + "/profile-restoration.json");
        assert.equal(read(report.restoration.path).status, "PASS");
      }
      if (fs.existsSync(root + "/player.json")) {
        const raw = read(root + "/player.json"); report.raw = describe(root + "/player.json");
        assert(raw.finishedAt && !raw.cleanupError);
        assert(raw.launches.every(l => l.cleanup?.status === "PASS"));
        report.knownProcesses = raw.knownProcesses; report.absentPorts = raw.launches.map(l => l.port);
        const active = rows();
        assert(!active.some(p => raw.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
        assert.deepEqual(listeners(report.absentPorts), []);
      }
      for (const f of report.tools) assert.equal(sha(f.path), f.sha256);
      validateNarrativePreparation(prep);
    } catch (error) {
      report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, root, error: report.error, cleanupError: report.cleanupError }));
  }
}
async function main(mode, args) {
  if (mode === "self-test") {
    story.descriptor(); layout.validateCandidateConfig(read(config));
    for (const [kind, name] of Object.entries(sources)) {
      const original = fs.readFileSync(path.join(__dirname, name), "utf8"), result = build(kind, original);
      let reversed = result.source;
      for (const e of [...result.edits].reverse()) reversed = reversed.replaceAll(e.after, () => e.before);
      assert.equal(reversed, original);
    }
    assert(!fs.existsSync(qa)); fs.mkdirSync(qa);
    console.log(JSON.stringify({ status: "PASS", sources: 3, productStarts: 0, productChanges: 0 }));
  } else if (mode === "export") {
    assert.deepEqual(args, []);
    process.env.AGENTVN_INSTALLED_GUI_QA_ROOT = path.resolve(exportsRoot);
    load("export", ["06", "--mixed-capacity", "--candidate-config=" + config], true);
  } else if (mode === "flow") {
    assert.deepEqual(args, [root + "/preparation.json"]);
    load("flow", args, true);
  } else { assert.equal(mode, "run"); await runSession(); }
}
module.exports = { build, validateNarrativePreparation };
if (require.main === module) main(process.argv[2], process.argv.slice(3))
  .catch(error => { console.error(error); process.exitCode = 1; });
