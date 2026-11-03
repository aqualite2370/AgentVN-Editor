"use strict";
// QA-only binding of unchanged complete menu/settings flows to an explicit NSIS candidate.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows } = require("./lib/current-native-editor-session.cjs");
const current = require("./candidate-1930-exit.cjs");
const options = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG
  ? require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate() : null;
const version = options?.version || "1.9.30";
const base = options?.base || path.resolve("F:/AgentVN/QA/Editor-1.9.30-20261026-01");
const installationFile = options?.installation || path.join(base, "derived-components-installation-01.json");
const oldHash = "e60af7ae12eaead14675ef1a73a1b14771800f23aca4a5dd1e5b41d33b35625e";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const playerHash = options
  ? current.validateInstallation(installationFile).resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256
  : "296b7716cadda05f7c32ba7e46ecafc87017418e456c2744644ecf12ea68a4aa";
function validateBinding(s) {
  assert(options, "An explicit candidate binding is required");
  current.validateInstallation(installationFile);
  assert.equal(s.version, version);
  assert.deepEqual(s.candidateBindings,
    [options.bindingFile, ...["candidateConfig", "installation", "predecessor", "exported", "fixture"]
      .map(k => options.binding[k].path)].map(desc));
  assert.equal(path.resolve(s.originalExport.path), path.resolve(options.binding.exported.path));
  assert.equal(path.resolve(s.originalFixture.path), path.resolve(options.binding.fixture.path));
  assert.equal(s.originalExport.sha256, options.binding.exported.sha256);
  assert.equal(s.originalFixture.sha256, options.binding.fixture.sha256);
  const exported = read(s.originalExport.path), fixture = read(s.originalFixture.path);
  assert.equal(exported.status, "PASS"); assert(exported.finishedAt && !exported.cleanupError);
  assert.equal(exported.scope,
    `ACTUAL_${options.stamp}_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE`);
  assert.deepEqual(exported.fixture, fixture);
  assert.equal(sha(fixture.input), fixture.inputSha256);
  assert.equal(exported.steps.length, 3); assert(exported.steps.every(p => p.status === "PASS"));
  assert.deepEqual(new Set(s.cartridges.map(c => c.layout)), new Set(["agentvn", "renpy"]));
  for (const c of s.cartridges) {
    const original = exported.cartridges.find(p => p.layout === c.layout); assert(original);
    assert.equal(path.resolve(c.historicalSource), path.resolve(original.path));
    assert.equal(c.sha256, original.sha256); assert.equal(sha(c.path), original.sha256);
  }
  if (s.scope === "ACTUAL_NSIS_INSTALLED_PLAYER_ALL17_PREFERENCES")
    assert.deepEqual(s.motionPredecessor, motionPredecessor(path.basename(s.out).slice(-2)));
}
function validateMotionPredecessor(previous, session, raw) {
  assert(previous.finishedAt && !previous.cleanupError);
  assert.equal(previous.scope, "ACTUAL_NSIS_INSTALLED_PLAYER_CORE_MENU_MOTION_NOT_EDITOR_OR_COMPLETE_VISUAL");
  validator("motion")(session, raw);
  assert.equal(previous.session.sha256, sha(previous.session.path));
  assert.equal(previous.raw.sha256, sha(previous.raw.path));
  assert.equal(session.version, version);
  if (previous.status === "PASS") {
    assert(!previous.error && previous.groups.length === 6 && previous.groups.every(g => g.status === "PASS"));
    return "COMPLETE_MOTION_AUDIT_PASS";
  }
  // The regression plan permits independent tests after a preserved failure.
  // This narrowly records the timing evidence gap; it does not relabel it.
  assert.equal(previous.status, "FAILED");
  assert.equal(previous.groups.length, 2);
  assert.equal(previous.groups[0].status, "PASS");
  assert.equal(previous.groups[1].status, "FAILED");
  assert.equal(previous.groups[1].name, "All24 actual display combinations and456 native frame traces reevaluated");
  assert.match(previous.error,
    /^AssertionError \[ERR_ASSERTION\]: playing-to-main-menu-Escape: both real CSS opacity completion events are required\n/);
  return "INDEPENDENT_SETTINGS_ONLY_MOTION_TIMING_AUDIT_REMAINS_FAILED";
}
function motionPredecessor(attempt) {
  assert.match(attempt || "", /^\d{2}$/);
  const source = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-motion-current-${attempt}`);
  const file = path.join(`${source}-audit-01`, "report.json"), previous = read(file);
  assert.equal(path.resolve(previous.session.path), path.join(source, "installed-session.json"));
  assert.equal(path.resolve(previous.raw.path), path.join(source, "motion.json"));
  return { ...desc(file), originalStatus: previous.status,
    decision: validateMotionPredecessor(previous, read(previous.session.path), read(previous.raw.path)) };
}
function edit(source) {
  const result = { source, adaptations: [] };
  return { result, one(before, after, reason) {
    assert.equal(result.source.split(before).length - 1, 1, reason);
    result.source = result.source.replace(before, after); result.adaptations.push({ before, after, reason });
  } };
}
function fileFor(kind, type) {
  assert(["motion", "settings"].includes(kind));
  return path.join(__dirname, type === "flow"
    ? kind === "motion" ? "native-runtime-motion-playwright.cjs" : "installed-runtime-settings-playwright.cjs"
    : `installed-runtime-${kind}-current${type === "audit" ? "-audit" : ""}.cjs`);
}
function buildViewport(original) {
  const { result, one } = edit(original);
  one('  await assert.rejects(original({ evaluate: async () => actual }, expected), /viewport\\/DPR\\/media/);',
    '  assert.equal(await original({ evaluate: async () => actual }, expected), actual);',
    "Current shared capture accepts floating tails and preserves raw actual DPR");
  one('originalExactComparisonFailureReproduced: true, rawDprPreserved: true,',
    'historicalExactFailureRetained: true, currentSharedRawDprAccepted: true, rawDprPreserved: true,',
    "Describe current guard without claiming removed shared behavior is still present");
  return result;
}
function buildSession(kind, original) {
  fileFor(kind, "session"); const { result, one } = edit(original);
  one('const installationFile = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01/installation.json";',
    `const installationFile = ${JSON.stringify(installationFile)};`, "Actual current NSIS receipt");
  const title = kind === "motion" ? "Motion" : "Settings";
  one(`const checkpointRoot = "F:/AgentVN/Checkpoints/Installed-Runtime-${title}-20261021-01";`,
    `const checkpointRoot = ${JSON.stringify(options
      ? `F:/AgentVN/Checkpoints/Installed-Runtime-${title}-${options.stamp}-20261028-01`
      : `F:/AgentVN/Checkpoints/Installed-Runtime-${title}-1930-20261026-01`)};`,
    "Preserve independent recoverable current sources");
  one('assert.equal(s.version, "1.9.14")', `assert.equal(s.version, ${JSON.stringify(version)})`, "Current candidate validation");
  one('version: "1.9.14"', `version: ${JSON.stringify(version)}`, "Current candidate report");
  one(`assert.equal(s.executable.sha256, "${oldHash}");\n  const installed`,
    `assert.equal(s.executable.sha256, "${playerHash}");\n  const installed`, "Current terminal binary");
  one(`assert.equal(s.executable.sha256, "${oldHash}");\n    s.protectedFiles`,
    `assert.equal(s.executable.sha256, "${playerHash}");\n    s.protectedFiles`, "Current initial binary");
  one('assert.equal(installed.executable.version, s.version);\n  assert.equal',
    'assert.equal(installed.version, s.version);\n  assert.equal', "Current terminal receipt schema");
  const init = 'assert.equal(installed.executable.version, s.version);\n    s.executable';
  one(init, 'assert.equal(installed.version, s.version);\n' +
    '    require("./candidate-1930-exit.cjs").validateInstallation(installationFile);\n    s.executable',
    "Verify installer/editor/backend/player bytes before profile mutation");
  const protection = kind === "motion"
    ? 's.protectedFiles = read("F:/AgentVN/QA/Installed-Assistant-Recovery-20261021-01/session-03/report.json").products;'
    : 's.protectedFiles = read(path.join(base, "installed-motion-current-01/installed-session.json")).protectedFiles;';
  one(protection, 's.protectedFiles = [installed.executable, ...installed.resources, ...installed.protectedFiles];',
    "Protect this actual installation rather than historical candidates");
  one('"-Storage", "NativeRoaming"], `profile-${action.toLowerCase()}`);',
    '"-Storage", "NativeRoaming", "-CodexCacheView"], `profile-${action.toLowerCase()}`);',
    "Preserve physical default roaming and actual Codex cache view");
  one(`for (const name of ["scripts/installed-runtime-${kind}-current.cjs",`,
    `for (const name of ["scripts/candidate-1930-menus.cjs", "scripts/candidate-1930-menus-test.cjs",\n` +
    `      "scripts/candidate-1930-exit.cjs", "scripts/installed-runtime-${kind}-current.cjs",`,
    "Archive all candidate adapters and unchanged business sources");
  one(`["scripts/${path.basename(fileFor(kind, "flow"))}",\n      "--current-native-preparation", prepFile]`,
    `["scripts/candidate-1930-menus.cjs", "flow", "${kind}",\n      "--current-native-preparation", prepFile]`,
    "Run complete preserved flow through current binding");
  one('for (const g of guards) await command(process.execPath, [`scripts/${g}`], `guard-${g}`);',
    'for (const g of guards) await command(process.execPath, g === "native-runtime-state-viewport-test.cjs"\n' +
    '      ? ["scripts/candidate-1930-menus.cjs", "viewport", "motion"] : [`scripts/${g}`], `guard-${g}`);',
    "Run the complete current viewport guard while preserving historical test source");
  if (options) {
    one('s.originalExport = desc(path.join(root, "output/installed-runtime-abilities-20261018-01/export-03/report.json"));',
      `s.originalExport = desc(${JSON.stringify(options.binding.exported.path)});`,
      "Fresh current installed Editor export, not a historical cartridge");
    one('s.originalFixture = desc(path.join(root, "output/installed-runtime-abilities-20261018-01/fixtures-02.json"));',
      `s.originalFixture = desc(${JSON.stringify(options.binding.fixture.path)});`,
      "Exact fixture of the fresh current export");
    one(kind === "motion" ? 'Historical actual UI exports, not fresh Editor exports'
      : 'Historical real UI exports, not new Editor exports',
      'Fresh current Editor UI exports from a historical controlled fixture',
      "Truthful current installed export provenance");
    one('    }); s.cartridges = cartridges;',
      '    }); s.cartridges = cartridges;\n' +
      `    s.candidateBindings = ${JSON.stringify([options.bindingFile,
        ...["candidateConfig", "installation", "predecessor", "exported", "fixture"]
          .map(k => options.binding[k].path)])}.map(desc);\n` +
      '    require("./candidate-1930-menus.cjs").validateBinding(s);',
      "Pin explicit descriptors and verify fresh cartridges before profile protection");
    one('function validate(s, r) {', 'function validate(s, r) {\n' +
      '  require("./candidate-1930-menus.cjs").validateBinding(s);',
      "Audit current receipt, descriptors and authored bytes, not a previous candidate");
    one('"scripts/candidate-1930-exit.cjs", "scripts/installed-runtime-' + kind + '-current.cjs",',
      '"scripts/candidate-1930-exit.cjs", "scripts/lib/candidate-1924-quick-adapter.cjs", ' +
      '"scripts/installed-runtime-' + kind + '-current.cjs",',
      "Preserve the shared explicit candidate resolver used by this run");
    if (kind === "settings") one('    s.gitBefore = git(); s.installation = desc(installationFile);',
      '    s.gitBefore = git(); s.installation = desc(installationFile);\n' +
      '    s.motionPredecessor = require("./candidate-1930-menus.cjs").motionPredecessor(attempt);',
      "Keep the original motion audit status visible while executing independent preference tests");
  }
  one("if (require.main === module) main();", "main();", "Execute current session explicitly");
  return result;
}
function buildFlow(kind, original) {
  fileFor(kind, "flow"); const { result, one } = edit(original);
  one('require("./lib/installed-runtime-session.cjs");',
    'require("./candidate-1930-exit.cjs").runtime();', "Actual native document event readiness");
  if (kind === "motion") {
    const before = `g.status = current1922 ? validateQuickBar({ ...g, width: current.width }).status : g.buttons.length === 8 && g.buttons.every(b => b.hit
      && Math.abs(b.rect.top - g.buttons[0].rect.top) <= 1 && b.rect.left >= -1 && b.rect.right <= current.width + 1)
      ? "PASS" : "FAILED";`;
    one(before, "g.status = validateQuickBar({ ...g, width: current.width }).status;",
      "Nine real ordered quick actions including Hide, preserve hit/overlap/single-row checks");
  }
  return result;
}
function buildAudit(kind, original) {
  fileFor(kind, "audit"); const { result, one } = edit(original);
  one(`const { validate } = require("./installed-runtime-${kind}-current.cjs");`,
    `const validate = require("./candidate-1930-menus.cjs").validator("${kind}");`,
    "Same full terminal validation with current provenance");
  if (kind === "motion") {
    const distinct = 'new Set(s.protectedFiles.map(f => path.resolve(f.path))).size';
    one("assert.equal(s.snapshots.length, 12);", `assert.equal(s.snapshots.length, ${options ? 16 : 15});`,
      "Original twelve plus three actual candidate adapter sources");
    one(`assert.equal(${distinct}, 17);`,
      `const installed = require("./candidate-1930-exit.cjs").validateInstallation(s.installation.path);\n` +
      `    assert.deepEqual(s.protectedFiles, [installed.executable, ...installed.resources, ...installed.protectedFiles]);\n` +
      `    assert.equal(${distinct}, new Set([installed.executable, ...installed.resources, ...installed.protectedFiles].map(f => path.resolve(f.path))).size);`,
      "Exact current protected file identities replace unrelated historical path count");
    one("protectedDistinctPaths: 17", `protectedDistinctPaths: ${distinct}`, "Report actual protected current paths");
    one('group("Original directory identities/bytes,17 protected paths and Git unchanged; owned roots/ports gone"',
      'group("Original directory identities/bytes, current protected paths and Git unchanged; owned roots/ports gone"',
      "Do not retain a stale historical path count in the current audit label");
    one('  report.remaining = ["Complete Editor motion",',
      `  group("All current nine quick actions retain correct order and unique hit geometry", () => {
    const { validateQuickBar } = require("./lib/installed-runtime-motion-1922-policy.cjs");
    const matrices = r.matrix.filter(m => m.layout === "renpy"); assert.equal(matrices.length, 12);
    for (const m of matrices) {
      assert.equal(validateQuickBar({ ...m.quickGeometry, width: m.width }).status, "PASS");
    }
    return { currentQuickActions: 9, matrices: matrices.length };
  });
  report.remaining = ["Complete Editor motion",`,
      "Independently recheck current nine-action geometry rather than trusting the flow status");
    if (options) one("const buttons = m.quickGeometry.buttons; assert.equal(buttons.length, 8);",
      'const buttons = m.quickGeometry.buttons; assert.equal(buttons.length, 9);',
      "Retain all hit/overlap checks for the approved nine actions including Hide");
  } else if (options) {
    one('Both historical real UI-exported cartridges retain exact manifest/script/layout bytes and source identity',
      'Both fresh current UI-exported cartridges retain exact manifest/script/layout bytes and source identity',
      "Current exports are not historical test output");
    one('historicalExportNotNewEditorExport: true', 'freshCurrentEditorExport: true',
      "Report new authoring/export separately from controlled fixture origin");
  }
  return result;
}
function compile(result, filename) {
  new vm.Script(Module.wrap(result.source));
  const worker = new Module(filename, module); worker.filename = filename;
  worker.paths = Module._nodeModulePaths(path.dirname(filename));
  worker._compile(result.source, filename); return worker.exports;
}
function validator(kind) {
  const file = fileFor(kind, "session"), original = fs.readFileSync(file, "utf8");
  const adapted = buildSession(kind, original);
  // Auditing must not run the session a second time.
  assert.equal(adapted.source.split("\nmain();").length - 1, 1);
  return compile({ source: adapted.source.replace("\nmain();", "\n") }, file).validate;
}
function run(kind, type) {
  current.validateInstallation(installationFile);
  const file = fileFor(kind, type), build = type === "flow" ? buildFlow : type === "audit" ? buildAudit : buildSession;
  const adapted = build(kind, fs.readFileSync(file, "utf8"));
  if (type === "flow") {
    const i = process.argv.indexOf("--current-native-preparation"); assert(i > 0);
    const prep = read(process.argv[i + 1]);
    const expected = options ? path.resolve(prep.sessionRoot)
      : path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-${kind}-current-30`);
    assert.equal(path.resolve(prep.sessionRoot), expected); assert.equal(prep.executable.sha256, playerHash);
    if (options) {
      assert.equal(path.dirname(expected), path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01"));
      assert.match(path.basename(expected), new RegExp(`^installed-${kind}-current-\\d{2}$`));
      assert.equal(path.resolve(prep.originalExport.path), path.resolve(options.binding.exported.path));
      assert.equal(prep.originalExport.sha256, options.binding.exported.sha256);
      assert.equal(path.resolve(prep.originalFixture.path), path.resolve(options.binding.fixture.path));
      assert.equal(prep.originalFixture.sha256, options.binding.fixture.sha256);
      assert.equal(sha(prep.fixture.input), read(options.binding.fixture.path).inputSha256);
      const exported = read(options.binding.exported.path);
      for (const c of prep.cartridges) {
        const original = exported.cartridges.find(p => p.layout === c.layout); assert(original);
        assert.equal(c.sha256, original.sha256); assert.equal(sha(c.path), original.sha256);
      }
    }
    const output = path.join(expected, "executed-flow.cjs");
    fs.writeFileSync(output, adapted.source, { flag: "wx" });
    fs.writeFileSync(path.join(expected, "flow-adaptations.json"), JSON.stringify({
      original: desc(file), executed: desc(output), adaptations: adapted.adaptations }, null, 2), { flag: "wx" });
  }
  compile(adapted, path.join(__dirname, type === "session" ? `installed-${kind}-1930-session.cjs` : path.basename(file)));
}
function preflight(kind, attempt) {
  current.validateInstallation(installationFile);
  if (options && kind === "settings") {
    const evidence = motionPredecessor(attempt);
    assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
    return evidence;
  }
  const file = kind === "motion" ? path.join(base, options ? "quick-audit-01/report.json" : "exit-audit-30/report.json")
    : path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-motion-current-${options ? attempt : "30"}-audit-01/report.json`);
  const previous = read(file);
  assert.equal(previous.status, "PASS"); assert(previous.finishedAt && !previous.error);
  if (options) {
    assert.equal(previous.scope, kind === "motion"
      ? `INSTALLED_${version.replaceAll(".", "_")}_QUICK_EXCEPTIONS_INDEPENDENT_AUDIT`
      : "ACTUAL_NSIS_INSTALLED_PLAYER_CORE_MENU_MOTION_NOT_EDITOR_OR_COMPLETE_VISUAL");
    assert(previous.groups.length >= 4 && previous.groups.every(g => g.status === "PASS"));
    if (kind === "settings") assert.equal(read(previous.session.path).version, version);
  }
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)),
    "Previous session must be fully closed and restored");
  return desc(file);
}
module.exports = { buildSession, buildFlow, buildAudit, buildViewport, validator, validateBinding,
  motionPredecessor, validateMotionPredecessor };
if (require.main === module) {
  const mode = process.argv.splice(2, 1)[0], kind = process.argv.splice(2, 1)[0];
  assert(["motion", "settings"].includes(kind));
  if (mode === "viewport") {
    const file = path.join(__dirname, "native-runtime-state-viewport-test.cjs");
    compile(buildViewport(fs.readFileSync(file, "utf8")), file);
  } else if (mode === "session") {
    if (options) { assert.match(process.argv[2] || "", /^\d{2}$/); assert.equal(process.argv.length, 3); }
    else assert.equal(process.argv[2], "30");
    preflight(kind, process.argv[2]); run(kind, "session");
  }
  else if (mode === "flow") run(kind, "flow");
  else {
    assert.equal(mode, "audit");
    if (options) {
      assert.match(process.argv[2] || "", /^\d{2}$/);
      assert.equal(process.argv.length, 3);
    } else assert.equal(process.argv[2], "30");
    run(kind, "audit");
  }
}
