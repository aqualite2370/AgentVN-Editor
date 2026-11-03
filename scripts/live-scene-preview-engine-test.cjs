#!/usr/bin/env node
"use strict";

const path = require("node:path");
const esbuild = require("../GameCli_framework/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import { StoryEngine } from "./GameCli_framework/src/engine/StoryEngine";
  import type { PreviewStartSpec } from "./shared/preview/livePreviewProtocol";

  globalThis.window = globalThis;

  const script = {
    schema_version: "1.0.0",
    game_id: "live_preview_test",
    title: "Live Preview Test",
    entry_scene_id: "scene_path",
    scenes: [
      {
        scene_id: "scene_a",
        title: "Scene A",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [
          { type: "background", background_id: "bg_a", background_fit: "cover" },
          { type: "sprite", character_id: "alice", sprite_id: "alice_default", position: "left", visible: true },
          { type: "wait", duration_ms: 5000 },
          { type: "bgm", bgm_id: "music_a", action: "play" },
          { type: "sfx", sfx_id: "bell" },
          { type: "dialog", character_id: "alice", text: "First stable line." }
        ]
      },
      {
        scene_id: "scene_b",
        title: "Scene B",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [
          { type: "state_update", key: "ready", operation: "set", value: true },
          {
            type: "choice",
            choices: [{ choice_id: "continue", text: "Continue", target_scene_id: "scene_a", conditions: [] }]
          }
        ]
      },
      {
        scene_id: "scene_path",
        title: "Path",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [
          { type: "background", background_id: "bg_path", background_fit: "cover" },
          { type: "state_update", key: "route_ready", operation: "set", value: true },
          {
            type: "camera",
            blocking: true,
            motion: {
              schema_version: 1,
              kind: "reframe",
              to: { center_x: 0.55, center_y: 0.5, zoom: 1.4 },
              duration_ms: 600,
              easing: "linear"
            }
          },
          {
            type: "choice",
            choices: [{ choice_id: "to_target", text: "Target", target_scene_id: "scene_target", conditions: [] }]
          }
        ]
      },
      {
        scene_id: "scene_target",
        title: "Target",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [
          {
            type: "background",
            background_id: "bg_target",
            background_fit: "cover",
            transition_config: { kind: "crossfade", duration_ms: 840, easing: "ease-in-out" }
          },
          { type: "sprite", character_id: "alice", sprite_id: "alice_close", position: "center", visible: true },
          {
            type: "camera",
            blocking: true,
            motion: {
              schema_version: 1,
              kind: "reframe",
              to: { center_x: 0.6, center_y: 0.45, zoom: 2 },
              duration_ms: 1000,
              easing: "linear"
            }
          },
          { type: "narration", text: "Target line." }
        ]
      }
    ]
  };

  const manifest = {
    manifest_version: "1.0.0",
    game_id: "live_preview_test",
    title: "Live Preview Test",
    author: "AgentVN",
    version: "0.1.0",
    description: "",
    entry_script: "script.json",
    assets: [],
    runtime_version: "0.1.0",
    tags: [],
    language: "zh-CN"
  };

  const engine = new StoryEngine();
  engine.loadScript(script, manifest);
  engine.previewScene("scene_a", { stopAt: "first_stable_frame", suppressTransientEffects: true });

  if (engine.state.currentSceneId !== "scene_a") throw new Error("preview did not stay on requested scene");
  if (engine.state.currentCommandIndex !== 5) throw new Error("preview did not stop at first dialog");
  if (engine.state.background !== "bg_a") throw new Error("preview did not apply background");
  if (engine.state.sprites.alice?.sprite_id !== "alice_default") throw new Error("preview did not apply sprite");
  if (engine.state.dialog?.text !== "First stable line.") throw new Error("preview did not expose stable dialog");
  if (engine.state.isTyping) throw new Error("stable preview must not keep typewriter active");
  if (!engine.state.isPreviewFrame) throw new Error("stable preview must expose preview-frame state");
  if (engine.state.bgmState || engine.state.sfxEvent || engine.state.animationEffects.length) {
    throw new Error("stable preview retained transient audio or animation state");
  }

  engine.previewScene("scene_b", { stopAt: "first_stable_frame", suppressTransientEffects: true });
  if (engine.state.currentSceneId !== "scene_b") throw new Error("rapid scene switch selected stale scene");
  if (engine.state.currentCommandIndex !== 1) throw new Error("preview did not stop at first choice");
  if (!engine.state.isWaitingChoice || engine.state.choices.length !== 1) throw new Error("choice state was not rendered");
  if (engine.state.variables.ready !== true) throw new Error("state updates before stable frame were not applied");

  const targetSpec: PreviewStartSpec = {
    requestId: "request-camera",
    target: { sceneId: "scene_target", commandIndex: 2 },
    entryPath: [{
      kind: "choice",
      sceneId: "scene_path",
      commandIndex: 3,
      choiceId: "to_target",
      targetSceneId: "scene_target"
    }],
    mode: "play_target_event",
    playbackRate: 1,
    reducedMotion: false
  };
  engine.previewStart(targetSpec);
  if (engine.state.currentSceneId !== "scene_target" || engine.state.currentCommandIndex !== 2) {
    throw new Error("target-event preview did not stop on the requested command");
  }
  if (engine.state.background !== "bg_target" || engine.state.variables.route_ready !== true) {
    throw new Error("entry-path reduction did not preserve stable inherited state");
  }
  if (engine.state.sprites.alice?.sprite_id !== "alice_close") {
    throw new Error("target-scene prefix did not apply visible sprites");
  }
  if (engine.state.history.length !== 0) throw new Error("entry-path reduction must suppress history");
  if (!engine.state.camera.pose_motion || engine.state.camera.pose_motion.from.zoom !== 1.4) {
    throw new Error("target camera event did not inherit the completed entry-path pose");
  }

  engine.previewStart({
    ...targetSpec,
    requestId: "request-camera-without-entry-path",
    entryPath: [],
  });
  if (
    engine.state.currentSceneId !== "scene_target"
    || !engine.state.camera.pose_motion
    || engine.state.camera.pose_motion.from.zoom !== 1
  ) {
    throw new Error("an isolated scene must replay its camera event from a clean scene state");
  }

  const reloadSpec: PreviewStartSpec = {
    requestId: "request-scene-reload",
    target: { sceneId: "scene_target", commandIndex: 0 },
    entryPath: targetSpec.entryPath,
    mode: "play_target_event",
    playbackRate: 1,
    reducedMotion: false
  };
  engine.previewStart(reloadSpec);
  if (engine.state.currentSceneId !== "scene_target" || engine.state.background !== "bg_target") {
    throw new Error("scene reload did not enter the requested target from its predecessor state");
  }
  if (engine.state.variables.route_ready !== true) {
    throw new Error("scene reload did not restore the predecessor path state");
  }
  if (
    engine.state.backgroundTransition?.kind !== "crossfade"
    || engine.state.backgroundTransition.duration_ms !== 840
  ) {
    throw new Error("scene reload suppressed the authored entry background transition");
  }
  engine.previewStart(targetSpec);
  engine.controlPreview("pause");
  if (!engine.cameraClock.paused) throw new Error("preview pause control did not freeze the camera clock");
  engine.controlPreview("resume");
  if (engine.cameraClock.paused) throw new Error("preview resume control did not release the camera clock");
  engine.controlPreview("set_playback_rate", 2);
  if (engine.cameraClock.playbackRate !== 2) throw new Error("preview speed control did not update logical time");
  engine.controlPreview("finish");
  if (engine.cameraFrame().pose.zoom !== 2 || engine.state.camera.blocking_gate?.phase !== "awaiting_advance") {
    throw new Error("preview finish control did not settle the target camera event");
  }
  engine.controlPreview("replay");
  if (!engine.state.camera.pose_motion || engine.state.camera.blocking_gate?.phase !== "running") {
    throw new Error("preview replay control did not restart the target event");
  }
  engine.previewStart({ ...targetSpec, requestId: "request-camera-reduced", reducedMotion: true });
  if (!engine.state.camera.pose_motion || engine.state.camera.pose_motion.duration_ms !== 120) {
    throw new Error("reduced-motion preview override did not shorten the real runtime event");
  }
  engine.previewStart({ ...targetSpec, requestId: "request-camera-normal", reducedMotion: false });
  if (!engine.state.camera.pose_motion || engine.state.camera.pose_motion.duration_ms !== 1000) {
    throw new Error("normal preview override did not preserve the authored runtime duration");
  }

  console.log("live scene preview engine test OK");
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "live-scene-preview-engine-test.ts",
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
