"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-01";
const root = path.resolve(__dirname, "..");
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
function validate(r) {
  assert(["EXPORT_CONSUMPTION_PASS_WINDOW_FAILURE_REPRODUCED", "EXPORT_CONSUMPTION_PASS_WINDOW_ORIGINAL_FAILURE_UNRESOLVED"].includes(r.status));
  assert(r.finishedAt && !r.error && !r.editorCleanupError && !r.playerCleanupError && !r.immutabilityError);
  assert.equal(r.modelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.devPublicationBuilds, 0);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.steps.map(s => s.name), ["window-fast-gesture-observation",
    "actual-dev-publish-ui-exports-merged-candidates-and-byte-exact-dependencies",
    "external-current-player-renders-exported-components-and-executes-whitelisted-actions"]);
  assert(r.steps.every(s => s.status === "PASS"));
  assert.equal(r.gestures.length, 20);
  assert.equal(r.windowObservation.attempts, 20);
  const bad = r.gestures.filter(g => !g.widthPass || !g.heightPass);
  assert.equal(r.windowObservation.mismatches, bad.length);
  assert.equal(r.windowObservation.status, bad.length ? "REPRODUCED" : "NOT_REPRODUCED_ORIGINAL_UNRESOLVED");
  for (let i = 0; i < 20; i++) {
    assert.equal(r.gestures[i].attempt, i);
    const events = r.gestureTrace.events.filter(e => e.attempt === i);
    // The same trace also includes genuine reset/close-button clicks.
    assert(events.filter(e => e.type === "pointerdown").length >= 2);
    assert(events.filter(e => e.type === "pointerup").length >= 2);
    assert(events.some(e => e.type === "pointerdown" && String(e.target).includes("workbench-resize")));
    assert(events.filter(e => e.type === "pointermove").length >= 12);
  }
  assert(r.gestureTrace.styles.length > 0);
  assert.equal(r.cartridge.assets.length, 2);
  assert.equal(r.playerActions.length, 2);
  assert.deepEqual(r.playerActions.map(a => a.screen), ["about", "help"]);
  assert(r.playerActions.every(a => a.status === "PASS" && a.geometry.hit && a.geometry.overflow <= 1));
  assert.equal(r.player.originalStoryAction, "PASS");
  assert.equal(r.player.mode, "preview"); assert.equal(r.player.notStandaloneSetup, true);
  assert.equal(r.launches.length, 1); assert.equal(r.cleanups.length, 1);
  assert.equal(r.cleanups[0].normalExitClaimed, false);
  assert(r.cleanups[0].killed.length > 0); assert.deepEqual(r.cleanups[0].survivors, []); assert.deepEqual(r.cleanups[0].listeners, []);
  assert(r.playerCleanup.killed.length > 0); assert.equal(r.playerCleanup.normalCloseClaimed, false);
  assert.deepEqual(r.playerCleanup.survivors, []); assert.deepEqual(r.playerCleanup.listeners, []);
  assert.equal(r.screenshots.length, 2);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after); assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080);
    assert(Number.isFinite(s.before.dpr) && Math.abs(s.before.dpr - 1) <= 1e-6);
    assert.equal(s.before.reduced, false);
    assert.equal(s.png.width, 1920); assert.equal(s.png.height, 1080);
  }
  return { diagnosticAttempts: 20, gestureMismatches: bad.length, nativeEditorStarts: 1, nativePlayerStarts: 1,
    actualExportedComponents: 2, actualComponentActions: 2, sourceLayer: "Dev, not installed Release",
    originalGestureFailureCleared: false };
}
function selfTest(r) {
  validate(r);
  const variants = [
    r => { r.status = "PASS"; }, r => { delete r.finishedAt; }, r => { r.steps.pop(); },
    r => { r.gestures = []; }, r => { r.gestureTrace.events = []; }, r => { r.windowObservation.status = "PASS"; },
    r => { r.cartridge.assets.pop(); }, r => { r.playerActions[0].geometry.hit = false; },
    r => { r.player.mode = "installed"; }, r => { r.modelRequests = 1; },
    r => { r.player.originalStoryAction = "NOT_RUN"; }, r => { r.cleanups[0].survivors.push({}); },
    r => { r.playerCleanup.listeners.push({}); }, r => { r.screenshots[0].png.width = 3840; },
  ];
  for (const mutate of variants) { const b = structuredClone(r); mutate(b); assert.throws(() => validate(b)); }
  console.log(`PASS ${variants.length} invalid evidence variants rejected`); return variants.length;
}
async function audit(name, iteration) {
  assert(/^consume-audit-\d{2}$/.test(name)); assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const reportPath = path.join(qa, `assistant-consume-${iteration}/report.json`), r = load(reportPath);
  const receipt = { status: "RUNNING", at: new Date().toISOString(), report: { path: reportPath, sha256: sha(reportPath) } };
  try {
    receipt.coverage = validate(r); receipt.rejectedBadVariants = selfTest(r);
    for (const f of [...r.products, ...r.sources, r.input, r.prior]) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(path.join(root, "scripts/native-assistant-consume.cjs")),
      sha(path.join(path.dirname(reportPath), "executed-test.cjs")));
    assert.equal(sha(r.cartridge.path), r.cartridge.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(r.cartridge.path), { checkCRC32: true });
    const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer");
    assert.equal(hash(layoutBytes), r.cartridge.layoutSha256);
    const layout = JSON.parse(layoutBytes.toString("utf8"));
    const components = layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
    assert.equal(components.length, 2);
    assert.deepEqual(components, r.importedProject.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "title")
      .components.filter(c => c.component_type === "custom_component"));
    const prior = load(r.prior.path);
    for (const asset of r.cartridge.assets) assert.equal(hash(await zip.file(asset.path).async("nodebuffer")), prior.image.sha256);
    for (const s of r.screenshots) {
      const bytes = fs.readFileSync(s.path); assert.equal(hash(bytes), s.sha256);
      assert.equal(bytes.readUInt32BE(16), s.png.width); assert.equal(bytes.readUInt32BE(20), s.png.height);
    }
    assert.equal(sha(r.profileRestoration.path), r.profileRestoration.sha256);
    const restored = load(r.profileRestoration.path); assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    assert.equal(restored.restored.length, 3);
    const now = rows(), owned = [...r.known, ...r.playerKnown];
    assert(!owned.some(p => now.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
    const ports = [...r.launches[0].ports, r.player.port]; assert.equal(listeners(ports).length, 0);
    receipt.processIdentitiesAbsent = owned.length; receipt.portsAbsent = ports;
    receipt.profileRestoration = r.profileRestoration;
    receipt.status = "VERIFIED_CURRENT_DEV_EXPORT_PLAYER_CONSUMPTION_NOT_RELEASE_WINDOW_FAILURE_REMAINS";
  } catch (e) { receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
    console.log(JSON.stringify(receipt, null, 2));
  }
}
if (process.argv[2] === "--test") selfTest(load(path.join(qa, `assistant-consume-${process.argv[3] || "02"}/report.json`)));
else audit(process.argv[2], process.argv[3] || "02").catch(e => { console.error(e); process.exitCode = 1; });
