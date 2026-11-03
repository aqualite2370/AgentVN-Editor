"use strict";
const assert = require("node:assert/strict");
const { attributeStyleInvalidations } = require("./lib/e2-style-subtree-attribution.cjs");
const node = (id, nodeName, attrs = [], children = []) => ({
  backendNodeId: id, nodeName, attributes: attrs, children,
});
const tree = node(1, "#document", [], [
  node(2, "BODY", [], [
    node(3, "DIV", ["class", "advanced-tab-content is-active", "data-tab", "layout"], [
      node(4, "DIV", ["class", "runtime-layout-inspector"], [
        node(5, "INPUT"),
      ]),
      node(6, "DIV", ["class", "runtime-layout-stage"], [
        node(7, "svg"),
      ]),
    ]),
    node(8, "DIV", ["class", "flow-surface"], [node(9, "BUTTON")]),
  ]),
]);
const event = (id, reason = "Added to layout") => ({
  name: "LayoutInvalidationTracking", args: { data: { nodeId: id, reason } },
});
const result = attributeStyleInvalidations(tree, [
  event(5), event(5), event(7, "SVG changed"), event(9),
  event(99, "Removed from layout"), { name: "irrelevant" },
]);
assert.deepEqual(result.groups, [
  { owner: "layout/inspector", count: 2, uniqueNodes: 1, reasons: { "Added to layout": 2 } },
  { owner: "layout/stage", count: 1, uniqueNodes: 1, reasons: { "SVG changed": 1 } },
  { owner: "workspace/canvas", count: 1, uniqueNodes: 1, reasons: { "Added to layout": 1 } },
]);
assert.equal(result.matchedEvents, 4);
assert.equal(result.unresolvedEvents, 1);
assert.equal(result.totalEvents, 5);
assert.equal(result.nodeCount, 9);
assert.throws(() => attributeStyleInvalidations(null, []), /document/);
assert.throws(() => attributeStyleInvalidations(tree, null), /events/);
const ghost = node(11, "DIV", ["class", "toolbar-popover-morph-ghost"], [
  node(12, "DIV", ["class", "advanced-tab-content", "data-tab", "layout"], [
    node(13, "DIV", ["class", "runtime-layout-inspector"]),
  ]),
]);
assert.equal(attributeStyleInvalidations(ghost, [event(13)]).groups[0].owner, "presentation/ghost");
const background = node(21, "DIV", ["class", "editor-workspace-body"], [
  node(22, "DIV", ["class", "advanced-tab-content", "data-tab", "settings"]),
]);
assert.equal(attributeStyleInvalidations(background, [event(22)]).groups[0].owner, "settings/general");
console.log("PASS: trace backend node ancestry, subtree owners, missing/deleted nodes and ghost isolation");
