"use strict";
// Independent evidence gate. Rejects missing/contradictory evidence; does not launch products.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), JSZip = require("../editor/node_modules/jszip");
const { graphContent, cartridgeEvidence } = require("./native-novel-consume.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-01";
const load = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function validate(r) {
  assert(["CURRENT_NATIVE_NOVEL_EXPORT_PLAYER_PASS", "CURRENT_NATIVE_NOVEL_EXPORT_PLAYER_PASS_WITH_TASK_CARD_OVERLAP"].includes(r.status));
  assert.equal(r.status.endsWith("_WITH_TASK_CARD_OVERLAP"), r.knownDefects.length > 0);
  assert(r.finishedAt && !r.error && !r.editorCleanupError && !r.playerCleanupError && !r.immutabilityError);
  assert.equal(r.productChanges, 0); assert.equal(r.devPublicationBuilds, 0);
  assert.equal(r.modelRequests, 0); assert.equal(r.realModelRequests, 0); assert.equal(r.charges, 0);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.projects.map(p => p.kind), ["default", "partial"]);
  assert.deepEqual(r.inputs.map(p => p.kind), ["default", "partial"]);
  assert.deepEqual(r.cases.map(c => c.name), ["default-public-import-and-real-graph-handle-connection",
    "default-native-save-and-real-publish-byte-exact-cartridge",
    "partial-public-import-and-real-graph-handle-connection",
    "partial-native-save-and-real-publish-byte-exact-cartridge",
    "default-current-external-player-real-advance-through-novel",
    "partial-current-external-player-real-advance-through-novel"]);
  assert(r.cases.every(c => c.status === "PASS" && c.startedAt && c.finishedAt));
  for (const p of r.projects) {
    const input = r.inputs.find(i => i.kind === p.kind);
    assert.equal(p.id, input.id); assert.equal(p.before.id, p.id); assert.equal(p.connected.id, p.id);
    assert.deepEqual(graphContent(p.before), graphContent(input.expected));
    assert.deepEqual(graphContent(p.connected).nodes, graphContent(p.before).nodes);
    assert.deepEqual(p.connected.settings, p.before.settings);
    const oldIds = new Set(p.before.edges.map(e => e.id)), edges = graphContent(p.connected).edges;
    assert.equal(edges.length, p.before.edges.length + 1);
    assert.deepEqual(edges.filter(e => oldIds.has(e.id)), graphContent(p.before).edges);
    const added = edges.filter(e => !oldIds.has(e.id)); assert.equal(added.length, 1);
    assert.deepEqual(p.addedEdge, added[0]); assert.equal(added[0].source, "scene");
    assert.equal(added[0].sourceHandle, "default"); assert.equal(added[0].target, input.novelNodeIds[0]);
    for (const point of [p.gesture.source, p.gesture.target])
      assert(point.hit && point.inViewport && point.overflow <= 1 && point.rect.width > 0 && point.rect.height > 0);
    if (!p.exportHitBefore.hit) {
      const defect = r.knownDefects.find(d => d.kind === p.kind); assert(defect);
      assert.equal(defect.status, "FAILED_NOT_FIXED"); assert(defect.evidence.taskCard && defect.evidence.enabled);
      assert(defect.afterRealDrag.hit && p.exportHitAfter.hit);
    }
    assert.equal(p.player.mode, "preview"); assert.equal(p.player.notStandaloneSetup, true);
    assert(p.player.pid > 0 && p.player.port > 0);
    assert.equal(p.playback.length, p.kind === "default" ? 2 : 3);
    assert.deepEqual(p.playback.map(v => v.expected), p.exported.playback);
    assert.equal(p.exported.script.scenes.length, p.playback.length);
    for (const v of p.playback) {
      assert.equal(v.observed.scene, v.expected.sceneId); assert.equal(v.observed.commandType, v.expected.type);
      assert.equal(v.observed.text, v.expected.text); assert(v.observed.label.includes(v.expected.text));
      assert.equal(v.observed.done, "true"); assert.equal(v.observed.pages, "1");
      assert(v.observed.hit && v.observed.overflow <= 1 && v.observed.rect.x >= 0 && v.observed.rect.y >= 0
        && v.observed.rect.right <= 1920 && v.observed.rect.bottom <= 1080);
    }
  }
  assert.equal(r.launches.length, 1); assert.equal(r.cleanups.length, 1);
  assert.equal(r.playerCleanups.length, 2);
  for (const c of [...r.cleanups, ...r.playerCleanups]) {
    assert(c.killed.length > 0); assert.deepEqual(c.survivors, []); assert.deepEqual(c.listeners, []);
    assert.equal(c.normalExitClaimed ?? c.normalCloseClaimed, false);
  }
  assert(r.profileRestoration?.path && r.profileRestoration.sha256);
  assert.equal(r.screenshots.length, 9 + r.knownDefects.length);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after); assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080);
    assert(Math.abs(s.before.dpr - 1) <= 1e-6); assert.equal(s.before.reduced, false);
    assert.equal(s.png.width, 1920); assert.equal(s.png.height, 1080);
  }
  return { businessCases: 6, projects: 2, originalStoryObservations: 2, novelSceneObservations: 3,
    realNativeEditor: 1, realExternalPreviewPlayers: 2, physicalInput: false,
    installedRelease: false, realModel: false, unresolvedTaskCardObstructions: r.knownDefects.length,
    displayScope: "1080p DPR1 normal lifecycle only" };
}
function selfTest(r) {
  validate(r);
  const bad = [
    x => { x.status = "PASS"; }, x => { delete x.finishedAt; }, x => { x.cases = []; },
    x => { x.cases[0].status = "NOT_RUN"; }, x => { x.projects.pop(); }, x => { x.inputs = []; },
    x => { x.projects[0].before.edges = []; }, x => { x.projects[0].connected.nodes[0].data.label = "changed"; },
    x => { x.projects[0].connected.edges.pop(); }, x => { x.projects[0].addedEdge.target = "scene"; },
    x => { x.projects[0].gesture.target.hit = false; }, x => { x.projects[0].gesture.source.inViewport = false; },
    x => { x.projects[0].player.mode = "installed"; }, x => { x.projects[1].playback.pop(); },
    x => { x.projects[0].playback[1].observed.scene = "wrong"; },
    x => { x.projects[1].playback[1].observed.text = "wrong"; },
    x => { x.projects[1].playback[1].observed.done = "false"; },
    x => { x.projects[0].playback[0].observed.hit = false; },
    x => { x.projects[1].playback[2].observed.overflow = 20; },
    x => { x.modelRequests = 1; }, x => { x.realModelRequests = 1; }, x => { x.productChanges = 1; },
    x => { x.devPublicationBuilds = 1; }, x => { x.cleanups[0].survivors.push({}); },
    x => { x.playerCleanups[1].listeners.push({}); }, x => { x.playerCleanups.pop(); },
    x => { delete x.profileRestoration; }, x => { x.screenshots.pop(); },
    x => { x.screenshots[0].png.width = 3840; }, x => { x.errors.push("uncaught"); },
  ];
  for (const mutate of bad) { const broken = structuredClone(r); mutate(broken); assert.throws(() => validate(broken)); }
  return bad.length;
}
async function audit(name, iteration) {
  assert(/^novel-consume-audit-\d{2}$/.test(name)); assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const reportPath = path.join(qa, `novel-consume-${iteration}/report.json`), r = load(reportPath);
  const receipt = { status: "RUNNING", at: new Date().toISOString(), report: { path: reportPath, sha256: sha(reportPath) } };
  try {
    receipt.coverage = validate(r); receipt.rejectedBadVariants = selfTest(r);
    for (const f of [...r.products, ...r.sources, ...r.inputs.flatMap(i => [i.prior, i.original, i.input])])
      assert.equal(sha(f.path), f.sha256, f.path);
    assert.equal(sha(path.join(root, "scripts/native-novel-consume.cjs")),
      sha(path.join(path.dirname(reportPath), "executed-test.cjs")));
    receipt.projects = [];
    for (const p of r.projects) {
      assert.equal(sha(p.cartridge.path), p.cartridge.sha256); assert.equal(sha(p.connectedBundle.path), p.connectedBundle.sha256);
      const input = r.inputs.find(i => i.kind === p.kind);
      const actual = await cartridgeEvidence(p.cartridge.path, input);
      assert.deepEqual(actual, p.exported);
      const zip = await JSZip.loadAsync(fs.readFileSync(p.connectedBundle.path), { checkCRC32: true });
      const saved = JSON.parse(await zip.file("project.json").async("string"));
      assert.equal(saved.project_id, p.id); assert.deepEqual(graphContent(saved.graph ?? saved), graphContent(p.connected));
      assert.deepEqual(saved.editor_settings.runtimeUILayoutProfiles, p.before.settings.runtimeUILayoutProfiles);
      receipt.projects.push({ kind: p.kind, cartridge: p.cartridge, connectedBundle: p.connectedBundle,
        scriptSha256: actual.scriptSha256, layoutSha256: actual.layoutSha256, assets: actual.assets,
        played: p.playback.map(v => ({ scene: v.observed.scene, text: v.observed.text })) });
    }
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); const bytes = fs.readFileSync(s.path);
      assert.equal(bytes.readUInt32BE(16), s.png.width); assert.equal(bytes.readUInt32BE(20), s.png.height);
    }
    assert.equal(sha(r.profileRestoration.path), r.profileRestoration.sha256);
    const restored = load(r.profileRestoration.path);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    assert.equal(restored.restored.length, 3); assert.equal(restored.removedOnlyOwnedJunctions, true);
    const now = rows(), owned = [...r.known, ...r.playerKnown], ports = [...r.launches[0].ports, ...r.projects.map(p => p.player.port)];
    assert(!owned.some(p => now.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
    assert.equal(listeners(ports).length, 0); receipt.processIdentitiesAbsent = owned.length; receipt.portsAbsent = ports;
    receipt.profileRestoration = r.profileRestoration;
    receipt.status = r.knownDefects.length
      ? "VERIFIED_EXPORT_PLAYER_WITH_REAL_DRAG_WORKAROUND_CARD_OVERLAP_REMAINS_FAILED_NOT_RELEASE"
      : "VERIFIED_CURRENT_DEV_NOVEL_EXPORT_AND_PREVIEW_PLAYER_NOT_INSTALLED_RELEASE";
  } catch (e) { receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
    console.log(JSON.stringify(receipt, null, 2));
  }
}
if (process.argv[2] === "--test")
  console.log(`PASS ${selfTest(load(path.join(qa, `novel-consume-${process.argv[3] || "01"}/report.json`)))} invalid variants rejected`);
else audit(process.argv[2], process.argv[3] || "01").catch(e => { console.error(e); process.exitCode = 1; });
