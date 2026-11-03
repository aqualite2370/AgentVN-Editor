"use strict";
// Independent full business audit plus exact reconstruction of the grid-query
// adaptation and checks that retained cards cannot own input.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module"), vm = require("node:vm");
assert.equal(process.argv[2], "03");
const original = path.join(__dirname, "candidate-1924-abilities-audit.cjs");
let source = fs.readFileSync(original, "utf8");
assert.equal(crypto.createHash("sha256").update(source).digest("hex"),
  "622c810a835f78951181f32a4c39a1ab3f46ec459101f371e4c5712d127b6688");
const before = `      assert.equal(adapted.adaptations.length, 6);
      for (const change of adapted.adaptations) {
        assert.equal(actual.split(change.before).length - 1, 1); actual = actual.replace(change.before, change.after);
      }`;
assert.equal(source.split(before).length - 1, 1);
source = source.replace(before, `
      assert.equal(adapted.adaptations.length, 7);
      for (const change of adapted.adaptations.slice(0, 6)) {
        assert.equal(actual.split(change.before).length - 1, 1); actual = actual.replace(change.before, change.after);
      }
      const flow = session.tools.find(t => path.basename(t.path) === "candidate-1924-abilities-grid-flow.cjs");
      assert(flow); assert.equal(sha(flow.path), flow.sha256);
      const probeMatch = /const probe = \`([\\s\\S]*?)\`;/u.exec(fs.readFileSync(flow.path, "utf8"));
      assert(probeMatch); assert(!probeMatch[1].includes("\\\\"));
      assert(!probeMatch[1].includes("$" + "{"));
      const point = "async function quickFlow() {";
      assert.equal(actual.split(point).length - 1, 1);
      actual = actual.replace(point, probeMatch[1] + point);
      const countSaved = 'assert.equal(await page.locator(".save-slot.has-save").count(), 6);';
      assert.equal(actual.split(countSaved).length - 1, 2);
      actual = actual.replaceAll(countSaved, 'await recordSaveGridLayers("quick-grid");\\n' +
        '  assert.equal(await page.locator(".save-page-current[data-save-page-layer] .save-slot.has-save").count(), 6);');
      const countAll = 'page.locator(".save-slot").count()';
      assert.equal(actual.split(countAll).length - 1, 1);
      actual = actual.replace(countAll, 'page.locator(".save-page-current[data-save-page-layer] .save-slot").count()');
      assert.deepEqual(adapted.adaptations[6], {
        reason: "Global CSS counted inert manual-page snapshots as functional quick saves",
        oldSavedSelectors: 2, oldSlotSelectors: 1, currentGridRequired: 1, savedCountStillRequired: 6,
        snapshotDiagnostics: "Live/retained counts, inert, aria-hidden, pointer events, stripped markers and focus"
      });`);
const end = '  report.status = "PASS";';
assert.equal(source.split(end).length - 1, 1);
source = source.replace(end, `
  check("Each real current grid has six saves; retained presentation has no input or ownership", () => {
    let samples = 0, visibleRetainedSamples = 0;
    for (const cell of session.cells) {
      const raw = read(cell.raw.path);
      assert.equal(raw.saveGridProbes.length, 2);
      for (const p of raw.saveGridProbes) {
        samples++;
        assert.equal(p.liveGrids, 1); assert.equal(p.liveSlots, 6); assert.equal(p.liveSaved, 6);
        assert.equal(p.allSaved, p.liveSaved + p.retained.reduce((n, g) => n + g.saved, 0));
        if (p.allSaved > p.liveSaved) visibleRetainedSamples++;
        for (const g of p.retained) {
          assert(g.inert); assert.equal(g.hidden, "true"); assert.equal(g.pointerEvents, "none");
          assert.equal(g.functionalMarkers, 0); assert.equal(g.hasFocus, false);
        }
      }
    }
    assert.equal(samples, 24); assert(visibleRetainedSamples > 0);
    return { samples, visibleRetainedSamples, oldGlobalCountNotFunctionalSaveCount: true };
  });
` + end);
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv.includes("--self-test")) {
  assert(source.includes("assert.equal(raw.checks.length, 16)"));
  assert(source.includes("assert.equal(samples, 24)"));
  console.log("PASS sealed original, full business assertions, generated syntax and additional grid guards");
} else {
  const adapted = new Module(__filename, module); adapted.filename = __filename; adapted.paths = module.paths;
  adapted._compile(source, __filename);
}
