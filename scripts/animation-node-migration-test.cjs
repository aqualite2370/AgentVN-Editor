#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import {
    analyzeAnimationNodeMigration,
    migrateAllAnimationNodes,
    migrateAnimationNode,
  } from "./editor/src/utils/animationNodeMigration";

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  const scene = (id: string) => ({
    id,
    type: "sceneNode",
    position: { x: 0, y: 0 },
    data: {
      nodeKind: "scene",
      label: id,
      description: "",
      scene: { scene_id: id, title: id, summary: "", commands: [], tags: [], chapter: 1 },
      aiSettings: { authorGoal: "", autoExtractMemory: true, autoApplyMemory: true },
      previewState: { currentCommandIndex: 0, isPlaying: false },
      editorMeta: { collapsedInspectorSections: [] },
    },
  });
  const animation = {
    id: "anim",
    type: "animationNode",
    position: { x: 10, y: 10 },
    data: {
      nodeKind: "animation",
      label: "Flash",
      description: "",
      animation: { type: "animation", animation_id: "flash", target: "screen", params: { duration: 500 }, blocking: true },
      aiSettings: { authorGoal: "", autoExtractMemory: true, autoApplyMemory: true },
      previewState: { currentCommandIndex: 0, isPlaying: false },
      editorMeta: { collapsedInspectorSections: [] },
    },
  };
  const nodes = [scene("before"), animation, scene("after")];
  const edges = [
    { id: "in", source: "before", target: "anim", sourceHandle: "default" },
    { id: "out", source: "anim", target: "after", sourceHandle: "default" },
  ];
  const analysis = analyzeAnimationNodeMigration(nodes, edges, "anim");
  assert(analysis.safePrepend, "a unique isolated successor must allow safe prepend");
  const prepended = migrateAnimationNode(nodes, edges, "anim", "prepend_successor");
  assert(!prepended.nodes.some((node) => node.id === "anim"), "safe migration must remove the container node");
  assert(prepended.nodes.find((node) => node.id === "after")?.data.scene?.commands[0]?.type === "animation", "safe prepend must move the command to the successor scene");
  assert(prepended.edges.some((edge) => edge.source === "before" && edge.target === "after"), "safe prepend must reconnect the graph");

  const fallback = migrateAnimationNode(nodes, [
    ...edges,
    { id: "bypass", source: "before", target: "after", sourceHandle: "alternate" },
  ], "anim", "convert_scene");
  const fallbackNode = fallback.nodes.find((node) => node.id === "anim");
  assert(fallbackNode?.data.nodeKind === "scene", "fallback must preserve the node while converting it to a normal scene");
  assert(fallbackNode?.data.scene?.scene_id === "animation_anim", "fallback must preserve the old synthesized scene id");
  assert(fallback.edges.length === 3, "fallback must preserve every existing connection");

  const bypassEdges = [
    ...edges,
    { id: "bypass", source: "before", target: "after", sourceHandle: "alternate" },
  ];
  const bypassAnalysis = analyzeAnimationNodeMigration(nodes, bypassEdges, "anim");
  assert(bypassAnalysis.canPrepend, "a unique successor must remain an available author-selected landing point");
  assert(!bypassAnalysis.safePrepend, "a bypass route must make automatic prepend unsafe");
  assert(bypassAnalysis.prependAffectedPathCount === 1, "prepend must report how many bypass routes gain the animation");
  const forcedPrepend = migrateAnimationNode(nodes, bypassEdges, "anim", "prepend_successor");
  assert(forcedPrepend.mode === "prepend_successor", "an explicit author choice must allow the affected prepend");
  assert(forcedPrepend.nodes.find((node) => node.id === "after")?.data.scene?.commands[0]?.type === "animation", "the selected successor must receive the animation");

  const branchNodes = [...nodes, scene("alternate")];
  const branchEdges = [
    ...edges,
    { id: "branch", source: "before", target: "alternate", sourceHandle: "alternate" },
  ];
  const branchAnalysis = analyzeAnimationNodeMigration(branchNodes, branchEdges, "anim");
  assert(branchAnalysis.canAppend, "a unique predecessor must remain an available author-selected landing point");
  assert(!branchAnalysis.safeAppend, "another predecessor exit must make automatic append unsafe");
  assert(branchAnalysis.appendAffectedPathCount === 1, "append must report how many other exits gain the animation");
  const forcedAppend = migrateAnimationNode(branchNodes, branchEdges, "anim", "append_predecessor");
  assert(forcedAppend.mode === "append_predecessor", "an explicit author choice must allow the affected append");
  assert(forcedAppend.nodes.find((node) => node.id === "before")?.data.scene?.commands.at(-1)?.type === "animation", "the selected predecessor must receive the animation");

  const isolatedAnimation = {
    ...animation,
    id: "anim_isolated",
    position: { x: 40, y: 40 },
    data: {
      ...animation.data,
      label: "Isolated",
      animation: { ...animation.data.animation, animation_id: "isolated" },
    },
  };
  const batch = migrateAllAnimationNodes([...nodes, isolatedAnimation], edges);
  assert(batch.migratedCount === 2, "batch migration must process every legacy animation node");
  assert(batch.prependCount === 1, "batch migration must use safe successor absorption when available");
  assert(batch.convertedSceneCount === 1, "batch migration must use the lossless scene fallback for complex or isolated nodes");
  assert(!batch.nodes.some((node) => node.data.nodeKind === "animation"), "batch migration must retire every valid legacy animation container");

  console.log("animation node migration test OK");
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "animation-node-migration-test.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  target: "node20",
});

const moduleUnderTest = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(
  require,
  moduleUnderTest,
  moduleUnderTest.exports,
);

const palette = fs.readFileSync(path.join(root, "editor", "src", "components", "editor", "NodePalette.tsx"), "utf8");
if (palette.includes('{ kind: "animation"')) {
  throw new Error("new animation nodes must be absent from the node palette");
}
const inspector = fs.readFileSync(path.join(root, "editor", "src", "components", "editor", "InspectorPanel.tsx"), "utf8");
for (const marker of ["批量转换全部", "writeProjectBackup", "legacy_animation_batch_migration", "整次操作只占用一个撤销记录"]) {
  if (!inspector.includes(marker)) throw new Error(`batch migration UI is missing ${marker}`);
}
if (inspector.indexOf("await writeProjectBackup") > inspector.indexOf("const result = migrateAllAnimationNodes")) {
  throw new Error("batch migration must create the timeline snapshot before changing the graph");
}
const store = fs.readFileSync(path.join(root, "editor", "src", "store", "editorStore.ts"), "utf8");
if (!store.includes("migrateAllAnimationNodes: () =>") || !store.includes("migrateAllAnimationNodesGraph(state.nodes, state.edges)")) {
  throw new Error("editor store must expose a single batch migration action");
}
