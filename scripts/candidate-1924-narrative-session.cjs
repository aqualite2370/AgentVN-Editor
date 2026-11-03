"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateCartridge } = require("./installed-narrative-1922-export.cjs");
const { validateCandidateNarrativePreparation, resolveNarrativeCandidate } = require("./lib/candidate-1924-narrative-preparation.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt || "", /^\d{2}$/);
const current=process.argv.includes("--candidate=1.9.30");
const configArg = process.argv.slice(3).find(a => a.startsWith("--candidate-config="));
const exportArg = process.argv.slice(3).find(a => a.startsWith("--export-report="));
assert.deepEqual(process.argv.slice(2), configArg
  ? [attempt, configArg, exportArg] : current ? [attempt, "--candidate=1.9.30"] : [attempt]);
assert(!configArg || exportArg && !current);
const binding = configArg && resolveNarrativeCandidate(configArg.slice(19), exportArg.slice(16));
const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/narrative-installed-${binding?.stamp || (current?"1930":"1924")}-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const base = binding?.config.qa || (current?"F:/AgentVN/QA/Editor-1.9.30-20261026-01":"F:/AgentVN/QA/Editor-1.9.24-20261024-01");
const installation = desc(binding?.installation || path.join(base, current?"derived-components-installation-01.json":"installation.json")), installed = read(installation.path);
const exported = desc(binding?.exported || "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-49/report.json");
const fixtureExport = read(exported.path);
const tools = [__filename, "scripts/candidate-1924-narrative-flow.cjs",
  "scripts/lib/candidate-1924-narrative-preparation.cjs", "scripts/dev-narrative-playwright.cjs",
  "scripts/lib/dev-narrative-player.cjs", "scripts/lib/narrative-restoration-state.cjs",
  "scripts/lib/nvl-choice-frame-probe.cjs", "scripts/native-dev-preview-profile.ps1",
  "scripts/lib/installed-narrative-1922-fixture.cjs", "scripts/lib/voice-runtime-observer.cjs",
  "scripts/lib/current-native-capture.cjs", "scripts/lib/current-native-editor-session.cjs",
  "scripts/lib/owned-process-tree.cjs", "scripts/lib/owned-process-stop.cjs",
  "scripts/lib/installed-runtime-session.cjs", "scripts/lib/installed-acceptance.cjs"].map(desc);
const prep = { status: "PASS", sessionRoot: out,
  ...(binding ? { candidateVersion: binding.config.version, candidateConfig: desc(configArg.slice(19)) } : current?{candidateVersion:"1.9.30"}:{}),
  scope: binding?.scope || (current?"INSTALLED_1_9_30_NARRATIVE_LIBRARY_NOT_NEW_AUTHOR_EXPORT_OR_ANDROID":"INSTALLED_1_9_24_NARRATIVE_LIBRARY_NOT_NEW_AUTHOR_EXPORT_OR_ANDROID"),
  defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
  installation, exported, fixture: fixtureExport.fixture, cartridges: fixtureExport.cartridges,
  executable: installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),
  temporary: path.join(out, "temporary"), webview: path.join(out, "webview"), tools };
const report = { status: "RUNNING", startedAt: new Date().toISOString(), out, scope: prep.scope,
  smoke: false, commands: [], productChanges: 0, modelRequests: 0, builds: 0, normalCloseClaimed: false,
  installation, exported, fixture: prep.fixture, cartridges: prep.cartridges, executable: prep.executable, tools,
  boundaries: ["Actual installed Player library; historical UI-authored isolated fixture",
    binding ? "Current installed Editor UI-exported controlled fixture; not complete manual story authoring, setup, upgrade, Android or listening acceptance"
      : `Not a fresh ${current?"1.9.30":"1.9.24"} author/export, standalone saves, upgrade, Android or listening acceptance`,
    "Native WebView viewport simulation, not a physical 4K display",
    "Owned process teardown for restart; not normal window-close acceptance"] };
