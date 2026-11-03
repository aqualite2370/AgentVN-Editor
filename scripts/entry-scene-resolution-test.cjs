#!/usr/bin/env node
"use strict";

const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const build = esbuild.buildSync({
  stdin: {
    contents: `
      import { exportScript, resolveEntrySceneId } from "./editor/src/utils/exportScript";
      import { validateStartConnections } from "./editor/src/utils/validation";
      import { sanitizeImportedEdges } from "./editor/src/store/editorStore";

      const common = {
        position: { x: 0, y: 0 },
        data: {
          label: "",
          description: "",
          memoryMode: "hybrid",
          aiSettings: { authorGoal: "", generationOutline: "", autoExtractMemory: true, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: { collapsedInspectorSections: [], source: "manual" },
        },
      };
      const nodes = [
        { ...common, id: "start", data: { ...common.data, nodeKind: "start" } },
        {
          ...common,
          id: "chapter-1",
          data: {
            ...common.data,
            nodeKind: "scene",
            scene: { scene_id: "chapter_1", title: "Chapter 1", summary: "", chapter: 1, tags: [], commands: [{ type: "narration", text: "one" }] },
          },
        },
        {
          ...common,
          id: "chapter-2",
          data: {
            ...common.data,
            nodeKind: "scene",
            scene: { scene_id: "chapter_2", title: "Chapter 2", summary: "", chapter: 2, tags: [], commands: [{ type: "narration", text: "two" }] },
          },
        },
      ] as any;
      const entry = { id: "entry", source: "start", target: "chapter-1", sourceHandle: "default" };
      const next = { id: "next", source: "chapter-1", target: "chapter-2", sourceHandle: "default" };

      if (resolveEntrySceneId(nodes, [entry, next] as any) !== "chapter_1") throw new Error("single entry did not resolve to chapter 1");
      if (resolveEntrySceneId(nodes, [next, entry] as any) !== "chapter_1") throw new Error("edge order changed the entry scene");
      if (exportScript(nodes, [entry, next] as any).entry_scene_id !== "chapter_1") throw new Error("exported entry scene drifted");
      if (resolveEntrySceneId(nodes, [next] as any) !== "") throw new Error("missing entry edge must fail closed");

      const duplicated = [
        entry,
        { ...entry, id: "entry-copy" },
        next,
      ] as any;
      if (validateStartConnections(nodes, duplicated).length !== 0) {
        throw new Error("an exact duplicate entry edge must not become an ambiguity error");
      }
      const sanitized = sanitizeImportedEdges(duplicated, nodes);
      if (sanitized.filter((edge) => edge.source === "start").length !== 1) {
        throw new Error("project import must remove exact duplicate entry edges");
      }

      const ambiguous = [
        entry,
        { id: "entry-2", source: "start", target: "chapter-2", sourceHandle: "default" },
        next,
      ] as any;
      if (resolveEntrySceneId(nodes, ambiguous) !== "") throw new Error("ambiguous entry edges must fail closed");
      const issues = validateStartConnections(nodes, ambiguous);
      if (!issues.some((issue) => issue.code === "start_connection" && issue.severity === "error")) {
        throw new Error("ambiguous entry edges must be a blocking validation error");
      }
    `,
    resolveDir: root,
    sourcefile: "entry-scene-resolution-regression.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  target: "node20",
});

const moduleRef = { exports: {} };
new Function("require", "module", "exports", build.outputFiles[0].text)(
  require,
  moduleRef,
  moduleRef.exports,
);

console.log("entry scene resolution test OK");
