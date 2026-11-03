"use strict";
// One candidate adapter for the preserved complete business flow. No product edits.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { buildCurrentAbilitiesFlow } = require("./lib/candidate-1924-abilities-final-adapter.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const binding = process.env.AGENTVN_ABILITIES_CANDIDATE_CONFIG
  ? read(process.env.AGENTVN_ABILITIES_CANDIDATE_CONFIG) : null;
let config;
if (binding) {
  for (const name of ["candidateConfig", "installation", "prerequisite", "historicalCheckpoint"])
    assert.equal(sha(binding[name].path), binding[name].sha256, name);
  config = require("./candidate-layout-consumption.cjs").validateCandidateConfig(read(binding.candidateConfig.path));
  const installed = read(binding.installation.path);
  const actual = require("./installed-profile-data-replay.cjs").deriveActual(config.actual, config.version);
  for (const key of Object.keys(actual)) assert.deepEqual(installed[key], actual[key], key);
  assert.equal(read(binding.prerequisite.path).status, "PASS");
  assert.match(binding.exportAttempt, /^\d{2}$/);
}
const version = config?.version || "1.9.30", stamp = version.replaceAll(".", "");
const base = config?.qa || path.resolve("F:/AgentVN/QA/Editor-1.9.30-20261026-01");
const runs = path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01");
const scope = `INSTALLED_${version.replaceAll(".", "_")}_INHERITANCE_ANCHORS_QUICK_LIBRARY`;
const installationPath = binding?.installation.path || path.join(base, "derived-components-installation-01.json");
const exportPath = binding
  ? `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${binding.exportAttempt}/report.json`
  : "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/report.json";
