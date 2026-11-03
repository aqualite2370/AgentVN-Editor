"use strict";
// Independent, read-only terminal checks. Never promote an original FAILED.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const [editorAttempt, playerAttempt, auditAttempt] = process.argv.slice(2);
for (const argument of [editorAttempt, playerAttempt, auditAttempt]) assert.match(argument, /^\d{2}$/);
const qa = "F:/AgentVN/QA/Installed-GUI-Library-1922-20261022-01";
const destination = path.join(qa, `terminal-${auditAttempt}.json`); assert(!fs.existsSync(destination));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => A.sha256(fs.readFileSync(file));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], modelRequests: 0,
  scope: "CURRENT_INSTALLED_COMPLETE_GUI_LIBRARY_AND_PREVIEW_ONLY_NOT_WHOLE_REGRESSION" };
async function check(name, action) {
  const row = { name, status: "RUNNING" }; report.cases.push(row);
  try { row.detail = await action(); row.status = "PASS"; } catch (error) { row.status = "FAILED"; throw error; }
}
(async () => {
  const editorFile = path.join(qa, `editor-${editorAttempt}/report.json`), editor = read(editorFile);
  const playerFile = path.join(qa, `player-${playerAttempt}/report.json`), player = read(playerFile);
  await check("sealed-candidate-default-db-and-dev-preserved", () => {
    assert.equal(editor.status, "EDITOR_PASS_NATIVE_PLAYER_NOT_RUN"); assert.equal(player.status, "PASS");
    assert.equal(editor.steps.length, 8); assert(editor.steps.every(row => row.status === "PASS"));
    assert.equal(editor.matrix.length, 12); assert.equal(player.cases.length, 12);
    assert(player.cases.every(row => row.status === "PASS" && row.checks.length === 4));
    assert.equal(editor.modelRequests + player.modelRequests, 0);
    assert.deepEqual(editor.errors, []); assert.deepEqual(player.errors, []);
    assert.equal(player.source.sha256, sha(editorFile));
    for (const file of editor.protectedFiles) assert.equal(sha(file.path), file.sha256, file.path);
    assert.equal(sha(player.executable.path), player.executable.sha256);
    assert.equal(sha(editor.cartridge.path), editor.cartridge.sha256);
    return { editor: { path: editorFile, sha256: sha(editorFile) }, player: { path: playerFile, sha256: sha(playerFile) },
      protectedFiles: editor.protectedFiles, nativePlayer: player.executable };
  });
  await check("complete-official-template-and-revision-records-still-exact", async () => {
    assert.equal(sha(editor.officialArchive.path), editor.officialArchive.sha256);
    assert.equal(editor.assetProofs.length, 26);
    assert.equal(sha(editor.libraryOriginal.path), editor.libraryOriginal.sha256);
    assert.equal(sha(editor.libraryRevision.path), editor.libraryRevision.sha256);
    const original = read(editor.libraryOriginal.path), revision = read(editor.libraryRevision.path);
    assert.equal(original.assetCount, 25); assert.equal(revision.assetCount, 25);
    assert.equal(original.revision, 1); assert.equal(revision.revision, 2);
    assert.equal(revision.parentId, original.id);
    const zip = await JSZip.loadAsync(fs.readFileSync(editor.cartridge.path), { checkCRC32: true });
    for (const asset of editor.cartridge.assets)
      assert.equal(A.sha256(await zip.file(asset.path).async("nodebuffer")), asset.sha256);
    assert.equal(A.sha256(await zip.file("ui/layout.json").async("nodebuffer")), editor.cartridge.layoutSha256);
    return { officialFiles: editor.officialFileCount, scannedResources: original.assetCount,
      copiedProjectResources: 26, exportedDependencies: editor.cartridge.assets.length, originalAndRevisionImmutable: true };
  });
  await check("actual-viewport-dpr-media-and-png-pixels", () => {
    const inherited = editor.inheritedMatrix ? read(editor.inheritedMatrix.path) : editor;
    if (editor.inheritedMatrix) assert.equal(sha(editor.inheritedMatrix.path), editor.inheritedMatrix.sha256);
    const shots = [...inherited.screenshots, ...editor.screenshots, ...player.screenshots];
    assert(shots.length >= 15);
    const unique = new Map(shots.map(shot => [shot.path, shot]));
    for (const shot of unique.values()) {
      assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
      const { width, height, dpr } = shot.before, roundedDpr = Math.round(dpr);
      assert([1, 2].includes(roundedDpr) && Math.abs(dpr - roundedDpr) <= 1e-6);
      const bytes = fs.readFileSync(shot.path);
      assert.equal(bytes.readUInt32BE(16), width * roundedDpr);
      assert.equal(bytes.readUInt32BE(20), height * roundedDpr);
    }
    return { screenshots: unique.size, installedEditorDisplays: 12, nativePlayerDisplays: 12,
      physical4KClaimed: false };
  });
  await check("all-successful-and-failed-attempts-finally-complete-with-no-owned-residue", () => {
    const sessions = fs.readdirSync(qa).filter(name => /^(editor|player)-\d{2}$/.test(name)).map(name => {
      const value = read(path.join(qa, name, "report.json")); assert(value.finishedAt, name);
      assert.equal(value.cleanupError, undefined, name);
      if (name.startsWith("editor-") && value.launches?.length) {
        assert.equal(value.nativeCacheRestoration, "PASS", name);
        const restoration = read(path.join(qa, name, "native-cache-restoration.json"));
        assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
        assert(value.cleanups.length > 0 && value.cleanups.every(row => row.status === "PASS"));
      }
      if (name.startsWith("player-") && value.launch) assert.equal(value.cleanupStatus, "PASS", name);
      return { name, value };
    });
    const processes = sessions.flatMap(({ value }) => value.knownProcesses || []);
    const identities = new Set(processes.map(p => `${p.ProcessId}:${p.Created}`));
    const ports = [...new Set(sessions.flatMap(({ value }) => value.launches?.flatMap(row => row.ports) || (value.launch ? [value.launch.port] : [])))];
    assert(identities.size > 0 && ports.length > 0);
    assert.deepEqual(rows().filter(p => identities.has(`${p.ProcessId}:${p.Created}`)), []);
    assert.deepEqual(listeners(ports), []);
    return { sessions: sessions.map(({ name, value }) => ({ name, originalStatus: value.status })),
      processIdentities: identities.size, ports, residue: [] };
  });
  await check("original-failures-retained-with-limited-conclusions", () => {
    for (const name of ["editor-01", "editor-02", "editor-03"]) assert.equal(read(path.join(qa, name, "report.json")).status, "FAILED");
    assert.equal(editor.boundaries.nativeDirectoryPicker, false);
    assert.equal(editor.boundaries.normalWindowClose, false);
    assert.equal(player.boundaries.standaloneGame, false); assert.equal(player.boundaries.android, false);
    assert.equal(player.boundaries.savesBesideExe, false);
    return { originalFailedReportsRetained: true, fullRegression: "INCOMPLETE",
      nativePickerAndClose: "NOT_PROVEN_HERE", standaloneGameAndAndroid: "NOT_RUN_HERE" };
  });
  assert.equal(report.cases.length, 5); assert(report.cases.every(row => row.status === "PASS")); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    report.tool = { path: __filename, sha256: sha(__filename) };
    fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, destination, cases: report.cases.length, error: report.error }));
  });
