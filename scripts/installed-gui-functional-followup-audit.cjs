"use strict";
// Independent evidence audit; no Editor/Player launch or product mutation.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = path.resolve(process.argv[2] || ""); assert(process.argv[2]);
const target = path.join(qa, "functional-followup-audit.json");
assert(!fs.existsSync(target), "Never overwrite an audit");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const evidence = file => ({ path: file, sha256: sha(file), generatedAt: fs.statSync(file).mtime.toISOString() });
const negativePath = path.join(qa, "editor-02/report.json"), authorPath = path.join(qa, "editor-04/report.json"),
  playerPath = path.join(qa, "player-02/report.json");
const negative = read(negativePath), author = read(authorPath), player = read(playerPath);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
  sources: [negativePath, authorPath, playerPath].map(evidence),
  limitations: ["No product changes, product builds or paid model calls",
    "Native pickers used repository Windows UI Automation; not Computer Use",
    "Viewport/DPR emulation is not a physical 4K monitor",
    "This group does not prove native normal close, default-account migration, upgrades, Android or final user project",
    "Prior editor-03 was a QA ambiguous selector failure, not a product failure; original report retained",
    "Earlier inline audit used invalid exact floating-point DPR multiplication; corrected within capture tolerance without rerunning product"] };
async function check(name, body) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.result = await body(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
function identity(file) { assert.equal(sha(file.path), file.sha256); return file.sha256; }
function screenshot(shot) {
  identity(shot); const b = fs.readFileSync(shot.path);
  assert.equal(b.readUInt32BE(16), shot.png.width); assert.equal(b.readUInt32BE(20), shot.png.height);
  assert(Math.abs(shot.png.width - shot.before.width * shot.before.dpr) < 1e-3);
  assert(Math.abs(shot.png.height - shot.before.height * shot.before.dpr) < 1e-3);
  assert.deepEqual(shot.before, shot.after);
}
(async () => {
  await check("Same actual installation identities and frozen source evidence", () => {
    assert.equal(negative.status, "PASS"); assert.equal(author.status, "EDITOR_PASS_PLAYER_NOT_RUN");
    assert.equal(player.status, "PASS");
    const editorHash = identity(author.installation.executable);
    assert.equal(editorHash, negative.installation.executable.sha256); assert.equal(editorHash, player.installation.editorSha);
    assert.equal(sha(player.installation.playerExe), player.installation.playerSha);
    assert.equal(identity(player.editorReport), sha(authorPath));
    assert.equal(identity(negative.source), identity(author.source));
    return { editorHash, playerHash: player.installation.playerSha, version: author.installation.executable.version };
  });
  await check("Eight scanner issues, real failed application and unchanged project/library/asset bytes", () => {
    assert.equal(negative.cases.length, 8);
    assert(negative.cases.every(c => c.status === "PASS" && c.projectUnchanged && c.libraryUnchanged));
    assert.equal(new Set(negative.cases.map(c => c.name)).size, 8);
    assert.equal(negative.assetProofs.length, 26); assert.equal(negative.libraryBaseline.length, 4);
    assert.match(negative.conflictError, /BINDING_CONFLICT:title_background/);
    for (const file of negative.libraryBaseline)
      assert.equal(sha(path.join(path.dirname(negative.source.path), "data/gui-pack-library", file.relative)), file.sha256);
    for (const c of negative.cases) identity(c.artifact);
    return { cases: 8, unchangedAssets: 26, unchangedLibraryFiles: 4, failedApply: negative.conflictError };
  });
  await check("Fresh database native import and four real owned OS picker actions", () => {
    assert.equal(author.steps.length, 7); assert(author.steps.every(s => s.status === "PASS"));
    assert.equal(author.nativeInputs.length, 4);
    assert.deepEqual(author.nativeInputs.map(n => n.request.name),
      ["portable-open", "directory-cancel", "directory-scan", "directory-library"]);
    for (const n of author.nativeInputs) {
      const actual = read(n.evidence);
      assert.deepEqual(actual, n.receipt); assert.equal(actual.status, "PASS");
      assert.equal(n.result.code, 0); assert.equal(actual.ownerPid, n.request.ownerPid);
      assert.equal(actual.cancel, n.request.cancel); assert.equal(actual.method, "Windows UI Automation");
    }
    assert(author.steps[0].result.independentDatabase && author.steps[0].result.personalLibraryEmpty);
    const library = read(author.directoryPack.path); assert.equal(library.scan.assets.length, 25);
    identity(author.directoryPack);
    for (const a of library.scan.assets)
      assert.equal(hash(Buffer.from(a.bytesBase64, "base64")),
        author.directoryPack.assets.find(p => p.path === a.path).sha256);
    return { nativeActions: 4, officialLibraryAssets: 25, independentDatabase: true };
  });
  await check("Portable and cartridge contain exact resource bytes and active layout after selective application", async () => {
    const portable = await JSZip.loadAsync(fs.readFileSync(author.portable.path), { checkCRC32: true });
    const packed = JSON.parse(await portable.file("project.json").async("string"));
    identity(author.portable); identity(author.portableImport);
    assert.equal(packed.asset_manifest.length, 26);
    assert.deepEqual(packed.editor_settings.runtimeUILayoutProfiles, author.finalProject.editor_settings.runtimeUILayoutProfiles);
    for (const a of packed.asset_manifest)
      assert.equal(hash(await portable.file(a.metadata.project_path).async("nodebuffer")),
        author.assetProofs.find(p => p.id === a.asset_id).sha256);
    const cart = await JSZip.loadAsync(fs.readFileSync(author.cartridge.path), { checkCRC32: true });
    identity(author.cartridge); assert.equal(author.cartridge.sha256, player.cartridge.sha256);
    const manifest = JSON.parse(await cart.file("manifest.json").async("string"));
    const layout = JSON.parse(await cart.file("ui/layout.json").async("string"));
    assert.deepEqual(layout, author.finalProject.editor_settings.runtimeUILayout);
    assert.equal(layout.renpy.shared.x, 40); assert.equal(manifest.assets.length, 6);
    for (const a of manifest.assets)
      assert.equal(hash(await cart.file(a.path).async("nodebuffer")),
        author.assetProofs.find(p => p.id === a.asset_id).sha256);
    assert(!cart.file("project.json") && !layout.profiles);
    return { portable: evidence(author.portable.path), cartridge: evidence(author.cartridge.path),
      retainedAssets: 26, exportedDependencies: 6 };
  });
  await check("Twelve real display combinations and actual passive Player resource consumption", () => {
    const expected = new Set();
    for (const w of [1920, 2560, 3840]) for (const d of [1, 2]) for (const r of [false, true]) expected.add(`${w}/${d}/${r}`);
    for (const suite of [author, player]) {
      assert.equal(suite.matrix.length, 12);
      assert.deepEqual(new Set(suite.matrix.map(m => `${m.width}/${m.dpr}/${m.reduced}`)), expected);
      assert(suite.matrix.every(m => m.status === "PASS"));
    }
    const required = author.cartridge.assets.map(a => a.sha256);
    for (const m of player.matrix) {
      for (const sha of required) assert(m.resources.includes(sha));
      assert.equal(m.titleBackground.sha256,
        author.cartridge.assets.find(a => a.relative === "gui/main_menu.png").sha256);
    }
    for (const sha of required) assert(player.passiveResources.some(r => r.sha256 === sha));
    assert.equal(player.missingRuntimeResources.length, 0); assert.equal(player.cases.length, 96);
    assert(player.cases.every(c => c.status === "PASS"));
    const shots = [...negative.screenshots, ...author.screenshots, ...player.cases.filter(c => c.png)];
    for (const shot of shots) screenshot(shot);
    return { authorMatrix: 12, playerMatrix: 12, playerChecks: 96, screenshots: shots.length,
      passiveDependenciesPerCell: required.length, retainedResponseReadDiagnostics: player.responseReadErrors };
  });
  await check("No paid calls or page errors; exact-owned processes, ports, caches and Downloads cleaned", () => {
    assert.equal(negative.modelRequests, 0); assert.equal(author.modelRequests, 0);
    for (const suite of [negative, author, player]) assert.deepEqual(suite.errors, []);
    const live = rows();
    for (const suite of [negative, author]) {
      assert.equal(suite.immutableStatus, "PASS"); assert(suite.cleanups.length && suite.cleanups.every(c => c.status === "PASS"));
      for (const launch of suite.launches) assert.equal(listeners(launch.ports).length, 0);
      for (const p of suite.knownProcesses)
        assert(!live.some(q => q.ProcessId === p.ProcessId && q.Created === p.Created));
      identity(suite.nativeCacheRestoration); assert.equal(read(suite.nativeCacheRestoration.path).status, "PASS");
    }
    assert.equal(player.cleanup.exitCode, 0);
    assert(!live.some(p => p.ProcessId === player.playerPid));
    assert.equal(author.downloadCleanup.status, "PASS"); assert(!fs.existsSync(author.nativeSaveSource.path));
    assert.equal(author.downloadCleanup.deletedUserFiles, 0);
    const stageRoots = [
      "C:/Users/1/AppData/Local/com.agentvn.editor/renpy-gui-import",
      "C:/Users/1/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/com.agentvn.editor/renpy-gui-import",
    ];
    const ownPids = author.launches.map(l => l.pid);
    const staging = stageRoots.map(directory => ({ directory, exists: fs.existsSync(directory),
      ownedFiles: fs.existsSync(directory) ? fs.readdirSync(directory).filter(n =>
        ownPids.some(pid => n.startsWith(`gui-import-${pid}-`))) : [] }));
    assert(staging.every(s => s.ownedFiles.length === 0));
    return { modelRequests: 0, cleanupGroups: negative.cleanups.length + author.cleanups.length + 1,
      ownedStaging: staging, normalClose: "NOT_RUN" };
  });
  assert.equal(report.checks.length, 6); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString();
    fs.writeFileSync(target, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, target, sha256: sha(target), checks: report.checks.length, error: report.error }));
  });
