"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { qa, desc } = require("./native-novel-card-publish.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
function validate(r) {
  assert.equal(r.status, "CURRENT_NATIVE_NOVEL_CARD_PUBLISH_PASS");
  assert(r.finishedAt && !r.error && !r.cleanupError && !r.immutabilityError); assert.deepEqual(r.errors, []);
  assert.equal(r.modelRequests, 0); assert.equal(r.realModelRequests, 0); assert.deepEqual(r.requests, []);
  assert.deepEqual(r.cases.map(c => c.name), ["default-completed-card-does-not-block-real-publish",
    "publish-live-bounds-full-desktop-matrix-and-dock-toggle",
    "custom-position-roundtrip-reload-and-project-isolation", "reduced-keyboard-reflow-captured-drag-and-rapid-reverse"]);
  assert(r.cases.every(c => c.status === "PASS"));
  assert.equal(r.inputs.length, 2); assert.equal(r.launches.length, 1); assert.equal(r.cleanups.length, 1);
  assert(r.cleanups[0].killed.length > 0); assert.equal(r.cleanups[0].normalExitClaimed, false);
  assert.deepEqual(r.cleanups[0].survivors, []); assert.deepEqual(r.cleanups[0].listeners, []);
  function safe(g) {
    assert(g.dock && g.button && !g.overlap && g.hit && g.overflow <= 1);
    assert(g.card.bottom <= g.dock.top - 11 && g.card.x >= 12 && g.card.y >= 12
      && g.card.right <= g.actual.width - 11 && g.card.bottom <= g.actual.height - 11);
  }
  safe(r.baseline);
  assert.equal(r.matrix.length, 12);
  const keys = new Set();
  for (const m of r.matrix) {
    assert.equal(m.status, "PASS"); assert([[1920, 1080], [2560, 1440], [3840, 2160]].some(v => v[0] === m.width && v[1] === m.height));
    assert([1, 2].includes(m.dpr) && typeof m.reduced === "boolean");
    const key = `${m.width}/${m.height}/${m.dpr}/${m.reduced}`; assert(!keys.has(key)); keys.add(key);
    for (const g of [m.expanded, m.toggled, m.restored]) {
      safe(g); assert.equal(g.actual.width, m.width); assert.equal(g.actual.height, m.height);
      assert(Math.abs(g.actual.dpr - m.dpr) <= 1e-6); assert.equal(g.actual.reduced, m.reduced);
    }
    assert(Math.abs(m.toggled.dock.height - m.expanded.dock.height) > 10);
    assert(Math.abs(m.restored.dock.height - m.expanded.dock.height) < 1);
    assert.equal(m.restored.position, m.expanded.position);
  }
  const p = r.positionRoundtrip; assert(p.preferred.position);
  for (const g of [p.avoided, p.otherPublish, p.reset]) safe(g);
  for (const g of [p.avoided, p.restored, p.reloaded]) assert.equal(g.position, p.preferred.position);
  for (const g of [p.restored, p.reloaded]) assert(Math.abs(g.card.x - p.preferred.card.x) < 1 && Math.abs(g.card.y - p.preferred.card.y) < 1);
  assert.equal(p.other.position, null); assert.equal(p.reset.position, null);
  const low = Math.min(p.preferred.card.y, p.avoided.card.y), high = Math.max(p.preferred.card.y, p.avoided.card.y);
  assert(high - low > 10);
  assert(r.enterFrames.some(f => f.card?.y > low + 1 && f.card?.y < high - 1
    && f.animations.some(a => a.state === "running")), "Normal placement has no actual intermediate frame");
  assert(r.leaveFrames.some(f => f.card?.y > low + 1 && f.card?.y < high - 1
    && f.animations.some(a => a.state === "running")), "Return placement has no actual intermediate frame");
  assert(r.reducedEnterFrames.some(f => f.animations.some(a => a.state === "running" && a.duration === 80)));
  assert(r.reverseFrames.length > 2); safe(r.reverseFinal);
  assert(Math.abs(r.pointerOwnership.held.card.x - r.pointerOwnership.resizedWhileHeld.card.x) < 1
    && Math.abs(r.pointerOwnership.held.card.y - r.pointerOwnership.resizedWhileHeld.card.y) < 1);
  assert.equal(r.screenshots.length, 5);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after); assert.equal(s.png.width, Math.round(s.before.width * s.before.dpr));
    assert.equal(s.png.height, Math.round(s.before.height * s.before.dpr));
  }
  return { nativeFlows: 4, actualExports: 1, desktopMatrix: keys.size, projectPositions: 2,
    ordinaryAndReducedIntermediateFrames: true, keyboard: true, physicalInput: false, installedRelease: false };
}
function selfTest(r) {
  validate(r);
  const variants = [
    r => { r.status = "PASS"; }, r => { delete r.finishedAt; }, r => { r.matrix = []; }, r => { r.cases.pop(); },
    r => { r.matrix[0].expanded.overlap = true; }, r => { r.baseline.hit = false; },
    r => { r.matrix[1].expanded.actual.dpr = 3; }, r => { r.matrix[1] = structuredClone(r.matrix[0]); },
    r => { r.matrix[0].toggled.dock.height = r.matrix[0].expanded.dock.height; },
    r => { r.positionRoundtrip.reloaded.position = "changed"; }, r => { r.positionRoundtrip.other.position = "A"; },
    r => { r.enterFrames = []; }, r => { r.leaveFrames = []; }, r => { r.reducedEnterFrames = []; },
    r => { r.reverseFrames = []; }, r => { r.pointerOwnership.resizedWhileHeld.card.x += 100; },
    r => { r.cleanups[0].survivors.push({}); }, r => { r.cleanups[0].listeners.push({}); },
    r => { r.cleanups[0].normalExitClaimed = true; }, r => { r.modelRequests = 1; },
    r => { r.errors.push("uncaught"); }, r => { r.screenshots.pop(); }, r => { r.screenshots[0].png.width++; },
  ];
  for (const mutate of variants) { const bad = structuredClone(r); mutate(bad); assert.throws(() => validate(bad)); }
  return variants.length;
}
async function main() {
  const [name, iteration] = process.argv.slice(2); assert(/^audit-\d{2}$/.test(name) && /^\d{2}$/.test(iteration));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const file = path.join(qa, `session-${iteration}/report.json`), r = JSON.parse(fs.readFileSync(file, "utf8"));
  const receipt = { status: "RUNNING", at: new Date().toISOString(), report: desc(file) };
  try {
    receipt.coverage = validate(r); receipt.invalidVariantsRejected = selfTest(r);
    for (const f of [...r.sources, ...r.products, ...r.inputs.flatMap(i => [i.input, i.original])])
      assert.equal(desc(f.path).sha256, f.sha256);
    assert.equal(desc(__filename.replace("-audit.cjs", ".cjs")).sha256,
      desc(path.join(path.dirname(file), "executed-test.cjs")).sha256);
    assert.equal(desc(r.cartridge.path).sha256, r.cartridge.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(r.cartridge.path), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
    assert.equal(manifest.game_id, r.inputs[0].id); assert.equal(script.scenes.length, 2);
    assert.equal(script.scenes.find(s => s.scene_id === "ui_acceptance").next_scene_id, "qa_default_scene");
    receipt.cartridge = r.cartridge;
    for (const s of r.screenshots) {
      assert.equal(desc(s.path).sha256, s.sha256); const b = fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16), s.png.width); assert.equal(b.readUInt32BE(20), s.png.height);
    }
    const now = rows(); assert(!r.known.some(p => now.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
    receipt.processIdentitiesAbsent = r.known.length; receipt.portsAbsent = r.launches.flatMap(l => l.ports);
    assert.equal(listeners(receipt.portsAbsent).length, 0);
    receipt.status = "CURRENT_NATIVE_NOVEL_CARD_PUBLISH_EVIDENCE_VERIFIED";
  } catch (e) { receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; }
  finally { receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
    console.log(JSON.stringify(receipt, null, 2)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
