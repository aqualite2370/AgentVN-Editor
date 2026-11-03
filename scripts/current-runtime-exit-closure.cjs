"use strict";
// Exact frozen installed Player; reuse complete existing exit assertions.
// Profile isolation and ACL injection touch only fresh QA-owned save leaves.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { build: quickBuild } = require("./current-runtime-quick-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { observeStoryTree } = require("./lib/runtime-story-observer.cjs");
const native = require("./lib/windows-repository-native.cjs");
const attempt = process.env.AGENTVN_EXIT_QA_ATTEMPT || "01";
assert(["01", "02"].includes(attempt), "Only the original run and scoped ACL follow-up are supported");
const qa = "F:/AgentVN/QA/Exit-1.9.35-20261102-" + attempt;
const out = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/exit-installed-1935-" + attempt;
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const exportedFile = "F:/AgentVN/QA/Installed-Layout-20261101-01/editor-05/report.json";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const files = { flow: "native-runtime-exit-playwright.cjs", runtime: "lib/installed-runtime-session.cjs",
  acl: "native-runtime-exit-acl.ps1", validator: "native-runtime-exit-audit.cjs" };
function build(mode, original) {
  assert.equal(typeof original, "string");
  assert(original.trim().length > 0, "Empty regression source must not be accepted");
  const base = mode === "runtime" ? quickBuild(mode, original) : { source: original, edits: [] };
  let source = base.source; const edits = [...base.edits];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  if (mode === "runtime") {
    change(`require(${JSON.stringify(path.join(__dirname, "current-runtime-quick-closure.cjs"))}).validatePreparation(prep, out);`,
      `require(${JSON.stringify(__filename)}).validatePreparation(prep, out);`);
  } else if (mode === "acl") {
    change("'F:\\AgentVN\\QA\\Native-Runtime-State-20261020-01'",
      "'F:\\AgentVN\\QA\\Native-Runtime-State-20261101-01'");
    change("'^exit-(\\d{2})$'", `'^exit-installed-1935-(${attempt})$'`);
    // The copied helper keeps its relative include inside the existing scripts
    // tree: invoke the original absolute shared ACL descriptor implementation.
    change(". (Join-Path $PSScriptRoot 'lib\\runtime-qa-acl.ps1')",
      `. '${path.join(__dirname, "lib/runtime-qa-acl.ps1")}'`);
  } else if (mode === "flow") {
    if (attempt === "02") {
      change("expectedCases: smoke ? 4 : 8", "expectedCases: 4");
      change('for (const kind of (smoke ? ["retry", "auto_off"] : ["retry", "discard", "auto_on", "auto_off"]))',
        'for (const kind of ["retry", "discard"])');
    }
    change('path.resolve("scripts/native-runtime-exit-acl.ps1")', JSON.stringify(out + "/acl.ps1"));
    change('async function openExit() {\n  await s.openSettings(); await s.page.getByTestId("open-exit-confirmation").click();',
      `async function openExit() {
  if (["auto_on", "auto_off"].includes(entry.kind)) {
    entry.nativeClose = await require(${JSON.stringify(__filename)}).requestClose(s, entry.kind + "-" + entry.layout);
  } else {
    await s.openSettings(); await s.page.getByTestId("open-exit-confirmation").click();
  }`);
  } else assert.equal(mode, "validator");
  if (mode !== "acl") new vm.Script(Module.wrap(source));
  return { source, edits };
}
function load(mode) {
  const bindings = read(out + "/bindings.json"), binding = bindings.find(b => b.mode === mode);
  for (const file of [binding.original, binding.executed, binding.adapter]) assert.equal(sha(file.path), file.sha256);
  const file = binding.original.path, worker = new Module(file, module);
  Object.assign(worker, { filename: file, paths: Module._nodeModulePaths(path.dirname(file)) });
  worker.require = function(request) {
    if (mode === "flow" && request === "./lib/installed-runtime-session.cjs") return load("runtime");
    return Module.prototype.require.call(this, request);
  };
  worker._compile(fs.readFileSync(binding.executed.path, "utf8"), file);
  return worker.exports;
}
function validatePreparation(prep, output) {
  const installed = descriptor(), exported = read(exportedFile);
  assert.equal(path.resolve(output), path.resolve(out)); assert.equal(path.resolve(prep.sessionRoot), path.resolve(out));
  assert.equal(prep.status, "PASS"); assert.equal(prep.defaultStorage, "PHYSICAL_DEFAULT_PATH");
  assert.equal(prep.installId, "qa_native_exit_20261020_" + attempt);
  assert.deepEqual(prep.executable, installed.resources.find(p => path.basename(p.path) === "agentvn-player.exe"));
  assert.deepEqual(prep.cartridges, exported.cartridges);
  assert.equal(sha(prep.fixture.input), prep.fixture.inputSha256);
  assert.deepEqual(prep.fixture, exported.fixture);
  assert.equal(prep.webview, out + "/webview"); assert.equal(prep.temporary, out + "/temporary");
  assert.equal(sha(prep.originalExport.path), prep.originalExport.sha256);
}
async function requestClose(session, name) {
  const identity = rows().find(p => p.ProcessId === session.child.pid);
  assert(identity && path.resolve(identity.ExecutablePath) === path.resolve(session.exe));
  const request = native.freshRequest(out, "runtime-" + name, identity);
  const file = path.join(out, "runtime-" + name + "-close-request.json");
  fs.writeFileSync(file, JSON.stringify(request, null, 2), { flag: "wx" });
  const sent = native.sendClose(request, out);
  return { request: desc(file), sent, method: "WM_CLOSE_NOT_PHYSICAL_ALT_F4",
    confirmationAndSaveVerifiedBySubsequentUI: true };
}
function combineCoverage(current) {
  assert.equal(attempt, "02");
  const previousFile = out.replace(/-02$/, "-01") + "/exit.json";
  const previous = read(previousFile), previousSession = read(qa.replace(/-02$/, "-01") + "/session.json");
  assert.equal(previous.status, "FAILED"); assert(previous.finishedAt && !previous.cleanupError);
  assert.equal(previousSession.cleanupVerified, true);
  assert.equal(current.status, "PASS"); assert.equal(current.expectedCases, 4);
  assert.deepEqual(current.cases.map(c => [c.layout, c.kind]),
    ["agentvn", "renpy"].flatMap(layout => ["retry", "discard"].map(kind => [layout, kind])));
  const chosen = ["agentvn", "renpy"].flatMap(layout =>
    ["retry", "discard", "auto_on", "auto_off"].map(kind => {
      const run = ["retry", "discard"].includes(kind) ? current : previous;
      const entry = run.cases.find(c => c.layout === layout && c.kind === kind);
      assert.equal(entry.status, "PASS");
      return { run, entry };
    }));
  const composite = { ...current, expectedCases: 8,
    cases: chosen.map(c => c.entry),
    checks: chosen.flatMap(({ run, entry }) => run.checks.filter(c => c.layout === entry.layout && c.case === entry.kind)),
    launches: chosen.flatMap(({ run, entry }) => run.launches.filter(l => l.installId === entry.installId)),
    retained: chosen.flatMap(({ run, entry }) => run.retained.filter(l => l.installId === entry.installId)),
    screenshots: [...current.screenshots, ...previous.screenshots.filter(s => /-auto_(on|off)-/.test(path.basename(s.path)))],
    sources: [...current.sources, ...previous.sources],
    provenance: { method: "COMBINED_DISTINCT_COMPLETED_CASES_NOT_A_SINGLE_RUN", previous: desc(previousFile) } };
  for (const { run, entry } of chosen.filter(c => c.run === previous)) {
    assert(entry.nativeClose); assert.equal(entry.nativeClose.method, "WM_CLOSE_NOT_PHYSICAL_ALT_F4");
    assert.equal(sha(entry.nativeClose.sent.path), entry.nativeClose.sent.sha256);
    const sent = read(entry.nativeClose.sent.path); assert(sent.accepted && sent.handle);
    assert.equal(sent.executable, previousSession.player.path);
    assert.equal(run.pageErrors.length, 0);
  }
  return composite;
}
async function main(mode) {
  if (mode === "self-test") {
    descriptor();
    const tested = [];
    for (const [kind, name] of Object.entries(files)) {
      const original = fs.readFileSync(path.join(__dirname, name), "utf8"), r = build(kind, original);
      let reversed = r.source;
      for (const edit of [...r.edits].reverse()) reversed = reversed.replaceAll(edit.after, () => edit.before);
      assert.equal(reversed, original); assert.throws(() => build(kind, ""));
      tested.push({ mode: kind, adaptations: r.edits.length });
    }
    return console.log(JSON.stringify({ status: "PASS", tested, productStarts: 0, modelRequests: 0 }));
  }
  if (mode === "flow") {
    const index = process.argv.indexOf("--current-native-preparation"); assert(index > 0);
    validatePreparation(read(process.argv[index + 1]), out); load("flow"); return;
  }
  assert.equal(mode, "run"); assert(!fs.existsSync(qa)); assert(!fs.existsSync(out));
  const installed = descriptor(), exported = read(exportedFile);
  assert.equal(exported.status, "PASS");
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  fs.mkdirSync(qa); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), commands: [], knownProcesses: [],
    scope: "EXACT_CURRENT_INSTALLED_LIBRARY_EXIT_ACL_NATIVE_WM_CLOSE_AND_DURABLE_RESTART",
    productChanges: 0, builds: 0, modelRequests: 0, products: [installed.executable, ...installed.resources],
    installation: installed.actualInstallation, source: desc(__filename), normalEditorCloseClaimed: false };
  const save = () => fs.writeFileSync(qa + "/session.json", JSON.stringify(report, null, 2));
  const known = new Map(); let prepared = false;
  function sample() {
    const file = out + "/exit.json"; if (!fs.existsSync(file)) return;
    const raw = read(file), all = rows();
    for (const launch of raw.launches) observeStoryTree(all, launch, known, report.player.path);
    report.knownProcesses = [...known.values()]; save();
  }
  async function command(exe, args, label, env = process.env, observe = false) {
    const item = { command: [exe, ...args], label, status: "RUNNING", startedAt: new Date().toISOString(),
      log: qa + "/" + label + ".log" }; report.commands.push(item); save();
    const fd = fs.openSync(item.log, "wx"); let timer;
    try {
      const child = spawn(exe, args, { cwd: path.resolve(__dirname, ".."), env,
        windowsHide: true, stdio: ["ignore", fd, fd] }); item.pid = child.pid; save();
      if (observe) timer = setInterval(() => {
        try { sample(); } catch (error) { report.observerError = String(error.stack || error); save(); }
      }, 3000);
      item.exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject); child.once("close", resolve);
      });
      item.status = item.exitCode === 0 ? "PASS" : "FAILED"; if (observe) sample();
    } finally { clearInterval(timer); fs.closeSync(fd); item.finishedAt = new Date().toISOString(); save(); }
    assert.equal(item.exitCode, 0, item.log);
  }
  const profile = action => command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    helper, "-Action", action, "-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"],
  "profile-" + action.toLowerCase());
  try {
    save(); fs.copyFileSync(__filename, qa + "/frozen-adapter.cjs", fs.constants.COPYFILE_EXCL);
    report.bindings = Object.entries(files).map(([kind, name]) => {
      const original = path.join(__dirname, name), r = build(kind, fs.readFileSync(original, "utf8"));
      const executed = out + "/" + (kind === "acl" ? "acl.ps1" : kind + "-executed.cjs");
      fs.writeFileSync(executed, r.source, { flag: "wx" });
      return { mode: kind, original: desc(original), executed: desc(executed), adapter: desc(__filename), edits: r.edits };
    });
    fs.writeFileSync(out + "/bindings.json", JSON.stringify(report.bindings, null, 2), { flag: "wx" });
    report.player = installed.resources.find(p => path.basename(p.path) === "agentvn-player.exe");
    fs.mkdirSync(out + "/temporary");
    prepared = true; await profile("Prepare");
    const journal = read(out + "/profile-protection.json");
    const prep = { status: "PASS", sessionRoot: path.resolve(out), defaultStorage: "PHYSICAL_DEFAULT_PATH",
      originalExport: desc(exportedFile), executable: report.player, fixture: exported.fixture,
      cartridges: exported.cartridges, profiles: journal.records.filter(p => p.existed),
      allProfiles: journal.records, installId: "qa_native_exit_20261020_" + attempt,
      webview: out + "/webview", temporary: out + "/temporary" };
    validatePreparation(prep, out);
    fs.writeFileSync(out + "/preparation.json", JSON.stringify(prep, null, 2), { flag: "wx" });
    report.preparation = desc(out + "/preparation.json"); save();
    await command(process.execPath, [__filename, "flow", "--current-native-preparation", out + "/preparation.json"],
      "exit", { ...process.env, AGENTVN_TEST_PROJECT: prep.fixture.input, AGENTVN_WORKSPACE_OUTPUT: out,
        TEMP: prep.temporary, TMP: prep.temporary }, true);
    const raw = read(out + "/exit.json"), coverage = attempt === "02" ? combineCoverage(raw) : raw;
    load("validator").validateExitReport(coverage, false);
    if (attempt === "02") {
      fs.writeFileSync(qa + "/combined-coverage.json", JSON.stringify(coverage, null, 2), { flag: "wx" });
      report.combinedCoverage = desc(qa + "/combined-coverage.json");
    }
    assert(!report.observerError); report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    try {
      assert(!rows().some(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
      if (prepared && fs.existsSync(out + "/profile-protection.json")) {
        await profile("Restore"); report.restoration = desc(out + "/profile-restoration.json");
        assert.equal(read(report.restoration.path).status, "PASS");
      }
      if (fs.existsSync(out + "/exit.json")) {
        report.raw = desc(out + "/exit.json"); const raw = read(report.raw.path);
        report.absentPorts = raw.launches.map(l => l.port); assert.deepEqual(listeners(report.absentPorts), []);
        assert(raw.finishedAt && !raw.cleanupError);
      }
      const now = rows();
      assert(!now.some(p => known.has(`${p.ProcessId}:${p.Created}`)));
      for (const file of report.products) assert.equal(sha(file.path), file.sha256);
      report.cleanupVerified = true;
    } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, qa, out, error: report.error, cleanupError: report.cleanupError }));
  }
}
module.exports = { build, load, validatePreparation, requestClose, combineCoverage, qa, out };
if (require.main === module) main(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
