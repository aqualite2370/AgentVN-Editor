"use strict";
// Current installed candidate, preserved actual quick-save fault assertions.
// No product changes, persistence mocks, model calls or historical PASS reuse.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict"), vm = require("node:vm");
const { spawn, spawnSync } = require("node:child_process");
const closure = require("./current-runtime-story-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { observeStoryTree } = require("./lib/runtime-story-observer.cjs");
const qa = "F:/AgentVN/QA/Runtime-Story-1.9.35-20261101-01";
const root = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/quick-installed-1935-01";
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const sources = { flow: "installed-runtime-quick-gaps-playwright.cjs",
  runtime: "lib/installed-runtime-session.cjs", validator: "native-runtime-quick-audit.cjs",
  lock: "candidate-1924-quick-lock.ps1" };
function build(mode, original) {
  const moved = mode === "lock" ? { source: original, edits: [] } : closure.adapt("player", original);
  let source = moved.source; const edits = [...moved.edits];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  if (mode === "runtime") {
    change('      if (prep.current1922Library) {\n' +
      '        require("./installed-runtime-quick-1922-preparation.cjs").validateQuickPreparation(prep, out);\n' +
      '      } else assert.equal(prep.defaultStorage, prep.current1922Preview\n' +
      '        ? "CODEX_EXPLICIT_PROFILE_JUNCTION_PREVIEW" : "PHYSICAL_DEFAULT_PATH");',
      `      require(${JSON.stringify(__filename)}).validatePreparation(prep, out);`);
    change('    this.page = this.browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(this.page);',
      '    this.page = await require("./wait-native-runtime-page.cjs").waitNativeRuntimePage(this.browser);');
    change('F:\\\\AgentVN\\\\QA\\\\Native-Runtime-State-20261020-01\\\\',
      'F:\\\\AgentVN\\\\QA\\\\Native-Runtime-State-20261101-01\\\\');
  }
  if (mode === "flow") {
    change('`${root}/scripts/installed-runtime-quick-gaps-lock.ps1`', JSON.stringify(root + "/lock.ps1"));
    change('...(current1922 ? ["-Current1922"] : [])', "...[] /* current scoped lock */");
  }
  if (mode === "lock") {
    change("'F:\\AgentVN\\QA\\Native-Runtime-State-20261020-01'",
      "'F:\\AgentVN\\QA\\Native-Runtime-State-20261101-01'");
    change("'^quick-installed-(1924|1930|1932|1933|1934)-(\\d{2})$'",
      "'^quick-installed-(1935)-(01)$'");
  }
  if (mode !== "lock") new vm.Script(Module.wrap(source));
  return { source, edits };
}
function load(mode) {
  const binding = read(root + "/sources.json").find(b => b.mode === mode);
  for (const file of [binding.original, binding.executed, binding.adapter])
    assert.equal(sha(file.path), file.sha256, file.path);
  const file = binding.original.path, worker = new Module(file, module);
  worker.filename = file; worker.paths = Module._nodeModulePaths(path.dirname(file));
  worker.require = function(request) {
    if (mode === "flow" && request === "./lib/installed-runtime-session.cjs") return load("runtime");
    return Module.prototype.require.call(this, request);
  };
  worker._compile(fs.readFileSync(binding.executed.path, "utf8"), file);
  return worker.exports;
}
function validatePreparation(prep, output) {
  const installed = closure.descriptor();
  assert.equal(path.resolve(output), path.resolve(root));
  assert.equal(path.resolve(prep.sessionRoot), path.resolve(root));
  assert.equal(prep.status, "PASS"); assert.equal(prep.current1922Library, true);
  assert.equal(prep.defaultStorage, "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION");
  assert.equal(prep.installId, "qa_quick_1935_01");
  assert.deepEqual(prep.executable, installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"));
  assert.deepEqual(read(prep.installation.path), installed);
  const exported = read(prep.originalExport.path);
  assert.equal(exported.status, "PASS");
  assert.equal(exported.scope, "ACTUAL_1935_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE");
  assert.deepEqual(prep.cartridges, exported.cartridges);
  assert.equal(sha(prep.fixture.input), prep.fixture.inputSha256);
  assert.deepEqual(prep.fixture, exported.fixture);
  assert.equal(path.resolve(prep.webview), path.resolve(root, "webview"));
  assert.equal(path.resolve(prep.temporary), path.resolve(root, "temporary"));
  for (const file of [prep.installation, prep.originalExport, prep.originalFixture, prep.executable, ...prep.cartridges])
    assert.equal(sha(file.path), file.sha256);
}
async function main(mode) {
  if (mode === "self-test") {
    closure.descriptor();
    for (const [kind, name] of Object.entries(sources)) {
      const original = fs.readFileSync(path.join(__dirname, name), "utf8"), result = build(kind, original);
      let reversed = result.source;
      for (const edit of [...result.edits].reverse())
        reversed = reversed.replaceAll(edit.after, () => edit.before);
      assert.equal(reversed, original);
    }
    const lockSource = build("lock", fs.readFileSync(path.join(__dirname, sources.lock), "utf8")).source;
    const folder = qa + "/quick-lock-preflight-01";
    fs.mkdirSync(folder, { recursive: false });
    const file = folder + "/lock.ps1";
    fs.writeFileSync(file, lockSource, { flag: "wx" });
    const target = "C:/Users/1/AppData/Roaming/com.agentvn.player/saves/qa_quick_1935_01_01/quick-01.json";
    const variants = [
      { target, directory: root, accepted: true },
      { target: target.replace("quick-01.json", "quick-06.json"), directory: root, accepted: true },
      { target: target.replace("qa_quick_1935_01_01", "user-game"), directory: root, accepted: false },
      { target: target.replace("quick-01.json", "manual-01.json"), directory: root, accepted: false },
      { target: target.replace("1935_01_01", "1935_02_01"), directory: root, accepted: false },
      { target, directory: root.replace("1935-01", "1935-02"), accepted: false },
    ];
    for (const item of variants) {
      const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        file, "-Target", item.target, "-RunDirectory", item.directory,
        "-Ready", root + "/preflight-ready", "-Release", root + "/preflight-release", "-ValidateOnly"],
      { encoding: "utf8", windowsHide: true, timeout: 10000 });
      assert.equal(result.status === 0, item.accepted, JSON.stringify({ item, stderr: result.stderr }));
      if (item.accepted) assert.match(result.stdout, /PASS_VALIDATED_ONLY/);
    }
    fs.writeFileSync(folder + "/report.json", JSON.stringify({ status: "PASS", tool: describe(__filename),
      sources: 4, boundaryCases: variants, lockHelper: describe(file),
      productStarts: 0, filesLocked: 0, productChanges: 0 }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: "PASS", sources: 4, lockBoundaries: 6, productChanges: 0 }));
    return;
  }
  if (mode === "flow") {
    const index = process.argv.indexOf("--current-native-preparation"); assert(index > 0);
    validatePreparation(read(process.argv[index + 1]), root); load("flow"); return;
  }
  assert.equal(mode, "run");
  const prior = root.replace("/quick-installed-1935-01", "/installed-story-1935-03") + "/session.json";
  const previous = read(prior); assert.equal(previous.status, "PASS");
  assert(previous.finishedAt && !previous.cleanupError && !previous.observerError);
  assert.equal(read(qa + "/bindings-audit-03-01.json").status, "PASS");
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  assert(!fs.existsSync(root)); fs.mkdirSync(root);
  const installed = closure.descriptor(), exportedFile = "F:/AgentVN/QA/Installed-Layout-20261101-01/editor-05/report.json";
  const exported = read(exportedFile);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), commands: [],
    predecessor: describe(prior), executable: previous.executable, source: describe(__filename),
    knownProcesses: [], productChanges: 0, builds: 0, modelRequests: 0, normalCloseClaimed: false,
    scope: "ACTUAL_1935_INSTALLED_QUICK_SAVE_EXCEPTION_MATRIX_NOT_STANDALONE_ANDROID" };
  const save = () => fs.writeFileSync(root + "/session.json", JSON.stringify(report, null, 2));
  const known = new Map(); let prepared = false;
  async function command(exe, args, label, env = process.env, observe = false) {
    const row = { command: [exe, ...args], label, status: "RUNNING", startedAt: new Date().toISOString(),
      log: root + "/" + label + ".log" }; report.commands.push(row); save();
    const fd = fs.openSync(row.log, "wx"); let timer;
    function sample() {
      if (!fs.existsSync(root + "/player-01.json")) return;
      let raw; try { raw = read(root + "/player-01.json"); } catch { return; }
      const all = rows();
      for (const launch of raw.launches)
        observeStoryTree(all, launch, known, previous.executable.path);
      report.knownProcesses = [...known.values()]; save();
    }
    try {
      const child = spawn(exe, args, { cwd: path.resolve(__dirname, ".."), env,
        windowsHide: true, stdio: ["ignore", fd, fd] }); row.pid = child.pid; save();
      if (observe) timer = setInterval(() => {
        try { sample(); } catch (error) { report.observerError = String(error.stack || error); save(); }
      }, 3000);
      row.exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject); child.once("close", resolve);
      });
      row.status = row.exitCode === 0 ? "PASS" : "FAILED"; if (observe) sample();
    } finally { clearInterval(timer); fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
    assert.equal(row.exitCode, 0, row.log);
  }
  async function profile(action) {
    await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      helper, "-Action", action, "-RunDirectory", root, "-CodexCacheView", "-Storage", "NativeRoaming"],
    "profile-" + action.toLowerCase());
  }
  try {
    save();
    const bindings = Object.entries(sources).map(([kind, name]) => {
      const original = path.join(__dirname, name), result = build(kind, fs.readFileSync(original, "utf8"));
      const executed = root + "/" + (kind === "lock" ? "lock.ps1" : kind + "-executed.cjs");
      fs.writeFileSync(executed, result.source, { flag: "wx" });
      return { mode: kind, original: describe(original), executed: describe(executed),
        adapter: describe(__filename), edits: result.edits };
    });
    fs.copyFileSync(__filename, root + "/frozen-adapter.cjs", fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(root + "/sources.json", JSON.stringify(bindings, null, 2), { flag: "wx" });
    fs.mkdirSync(root + "/temporary");
    prepared = true; await profile("Prepare");
    const journal = read(root + "/profile-protection.json");
    const prep = { status: "PASS", sessionRoot: root, current1922Library: true,
      defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
      installation: describe(qa + "/derived-actual-installation.json"),
      originalExport: describe(exportedFile), originalFixture: describe(path.join(exported.out, "fixture.json")),
      executable: installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),
      fixture: exported.fixture, cartridges: exported.cartridges, profiles: journal.records.filter(p => p.existed),
      installId: "qa_quick_1935_01", webview: root + "/webview", temporary: root + "/temporary" };
    validatePreparation(prep, root);
    fs.writeFileSync(root + "/preparation.json", JSON.stringify(prep, null, 2), { flag: "wx" });
    report.preparation = describe(root + "/preparation.json"); save();
    await command(process.execPath, [__filename, "flow", "--current-native-preparation", root + "/preparation.json"],
      "quick", { ...process.env, AGENTVN_TEST_PROJECT: prep.fixture.input,
        AGENTVN_WORKSPACE_OUTPUT: root, TEMP: prep.temporary, TMP: prep.temporary }, true);
    report.raw = describe(root + "/player-01.json");
    const raw = read(report.raw.path);
    load("validator").validateQuickReport(raw, 12, { current1922: true });
    assert(raw.finishedAt && !report.observerError); report.status = "PASS";
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
      if (fs.existsSync(root + "/player-01.json")) {
        const raw = read(root + "/player-01.json"); report.raw = describe(root + "/player-01.json");
        report.absentPorts = raw.launches.map(l => l.port);
        assert.deepEqual(listeners(report.absentPorts), []);
        assert(raw.finishedAt && !raw.cleanupError);
        assert(raw.locks.every(l => l.cleanup === "PASS") && raw.faults.every(f => f.restoration === "PASS"));
      }
      for (const p of known.values())
        assert(!rows().some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
      assert.equal(sha(__filename), report.source.sha256);
    } catch (error) {
      report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, root, error: report.error, cleanupError: report.cleanupError }));
  }
}
module.exports = { build, validatePreparation };
if (require.main === module) main(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
