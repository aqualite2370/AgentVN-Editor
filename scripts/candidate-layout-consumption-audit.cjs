"use strict";
// Audit retained installed evidence; do not launch apps or mutate original DBs.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { build, materialAssertion, validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const base = "F:/AgentVN/QA/Editor-1.9.31-20261027-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const display = { width: 1920, height: 1080, dpr: 1, reduced: false };
const special = ["confirmation", "nvl", "bubble"];
function checkRows(r) {
  assert.equal(r.status, "FAILED");
  assert.match(r.error, /Actual Runtime consumption failed/);
  assert(r.finishedAt && !r.cleanupError && !r.captureError);
  assert.equal(r.candidateVersion, "1.9.31");
  assert.equal(r.mode, "author"); assert.equal(r.modelRequests, 0);
  assert.equal(r.blockedModelRequests || 0, 0); assert.deepEqual(r.errors, []);
  assert.equal(r.pages.length, 23); assert.equal(r.expectedPages, 23);
  assert.equal(r.matrix.length, 1); assert.equal(r.steps.length, 25);
  assert(r.steps.every(s => s.status === "PASS" && s.finishedAt));
  const actualKeys = r.pages.map(p => p.type + "/" + p.id);
  assert.equal(new Set(actualKeys).size, 23);
  const expected = ["title", "player", "game_menu", "save_load", "preferences", "history", "gallery", "about",
    "confirmation", "nvl", "bubble"];
  assert.deepEqual([...actualKeys].sort(), ["agentvn", "renpy"].flatMap(t =>
    [...expected, ...(t === "renpy" ? ["help"] : [])].map(id => t + "/" + id)).sort());
  for (const p of r.pages) {
    assert.deepEqual(p.display, display); assert(p.author.otherTypeUnchanged);
    assert(p.geometry.saveHit && p.geometry.overflow <= 1);
    for (const { rect: rect, display: shown, overflow } of p.geometry.regions) {
      assert(shown !== "none" && overflow <= 1 && rect.width > 0 && rect.height > 0);
      assert(rect.left >= p.geometry.panel.left - 1 && rect.right <= p.geometry.panel.right + 1
        && rect.top >= p.geometry.panel.top - 1 && rect.bottom <= p.geometry.panel.bottom + 1);
    }
    const profile = r.profiles.profiles[p.type];
    const persisted = p.id === "confirmation" ? profile.confirmationLayout
      : special.includes(p.id) ? profile.dialogueLayouts[p.id]
        : profile.screens.find(s => s.screen_id === p.id).components.find(c => c.component_id === p.author.component);
    assert.deepEqual(persisted, p.author.persisted);
    if (p.id === "game_menu") {
      assert.equal(p.status, "FAILED"); assert.match(p.consumptionFailure, /No actual Runtime renderer|saved background is not consumed/);
      assert.equal(p.preview.kind, "FAILED_RUNTIME_CONSUMPTION");
      assert.equal(p.consumptionProbe.layoutType, p.type);
      if (p.type === "agentvn") assert.equal(p.consumptionProbe.present, false);
      else {
        assert.equal(p.consumptionProbe.count, 1);
        assert.equal(p.consumptionProbe.background, "rgba(0, 0, 0, 0)");
      }
      assert.throws(() => materialAssertion(p.consumptionProbe, p.author.persisted.style, p.id));
    } else {
      assert.equal(p.status, "PASS"); assert(!p.consumptionFailure);
      assert(p.preview.savedStyleConsumed);
      assert.match(p.preview.kind, /^ACTUAL_INSTALLED_(NODE_)?RUNTIME_IFRAME$/);
      const probe = p.preview.runtime;
      assert(probe.overflow <= 1 && !probe.focusUnavailable);
      if (special.includes(p.id)) {
        require("./candidate-1930-layout-author.cjs").assertPanelMaterial(probe, p.author.effectivePanelStyle, p.id);
        assert(p.author.unrelatedSettingsUnchanged);
      } else materialAssertion(probe, p.author.persisted.style, p.id);
    }
  }
  return { authoredPages: 23, actualMaterialPass: 21, actualMaterialFailures: 2,
    editorDisplays: [display], fullRuntimeMatrixClaimed: false, normalNativeCloseClaimed: false };
}

