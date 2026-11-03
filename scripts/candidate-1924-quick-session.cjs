"use strict";
// Own one complete quick-exception matrix, after the existing ability chain.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { observeStoryTree } = require("./lib/runtime-story-observer.cjs");
const { validateCandidateQuickPreparation, validateCandidateQuickReport } =
  require("./lib/candidate-1924-quick-adapter.cjs");
const { quickCandidate } = require("./lib/candidate-1924-quick-adapter.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const options = quickCandidate(process.argv.includes("--candidate=1.9.30")), current = options.current;
assert.deepEqual(process.argv.slice(2),!options.explicit&&current?[attempt,"--candidate=1.9.30"]:[attempt],"No smoke or unreviewed switches");
const base = options.base;
const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/quick-installed-${options.stamp}-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), out, commands: [],
  scope: options.scope, smoke: false,
  productChanges: 0, builds: 0, modelRequests: 0, normalCloseClaimed: false,
  knownProcesses: [], observerTransients: [], boundaries: [
    "Actual installed Player library with historical UI-exported isolated cartridges",
    "Real read-sharing refusal, not ACL; controlled semantic save corruption",
    "No delayed/mocked persistence; trusted actual pending input is required",
    "Not new authoring, standalone/setup, Android, listening or normal close acceptance",
    "WebView viewport simulation, not physical 4K",
  ] };
if (options.explicit) report.boundaries[0] =
  "Actual current installed Player library with current Editor fresh UI exports from a historical controlled fixture";