const save = () => fs.writeFileSync(path.join(out, "session.json"), JSON.stringify(report, null, 2));
let prepared = false;
async function command(exe, args, label, env = process.env) {
  const row = { label, command: [exe, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
    log: path.join(out, label + ".log") }; report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    row.status = row.exitCode === 0 ? "PASS" : "FAILED"; return row;
  } finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
}
async function profile(action) {
  const row = await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out,
    "-CodexCacheView", "-Storage", "NativeRoaming"], `profile-${action.toLowerCase()}`);
  assert.equal(row.exitCode, 0, row.log);
}
(async () => {
  save(); validateCandidateNarrativePreparation(prep);
  const changes = [
    p => { p.scope = "CURRENT_DEV"; }, p => { p.sessionRoot = "F:/AgentVN/QA/wrong"; },
    p => { p.executable = { ...p.executable, path: path.join(root, "editor/src-tauri/binaries/agentvn-player.exe") }; },
    p => { p.cartridges = []; }, p => { p.fixture = { ...p.fixture, capacityVariant: "empty" }; },
  ];
  for (const mutate of changes) {
    const bad = structuredClone(prep); mutate(bad); assert.throws(() => validateCandidateNarrativePreparation(bad));
  }
  report.rejectedPreparations = changes.length;
  report.verifiedCartridges = [];
  for (const c of prep.cartridges) {
    const actual = await validateCartridge(c.path, prep.fixture, c.layout);
    assert.equal(actual.scriptSha256, c.scriptSha256); assert.equal(actual.layoutSha256, c.layoutSha256);
    report.verifiedCartridges.push(actual);
  }
  for (const f of tools) {
    const copy = path.join(out, "tools", path.relative(root, f.path));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(f.path, copy, fs.constants.COPYFILE_EXCL); f.copy = copy;
  }
  const guard = await command(process.execPath, ["scripts/narrative-restoration-state-test.cjs"], "restoration-guard");
  assert.equal(guard.exitCode, 0, guard.log);
  const preparationFile = path.join(out, "preparation.json");
  fs.writeFileSync(preparationFile, JSON.stringify(prep, null, 2), { flag: "wx" });
  report.preparation = desc(preparationFile);
  report.environment = { AGENTVN_TEST_PROJECT: prep.fixture.input, AGENTVN_WORKSPACE_OUTPUT: out }; save();
  const adapted = await command(process.execPath, ["scripts/candidate-1924-narrative-flow.cjs",
    preparationFile, "--validate-adapter"], "adapter-guard", { ...process.env, ...report.environment });
  assert.equal(adapted.exitCode, 0, adapted.log);
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  fs.mkdirSync(prep.temporary); prepared = true; await profile("Prepare");
  const row = await command(process.execPath, ["scripts/candidate-1924-narrative-flow.cjs", preparationFile], "narrative",
    { ...process.env, ...report.environment, TEMP: prep.temporary, TMP: prep.temporary });
  report.raw = desc(path.join(out, "player.json")); const raw = read(report.raw.path);
  assert(raw.finishedAt && !raw.cleanupError && !raw.observerError);
  assert.equal(row.exitCode, 0, row.log); assert.equal(raw.status, "PASS"); assert.equal(raw.cells.length, 24);
  assert(raw.cells.every(c => c.status === "PASS" && c.checks.length === 5 &&
    c.checks.every(k => k.status === "PASS") && c.frameTraces.length === 2));
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  try {
    const rawFile = path.join(out, "player.json");
    if (fs.existsSync(rawFile)) {
      report.raw = desc(rawFile); const raw = read(rawFile);
      assert(raw.finishedAt && !raw.cleanupError);
      assert(raw.launches.every(l => l.cleanup?.status === "PASS"));
      report.knownProcesses = raw.knownProcesses; report.absentPorts = raw.launches.map(l => l.port);
      assert(!rows().some(p => raw.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
      assert.deepEqual(listeners(report.absentPorts), []);
    }
    assert(!rows().some(p => p.Name === "agentvn-player.exe" ||
      p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
    if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
      await profile("Restore"); report.restoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.restoration.path).status, "PASS");
    }
    validateCandidateNarrativePreparation(prep);
  } catch (error) {
    report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
