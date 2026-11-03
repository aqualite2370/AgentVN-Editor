"use strict";
// Independent read-only checks of raw current-Dev evidence and isolated SQLite.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Native-Assistant-Review-20261020-01";
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const stages = [
  "floating-window-drag-resize-dock-minimize-and-keyboard",
  "authorized-six-tool-chain-three-isolated-candidates-and-local-runtime-receipts",
  "exclude-candidate-real-runtime-combination-preview-and-twelve-display-combinations",
  "actual-batch-merge-is-atomic-and-preserves-other-layout-graph-and-authorized-bytes",
  "native-vnproj-save-byte-inspection-and-real-host-backend-restart-reopen",
  "new-session-consent-reset-and-real-layout-edit-conflict-without-overwrite",
];
function validate(r) {
  assert.equal(r.status, "CURRENT_NATIVE_CONTROLLED_WINDOW_REVIEW_MERGE_PASS");
  assert(r.finishedAt); assert.deepEqual(r.cases.map(c => c.name), stages); assert(r.cases.every(c => c.status === "PASS"));
  assert.equal(r.scope, "CURRENT_NATIVE_DEV_AUTOSTART_SOURCE_BACKEND_CONTROLLED_REVIEW_NOT_RELEASE_OR_REAL_DEEPSEEK");
  assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.devPublicationBuilds, 0);
  assert.deepEqual(r.errors, []); assert.deepEqual(r.modelErrors, []); assert(!r.cleanupError && !r.immutabilityError);
  assert(r.launches.length >= 2); assert.equal(r.cleanups.length, r.launches.length);
  assert.equal(new Set(r.launches.map(l => `${l.pid}:${l.created}`)).size, r.launches.length);
  assert.equal(new Set(r.launches.map(l => l.data)).size, 1); assert.equal(new Set(r.launches.map(l => l.webview)).size, 1);
  for (const l of r.launches) {
    assert(l.created); assert(l.environment.AGENTVN_TEST_PROJECT.startsWith(path.resolve(qa)));
    assert(l.environment.AGENTVN_WORKSPACE_OUTPUT.startsWith(path.resolve(qa)));
    assert(l.listeners.length === 3 && l.ports.length === 3);
  }
  for (const c of r.cleanups) {
    assert.equal(c.normalExitClaimed, false); assert(c.killed.length > 0);
    assert.deepEqual(c.survivors, []); assert.deepEqual(c.listeners, []);
  }
  const seen = new Set();
  assert.equal(r.matrix.length, 12);
  for (const m of r.matrix) {
    const allowed = { 1920: 1080, 2560: 1440, 3840: 2160 };
    assert.equal(m.height, allowed[m.width]); assert([1, 2].includes(m.dpr)); assert.equal(typeof m.reduced, "boolean");
    const key = `${m.width}/${m.dpr}/${m.reduced}`; assert(!seen.has(key)); seen.add(key);
    assert.equal(m.viewport.width, m.width); assert.equal(m.viewport.height, m.height);
    assert(Math.abs(m.viewport.dpr - m.dpr) < 1e-6); assert.equal(m.viewport.reduced, m.reduced);
    assert.equal(m.status, "PASS");
    const w = m.window.rect, b = m.geometry.rect;
    assert(w.left >= 0 && w.top >= 0 && w.right <= m.width + 1 && w.bottom <= m.height + 1);
    assert(b.left >= 0 && b.right <= m.width + 1 && b.top >= 0 && b.bottom <= m.height + 1);
    assert(m.geometry.hit && m.geometry.focus && m.window.overflow <= 1);
    assert(m.window.controls.length === 5 && m.window.controls.every(c => c.hit));
  }
  assert.equal(r.submissions.length, 2);
  assert(r.submissions.every(s => s.projectId === r.baseline.id));
  assert.deepEqual(r.submissions.map(s => s.request.authorized_assets), [0, 1].map(() =>
    [{ id: "project-asset-1", filename: "中文 徽章.png", mime_type: "image/png" }]));
  assert.equal(r.modelRequests.length, 12);
  for (const marker of ["REVIEW_A", "CONFLICT_A"]) {
    const req = r.modelRequests.filter(m => m.marker === marker);
    assert.deepEqual(req.map(m => m.step), [0, 1, 2, 3, 4, 5]);
    assert(req.every(m => m.privateMaterialAbsent));
    assert.equal(req[3].receipts.at(-1).result.status, "validated");
    assert.equal(req[4].receipts.at(-1).result.status, "rendered");
  }
  assert(r.providerCleanup.stopped && r.providerCleanup.requests === 12);
  assert.equal(r.localReceipts.length, 4);
  assert(r.localReceipts.every(p => p.payload.result.ok && p.payload.project_id === r.baseline.id));
  assert(r.atomicObservation.includes(2) && !r.atomicObservation.includes(1));
  const custom = s => s.settings.runtimeUILayout.screens.find(p => p.screen_id === "title")
    .components.filter(c => c.component_type === "custom_component");
  assert.equal(custom(r.baseline).length, 0); assert.equal(custom(r.merged).length, 2);
  assert(!JSON.stringify(custom(r.merged)).includes("排除候选"));
  assert.deepEqual(r.merged.settings.runtimeUILayoutProfiles.profiles.agentvn, r.baseline.settings.runtimeUILayoutProfiles.profiles.agentvn);
  for (const k of ["nodes", "edges"]) assert.deepEqual(r.merged[k], r.baseline[k]);
  for (const k of ["settings", "nodes", "edges"]) assert.deepEqual(r.reopened[k], r.merged[k]);
  const authorAsset = ({ metadata, ...asset }) => {
    const { url, filePath, backend_asset_path, data_url, ...author } = metadata;
    return { ...asset, metadata: author };
  };
  assert.deepEqual(r.reopened.assets.map(authorAsset), r.merged.assets.map(authorAsset));
  assert.equal(r.reopenedAssetBytes.length, r.merged.assets.length);
  for (const asset of r.merged.assets) {
    const byte = r.reopenedAssetBytes.find(a => a.id === asset.asset_id);
    assert(byte && byte.sha256 === r.image.sha256 && byte.bytes === r.image.bytes);
    assert(byte.backendOwned && byte.matchesPortableFile);
  }
  assert.equal(r.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
  assert.equal(r.downloadCleanup.removed, true); assert.equal(r.downloadCleanup.retainedCopy, r.projectArtifact.path);
  assert(r.authorConflict.rejected && r.authorConflict.authorAction === "actual Add mask + Save layout");
  const g = r.cases[0].detail;
  assert(g.before.activeInside); assert.equal(g.mini.minimized, "true"); assert.equal(g.mini.rect.height, 54);
  assert(Math.abs(g.dragged.rect.left - g.before.rect.left - 90) < 2);
  assert(Math.abs(g.resized.rect.width - g.dragged.rect.width + 100) < 2);
  assert.equal(g.reset.rect.left, g.before.rect.left);
  assert.equal(r.screenshots.length, 5);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after);
    const dpr = Math.round(s.before.dpr);
    assert(Math.abs(dpr - s.before.dpr) < 1e-6);
    assert.equal(s.png.width, s.before.width * dpr); assert.equal(s.png.height, s.before.height * dpr);
  }
  return { cases: 6, reviewDisplayCombinations: 12, controlledHttpRequests: 12,
    realModelRequests: 0, realNativeHostStarts: r.launches.length, normalCloseClaimed: false, screenshots: 5 };
}
function selfTest(report) {
  validate(report);
  const variants = [
    r => { r.status = "PASS"; }, r => { delete r.finishedAt; }, r => { r.cases = []; },
    r => { r.matrix.pop(); }, r => { r.matrix[0] = r.matrix[1]; }, r => { r.matrix[0].geometry.hit = false; },
    r => { r.matrix[0].geometry.focus = false; }, r => { r.matrix[0].window.rect.left = -20; },
    r => { r.matrix[0].viewport.dpr = 1.5; }, r => { r.launches[1] = r.launches[0]; },
    r => { r.cleanups[1].normalExitClaimed = true; }, r => { r.cleanups[0].listeners.push({}); },
    r => { r.modelRequests.pop(); }, r => { r.localReceipts[0].payload.result.ok = false; },
    r => { r.modelRequests[4].receipts.at(-1).result.status = "not-rendered"; },
    r => { r.atomicObservation.push(1); }, r => { r.realModelRequests = 1; },
    r => { r.submissions[0].request.authorized_assets.push({ id: "private-project" }); },
    r => { r.screenshots[1].png.width /= 2; }, r => { r.credentialCleanup = "NOT_CLEARED"; },
    r => { r.downloadCleanup.removed = false; }, r => { r.authorConflict.rejected = false; },
    r => { r.reopened.settings = {}; }, r => { r.reopenedAssetBytes[0].sha256 = "wrong"; },
  ];
  for (const mutate of variants) { const bad = structuredClone(report); mutate(bad); assert.throws(() => validate(bad)); }
  console.log(`PASS ${variants.length} invalid evidence variants rejected`); return variants.length;
}
async function audit(name, session) {
  assert(/^audit-\d{2}$/.test(name)); assert(/^\d{2}$/.test(session));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const reportPath = path.join(qa, `session-${session}/report.json`), r = load(reportPath);
  const receipt = { status: "RUNNING", at: new Date().toISOString(), report: { path: reportPath, sha256: sha(reportPath) } };
  try {
    receipt.coverage = validate(r); receipt.rejectedBadVariants = selfTest(r);
    if (r.priorEvidence) {
      assert.equal(sha(r.priorEvidence.path), r.priorEvidence.sha256);
      for (const c of r.cases.filter(c => c.notRerun)) {
        assert.equal(sha(c.evidenceSource.path), c.evidenceSource.sha256);
        const original = load(c.evidenceSource.path).cases.find(original => original.name === c.name);
        assert.equal(original.status, "PASS"); assert.deepEqual(c.detail, original.detail);
      }
    }
    for (const f of [...r.products, ...r.sources, ...r.inputs, ...r.runInputs]) assert.equal(sha(f.path), f.sha256);
    for (const f of ["native-assistant-review.cjs", "lib/current-native-editor-session.cjs", "lib/controlled-assistant-review-provider.cjs"])
      assert.equal(sha(path.join(root, "scripts", f)), sha(path.join(qa, `session-${session}`, path.basename(f))));
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); const bytes = fs.readFileSync(s.path);
      assert.equal(bytes.readUInt32BE(16), s.png.width); assert.equal(bytes.readUInt32BE(20), s.png.height);
    }
    assert(!fs.existsSync(r.projectArtifact.source)); assert.equal(sha(r.projectArtifact.path), r.projectArtifact.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(r.projectArtifact.path));
    const portable = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(portable.editor_settings.runtimeUILayoutProfiles, r.merged.settings.runtimeUILayoutProfiles);
    const copied = portable.asset_manifest.filter(a => !r.baseline.assets.some(b => b.asset_id === a.asset_id));
    assert.equal(copied.length, 2);
    for (const a of copied) assert.equal(Asha(await zip.file(a.metadata.project_path).async("nodebuffer")), r.image.sha256);
    assert(!JSON.stringify(portable).includes("authorizedProjectAssetIds"));
    const db = path.join(r.launches[0].data, "backend/vn_engine.db");
    const ids = r.runInputs.map(f => load(f.path).project_id);
    const code = [
      "import json,sqlite3,sys,pathlib",
      "db=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)",
      "print(json.dumps([json.loads(db.execute('SELECT project_json FROM editor_project_details WHERE project_id=?',(i,)).fetchone()[0]) for i in json.loads(sys.argv[2])],ensure_ascii=False))",
      "db.close()",
    ].join("\n");
    const result = spawnSync("python", ["-c", code, db, JSON.stringify(ids)], { encoding: "utf8", timeout: 20000,
      windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    assert.equal(result.status, 0, result.stderr); const final = JSON.parse(result.stdout);
    assert.equal(final.length, 2);
    const authored = nodes => nodes.map(({ measured, ...node }) => node);
    assert.deepEqual(final[0].editor_settings.runtimeUILayoutProfiles, r.authorConflict.authored.editor_settings.runtimeUILayoutProfiles);
    assert.deepEqual(authored(final[0].nodes), authored(r.baseline.nodes)); assert.deepEqual(final[0].edges, r.baseline.edges);
    const other = load(r.runInputs[1].path);
    assert.deepEqual(final[1].editor_settings, other.editor_settings);
    assert.deepEqual(authored(final[1].nodes), authored(other.nodes)); assert.deepEqual(final[1].edges, other.edges);
    const contentAsset = ({ metadata, ...asset }) => {
      const { url, filePath, backend_asset_path, data_url, ...author } = metadata;
      return { ...asset, metadata: author };
    };
    const expectedOtherAssets = other.asset_manifest.map(a => {
      const bytes = Buffer.from(a.metadata.data_url.split(",")[1], "base64");
      assert.equal(Asha(bytes), r.image.sha256);
      return contentAsset({ ...a, metadata: { ...a.metadata, size_bytes: bytes.length } });
    });
    assert.deepEqual(final[1].asset_manifest.map(contentAsset), expectedOtherAssets);
    // Read actual isolated materialized bytes, not stale URLs or just metadata.
    const assetRoot = path.join(path.dirname(db), "project_assets");
    for (const p of final) for (const asset of p.asset_manifest) {
      assert(asset.metadata.filePath);
      const relative = path.relative(assetRoot, asset.metadata.filePath);
      assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
      assert.equal(sha(asset.metadata.filePath), r.image.sha256);
      assert.equal(fs.statSync(asset.metadata.filePath).size, r.image.bytes);
    }
    const file = path.join(out, "final-projects-readonly-sqlite.json");
    fs.writeFileSync(file, JSON.stringify(final, null, 2), { flag: "wx" });
    receipt.persistedProjects = { path: file, sha256: sha(file), projectCount: 2 };
    const now = rows();
    assert(!r.known.some(p => now.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
    const ports = [...new Set(r.launches.flatMap(l => l.ports))]; assert.equal(listeners(ports).length, 0);
    receipt.processIdentitiesAbsent = r.known.length; receipt.portsAbsent = ports;
    const redPath = path.join(qa, "session-01/report.json"), red = load(redPath);
    assert.equal(red.status, "FAILED"); assert.match(red.error, /图片-1\.png/);
    receipt.firstFailure = { path: redPath, sha256: sha(redPath), classification: "Incorrect QA AssetRef fixture; not a product patch" };
    receipt.status = "VERIFIED_CURRENT_NATIVE_CONTROLLED_WINDOW_REVIEW_MERGE_PASS";
  } catch (e) { receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
    console.log(JSON.stringify(receipt, null, 2));
  }
}
const Asha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
if (process.argv[2] === "--test") selfTest(load(path.join(qa, `session-${process.argv[3] || "02"}/report.json`)));
else audit(process.argv[2], process.argv[3] || "02").catch(e => { console.error(e); process.exitCode = 1; });
