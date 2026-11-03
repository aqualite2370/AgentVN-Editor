"use strict";
// A new installation binding. Historical Dev/1.9.22 validators remain sealed.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./installed-runtime-session.cjs");
const { validateNarrativeFixture } = require("./installed-narrative-1922-fixture.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sessionBase = path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01");
function resolveNarrativeCandidate(configFile, exportFile) {
  const config = require("../candidate-layout-consumption.cjs").validateCandidateConfig(read(configFile));
  const actual = require("../installed-profile-data-replay.cjs").deriveActual(config.actual, config.version);
  const installation = path.join(config.qa, "derived-installed-01.json"), installed = read(installation);
  for (const key of Object.keys(actual)) assert.deepEqual(installed[key], actual[key], key);
  const exported = path.resolve(exportFile);
  assert.equal(path.dirname(path.dirname(exported)), path.resolve("F:/AgentVN/QA/Installed-Layout-20261021-01"));
  assert.match(path.basename(path.dirname(exported)), /^editor-\d{2}$/);
  assert.equal(path.basename(exported), "report.json");
  return { config, installation, exported, stamp: config.version.replaceAll(".", ""),
    scope: `INSTALLED_${config.version.replaceAll(".", "_")}_NARRATIVE_CURRENT_UI_EXPORT_NOT_SETUP_OR_ANDROID` };
}
function validateBoundPreparation(prep) {
  assert.equal(sha(prep.candidateConfig.path), prep.candidateConfig.sha256);
  const b = resolveNarrativeCandidate(prep.candidateConfig.path, prep.exported.path);
  assert.equal(prep.status, "PASS"); assert.equal(prep.candidateVersion, b.config.version);
  assert.equal(prep.scope, b.scope);
  assert.equal(path.dirname(path.resolve(prep.sessionRoot)), sessionBase);
  assert.match(path.basename(prep.sessionRoot), new RegExp(`^narrative-installed-${b.stamp}-\\d{2}$`));
  assert.equal(path.resolve(prep.installation.path), path.resolve(b.installation));
  assert.equal(prep.defaultStorage, "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION");
  assert.equal(path.resolve(prep.temporary), path.join(prep.sessionRoot, "temporary"));
  assert.equal(path.resolve(prep.webview), path.join(prep.sessionRoot, "webview"));
  const installed = read(prep.installation.path), exported = read(prep.exported.path);
  const executable = installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
  assert.deepEqual(prep.executable, executable);
  assert.equal(exported.status, "PASS"); assert(exported.finishedAt && !exported.error && !exported.cleanupError);
  assert.equal(exported.candidateVersion, b.config.version);
  assert.equal(exported.scope, "CURRENT_INSTALLED_EDITOR_NARRATIVE_BOUNDARY_UI_EXPORT");
  assert.deepEqual(exported.candidateConfig, prep.candidateConfig);
  assert.equal(exported.installation.sha256, prep.installation.sha256);
  assert.equal(exported.steps.length, 3); assert(exported.steps.every(s => s.status === "PASS" && s.finishedAt));
  assert.equal(exported.modelRequests, 0); assert.deepEqual(exported.errors, []);
  assert.deepEqual(prep.fixture, exported.fixture); assert.equal(prep.fixture.capacityVariant, "mixed-history-v2");
  assert.deepEqual(prep.cartridges, exported.cartridges); assert.equal(prep.cartridges.length, 2);
  for (const f of [prep.installation, prep.executable, prep.exported, installed.executable,
    ...installed.resources, ...installed.protectedFiles, ...prep.cartridges, ...prep.tools])
    assert.equal(sha(f.path), f.sha256, f.path);
  assert.equal(sha(prep.fixture.input), prep.fixture.inputSha256);
  validateNarrativeFixture(read(prep.fixture.input), prep.fixture, fs.readFileSync(prep.fixture.voice.path));
  assert.equal(sha(exported.restoration.path), exported.restoration.sha256);
  assert.equal(read(exported.restoration.path).status, "PASS");
  assert(exported.cleanups.length && exported.cleanups.every(c => c.status === "PASS"));
  return { executable, scope: prep.scope };
}
function validateCandidateNarrativePreparation(prep) {
  if (prep.candidateConfig) return validateBoundPreparation(prep);
  const current=prep.candidateVersion==="1.9.30";
  assert(prep.candidateVersion===undefined||current,"Unsupported candidate binding");
  const base=path.resolve(current?"F:/AgentVN/QA/Editor-1.9.30-20261026-01":"F:/AgentVN/QA/Editor-1.9.24-20261024-01");
  assert.equal(prep.status, "PASS");
  assert.equal(prep.scope, current?"INSTALLED_1_9_30_NARRATIVE_LIBRARY_NOT_NEW_AUTHOR_EXPORT_OR_ANDROID":"INSTALLED_1_9_24_NARRATIVE_LIBRARY_NOT_NEW_AUTHOR_EXPORT_OR_ANDROID");
  assert.equal(path.dirname(path.resolve(prep.sessionRoot)), sessionBase);
  assert.match(path.basename(prep.sessionRoot), current?/^narrative-installed-1930-\d{2}$/:/^narrative-installed-1924-\d{2}$/);
  assert.equal(path.resolve(prep.installation.path), path.join(base, current?"derived-components-installation-01.json":"installation.json"));
  assert.equal(path.resolve(prep.temporary), path.join(prep.sessionRoot, "temporary"));
  assert.equal(path.resolve(prep.webview), path.join(prep.sessionRoot, "webview"));
  assert.equal(prep.defaultStorage, "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION");
  const installed = read(prep.installation.path), packaged = current?null:read(path.join(base, "package-01/report.json"));
  assert.equal(installed.status, "PASS"); assert.equal(installed.metadataRestoration, "PASS");
  if(current) {
    assert.equal(installed.version,"1.9.30");
    assert.equal(installed.executable.sha256,"a8bb43747d7775dc10ccdacdd20bb67e759ae3298653b77cfc531a44241d5577");
    assert.equal(sha(installed.actualInstallation.path),installed.actualInstallation.sha256);
    const actual=read(installed.actualInstallation.path);
    assert(actual.status==="PASS"&&actual.exitCode===0&&actual.registryRestored);
    assert.equal(actual.executable.sha256,installed.executable.sha256);
  }else {
    assert.equal(installed.executable.version, "1.9.24"); assert.equal(packaged.status, "PASS");
    assert.equal(installed.package.sha256, packaged.installer.sha256);
  }
  const executable = installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
  assert(executable); assert.equal(executable.sha256, current?"296b7716cadda05f7c32ba7e46ecafc87017418e456c2744644ecf12ea68a4aa":packaged.player.sha256);
  assert.equal(path.resolve(executable.path), path.join(base, current?"install-01/installed-nsis/agentvn-player.exe":"installed-editor/agentvn-player.exe"));
  assert.equal(path.resolve(prep.executable.path), path.resolve(executable.path));
  assert.equal(prep.executable.sha256, executable.sha256);
  for (const f of [prep.installation, prep.executable, prep.exported, installed.executable,
    ...installed.resources, ...installed.protectedFiles, ...(current?[]:[packaged.installer]), ...prep.tools])
    assert.equal(sha(f.path), f.sha256, f.path);
  assert.equal(path.resolve(prep.exported.path),
    path.resolve("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-49/report.json"));
  const exported = read(prep.exported.path);
  assert.equal(exported.status, "PASS"); assert(exported.finishedAt && !exported.cleanupError);
  assert.equal(exported.scope, "ACTUAL_1922_INSTALLED_EDITOR_NARRATIVE_BOUNDARY_UI_EXPORT");
  assert.equal(exported.steps.length, 3); assert(exported.steps.every(s => s.status === "PASS"));
  assert.deepEqual(prep.fixture, exported.fixture);
  assert.deepEqual(prep.cartridges, exported.cartridges); assert.equal(prep.cartridges.length, 2);
  assert.equal(prep.fixture.capacityVariant, "mixed-history-v2");
  for (const f of prep.cartridges) assert.equal(sha(f.path), f.sha256);
  assert.equal(sha(prep.fixture.input), prep.fixture.inputSha256);
  validateNarrativeFixture(read(prep.fixture.input), prep.fixture, fs.readFileSync(prep.fixture.voice.path));
  assert.equal(sha(exported.restoration.path), exported.restoration.sha256);
  assert.equal(read(exported.restoration.path).status, "PASS");
  assert(exported.cleanups.length && exported.cleanups.every(c => c.status === "PASS"));
  return { executable, scope: prep.scope };
}
module.exports = { validateCandidateNarrativePreparation, resolveNarrativeCandidate };
