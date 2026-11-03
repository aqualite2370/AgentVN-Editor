#!/usr/bin/env node
"use strict";

const path = require("node:path");
const esbuild = require("../GameCli_framework/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import {
    DEFAULT_CAMERA_POSE,
    cameraEasingControlPoints,
    createDefaultCameraCommand,
    createInitialCameraState,
    finishCameraLane,
    isStructuredCameraCommand,
    sampleCamera,
    startCameraEvent,
    validateCameraCommand,
    validateStructuredCameraCommand,
  } from "./shared/camera/cameraMotion";
  import {
    minimumRuntimeVersionForScript,
    runtimeScriptSchemaVersion,
  } from "./shared/cartridge/runtimeCapabilities";
  import { RuntimeClock } from "./GameCli_framework/src/engine/runtimeClock";
  import { StoryEngine } from "./GameCli_framework/src/engine/StoryEngine";

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  const command = createDefaultCameraCommand("reframe", DEFAULT_CAMERA_POSE);
  assert(isStructuredCameraCommand(command), "default camera command must use motion format");
  assert(command.motion.kind === "reframe", "default command must preserve requested kind");
  assert(command.motion.duration_ms === 1400, "reframe default duration must be explicit");
  assert(command.blocking === true, "reframe must default to blocking");
  assert(validateStructuredCameraCommand(command).length === 0, "default command must validate");

  const unsafe = {
    ...command,
    motion: {
      ...command.motion,
      to: { center_x: 0.2, center_y: 0.5, zoom: 1 },
    },
  };
  assert(
    validateStructuredCameraCommand(unsafe).some((issue) => issue.code === "camera_unsafe_overscan"),
    "unsafe composition must require an explicit author opt-in",
  );

  const optedIn = {
    ...unsafe,
    motion: { ...unsafe.motion, unsafe_overscan: true },
  };
  assert(validateStructuredCameraCommand(optedIn).length === 0, "explicit unsafe composition must stay legal");
  const validBezier = cameraEasingControlPoints("cubic-bezier(0.15, -1, 0.9, 2)");
  assert(
    validBezier?.[0] === 0.15 && validBezier?.[1] === -1 && validBezier?.[2] === 0.9 && validBezier?.[3] === 2,
    "custom camera easing must expose all four validated control points",
  );
  assert(
    cameraEasingControlPoints("cubic-bezier(-0.01, 0, 0.5, 1)") === undefined
      && cameraEasingControlPoints("cubic-bezier(0.5, -1.01, 0.5, 1)") === undefined
      && cameraEasingControlPoints("cubic-bezier(0.5, 0, 1.01, 1)") === undefined
      && cameraEasingControlPoints("cubic-bezier(0.5, 0, 0.5, 2.01)") === undefined,
    "custom camera easing must reject control points outside the authored safety ranges",
  );
  assert(
    validateStructuredCameraCommand({ ...command, unexpected: true }).some((issue) => issue.code === "camera_unknown_field"),
    "structured camera commands must reject unknown top-level fields",
  );
  assert(
    validateStructuredCameraCommand({
      ...createDefaultCameraCommand("reset"),
      motion: { ...createDefaultCameraCommand("reset").motion, intensity: 0.5 },
    }).some((issue) => issue.code === "camera_unknown_field"),
    "camera motion kinds must reject fields that belong to another kind",
  );
  assert(
    validateCameraCommand({ type: "camera", action: "", blocking: true }).some(
      (issue) => issue.code === "camera_legacy_action" || issue.code === "camera_legacy_params",
    ),
    "formal validation must reject incomplete legacy camera commands",
  );

  const firstMove = {
    type: "camera",
    blocking: false,
    motion: {
      schema_version: 1,
      kind: "reframe",
      to: { center_x: 0.6, center_y: 0.4, zoom: 2 },
      duration_ms: 1000,
      easing: "linear",
    },
  } as const;
  const firstState = startCameraEvent(
    createInitialCameraState(),
    firstMove,
    { scene_id: "scene_a", command_index: 2, command_fingerprint: "first" },
    0,
  );
  const halfway = sampleCamera(firstState, 500);
  assert(Math.abs(halfway.pose.center_x - 0.55) < 0.0001, "linear reframe must sample its midpoint");
  assert(Math.abs(halfway.pose.center_y - 0.45) < 0.0001, "linear reframe must interpolate both axes");
  assert(Math.abs(halfway.pose.zoom - 1.5) < 0.0001, "linear reframe must interpolate zoom");

  const sequenceMove = {
    type: "camera",
    blocking: true,
    motion: {
      schema_version: 1,
      kind: "sequence",
      shots: [
        {
          to: { center_x: 0.6, center_y: 0.4, zoom: 2 },
          duration_ms: 1000,
          easing: "linear",
        },
        {
          to: { center_x: 0.4, center_y: 0.6, zoom: 1.5 },
          duration_ms: 2000,
          easing: "linear",
        },
      ],
    },
  } as const;
  assert(validateStructuredCameraCommand(sequenceMove).length === 0, "valid camera sequence must pass strict validation");
  assert(
    validateStructuredCameraCommand({ ...sequenceMove, blocking: false }).some(
      (issue) => issue.code === "camera_sequence_blocking",
    ),
    "camera sequence must reject non-blocking playback",
  );
  assert(
    validateStructuredCameraCommand({
      ...sequenceMove,
      motion: { ...sequenceMove.motion, shots: [sequenceMove.motion.shots[0]] },
    }).some((issue) => issue.code === "camera_sequence_shots"),
    "camera sequence must require two to four shots",
  );
  const sequenceState = startCameraEvent(
    createInitialCameraState(),
    sequenceMove,
    { scene_id: "scene_a", command_index: 5, command_fingerprint: "sequence" },
    0,
  );
  assert(sequenceState.pose_motion?.duration_ms === 3000, "sequence runtime duration must sum all segments");
  const firstSequenceMidpoint = sampleCamera(sequenceState, 500).pose;
  assert(
    Math.abs(firstSequenceMidpoint.center_x - 0.55) < 0.0001
      && Math.abs(firstSequenceMidpoint.zoom - 1.5) < 0.0001,
    "sequence must interpolate the first segment from the inherited pose",
  );
  const secondSequenceQuarter = sampleCamera(sequenceState, 1500).pose;
  assert(
    Math.abs(secondSequenceQuarter.center_x - 0.55) < 0.0001
      && Math.abs(secondSequenceQuarter.center_y - 0.45) < 0.0001
      && Math.abs(secondSequenceQuarter.zoom - 1.875) < 0.0001,
    "sequence must select and interpolate the correct later segment",
  );
  const finishedSequence = finishCameraLane(sequenceState, "pose", 1500);
  assert(
    finishedSequence.persistent_pose.center_x === 0.4
      && finishedSequence.persistent_pose.center_y === 0.6
      && finishedSequence.persistent_pose.zoom === 1.5,
    "finishing or skipping a sequence must land on its final shot",
  );
  const instantSequence = {
    ...sequenceMove,
    motion: {
      ...sequenceMove.motion,
      shots: sequenceMove.motion.shots.map((shot) => ({ ...shot, duration_ms: 0 })),
    },
  };
  const instantState = startCameraEvent(
    createInitialCameraState(),
    instantSequence,
    { scene_id: "scene_a", command_index: 6, command_fingerprint: "instant-sequence" },
    0,
  );
  assert(!instantState.pose_motion, "an all-zero sequence must finish immediately");
  assert(instantState.persistent_pose.zoom === 1.5, "an all-zero sequence must persist the final shot");
  const reducedSequence = startCameraEvent(
    createInitialCameraState(),
    sequenceMove,
    { scene_id: "scene_a", command_index: 7, command_fingerprint: "reduced-sequence" },
    0,
    { reduced_motion: true },
  );
  assert(reducedSequence.pose_motion?.duration_ms === 120, "reduced sequence must cap the whole path at 120ms");
  assert(
    reducedSequence.pose_motion?.sequence_shots?.[0].duration_ms === 40
      && reducedSequence.pose_motion?.sequence_shots?.[1].duration_ms === 80,
    "reduced sequence must preserve relative segment timing",
  );

  const reducedAuthoredEasing = "cubic-bezier(0.2, -0.5, 0.8, 1.5)" as const;
  const reducedState = startCameraEvent(
    createInitialCameraState(),
    {
      ...firstMove,
      motion: {
        ...firstMove.motion,
        duration_ms: 900,
        easing: reducedAuthoredEasing,
      },
    },
    { scene_id: "scene_a", command_index: 20, command_fingerprint: "reduced" },
    0,
    { reduced_motion: true },
  );
  assert(reducedState.pose_motion?.duration_ms === 120, "reduced motion must cap pose duration at 120ms");
  assert(
    reducedState.pose_motion?.easing === reducedAuthoredEasing,
    "reduced motion must preserve the author's easing curve",
  );

  const takeover = startCameraEvent(
    firstState,
    {
      ...firstMove,
      motion: {
        ...firstMove.motion,
        to: { center_x: 0.5, center_y: 0.5, zoom: 1.2 },
      },
    },
    { scene_id: "scene_a", command_index: 3, command_fingerprint: "second" },
    500,
  );
  assert(
    Math.abs(takeover.pose_motion.from.center_x - halfway.pose.center_x) < 0.0001,
    "a new reframe must take over from the currently visible pose",
  );

  const withImpact = startCameraEvent(
    takeover,
    {
      type: "camera",
      blocking: false,
      motion: {
        schema_version: 1,
        kind: "impact",
        direction: "from_left",
        intensity: 1,
        duration_ms: 380,
      },
    },
    { scene_id: "scene_a", command_index: 4, command_fingerprint: "impact" },
    500,
  );
  assert(Boolean(withImpact.pose_motion && withImpact.impulse_motion), "pose and impulse lanes must run together");
  assert(sampleCamera(withImpact, 500).impulse.offset_x === 0, "new impulse takeover must restart from zero");
  assert(sampleCamera(withImpact, 880).impulse.offset_x === 0, "finished impulse must return to zero");

  const legacyScript = {
    schema_version: "1.1.0",
    game_id: "legacy",
    title: "Legacy",
    entry_scene_id: "scene",
    scenes: [{
      scene_id: "scene",
      title: "Scene",
      summary: "",
      chapter: 1,
      tags: [],
      commands: [{ type: "camera", action: "shake", params: { duration: 300 }, blocking: true }],
    }],
  };
  assert(minimumRuntimeVersionForScript(legacyScript) === "0.2.0", "legacy camera must keep runtime 0.2");
  assert(runtimeScriptSchemaVersion(legacyScript) === "1.1.0", "legacy camera must keep script schema 1.1");
  const structuredScript = {
    ...legacyScript,
    scenes: [{ ...legacyScript.scenes[0], commands: [firstMove] }],
  };
  assert(minimumRuntimeVersionForScript(structuredScript) === "0.3.0", "structured camera must require runtime 0.3");
  assert(runtimeScriptSchemaVersion(structuredScript) === "1.2.0", "structured camera must use script schema 1.2");
  const sequenceScript = {
    ...legacyScript,
    scenes: [{ ...legacyScript.scenes[0], commands: [sequenceMove] }],
  };
  assert(minimumRuntimeVersionForScript(sequenceScript) === "0.4.0", "camera sequence must require runtime 0.4");
  assert(runtimeScriptSchemaVersion(sequenceScript) === "1.3.0", "camera sequence must use script schema 1.3");

  let realNow = 100;
  const clock = new RuntimeClock(() => realNow);
  realNow = 200;
  assert(clock.now() === 100, "logical clock must advance with foreground time");
  clock.setSuspended("menu", true);
  realNow = 700;
  clock.setSuspended("media", true);
  clock.setSuspended("menu", false);
  assert(clock.now() === 100, "one remaining pause reason must keep the clock frozen");
  clock.setSuspended("media", false);
  realNow = 750;
  assert(clock.now() === 150, "clock must resume only after all pause reasons clear");
  clock.setPlaybackRate(2);
  realNow = 800;
  assert(clock.now() === 250, "preview playback rate must scale logical camera time");
  clock.setPlaybackRate(0.5);
  realNow = 900;
  assert(clock.now() === 300, "changing preview speed must keep logical time continuous");

  globalThis.window = globalThis as unknown as Window & typeof globalThis;
  const engine = new StoryEngine();
  engine.loadScript(
    {
      schema_version: "1.2.0",
      game_id: "camera_story",
      title: "Camera Story",
      entry_scene_id: "scene_camera",
      scenes: [
        {
          scene_id: "scene_camera",
          title: "Camera",
          summary: "",
          chapter: 1,
          tags: [],
          commands: [
            {
              type: "camera",
              blocking: true,
              motion: {
                schema_version: 1,
                kind: "reframe",
                to: { center_x: 0.55, center_y: 0.45, zoom: 1.5 },
                duration_ms: 10_000,
                easing: "linear",
              },
            },
            { type: "narration", text: "镜头结束后的对白" },
          ],
        },
        {
          scene_id: "scene_reset",
          title: "Reset",
          summary: "",
          chapter: 1,
          tags: [],
          commands: [
            {
              type: "camera",
              blocking: true,
              motion: {
                schema_version: 1,
                kind: "reset",
                duration_ms: 0,
                easing: "ease-out",
              },
            },
            { type: "narration", text: "已经回正" },
          ],
        },
      ],
    },
    {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.3.0",
      game_id: "camera_story",
      title: "Camera Story",
      author: "AgentVN",
      description: "",
      version: "0.1.0",
      language: "zh-CN",
      tags: [],
      entry_script: "script.json",
      entry_scene_id: "scene_camera",
      assets: [],
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    },
  );
  engine.start();
  assert(engine.state.camera.blocking_gate?.phase === "running", "blocking camera must own the advance gate");
  engine.next();
  assert(engine.state.currentCommandIndex === 0, "first click must not advance past a running camera");
  assert(engine.state.camera.blocking_gate?.phase === "awaiting_advance", "first click must wait for a second advance");
  assert(engine.cameraFrame().pose.zoom === 1.5, "first click must finish the camera at its authored endpoint");
  engine.next();
  assert(engine.state.currentCommandIndex === 1, "second click must advance exactly once");
  assert(engine.state.dialog?.text === "镜头结束后的对白", "second click must reveal the following story command");
  engine.completeTyping();
  engine.jumpToScene("scene_reset");
  assert(engine.state.dialog?.text === "已经回正", "zero-duration reset must continue immediately");
  assert(engine.cameraFrame().pose.zoom === 1, "explicit reset must restore the default pose");

  let cameraNow = 0;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => cameraNow },
  });
  const sequenceEngine = new StoryEngine();
  sequenceEngine.loadScript(
    {
      schema_version: "1.3.0",
      game_id: "camera_sequence_save",
      title: "Camera Sequence Save",
      entry_scene_id: "scene_sequence",
      scenes: [{
        scene_id: "scene_sequence",
        title: "Sequence",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [
          sequenceMove,
          { type: "narration", text: "连续运镜结束" },
        ],
      }],
    },
    {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.4.0",
      game_id: "camera_sequence_save",
      title: "Camera Sequence Save",
      author: "AgentVN",
      description: "",
      version: "0.1.0",
      language: "zh-CN",
      tags: [],
      entry_script: "script.json",
      entry_scene_id: "scene_sequence",
      assets: [],
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    },
  );
  sequenceEngine.start();
  cameraNow = 1500;
  const sequenceSave = sequenceEngine.createSaveSnapshot(5);
  assert(
    sequenceSave.camera?.active_replays[0]?.elapsed_ms === 1500,
    "sequence save must record elapsed path time",
  );
  cameraNow = 5000;
  const restoredSequenceEngine = new StoryEngine();
  restoredSequenceEngine.loadScript(sequenceEngine.script, sequenceEngine.manifest);
  restoredSequenceEngine.restoreSaveSnapshot(sequenceSave);
  const restoredSequencePose = restoredSequenceEngine.cameraFrame().pose;
  assert(
    Math.abs(restoredSequencePose.center_x - 0.55) < 0.0001
      && Math.abs(restoredSequencePose.zoom - 1.875) < 0.0001,
    "restoring a sequence must resume in the correct segment at the saved elapsed time",
  );
  restoredSequenceEngine.next();
  assert(
    restoredSequenceEngine.cameraFrame().pose.zoom === 1.5
      && restoredSequenceEngine.state.camera.blocking_gate?.phase === "awaiting_advance",
    "clicking a restored sequence must skip to the final shot and retain the two-click gate",
  );

  cameraNow = 0;
  const replayEngine = new StoryEngine();
  replayEngine.loadScript(
    {
      schema_version: "1.2.0",
      game_id: "camera_replay",
      title: "Camera Replay",
      entry_scene_id: "scene_replay",
      scenes: [{
        scene_id: "scene_replay",
        title: "Replay",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [
          {
            type: "camera",
            blocking: false,
            motion: {
              schema_version: 1,
              kind: "reframe",
              to: { center_x: 0.55, center_y: 0.5, zoom: 1.5 },
              duration_ms: 1000,
              easing: "linear",
            },
          },
          { type: "narration", text: "暂停在这里" },
          {
            type: "camera",
            blocking: false,
            motion: {
              schema_version: 1,
              kind: "impact",
              direction: "from_left",
              intensity: 0.6,
              duration_ms: 500,
            },
          },
          { type: "narration", text: "两条车道同时重播" },
        ],
      }],
    },
    {
      manifest_version: "1.0.0",
      cartridge_version: "1.0.0",
      runtime_version: "0.3.0",
      game_id: "camera_replay",
      title: "Camera Replay",
      author: "AgentVN",
      description: "",
      version: "0.1.0",
      language: "zh-CN",
      tags: [],
      entry_script: "script.json",
      entry_scene_id: "scene_replay",
      assets: [],
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    },
  );
  replayEngine.start();
  cameraNow = 180;
  replayEngine.completeTyping();
  replayEngine.next();
  const replaySave = replayEngine.createSaveSnapshot(2);
  assert(replaySave.save_version === 3, "camera snapshots must identify save format v3");
  assert(replaySave.camera?.active_replays.length === 2, "save must retain one active event per camera lane");
  const replayOffsets = replaySave.camera?.active_replays.map((item) => item.start_offset_ms);
  assert(replayOffsets?.[0] === 0 && replayOffsets?.[1] === 180, "save must preserve relative lane start timing");
  assert(replaySave.command_index === 3 && replaySave.dialog?.text === "两条车道同时重播", "non-blocking camera saves must keep the later story cursor");

  cameraNow = 1000;
  const restoredReplayEngine = new StoryEngine();
  restoredReplayEngine.loadScript(replayEngine.script, replayEngine.manifest);
  restoredReplayEngine.restoreSaveSnapshot(replaySave);
  assert(restoredReplayEngine.state.currentCommandIndex === 3, "visual-only replay must not rewind the story cursor");
  assert(!restoredReplayEngine.state.camera.blocking_gate, "visual-only replay must not create a blocking gate");
  assert(Boolean(restoredReplayEngine.state.camera.pose_motion), "the earliest saved lane must restart immediately");
  cameraNow = 1090;
  assert(restoredReplayEngine.cameraFrame().impulse_progress === 0, "a later saved lane must wait for its relative start offset");
  cameraNow = 1270;
  assert(restoredReplayEngine.cameraFrame().impulse_progress > 0, "a delayed saved lane must start after its relative offset");

  const damagedSave = structuredClone(replaySave);
  damagedSave.camera.persistent_pose = { center_x: -3, center_y: 0.5, zoom: 99 };
  damagedSave.camera.active_replays = null;
  const damagedEngine = new StoryEngine();
  damagedEngine.loadScript(replayEngine.script, replayEngine.manifest);
  damagedEngine.restoreSaveSnapshot(damagedSave);
  assert(damagedEngine.cameraFrame().pose.zoom === 1, "damaged saved poses must restore the default camera safely");
  assert(Boolean(damagedEngine.state.cameraNotice), "damaged camera records must explain the safe recovery in Chinese");
  assert(
    damagedEngine.state.animationHint === damagedEngine.state.cameraNotice,
    "damaged camera recovery must reach the visible player hint",
  );

  cameraNow = 2000;
  const runningGateEngine = new StoryEngine();
  runningGateEngine.loadScript(engine.script, engine.manifest);
  runningGateEngine.start();
  const runningGateSave = runningGateEngine.createSaveSnapshot(3);
  const restoredRunningGate = new StoryEngine();
  restoredRunningGate.loadScript(engine.script, engine.manifest);
  restoredRunningGate.restoreSaveSnapshot(runningGateSave);
  assert(restoredRunningGate.state.camera.blocking_gate?.phase === "running", "a running blocking camera must restore its advance gate");
  restoredRunningGate.next();
  assert(restoredRunningGate.state.currentCommandIndex === 0, "first click after loading a running camera must only finish the event");
  assert(restoredRunningGate.state.camera.blocking_gate?.phase === "awaiting_advance", "loaded running camera must still require a second click");
  restoredRunningGate.next();
  assert(restoredRunningGate.state.currentCommandIndex === 1, "second click after loading must advance exactly once");

  const waitingGateEngine = new StoryEngine();
  waitingGateEngine.loadScript(engine.script, engine.manifest);
  waitingGateEngine.start();
  waitingGateEngine.next();
  const waitingGateSave = waitingGateEngine.createSaveSnapshot(4);
  const restoredWaitingGate = new StoryEngine();
  restoredWaitingGate.loadScript(engine.script, engine.manifest);
  restoredWaitingGate.restoreSaveSnapshot(waitingGateSave);
  assert(restoredWaitingGate.state.camera.blocking_gate?.phase === "awaiting_advance", "save after the first click must restore the waiting gate");
  assert(!restoredWaitingGate.state.camera.pose_motion, "a completed camera must not replay while waiting for the second click");
  restoredWaitingGate.next();
  assert(restoredWaitingGate.state.currentCommandIndex === 1, "one click must advance a restored waiting gate");

  console.log("camera motion contract test OK");
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "camera-motion-contract-test.ts",
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
