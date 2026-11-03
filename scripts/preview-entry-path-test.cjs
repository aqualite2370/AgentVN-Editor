#!/usr/bin/env node
"use strict";

const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import { findPreviewEntryPaths } from "./editor/src/utils/previewEntryPaths";

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  const base = {
    aiSettings: { authorGoal: "", autoExtractMemory: true, autoApplyMemory: true },
    previewState: { currentCommandIndex: 0, isPlaying: false },
    editorMeta: { collapsedInspectorSections: [] },
  };
  const nodes = [
    { id: "start", type: "startNode", position: { x: 0, y: 0 }, data: { ...base, nodeKind: "start", label: "入口", description: "" } },
    {
      id: "branch",
      type: "sceneNode",
      position: { x: 0, y: 0 },
      data: {
        ...base,
        nodeKind: "scene",
        label: "分支",
        description: "",
        scene: {
          scene_id: "branch_scene",
          title: "分支",
          summary: "",
          chapter: 1,
          tags: [],
          commands: [{
            type: "choice",
            choices: [
              { choice_id: "left", text: "左", target_scene_id: "left_scene", conditions: [] },
              { choice_id: "right", text: "右", target_scene_id: "right_scene", conditions: [] },
            ],
          }],
        },
      },
    },
    {
      id: "left",
      type: "sceneNode",
      position: { x: 0, y: 0 },
      data: { ...base, nodeKind: "scene", label: "左路", description: "", scene: { scene_id: "left_scene", title: "左路", summary: "", chapter: 1, tags: [], commands: [] } },
    },
    {
      id: "right",
      type: "sceneNode",
      position: { x: 0, y: 0 },
      data: { ...base, nodeKind: "scene", label: "右路", description: "", scene: { scene_id: "right_scene", title: "右路", summary: "", chapter: 1, tags: [], commands: [] } },
    },
    {
      id: "target",
      type: "sceneNode",
      position: { x: 0, y: 0 },
      data: { ...base, nodeKind: "scene", label: "目标", description: "", scene: { scene_id: "target_scene", title: "目标", summary: "", chapter: 1, tags: [], commands: [] } },
    },
    {
      id: "isolated",
      type: "sceneNode",
      position: { x: 0, y: 0 },
      data: { ...base, nodeKind: "scene", label: "孤立场景", description: "", scene: { scene_id: "isolated_scene", title: "孤立场景", summary: "", chapter: 1, tags: [], commands: [] } },
    },
  ];
  const edges = [
    { id: "entry", source: "start", target: "branch", sourceHandle: "default" },
    { id: "left", source: "branch", target: "left", sourceHandle: "left" },
    { id: "right", source: "branch", target: "right", sourceHandle: "right" },
    { id: "left-target", source: "left", target: "target", sourceHandle: "default" },
    { id: "right-target", source: "right", target: "target", sourceHandle: "default" },
  ];
  const paths = findPreviewEntryPaths(nodes, edges, "target");
  assert(paths.length === 2, "multi-entry scenes must expose every concrete route");
  assert(paths.every((path) => path.steps[0]?.kind === "choice"), "routes must record the concrete choice exit");
  assert(new Set(paths.map((path) => path.steps[0].choiceId)).size === 2, "routes must preserve distinct choice ids");

  const entryPaths = findPreviewEntryPaths(nodes, edges, "branch");
  assert(entryPaths.length === 1, "entry scene must expose one concrete route");
  assert(entryPaths[0].steps.length === 0, "entry scene route must start from an empty inherited path");

  const singlePaths = findPreviewEntryPaths(nodes, edges, "left");
  assert(singlePaths.length === 1, "single-predecessor scene must reload without route selection");
  assert(singlePaths[0].steps[0]?.kind === "choice" && singlePaths[0].steps[0].choiceId === "left", "single route must preserve its concrete predecessor exit");

  const isolatedPaths = findPreviewEntryPaths(nodes, edges, "isolated");
  assert(isolatedPaths.length === 0, "unreachable scene must not invent a predecessor route");
  console.log("preview entry path test OK");
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "preview-entry-path-test.ts",
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