const exportScope = binding
  ? `ACTUAL_${stamp}_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE`
  : "ACTUAL_1922_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE";
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
function preparation(attempt) {
  assert.match(attempt, /^\d{2}$/);
  const installation = desc(installationPath);
  const installed = read(installation.path);
  const originalExport = desc(exportPath);
  const exported = read(originalExport.path), sessionRoot = path.join(runs, `abilities-installed-${stamp}-${attempt}`);
  return { status: "PASS", candidateVersion: version, scope, sessionRoot, installation, originalExport,
    fixture: exported.fixture, cartridges: exported.cartridges,
    executable: installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),
    defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
    installId: `qa_abilities_${stamp}_${attempt}_01`, webview: path.join(sessionRoot, "webview"),
    temporary: path.join(sessionRoot, "temporary"), tools: [desc(__filename)] };
}
function validatePreparation(p) {
  assert.equal(p.status, "PASS"); assert.equal(p.scope, scope);
  assert.equal(p.candidateVersion, version);
  assert.equal(p.current1922Library, undefined);
  assert.equal(path.dirname(path.resolve(p.sessionRoot)), runs);
  assert.match(path.basename(p.sessionRoot), new RegExp(`^abilities-installed-${stamp}-\\d{2}$`));
  const attempt = path.basename(p.sessionRoot).slice(-2);
  assert.match(p.installId, new RegExp(`^qa_abilities_${stamp}_${attempt}_(0[1-9]|1[0-2])$`));
  assert.equal(p.defaultStorage, "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION");
  assert.equal(path.resolve(p.installation.path), path.resolve(installationPath));
  const installed = read(p.installation.path);
  assert.equal(installed.status, "PASS"); assert.equal(installed.metadataRestoration, "PASS");
  assert.equal(installed.version, version);
  assert.equal(installed.executable.sha256, config ? read(config.actual.path).executable.sha256
    : "a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577");
  assert.equal(sha(installed.actualInstallation.path), installed.actualInstallation.sha256);
  const actual = read(installed.actualInstallation.path);
  assert(actual.status === "PASS" && actual.exitCode === 0 && actual.registryRestored);
  assert.equal(actual.executable.sha256, installed.executable.sha256);
  const player = installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
  assert.deepEqual(p.executable, player);
  const expectedPlayer = config
    ? require("./installed-profile-data-replay.cjs").deriveActual(config.actual, config.version)
      .resources.find(f => path.basename(f.path) === "agentvn-player.exe").path
    : path.join(base, "install-01/installed-nsis/agentvn-player.exe");
  assert.equal(path.resolve(player.path), path.resolve(expectedPlayer));
  if (config) {
    const actual = require("./installed-profile-data-replay.cjs").deriveActual(config.actual, config.version);
    assert.deepEqual(player, actual.resources.find(f => path.basename(f.path) === "agentvn-player.exe"));
  } else assert.equal(player.sha256, "296b7716cadda05f7c32ba7e46ecafc87017418e456c2744644ecf12ea68a4aa");
  assert.equal(path.resolve(p.originalExport.path), path.resolve(exportPath));
  const exported = read(p.originalExport.path);
  assert.equal(exported.status, "PASS"); assert(exported.finishedAt && !exported.cleanupError);
  assert.equal(exported.scope, exportScope);
  assert.equal(exported.steps.length, 3); assert(exported.steps.every(s => s.status === "PASS"));
  assert.deepEqual(p.fixture, exported.fixture); assert.deepEqual(p.cartridges, exported.cartridges);
  assert.equal(p.cartridges.length, 2);
  for (const f of [p.installation, p.originalExport, p.executable, installed.executable,
    ...installed.resources, ...installed.protectedFiles, ...p.cartridges, ...p.tools])
    assert.equal(sha(f.path), f.sha256, f.path);
  assert.equal(sha(p.fixture.input), p.fixture.inputSha256);
  const project = read(p.fixture.input);
  assert.equal(project.editor_settings.defaultDialogPresentation, "nvl");
  assert.deepEqual(project.editor_settings.characterDialogPresentations, { alice: "bubble", nvl_person: "nvl" });
  assert.equal(path.resolve(p.webview), path.join(p.sessionRoot, "webview"));
  assert.equal(path.resolve(p.temporary), path.join(p.sessionRoot, "temporary"));
}
function editor(original, prior) {
  const result = prior ? { source: prior.source, adaptations: [...prior.adaptations] }
    : { source: original, adaptations: [] };
  return { result, one(before, after, reason) {
    assert.equal(result.source.split(before).length - 1, 1, reason);
    result.source = result.source.replace(before, after); result.adaptations.push({ before, after, reason });
  } };
}
function buildFlow(original) {
  const { result, one } = editor(original, buildCurrentAbilitiesFlow(original));
  one('require("./lib/candidate-1924-abilities-adapter.cjs").validateAbilitiesPreparation(prep);',
    'require("./candidate-1930-abilities.cjs").validatePreparation(prep);', "Verify actual 1.9.30 before launch");
  one('"INSTALLED_1_9_24_INHERITANCE_ANCHORS_QUICK_LIBRARY_HISTORICAL_UI_EXPORT_NOT_NEW_AUTHOR_OR_ANDROID"',
    JSON.stringify(scope + (binding ? "_FRESH_CURRENT_UI_EXPORT_NOT_FULL_AUTHOR_OR_ANDROID"
      : "_HISTORICAL_UI_EXPORT_NOT_NEW_AUTHOR_OR_ANDROID")),
    "Honest current candidate scope");
  one('  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page); page.setDefaultTimeout(20000);',
    `  const targetReadiness = { events: [] }; report.launches.at(-1).targetReadiness = targetReadiness; save();
  page = await require("./lib/wait-native-runtime-page.cjs").waitNativeRuntimePage(browser, {
    observe: event => { targetReadiness.events.push(event); save(); }
  });
  targetReadiness.readyURL = page.url(); targetReadiness.readyAt = new Date().toISOString(); save();
  page.setDefaultTimeout(20000);`, "Wait for the unique actual native document");
  return result;
}
function buildSession(original) {
  const { result, one } = editor(original);
  one('require("./lib/candidate-1924-abilities-adapter.cjs");',
    'require("./candidate-1930-abilities.cjs");', "Use candidate validator");
  one("abilities-installed-1924-${attempt}", `abilities-installed-${stamp}-\${attempt}`, "Fresh current run");
  one('const candidate = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";',
    `const candidate = ${JSON.stringify(base)};`, "Actual installed candidate root");
  one('"INSTALLED_1_9_24_INHERITANCE_ANCHORS_QUICK_LIBRARY"', JSON.stringify(scope), "Actual installed scope");
  one('const prep = { status: "PASS", scope: report.scope, sessionRoot: out,',
    `const prep = { status: "PASS", candidateVersion: ${JSON.stringify(version)}, scope: report.scope, sessionRoot: out,`,
    "Preparation declares its real version explicitly");
  if (binding) one('path.join(candidate, `fresh-export-audit-${attempt}/report.json`)',
    JSON.stringify(binding.prerequisite.path), "Require completed current predecessor, not a fabricated save-suite PASS");
  else one("`fresh-export-audit-${attempt}/report.json`", "`save-audit-${attempt}/report.json`",
    "Do not race the existing native narrative/quick/save chain");
  one('report.installation = desc(path.join(candidate, "installation.json"));',
    `report.installation = desc(${JSON.stringify(installationPath)});`,
    "Installed NSIS receipt, not extracted payload");
  if (binding) {
    one('report.originalExport = desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/report.json");',
      `report.originalExport = desc(${JSON.stringify(exportPath)});`, "Use current Editor real UI exports");
    one('"Historical real UI-exported synthetic fixture, not fresh candidate authoring"',
      '"Historical controlled fixture freshly UI-exported by current installed Editor, not full authoring coverage"',
      "Separate fixture origin from this candidate real export");
    one('  const prep = { status: "PASS", candidateVersion:',
      `  report.candidateBinding = ${JSON.stringify({ path: process.env.AGENTVN_ABILITIES_CANDIDATE_CONFIG,
        sha256: sha(process.env.AGENTVN_ABILITIES_CANDIDATE_CONFIG), value: binding })}; save();\n` +
      '  const prep = { status: "PASS", candidateVersion:', "Retain explicit immutable candidate binding");
  }
  one('report.tools = [__filename, "scripts/candidate-1924-abilities-flow.cjs",\n' +
    '    "scripts/candidate-1924-abilities-adapter-test.cjs", "scripts/lib/candidate-1924-abilities-adapter.cjs",',
    'report.tools = [__filename, "scripts/candidate-1930-abilities-test.cjs",\n' +
    '    "scripts/candidate-1924-abilities-session.cjs", "scripts/candidate-1924-abilities-audit.cjs",\n' +
    '    "scripts/lib/candidate-1924-abilities-adapter.cjs",\n' +
    '    "scripts/lib/candidate-1924-abilities-final-adapter.cjs", "scripts/lib/wait-native-runtime-page.cjs",',
    "Retain all real QA inputs");
  for (const location of ['installId: `qa_abilities_1924_${attempt}_01`',
    'prep.installId = `qa_abilities_1924_${attempt}_${number}`'])
    one(location, location.replace("1924", stamp), "Separate current QA save identities");
  one('await command(process.execPath, ["scripts/candidate-1924-abilities-adapter-test.cjs"], "adapter-guard");',
    'await command(process.execPath, ["scripts/candidate-1930-abilities-test.cjs"], "adapter-guard");',
    "Offline current binding guard");
  one('["scripts/candidate-1924-abilities-flow.cjs", cellOut,',
    '["scripts/candidate-1930-abilities.cjs", cellOut,', "Same complete flow in all twelve cells");
  return result;
}
function buildAudit(original) {
  const { result, one } = editor(original);
  one("abilities-installed-1924-${attempt}", `abilities-installed-${stamp}-\${attempt}`, "Current raw session");
  one("Editor-1.9.24-20261024-01/abilities-audit-${attempt}",
    path.relative("F:/AgentVN/QA", base).replaceAll("\\", "/") + "/abilities-audit-${attempt}", "New independent report");
  one('"INSTALLED_1_9_24_INHERITANCE_ANCHORS_QUICK_LIBRARY_AUDIT"',
    JSON.stringify(scope + "_AUDIT"), "Actual audit scope");
  one('"INSTALLED_1_9_24_INHERITANCE_ANCHORS_QUICK_LIBRARY"', JSON.stringify(scope), "Current session scope");
  one('assert.equal(installed.executable.version, "1.9.24");',
    `assert.equal(installed.version, ${JSON.stringify(version)});`, "Real current receipt version");
  one("assert.equal(adapted.adaptations.length, 6);", "assert.equal(adapted.adaptations.length, 14);",
    "Replay all preserved and candidate-specific changes");
  one('assert.deepEqual(shot.before, cell.viewport);',
    `assert.equal(shot.before.width, cell.viewport.width); assert.equal(shot.before.height, cell.viewport.height);
        assert.equal(shot.before.reduced, cell.viewport.reduced);
        assert(Math.abs(shot.before.dpr - cell.viewport.dpr) <= 1e-6);`,
    "Check actual native DPR tail with the established tolerance");
  one('  report.status = "PASS";', `
  check("Exact current installation, unique documents, live grids and exclusive logs", () => {
    const prep = read(session.cells[0].preparation.path);
    require("./candidate-1930-abilities.cjs").validatePreparation(prep);
    let probes = 0;
    for (const cell of session.cells) {
      const raw = read(cell.raw.path);
      assert.equal(raw.saveGridProbes.length, 2);
      for (const p of raw.saveGridProbes) {
        probes++; assert.equal(p.liveGrids, 1); assert.equal(p.liveSlots, 6); assert.equal(p.liveSaved, 6);
        assert.equal(p.allSaved, p.liveSaved + p.retained.reduce((n, g) => n + g.saved, 0));
        for (const g of p.retained) {
          assert(g.inert); assert.equal(g.hidden, "true"); assert.equal(g.pointerEvents, "none");
          assert.equal(g.functionalMarkers, 0); assert.equal(g.hasFocus, false);
        }
      }
      for (const launch of raw.launches) {
        const ready = launch.targetReadiness; assert(ready?.readyAt && ready.events.length);
        assert.equal(new URL(ready.readyURL).hostname, "tauri.localhost");
        assert.equal(ready.events.at(-1).candidates, 1);
      }
      const expected = ["agentvn-player-1.log", "agentvn-player-3.log", "renpy-player-2.log"];
      assert.deepEqual(fs.readdirSync(cell.out).filter(n => expected.includes(n)).sort(), expected);
    }
    assert.equal(probes, 24); return { probes, actualUniqueDocuments: 36, exclusiveLogs: 36 };
  });
  report.status = "PASS";`, "Retain live-grid and readiness safety, never count presentation copies as slots");
  return result;
}
function buildExport(original) {
  assert(binding, "Fresh export requires explicit current candidate");
  const { result, one } = editor(original);
  one('scope: "ACTUAL_1922_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE"',
    `scope: ${JSON.stringify(exportScope)}`, "Fresh real UI export from the bound installation");
  one('desc("F:/AgentVN/Checkpoints/Installed-Runtime-Story-1922-20261023-01/report.json")',
    `desc(${JSON.stringify(binding.historicalCheckpoint.path)})`, "Preserve original controlled fixture provenance");
  one('report.protectedProducts = checkpoint.products;',
    `report.protectedProducts = ${JSON.stringify(read(installationPath).protectedFiles)};`,
    "Protect current live files, not historical user database bytes");
  one('desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json")',
    `desc(${JSON.stringify(installationPath)})`, "Actual current NSIS receipt");
  one('assert.equal(read(report.installation.path).version, "1.9.22");',
    `assert.equal(read(report.installation.path).version, ${JSON.stringify(version)});`, "Current candidate version");
  one("module.exports = { validateCartridge };", "module.exports = { validateCartridge, main };",
    "Invoke existing complete business without copying it");
  new vm.Script(Module.wrap(result.source));
  return result;
}
function runSource(result, originalFile, archive) {
  new vm.Script(Module.wrap(result.source));
  if (archive) {
    fs.writeFileSync(archive + "-executed.cjs", result.source, { flag: "wx" });
    fs.writeFileSync(archive + "-adaptations.json", JSON.stringify({
      original: desc(originalFile), executed: desc(archive + "-executed.cjs"), adaptations: result.adaptations,
    }, null, 2), { flag: "wx" });
  }
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker._compile(result.source, __filename);
  return worker.exports;
}
module.exports = { preparation, validatePreparation, validateAbilitiesPreparation: validatePreparation,
  buildFlow, buildSession, buildAudit, buildExport };