const matrix = [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
  [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
const displayKey = d => `${d.width}/${d.height}/${d.dpr}/${d.reduced}`;
function nativeDisplayMatches(actual, expected) {
  try { validateNativeViewport(actual, expected); return true; }
  catch { return false; }
}
function checkExistingDefaultRows(r, version) {
  assert.equal(r.status, "PASS");
  assert(r.finishedAt && !r.error && !r.cleanupError && !r.captureError);
  assert.equal(r.candidateVersion, version);
  assert.equal(r.mode, "author"); assert.equal(r.modelRequests, 0);
  assert.equal(r.blockedModelRequests || 0, 0); assert.deepEqual(r.errors, []);
  assert.deepEqual(r.testedTypes, ["agentvn", "renpy"]);
  assert.equal(r.expectedPages, 22); assert.equal(r.pages.length, 264);
  assert.equal(r.steps.length, 266);
  assert(r.steps.every(s => s.status === "PASS" && s.finishedAt));
  assert.equal(r.steps.at(-1).label, "Process restart preserves two layout profiles");
  assert.deepEqual(r.matrix, matrix.map(d => ({ ...d, status: "PASS", pageCount: 22 })));
  assert.equal(r.retainedDefaultMenu.length, 12);
  const legacy = r.profiles.profiles.agentvn.screens.find(s => s.screen_id === "game_menu");
  assert(legacy.components.some(c => c.component_type === "game_menu_nav"));
  for (const [index, retained] of r.retainedDefaultMenu.entries()) {
    assert.deepEqual(retained.display, matrix[index]); assert.deepEqual(retained.legacy, legacy);
  }
  const expected = ["title", "player", "save_load", "preferences", "history", "gallery", "about", ...special];
  const expectedKeys = ["agentvn", "renpy"].flatMap(t =>
    [...expected, ...(t === "renpy" ? ["help", "game_menu"] : [])].map(id => `${t}/${id}`)).sort();
  for (const d of matrix) {
    const pages = r.pages.filter(p => displayKey(p.display) === displayKey(d));
    assert.deepEqual(pages.map(p => `${p.type}/${p.id}`).sort(), expectedKeys);
  }
  for (const p of r.pages) {
    assert(matrix.some(d => displayKey(p.display) === displayKey(d)));
    assert.equal(p.status, "PASS"); assert(!p.consumptionFailure);
    assert(p.author.otherTypeUnchanged && p.geometry.saveHit && p.geometry.overflow <= 1);
    for (const { rect, display: shown, overflow } of p.geometry.regions) {
      assert(shown !== "none" && overflow <= 1 && rect.width > 0 && rect.height > 0);
      assert(rect.left >= p.geometry.panel.left - 1 && rect.right <= p.geometry.panel.right + 1
        && rect.top >= p.geometry.panel.top - 1 && rect.bottom <= p.geometry.panel.bottom + 1);
    }
    const profile = r.profiles.profiles[p.type];
    const persisted = p.id === "confirmation" ? profile.confirmationLayout
      : special.includes(p.id) ? profile.dialogueLayouts[p.id]
        : profile.screens.find(s => s.screen_id === p.id).components.find(c => c.component_id === p.author.component);
    assert.deepEqual(persisted, p.author.persisted);
    assert(p.preview.savedStyleConsumed);
    assert.match(p.preview.kind, /^ACTUAL_INSTALLED_(NODE_)?RUNTIME_IFRAME$/);
    const probe = p.preview.runtime;
    assert(probe.overflow <= 1 && !probe.focusUnavailable);
    if (special.includes(p.id)) {
      require("./candidate-1930-layout-author.cjs").assertPanelMaterial(probe, p.author.effectivePanelStyle, p.id);
      assert(p.author.unrelatedSettingsUnchanged);
      assert(probe.visible && probe.rect.width > 0 && probe.rect.height > 0);
      assert(probe.rect.left >= -1 && probe.rect.top >= -1
        && probe.rect.right <= probe.viewport.width + 1 && probe.rect.bottom <= probe.viewport.height + 1);
    } else {
      assert.equal(probe.layoutType, p.type);
      materialAssertion(probe, p.author.persisted.style, p.id);
    }
  }
  return { authoredPages: 264, actualMaterialPass: 264, actualMaterialFailures: 0,
    editorDisplays: matrix, legacyDefaultMenuRetained: true, fullRuntimeMatrixClaimed: false,
    normalNativeCloseClaimed: false };
}

assert.match(process.argv[2] || "", /^\d{2}$/);
assert.match(process.argv[3] || "", /^\d{2}$/);
const configArgs = process.argv.filter(arg => arg.startsWith("--candidate-config="));
assert(configArgs.length <= 1);
const config = configArgs.length ? validateCandidateConfig(read(configArgs[0].slice("--candidate-config=".length))) : null;
const roundtripArgs = process.argv.filter(arg => arg.startsWith("--roundtrip="));
assert(roundtripArgs.length <= 1);
const roundtripAttempt = roundtripArgs[0]?.slice("--roundtrip=".length);
if (roundtripAttempt) { assert(config); assert.match(roundtripAttempt, /^\d{2}$/); }
const playerArgs = process.argv.filter(arg => arg.startsWith("--player-report="));
assert(playerArgs.length <= 1);
const playerFile = playerArgs[0] && path.resolve(playerArgs[0].slice("--player-report=".length));
if (playerFile) {
  assert(config && roundtripAttempt);
  assert.equal(path.dirname(path.dirname(playerFile)), path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01"));
  assert.match(path.basename(path.dirname(playerFile)), /^authored-layout-\d+\.\d+\.\d+-\d{2}$/);
  assert.equal(path.basename(playerFile), "report.json");
}
const candidateBase = config?.qa ?? base, version = config?.version ?? "1.9.31";
const attempt = process.argv[2], run = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${attempt}`;
const out = `${candidateBase}/layout-consumption-audit-${attempt}-${process.argv[3]}`;
fs.mkdirSync(out, { recursive: false });
fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
  productChanges: 0, modelRequests: 0, builds: 0 };
function group(name, fn) {
  const item = { name, status: "RUNNING" }; report.groups.push(item);
  try { item.detail = fn(); item.status = "PASS"; }
  catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
}
try {
  report.input = describe(path.join(run, "report.json")); const r = read(report.input.path);
  group(config ? "All264 authored pages and actual materials; default pages remain unchanged"
    : "All23 authored pages,21 actual materials and2 retained Runtime failures", () => {
    const check = value => config ? checkExistingDefaultRows(value, version) : checkRows(value);
    const result = check(r);
    const bad = [x => x.pages = [], x => x.pages[1] = x.pages[0], x => x.matrix = [],
      x => x.finishedAt = null, x => x.modelRequests = 1,
      config ? x => x.retainedDefaultMenu[0].legacy = {} : x => x.pages.find(p => p.id === "game_menu").status = "PASS",
      x => x.pages.find(p => p.id === "title").preview.runtime.background = "rgb(0, 0, 0)",
      x => x.pages.find(p => p.id === "confirmation").preview.savedStyleConsumed = false];
    if (config) bad.push(x => x.matrix[0].dpr = 2, x => x.pages[0].author.otherTypeUnchanged = false,
      x => x.steps.at(-1).status = "FAILED", x => x.pages.find(p => p.id === "game_menu").preview.runtime.background = "transparent");
    for (const mutate of bad) { const x = structuredClone(r); mutate(x); assert.throws(() => check(x)); }
    return { ...result, invalidReportsRejected: bad.length };
  });
  group(`Actual${version} NSIS source and exact executed QA bytes`, () => {
    const binding = read(`${candidateBase}/layout-consumption-preparation-${attempt}/binding.json`);
    for (const f of [binding.source, binding.executed, binding.adapter, r.tool])
      assert.equal(sha(f.path), f.sha256);
    const actual = read(r.installation);
    assert.deepEqual(actual, deriveActual(actual.actualInstallation, version));
    if (config) assert.deepEqual(actual.actualInstallation, config.actual);
    const rebuilt = build(fs.readFileSync(binding.source.path, "utf8"), r.installation,
      config ? { version, agentvnNavigation: config.agentvnNavigation } : {});
    assert.deepEqual(rebuilt.adaptations, binding.adaptations);
    assert.equal(rebuilt.source, fs.readFileSync(binding.executed.path, "utf8"));
    assert.equal(r.launches.length, 2);
    for (const launch of r.launches) {
      assert.equal(sha(launch.executable.path), launch.executable.sha256);
      assert.equal(sha(launch.backend.ExecutablePath), launch.backend.sha256);
      assert(launch.dataDirectoryOverride && launch.webviewDirectoryOverride && !launch.sourceServer && !launch.manualBackendSpawn);
      assert.equal(launch.backend.ParentProcessId, launch.pid);
    }
    assert.notEqual(r.launches[0].created, r.launches[1].created);
    return { installedVersion: actual.version, exactAdaptations: binding.adaptations.length, hostStarts: 2 };
  });
  group("Saved profile bytes in a scratch SQLite copy, original archive unchanged", () => {
    const original = path.join(run, "data/backend/vn_engine.db"), before = describe(original);
    const copy = path.join(out, "vn_engine.scratch.db"); fs.copyFileSync(original, copy, fs.constants.COPYFILE_EXCL);
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      const records = db.prepare("SELECT project_json FROM editor_project_details").all();
      assert.equal(records.length, 1);
      assert.deepEqual(JSON.parse(records[0].project_json).editor_settings.runtimeUILayoutProfiles, r.profiles);
    } finally { db.close(); }
    assert.equal(sha(original), before.sha256);
    return { original: before, inspectionCopy: describe(copy), originalUnchanged: true };
  });
  group(config ? "96 screenshots with actual display/DPR/media and no viewport or media side effects"
    : "11 screenshots with actual1080p DPR1 parameters and no capture side effects", () => {
    // WebView reports raw floating-point DPR tails. Use the same strict native
    // viewport validator as capture, without rounding or rewriting evidence.
    const rawDisplay = { ...matrix[0], dpr: 1.00000001490116 };
    const beforeValidation = structuredClone(rawDisplay);
    assert(nativeDisplayMatches(rawDisplay, matrix[0]));
    assert.deepEqual(rawDisplay, beforeValidation);
    const invalidDisplays = [{ width: 1919 }, { height: 1079 }, { reduced: true },
      { dpr: 2 }, { dpr: 1.00001 }, { dpr: undefined }, { dpr: NaN }, { dpr: Infinity }];
    for (const patch of invalidDisplays)
      assert(!nativeDisplayMatches({ ...rawDisplay, ...patch }, matrix[0]));
    assert.equal(r.screenshots.length, config ? 96 : 11);
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const matches = config ? matrix.filter(d => nativeDisplayMatches(s.before, d)) : [display];
      assert.equal(matches.length, 1, "Exactly one requested native display must match");
      const expectedDisplay = matches[0];
      assert(expectedDisplay);
      validateNativeViewport(s.before, expectedDisplay); validateNativeViewport(s.after, expectedDisplay);
      const bytes = fs.readFileSync(s.path);
      assert.equal(bytes.readUInt32BE(16), expectedDisplay.width * expectedDisplay.dpr);
      assert.equal(bytes.readUInt32BE(20), expectedDisplay.height * expectedDisplay.dpr);
    }
    if (config) for (const d of matrix)
      assert.equal(r.screenshots.filter(s => nativeDisplayMatches(s.before, d)).length, 8);
    return { screenshotCount: r.screenshots.length, invalidNativeDisplaysRejected: invalidDisplays.length,
      rawDprPreserved: true, smallerEmbeddedPreviewSizesRetained: true, physical4KClaimed: false };
  });
  group("Original cache identity and bytes restored; no attributed processes or ports", () => {
    assert.equal(r.nativeCacheRestoration, "PASS");
    assert.deepEqual(r.cache.map(c => c.action), ["SelfTest", "Prepare", "Restore"]);
    assert(r.cache.every(c => c.exitCode === 0));
    const protection = read(path.join(run, "native-cache-protection.json"));
    const restored = read(path.join(run, "native-cache-restoration.json"));
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    assert.equal(restored.originalDirectory, protection.original);
    assert.equal(restored.originalDirectoryId, protection.directoryId);
    assert(!fs.existsSync(protection.held));
    for (const f of protection.files) assert.equal(sha(path.join(protection.original, f.relative)), f.sha256);
    assert(ps(`fsutil file queryfileid '${protection.original}';if($LASTEXITCODE){throw 'File ID query failed'}`)
      .includes(protection.directoryId));
    assert.equal(r.cleanups.length, 2); assert(r.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
    assert.deepEqual(listeners(r.cleanups.flatMap(c => c.ports)), []);
    const now = rows(); assert(r.knownProcesses.length > 0);
    for (const p of r.knownProcesses) assert(!now.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
    return { restoredFiles: protection.files.length, ownedProcesses: r.knownProcesses.length, survivors: 0 };
  });
  if (roundtripAttempt) group("Native project roundtrip, actual UI cartridge bytes and complete cleanup", () => {
    const roundtripFile = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${roundtripAttempt}/report.json`;
    const result = read(roundtripFile);
    assert.equal(result.status, "PASS_LIMITED_NATIVE_PROJECT_ROUNDTRIP_AND_UI_CARTRIDGE_EXPORT");
    assert.equal(result.version, version);
    assert(result.finishedAt && !result.cleanupError && !result.captureError && !result.error);
    assert.deepEqual(result.source, describe(report.input.path));
    assert.deepEqual(result.errors, []); assert.equal(result.modelRequests, 0);
    assert.equal(result.blockedModelRequests || 0, 0);
    assert.equal(result.cases.length, 5); assert(result.cases.every(c => c.status === "PASS" && c.finishedAt));
    assert.equal(result.nativeCacheRestoration, "PASS");
    assert.equal(result.cleanups.length, 2);
    assert(result.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
    assert.deepEqual(listeners(result.cleanups.flatMap(c => c.ports)), []);
    const now = rows();
    for (const identity of result.cleanups.flatMap(c => c.killed)) {
      const separator = identity.indexOf(":");
      const pid = Number(identity.slice(0, separator)), created = identity.slice(separator + 1);
      assert(!now.some(n => n.ProcessId === pid && n.Created === created));
    }
    for (const f of [result.portable, result.installation, result.source, result.tool,
      ...result.sourceFiles, ...result.installedOracleSources, ...result.cartridges])
      assert.equal(sha(f.path), f.sha256, f.path);
    assert.equal(result.downloadCleanup.status, "PASS");
    assert(!fs.existsSync(result.downloadCleanup.original));
    assert.equal(result.downloadCleanup.sha256, result.portable.sha256);
    assert.equal(result.downloadCleanup.deletedUserFiles, 0);
    for (const launch of result.launches) {
      assert.equal(sha(launch.executable.path), launch.executable.sha256);
      assert.equal(sha(launch.backend.ExecutablePath), launch.backend.sha256);
      assert(launch.dataDirectoryOverride && launch.webviewDirectoryOverride && !launch.sourceServer && !launch.manualBackendSpawn);
    }
    const cacheProtection = read(path.join(path.dirname(roundtripFile), "native-cache-protection.json"));
    const restoration = read(path.join(path.dirname(roundtripFile), "native-cache-restoration.json"));
    assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
    assert.equal(restoration.originalDirectoryId, cacheProtection.directoryId);
    assert(!fs.existsSync(cacheProtection.held));
    for (const f of cacheProtection.files) assert.equal(sha(path.join(cacheProtection.original, f.relative)), f.sha256);
    const worker = `
      const fs=require("node:fs"),assert=require("node:assert/strict"),crypto=require("node:crypto");
      const JSZip=require(${JSON.stringify(require.resolve("../editor/node_modules/jszip"))});
      const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
      (async()=>{
        const r=JSON.parse(fs.readFileSync(process.argv[1])),p=JSON.parse(fs.readFileSync(process.argv[2]));
        const portable=await JSZip.loadAsync(fs.readFileSync(r.portable.path),{checkCRC32:true});
        const project=JSON.parse(await portable.file("project.json").async("string"));
        assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles,p.profiles);
        assert.deepEqual(r.cartridges.map(c=>c.type),["agentvn","renpy"]);
        for(const c of r.cartridges){
          const z=await JSZip.loadAsync(fs.readFileSync(c.path),{checkCRC32:true});
          const bytes=await z.file("ui/layout.json").async("nodebuffer"),layout=JSON.parse(bytes);
          assert.equal(hash(bytes),c.layoutSha256);assert.equal(layout.layout_type??"agentvn",c.type);
          const checksum=JSON.parse(await z.file("checksum.json").async("string"));
          assert.equal(checksum.files.length,c.checksumEntries);assert(checksum.files.length>0);
          for(const f of checksum.files)assert.equal(hash(await z.file(f.path).async("nodebuffer")),f.hash_sha256);
        }
        console.log(JSON.stringify({portableProfilesPreserved:true,uiExports:2,checksumsVerified:true}));
      })().catch(e=>{console.error(e);process.exitCode=1});`;
    const bytes = JSON.parse(require("node:child_process").execFileSync(process.execPath,
      ["-e", worker, roundtripFile, report.input.path], { encoding: "utf8", windowsHide: true }));
    return { report: describe(roundtripFile), ...bytes, sourceArchiveUnchanged: true,
      downloadRemovedAfterRetention: true, nativeFilePickerClaimed: false, standaloneGameClaimed: false };
  });
  if (playerFile) group("Untouched UI cartridges in installed native Player;180 material/navigation checks and restoration", () => {
    const native = read(playerFile);
    const roundtripFile = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${roundtripAttempt}/report.json`;
    const roundtrip = read(roundtripFile);
    function check(value) {
      assert.equal(value.status, "PASS_LIMITED_INSTALLED_PLAYER_AUTHOR_MATERIAL_NAVIGATION_MATRIX");
      assert.equal(value.version, version);
      assert(value.finishedAt && !value.error && !value.cleanupError && !value.captureError);
      assert.deepEqual(value.errors, []);
      assert.equal(value.modelRequests + value.productChanges + value.builds, 0);
      assert.deepEqual(value.source, describe(roundtripFile));
      assert.deepEqual(value.installation, describe(config.actual.path));
      assert.equal(value.cases.length, 180); assert.equal(value.matrix.length, 24);
      assert.equal(value.screenshots.length, 24); assert.equal(value.launches.length, 2);
      assert.deepEqual(value.launches.map(l => l.type), ["agentvn", "renpy"]);
      if (version !== "1.9.31" || value.projectMarker) {
        assert.deepEqual(value.projectMarker, roundtrip.portable);
        for (const launch of value.launches) {
          assert.deepEqual(launch.arguments, ["--mode", "preview", "--cartridge", launch.cartridge.path]);
          assert.deepEqual(launch.isolation, {
            AGENTVN_TEST_PROJECT: roundtrip.portable.path,
            AGENTVN_WORKSPACE_OUTPUT: path.dirname(playerFile),
          });
        }
      }
      const ordinary = ["title", "preferences", "save_load", "about", "player", "history"];
      for (const type of ["agentvn", "renpy"]) for (const d of matrix) {
        const records = value.cases.filter(c => c.type === type && displayKey(c.display) === displayKey(d));
        const ids = [...ordinary, ...(type === "renpy" ? ["help", "game_menu"] : ["gallery"])];
        assert.deepEqual(records.map(c => c.id).sort(), ids.sort());
        const summaries = value.matrix.filter(c => c.type === type && displayKey(c) === displayKey(d));
        assert.equal(summaries.length, 1); assert.equal(summaries[0].status, "PASS");
        assert.equal(summaries[0].cases, ids.length);
        for (const c of records) {
          assert.equal(c.status, "PASS"); assert.equal(c.probe.layoutType, type);
          validateNativeViewport(c.probe.viewport, { width: d.width, height: d.height, dpr: d.dpr });
          assert.equal(c.probe.sharedNavigations, type === "agentvn" || ["title", "player"].includes(c.id) ? 0 : 1);
        }
        const screenshots = value.screenshots.filter(s =>
          path.basename(s.path) === `${type}-${d.width}-dpr${d.dpr}-${d.reduced}.png`);
        assert.equal(screenshots.length, 1);
        const s = screenshots[0];
        assert.deepEqual(s.before, s.after);
        validateNativeViewport(s.before, d); validateNativeViewport(s.after, d);
        const bytes = fs.readFileSync(s.path); assert.equal(sha(s.path), s.sha256);
        assert.equal(bytes.readUInt32BE(16), d.width * d.dpr);
        assert.equal(bytes.readUInt32BE(20), d.height * d.dpr);
      }
    }
    check(native);
    const invalid = [x => x.cases.pop(), x => x.matrix.pop(), x => x.screenshots.pop(),
      x => x.cases[0].id = "game_menu", x => x.cases[0].probe.sharedNavigations = 1,
      x => x.cases[0].probe.viewport.dpr = 2, x => x.cases[0].status = "FAILED",
      x => x.modelRequests = 1, x => x.cleanupError = "not restored", x => x.finishedAt = null];
    if (native.projectMarker) invalid.push(x => delete x.projectMarker,
      x => x.projectMarker.path = roundtripFile,
      x => x.launches[0].isolation.AGENTVN_TEST_PROJECT = roundtripFile,
      x => x.launches[0].arguments[3] = roundtripFile);
    for (const mutate of invalid) { const bad = structuredClone(native); mutate(bad); assert.throws(() => check(bad)); }
    const actual = deriveActual(config.actual, version);
    const player = actual.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
    assert.deepEqual(native.executable, player);
    assert.equal(sha(player.path), player.sha256);
    for (const f of [native.source, native.installation, native.tool]) assert.equal(sha(f.path), f.sha256);
    const executed = path.join(path.dirname(playerFile), "executed-test.cjs");
    assert.equal(sha(executed), native.tool.sha256);
    const now = rows();
    for (const launch of native.launches) {
      assert.deepEqual(launch.executable, player); assert.equal(launch.mode, "preview");
      assert.deepEqual(launch.cartridge, roundtrip.cartridges.find(c => c.type === launch.type));
      assert.equal(sha(launch.cartridge.path), launch.cartridge.sha256);
      assert.equal(path.resolve(launch.identity.ExecutablePath), path.resolve(player.path));
      assert.equal(launch.identity.ProcessId, launch.pid);
      assert.equal(launch.cleanup.status, "PASS"); assert.equal(launch.cleanup.normalCloseClaimed, false);
      assert(launch.knownProcesses.length > 0);
      for (const p of launch.knownProcesses)
        assert(!now.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
      assert.deepEqual(listeners([launch.port]), []);
    }
    const protection = read(path.join(path.dirname(playerFile), "profile-protection.json"));
    const restoration = read(path.join(path.dirname(playerFile), "profile-restoration.json"));
    assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
    assert.equal(restoration.removedOnlyOwnedJunctions, true);
    assert.equal(protection.records.length, 2); assert.equal(restoration.restored.length, 2);
    assert.deepEqual(native.profileCommands.map(c => c.action), ["Prepare", "Restore"]);
    assert(native.profileCommands.every(c => c.exitCode === 0));
    for (const record of protection.records) {
      const restored = restoration.restored.find(c => c.original === record.original);
      assert(restored); assert.equal(restored.directoryId, record.directoryId);
      assert(!fs.existsSync(record.held));
      assert(ps(`fsutil file queryfileid '${record.original}';if($LASTEXITCODE){throw 'File ID query failed'}`)
        .includes(record.directoryId));
      assert.deepEqual(restored.files, record.files);
      for (const f of record.files) assert.equal(sha(path.join(record.original, f.relative)), f.sha256);
    }
    // Parse the original cartridge layout independently, rather than trusting
    // the probe's PASS label or the author's persisted style in the report.
    const worker = `
      const fs=require("node:fs"),assert=require("node:assert/strict");
      const JSZip=require(${JSON.stringify(require.resolve("../editor/node_modules/jszip"))});
      const {materialAssertion}=require(${JSON.stringify(require.resolve("./candidate-layout-consumption.cjs"))});
      (async()=>{
        const n=JSON.parse(fs.readFileSync(process.argv[1])),r=JSON.parse(fs.readFileSync(process.argv[2]));
        const ids={title:"title_hero",player:"dialog_panel",game_menu:"game_menu_nav",save_load:"save_grid",
          preferences:"settings_group",history:"history_list",about:"about_panel",help:"help_panel",gallery:"gallery_grid"};
        for(const c of r.cartridges){
          const z=await JSZip.loadAsync(fs.readFileSync(c.path),{checkCRC32:true});
          const layout=JSON.parse(await z.file("ui/layout.json").async("string"));
          for(const row of n.cases.filter(x=>x.type===c.type)){
            const screen=layout.screens.find(s=>s.screen_id===row.id);
            const style=screen.components.find(x=>x.component_id===ids[row.id]).style;
            materialAssertion(row.probe,style,row.id);
            const bad=structuredClone(row.probe);bad.background="rgb(0, 0, 0)";
            assert.throws(()=>materialAssertion(bad,style,row.id));
          }
        }
        console.log(JSON.stringify({materials:180,badMaterialsRejected:180,cartridgesUnchanged:true}));
      })().catch(e=>{console.error(e);process.exitCode=1});`;
    const materials = JSON.parse(require("node:child_process").execFileSync(process.execPath,
      ["-e", worker, playerFile, roundtripFile], { encoding: "utf8", windowsHide: true }));
    assert.equal(sha(playerFile), describe(playerFile).sha256);
    return { report: describe(playerFile), ...materials, actualDisplays: 24, screenshots: 24,
      invalidReportsRejected: invalid.length, profileDirectoriesRestored: 2, normalCloseClaimed: false,
      environmentMarker: native.projectMarker
        ? { actual: native.projectMarker, status: "VERIFIED_PORTABLE_VNPROJ_MARKER_NOT_PLAYER_INPUT",
          playerInput: "public --cartridge argument" }
        : { actual: "roundtrip report.json", expected: "portable .vnproj",
          status: "QA_MARKER_INCORRECT_NOT_PLAYER_INPUT", playerInput: "public --cartridge argument" },
      specialStoryOrStandaloneSetupClaimed: false };
  });
  report.status = playerFile ? "PASS_LIMITED_INSTALLED_AUTHOR_ROUNDTRIP_AND_PLAYER_MATERIAL_MATRIX"
    : config ? "PASS_LIMITED_INSTALLED_AUTHOR_AND_IFRAME_MATERIAL_MATRIX"
    : "EVIDENCE_AUDIT_PASS_PRODUCT_FAILURES_RETAINED";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); report.tool = describe(__filename);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
}
