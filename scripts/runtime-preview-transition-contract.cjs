#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const protocolTest = esbuild.buildSync({
  stdin: {
    contents: `
      import {
        LIVE_PREVIEW_PROTOCOL_VERSION,
        isLivePreviewEditorMessage,
      } from "./shared/preview/livePreviewProtocol";

      const valid = {
        type: "agentvn.live-preview.freeze-frame.request",
        protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
        sessionId: "session",
        revision: 4,
        requestId: "freeze-1",
        runId: "run-2",
        width: 480,
        height: 270,
      };
      if (!isLivePreviewEditorMessage(valid)) throw new Error("freeze-frame request must be accepted");
      if (isLivePreviewEditorMessage({ ...valid, width: 640 })) throw new Error("unexpected freeze-frame sizes must be rejected");
      if (isLivePreviewEditorMessage({ ...valid, revision: -1 })) throw new Error("invalid identities must be rejected");
    `,
    resolveDir: root,
    sourcefile: "runtime-preview-transition-contract.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  target: "node20",
});

const moduleUnderTest = { exports: {} };
new Function("require", "module", "exports", protocolTest.outputFiles[0].text)(
  require,
  moduleUnderTest,
  moduleUnderTest.exports,
);

const hook = read("editor/src/hooks/useRuntimePreviewTransition.ts");
for (const marker of [
  '"capturing"',
  '"changing"',
  '"settling"',
  '"reloading"',
  "ResizeObserver",
  "captureTimeoutMs = 120",
  "settleMs = 180",
  "duration: 260",
  "tokenRef",
]) {
  assert(hook.includes(marker), `preview transition controller is missing ${marker}`);
}
assert(hook.includes("resume: () => void"), "preview transition must accept a matching resume callback");
assert(hook.includes("resumeRef.current()"), "preview transition must resume the runtime after reloading");

const studio = read("editor/src/components/command-editors/CameraStudioDialog.tsx");
for (const marker of [
  "camera-studio-stage-deck",
  "camera-runtime-divider",
  "runtimeDockWidthStorageKey",
  "runtimeDockHeightStorageKey",
  "minimizeRuntimePreview",
  "restoreRuntimePreview",
  "RuntimePreviewMask",
  "camera-center-line-underlay",
]) {
  assert(studio.includes(marker), `camera studio is missing ${marker}`);
}
assert(
  studio.includes('if (playing) sendRuntimeControl("resume")'),
  "camera studio transition must resume only when preview playback was active",
);

const preview = read("editor/src/components/editor/PreviewPanel.tsx");
assert(preview.includes("resizing: boolean"), "scene preview must receive live resize state");
assert(preview.includes("previewTransition.beginTransition()"), "scene preview must mask before resizing");
assert(preview.includes("previewTransition.finishTransition()"), "scene preview must reload after resizing");
assert(preview.includes("resumeForGeometryChange"), "scene preview must expose a geometry-change resume control");
assert(preview.includes("resume: resumeForGeometryChange"), "scene preview must pair transition pause and resume");

const workbench = read("editor/src/components/command-editors/FloatingCommandWorkbench.tsx");
const inspector = read("editor/src/components/editor/InspectorPanel.tsx");
assert(workbench.includes("onOpenCameraStudio"), "scene workbench must expose the camera studio action");
assert(workbench.includes("打开运镜工作室"), "scene workbench must name the structured camera action");
assert(inspector.includes("<CameraStudioDialog"), "scene inspector must open the structured camera studio");

const runtime = read("GameCli_framework/src/app/App.tsx");
assert(runtime.includes("captureLivePreviewFrame"), "GameCLI must capture a freeze frame");
assert(runtime.includes("MAX_LIVE_PREVIEW_FRAME_BYTES = 160 * 1024"), "freeze frames must have a size budget");

const css = read("editor/src/styles/layout.css");
const normalizeCss = (value) => value.replace(/\s+/g, "").replace(/::(before|after)\b/g, ":$1");
for (const marker of [
  "@media (max-width: 1120px)",
  ".runtime-preview-mask.is-visible",
  ".camera-frame-handle:hover::after",
  ".camera-center-marker.is-target",
  "stroke-width: 1.25",
  "width: 44px",
]) {
  assert(normalizeCss(css).includes(normalizeCss(marker)), `preview layout styles are missing ${marker}`);
}

console.log("runtime preview transition contract: PASS");
