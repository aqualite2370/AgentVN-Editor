"use strict";
// Offline guard tests only: no Player, profile changes, locks or model requests.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const out = process.argv[2];
const options = require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate(process.argv.includes("--candidate=1.9.30"));
const current = options.current, base = options.base;
assert.deepEqual(process.argv.slice(2),!options.explicit&&current?[out,"--candidate=1.9.30"]:[out]);
assert(out && path.dirname(path.resolve(out)) === path.resolve(base));
assert.match(path.basename(out), /^quick-guard-(red|green)-\d{2}$/);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "OFFLINE_CANDIDATE_QUICK_GUARDS_NOT_PRODUCT_ACCEPTANCE", checks: [],
  productStarts: 0, modelRequests: 0, profileChanges: 0, actualLocks: 0 };
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file) });
try {
  const { validateCandidateQuickPreparation, adaptQuickSession, adaptQuickFlow,
    adaptQuickValidator, candidateQuickRuntime,
    validateCandidateQuickReport, loadModule } = require("./lib/candidate-1924-quick-adapter.cjs");
  const installation = desc(options.installation), installed = read(installation.path);
  const originalExport = desc(options.exported);
  const exported = read(originalExport.path);
  const sessionRoot = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/quick-installed-${options.stamp}-01`);
  const prep = { status: "PASS", scope: options.scope,
    ...(current?{candidateVersion:options.version}:{}),
    sessionRoot, installation, originalExport, fixture: exported.fixture, cartridges: exported.cartridges,
    originalFixture: desc(path.join(exported.out, "fixture.json")),
    executable: installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),
    defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
    installId: `qa_quick_${options.stamp}_01`, webview: path.join(sessionRoot, "webview"),
    temporary: path.join(sessionRoot, "temporary"), profiles: [], tools: [desc(__filename)] };
  validateCandidateQuickPreparation(prep, sessionRoot);
  report.checks.push({ name: "Actual installed candidate and historical UI-exported fixture accepted",
    status: "PASS" });
  const variants = [
    p => { p.scope = "CURRENT_DEV"; }, p => { p.current1922Library = true; },
    p => { p.installId = "preview_gamecli"; }, p => { p.cartridges = []; },
    p => { p.executable = { ...p.executable, path: path.resolve("editor/src-tauri/binaries/agentvn-player.exe") }; },
    p => { p.sessionRoot = "D:/AgentVN"; }, p => { p.defaultStorage = "PHYSICAL_DEFAULT_PATH"; },
    p => { p.fixture = { ...p.fixture, inputSha256: "0".repeat(64) }; },
    p => { p.originalFixture.sha256 = "0".repeat(64); },
    p => { p.candidateVersion = "1.9.99"; },
  ];
  for (const mutate of variants) {
    const bad = structuredClone(prep); mutate(bad);
    assert.throws(() => validateCandidateQuickPreparation(bad, sessionRoot));
  }
  assert.throws(() => validateCandidateQuickPreparation(prep, path.dirname(sessionRoot)));
  report.checks.push({ name: "Wrong candidate, unsafe identity and altered inputs rejected",
    status: "PASS", rejectedVariants: variants.length + 1 });
  const vm = require("node:vm"), Module = require("node:module");
  let changes = 0, driftRejections = 0;
  for (const [file, adapt] of [
    ["scripts/lib/installed-runtime-session.cjs", adaptQuickSession],
    ["scripts/installed-runtime-quick-gaps-playwright.cjs", adaptQuickFlow],
    ["scripts/native-runtime-quick-audit.cjs", adaptQuickValidator],
  ]) {
    const before = sha(file), original = fs.readFileSync(file, "utf8");
    const result = adapt(original);
    new vm.Script(Module.wrap(result.source));
    for (const change of result.adaptations) {
      assert.throws(() => adapt(original.replace(change.before, "")), undefined, change.reason);
      assert.throws(() => adapt(original + "\n" + change.before), undefined, change.reason);
      driftRejections += 2;
    }
    changes += result.adaptations.length;
    assert.equal(sha(file), before, "Historical acceptance tool must remain unchanged");
  }
  const runtime = candidateQuickRuntime();
  const instance = new runtime.InstalledRuntimeSession({ prep, fixture: prep.fixture,
    cartridges: prep.cartridges, out: sessionRoot, report: {}, save() {},
    installId: prep.installId, currentNative: true });
  assert.equal(instance.exe, prep.executable.path);
  assert.equal(instance.child, undefined, "Constructor guard must never start a Player");
  const bad = structuredClone(prep); bad.scope = "CURRENT_DEV";
  assert.throws(() => new runtime.InstalledRuntimeSession({ prep: bad, fixture: bad.fixture,
    cartridges: bad.cartridges, out: sessionRoot, report: {}, save() {},
    installId: bad.installId, currentNative: true }));
  report.checks.push({ name: "Actual adapted session constructor binds the candidate without launch; source drift rejected",
    status: "PASS", changes, driftRejections });
  const { spawnSync } = require("node:child_process");
  const directory = `C:/Users/1/AppData/Roaming/com.agentvn.player/saves/qa_quick_${options.stamp}_01_01`;
  function lockPolicy(target, run = sessionRoot) {
    return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.resolve("scripts/candidate-1924-quick-lock.ps1"), "-Target", target,
      "-Ready", path.join(run, "guard-ready"), "-Release", path.join(run, "guard-release"),
      "-RunDirectory", run, "-ValidateOnly"],
    { encoding: "utf8", windowsHide: true, timeout: 15000 });
  }
  const accepted = lockPolicy(path.join(directory, "quick-01.json"));
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert(accepted.stdout.includes("PASS_VALIDATED_ONLY"));
  for (const target of [
    path.join(directory, "../preview_gamecli/quick-01.json"),
    path.join(directory, "../qa_quick_1924_02_01/quick-01.json"),
    path.join(directory, "slot-01.json"), path.join(directory, "quick-07.json"),
    path.join(directory, "../qa_current_quick_1922_01_01/quick-01.json"),
    path.join(directory, `../qa_quick_${current?"1924":"1930"}_01_01/quick-01.json`),
  ]) assert.notEqual(lockPolicy(target).status, 0, target);
  assert.notEqual(lockPolicy(path.join(directory, "quick-01.json"), path.dirname(sessionRoot)).status, 0);
  report.checks.push({ name: "Real PowerShell validation permits only exact candidate QA slots and signals",
    status: "PASS", rejectedTargets: 7, actualLocks: 0 });
  // In-memory contract fixture only. This deliberately is NOT new product evidence.
  const historicalRaw = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-quick-1922-02/player-01.json";
  const previousHash = sha(historicalRaw), fixtureRaw = structuredClone(read(historicalRaw));
  fixtureRaw.scope = options.scope + "_NOT_STANDALONE_ANDROID_OR_NATIVE_PICKER";
  for (const launch of fixtureRaw.launches) {
    launch.scope = `INSTALLED_${options.version.replaceAll(".", "_")}_LIBRARY_QUICK_NOT_STANDALONE_OR_ANDROID`;
    launch.executableSha256 = prep.executable.sha256;
  }
  validateCandidateQuickReport(fixtureRaw, prep);
  const badReports = [
    r => { r.cells = []; }, r => { r.cells[0].checks.pop(); },
    r => { r.launches[0].executableSha256 = "wrong"; }, r => { r.scope = "CURRENT_DEV"; },
    r => { r.mockDelay = true; }, r => { r.locks[0].cleanup = "FAILED"; },
    r => { r.faults[0].restoration = "FAILED"; }, r => { r.screenshots.pop(); },
    r => { r.cells[0].checks[2].detail.restored.command = 0; },
    r => { r.cells[0].checks[1].detail.method = "ACL"; },
  ];
  for (const mutate of badReports) {
    const bad = structuredClone(fixtureRaw); mutate(bad);
    assert.throws(() => validateCandidateQuickReport(bad, prep));
  }
  assert.equal(sha(historicalRaw), previousHash);
  report.checks.push({ name: "Preserved complete business oracle rejects incomplete and false quick evidence",
    status: "PASS", rejectedReports: badReports.length, fixture: desc(historicalRaw),
    scope: "IN_MEMORY_VALIDATOR_CONTRACT_NOT_NEW_PRODUCT_EXECUTION" });
  const wrapper = path.resolve("scripts/candidate-1924-quick-flow.cjs");
  const loaded = loadModule('module.exports = { file: __filename, bytes: ' +
    'require("node:fs").readFileSync(__filename, "utf8"), relative: require("./lib/installed-runtime-session.cjs").sha(__filename) };',
  wrapper);
  assert.equal(loaded.file, wrapper); assert.equal(loaded.bytes, fs.readFileSync(wrapper, "utf8"));
  assert.equal(loaded.relative, sha(wrapper));
  assert.throws(() => loadModule("", path.resolve("scripts/__nonexistent-candidate-quick-flow.cjs")));
  report.checks.push({ name: "Real wrapper filename and relative module loading work without starting business",
    status: "PASS", nonexistentWrapperRejected: true });
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
