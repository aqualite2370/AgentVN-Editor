"use strict";
// Independent evidence audit only. No product/UI/model/device operations.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { validateEditor, validatePlayer } = require("./lib/installed-video-current-evidence.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const editorAttempt = process.argv[2] || "03", playerAttempt = process.argv[3] || "01", audit = process.argv[4] || "01";
for (const a of [editorAttempt, playerAttempt, audit]) assert.match(a, /^\d{2}$/);
const qa = "F:/AgentVN/QA/Installed-Assets-20261021-01";
const editorFile = path.join(qa, `editor-${editorAttempt}/report.json`);
const playerFile = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-assets-video-current-${playerAttempt}/report.json`;
const out = path.join(qa, `video-audit-${audit}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const e = read(editorFile), r = read(playerFile);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), editor: desc(editorFile), player: desc(playerFile),
  groups: [], productChanges: 0, modelRequests: 0, launches: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function group(name, fn) {
  const g = { name, status: "RUNNING" }; report.groups.push(g); save();
  try { g.result = await fn(); g.status = "PASS"; console.log(`PASS ${name}`); }
  catch (err) { g.status = "FAILED"; g.error = String(err.stack || err); throw err; } finally { save(); }
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  await group("Exact current installation, nonempty author/player evidence and bad-report rejection", () => {
    validateEditor(e); validatePlayer(r);
    assert.equal(sha(r.source.path), r.source.sha256); assert.equal(r.source.sha256, report.editor.sha256);
    for (const f of [e.installation, e.executable, e.fixture, r.executable, e.portable, e.cartridge, ...e.protectedFiles])
      assert.equal(sha(f.path), f.sha256, f.path);
    assert.deepEqual(r.cartridge, e.cartridge); assert.deepEqual(r.installation, e.installation);
    const installed = read(e.installation.path); assert.equal(installed.status, "PASS"); assert.equal(installed.executable.version, "1.9.14");
    assert.equal(path.resolve(r.executable.path), path.resolve(installed.installRoot, "agentvn-player.exe"));
    for (const l of e.launches) {
      assert.equal(path.resolve(l.backend.ExecutablePath), path.resolve(installed.installRoot, "creator-backend.exe"));
      assert.equal(sha(l.backend.ExecutablePath), l.backend.sha256);
      assert(l.dataDirectoryOverride && l.webviewDirectoryOverride && !l.sourceServer && !l.manualBackendSpawn);
    }
    for (const s of [...e.snapshots, ...r.snapshots]) {
      assert.equal(sha(s.copy.path), s.copy.sha256); assert.equal(s.copy.sha256, s.source.sha256);
    }
    const invalid = [
      q => { q.cases = []; }, q => { q.cases[1] = q.cases[0]; }, q => { q.cases[0].videoFrames = []; },
      q => { q.cases[0].videoFrames.forEach(f => { f.time = 0; }); },
      q => { q.cases[0].videoFrames.forEach(f => { f.pixelSignature = 0; }); },
      q => { q.cases[0].consumed[0].duration = .001; }, q => { q.cases[0].consumed[0].timeAdvanced = false; },
      q => { q.profileRestored = false; }, q => { q.launches[0].cleanup.status = "FAILED"; },
      q => { q.errors.push("ignored"); }, q => { q.modelRequests = 1; }, q => { q.gitAfter.index = "changed"; },
    ];
    for (const mutate of invalid) { const bad = structuredClone(r); mutate(bad); assert.throws(() => validatePlayer(bad)); }
    return { invalidActualReportsRejected: invalid.length, realEditorLaunches: 2, realPlayerLaunches: 1,
      snapshotCount: e.snapshots.length + r.snapshots.length };
  });
  await group("Only one video changes; native portable and actual UI cartridge preserve exact other media", async () => {
    assert.equal(sha(e.video.path), e.video.sha256);
    assert.equal(e.video.sha256, "d0b23243065c65d7d698ff7716c504a5a782416b072024f680b72471eb44d072");
    assert.equal(e.replacement.metadata.duration_ms, 1766);
    assert.deepEqual(e.restarted, e.after);
    for (const k of ["id", "nodes", "edges", "folders"]) assert.deepEqual(e.after[k], e.before[k]);
    assert.deepEqual(e.after.assets.filter(a => a.asset_id !== "qa_video"), e.before.assets.filter(a => a.asset_id !== "qa_video"));
    const before = e.before.assets.find(a => a.asset_id === "qa_video"), after = e.after.assets.find(a => a.asset_id === "qa_video");
    assert.equal(after.asset_id, before.asset_id); assert.equal(after.asset_type, before.asset_type);
    assert.equal(after.metadata.display_name, before.metadata.display_name);
    assert.notEqual(after.observedContentSha256, before.observedContentSha256);
    assert.equal(after.observedContentSha256, e.video.sha256);
    for (const f of [e.portable, e.cartridge]) {
      const zip = await JSZip.loadAsync(fs.readFileSync(f.path), { checkCRC32: true });
      for (const a of f.assets) {
        assert.equal(hash(await zip.file(a.path).async("nodebuffer")), a.sha256);
        assert.equal(a.sha256, e.after.assets.find(x => x.asset_id === a.id).observedContentSha256);
      }
      for (const z of Object.values(zip.files).filter(f => !f.dir)) assert.notEqual(hash(await z.async("nodebuffer")), before.observedContentSha256);
    }
    const cart = await JSZip.loadAsync(fs.readFileSync(e.cartridge.path)), checksum = JSON.parse(await cart.file("checksum.json").async("string"));
    for (const f of checksum.files) {
      const b = await cart.file(f.path).async("nodebuffer"); assert.equal(b.length, f.size_bytes); assert.equal(hash(b), f.hash_sha256);
    }
    assert.equal(checksum.files.length, Object.values(cart.files).filter(f => !f.dir && f.name !== "checksum.json").length);
    return { unchangedOtherAssets: 10, portable: 11, actualCartridgeDependencies: 10, checksumEntries: checksum.files.length };
  });
  await group("Independent SQLite copy after real host/backend restart retains all eleven payloads and graph", () => {
    const dbRoot = path.join(e.launches[0].data, "backend"), dst = path.join(out, "sqlite"); fs.mkdirSync(dst);
    for (const n of ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"]) {
      const f = path.join(dbRoot, n); if (!fs.existsSync(f)) continue;
      const copy = path.join(dst, n); fs.copyFileSync(f, copy, fs.constants.COPYFILE_EXCL); assert.equal(sha(copy), sha(f));
    }
    const db = new DatabaseSync(path.join(dst, "vn_engine.db"), { readOnly: true });
    try {
      const row = db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get(e.projectId); assert(row);
      const p = JSON.parse(row.project_json); assert.equal(p.asset_manifest.length, 11);
      assert.deepEqual(p.editor_settings.assetLibrary, e.after.folders);
      assert.deepEqual(p.nodes.map(({ selected, measured, dragging, ...n }) => n), e.after.nodes);
      assert.deepEqual(p.edges.map(({ selected, ...n }) => n), e.after.edges);
      for (const a of p.asset_manifest) {
        let bytes;
        if (a.metadata.data_url?.startsWith("data:")) bytes = Buffer.from(a.metadata.data_url.split(",")[1], "base64");
        else {
          const rel = path.relative(path.join(dbRoot, "project_assets"), a.metadata.filePath);
          assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel)); bytes = fs.readFileSync(a.metadata.filePath);
        }
        assert.equal(hash(bytes), e.after.assets.find(x => x.asset_id === a.asset_id).observedContentSha256);
      }
    } finally { db.close(); }
    assert.notEqual(e.launches[0].pid, e.launches[1].pid);
    assert.notEqual(e.launches[0].backend.ProcessId, e.launches[1].backend.ProcessId);
    return { database: desc(path.join(dst, "vn_engine.db")), types: 11, nativeHostRestart: true };
  });
  await group("Twelve actual display cases: fetched source bytes, advancing decoded frames, changing pixels and real end", () => {
    const cases = [];
    for (const c of r.cases) {
      validateNativeViewport(c.viewport, c);
      const a = c.consumed[0], metadata = c.video.find(v => v.event === "loadedmetadata");
      assert.equal(metadata.sha256, e.video.sha256); assert.equal(a.sha256, e.video.sha256);
      assert(metadata.duration > 1 && metadata.width === 480 && metadata.height === 270);
      assert(c.video.some(v => v.event === "playing") && c.video.some(v => v.event === "timeupdate" && v.time > 1)
        && c.video.some(v => v.event === "ended" && v.time > 1));
      assert(!c.video.some(v => v.event === "error" || v.probeError));
      for (let i = 1; i < c.videoFrames.length; i++) assert(c.videoFrames[i].time >= c.videoFrames[i - 1].time);
      const signatures = new Set(c.videoFrames.map(f => f.pixelSignature)).size;
      assert(c.videoFrames.length >= 15 && signatures >= 10 && c.videoFrames.at(-1).time > 1);
      const rect = c.input.rect; assert(rect.x >= -1 && rect.y >= -1 && rect.right <= c.width + 1 && rect.bottom <= c.height + 1);
      cases.push({ width: c.width, dpr: c.dpr, reduced: c.reduced, frames: c.videoFrames.length,
        uniquePixelSignatures: signatures, lastTime: c.videoFrames.at(-1).time });
    }
    return { cases, totalDecodedFrames: cases.reduce((n, c) => n + c.frames, 0), realInputNotEngineMutation: true };
  });
  await group("PNG parameters/pixels are unchanged by capture and original single-frame failures remain FAILED", () => {
    for (const s of [...e.screenshots, ...r.screenshots]) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after); validateNativeViewport(s.before, s.after);
      const b = fs.readFileSync(s.path), d = Math.round(s.before.dpr);
      assert.equal(b.readUInt32BE(16), s.before.width * d); assert.equal(b.readUInt32BE(20), s.before.height * d);
    }
    const f = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-assets-current-04/report.json", old = read(f);
    assert.equal(old.status, "FAILED");
    assert.equal(old.cases.filter(c => !c.consumed.find(x => x.type === "video").timeAdvanced).length, 12);
    assert.throws(() => validatePlayer(old));
    return { screenshots: e.screenshots.length + r.screenshots.length, oldFailure: desc(f), physical4K: false };
  });
  await group("Original cache and Player profiles restored; test download removed; all owned processes and ports absent", () => {
    const cacheJournal = read(path.join(path.dirname(editorFile), "native-cache-protection.json"));
    assert.equal(read(e.cacheRestoration.path).status, "PASS"); assert.equal(sha(e.cacheRestoration.path), e.cacheRestoration.sha256);
    assert(!fs.existsSync(cacheJournal.held));
    if (cacheJournal.existed) {
      assert(ps(`fsutil.exe file queryfileid '${cacheJournal.original}'`).toLowerCase().includes(cacheJournal.directoryId.toLowerCase()));
      for (const f of cacheJournal.files) assert.equal(sha(path.join(cacheJournal.original, f.relative)), f.sha256);
    }
    const profiles = read(path.join(path.dirname(playerFile), "profile-protection.json"));
    assert.equal(read(r.profileRestoration.path).status, "PASS"); assert.equal(sha(r.profileRestoration.path), r.profileRestoration.sha256);
    for (const p of profiles.records) {
      assert(!fs.existsSync(p.held));
      if (p.existed) {
        assert(ps(`fsutil.exe file queryfileid '${p.original}'`).toLowerCase().includes(p.directoryId.toLowerCase()));
        if (p.byteInventory) for (const f of p.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
      }
    }
    assert(!fs.existsSync(e.nativeSource.path)); assert.equal(sha(e.portable.path), e.nativeSource.sha256);
    for (const f of e.protectedFiles) assert.equal(sha(f.path), f.sha256);
    const known = [...e.knownProcesses, ...r.knownProcesses], active = rows(), id = p => `${p.ProcessId}:${p.Created}`;
    assert(!active.some(p => known.some(k => id(p) === id(k))));
    for (const dir of [path.dirname(editorFile), path.dirname(playerFile)])
      assert(!active.some(p => p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(dir)));
    const ports = [...e.launches.flatMap(l => l.ports), ...r.launches.map(l => l.port)];
    assert.deepEqual(listeners(ports), []);
    assert.deepEqual(e.gitAfter, e.gitBefore); assert.deepEqual(r.gitAfter, r.gitBefore);
    return { knownIdentities: new Set(known.map(id)).size, ports, protectedPaths: new Set(e.protectedFiles.map(f => f.path)).size,
      deletedUserFiles: 0, deletedTestDownload: e.downloadCleanup.removed, retainedPortable: e.portable.path };
  });
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
  console.log(JSON.stringify({ status: report.status, groups: report.groups.length, out, error: report.error })); });
