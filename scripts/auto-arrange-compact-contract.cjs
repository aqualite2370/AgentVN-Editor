#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("../editor/node_modules/typescript");

const root = path.resolve(__dirname, "..");

function loadAutoArrangeModule() {
  const sourcePath = path.join(root, "editor/src/utils/autoArrangeGraph.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const sandbox = { exports: {}, require };
  vm.runInNewContext(output, sandbox, { filename: sourcePath });
  return sandbox.exports;
}

function node(id, kind = "scene", position = { x: 0, y: 0 }, measured = { width: 300, height: 180 }, extraData = {}) {
  return {
    id,
    type: `${kind}Node`,
    position,
    measured,
    data: {
      nodeKind: kind,
      label: id,
      description: id,
      aiSettings: { authorGoal: "", autoExtractMemory: false, autoApplyMemory: false },
      previewState: { currentCommandIndex: 0, isPlaying: false },
      editorMeta: { collapsedInspectorSections: [] },
      ...extraData,
    },
  };
}

function edge(id, source, target, sourceHandle = "default") {
  return { id, source, target, sourceHandle };
}

function layoutWidth(positions) {
  const xs = Object.values(positions).map((position) => position.x);
  return Math.max(...xs) - Math.min(...xs);
}

function assertNoSameDepthOverlap(nodes, positions, minimumGap = 100) {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const rows = new Map();
  for (const [id, position] of Object.entries(positions)) {
    const row = rows.get(position.y) ?? [];
    row.push({ id, x: position.x, width: byId.get(id)?.measured?.width ?? 300 });
    rows.set(position.y, row);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let index = 1; index < row.length; index += 1) {
      const previous = row[index - 1];
      const current = row[index];
      assert.ok(
        current.x - (previous.x + previous.width) >= minimumGap,
        `nodes ${previous.id} and ${current.id} should keep a readable horizontal gap`,
      );
    }
  }
}

const { computeAutoArrangeLayout } = loadAutoArrangeModule();

const choiceChoices = ["left", "middle", "right", "extra"].map((choice_id) => ({
  choice_id,
  text: choice_id,
  target_scene_id: "",
  conditions: [],
}));

const nodes = [
  node("start", "start", { x: 2000, y: 0 }, { width: 300, height: 150 }),
  node("choice", "choice", { x: 2000, y: 300 }, { width: 300, height: 190 }, { choice: { type: "choice", choices: choiceChoices } }),
  node("left"), node("middle"), node("right"), node("extra"),
  node("left_next"), node("middle_next"), node("right_next"), node("extra_next"),
  node("loop", "loop", { x: 3200, y: 900 }, { width: 300, height: 190 }),
  node("loop_body"), node("loop_exit"),
  node("isolated_start", "scene", { x: 5200, y: 0 }, { width: 300, height: 180 }),
  node("isolated_end", "scene", { x: 5600, y: 260 }, { width: 300, height: 180 }),
];

const edges = [
  edge("start-choice", "start", "choice"),
  edge("choice-left", "choice", "left", "left"),
  edge("choice-middle", "choice", "middle", "middle"),
  edge("choice-right", "choice", "right", "right"),
  edge("choice-extra", "choice", "extra", "extra"),
  edge("left-next", "left", "left_next"),
  edge("middle-next", "middle", "middle_next"),
  edge("right-next", "right", "right_next"),
  edge("extra-next", "extra", "extra_next"),
  edge("right-loop", "right_next", "loop"),
  edge("loop-body", "loop", "loop_body", "loop"),
  edge("loop-exit", "loop", "loop_exit", "exit"),
  edge("isolated", "isolated_start", "isolated_end"),
];

const originalNodeOrder = nodes.map((item) => item.id);
const layout = computeAutoArrangeLayout(nodes, edges, { scope: "all" });
assert.deepEqual(
  nodes.map((item) => item.id),
  originalNodeOrder,
  "auto arrange layout computation must not reorder the caller's node array",
);
assert.equal(layout.arrangedNodeIds.length, nodes.length, "all nodes should be arranged");
assert.ok(layout.movedCount > 0, "layout should move the sample nodes");
assertNoSameDepthOverlap(nodes, layout.positions);

assert.ok(
  layout.positions.choice.y - layout.positions.start.y >= 300,
  `auto arrange should keep a more relaxed vertical rhythm; got ${layout.positions.choice.y - layout.positions.start.y}`,
);
assert.ok(
  layout.positions.middle.x - layout.positions.left.x >= 400,
  `choice branches should keep a more relaxed horizontal rhythm; got ${layout.positions.middle.x - layout.positions.left.x}`,
);

const compactWidth = layoutWidth(layout.positions);
assert.ok(compactWidth <= 3500, `relaxed compact arrangement should stay within a manageable width; got ${compactWidth}`);

const branchOrder = ["left", "middle", "right", "extra"].map((id) => [id, layout.positions[id].x]);
assert.deepEqual(
  [...branchOrder].sort((a, b) => a[1] - b[1]).map(([id]) => id),
  ["left", "middle", "right", "extra"],
  "choice branch order should remain stable from left to right",
);

const source = fs.readFileSync(path.join(root, "editor/src/components/editor/EditorToolbar.tsx"), "utf8");
assert.match(source, /node\.data\.nodeKind === "start"/, "auto arrange viewport should prefer the start node");
assert.match(source, /result\.arrangedNodeIds\[0\]/, "auto arrange viewport should fall back to first arranged node");
assert.doesNotMatch(
  source,
  /nodes:\s*result\.arrangedNodeIds\.map\(\(id\)\s*=>\s*\(\{\s*id\s*\}\)\)/,
  "auto arrange viewport should no longer fit all arranged nodes after arranging",
);

console.log("Auto arrange compact layout contract: passed");
