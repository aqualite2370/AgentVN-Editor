#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import { defaultCommand, commandSummary } from "./editor/src/utils/commandTools";
  import { isStructuredCameraCommand } from "./shared/camera/cameraMotion";
  import { convertibleLegacyCamera } from "./editor/src/utils/cameraLegacyConversion";

  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  const command = defaultCommand("camera");
  assert(isStructuredCameraCommand(command), "new editor camera commands must use the structured motion format");
  assert(command.motion.duration_ms === 1400, "new camera commands must materialize their duration");
  assert(commandSummary(command).includes("轻推"), "camera cards must explain the motion in concise Chinese");

  assert(
    convertibleLegacyCamera({ type: "camera", action: "reset", params: {}, blocking: true }) === undefined,
    "legacy reset names must not be guessed into the structured format",
  );
  const unsafeLegacy = convertibleLegacyCamera({
    type: "camera",
    action: "absolute",
    params: { center_x: 0.1, center_y: 0.5, zoom: 1.2, duration_ms: 800, easing: "linear" },
    blocking: false,
  });
  assert(
    unsafeLegacy?.motion.kind === "reframe" && unsafeLegacy.motion.unsafe_overscan === true,
    "legacy absolute compositions outside the safe frame must keep an explicit overscan opt-in",
  );
  for (const params of [
    { center_x: 0.5, center_y: 0.5, zoom: 1.2, rotation: 5 },
    { center_x: 0.5, center_y: 0.5, zoom: 1.2, keyframes: [] },
    { center_x: 0.5, center_y: 0.5, zoom: 1.2, blur: 2 },
  ]) {
    assert(
      convertibleLegacyCamera({ type: "camera", action: "absolute", params, blocking: true }) === undefined,
      "legacy camera conversion must reject unknown or non-normalizable parameters",
    );
  }
  const legacyShake = convertibleLegacyCamera({
    type: "camera",
    action: "shake",
    params: { direction: "vertical", intensity: 0.7, duration_ms: 640 },
    blocking: true,
  });
  assert(
    legacyShake?.motion.kind === "shake"
      && legacyShake.motion.direction === "vertical"
      && legacyShake.motion.intensity === 0.7
      && legacyShake.motion.duration_ms === 640
      && legacyShake.blocking,
    "legacy shake conversion must preserve valid author settings and blocking",
  );
  const legacyImpact = convertibleLegacyCamera({
    type: "camera",
    action: "impact",
    params: { direction: "from_right", intensity: 0.8, duration: 420 },
    blocking: false,
  });
  assert(
    legacyImpact?.motion.kind === "impact"
      && legacyImpact.motion.direction === "from_right"
      && legacyImpact.motion.intensity === 0.8
      && legacyImpact.motion.duration_ms === 420
      && !legacyImpact.blocking,
    "legacy impact conversion must preserve valid author settings",
  );
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "camera-editor-contract-test.ts",
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

const commandList = fs.readFileSync(path.join(root, "editor", "src", "components", "command-editors", "CommandListEditor.tsx"), "utf8");
const studio = fs.readFileSync(path.join(root, "editor", "src", "components", "command-editors", "CameraStudioDialog.tsx"), "utf8");
const editorStore = fs.readFileSync(path.join(root, "editor", "src", "store", "editorStore.ts"), "utf8");
const layoutStyles = fs.readFileSync(path.join(root, "editor", "src", "styles", "layout.css"), "utf8");
for (const marker of ["＋ 运镜", "CameraStudioDialog", "insert"]) {
  if (!commandList.includes(marker)) throw new Error(`command list is missing ${marker}`);
}
for (const marker of [
  "camera-command-insert-label",
  "width 480ms",
  ".camera-command-insert:hover .camera-command-insert-label",
  "@media (prefers-reduced-motion: reduce)",
]) {
  if (!layoutStyles.includes(marker)) throw new Error(`camera insert reveal is missing ${marker}`);
}
for (const marker of [
  "应用运镜",
  "当前机位",
  "目标机位",
  "播放机位",
  "低动态演出",
  "重新连接",
  "各路线继承机位",
  "frameResizePointerDown",
  "放大真实 GameCLI 预览",
  "自定义曲线",
  "第一控制点横向",
  "第一控制点纵向",
  "第二控制点横向",
  "第二控制点纵向",
  "单场景默认机位",
  "spritePreviewRefs",
  "stageSize",
  "转换前对比",
  "新版运镜",
  "旧版整屏效果",
  "添加连续镜头",
  "连续镜头管理",
  "camera-shot-manager",
  "camera-playback-segments",
  "sequenceDrop",
  "deleteSequenceShot",
  "这一段不会移动，只会等待",
]) {
  if (!studio.includes(marker)) throw new Error(`camera studio is missing ${marker}`);
}
if (!studio.includes("camera-frame-handle is-${corner}") || !studio.includes('"north-west"') || !studio.includes('"south-east"')) {
  throw new Error("camera studio must expose four real corner resize handles");
}
if (!studio.includes('onPointerUp={() => sendRuntimeControl("replay")}')) {
  throw new Error("releasing the local playhead must restart the real GameCLI event");
}
if (!studio.includes("if (selectedPath || usingSceneDefault) void initializeRuntimePreview()")) {
  throw new Error("selecting a route after the initial multi-route error must reconnect GameCLI");
}
if (!editorStore.includes('schema_version: "1.1.0"')) throw new Error("saved editor projects must use schema 1.1.0");

console.log("camera editor contract test OK");
