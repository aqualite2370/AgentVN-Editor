"use strict";
// Independent read-only installed evidence audit. Does not contact a provider.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const candidateArgument = process.argv.find(value => value.startsWith("--candidate="));
const currentCandidate = Boolean(candidateArgument);
const expectedVersion = currentCandidate ? candidateArgument.slice("--candidate=".length) : "1.9.14";
const qaArgument = process.argv.find(value => value.startsWith("--qa-root="));
const qa = path.resolve(qaArgument ? qaArgument.slice("--qa-root=".length)
  : currentCandidate ? "F:/AgentVN/QA/Installed-Assistant-Review-1922-20261022-01"
  : "F:/AgentVN/QA/Installed-Assistant-Review-20261021-01");
if (currentCandidate) assert.match(expectedVersion, /^\d+\.\d+\.\d+$/);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const bytesSha = b => crypto.createHash("sha256").update(b).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const names = [
  "floating-window-drag-resize-dock-minimize-and-keyboard",
  "authorized-six-tool-chain-three-isolated-candidates-and-local-runtime-receipts",
  "exclude-candidate-real-runtime-combination-preview-and-twelve-display-combinations",
  "actual-batch-merge-is-atomic-and-preserves-other-layout-graph-and-authorized-bytes",
  "native-vnproj-save-byte-inspection-and-real-host-backend-restart-reopen",
  "new-session-consent-reset-and-real-layout-edit-conflict-without-overwrite",
];
const authorAsset = ({ metadata, ...asset }) => {
  const { url, filePath, backend_asset_path, data_url, ...author } = metadata; return { ...asset, metadata: author };
};
const authoredNodes = nodes => nodes.map(({ measured, ...node }) => node);
function validate(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt); assert.equal(r.version, expectedVersion);
  assert.equal(r.scope, "ACTUAL_NSIS_INSTALLED_CONTROLLED_CREATION_REVIEW_MERGE_NOT_REAL_DEEPSEEK");
  assert.deepEqual(r.cases.map(c => c.name), names); assert(r.cases.every(c => c.status === "PASS"));
  assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.devPublicationBuilds, 0);
  assert.equal(r.blockedModelRequests, 0); assert.deepEqual(r.errors, []); assert.deepEqual(r.modelErrors, []);
  assert(!r.cleanupError && !r.immutabilityError && !r.failureCaptureError);
  if(currentCandidate)assert(r.cacheRestoration==="PASS"&&!r.cacheError);
  assert.equal(r.launches.length, 2); assert.equal(r.cleanups.length, 2);
  assert.notEqual(r.launches[0].pid, r.launches[1].pid);
  assert.equal(new Set(r.launches.map(l => l.data)).size, 1); assert.equal(new Set(r.launches.map(l => l.webview)).size, 1);
  for (const l of r.launches) {
    assert(l.created && l.backend.sha256); assert.equal(l.ports.length, 2); assert.equal(l.listeners.length, 2);
    assert(!l.sourceServer && !l.manualBackendSpawn && l.dataDirectoryOverride && l.webviewDirectoryOverride);
    assert(l.isolation.AGENTVN_TEST_PROJECT.startsWith(path.resolve(qa)));
    assert(l.isolation.AGENTVN_WORKSPACE_OUTPUT.startsWith(path.resolve(qa)));
  }
  for (const c of r.cleanups) assert(c.status === "PASS" && c.killed.length > 0 && c.normalCloseClaimed === false);
  assert.equal(r.matrix.length, 12); const keys = new Set();
  for (const m of r.matrix) {
    assert([1920, 2560, 3840].includes(m.width)); assert.equal(m.height, m.width * 9 / 16);
    assert([1, 2].includes(m.dpr)); assert.equal(typeof m.reduced, "boolean"); validateNativeViewport(m.viewport, m);
    const k = `${m.width}/${m.dpr}/${m.reduced}`; assert(!keys.has(k)); keys.add(k); assert.equal(m.status, "PASS");
    const w = m.window.rect, b = m.geometry.rect;
    assert(w.width > 0 && w.height > 0 && w.left >= 0 && w.top >= 0 && w.right <= m.width + 1 && w.bottom <= m.height + 1);
    assert(b.width > 0 && b.height > 0 && b.left >= 0 && b.top >= 0 && b.right <= m.width + 1 && b.bottom <= m.height + 1);
    assert(m.geometry.hit && m.geometry.focus && m.window.overflow <= 1);
    assert.equal(m.window.controls.length, 5); assert(m.window.controls.every(c => c.hit));
  }
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
    assert(keys.has(`${width}/${dpr}/${reduced}`));
  assert.equal(r.submissions.length, 2); assert.equal(r.localReceipts.length, 4); assert.equal(r.tasks.length, 2);
  for (const t of r.tasks) assert(t.status === "completed" && t.projectId === r.baseline.id);
  for (const s of r.submissions) {
    assert.equal(s.projectId, r.baseline.id);
    assert.deepEqual(s.request.authorized_assets, [{ id: "project-asset-1", filename: "中文 徽章.png", mime_type: "image/png" }]);
  }
  assert(r.localReceipts.every(p => p.payload.result.ok && p.payload.project_id === r.baseline.id));
  assert.equal(r.modelRequests.length, 12);
  for (const marker of ["REVIEW_A", "CONFLICT_A"]) {
    const req = r.modelRequests.filter(m => m.marker === marker);
    assert.deepEqual(req.map(m => m.step), [0, 1, 2, 3, 4, 5]); assert(req.every(m => m.privateMaterialAbsent));
    assert.equal(req[3].receipts.at(-1).result.status, "validated");
    assert.equal(req[4].receipts.at(-1).result.status, "rendered");
  }
  assert(r.providerCleanup.stopped && r.providerCleanup.requests === 12);
  const submissions = r.controlledWrites.filter(w => w.path === "/api/assistant/creation/processes");
  assert.equal(submissions.length, 2);
  assert(r.controlledWrites.every(w => w.endpoint === r.modelEndpoint));
  const custom = s => s.settings.runtimeUILayout.screens.find(s => s.screen_id === "title")
    .components.filter(c => c.component_type === "custom_component");
  assert.equal(custom(r.baseline).length, 0); assert.equal(custom(r.merged).length, 2);
  assert(!JSON.stringify(custom(r.merged)).includes("排除候选"));
  assert(r.atomicObservation.includes(2) && !r.atomicObservation.includes(1));
  assert.deepEqual(r.merged.settings.runtimeUILayoutProfiles.profiles.agentvn, r.baseline.settings.runtimeUILayoutProfiles.profiles.agentvn);
  assert.deepEqual(r.reopened.settings, r.merged.settings);
  for (const k of ["nodes", "edges"]) {
    assert.deepEqual(r.merged[k], r.baseline[k]); assert.deepEqual(r.reopened[k], r.merged[k]);
  }
  assert.deepEqual(r.reopened.assets.map(authorAsset), r.merged.assets.map(authorAsset));
  assert.equal(r.reopenedAssetBytes.length, r.merged.assets.length);
  for (const a of r.reopenedAssetBytes)
    assert(a.sha256 === r.image.sha256 && a.bytes === r.image.bytes && a.backendOwned && a.matchesPortableFile);
  assert.equal(r.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
  assert(r.downloadCleanup.removed && r.downloadCleanup.retainedCopy === r.projectArtifact.path);
  assert(r.authorConflict.rejected && r.authorConflict.authorAction === "actual Add mask + Save layout");
  const g = r.cases[0].detail;
  assert(g.before.activeInside && g.mini.minimized === "true" && g.mini.rect.height === 54);
  assert(Math.abs(g.dragged.rect.left - g.before.rect.left - 90) < 2);
  assert(Math.abs(g.resized.rect.width - g.dragged.rect.width + 100) < 2);
  assert.equal(g.reset.rect.left, g.before.rect.left);
  assert.equal(r.screenshots.length, 5);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after);
    const declared=r.matrix.find(m=>m.width===s.before.width&&m.height===s.before.height&&m.reduced===s.before.reduced&&
      Math.abs(m.dpr-s.before.dpr)<=1e-6);
    assert(declared,"Screenshot lacks validated matrix parameters");validateNativeViewport(s.before,declared);
    assert.equal(s.png.width,declared.width*declared.dpr);assert.equal(s.png.height,declared.height*declared.dpr);
  }
  return { businessStages: 6, displayCases: 12, modelBoundary: "12 controlled HTTP calls, no paid/real model",
    actualInstalledRestarts: 1, normalNativeClose: false };
}
async function main() {
  const attempt = process.argv[2] || "01", audit = process.argv[3] || "01";
  assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
  const runRoot = path.join(qa, `session-${attempt}`), out = path.join(qa, `audit-${audit}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const input = path.join(runRoot, "report.json"), r = read(input), prep = read(path.join(qa, "preparation.json"));
  const report = { status: "RUNNING", at: new Date().toISOString(), input: desc(input), groups: [] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function check(label, fn) {
    const g = { label, status: "RUNNING" }; report.groups.push(g); save();
    try { g.result = await fn(); g.status = "PASS"; console.log(`PASS ${label}`); }
    catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; } finally { save(); }
  }
  try {
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    await check("Complete real installed flow and evidence-validator negative controls", () => {
      const coverage = validate(r);
      const mutations = [
        x => { x.cases = []; }, x => { x.matrix = []; }, x => { x.matrix.pop(); },
        x => { x.matrix[0] = x.matrix[1]; }, x => { x.matrix[0].geometry.hit = false; },
        x => { x.matrix[0].geometry.focus = false; }, x => { x.matrix[0].window.rect.left = -20; },
        x => { x.matrix[0].viewport.dpr = 1.5; }, x => { x.launches[0].sourceServer = true; },
        x => { x.launches[1] = x.launches[0]; }, x => { x.cleanups[0].normalCloseClaimed = true; },
        x => { x.modelRequests.pop(); }, x => { x.localReceipts[0].payload.result.ok = false; },
        x => { x.modelRequests[4].receipts.at(-1).result.status = "not-rendered"; },
        x => { x.atomicObservation.push(1); }, x => { x.realModelRequests = 1; },
        x => { x.submissions[0].request.authorized_assets.push({ id: "private-project" }); },
        x => { x.screenshots[1].png.width /= 2; }, x => { x.credentialCleanup = "NOT_CLEARED"; },
        x => { x.screenshots[0].before.dpr=1.5;x.screenshots[0].after.dpr=1.5; },
        x => { x.downloadCleanup.removed = false; }, x => { x.authorConflict.rejected = false; },
        x => { x.reopened.settings = {}; }, x => { x.reopenedAssetBytes[0].sha256 = "wrong"; },
        x => { x.controlledWrites[0].endpoint = "https://api.deepseek.com/v1"; },
      ];
      for (const mutate of mutations) { const bad = structuredClone(r); mutate(bad); assert.throws(() => validate(bad)); }
      return { ...coverage, rejectedInvalidEvidenceVariants: mutations.length };
    });
    await check("Exact NSIS receipt, host/backend identities, source/tools and protected file hashes", () => {
      assert.equal(sha(r.installation.path), r.installation.sha256); const installation = read(r.installation.path);
      assert(installation.status === "PASS" && installation.metadataRestoration === "PASS");
      for (const l of r.launches) {
        assert.equal(l.executable.sha256, installation.executable.sha256);
        assert.equal(path.resolve(l.backend.ExecutablePath), path.resolve(installation.installRoot, "creator-backend.exe"));
        assert.equal(l.backend.sha256, sha(l.backend.ExecutablePath));
      }
      for (const f of [...r.products, ...r.sources, ...r.inputs, ...r.tools]) assert.equal(sha(f.path), f.sha256);
      for (const f of r.tools) assert.equal(sha(path.join(runRoot, path.basename(f.path))), f.sha256);
      if(currentCandidate){
        const cache=read(path.join(runRoot,"native-cache-restoration.json"));
        assert.equal(cache.status,"PASS");assert.equal(cache.deletedUserFiles,0);
        for(const f of cache.originalFiles)assert.equal(sha(path.join(cache.originalDirectory,f.relative)),f.sha256);
      }
      return { protectedFiles: r.products.length, actualNsisVersion: r.version };
    });
    await check("Screenshots preserve actual viewport/DPR/media and PNG physical pixels", () => {
      for (const s of r.screenshots) {
        assert.equal(sha(s.path), s.sha256); const b = fs.readFileSync(s.path);
        assert.equal(b.readUInt32BE(16), s.png.width); assert.equal(b.readUInt32BE(20), s.png.height);
      } return { screenshots: r.screenshots.length, physical4kDisplayClaimed: false };
    });
    await check("Native portable file retains applied components and actual asset bytes", async () => {
      assert(!fs.existsSync(r.projectArtifact.source)); assert.equal(sha(r.projectArtifact.path), r.projectArtifact.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(r.projectArtifact.path)), p = JSON.parse(await zip.file("project.json").async("string"));
      assert.deepEqual(p.editor_settings.runtimeUILayoutProfiles, r.merged.settings.runtimeUILayoutProfiles);
      const added = p.asset_manifest.filter(a => !r.baseline.assets.some(b => b.asset_id === a.asset_id)); assert.equal(added.length, 2);
      for (const a of p.asset_manifest) assert.equal(bytesSha(await zip.file(a.metadata.project_path).async("nodebuffer")), r.image.sha256);
      assert(!JSON.stringify(p).includes("authorizedProjectAssetIds"));
      return { artifact: r.projectArtifact, assets: p.asset_manifest.length, newAssets: 2, stagingDownloadRemoved: true };
    });
    await check("Read-only SQLite copy verifies final author conflict, untouched other project and materialized bytes", () => {
      const original = path.join(r.launches[0].data, "backend"), sqlite = path.join(out, "sqlite"); fs.mkdirSync(sqlite);
      for (const name of ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"]) {
        const f = path.join(original, name); if (!fs.existsSync(f)) continue;
        const copy = path.join(sqlite, name); fs.copyFileSync(f, copy, fs.constants.COPYFILE_EXCL); assert.equal(sha(copy), sha(f));
      }
      const db = new DatabaseSync(path.join(sqlite, "vn_engine.db"), { readOnly: true });
      try {
        const secretRow = db.prepare("SELECT value FROM editor_shared_state WHERE key=?").get("provider_secrets");
        assert(secretRow); assert.deepEqual(JSON.parse(secretRow.value), {}, "Synthetic provider secret must be cleared on disk");
        const projects = prep.projects.map(p => {
          const row = db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get(p.project_id); assert(row);
          return JSON.parse(row.project_json);
        });
        assert.deepEqual(projects[0].editor_settings.runtimeUILayoutProfiles, r.authorConflict.authored.editor_settings.runtimeUILayoutProfiles);
        assert.deepEqual(authoredNodes(projects[0].nodes), authoredNodes(r.baseline.nodes)); assert.deepEqual(projects[0].edges, r.baseline.edges);
        assert.deepEqual(projects[1].editor_settings, prep.projects[1].editor_settings);
        assert.deepEqual(authoredNodes(projects[1].nodes), authoredNodes(prep.projects[1].nodes)); assert.deepEqual(projects[1].edges, prep.projects[1].edges);
        const expectedOtherAssets = prep.projects[1].asset_manifest.map(a => authorAsset({
          ...a, metadata: { ...a.metadata, size_bytes: r.image.bytes },
        }));
        assert.deepEqual(projects[1].asset_manifest.map(authorAsset), expectedOtherAssets);
        for (const p of projects) for (const a of p.asset_manifest) {
          const relative = path.relative(path.join(original, "project_assets"), a.metadata.filePath);
          assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
          assert.equal(sha(a.metadata.filePath), r.image.sha256); assert.equal(fs.statSync(a.metadata.filePath).size, r.image.bytes);
        }
        const file = path.join(out, "persisted-projects.json"); fs.writeFileSync(file, JSON.stringify(projects, null, 2), { flag: "wx" });
        return { database: desc(path.join(sqlite, "vn_engine.db")), projects: desc(file), count: projects.length,
          syntheticProviderSecretsEmpty: true, otherProjectAssetMetadataPreserved: true };
      } finally { db.close(); }
    });
    await check("Owned process identities, two real host port pairs and controlled provider are gone", () => {
      assert(r.knownProcesses.length > 0); const now = rows(), keys = new Set(r.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`));
      assert(!now.some(p => keys.has(`${p.ProcessId}:${p.Created}`)));
      const ports = [...new Set([...r.launches.flatMap(l => l.ports), +new URL(r.modelEndpoint).port])];
      assert.equal(listeners(ports).length, 0);
      assert(!now.some(p => p.Name === "msedgewebview2.exe" && p.CommandLine?.includes(runRoot)));
      return { knownProcesses: keys.size, portsAbsent: ports, userFilesDeleted: 0,
        deletionScope: "Only exact new Downloads staging vnproj; source retained in F-drive evidence" };
    });
    assert.equal(report.groups.length, 6); report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
