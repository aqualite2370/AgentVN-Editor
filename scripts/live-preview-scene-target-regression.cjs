#!/usr/bin/env node
"use strict";

const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import {
    resolveLivePreviewPatchSceneId,
    resolveLivePreviewPatchStart,
  } from "./shared/preview/livePreviewPatch";

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  const latestScript = {
    entry_scene_id: "scene_new",
    scenes: [
      { scene_id: "scene_new", commands: [] },
      { scene_id: "scene_side", commands: [] },
    ],
  };

  assert(
    resolveLivePreviewPatchSceneId(latestScript, "scene_side") === "scene_side",
    "a passive patch must preserve an active scene that still exists",
  );
  assert(
    resolveLivePreviewPatchSceneId(latestScript, "scene_opening") === "scene_new",
    "a passive patch must replace a stale active scene with the latest entry scene",
  );
  assert(
    resolveLivePreviewPatchSceneId(latestScript, undefined) === "scene_new",
    "a passive patch without an active scene must use the latest entry scene",
  );

  const validStart = {
    requestId: "old-request",
    target: { sceneId: "scene_side" },
    entryPath: [],
    mode: "stable_frame",
    playbackRate: 1,
  };
  assert(
    resolveLivePreviewPatchStart(latestScript, validStart, "patch-request") === validStart,
    "runtime patch fallback must preserve a valid requested start",
  );

  const staleStart = {
    requestId: "old-request",
    target: { sceneId: "scene_opening", commandIndex: 4 },
    entryPath: [{ kind: "scene_end", sceneId: "scene_opening", targetSceneId: "scene_new" }],
    mode: "play_target_event",
    playbackRate: 2,
    reducedMotion: true,
  };
  const recovered = resolveLivePreviewPatchStart(latestScript, staleStart, "patch-request");
  assert(recovered !== staleStart, "runtime patch fallback must replace a stale requested start");
  assert(recovered.requestId === "patch-request", "runtime patch fallback must belong to the current patch request");
  assert(recovered.target.sceneId === "scene_new", "runtime patch fallback must target the latest entry scene");
  assert(recovered.target.commandIndex === undefined, "runtime patch fallback must discard stale command positions");
  assert(recovered.entryPath.length === 0, "runtime patch fallback must discard stale entry paths");
  assert(recovered.mode === "stable_frame", "runtime patch fallback must use a stable entry frame");
  assert(recovered.playbackRate === 2, "runtime patch fallback must preserve playback rate");
  assert(recovered.reducedMotion === true, "runtime patch fallback must preserve reduced-motion preference");

  console.log("live preview stale scene target regression OK");
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "live-preview-scene-target-regression.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  logLevel: "silent",
});

new Function("require", "module", "exports", result.outputFiles[0].text)(
  require,
  { exports: {} },
  {},
);
