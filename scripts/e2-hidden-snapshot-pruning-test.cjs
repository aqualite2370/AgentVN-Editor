"use strict";
const assert = require("node:assert/strict");
const { pruneHiddenSnapshotLayers } = require("./lib/e2-warm-descendant-style.cjs");

function node(name, children = [], tab = null) {
  const result = {
    name, children, dataset: { tab }, parentNode: null,
    get nextSibling() {
      if (!this.parentNode) return null;
      return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] ?? null;
    },
    querySelectorAll() {
      return this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
    },
    remove() {
      if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    },
  };
  for (const child of children) child.parentNode = result;
  return result;
}
for (const strategy of ["root", "shell"]) {
  const content = node("designer", [node("button"), node("canvas")]);
  const scroll = node("scroll", [content]);
  const hidden = node("hidden", [scroll], "layout");
  const visible = node("active", [node("visible-control")], "settings");
  const ghost = node("ghost", [visible, hidden]);
  ghost.querySelectorAll = selector => {
    assert.equal(selector, ".advanced-tab-content[aria-hidden='true']");
    return [hidden];
  };
  const result = pruneHiddenSnapshotLayers(ghost, strategy);
  assert.equal(result.layers.length, 1);
  assert.equal(result.layers[0].tab, "layout");
  assert.equal(result.layers[0].descendants, 4);
  assert.equal(visible.children.length, 1, "active snapshot must stay untouched");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].parent, strategy === "root" ? ghost : hidden);
  assert.equal(result.layers[0].removedNodeCount, strategy === "root" ? 5 : 4);
  assert.equal(ghost.children.includes(hidden), strategy === "shell");
  assert.equal(hidden.children.length, strategy === "root" ? 1 : 0);
}
assert.throws(() => pruneHiddenSnapshotLayers({}, "unknown"), /strategy/);
{
  const header = node("header", [node("button")]);
  const sidebar = node("sidebar", [node("choice")]);
  const center = node("center", [node("stage", [node("preview")])]);
  const inspector = node("inspector", [node("input")]);
  const grid = node("grid", [sidebar, center, inspector]);
  const designer = node("designer", [header, grid, node("status")]);
  const hidden = node("hidden", [node("scroll", [designer])], "layout");
  const ghost = node("ghost", [hidden, node("visible")]);
  ghost.querySelectorAll = () => [hidden];
  const all = hidden.querySelectorAll.bind(hidden);
  hidden.querySelectorAll = selector => selector === "*"
    ? all(selector) : [header, sidebar, center, inspector];
  const result = pruneHiddenSnapshotLayers(ghost, "columns");
  assert.equal(result.records.length, 4);
  assert.equal(result.layers[0].removedNodeCount, 9);
  assert.equal(grid.children.length, 0, "snapshot retains grid boundary without invisible content");
  assert(ghost.children.includes(hidden));
  assert.equal(designer.children.length, 2, "retains designer and status with original attributes");
}
{
  const header = node("header", [node("button")]);
  const sidebar = node("sidebar", [node("choice")]);
  const center = node("center", [node("stage", [node("preview")])]);
  const inspector = node("inspector", [node("input")]);
  const grid = node("grid", [sidebar, center, inspector]);
  const designer = node("designer", [header, grid, node("status")]);
  const hidden = node("hidden", [node("scroll", [designer])], "layout");
  const ghost = node("ghost", [hidden, node("visible")]);
  ghost.querySelectorAll = () => [hidden];
  const all = hidden.querySelectorAll.bind(hidden);
  hidden.querySelectorAll = selector => selector === "*" ? all(selector) : [header, sidebar, center];
  const result = pruneHiddenSnapshotLayers(ghost, "keep-inspector");
  assert.equal(result.records.length, 3);
  assert.equal(result.layers[0].removedNodeCount, 7);
  assert.deepEqual(grid.children, [inspector], "keeps original inspector boundary and subtree");
  assert.equal(inspector.children.length, 1);
}
console.log("PASS hidden snapshot root/shell selection, active preservation and exact removal records");
