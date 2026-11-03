"use strict";
// Independent author/configuration and natural-state evidence review. The
// unsupported persistent/transient states remain explicit, never inferred.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { normalizeInstalledControls } = require("./lib/installed-control-normalization.cjs");
const [mode, authorAttempt, playerAttempt, auditAttempt, configArg] = process.argv.slice(2);
assert(["self-test", "run"].includes(mode));
assert([authorAttempt, playerAttempt, auditAttempt].every(n => /^\d{2}$/.test(n)));
assert(configArg.startsWith("--candidate-config="));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const config = validateCandidateConfig(read(configArg.slice(19))), actual = deriveActual(config.actual, config.version);
const aRoot = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${authorAttempt}`;
const pRoot = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/roles-installed-${config.version.replaceAll(".", "")}-${playerAttempt}`;
const aFile = path.join(aRoot, "report.json"), pFile = path.join(pRoot, "report.json");
const a = read(aFile), p = read(pFile);
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const key = r => `${r.width}/${r.height}/${r.dpr}/${r.reduced}`;
const roleIds = ["title_action", "page_navigation", "category_pagination", "story_choice", "quick_bar", "modal_action"];
const states = ["normal", "hover", "selected", "disabled"];
function terminal(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError && !r.captureError && !r.screenshotError);
  assert.equal(r.modelRequests, 0); assert.equal(r.productChanges, 0);
}
function author(r) {
  terminal(r); assert.deepEqual(r.errors, []); assert.equal(r.builds, 0);
  assert.equal(r.version, config.version); assert.equal(r.cases.length, 4);
  assert(r.cases.every(c => c.status === "PASS" && c.finishedAt));
  assert.equal(r.matrix.length, 12); assert.deepEqual(Object.keys(r.expected), roleIds);
  const saved = r.authored.settings.runtimeUILayoutProfiles;
  assert.equal(saved.activeType, "renpy");
  assert.deepEqual(saved.profiles.renpy.renpy.shared.buttonRoles, r.expected);
  const before = read(r.prior.path).profiles;
  assert.deepEqual(saved.profiles.agentvn, before.profiles.agentvn);
  function stripRoles(layout) {
    const copy = structuredClone(layout);
    for (const [scope, value] of Object.entries(copy.renpy ?? {})) {
      delete value.buttonRoles;
      if (!Object.keys(value).length) delete copy.renpy[scope];
    }
    if (copy.renpy && !Object.keys(copy.renpy).length) delete copy.renpy;
    return copy;
  }
  assert.deepEqual(stripRoles(saved.profiles.renpy), stripRoles(before.profiles.renpy));
  for (const id of roleIds) {
    assert.equal(Object.keys(r.expected[id].geometry).length, 5);
    assert.deepEqual(Object.keys(r.expected[id].states), states);
    for (const state of states) assert.equal(Object.keys(r.expected[id].states[state]).length, 5);
    assert.equal(saved.profiles.renpy.renpy[id === "story_choice" || id === "quick_bar" ? "player" : "title"]?.buttonRoles?.[id], undefined);
  }
  for (const d of matrix) {
    const found = r.matrix.filter(c => key(c.display) === key(d)); assert.equal(found.length, 1);
    const c = found[0]; assert.equal(c.status, "PASS"); assert.equal(c.controls.length, 24);
    for (const id of roleIds) for (const state of states) {
      const matches = c.controls.filter(x => x.role === id && x.state === state); assert.equal(matches.length, 1);
      const { values, geometry: g } = matches[0], rect = g.rect;
      assert.deepEqual(values, Object.fromEntries(Object.entries(r.expected[id].states[state]).map(([k, v]) => [k, String(v)])));
      assert(g.visible && g.hit && g.overflow <= 1 && rect.width > 0 && rect.height > 0 &&
        rect.left >= 0 && rect.top >= 0 && rect.right <= d.width + 1 && rect.bottom <= d.height + 1);
    }
  }
  assert.deepEqual(r.cases[2].detail, { actualRestart: true, bothProfilesIdentical: true });
  return { roles: 6, authoredStates: 24, displays: 12, stateEditors: 288, exactValues: 1440, actualRestart: true, unrelatedLayoutsUnchanged: true };
}
function player(r) {
  terminal(r); assert.equal(r.version, config.version);
  assert.deepEqual(r.pageErrors, []); assert.deepEqual(r.violations, []);
  assert.equal(r.checks.length, 3); assert(r.checks.every(c => c.status === "PASS"));
  assert.equal(r.matrix.length, 12); assert.equal(r.storyMatrix.length, 12);
  const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
  const autoColor = a.authored.settings.runtimeUILayoutProfiles.profiles.renpy.screens.find(s => s.screen_id === "player")
    .components.find(c => c.component_id === "quick_auto_button").style.color;
  for (const d of matrix) {
    const menu = r.matrix.filter(c => key(c.viewport) === key(d)), story = r.storyMatrix.filter(c => key(c.display) === key(d));
    assert.equal(menu.length, 1); assert.equal(story.length, 1);
    assert.equal(menu[0].status, "PASS"); assert(menu[0].executed); assert.equal(menu[0].samples.length, 17);
    assert.equal(story[0].status, "PASS"); assert.equal(story[0].samples.length, 6);
    for (const c of [...menu[0].samples, ...story[0].samples]) {
      const rect = c.rect;
      const localQuick = c.role === "quick_bar" && c.expectedState === "normal";
      assert.equal(c.color, rgb(localQuick ? autoColor : a.expected[c.role].states[c.expectedState].textColor));
      assert(c.hit && !c.clipped && !c.textOutsideButton && c.opacity > 0 && c.overflow <= 1 && rect.width > 0 && rect.height > 0 &&
        rect.left >= -1 && rect.top >= -1 && rect.right <= c.width + 1 && rect.bottom <= c.height + 1);
    }
    for (const [first, second] of [[story[0].samples[0], story[0].samples[1]], [story[0].samples[0], story[0].samples[2]],
      [story[0].samples[3], story[0].samples[4]], [story[0].samples[3], story[0].samples[5]]])
      for (const name of ["x", "y", "width", "height"]) assert(Math.abs(first.rect[name] - second.rect[name]) <= .15);
    assert.equal(story[0].samples[5].role, "story_choice");
    assert.equal(story[0].samples[5].state, "selected"); assert.equal(story[0].samples[5].label, "继续");
    assert(menu[0].samples.some(c => c.focusVisible && c.focused));
    assert(menu[0].modalGeometry.buttons.length >= 2);
  }
  return { displays: 12, menuSamples: 204, storySamples: 72, actualBranchRollback: true,
    normalQuickLocalOverride: autoColor, full24NaturalStatesClaim: false };
}
function negatives() {
  author(a); player(p);
  const cases = [
    [a, author, r => { r.matrix = []; }], [a, author, r => { r.matrix[0] = r.matrix[1]; }],
    [a, author, r => { r.matrix[0].controls.pop(); }],
    [a, author, r => { r.matrix[0].controls[0].values.textColor = "#000000"; }],
    [a, author, r => { r.matrix[0].controls[0].geometry.hit = false; }],
    [a, author, r => { r.authored.settings.runtimeUILayoutProfiles.profiles.agentvn.marker = "pollution"; }],
    [a, author, r => { r.cases[2].detail.actualRestart = false; }],
    [p, player, r => { r.matrix = []; }], [p, player, r => { r.storyMatrix = []; }],
    [p, player, r => { r.matrix[0].samples.pop(); }],
    [p, player, r => { r.storyMatrix[0].samples[0].color = "rgb(0, 0, 0)"; }],
    [p, player, r => { r.storyMatrix[0].samples[5].state = "normal"; }],
    [p, player, r => { r.storyMatrix[0].samples[2].rect.width += 10; }],
    [p, player, r => { r.violations.push({}); }],
  ];
  for (const [original, validate, mutate] of cases) { const bad = structuredClone(original); mutate(bad); assert.throws(() => validate(bad)); }
  return { invalidReceiptsRejected: cases.length };
}
async function bytes() {
  for (const f of [a.fixture, a.installation, a.prior, a.portable, a.cartridge, a.tool, a.originalBusiness, p.tool,
    p.author, p.qaBinding.config, p.qaBinding.installation, p.qaBinding.business, p.qaBinding.session, ...actual.resources])
    assert.equal(sha(f.path), f.sha256);
  assert.equal(p.author.sha256, sha(aFile));
  assert.equal(sha(path.join(aRoot, "executed-business.cjs")), a.executedBusinessSha256);
  assert.equal(sha(path.join(pRoot, "executed-business.cjs")), p.qaBinding.executedSourceSha256);
  assert.equal(p.source.sha256, a.cartridge.sha256);
  const portable = await JSZip.loadAsync(fs.readFileSync(a.portable.path), { checkCRC32: true });
  const document = JSON.parse(await portable.file("project.json").async("string"));
  assert.deepEqual(document.editor_settings.runtimeUILayoutProfiles, a.authored.settings.runtimeUILayoutProfiles);
  const cart = await JSZip.loadAsync(fs.readFileSync(a.cartridge.path), { checkCRC32: true });
  const skin = JSON.parse(await cart.file("ui/layout.json").async("string"));
  const normalized = normalizeInstalledControls(read(a.installation.path), a.authored.settings.runtimeUILayoutProfiles.profiles.renpy);
  assert.deepEqual(skin, normalized.layout); assert.deepEqual(normalized.evidence, a.normalization);
  assert.deepEqual(skin.renpy.shared.buttonRoles, a.expected);
  assert.equal(a.downloadCleanup.status, "PASS"); assert(!fs.existsSync(a.downloadCleanup.removed.path));
  assert.equal(a.downloadCleanup.retained.sha256, a.portable.sha256);
  const script = JSON.parse(await cart.file("scripts/main.json").async("string"));
  assert(script.scenes.some(s => s.commands.some(c => c.type === "choice" && c.choices.length === 2)));
  return { exactToolAndInstallHashes: true, bothProfilesAnd24StatesPortable: true, activeExportNormalized: true, storyNotRewritten: true };
}
function cleanup() {
  const pngCounts = [];
  for (const r of [a, p]) {
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after); assert(matrix.some(d => key(d) === key(s.before)));
      const bytes = fs.readFileSync(s.path);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    pngCounts.push(r.screenshots.length);
  }
  assert.deepEqual(pngCounts, [12, 24]);
  const current = rows(), identities = new Set();
  for (const c of a.cleanups) {
    assert.equal(c.status, "PASS"); assert.equal(c.normalCloseClaimed, false); assert.deepEqual(listeners(c.ports), []);
    for (const identity of c.killed) identities.add(identity);
  }
  for (const launch of p.launches) {
    assert.equal(launch.cleanup.status, "PASS"); assert.deepEqual(listeners([launch.port]), []);
    for (const process of launch.knownProcesses) identities.add(`${process.ProcessId}:${process.Created}`);
    assert.equal(launch.executableSha256, actual.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256);
    assert.equal(launch.cartridge.sha256, a.cartridge.sha256);
  }
  for (const process of current) assert(!identities.has(`${process.ProcessId}:${process.Created}`));
  const cache = read(path.join(aRoot, "native-cache-protection.json")), cacheRestored = read(path.join(aRoot, "native-cache-restoration.json"));
  assert.equal(a.nativeCacheRestoration, "PASS"); assert.equal(cacheRestored.status, "PASS"); assert.equal(cacheRestored.deletedUserFiles, 0);
  assert.equal(cacheRestored.originalDirectoryId, cache.directoryId); assert(!fs.existsSync(cache.held));
  assert(ps(`fsutil file queryfileid '${cache.original}'`).includes(cache.directoryId));
  for (const f of cache.files) assert.equal(sha(path.join(cache.original, f.relative)), f.sha256);
  const restored = read(path.join(pRoot, "profile-restoration.json"));
  assert.deepEqual(p.profileRestoration, restored); assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
  for (const record of restored.restored) {
    assert(ps(`fsutil file queryfileid '${record.original}'`).includes(record.directoryId));
    if (record.byteInventory) for (const f of record.files) assert.equal(sha(path.join(record.original, f.relative)), f.sha256);
  }
  for (const f of read(a.installation.path).protectedFiles) assert.equal(sha(f.path), f.sha256);
  return { strictPNGs: 36, processIdentities: identities.size, originalCacheProfilesAndProtectedBytes: true, downloadsCleaned: true };
}
(async () => {
  if (mode === "self-test") { console.log(JSON.stringify({ status: "PASS", ...negatives(), productStarts: 0 })); return; }
  const out = path.join(config.qa, `role-complete-audit-${auditAttempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: config.version,
    inputs: [aFile, pFile].map(desc), groups: [], builds: 0, productChanges: 0, modelRequests: 0,
    scope: "SIX_ROLE_AUTHOR_AND_CURRENT_PLAYER_NATURAL_STATES_NOT_FULL_24_NATURAL_STATES_SETUP_UPGRADE_ANDROID",
    remaining: ["title has no persistent selected state", "title/navigation transient disabled", "modal transient selected/disabled",
      "choice transient disabled", "quick disabled", "native role-package fresh-profile reopen", "setup/upgrade/Android"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g); save();
    try { g.detail = await fn(); g.status = "PASS"; } catch (error) { g.status = "FAILED"; g.error = String(error.stack || error); throw error; }
    finally { save(); }
  }
  try {
    await group("Six roles, twenty-four states, twelve author displays and inactive-layout isolation", () => author(a));
    await group("204 real menu and 72 story/quickbar samples with actions and envelopes", () => player(p));
    await group("Fourteen invalid receipts rejected", negatives);
    await group("Exact installation, tools, portable layouts and actual UI export", bytes);
    await group("Strict DPR PNGs, cache/profile identity, bytes and owned cleanup", cleanup);
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL); save();
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
