"use strict";
// Scope business queries to the one marked functional grid. Animated retained
// cards remain visible but inert, without functional ownership markers.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateAbilitiesPreparation, adaptAbilitiesFlow, loadAdaptedFlow } = require("./lib/candidate-1924-abilities-adapter.cjs");
const index = process.argv.indexOf("--current-native-preparation");
assert(index > 0 && process.argv[index + 1]);
const prep = JSON.parse(fs.readFileSync(process.argv[index + 1], "utf8").replace(/^\uFEFF/, ""));
validateAbilitiesPreparation(prep);
assert.equal(sha("scripts/lib/candidate-1924-abilities-adapter.cjs"),
  "3e340fd029203f1e58d1bee06c365f60a350d149d030913f1c4766b3b41f34b3");
const original = path.join(__dirname, "installed-runtime-abilities-playwright.cjs");
let { source, adaptations } = adaptAbilitiesFlow(fs.readFileSync(original, "utf8"));
const probe = `
async function recordSaveGridLayers(label) {
  const sample = await page.evaluate(() => {
    const grids = [...document.querySelectorAll(".save-page-current[data-save-page-layer]")];
    const retained = [...document.querySelectorAll('[data-save-page-layer="retained"]')];
    return { at: performance.now(), liveGrids: grids.length,
      liveSlots: grids.reduce((n, g) => n + g.querySelectorAll(".save-slot").length, 0),
      liveSaved: grids.reduce((n, g) => n + g.querySelectorAll(".save-slot.has-save").length, 0),
      allSaved: document.querySelectorAll(".save-slot.has-save").length,
      retained: retained.map(g => ({ inert: g.inert, hidden: g.getAttribute("aria-hidden"),
        pointerEvents: getComputedStyle(g).pointerEvents, saved: g.querySelectorAll(".save-slot.has-save").length,
        functionalMarkers: g.querySelectorAll("[data-testid],[data-save-page-layer]").length,
        hasFocus: g.contains(document.activeElement) })) };
  });
  report.saveGridProbes ??= []; report.saveGridProbes.push({ label, ...sample }); save();
  assert.equal(sample.liveGrids, 1); assert.equal(sample.liveSlots, 6); assert.equal(sample.liveSaved, 6);
  assert.equal(sample.allSaved, sample.liveSaved + sample.retained.reduce((n, g) => n + g.saved, 0));
  for (const g of sample.retained) {
    assert(g.inert); assert.equal(g.hidden, "true"); assert.equal(g.pointerEvents, "none");
    assert.equal(g.functionalMarkers, 0); assert.equal(g.hasFocus, false);
  }
}
`;
const point = "async function quickFlow() {";
assert.equal(source.split(point).length - 1, 1); source = source.replace(point, probe + point);
const countSaved = 'assert.equal(await page.locator(".save-slot.has-save").count(), 6);';
assert.equal(source.split(countSaved).length - 1, 2);
source = source.replaceAll(countSaved,
  'await recordSaveGridLayers("quick-grid");\n' +
  '  assert.equal(await page.locator(".save-page-current[data-save-page-layer] .save-slot.has-save").count(), 6);');
const countAll = 'page.locator(".save-slot").count()';
assert.equal(source.split(countAll).length - 1, 1);
source = source.replace(countAll, 'page.locator(".save-page-current[data-save-page-layer] .save-slot").count()');
adaptations.push({ reason: "Global CSS counted inert manual-page snapshots as functional quick saves",
  oldSavedSelectors: 2, oldSlotSelectors: 1, currentGridRequired: 1, savedCountStillRequired: 6,
  snapshotDiagnostics: "Live/retained counts, inert, aria-hidden, pointer events, stripped markers and focus" });
const out = path.resolve(process.argv[2]);
assert.equal(path.dirname(out), prep.sessionRoot); assert.match(path.basename(out), /^cell-(0[1-9]|1[0-2])$/);
const executed = out + "-executed.cjs";
new (require("node:vm").Script)(Module.wrap(source), { filename: executed });
fs.writeFileSync(executed, source, { flag: "wx" });
fs.writeFileSync(out + "-adaptations.json", JSON.stringify({
  original: { path: original, sha256: sha(original) }, executed: { path: executed, sha256: sha(executed) }, adaptations,
}, null, 2), { flag: "wx" });
loadAdaptedFlow(source, __filename, module);