if (require.main === module) {
  const arg = process.argv[2];
  if (arg === "export" || arg === "export-check") {
    assert(binding); assert.equal(process.argv[3], binding.exportAttempt);
    const f = path.join(__dirname, "installed-runtime-story-export-1922.cjs");
    assert.equal(sha(f), "44d41530eacf3202a4d7317e23963b56735f3a593438ded542701a3ab8871666");
    const result = buildExport(fs.readFileSync(f, "utf8"));
    if (arg === "export-check") {
      for (const fn of [buildSession, buildAudit]) new vm.Script(Module.wrap(fn(fs.readFileSync(path.join(__dirname,
        fn === buildSession ? "candidate-1924-abilities-session.cjs" : "candidate-1924-abilities-audit.cjs"), "utf8")).source));
      console.log(JSON.stringify({ status: "PASS", version, exportAdaptations: result.adaptations.length,
        sourceStarts: 0, models: 0 }));
    } else {
      process.argv.splice(2, 1);
      const worker = runSource(result, f, path.join(base, `abilities-export-${binding.exportAttempt}`));
      Promise.resolve(worker.main()).catch(error => { console.error(error); process.exitCode = 1; });
    }
  } else if (arg === "audit") {
    process.argv.splice(2, 1);
    assert.match(process.argv[2] || "", /^\d{2}$/);
    const f = path.join(__dirname, "candidate-1924-abilities-audit.cjs");
    runSource(buildAudit(fs.readFileSync(f, "utf8")), f);
  } else if (/^\d{2}$/.test(arg || "")) {
    const f = path.join(__dirname, "candidate-1924-abilities-session.cjs");
    runSource(buildSession(fs.readFileSync(f, "utf8")), f);
  } else {
    const out = path.resolve(arg), i = process.argv.indexOf("--current-native-preparation");
    assert(i > 0 && process.argv[i + 1]);
    const p = read(process.argv[i + 1]); validatePreparation(p);
    assert.equal(path.dirname(out), p.sessionRoot);
    assert.match(path.basename(out), /^cell-(0[1-9]|1[0-2])$/);
    const f = path.join(__dirname, "installed-runtime-abilities-playwright.cjs");
    runSource(buildFlow(fs.readFileSync(f, "utf8")), f, out);
  }
}
