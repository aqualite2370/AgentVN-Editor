"use strict";
// Candidate-bound QA adapters. Historical sources and product code stay unchanged.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./installed-runtime-session.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function quickCandidate(current = false) {
  const bindingFile = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG;
  const binding = bindingFile ? read(bindingFile) : null;
  let config;
  if (binding) {
    for (const name of ["candidateConfig", "installation", "predecessor", "exported", "fixture"])
      assert.equal(sha(binding[name].path), binding[name].sha256, name);
    config = require("../candidate-layout-consumption.cjs").validateCandidateConfig(read(binding.candidateConfig.path));
    require("../candidate-1930-exit.cjs").validateInstallation(binding.installation.path);
  }
  const version = config?.version || (current ? "1.9.30" : "1.9.24"), stamp = version.replaceAll(".", "");
  const base = config?.qa || path.resolve(current
    ? "F:/AgentVN/QA/Editor-1.9.30-20261026-01" : "F:/AgentVN/QA/Editor-1.9.24-20261024-01");
  return { explicit: Boolean(binding), current: Boolean(binding) || current, version, stamp, base, bindingFile, binding,
    scope: `INSTALLED_${version.replaceAll(".", "_")}_LIBRARY_QUICK_EXCEPTIONS`,
    installation: binding?.installation.path || path.join(base, current ? "derived-components-installation-01.json" : "installation.json"),
    exported: binding?.exported.path || "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/report.json",
  };
}
function validateCandidateQuickPreparation(prep, out) {
  const options = quickCandidate(prep.candidateVersion === "1.9.30"), current = options.current;
  assert(options.explicit ? prep.candidateVersion === options.version : prep.candidateVersion === undefined || current);
  const candidate = options.base;
  assert.equal(prep.status, "PASS");
  assert.equal(prep.scope, options.scope);
  assert.equal(prep.current1922Library, undefined);
  assert.equal(path.resolve(prep.sessionRoot), path.resolve(out));
  assert.equal(path.dirname(path.resolve(out)),
    path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01"));
  assert.match(path.basename(out), new RegExp(`^quick-installed-${options.stamp}-\\d{2}$`));
  assert.equal(prep.installId, `qa_quick_${options.stamp}_${path.basename(out).slice(-2)}`);
  assert.equal(prep.defaultStorage, "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION");
  assert.equal(path.resolve(prep.installation.path), path.resolve(options.installation));
  const installed = read(prep.installation.path), packaged = current?null:read(path.join(candidate, "package-01/report.json"));
  assert.equal(installed.status, "PASS"); assert.equal(installed.metadataRestoration, "PASS");
  if(current) {
    assert.equal(installed.version, options.version);
    if (options.explicit) require("../candidate-1930-exit.cjs").validateInstallation(prep.installation.path);
    else assert.equal(installed.executable.sha256,"a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577");
    assert.equal(sha(installed.actualInstallation.path),installed.actualInstallation.sha256);
    const actual=read(installed.actualInstallation.path);
    assert(actual.status==="PASS"&&actual.exitCode===0&&actual.registryRestored);
    assert.equal(actual.executable.sha256,installed.executable.sha256);
  }else {
    assert.equal(installed.executable.version, "1.9.24"); assert.equal(packaged.status, "PASS");
    assert.equal(installed.package.sha256, packaged.installer.sha256);
  }
  const player = installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
  assert(player); assert.deepEqual(prep.executable, player);
  assert.equal(path.resolve(player.path), options.explicit
    ? path.join(installed.installRoot, "agentvn-player.exe")
    : path.join(candidate, current?"install-01/installed-nsis/agentvn-player.exe":"installed-editor/agentvn-player.exe"));
  if (!options.explicit) assert.equal(player.sha256, current?"296b7716cadda05f7c32ba7e46ecafc87017418e456c2744644ecf12ea68a4aa":packaged.player.sha256);
  assert.equal(path.resolve(prep.originalExport.path),
    path.resolve(options.exported));
  const exported = read(prep.originalExport.path);
  assert.equal(exported.status, "PASS"); assert(exported.finishedAt && !exported.cleanupError);
  assert.equal(exported.scope, `ACTUAL_${options.explicit ? options.stamp : "1922"}_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE`);
  assert.equal(exported.steps.length, 3); assert(exported.steps.every(s => s.status === "PASS"));
  assert.deepEqual(prep.cartridges, exported.cartridges); assert.equal(prep.cartridges.length, 2);
  assert.equal(path.resolve(prep.originalFixture.path), path.resolve(exported.out, "fixture.json"));
  assert.equal(prep.fixture.inputSha256, exported.fixture.inputSha256);
  assert.equal(read(prep.originalFixture.path).inputSha256, prep.fixture.inputSha256);
  assert.equal(sha(prep.fixture.input), prep.fixture.inputSha256);
  assert.equal(path.resolve(prep.webview), path.join(path.resolve(out), "webview"));
  assert.equal(path.resolve(prep.temporary), path.join(path.resolve(out), "temporary"));
  for (const item of [prep.installation, prep.executable, prep.originalExport, prep.originalFixture,
    installed.executable, ...installed.resources, ...installed.protectedFiles, ...(current?[]:[packaged.installer]),
    ...prep.cartridges, ...prep.tools]) assert.equal(sha(item.path), item.sha256, item.path);
}
function transform(original, replacements) {
  let source = original;
  const adaptations = [];
  for (const [before, after, reason] of replacements) {
    assert.equal(source.split(before).length - 1, 1, reason);
    source = source.replace(before, after);
    adaptations.push({ before, after, reason });
  }
  return { source, adaptations };
}
function adaptQuickSession(original) {
  return transform(original, [
    ['      if (prep.current1922Library) {\n' +
      '        require("./installed-runtime-quick-1922-preparation.cjs").validateQuickPreparation(prep, out);\n' +
      '      } else assert.equal(prep.defaultStorage, prep.current1922Preview\n' +
      '        ? "CODEX_EXPLICIT_PROFILE_JUNCTION_PREVIEW" : "PHYSICAL_DEFAULT_PATH");',
    '      require("./candidate-1924-quick-adapter.cjs").validateCandidateQuickPreparation(prep, out);',
    "Validate the actual installed 1.9.24 candidate, never masquerade as an old installation or Dev"],
    ['scope: this.prep.current1922Library ? "ACTUAL_1922_INSTALLED_SHIPPED_LIBRARY_NOT_STANDALONE_ANDROID"\n' +
      '        : "CURRENT_NATIVE_NOT_RELEASE_INSTALL",',
    'scope: "INSTALLED_" + (this.prep.candidateVersion || "1.9.24").replaceAll(".", "_") + "_LIBRARY_QUICK_NOT_STANDALONE_OR_ANDROID",',
    "Record installed library provenance on every actual launch"],
    ['    this.page = this.browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(this.page);',
    `    this.launch.targetReadiness = { initialURLs: this.browser.contexts().flatMap(c => c.pages()).map(p => p.url()), events: [] };
    this.save();
    this.page = await require("./wait-native-runtime-page.cjs").waitNativeRuntimePage(this.browser, {
      observe: event => { this.launch.targetReadiness.events.push({ ...event, at: new Date().toISOString() }); this.save(); }
    });
    this.launch.targetReadiness.readyURL = this.page.url();
    this.launch.targetReadiness.readyAt = new Date().toISOString(); this.save();`,
    "Wait for the actual unique native document before UI input, preserving established readiness semantics"],
  ]);
}
function adaptQuickFlow(original) {
  return transform(original, [
    ['require("./lib/installed-runtime-session.cjs");',
    'require("./lib/candidate-1924-quick-adapter.cjs").candidateQuickRuntime();',
    "Use the candidate-validated session without changing historical session bytes"],
    ["const prep = read(prepFile);",
    'const prep = read(prepFile);\nassert(currentNative);\n' +
      'require("./lib/candidate-1924-quick-adapter.cjs").validateCandidateQuickPreparation(prep, prep.sessionRoot);',
    "Reject incorrect preparations before any product launch or raw report creation"],
    ["const sourcePath = current1922 ? prep.originalExport.path", "const sourcePath = currentNative ? prep.originalExport.path",
    "Use the explicitly recorded historical UI-authored export"],
    ["const source = read(sourcePath), fixturePath = current1922 ? prep.originalFixture.path",
    "const source = read(sourcePath), fixturePath = currentNative ? prep.originalFixture.path",
    "Use the recorded fixture rather than an unrelated historical default"],
    ['scope: current1922 ? "ACTUAL_1922_INSTALLED_SHIPPED_LIBRARY_QUICK_EXCEPTIONS_NOT_STANDALONE_ANDROID_OR_NATIVE_PICKER"\n' +
      '    : currentNative ? "CURRENT_NATIVE_PLAYER_LIBRARY_NOT_RELEASE_INSTALL_STANDALONE_ANDROID_OR_NATIVE_PICKER"\n' +
      '    : "ACTUAL_INSTALLED_PLAYER_LIBRARY_NOT_STANDALONE_SETUP_ANDROID_OR_NATIVE_PICKER",',
    'scope: "INSTALLED_" + (prep.candidateVersion || "1.9.24").replaceAll(".", "_") + "_LIBRARY_QUICK_EXCEPTIONS_NOT_STANDALONE_ANDROID_OR_NATIVE_PICKER",',
    "Report current candidate and controlled fault boundaries explicitly"],
    ["scripts/installed-runtime-quick-gaps-lock.ps1", "scripts/candidate-1924-quick-lock.ps1",
    "Use a separately guarded current-candidate lock helper"],
    ['...(current1922 ? ["-Current1922"] : [])', "",
    "Do not pretend the new identity is a 1.9.22 save directory"],
  ]);
}
function adaptQuickValidator(original) {
  return transform(original, [
    ['assert.equal(r.scope, current1922\n' +
      '    ? "ACTUAL_1922_INSTALLED_SHIPPED_LIBRARY_QUICK_EXCEPTIONS_NOT_STANDALONE_ANDROID_OR_NATIVE_PICKER"\n' +
      '    : "CURRENT_NATIVE_PLAYER_LIBRARY_NOT_RELEASE_INSTALL_STANDALONE_ANDROID_OR_NATIVE_PICKER");',
    'assert.equal(r.scope, "INSTALLED_" + (options.candidateVersion || "1.9.24").replaceAll(".", "_") + "_LIBRARY_QUICK_EXCEPTIONS_NOT_STANDALONE_ANDROID_OR_NATIVE_PICKER");',
    "Keep all business assertions but accept only the new candidate scope"],
    ['assert.equal(l.scope, current1922 ? "ACTUAL_1922_INSTALLED_SHIPPED_LIBRARY_NOT_STANDALONE_ANDROID"\n' +
      '      : "CURRENT_NATIVE_NOT_RELEASE_INSTALL");',
    'assert.equal(l.scope, "INSTALLED_" + (options.candidateVersion || "1.9.24").replaceAll(".", "_") + "_LIBRARY_QUICK_NOT_STANDALONE_OR_ANDROID");',
    "Require every launch to record this installation scope"],
    ['assert.equal(l.executableSha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");',
    "assert.equal(l.executableSha256, options.executableSha256);",
    "Compare launch bytes with the independently validated installation"],
  ]);
}
function loadModule(source, filename) {
  const Module = require("node:module");
  assert(fs.statSync(filename).isFile());
  const worker = new Module(filename, module);
  worker.filename = filename; worker.paths = Module._nodeModulePaths(path.dirname(filename));
  worker._compile(source, filename);
  return worker.exports;
}
function candidateQuickRuntime() {
  const file = path.join(__dirname, "installed-runtime-session.cjs");
  return loadModule(adaptQuickSession(fs.readFileSync(file, "utf8")).source, file);
}
function validateCandidateQuickReport(raw, prep, count = 12) {
  validateCandidateQuickPreparation(prep, prep.sessionRoot);
  assert.equal(count, 12, "This acceptance requires the full matrix");
  const file = path.join(__dirname, "../native-runtime-quick-audit.cjs");
  const validator = loadModule(adaptQuickValidator(fs.readFileSync(file, "utf8")).source, file);
  validator.validateQuickReport(raw, count, { current1922: true, executableSha256: prep.executable.sha256,candidateVersion:prep.candidateVersion });
}
module.exports = { validateCandidateQuickPreparation, adaptQuickSession, adaptQuickFlow,
  adaptQuickValidator, candidateQuickRuntime, validateCandidateQuickReport, loadModule, quickCandidate };
