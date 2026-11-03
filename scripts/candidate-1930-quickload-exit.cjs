"use strict";
// Bind the existing same-command/history exit regression to the current NSIS Player.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const root = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const originalFile = path.join(__dirname, "editor-quickload-installed-player.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
const bindingFile = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG;
const binding = bindingFile ? read(bindingFile) : null;
const config = binding
  ? require("./candidate-layout-consumption.cjs").validateCandidateConfig(read(binding.candidateConfig.path)) : null;
const version = config?.version || "1.9.30", stamp = version.replaceAll(".", "");
const base = config?.qa || "F:/AgentVN/QA/Editor-1.9.30-20261026-01";
const receipt = binding?.installation.path || path.join(base, "derived-components-installation-01.json");
function build(original) {
  let source = original; const changes = [];
  function one(before, after) {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after); changes.push({ before, after });
  }
  one('const installationFile = "F:/AgentVN/QA/Editor-1.9.25-20261025-01/installation.json";',
    `const installationFile = ${JSON.stringify(receipt)};`);
  one('assert.equal(installation.status, "PASS"); assert.equal(installation.executable.version, "1.9.25");',
    'require("./candidate-1930-exit.cjs").validateInstallation(installationFile);');
  one('candidateVersion: "1.9.25",', `candidateVersion: "${version}",`);
  one('qa_installed_1925_${attempt}_${Number(branch)}', `qa_installed_${stamp}_\${attempt}_\${Number(branch)}`);
  one('function validatePreparation(value) {',
    'report.tools = tools; report.installation = desc(installationFile);\nfunction validatePreparation(value) {');
  if (binding) {
    one('require("./lib/dev-narrative-player.cjs");', 'require("./candidate-1930-quickload-exit.cjs").narrative();');
    one('const tools = [__filename, path.join(root, "scripts/lib/dev-narrative-player.cjs"),',
      'const tools = [__filename, path.join(root, "scripts/candidate-1930-quickload-exit.cjs"),\n' +
      '  path.join(root, "scripts/lib/wait-native-runtime-page.cjs"), path.join(root, "scripts/lib/dev-narrative-player.cjs"),');
  }
  new vm.Script(Module.wrap(source));
  return { source, changes };
}
function buildNarrative(original) {
  let source = original;
  const changes = [];
  for (const [before, after] of [
    ['    this.page = this.browser.contexts().flatMap(c => c.pages()).find(p => /tauri\\.localhost/.test(p.url())); assert(this.page);',
      '    this.launch.targetReadiness = { events: [] }; this.save();\n' +
      '    this.page = await require("./wait-native-runtime-page.cjs").waitNativeRuntimePage(this.browser, {\n' +
      '      observe: event => { this.launch.targetReadiness.events.push(event); this.save(); }\n' +
      '    });\n    this.launch.targetReadiness.readyAt = new Date().toISOString(); this.save();'],
    ['    this.report.knownProcesses = [...this.known.values()]; this.save();',
      '    this.launch.knownProcesses = [...this.known.values()];\n' +
      '    this.report.knownProcesses = [...this.known.values()]; this.save();'],
  ]) {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after); changes.push({ before, after });
  }
  new vm.Script(Module.wrap(source));
  return { source, changes };
}
function narrative() {
  const file = path.join(__dirname, "lib/dev-narrative-player.cjs");
  const built = buildNarrative(fs.readFileSync(file, "utf8"));
  const worker = new Module(file, module); worker.filename = file;
  worker.paths = Module._nodeModulePaths(path.dirname(file)); worker._compile(built.source, file);
  return worker.exports;
}
function validateBusiness(r, expectedVersion = version) {
  assert.equal(r.status, "PASS"); assert.equal(r.candidateVersion, expectedVersion);
  assert(r.finishedAt && !r.error && !r.cleanupError && !r.observerError);
  assert.equal(r.scope, "CURRENT_INSTALLED_RELEASE_QUICKLOAD_EXIT_NOT_ANDROID");
  assert.equal(r.modelRequests, 0); assert.equal(r.productChanges, 0); assert.deepEqual(r.pageErrors, []);
  assert.equal(r.cleanup, "PASS"); assert.equal(r.profileRestore, "PASS");
  assert.deepEqual(r.cells.map(c => c.name), ["quickload-direct-exit", "quickload-branch-loop-exit"]);
  for (const [i, c] of r.cells.entries()) {
    assert.equal(c.status, "PASS"); assert.equal(c.exits.length, 2);
    assert(c.exits.every(e => e.pid > 0 && e.elapsedMs >= 0 && e.elapsedMs <= 15000));
    assert.deepEqual(c.first, c.before); assert.equal(c.before.command, 0);
    assert.equal(c.expectedHistory.length, i + 1);
    for (const key of ["afterExit", "afterRestartExit"]) {
      assert(c[key].some(f => f.data.save_kind === "auto"
        && f.data.scene_id === c.before.scene && f.data.command_index === c.before.command
        && JSON.stringify(f.data.history.map(h => h.text)) === JSON.stringify(c.expectedHistory)));
    }
  }
  assert.equal(r.launches.length, 4); assert.equal(r.screenshots.length, 4);
  for (const l of r.launches) {
    assert.equal(l.layout, "renpy");
    assert.equal(l.cleanup.status, "PASS");
    assert.equal(l.cleanup.method, "PROCESS_ALREADY_EXITED_BEFORE_CLEANUP");
  }
  return { flows: 2, naturalExits: 4, sameCommandHistoryCounts: r.cells.map(c => c.expectedHistory.length),
    layouts: ["renpy"], fullDisplayMatrixOrAndroidClaimed: false };
}
function selfTest() {
  const original = fs.readFileSync(originalFile, "utf8"), built = build(original);
  let rejected = 0;
  for (const c of built.changes) {
    assert.throws(() => build(original.replace(c.before, ""))); rejected++;
  }
  if (binding) {
    assert.equal(require(__filename).narrative, narrative, "Main entry must expose its adapter before compiling business");
    const original = fs.readFileSync(path.join(__dirname, "lib/dev-narrative-player.cjs"), "utf8");
    for (const c of buildNarrative(original).changes) {
      assert.throws(() => buildNarrative(original.replace(c.before, ""))); rejected++;
    }
    const { NarrativePlayer } = narrative(), prep = { constructorGuard: true };
    let validated = false;
    const idle = new NarrativePlayer(prep, {}, () => {}, value => {
      assert.equal(value, prep); validated = true;
    });
    assert(validated); assert.equal(idle.child, undefined);
  }
  const historical = read(path.join(root, "quickload-exit-20261025-03/report.json"));
  validateBusiness(historical, "1.9.25");
  for (const mutate of [
    r => r.status = "RUNNING", r => r.finishedAt = null, r => r.cells = [],
    r => r.cells[1].expectedHistory.pop(), r => r.cells[1].before.command = 1,
    r => r.cells[1].afterExit = [], r => r.cells[1].afterRestartExit = [],
    r => r.cells[1].afterExit.filter(f => f.data.save_kind === "auto").forEach(f => f.data.history = []),
    r => r.launches[0].cleanup.method = "FORCED", r => r.screenshots.pop(),
    r => r.profileRestore = "FAILED", r => r.pageErrors.push("error"),
  ]) {
    const bad = structuredClone(historical); mutate(bad);
    assert.throws(() => validateBusiness(bad, "1.9.25")); rejected++;
  }
  console.log(JSON.stringify({ status: "PASS", rejected, historicalFixtureOnly: true, nativeApps: 0, modelRequests: 0 }));
}
function audit(attempt, auditAttempt) {
  const source = path.join(root, `quickload-exit-20261025-${attempt}`);
  const out = path.join(base, `quickload-exit-audit-${attempt}-${auditAttempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
    scope: `INSTALLED_${stamp}_RENPY_SAME_COMMAND_QUICKLOAD_EXIT_NOT_STANDALONE_OR_ANDROID`,
    productChanges: 0, builds: 0, modelRequests: 0 };
  const check = (name, fn) => {
    const c = { name, status: "RUNNING" }; report.checks.push(c);
    try { c.detail = fn(); c.status = "PASS"; }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  };
  try {
    report.input = desc(path.join(source, "report.json")); const r = read(report.input.path);
    check("Same scene/command but distinct histories are written before four natural exits", () => validateBusiness(r));
    check("Current installation, archived execution and untouched actual UI cartridge", () => {
      const installed = require("./candidate-1930-exit.cjs").validateInstallation(r.installation.path);
      assert.equal(sha(r.installation.path), r.installation.sha256);
      const player = installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
      for (const f of [r.prep.executable, r.prep.cartridge, r.prep.installation, ...r.tools]) assert.equal(sha(f.path), f.sha256);
      for (const l of r.launches) {
        assert.equal(path.resolve(l.executable.path), path.resolve(player.path));
        assert.equal(l.executable.sha256, player.sha256);
      }
      const prep = path.join(base, `quickload-exit-preparation-${attempt}`), binding = read(path.join(prep, "binding.json"));
      for (const f of [binding.original, binding.adapter, binding.executed]) assert.equal(sha(f.path), f.sha256);
      if (binding.candidateBinding) {
        assert.equal(sha(binding.candidateBinding.path), binding.candidateBinding.sha256);
        assert.deepEqual(binding.candidateBinding.value, read(binding.candidateBinding.path));
      }
      const built = build(fs.readFileSync(originalFile, "utf8"));
      assert.deepEqual(built.changes, binding.changes);
      assert.equal(fs.readFileSync(binding.executed.path, "utf8"), built.source);
      if (binding.narrative) {
        for (const f of [binding.narrative.original, binding.narrative.executed])
          assert.equal(sha(f.path), f.sha256);
        const adapted = buildNarrative(fs.readFileSync(binding.narrative.original.path, "utf8"));
        assert.deepEqual(adapted.changes, binding.narrative.changes);
        assert.equal(fs.readFileSync(binding.narrative.executed.path, "utf8"), adapted.source);
      }
      return { installedPlayer: player, sourceCartridge: r.prep.cartridge, newAuthorExportClaimed: false };
    });
    check("Archived physical disk bytes contain the final complete snapshot and real capture parameters", () => {
      for (const c of r.cells) {
        for (const [key, suffix] of [["afterExit", "after-exit"], ["afterRestartExit", "after-restart-exit"]])
          assert.deepEqual(read(path.join(source, `${c.name}-${suffix}.json`)), c[key]);
        const l = r.launches.find(l => l.cell === c.name);
        for (const f of c.afterRestartExit) {
          const retained = path.join(source, "player-roaming/saves", l.installId, path.basename(f.path));
          assert.equal(sha(retained), f.sha256); assert.deepEqual(read(retained), f.data);
        }
      }
      for (const shot of r.screenshots) {
        assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
        const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
        validateNativeViewport(shot.before, expected); validateNativeViewport(shot.after, expected);
        const bytes = fs.readFileSync(shot.path);
        assert.equal(bytes.readUInt32BE(16), 1920); assert.equal(bytes.readUInt32BE(20), 1080);
      }
      return { diskSnapshots: 4, screenshots: 4, restoredHistoryOnReopen: true };
    });
    check("Original physical profile identities/bytes restored and all owned processes/ports ended", () => {
      const protectedState = read(path.join(source, "profile-protection.json"));
      const restored = read(path.join(source, "profile-restoration.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      for (const p of protectedState.records) {
        assert(!fs.existsSync(p.held)); const row = restored.restored.find(v => v.original === p.original); assert(row);
        assert.equal(row.directoryId, p.directoryId);
        if (p.existed) assert(ps(`fsutil file queryfileid '${p.original}';if($LASTEXITCODE){throw 'File id query failed'}`).includes(p.directoryId));
        for (const f of p.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
      }
      const all = rows(); assert(r.knownProcesses.length > 0);
      for (const p of r.knownProcesses) assert(!all.some(x => x.ProcessId === p.ProcessId && x.Created === p.Created));
      if (binding) for (const l of r.launches) {
        assert(l.targetReadiness.readyAt && l.targetReadiness.events.length);
        assert.equal(l.targetReadiness.events.at(-1).candidates, 1);
        assert(l.knownProcesses.length);
        for (const p of l.knownProcesses) assert(!all.some(x => x.ProcessId === p.ProcessId && x.Created === p.Created));
      }
      assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
      return { profiles: protectedState.records.length, userFilesDeleted: 0, survivors: 0 };
    });
    assert.equal(sha(report.input.path), report.input.sha256); report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
  }
}
module.exports = { build, validateBusiness, buildNarrative, narrative };
if (require.main === module) {
  if (process.argv[2] === "--self-test") selfTest();
  else {
    const [mode, attempt, auditAttempt] = process.argv.slice(2);
    assert(["run", "audit"].includes(mode)); assert.match(attempt || "", /^\d{2}$/);
    if (mode === "audit") { assert.match(auditAttempt || "", /^\d{2}$/); audit(attempt, auditAttempt); }
    else {
      require("./candidate-1930-exit.cjs").validateInstallation(receipt);
      if (binding) {
        const predecessor = read(path.join(base, `exit-audit-${version.split(".").at(-1)}/report.json`));
        assert.equal(predecessor.status, "PASS");
        assert.equal(predecessor.checks.length, 3); assert(predecessor.finishedAt && !predecessor.error);
      }
      assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
      const prep = path.join(base, `quickload-exit-preparation-${attempt}`); assert(!fs.existsSync(prep)); fs.mkdirSync(prep);
      const built = build(fs.readFileSync(originalFile, "utf8")), executed = path.join(prep, "executed-quickload-exit.cjs");
      fs.writeFileSync(executed, built.source, { flag: "wx" });
      let narrativeInput;
      if (binding) {
        const original = path.join(__dirname, "lib/dev-narrative-player.cjs");
        const built = buildNarrative(fs.readFileSync(original, "utf8")), executed = path.join(prep, "executed-narrative.cjs");
        fs.writeFileSync(executed, built.source, { flag: "wx" });
        narrativeInput = { original: desc(original), executed: desc(executed), changes: built.changes };
      }
      fs.writeFileSync(path.join(prep, "binding.json"), JSON.stringify({
        original: desc(originalFile), adapter: desc(__filename), executed: desc(executed), changes: built.changes,
        ...(binding ? { candidateBinding: { ...desc(bindingFile), value: binding } } : {}),
        ...(narrativeInput ? { narrative: narrativeInput } : {}),
      }, null, 2), { flag: "wx" });
      process.argv.splice(2, process.argv.length - 2, attempt);
      const worker = new Module(originalFile, module); worker.filename = originalFile;
      worker.paths = Module._nodeModulePaths(__dirname); worker._compile(built.source, originalFile);
    }
  }
}