const save = () => fs.writeFileSync(path.join(out, "session.json"), JSON.stringify(report, null, 2));
const known = new Map();
let protectedProfiles = false, prep;
async function command(exe, args, label, env = process.env, observe = false) {
  const item = { label, command: [exe, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
    log: path.join(out, `${label}.log`) };
  report.commands.push(item); save();
  const fd = fs.openSync(item.log, "wx"); let timer;
  function sample() {
    const file = path.join(out, "player-01.json"); if (!fs.existsSync(file)) return;
    let raw; try { raw = read(file); } catch { return; }
    const all = rows();
    for (const launch of raw.launches) {
      const observed = observeStoryTree(all, launch, known, prep.executable.path);
      if (observed.transient) report.observerTransients.push({ ...observed, at: new Date().toISOString() });
    }
    report.knownProcesses = [...known.values()]; save();
  }
  try {
    const child = spawn(exe, args, { cwd: path.resolve(__dirname, ".."), env,
      windowsHide: true, stdio: ["ignore", fd, fd] });
    item.pid = child.pid; save();
    if (observe) timer = setInterval(() => {
      try { sample(); } catch (error) { report.observerError = String(error.stack || error); save(); }
    }, 3000);
    item.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    item.status = item.exitCode === 0 ? "PASS" : "FAILED";
    if (observe) sample();
    assert.equal(item.exitCode, 0, item.log);
  } catch (error) { item.status = "FAILED"; throw error; }
  finally {
    clearInterval(timer); fs.closeSync(fd); item.finishedAt = new Date().toISOString(); save();
  }
}
async function profile(action) {
  await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out,
    "-CodexCacheView", "-Storage", "NativeRoaming"], `profile-${action.toLowerCase()}`);
}
(async () => {
  save();
  const predecessor = options.binding?.predecessor.path || path.join(base, `${current?"narrative":"abilities"}-audit-${attempt}/report.json`), previous = read(predecessor);
  assert.equal(previous.status, "PASS"); assert(previous.finishedAt && !previous.cleanupError);
  assert.equal(previous.scope, options.explicit
    ? `INSTALLED_${options.version.replaceAll(".", "_")}_INHERITANCE_ANCHORS_QUICK_LIBRARY_AUDIT`
    : current?"INSTALLED_1_9_30_NARRATIVE_EVIDENCE_AUDIT_NOT_NEW_AUTHOR_EXPORT_OR_ANDROID":"INSTALLED_1_9_24_INHERITANCE_ANCHORS_QUICK_LIBRARY_AUDIT");
  if(current&&!options.explicit)assert(previous.sourceConclusion==="PASS"&&previous.coverageComplete);
  if (options.explicit) {
    assert.equal(previous.checks.length, 4); assert(previous.checks.every(c => c.status === "PASS"));
    report.candidateBinding = { ...desc(options.bindingFile), value: options.binding };
  }
  report.predecessor = desc(predecessor);
  const installation = desc(options.installation), installed = read(installation.path);
  const originalExport = desc(options.exported);
  const exported = read(originalExport.path);
  const input = path.join(out, "快存异常独立测试工程.vnproj");
  fs.copyFileSync(exported.fixture.input, input, fs.constants.COPYFILE_EXCL);
  const tools = [__filename, "scripts/candidate-1924-quick-flow.cjs",
    "scripts/lib/candidate-1924-quick-adapter.cjs", "scripts/candidate-1924-quick-lock.ps1",
    "scripts/candidate-1924-quick-adapter-test.cjs", "scripts/installed-runtime-quick-gaps-playwright.cjs",
    "scripts/lib/installed-runtime-session.cjs", "scripts/installed-runtime-quick-observation.cjs",
    "scripts/native-runtime-quick-audit.cjs", "scripts/lib/runtime-story-observer.cjs",
    "scripts/lib/current-native-capture.cjs", "scripts/lib/current-native-editor-session.cjs",
    "scripts/lib/wait-native-runtime-page.cjs",
    "scripts/native-dev-preview-profile.ps1"].map(desc);
  prep = { status: "PASS", scope: report.scope, sessionRoot: out, installation, originalExport,
    ...(current?{candidateVersion:options.version}:{}),
    originalFixture: desc(path.join(exported.out, "fixture.json")),
    executable: installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),
    fixture: { ...exported.fixture, input }, cartridges: exported.cartridges, tools,
    defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
    installId: `qa_quick_${options.stamp}_${attempt}`, webview: path.join(out, "webview"),
    temporary: path.join(out, "temporary"), profiles: [] };
  validateCandidateQuickPreparation(prep, out);
  for (const item of tools) {
    item.copy = path.join(out, "tools", path.relative(path.resolve(__dirname, ".."), item.path));
    fs.mkdirSync(path.dirname(item.copy), { recursive: true });
    fs.copyFileSync(item.path, item.copy, fs.constants.COPYFILE_EXCL);
  }
  Object.assign(report, { installation, executable: prep.executable, originalExport,
    originalFixture: prep.originalFixture, fixture: prep.fixture, cartridges: prep.cartridges, tools });
  report.environment = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out }; save();
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  fs.mkdirSync(prep.temporary); protectedProfiles = true; await profile("Prepare");
  const journal = read(path.join(out, "profile-protection.json"));
  prep.profiles = journal.records.filter(p => p.existed); prep.allProfiles = journal.records;
  const file = path.join(out, "preparation.json");
  fs.writeFileSync(file, JSON.stringify(prep, null, 2), { flag: "wx" }); report.preparation = desc(file); save();
  await command(process.execPath, ["scripts/candidate-1924-quick-flow.cjs", "--current-native-preparation", file],
    "quick", { ...process.env, ...report.environment, TEMP: prep.temporary, TMP: prep.temporary }, true);
  const rawFile = path.join(out, "player-01.json"), raw = read(rawFile);
  validateCandidateQuickReport(raw, prep);
  assert(raw.finishedAt && !report.observerError);
  report.raw = desc(rawFile); report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  try {
    assert(!rows().some(p => p.Name === "agentvn-player.exe" ||
      p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
    const rawFile = path.join(out, "player-01.json");
    if (fs.existsSync(rawFile)) {
      const raw = read(rawFile); report.raw = desc(rawFile);
      assert(raw.finishedAt && !raw.cleanupError);
      assert(raw.locks.every(l => l.cleanup === "PASS") && raw.faults.every(f => f.restoration === "PASS"));
      report.absentPorts = raw.launches.map(l => l.port); assert.deepEqual(listeners(report.absentPorts), []);
    }
    if (protectedProfiles && fs.existsSync(path.join(out, "profile-protection.json"))) {
      await profile("Restore"); report.restoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.restoration.path).status, "PASS");
    }
    if (prep) validateCandidateQuickPreparation(prep, out);
    const all = rows();
    for (const item of known.values())
      assert(!all.some(p => p.ProcessId === item.ProcessId && p.Created === item.Created));
  } catch (error) {
    report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
