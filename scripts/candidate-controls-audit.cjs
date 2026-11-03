"use strict";
// Independent terminal review of the current complete author/native/export/player
// chain. No product startup, model call, source mutation or cleanup mutation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { normalizeInstalledControls } = require("./lib/installed-control-normalization.cjs");
const { validateNativeResult } = require("./lib/installed-acceptance.cjs");
const args = process.argv.slice(2), mode = args.shift();
assert(["self-test", "run"].includes(mode));
assert.equal(args.length, 5);
const [author, portable, playerAttempt, auditAttempt, configArg] = args;
assert([author, portable, playerAttempt, auditAttempt].every(n => /^\d{2}$/.test(n)));
assert(configArg.startsWith("--candidate-config="));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const configFile = configArg.slice(19), config = validateCandidateConfig(read(configFile));
const actual = deriveActual(config.actual, config.version);
const aRoot = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${author}`;
const eRoot = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${portable}`;
const pRoot = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/control-code-installed-${config.version.replaceAll(".", "")}-${playerAttempt}`;
const authorAuditFile = path.join(config.qa, `control-author-${author}-audit-02/report.json`);
const files = [path.join(aRoot, "report.json"), authorAuditFile, path.join(eRoot, "report.json"), path.join(pRoot, "report.json")];
const [a, independent, e, p] = files.map(read);
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const key = d => `${d.width}/${d.height}/${d.dpr}/${d.reduced}`;
function terminal(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError && !r.captureError);
  assert.equal(r.modelRequests, 0);
}
function authorBusiness(r) {
  terminal(r); assert.deepEqual(r.errors, []); assert.equal(r.cases.length, 12);
  for (const d of matrix) {
    const matches = r.cases.filter(c => key(c.display) === key(d)); assert.equal(matches.length, 1);
    const c = matches[0]; assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 6);
    assert(c.checks.every(c => c.status === "PASS"));
    const [image, code, , paused, , live] = c.checks.map(c => c.detail);
    assert.equal(image.bytes, live.image); assert(image.bytes.includes("<svg"));
    assert.equal(image.fit, "contain"); assert(image.font);
    assert.equal(code.tag, "BUTTON"); assert(code.html.includes('<slot name="content"></slot>'));
    assert.equal(paused.presentation.css, code.css); assert.equal(paused.presentation.html, code.html);
    assert.equal(live.tag, "BUTTON"); assert.equal(live.slotCount, "1");
  }
  assert.deepEqual(r.restart, { status: "PASS", fullProcessRestart: true });
  return { displays: 12, checks: 72, actualRestart: true };
}
function portableBusiness(r) {
  terminal(r); assert.deepEqual(r.errors, []); assert.equal(r.cases.length, 4);
  assert(r.cases.every(c => c.status === "PASS" && c.finishedAt));
  assert.equal(r.builds, 0); assert.equal(r.productChanges, 0);
  const native = r.nativePickerCompletion;
  validateNativeResult(native.request, native.result);
  assert(/Computer Use sky/.test(native.result.interaction));
  assert.equal(native.result.observations.projectTitle, "安装版普通设置与安全代码独立工程");
  assert.equal(native.request.ownerPid, r.launches[1].pid);
  assert.equal(path.resolve(native.result.selectedPath), path.resolve(r.portable.path));
  assert.equal(r.portable.archiveSameBytes, true);
  assert.equal(r.portable.nativeCleanupStatus, "REMOVED_AFTER_HASH_IDENTICAL_ARCHIVE_AND_UI_REIMPORT");
  assert(!fs.existsSync(r.portable.originalNativePath));
  assert.equal(sha(r.portable.path), r.portable.sha256);
  assert.equal(sha(r.cartridge.path), r.cartridge.sha256);
  return { flows: 4, freshDatabase: true, realNativeOpen: true, downloadsCleaned: true };
}
function playerBusiness(r) {
  terminal(r); assert.deepEqual(r.pageErrors, []);
  assert.equal(r.productChanges, 0); assert.equal(r.builds, 0);
  assert.equal(r.cells.length, 12); assert.equal(r.rawControlSamples.length, 36);
  for (const d of matrix) {
    const matches = r.cells.filter(c => key(c) === key(d)); assert.equal(matches.length, 1);
    const c = matches[0]; assert.equal(c.status, "PASS");
    for (const [name, color] of [["start", "rgb(127, 54, 100)"], ["about", "rgb(49, 91, 114)"]]) {
      const n = c[name], rect = n.rect;
      assert.equal(n.color, color); assert.equal(n.radius, `${6 * d.width / 1280}px`);
      assert.equal(n.tag, "BUTTON"); assert.equal(n.slotCount, "1");
      assert(n.hit && !n.disabled && !n.inert && n.text.trim() && n.overflow <= 1);
      assert(rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 &&
        rect.right <= d.width + 1 && rect.bottom <= d.height + 1);
      if (name === "start") {
        assert.equal(n.images.length, 1); assert.equal(n.images[0].sha256, e.cartridge.image.sha256);
      }
    }
    const x = c.start.rect, y = c.about.rect;
    assert(x.bottom <= y.top || y.bottom <= x.top || x.right <= y.left || y.right <= x.left);
    assert.deepEqual(c.aboutAction, { actualAbout: true, returned: true });
    const samples = r.rawControlSamples.filter(s => key(s.viewport) === key(d));
    assert.equal(samples.length, 3); assert(samples.every(s => s.actual.hit));
  }
  assert.deepEqual(r.story, { actualStartAction: true, text: "本轮独立 UI 验收，不影响用户工程。" });
  return { displays: 12, controlSamples: 36, aboutRoundtrips: 12, actualStart: 1 };
}
function negativeEvidence() {
  authorBusiness(a); portableBusiness(e); playerBusiness(p);
  const cases = [
    [a, authorBusiness, r => { r.cases = []; }],
    [a, authorBusiness, r => { r.cases[0] = r.cases[1]; }],
    [a, authorBusiness, r => { r.cases[0].checks.pop(); }],
    [a, authorBusiness, r => { r.cases[0].checks[5].detail.image = "wrong"; }],
    [a, authorBusiness, r => { r.restart.status = "NOT_RUN"; }],
    [e, portableBusiness, r => { r.cases.pop(); }],
    [e, portableBusiness, r => { r.nativePickerCompletion.result.ownerPid++; }],
    [e, portableBusiness, r => { r.nativePickerCompletion.result.selectedPath = "C:/wrong.vnproj"; }],
    [e, portableBusiness, r => { r.portable.nativeCleanupStatus = "PENDING"; }],
    [p, playerBusiness, r => { r.cells = []; }],
    [p, playerBusiness, r => { r.cells[0] = r.cells[1]; }],
    [p, playerBusiness, r => { r.cells[0].start.images[0].sha256 = "wrong"; }],
    [p, playerBusiness, r => { r.cells[0].about.hit = false; }],
    [p, playerBusiness, r => { r.cells[0].start.rect.right = 99999; }],
    [p, playerBusiness, r => { r.cells[0].aboutAction.returned = false; }],
    [p, playerBusiness, r => { r.rawControlSamples.pop(); }],
    [p, playerBusiness, r => { r.story.actualStartAction = false; }],
  ];
  for (const [original, validate, mutate] of cases) {
    const bad = structuredClone(original); mutate(bad); assert.throws(() => validate(bad));
  }
  return { invalidReceiptsRejected: cases.length, positiveBaselinesValidated: 3 };
}
async function bytes() {
  const installed = read(e.installation);
  assert.deepEqual(installed.executable, actual.executable);
  const portable = await JSZip.loadAsync(fs.readFileSync(e.portable.path), { checkCRC32: true });
  const document = JSON.parse(await portable.file("project.json").async("string"));
  assert.deepEqual(document.editor_settings.runtimeUILayoutProfiles, e.profiles);
  assert.deepEqual(e.profiles.profiles.agentvn, a.profiles.profiles.agentvn);
  const fixture = read(a.fixture.path);
  assert.deepEqual(a.profiles.profiles.agentvn, read(a.fixture.profilesSource).profiles.profiles.agentvn);
  const expected = Buffer.from(fixture.asset_manifest[0].metadata.data_url.split(",")[1], "base64");
  const asset = document.asset_manifest.find(x => x.asset_id === "qa-control-image");
  assert.deepEqual(await portable.file(asset.metadata.project_path).async("nodebuffer"), expected);
  const cartridge = await JSZip.loadAsync(fs.readFileSync(e.cartridge.path), { checkCRC32: true });
  const layoutBytes = await cartridge.file("ui/layout.json").async("nodebuffer");
  assert.equal(hash(layoutBytes), e.cartridge.layoutSha256);
  const layout = JSON.parse(layoutBytes), normalized = normalizeInstalledControls(installed, e.profiles.profiles.renpy);
  assert.deepEqual(layout, normalized.layout); assert.deepEqual(e.normalization, normalized.evidence);
  assert.equal(layout.advancedPresentationEnabled, true);
  for (const id of ["title_start_button", "title_about_button"]) {
    const control = l => l.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === id);
    assert.deepEqual(control(layout).presentation, control(e.profiles.profiles.renpy).presentation);
  }
  const manifest = JSON.parse(await cartridge.file("manifest.json").async("string"));
  assert.deepEqual(manifest, e.cartridge.manifest);
  const image = manifest.assets.find(x => x.asset_id === "qa-control-image");
  assert.deepEqual(await cartridge.file(image.path).async("nodebuffer"), expected);
  assert.equal(hash(expected), e.cartridge.image.sha256);
  return { bothLayoutsPreserved: true, originalImageBytes: true, installedNormalizationSources: normalized.evidence.sources.length };
}
function toolAndInstallation() {
  terminal(independent); assert.equal(independent.groups.length, 3); assert(independent.groups.every(g => g.status === "PASS"));
  assert.equal(independent.input.sha256, sha(files[0]));
  assert.equal(ps(`(Get-Item -LiteralPath '${actual.executable.path}').VersionInfo.FileVersion`), config.version);
  for (const [r, root] of [[a, aRoot], [independent, path.dirname(authorAuditFile)], [e, eRoot], [p, pRoot]]) {
    assert.equal(r.version, config.version);
    for (const f of [r.tool, r.qaBinding.source, r.qaBinding.configurationFile]) assert.equal(sha(f.path), f.sha256);
    assert.deepEqual(r.qaBinding.actualInstallation, config.actual);
    assert.equal(sha(path.join(root, "executed-business.cjs")), r.qaBinding.executedSourceSha256);
    assert.equal(r.qaBinding.inheritedBusinessResults, false);
  }
  const installed = read(e.installation);
  for (const f of [...installed.resources, ...installed.protectedFiles]) assert.equal(sha(f.path), f.sha256);
  for (const f of installed.protectedAbsent) assert(!fs.existsSync(f));
  assert.equal(p.executable.sha256, installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256);
  assert.deepEqual(p.launches[0].args, ["--mode", "preview", "--cartridge", e.cartridge.path]);
  return { editorVersion: config.version, playerVersion: ps(`(Get-Item -LiteralPath '${p.executable.path}').VersionInfo.FileVersion`),
    exactSourceAndInstallationHashes: true, inheritedResults: false };
}
function screenshotsAndCleanup() {
  const pngCounts = [];
  for (const r of [a, e, p]) {
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      assert(matrix.some(d => key(d) === key(s.before)));
      const b = fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    pngCounts.push(r.screenshots.length);
  }
  assert.deepEqual(pngCounts, [12, 3, 12]);
  const current = rows(), identities = new Set();
  for (const r of [a, e, p]) {
    assert(r.cleanups.length > 0 && r.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
    assert.deepEqual(listeners(r.cleanups.flatMap(c => c.ports ?? [c.port])), []);
    for (const process of r.knownProcesses) identities.add(`${process.ProcessId}:${process.Created}`);
    for (const c of r.cleanups) for (const id of c.killed ?? []) identities.add(id);
    for (const launch of r.launches) identities.add(`${launch.pid}:${launch.created}`);
  }
  for (const process of current) assert(!identities.has(`${process.ProcessId}:${process.Created}`));
  for (const root of [aRoot, eRoot]) {
    const protectedCache = read(path.join(root, "native-cache-protection.json"));
    const restored = read(path.join(root, "native-cache-restoration.json"));
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    assert.equal(restored.originalDirectoryId, protectedCache.directoryId);
    assert(!fs.existsSync(protectedCache.held));
    assert(ps(`fsutil file queryfileid '${protectedCache.original}'`).includes(protectedCache.directoryId));
    for (const f of protectedCache.files) assert.equal(sha(path.join(protectedCache.original, f.relative)), f.sha256);
  }
  const restored = read(path.join(pRoot, "profile-restoration.json"));
  assert.equal(p.profileRestored, true); assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
  for (const profile of restored.restored) {
    assert(ps(`fsutil file queryfileid '${profile.original}'`).includes(profile.directoryId));
    if (profile.byteInventory) for (const f of profile.files) assert.equal(sha(path.join(profile.original, f.relative)), f.sha256);
  }
  return { strictPNGs: 27, processIdentities: identities.size, originalCacheAndProfiles: true, downloadsRestored: true };
}
(async () => {
  if (mode === "self-test") {
    console.log(JSON.stringify({ status: "PASS", ...negativeEvidence(), scope: "OFFLINE_NO_PRODUCT_START" })); return;
  }
  const out = path.join(config.qa, `control-complete-audit-${auditAttempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: config.version, inputs: files.map(desc),
    config: desc(configFile), groups: [], modelRequests: 0, productChanges: 0, builds: 0,
    scope: "CURRENT_INSTALLED_SAFE_CONTROL_ORDINARY_CODE_NATIVE_PORTABLE_FRESH_REOPEN_EXPORT_PLAYER_NOT_ALL_CONTROLS_SETUP_UPGRADE_ANDROID",
    exclusions: ["all control types and six button-role states", "default physical profile", "normal Editor/Player close", "standalone setup", "upgrade", "Android", "real model"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g); save();
    try { g.detail = await fn(); g.status = "PASS"; }
    catch (error) { g.status = "FAILED"; g.error = String(error.stack || error); throw error; }
    finally { save(); }
  }
  try {
    await group("Complete 12-display author behavior, restart and 17 rejected bad receipts", () => ({ author: authorBusiness(a), ...negativeEvidence() }));
    await group("Actual native portable save, fresh database open and export", () => portableBusiness(e));
    await group("Exact installation/tool identities and independent author review", toolAndInstallation);
    await group("Both layouts, safe code, project and cartridge original bytes", bytes);
    await group("Actual Player control actions and images in twelve displays", () => playerBusiness(p));
    await group("Strict PNG receipts, original profiles/bytes and exact cleanup", screenshotsAndCleanup);
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL); save();
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
