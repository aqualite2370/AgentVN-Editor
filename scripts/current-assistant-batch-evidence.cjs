"use strict";
// Check existing evidence once; never launch, generate, merge or export again.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Assistant-Batch-1.9.35-20261102-01";
const playerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/assistant-batch-consumer-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const target = path.join(qa, "batch-and-consumption-evidence.json");
assert(!fs.existsSync(target), "Preserve prior evidence");
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [],
  newProductStarts: 0, newModelRequests: 0, productChanges: 0, builds: 0 };
async function check(name, fn) {
  const c = { name, status: "RUNNING" }; report.checks.push(c);
  try { c.detail = await fn(); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
}
function matrix(items) {
  assert.equal(items.length, 12);
  const actual = items.map(c => [c.width, c.height, c.dpr, c.reduced].join("/")).sort();
  const expected = [[1920, 1080], [2560, 1440], [3840, 2160]]
    .flatMap(([w, h]) => [1, 2].flatMap(d => [false, true].map(r => [w, h, d, r].join("/")))).sort();
  assert.deepEqual(actual, expected); assert(items.every(c => c.status === "PASS"));
}
(async () => {
  const files = ["session-01", "session-02", "session-03"].map(s => path.join(qa, s, "report.json"))
    .concat(path.join(playerRoot, "report.json"));
  const [review, failed, exported, player] = files.map(read);
  report.inputs = files.map(desc);
  await check("sources-installation-and-original-failed-export-preserved", () => {
    for (const leaf of ["binding.json", "export-binding.json", "player-binding.json"]) {
      const b = read(path.join(qa, leaf));
      for (const key of ["original", "adapter", "executed", "installation", "inputReport", "helper"])
        if (b[key]) assert.equal(sha(b[key].path), b[key].sha256);
    }
    for (const r of [review, failed, exported, player])
      for (const f of [...(r.products || []), ...(r.sources || []), ...(r.tools || [])])
        assert.equal(sha(f.path), f.sha256);
    assert.equal(failed.status, "FAILED"); assert(failed.error.includes("assertAssistantExportLayout"));
    assert.equal(exported.status, "PASS"); assert.equal(sha(exported.priorEvidence.path), exported.priorEvidence.sha256);
    assert.equal(exported.priorEvidence.newExportRequests, 0); assert.equal(exported.priorEvidence.newLaunches, 0);
    for (const key of ["cases", "screenshots", "launches", "cleanups", "persisted"])
      assert.deepEqual(exported[key], failed[key]);
    assert(failed.steps.slice(0, 2).every(s => s.status === "PASS"));
    assert(exported.steps.every(s => s.status === "PASS")); assert(exported.steps[2].strictLayoutEquality);
    return { originalFailureRetained: true, offlineRecoveryOnly: true, unchangedProductBinaries: true };
  });
  await check("six-actual-tools-local-receipts-selection-and-atomic-merge", () => {
    assert.equal(review.status, "PASS"); assert.equal(review.cases.length, 4);
    assert(review.cases.every(c => c.status === "PASS")); matrix(review.matrix);
    assert.equal(review.submissions.length, 1);
    assert.equal(review.submissions[0].accepted.status, 202);
    assert.equal(review.submissions[0].id, review.submissions[0].accepted.id);
    assert.equal(review.modelRequests.length, 6); assert(review.modelRequests.every(r => r.privateMaterialAbsent));
    assert.deepEqual(review.modelRequests.map(r => r.tool).sort(), ["read_assistant_context", "read_assistant_draft",
      "build_assistant_draft", "submit_assistant_component_draft", "validate_assistant_draft", "preview_assistant_draft"].sort());
    assert.equal(review.localReceipts.length, 2);
    assert(review.localReceipts.every(r => r.payload.result.ok && r.payload.result.component_count === 3));
    assert.deepEqual(review.localReceipts.map(r => r.payload.result.status).sort(), ["rendered", "validated"]);
    assert.deepEqual(review.atomicObservation, [2]);
    assert.deepEqual(review.baseline.nodes, review.merged.nodes); assert.deepEqual(review.baseline.edges, review.merged.edges);
    assert.deepEqual(review.baseline.settings.runtimeUILayoutProfiles.profiles.agentvn,
      review.merged.settings.runtimeUILayoutProfiles.profiles.agentvn);
    assert.deepEqual(review.merged.settings.runtimeUILayoutProfiles, review.reopened.settings.runtimeUILayoutProfiles);
    assert.equal(review.realModelRequests, 0); assert.equal(review.blockedModelRequests, 0);
    assert.equal(review.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
    assert(review.providerCleanup.stopped); assert.equal(review.providerCleanup.requests, 6);
    return { controlledRequests: 6, paidRequests: 0, tasks: 1, selected: 2, excluded: 1, atomicObservedCounts: [2] };
  });
  await check("native-portable-all-four-assets-and-strict-card-active-dependencies", async () => {
    assert.equal(sha(review.projectArtifact.path), review.projectArtifact.sha256);
    const portable = await JSZip.loadAsync(fs.readFileSync(review.projectArtifact.path), { checkCRC32: true });
    const project = JSON.parse(await portable.file("project.json").async("string"));
    assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, review.reopened.settings.runtimeUILayoutProfiles);
    assert.deepEqual(project.nodes, review.reopened.nodes); assert.deepEqual(project.edges, review.reopened.edges);
    const assets = Object.values(portable.files).filter(f => !f.dir && f.name.startsWith("assets/"));
    assert.equal(assets.length, 4);
    for (const a of assets) assert.equal(hash(await a.async("nodebuffer")), review.image.sha256);
    assert.equal(review.reopenedAssetBytes.length, 4);
    assert(review.reopenedAssetBytes.every(a => a.backendOwned && a.matchesPortableFile && a.sha256 === review.image.sha256));
    assert.equal(sha(exported.cartridge.path), exported.cartridge.sha256);
    assert.equal(player.cartridge.sha256, exported.cartridge.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(exported.cartridge.path), { checkCRC32: true });
    const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
    assert.deepEqual(layout, exported.persisted.editor_settings.runtimeUILayout);
    const components = layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
    assert.deepEqual(components.map(c => c.label).sort(), ["审核关于卡", "审核帮助卡"]);
    assert(!JSON.stringify(layout).includes("排除候选"));
    const ids = components.map(c => c.customComponent.root.children.find(n => n.tag === "img").assetId).sort();
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    assert.deepEqual(manifest.assets.map(a => a.asset_id).sort(), ids);
    assert(!manifest.assets.some(a => ["private-project", "project-asset-1"].includes(a.asset_id)));
    for (const a of manifest.assets) assert.equal(hash(await zip.file(a.path).async("nodebuffer")), review.image.sha256);
    matrix(exported.cases);
    return { portable: desc(review.projectArtifact.path), cartridge: desc(exported.cartridge.path),
      portableAssets: 4, activeExportAssets: 2, strictLayoutEquality: true };
  });
  await check("actual-installed-player-two-components-images-actions-and-story", () => {
    assert.equal(player.status, "PASS"); matrix(player.cases);
    assert.equal(player.executable.sha256, "66945ed6a9d026ab2f17370c9fe1fa207cdc741b7005f61f1ccd539c56e46b0e");
    assert.equal(sha(player.executable.path), player.executable.sha256);
    for (const c of player.cases) {
      assert.equal(c.components.length, 2); assert.equal(c.actions.length, 2);
      assert(c.components.every(a => a.hit && a.overflow <= 1 && a.images.length === 1
        && a.images.every(i => i.width > 0 && i.height > 0 && i.sha256 === review.image.sha256)));
      assert(c.actions.every(a => a.status === "PASS" && a.returned));
      assert.deepEqual(c.actions.map(a => a.target).sort(), ["about", "help"]);
    }
    assert(player.story.advancedIntoActualStory); assert(player.story.text.length > 0);
    assert.deepEqual(player.errors, []); assert.equal(player.modelRequests, 0);
    return { displayCombinations: 12, decodedImages: 24, actualActionRoundTrips: 24, storyStart: true };
  });
  await check("capture-bytes-actual-dpr-and-original-profile-process-cleanup", () => {
    const captures = [...new Map([review, exported, player].flatMap(r => r.screenshots).map(c => [c.path, c])).values()];
    assert(captures.length >= 16);
    for (const c of captures) {
      assert.equal(sha(c.path), c.sha256); assert.deepEqual(c.before, c.after);
      const b = fs.readFileSync(c.path); assert.equal(b.toString("hex", 0, 8), "89504e470d0a1a0a");
      assert.equal(b.readUInt32BE(16), c.png.width); assert.equal(b.readUInt32BE(20), c.png.height);
      assert(Math.abs(c.before.width * c.before.dpr - c.png.width) < 0.01);
      assert(Math.abs(c.before.height * c.before.dpr - c.png.height) < 0.01);
    }
    for (const r of [review, failed, player]) assert(r.cleanups.length && r.cleanups.every(c => c.status === "PASS"));
    assert.equal(review.cacheRestoration, "PASS");
    assert.equal(read(exported.cacheRestoration.path).status, "PASS");
    assert.equal(read(player.profileRestoration.path).status, "PASS");
    const identities = [review, failed, player].flatMap(r => r.knownProcesses);
    assert(!rows().some(p => identities.some(q => p.ProcessId === q.ProcessId && p.Created === q.Created)));
    const ports = [review, failed].flatMap(r => r.launches.flatMap(l => l.ports)).concat(player.launches.map(l => l.port));
    assert.equal(listeners(ports).length, 0);
    assert(review.downloadCleanup.removed); assert(!fs.existsSync(review.downloadCleanup.path));
    assert.equal(sha(review.downloadCleanup.retainedCopy), review.projectArtifact.sha256);
    const db = new DatabaseSync(path.join(qa, "session-01/data/backend/vn_engine.db"), { readOnly: true });
    try {
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
        assert(/^[a-zA-Z0-9_]+$/.test(name));
        assert(!db.prepare(`SELECT * FROM "${name}"`).all().some(r => JSON.stringify(r).includes("test-only-secret")));
      }
    } finally { db.close(); }
    return { captures: captures.length, processIdentities: identities.length, uniquePorts: new Set(ports).size,
      remainingOwnedProcesses: 0, cacheAndProfileRestored: true, credentialAbsent: true, userFilesDeleted: 0 };
  });
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(target, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, target, error: report.error }));
  });
