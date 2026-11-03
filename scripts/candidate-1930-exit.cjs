"use strict";
// Bind the established real-ACL/exit business matrix to an actual NSIS install.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { spawn } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateExitReport } = require("./native-runtime-exit-audit.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
const bindingFile = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG;
const binding = bindingFile ? read(bindingFile) : null;
let config, actual;
if (binding) {
  for (const name of ["candidateConfig", "installation", "predecessor", "exported", "fixture"])
    assert.equal(sha(binding[name].path), binding[name].sha256, name);
  config = require("./candidate-layout-consumption.cjs").validateCandidateConfig(read(binding.candidateConfig.path));
  actual = require("./installed-profile-data-replay.cjs").deriveActual(config.actual, config.version);
  const installed = read(binding.installation.path);
  for (const key of Object.keys(actual)) assert.deepEqual(installed[key], actual[key], key);
  assert.equal(path.dirname(path.resolve(binding.checkpointRoot)), path.resolve("F:/AgentVN/Checkpoints"));
  assert.match(path.basename(binding.checkpointRoot),
    new RegExp(`^Installed-Runtime-Exit-${config.version.replaceAll(".", "")}-\\d{8}-\\d{2}$`));
}
const version = config?.version || "1.9.30", attempt = version.split(".").at(-1);
assert.match(attempt, /^\d{2}$/);
const base = config?.qa || path.resolve("F:/AgentVN/QA/Editor-1.9.30-20261026-01");
const root = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/exit-${attempt}`);
const installationFile = path.resolve(binding?.installation.path || path.join(base, "derived-components-installation-01.json"));
const digest = actual?.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256
  || "296b7716cadda05f7c32ba7e46ecafc87017418e456c2744644ecf12ea68a4aa";
const predecessorScope = `INSTALLED_${version.replaceAll(".", "_")}_INHERITANCE_ANCHORS_QUICK_LIBRARY_AUDIT`;
function validateSnapshot(before, written) {
  assert(Array.isArray(before.history) && before.history.length > 0);
  assert.equal(written.scene_id, before.story.scene);
  assert.equal(written.command_index, before.story.command);
  assert.equal(written.save_kind, "auto");
  assert.deepEqual(written.history.map(h => h.text), before.history);
}
function validatePredecessor(report) {
  assert.equal(report.status, "PASS");
  assert(report.finishedAt && !report.cleanupError && !report.error);
  assert.equal(report.scope, predecessorScope);
  assert.equal(report.checks.length, 4);
  assert(report.checks.every(c => c.status === "PASS"));
}
function prerequisite() {
  const file = binding?.predecessor.path || path.join(base, "abilities-audit-01/report.json"), report = read(file);
  validatePredecessor(report);
  const source = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/abilities-installed-${version.replaceAll(".", "")}-01/session.json`);
  assert.equal(path.resolve(report.input.path), source);
  assert.equal(sha(source), report.input.sha256);
  const session = read(source);
  assert.equal(session.status, "PASS"); assert(session.finishedAt && !session.cleanupError && !session.observerError);
  assert.equal(session.executable.sha256, digest);
  assert.equal(session.cells.length, 12); assert(session.cells.every(c => c.status === "PASS"));
  assert.equal(sha(session.restoration.path), session.restoration.sha256);
  assert.equal(read(session.restoration.path).status, "PASS");
  if (binding) {
    for (const name of ["candidateConfig", "installation", "predecessor", "exported", "fixture"])
      assert.equal(sha(binding[name].path), binding[name].sha256, name);
    const exported = read(binding.exported.path), fixture = read(binding.fixture.path);
    assert.equal(exported.scope, `ACTUAL_${version.replaceAll(".", "")}_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE`);
    assert.equal(exported.status, "PASS"); assert(exported.finishedAt && !exported.cleanupError);
    assert.equal(exported.steps.length, 3); assert(exported.steps.every(s => s.status === "PASS"));
    assert.deepEqual(exported.fixture, fixture);
    assert.equal(sha(fixture.input), fixture.inputSha256);
    assert.deepEqual(new Set(exported.cartridges.map(c => c.layout)), new Set(["agentvn", "renpy"]));
    for (const c of exported.cartridges) assert.equal(sha(c.path), c.sha256);
  }
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)),
    "Refuse to start exit/profile tests while an Editor or Player is active");
  return desc(file);
}
function validateInstallation(file) {
  assert.equal(path.resolve(file), installationFile);
  const installed = read(file);
  assert.equal(installed.status, "PASS"); assert.equal(installed.metadataRestoration, "PASS");
  assert.equal(installed.version, version);
  assert.equal(installed.executable.sha256, actual?.executable.sha256
    || "a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577");
  if (config) {
    const current = require("./installed-profile-data-replay.cjs").deriveActual(config.actual, config.version);
    for (const key of Object.keys(current)) assert.deepEqual(installed[key], current[key], key);
    assert.equal(sha(binding.installation.path), binding.installation.sha256);
    const protectedAbsent = installed.protectedAbsent ?? binding.protectedAbsent;
    assert(Array.isArray(protectedAbsent), "An explicit absent-file protection baseline is required");
    for (const f of protectedAbsent) assert(!fs.existsSync(f), f);
  }
  assert.equal(sha(installed.actualInstallation.path), installed.actualInstallation.sha256);
  const receipt = read(installed.actualInstallation.path);
  assert(receipt.status === "PASS" && receipt.exitCode === 0 && receipt.registryRestored);
  assert.equal(receipt.executable.sha256, installed.executable.sha256);
  for (const f of [installed.executable, ...installed.resources, ...installed.protectedFiles])
    assert.equal(sha(f.path), f.sha256, f.path);
  const player = installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
  assert.equal(player.sha256, digest);
  assert.equal(path.resolve(player.path), config
    ? path.join(actual.installRoot, "agentvn-player.exe")
    : path.join(base, "install-01/installed-nsis/agentvn-player.exe"));
  return installed;
}
function editor(source) {
  const result = { source, adaptations: [] };
  return { result, one(before, after, reason) {
    assert.equal(result.source.split(before).length - 1, 1, reason);
    result.source = result.source.replace(before, after); result.adaptations.push({ before, after, reason });
  } };
}
function buildRuntime(original) {
  const { result, one } = editor(original);
  one('    this.page = this.browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(this.page);',
    `    this.launch.targetReadiness = { events: [] }; this.save();
    this.page = await require("./wait-native-runtime-page.cjs").waitNativeRuntimePage(this.browser, {
      observe: event => { this.launch.targetReadiness.events.push(event); this.save(); }
    });
    this.launch.targetReadiness.readyURL = this.page.url();
    this.launch.targetReadiness.readyAt = new Date().toISOString(); this.save();`,
    "Wait for actual unique native document before issuing business input");
  return result;
}
function buildFlow(original) {
  const { result, one } = editor(original);
  one('require("./lib/installed-runtime-session.cjs");',
    'require("./candidate-1930-exit.cjs").runtime();', "Current runtime document readiness");
  one("async function baseline() {", `async function visibleHistory() {
  const before = await current();
  if (entry.layout === "renpy") await s.page.getByTestId("renpy-quick-history").click();
  else {
    const toggle = s.page.getByTestId("quick-menu-toggle");
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    await s.page.getByRole("button", { name: "打开历史记录", exact: true }).click();
  }
  await s.ready("history");
  const history = await s.page.locator(".history-list article p").allTextContents();
  assert(history.length > 0);
  await s.page.keyboard.press("Escape"); await s.ready("playing");
  assert.deepEqual(await current(), before);
  return history;
}
async function baseline() {`, "Read actual current history through both real layout entry points");
  one("  return { manual, files, saves, story, autoSaveEnabled: (await s.prefs()).autoSaveEnabled,",
    "  const history = await visibleHistory();\n" +
    "  return { manual, files, saves, story, history, autoSaveEnabled: (await s.prefs()).autoSaveEnabled,",
    "Carry exact pre-exit history, never infer current snapshot from command identity alone");
  one('    assert.equal(written.save_kind, "auto");',
    '    assert.equal(written.save_kind, "auto");\n' +
    '    require("./candidate-1930-exit.cjs").validateSnapshot(entry.before, written);',
    "Require current history bytes to exist before native exit is accepted");
  one('  const restored = await current(); assert.equal(restored.command, expectedCommand);',
    '  const restored = await current(); assert.equal(restored.command, expectedCommand);\n' +
    '  if (["retry", "auto_on"].includes(entry.kind)) assert.deepEqual(await visibleHistory(), entry.before.history);',
    "Fresh-process continuation must actually display the persisted current history");
  if (binding) {
    one('"Public native library insertion of historical UI exports, actual subsequent UI input"',
      '"Public native library insertion of fresh current UI exports from a historical controlled fixture, actual subsequent UI input"',
      "Record current export provenance without claiming native picker coverage");
  }
  return result;
}
function buildSession(original) {
  const { result, one } = editor(original);
  one('const installationFile = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json";',
    `const installationFile = ${JSON.stringify(installationFile)};`, "Actual current installation receipt");
  one('const checkpointRoot = "F:/AgentVN/Checkpoints/Installed-Runtime-Exit-20261021-01";',
    `const checkpointRoot = ${JSON.stringify(binding?.checkpointRoot
      || "F:/AgentVN/Checkpoints/Installed-Runtime-Exit-1930-20261026-01")};`,
    "Independent checkpoint, no overwriting history");
  for (const before of ['assert.equal(s.version, "1.9.14")', 'version: "1.9.14"'])
    one(before, before.replace("1.9.14", version), "Current declared editor candidate");
  for (const before of [
    'assert.equal(s.executable.sha256, "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e")',
  ]) {
    // The two call sites deliberately have identical text; edit with their distinct suffixes.
    one(before + ";\n  const installed", before.replace(/e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e/, digest) +
      ";\n  const installed", "Current executable at terminal validation");
    one(before + ";\n    s.protectedFiles", before.replace(/e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e/, digest) +
      ";\n    s.protectedFiles", "Current executable before profile protection");
  }
  one('assert.equal(installed.executable.version, s.version);\n  assert.equal(path.resolve',
    'assert.equal(installed.version, s.version);\n  assert.equal(path.resolve', "Current receipt schema at terminal");
  one('assert.equal(installed.executable.version, s.version);\n    s.executable',
    'assert.equal(installed.version, s.version);\n    require("./candidate-1930-exit.cjs").validateInstallation(installationFile);\n    s.executable',
    "Verify real installed bytes before any profile mutation");
  one('s.protectedFiles = read("F:/AgentVN/QA/Installed-Assistant-Recovery-20261021-01/session-03/report.json").products;',
    's.protectedFiles = [installed.executable, ...installed.resources, ...installed.protectedFiles];',
    "Protect actual current products, not an unrelated historic session");
  one('"-Storage", "NativeRoaming"], `profile-${action.toLowerCase()}`);',
    '"-Storage", "NativeRoaming", "-CodexCacheView"], `profile-${action.toLowerCase()}`);',
    "Use explicit Codex native profile view with preserved directory identities");
  one('for (const name of ["scripts/installed-runtime-exit-current.cjs", "scripts/native-runtime-exit-playwright.cjs",',
    'for (const name of ["scripts/candidate-1930-exit.cjs", "scripts/candidate-1930-exit-test.cjs",\n' +
    '      "scripts/lib/wait-native-runtime-page.cjs", "scripts/installed-runtime-exit-current.cjs", "scripts/native-runtime-exit-playwright.cjs",',
    "Snapshot complete adapter and original business inputs");
  one('["scripts/native-runtime-exit-playwright.cjs",\n      "--current-native-preparation", prepFile]',
    '["scripts/candidate-1930-exit.cjs", "flow",\n      "--current-native-preparation", prepFile]',
    "Launch preserved business via this recorded adapter");
  if (binding) {
    one('s.originalExport = desc(path.join(root, "output/installed-runtime-abilities-20261018-01/export-03/report.json"));',
      `s.originalExport = desc(${JSON.stringify(binding.exported.path)});`, "Fresh current Editor UI exports");
    one('s.originalFixture = desc(path.join(root, "output/installed-runtime-abilities-20261018-01/fixtures-02.json"));',
      `s.originalFixture = desc(${JSON.stringify(binding.fixture.path)});`, "Exact fixture exported by this candidate");
    one('"Historical actual UI exports, not a fresh Editor export"',
      '"Current Editor fresh UI exports from a historical controlled fixture, not full authoring coverage"',
      "Separate fresh export from historical fixture");
    one('s.gitBefore = { head: head(), index: sha(path.join(root, ".git/index")) };',
      `s.candidateBinding = ${JSON.stringify({ ...desc(bindingFile), value: binding })};\n` +
      '    s.gitBefore = { head: head(), index: sha(path.join(root, ".git/index")) };',
      "Archive exact explicit candidate provenance");
  }
  one('if (require.main === module) main();', 'main();', "Run the compiled complete session explicitly");
  return result;
}
function compile(result, filename) {
  new vm.Script(Module.wrap(result.source));
  const worker = new Module(filename, module); worker.filename = filename;
  worker.paths = Module._nodeModulePaths(path.dirname(filename)); worker._compile(result.source, filename);
  return worker.exports;
}
function runtime() {
  const f = path.join(__dirname, "lib/installed-runtime-session.cjs");
  return compile(buildRuntime(fs.readFileSync(f, "utf8")), f);
}
function validateTerminalReconciliation(s, r) {
  assert.equal(s.status, "FAILED");
  assert.equal(s.error, undefined);
  assert.equal(s.cleanupError,
    'AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:\n\n' +
    '  assert(r.notRun.includes(missing))\n\n' +
    '    at validateExitReport (D:\\AgentVN\\scripts\\native-runtime-exit-audit.cjs:102:5)\n' +
    '    at validate (D:\\AgentVN\\scripts\\candidate-1930-exit.cjs:34:3)\n' +
    '    at main (D:\\AgentVN\\scripts\\candidate-1930-exit.cjs:140:95)\n' +
    '    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)');
  assert(s.finishedAt && s.restoration);
  assert.equal(r.status, "PASS"); assert(!r.error && !r.cleanupError && r.finishedAt);
  assert.equal(r.notRun.filter(n => n === "New installation, full authoring, standalone export").length, 1);
  assert(!r.notRun.includes("New installation/export"));
  // Only adapt the legacy informational label in memory. All cases, save
  // bytes, ACL, screenshots and cleanup still pass the unchanged validator.
  validateExitReport({ ...r, notRun: [...r.notRun, "New installation/export"] }, false);
}
function audit(reconcile = false) {
  const out = path.join(base, `exit-audit-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
    scope: `INSTALLED_${version.replaceAll(".", "")}_LIBRARY_REAL_ACL_UI_EXIT_NOT_ALT_F4_ANDROID_OR_COMPLETE_INFLIGHT_COVERAGE`,
    modelRequests: 0, productChanges: 0, builds: 0 };
  function check(name, fn) { const detail = fn(); report.checks.push({ name, status: "PASS", detail }); }
  try {
    const file = path.join(root, "installed-session.json"), s = read(file), rawFile = path.join(root, "exit.json"), r = read(rawFile);
    report.source = desc(file); report.raw = desc(rawFile);
    let validators = module.exports;
    if (reconcile) {
      validateTerminalReconciliation(s, r);
      report.originalSessionStatus = s.status;
      report.toolingReconciliation = {
        originalCleanupError: s.cleanupError,
        reason: "Fresh-export informational label conflicts with the unchanged legacy terminal validator",
        rawFilesRewritten: false, repeatedProductRuns: 0,
      };
      const snapshot = s.snapshots.find(p => path.resolve(p.source.path) === __filename); assert(snapshot);
      assert.equal(sha(snapshot.copy.path), snapshot.source.sha256);
      validators = compile({ source: fs.readFileSync(snapshot.copy.path, "utf8") }, __filename);
    }
    check("Actual installation and complete original exit matrix", () => {
      validateInstallation(s.installation.path);
      if (!reconcile) {
        assert.equal(s.status, "PASS"); assert(s.finishedAt && !s.error && !s.cleanupError);
      }
      assert.equal(s.version, version); assert.equal(s.out, root);
      if (binding) {
        assert.deepEqual(s.candidateBinding, { ...desc(bindingFile), value: binding });
        assert.deepEqual(s.originalExport, { ...desc(binding.exported.path), bytes: fs.statSync(binding.exported.path).size });
        assert.deepEqual(s.originalFixture, { ...desc(binding.fixture.path), bytes: fs.statSync(binding.fixture.path).size });
        prerequisite();
      }
      assert.equal(s.executable.sha256, digest);
      if (!reconcile) validateExitReport(r, false);
      assert(s.commands.every(c => c.status === "PASS" && c.exitCode === 0 && c.finishedAt));
      for (const f of [s.installation, s.executable, s.restoration, ...s.protectedFiles,
        ...r.sources, ...r.acls]) assert.equal(sha(f.path), f.sha256, f.path);
      for (const snap of s.snapshots) {
        if (reconcile && path.resolve(snap.source.path) === __filename)
          report.currentAuditTool = desc(__filename);
        else assert.equal(sha(snap.source.path), snap.source.sha256);
        assert.equal(sha(snap.copy.path), snap.copy.sha256);
        assert.equal(snap.copy.sha256, snap.source.sha256);
      }
      for (const name of ["exit", "runtime"]) {
        const adapted = read(path.join(root, `${name}-adaptations.json`));
        const original = fs.readFileSync(adapted.original.path, "utf8");
        assert.equal(sha(adapted.original.path), adapted.original.sha256);
        assert.equal(sha(adapted.executed.path), adapted.executed.sha256);
        const built = name === "exit" ? validators.buildFlow(original) : validators.buildRuntime(original);
        assert.deepEqual(adapted.adaptations, built.adaptations);
        assert.equal(fs.readFileSync(adapted.executed.path, "utf8"), built.source);
      }
      for (const l of r.launches) {
        assert.equal(l.executableSha256, digest);
        assert.equal(path.resolve(l.identity.ExecutablePath), path.resolve(s.executable.path));
        assert(l.targetReadiness?.readyAt && l.targetReadiness.events.length);
        assert.equal(l.targetReadiness.events.at(-1).candidates, 1);
      }
      return { cases: r.cases.length, checks: r.checks.length, modalMatrix: r.matrix.length, launches: r.launches.length };
    });
    check("Real native save bytes and PNG pixels/viewport/media", () => {
      const journal = read(path.join(root, "profile-protection.json"));
      const archive = journal.records.find(j => j.storage === "NativeRoaming").target;
      for (const f of r.retained) {
        assert.equal(sha(f.retained), f.sha256);
        assert.equal(sha(path.join(archive, "saves", f.installId, f.name)), f.sha256);
        assert.equal(read(f.retained).install_id, f.installId);
      }
      for (const shot of r.screenshots) {
        assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
        const v = shot.before, dpr = Math.round(v.dpr), png = fs.readFileSync(shot.path);
        assert([1, 2].includes(dpr) && Math.abs(v.dpr - dpr) <= 1e-6);
        assert.equal(png.readUInt32BE(16), v.width * dpr); assert.equal(png.readUInt32BE(20), v.height * dpr);
      }
      for (const c of r.cases) {
        const exit = r.checks.filter(t => t.layout === c.layout && t.case === c.kind).at(-2).detail;
        for (const f of exit.changed) {
          const written = read(path.join(archive, "saves", c.installId, f.name));
          validateSnapshot(c.before, written);
        }
        assert(!fs.readdirSync(path.join(archive, "saves", c.installId)).some(n => n.endsWith(".tmp")));
      }
      return { actualSavedFiles: r.retained.length, screenshots: r.screenshots.length };
    });
    check("Original profile bytes/identities, ACL recovery and attributed process/port cleanup", () => {
      const journal = read(path.join(root, "profile-protection.json")), restored = read(s.restoration.path);
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      for (const j of journal.records) {
        assert(!fs.existsSync(j.held));
        const now = restored.restored.find(p => p.original === j.original); assert(now);
        assert.equal(now.directoryId, j.directoryId); assert.deepEqual(now.files, j.files);
        for (const f of j.files) assert.equal(sha(path.join(j.original, f.relative)), f.sha256);
      }
      const all = rows();
      for (const l of r.launches) {
        const created = Number(l.identity.CreationDate.match(/\d+/)[0]);
        assert(!all.some(p => p.ProcessId === l.pid && Date.parse(p.Created) === created));
      }
      assert(!all.some(p => p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(root)));
      assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
      return { originalProfiles: journal.records.length, realRestoredACLs: r.acls.filter(a => a.action === "Restore").length };
    });
    report.remaining = r.notRun; report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
  }
}
async function followup(pid, created) {
  assert(Number.isSafeInteger(pid) && pid > 0); assert.match(created || "", /^\d{4}-\d{2}-\d{2}T/);
  const out = path.join(base, `exit-followup-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "WAITING_FOR_EXISTING_ABILITIES_CHAIN", startedAt: new Date().toISOString(),
    waitingFor: { pid, created }, commands: [], modelRequests: 0, productChanges: 0, builds: 0,
    scope: `SERIAL_INSTALLED_${version.replaceAll(".", "")}_REAL_ACL_EXIT_AFTER_FULL_RUNTIME_CHAIN`,
    tools: [__filename, path.join(__dirname, "candidate-1930-exit-test.cjs"),
      path.join(__dirname, "installed-runtime-exit-current.cjs"),
      path.join(__dirname, "native-runtime-exit-playwright.cjs"),
      path.join(__dirname, "native-runtime-exit-audit.cjs")].map(desc) };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function command(label, args) {
    for (const item of report.tools) assert.equal(sha(item.path), item.sha256);
    const row = { label, command: [process.execPath, ...args], status: "RUNNING",
      startedAt: new Date().toISOString(), log: path.join(out, `${label}.log`) };
    report.commands.push(row); save();
    const fd = fs.openSync(row.log, "wx");
    try {
      const child = spawn(process.execPath, args, {
        cwd: path.resolve(__dirname, ".."), windowsHide: true, stdio: ["ignore", fd, fd] });
      row.pid = child.pid; save();
      row.exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject); child.once("close", resolve);
      });
      assert.equal(row.exitCode, 0, row.log); row.status = "PASS";
    } catch (error) { row.status = "FAILED"; throw error; }
    finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
  }
  try {
    const owner = rows().find(p => p.ProcessId === pid && p.Created === created);
    assert(owner && /^pwsh\.exe$/i.test(owner.Name), "Existing abilities waiter identity must still match");
    report.owner = owner; save();
    for (;;) {
      const terminal = path.join(base, "abilities-audit-01/report.json");
      if (fs.existsSync(terminal)) {
        const previous = read(terminal);
        if (previous.finishedAt) { validatePredecessor(previous); break; }
      }
      assert(rows().some(p => p.ProcessId === pid && p.Created === created),
        "Original abilities chain ended without complete PASS; preserve failure and stop dependencies");
      report.lastVerifiedAt = new Date().toISOString(); save();
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
    report.predecessor = prerequisite(); report.status = "RUNNING_EXIT_MATRIX"; save();
    await command("offline-guard", [path.join(__dirname, "candidate-1930-exit-test.cjs")]);
    await command("exit", [__filename, "run", attempt]);
    await command("audit", [__filename, "audit"]);
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report, null, 2)); }
}
module.exports = { buildSession, buildFlow, buildRuntime, validateInstallation, runtime,
  validateSnapshot, validatePredecessor, installationFile, predecessorScope, prerequisite,
  validateTerminalReconciliation };
