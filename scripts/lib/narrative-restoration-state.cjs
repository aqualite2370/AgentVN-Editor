"use strict";
const assert = require("node:assert/strict");

/** Persistence restores narrative state, not a previous process's fractional
 * layout boxes. Require exact content/font/page identity AND independently
 * validate the actual restored geometry; never add a rectangle-delta waiver. */
function assertRestoredNarrativeState(actual, expected, viewport) {
  for (const key of ["scene", "command", "mode", "page", "pages", "text", "font"])
    assert.equal(actual[key], expected[key], `Restored ${key} changed`);
  assert(Number.isFinite(actual.font) && actual.font >= 12);
  assert.deepEqual(actual.nvl.map(n => ({ text: n.text, font: n.font })),
    expected.nvl.map(n => ({ text: n.text, font: n.font })), "Restored NVL content/font changed");
  const { rect, region, glyphs } = actual;
  assert(rect && region && glyphs?.length, "Actual restored text geometry must be nonempty");
  assert([rect, region, ...glyphs].every(r => ["x", "y", "right", "bottom"].every(k => Number.isFinite(r[k]))));
  assert(rect.width > 0 && rect.height > 0 && region.width > 0 && region.height > 0);
  assert(rect.x >= -1 && rect.y >= -1 && rect.right <= viewport.width + 1
    && rect.bottom <= viewport.height + 1, "Restored panel outside actual viewport");
  assert(Number.isFinite(actual.overflow) && actual.overflow <= 1, "Restored horizontal overflow");
  assert(glyphs.every(r => r.x >= region.x - 2 && r.right <= region.right + 2
    && r.y >= region.y - 2 && r.bottom <= region.bottom + 2),
  "Actual restored glyphs outside their reading region");
  assert(actual.nvl.every(n => Number.isFinite(n.font) && n.font >= 12 && n.rect
    && n.rect.x >= region.x - 2 && n.rect.right <= region.right + 2
    && n.rect.y >= region.y - 2 && n.rect.bottom <= region.bottom + 2),
  "Restored NVL line outside its reading region");
}
module.exports = { assertRestoredNarrativeState };
