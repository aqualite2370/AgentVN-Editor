"use strict";
// All modifications are recorded as exact single replacements. The old
// business source and every failed receipt remain unchanged.
const assert = require("node:assert/strict");
const { adaptAbilitiesFlow } = require("./candidate-1924-abilities-adapter.cjs");
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
function buildCurrentAbilitiesFlow(original) {
  let { source, adaptations } = adaptAbilitiesFlow(original);
  function one(before, after, reason) {
    assert.equal(source.split(before).length - 1, 1, reason);
    source = source.replace(before, after); adaptations.push({ before, after, reason });
  }
  one("async function quickFlow() {", probe + "async function quickFlow() {",
    "Record the sole live grid and input-inert presentation layers");
  const saved = 'assert.equal(await page.locator(".save-slot.has-save").count(), 6);';
  for (const indent of ["  ", "        "]) {
    one("\n" + indent + saved, "\n" + indent + 'await recordSaveGridLayers("quick-grid");\n' +
      indent + 'assert.equal(await page.locator(".save-page-current[data-save-page-layer] .save-slot.has-save").count(), 6);',
    `Count the actual six live quick saves, retaining snapshot safety assertions (${indent.length}-space callsite)`);
  }
  one('page.locator(".save-slot").count()',
    'page.locator(".save-page-current[data-save-page-layer] .save-slot").count()',
    "Manual category still has six functional slots during the outgoing quick-page transition");
  one("`${current}-player.log`", "`${current}-player-${report.launches.length + 1}.log`",
    "Each of three actual process launches has its own exclusive log, never overwrite a prior launch");
  assert.equal(adaptations.length, 11);
  return { source, adaptations };
}
module.exports = { buildCurrentAbilitiesFlow };