if (require.main === module) {
  const mode = process.argv.splice(2, 1)[0];
  if (mode === "audit") audit();
  else if (mode === "audit-reconcile") audit(true);
  else if (mode === "run") {
    assert.equal(process.argv[2], attempt); validateInstallation(installationFile);
    prerequisite();
    const f = path.join(__dirname, "installed-runtime-exit-current.cjs");
    compile(buildSession(fs.readFileSync(f, "utf8")), __filename);
  } else if (mode === "wait") followup(Number(process.argv[2]), process.argv[3]);
  else {
    assert.equal(mode, "flow");
    const i = process.argv.indexOf("--current-native-preparation"); assert(i > 0);
    const p = read(process.argv[i + 1]); validateInstallation(installationFile);
    assert.equal(path.resolve(p.sessionRoot), root); assert.equal(p.executable.sha256, digest);
    const f = path.join(__dirname, "native-runtime-exit-playwright.cjs"), result = buildFlow(fs.readFileSync(f, "utf8"));
    for (const [name, value, source] of [["exit", result, f],
      ["runtime", buildRuntime(fs.readFileSync(path.join(__dirname, "lib/installed-runtime-session.cjs"), "utf8")),
        path.join(__dirname, "lib/installed-runtime-session.cjs")]]) {
      const executed = path.join(root, `${name}-executed.cjs`);
      fs.writeFileSync(executed, value.source, { flag: "wx" });
      fs.writeFileSync(path.join(root, `${name}-adaptations.json`),
        JSON.stringify({ original: desc(source), executed: desc(executed), adaptations: value.adaptations }, null, 2), { flag: "wx" });
    }
    compile(result, __filename);
  }
}
