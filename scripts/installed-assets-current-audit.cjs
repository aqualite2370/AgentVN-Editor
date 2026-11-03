"use strict";
// Independent evidence inspection only. No UI, process launch, model or device.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { validate, types } = require("./lib/installed-assets-evidence.cjs");
const candidate = require("./lib/installed-assets-candidate.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const qa = candidate.qaRoot;
const attempt = process.argv[2] || "01", audit = process.argv[3] || "01";
for (const a of [attempt, audit]) assert.match(a, /^\d{2}$/);
const source = path.join(qa, `editor-${attempt}`), out = path.join(qa, `editor-${attempt}-audit-${audit}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const input = path.join(source, "report.json"), r = read(input);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(input), groups: [],
  scope: "ACTUAL_INSTALLED_ASSET_REPLACEMENT_SAVE_RESTART_EXPORT_EVIDENCE_NOT_PLAYER_OR_FULL_G16",
  productChanges: 0, modelRequests: 0, builds: 0, launches: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function group(name, fn) {
  const c = { name, status: "RUNNING" }; report.groups.push(c); save();
  try { c.result = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; } finally { save(); }
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  await group("Exact installed binary/packaged backend, source snapshots and complete nonempty business evidence", () => {
    const summary = validate(r, candidate.editor), installation = read(r.installation.path);
    assert.equal(path.resolve(r.installation.path), path.resolve(candidate.installationFile));
    assert.equal(installation.status, "PASS");
    assert.equal(candidate.current ? (installation.version || installation.executable.version) : installation.executable.version, r.version);
    assert.deepEqual(installation.executable, r.executable);
    for (const f of [r.installation, r.executable, r.fixture, r.sourceFixture, ...r.protectedFiles, r.portable, r.cartridge])
      assert.equal(sha(f.path), f.sha256, f.path);
    for (const s of r.snapshots) {
      assert.equal(sha(s.copy.path), s.copy.sha256); assert.equal(s.copy.sha256, s.source.sha256);
      if (/\.(cjs|ps1)$/.test(s.source.path)) assert.equal(sha(s.source.path), s.source.sha256);
    }
    for (const l of r.launches) {
      assert.equal(path.resolve(l.backend.ExecutablePath), path.resolve(installation.installRoot, "creator-backend.exe"));
      assert.equal(sha(l.backend.ExecutablePath), l.backend.sha256);
      assert.equal(l.listeners.length, 2); assert.equal(l.executable.path, r.executable.path);
      assert(path.resolve(l.data).startsWith(path.resolve(source) + path.sep));
      assert(path.resolve(l.webview).startsWith(path.resolve(source) + path.sep));
      assert([r.fixture.path, r.portable.path].includes(l.isolation.AGENTVN_TEST_PROJECT));
    }
    return { ...summary, protectedDistinctPaths: new Set(r.protectedFiles.map(f => path.resolve(f.path))).size,
      actualPackagedBackends: r.launches.length, tools: r.snapshots.length };
  });
  await group("Eleven replacement identities/metadata and six no-mutation failure paths", () => {
    assert.deepEqual(r.replacements.map(a => a.type), types);
    for (const a of r.replacements) {
      const fixture = r.fixtureMedia.find(t => t.type === a.type);
      for (const f of Object.values(fixture.files)) assert.equal(sha(f.path), f.sha256);
      assert.equal(a.oldSha256, fixture.files.old.sha256); assert.equal(a.newSha256, fixture.files.new.sha256);
      assert.equal(a.metadata.display_name, `${a.type}保留名称`);
      assert.equal(a.metadata.filename, path.basename(fixture.files.new.path));
      assert.equal(a.metadata.source, "imported"); assert.deepEqual(a.metadata.tags, ["qa-identity"]);
      assert.equal(a.metadata.created_at, "2026-10-01T00:00:00Z");
      for (const key of ["hash_sha256", "provider_id", "model", "prompt", "generation", "license_note",
        "backend_asset_path", "filePath", "url", "bytes", "path", "placeholder"]) assert.equal(a.metadata[key], undefined);
      if (["background", "sprite", "portrait", "ui", "other"].includes(a.type))
        assert.deepEqual([a.metadata.width, a.metadata.height], [900, 600]);
      if (["bgm", "sfx", "voice"].includes(a.type)) assert(Math.abs(a.metadata.duration_ms - 800) < 40);
      if (a.type === "video") assert.deepEqual([a.metadata.width, a.metadata.height], [480, 270]);
    }
    assert.deepEqual(r.negatives.map(n => n.type), ["background", "background", "bgm", "video", "animation", "font"]);
    return { replacements: 11, corruptOrIncompatible: 6, cancelSeparatelyVerified: r.steps[1].result.cancelUnchanged,
      fileInputAssignmentNotOSPicker: true, actualInputEventLog: "NOT_RECORDED" };
  });
  await group("Native portable and UI cartridge complete ZIP payload bytes, no old media and exact active dependency set", async () => {
    for (const p of [r.portable, r.cartridge]) {
      const zip = await JSZip.loadAsync(fs.readFileSync(p.path), { checkCRC32: true });
      const old = new Set(r.fixtureMedia.map(a => a.files.old.sha256));
      for (const a of p.assets) {
        assert.equal(hash(await zip.file(a.path).async("nodebuffer")), a.sha256);
        assert.equal(a.sha256, r.fixtureMedia.find(f => f.id === a.id).files.new.sha256);
      }
      for (const e of Object.values(zip.files).filter(f => !f.dir)) assert(!old.has(hash(await e.async("nodebuffer"))));
    }
    const portable = await JSZip.loadAsync(fs.readFileSync(r.portable.path), { checkCRC32: true });
    const packed = JSON.parse(await portable.file("project.json").async("string"));
    assert.equal(packed.project_id, r.projectId); assert.equal(packed.asset_manifest.length, 11);
    assert.deepEqual(packed.editor_settings.assetLibrary, r.initial.folders);
    assert.deepEqual(packed.nodes.map(({ selected, measured, dragging, ...n }) => n), r.initial.nodes);
    assert.deepEqual(packed.edges.map(({ selected, ...e }) => e), r.initial.edges);
    const cartridge = await JSZip.loadAsync(fs.readFileSync(r.cartridge.path), { checkCRC32: true });
    const manifest = JSON.parse(await cartridge.file("manifest.json").async("string"));
    const script = JSON.parse(await cartridge.file("script.json").async("string"));
    assert.deepEqual(manifest, r.cartridge.manifest); assert.deepEqual(script, r.cartridge.script);
    assert.equal(manifest.game_id, r.projectId); assert.equal(manifest.assets.length, 10);
    assert.deepEqual(manifest.assets.map(a => a.asset_id).sort(), r.cartridge.assets.map(a => a.id).sort());
    const checksum = JSON.parse(await cartridge.file("checksum.json").async("string"));
    assert.deepEqual(checksum.files.map(f => f.path).sort(),
      Object.values(cartridge.files).filter(f => !f.dir && f.name !== "checksum.json").map(f => f.name).sort());
    for (const entry of checksum.files) {
      const bytes = await cartridge.file(entry.path).async("nodebuffer");
      assert.equal(bytes.length, entry.size_bytes); assert.equal(hash(bytes), entry.hash_sha256);
    }
    return { nativePortable: 11, uiCartridgeActiveDependencies: 10, animationJson: "BLOCKED_UNDEFINED_CONTRACT",
      newEditorExport: true, runtimePlayerConsumption: "NOT_RUN", checksumEntries: checksum.files.length };
  });
  await group("Twelve actual display cases and all PNG parameters/pixels remain exact", () => {
    assert.equal(r.matrix.length, 12); assert(r.screenshots.length >= 17);
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after); validateNativeViewport(s.before, s.after);
      const b = fs.readFileSync(s.path), d = Math.round(s.before.dpr);
      assert([1, 2].includes(d) && Math.abs(d - s.before.dpr) <= 1e-6);
      assert.equal(b.readUInt32BE(16), s.before.width * d); assert.equal(b.readUInt32BE(20), s.before.height * d);
    }
    return { displays: 12, screenshots: r.screenshots.length, physical4K: false, wholeEditorMotionClaim: false };
  });
  await group("Two real SQLite profiles retain eleven new media files and original graph/folder identity", () => {
    const dbRoots = [...new Set(r.launches.map(l => path.join(l.data, "backend")))], evidence = [];
    assert.equal(dbRoots.length, 2);
    for (const [index, original] of dbRoots.entries()) {
      const target = path.join(out, `sqlite-${index + 1}`); fs.mkdirSync(target);
      for (const name of ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"]) {
        const f = path.join(original, name); if (!fs.existsSync(f)) continue;
        const copy = path.join(target, name); fs.copyFileSync(f, copy, fs.constants.COPYFILE_EXCL); assert.equal(sha(copy), sha(f));
      }
      const db = new DatabaseSync(path.join(target, "vn_engine.db"), { readOnly: true });
      try {
        const row = db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get(r.projectId); assert(row);
        const p = JSON.parse(row.project_json); assert.equal(p.asset_manifest.length, 11);
        assert.deepEqual(p.editor_settings.assetLibrary, r.initial.folders);
        assert.deepEqual(p.nodes.map(({ selected, measured, dragging, ...n }) => n), r.initial.nodes);
        assert.deepEqual(p.edges.map(({ selected, ...e }) => e), r.initial.edges);
        const assets = [];
        for (const a of p.asset_manifest) {
          const fixture = r.fixtureMedia.find(f => f.id === a.asset_id); assert(fixture);
          let bytes, file;
          if (a.metadata.data_url?.startsWith("data:")) bytes = Buffer.from(a.metadata.data_url.split(",")[1], "base64");
          else {
            file = a.metadata.filePath; assert(file);
            const rel = path.relative(path.join(original, "project_assets"), file);
            assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel)); bytes = fs.readFileSync(file);
          }
          assert.equal(hash(bytes), fixture.files.new.sha256);
          assets.push({ id: a.asset_id, sha256: hash(bytes), ...(file ? { path: file } : { inline: true }) });
        }
        evidence.push({ database: desc(path.join(target, "vn_engine.db")), assets });
      } finally { db.close(); }
    }
    return { independentProfiles: 2, evidence };
  });
  await group("Original cache NTFS identity/bytes and user files preserved; all attributed processes/ports absent", () => {
    const journal = read(path.join(source, "native-cache-protection.json")), restored = read(r.cacheRestoration.path);
    assert.equal(sha(r.cacheRestoration.path), r.cacheRestoration.sha256);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    if (journal.existed) {
      assert.equal(restored.originalDirectoryId, journal.directoryId); assert(!fs.existsSync(journal.held));
      assert(ps(`fsutil.exe file queryfileid '${journal.original.replace(/'/g, "''")}'`).toLowerCase().includes(journal.directoryId.toLowerCase()));
      for (const f of journal.files) assert.equal(sha(path.join(journal.original, f.relative)), f.sha256);
    }
    assert(!fs.existsSync(r.nativeSource.path)); assert.equal(sha(r.portable.path), r.nativeSource.sha256);
    const active = rows(), identity = p => `${p.ProcessId}:${p.Created}`;
    assert(!active.some(p => r.knownProcesses.some(k => identity(k) === identity(p))));
    assert(!active.some(p => p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(source)));
    const ports = [...new Set(r.launches.flatMap(l => l.ports))]; assert.deepEqual(listeners(ports), []);
    return { knownProcessIdentities: r.knownProcesses.length, ports, nativeCacheRestored: true,
      deletedTestDownload: r.downloadCleanup.removed, retained: r.downloadCleanup.retained, deletedUserFiles: 0,
      normalClose: "NOT_PROVEN", rendererConsoleWarnings: "NOT_RECORDED" };
  });
  if (attempt !== "01") await group("Original first-attempt transport-normalization assertion and cleanup preserved", () => {
    const f = path.join(qa, "editor-01/report.json"), first = read(f);
    assert.equal(first.status, "FAILED"); assert.equal(first.cleanupError, undefined); assert.deepEqual(first.errors, []);
    assert.equal(first.steps.length, 4); assert(first.steps.slice(0, 3).every(s => s.status === "PASS"));
    assert.equal(first.steps[3].status, "FAILED"); assert.match(first.error, /backend_asset_path/);
    assert.match(first.error, /data_url/); assert.equal(first.replacements.length, 11); assert.equal(first.matrix.length, 0);
    assert(first.cacheRestored && first.protectedUnchanged);
    for (const s of first.snapshots) {
      assert.equal(sha(s.copy.path), s.copy.sha256); assert.equal(s.copy.sha256, s.source.sha256);
    }
    const active = rows(), id = p => `${p.ProcessId}:${p.Created}`;
    assert(!active.some(p => first.knownProcesses.some(k => id(p) === id(k))));
    assert.deepEqual(listeners(first.launches.flatMap(l => l.ports)), []);
    return { original: desc(f), failedSteps: 1, originalReplacements: 11,
      originalFailureUnchanged: true, attribution: "QA compared inline transport fields against background materialized file addresses; content comparisons now use independently read bytes." };
  });
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
