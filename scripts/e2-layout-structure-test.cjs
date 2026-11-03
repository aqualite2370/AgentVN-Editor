"use strict";
const assert = require("node:assert/strict");
const { compareLayoutStructure } = require("./lib/e2-layout-structure.cjs");
const snapshot = () => ({
  content: { nodeId: 1, parentId: 10, styles: { display: "block", position: "absolute" } },
  scroll: { nodeId: 2, parentId: 1, styles: { display: "grid", position: "static" } },
});
assert.deepEqual(compareLayoutStructure(snapshot(), snapshot()), {
  replaced: [], reparented: [], styleChanges: [],
});
const after = snapshot();
after.content.styles.display = "grid";
after.content.styles.position = "relative";
after.scroll.nodeId = 3;
after.scroll.parentId = 4;
const result = compareLayoutStructure(snapshot(), after);
assert.deepEqual(result.replaced, ["scroll"]);
assert.deepEqual(result.reparented, ["scroll"]);
assert.deepEqual(result.styleChanges, [
  { region: "content", property: "display", before: "block", after: "grid" },
  { region: "content", property: "position", before: "absolute", after: "relative" },
]);
assert.throws(() => compareLayoutStructure({}, {}), /nonempty/);
assert.throws(() => compareLayoutStructure(snapshot(), { content: after.content }), /same regions/);
console.log("PASS: nonempty DOM identity, parent ownership and computed layout differences");
