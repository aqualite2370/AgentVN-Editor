#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const protocol = read("shared/preview/livePreviewProtocol.ts");
const engine = read("GameCli_framework/src/engine/StoryEngine.ts");
const runtimeStore = read("GameCli_framework/src/store/runtimeStore.ts");
const runtimeApp = read("GameCli_framework/src/app/App.tsx");
const previewPanel = read("editor/src/components/editor/PreviewPanel.tsx");
const previewWindowControls = read("editor/src/components/advanced/PreviewWindowControls.tsx");
const previewTransition = read("editor/src/hooks/useRuntimePreviewTransition.ts");
const exportScriptSource = read("editor/src/utils/exportScript.ts");

for (const type of [
  "agentvn.live-preview.init",
  "agentvn.live-preview.start",
  "agentvn.live-preview.patch",
  "agentvn.live-preview.control",
  "agentvn.live-preview.ready",
  "agentvn.live-preview.error",
]) {
  assert(protocol.includes(type), `shared protocol must define ${type}`);
}

assert(protocol.includes("LIVE_PREVIEW_PROTOCOL_VERSION = 2"), "live preview must use protocol V2");
for (const field of ["sessionId", "requestId", "runId", "entryPath", "play_target_event", "playbackRate"]) {
  assert(protocol.includes(field), `live preview V2 must carry ${field}`);
}
assert(engine.includes("previewScene("), "StoryEngine must expose scene preview positioning");
assert(engine.includes("first_stable_frame"), "StoryEngine preview must support first stable frame mode");
assert(engine.includes("previewStart("), "StoryEngine must expose deterministic target-event preview");
assert(runtimeStore.includes("previewScene:"), "runtime store must expose previewScene");
assert(runtimeApp.includes("agentvn.live-preview.init"), "runtime must receive live preview initialization");
assert(runtimeApp.includes("agentvn.live-preview.patch"), "runtime must receive live preview patches");
const runtimePatch = runtimeApp.slice(
  runtimeApp.indexOf('message.type === "agentvn.live-preview.patch"'),
  runtimeApp.indexOf("} else {", runtimeApp.indexOf('message.type === "agentvn.live-preview.patch"')),
);
assert(runtimePatch.includes("resolveLivePreviewPatchStart"), "runtime patches must recover stale scene targets against the merged script");
assert(runtimePatch.indexOf("mergeLivePreviewGame") < runtimePatch.indexOf("resolveLivePreviewPatchStart"), "runtime patches must merge the latest script before resolving the preview target");
assert(runtimePatch.includes("livePreviewPatchQueueRef"), "runtime patches must be serialized to avoid stale async loads overwriting newer patches");
assert(previewPanel.includes("agentvn.live-preview.init"), "editor must initialize live preview");
assert(previewPanel.includes("agentvn.live-preview.start"), "editor must switch preview targets without cartridge export");
assert(previewPanel.includes("findPreviewEntryPaths"), "scene reload must restore a concrete editor entry path");
assert(previewPanel.includes('mode: "play_target_event"'), "scene reload must play the target scene opening");
assert(previewPanel.includes("target: { sceneId, commandIndex: 0 }"), "scene reload must start at the first target-scene event");
const noEntryPathFallback = previewPanel.slice(
  previewPanel.indexOf("if (candidates.length === 0)"),
  previewPanel.indexOf("if (candidates.length === 1)"),
);
assert(
  noEntryPathFallback.includes("replaySceneFromPath(sceneId);"),
  "scene reload must replay from a clean scene state when no editor entry path is available",
);
assert(
  !noEntryPathFallback.includes("entry_scene_id") && !noEntryPathFallback.includes('setStatus("error")'),
  "an unreachable scene must not block its own camera-motion preview",
);
assert(previewPanel.includes("重载场景"), "embedded preview toolbar must expose the scene reload action");
assert(previewPanel.includes("preview.reloadScene"), "scene reload action must expose contextual help");
assert(previewPanel.includes('data-hover-help-suppressed="true"'), "route picker must not be obscured by global hover help");
assert(!previewPanel.includes("syncEmbeddedPreview"), "scene reload must replace the obsolete full-sync action");
assert(!previewPanel.includes("exportEditorCartridge"), "embedded scene reload must not rebuild a full cartridge");
assert(previewPanel.includes("150"), "editor live refresh must use the planned 150ms debounce");
assert(previewPanel.includes("livePreviewHandshakeTimeoutMs"), "editor must retry when GameCLI starts after the iframe");
assert(previewPanel.includes("void initializeLivePreview()"), "editor must retry initialization without reloading the runtime frame");
assert(!previewPanel.includes("setRuntimeFrameRevision"), "editor must not automatically reload the runtime frame during handshake retries");
assert(previewPanel.includes("event.source !== iframeRef.current?.contentWindow"), "editor must ignore stale iframe responses after a frame replacement");
const previewInit = previewPanel.slice(
  previewPanel.indexOf("const initializeLivePreview"),
  previewPanel.indexOf("const previewTransition"),
);
assert(previewInit.includes("const sceneId = data.script.entry_scene_id"), "ordinary live-preview initialization must always use the authored entry scene");
assert(!previewInit.includes("requestedSceneId"), "ordinary live-preview initialization must not inherit the selected editor node");
const previewPatch = previewPanel.slice(
  previewPanel.indexOf("scheduleLivePatch"),
  previewPanel.indexOf("function replaySceneFromPath"),
);
assert(previewPatch.includes("activeSceneIdRef.current"), "passive live-preview patches must preserve the active runtime scene");
assert(previewPatch.includes("resolveLivePreviewPatchSceneId"), "passive live-preview patches must validate the cached scene against the latest script");
assert(!previewPatch.includes("!script || script.scenes.some"), "partial live-preview patches must not trust a cached scene without validating it");
assert(!previewPatch.includes("const sceneId = selectedSceneId()"), "passive live-preview patches must not jump to the selected editor node");
assert(previewPanel.includes("activeSceneIdRef.current = undefined"), "a stale live-preview error must clear the cached active scene");
assert(!previewWindowControls.includes("{ ...script, entry_scene_id: selectedNode.data.scene.scene_id }"), "standalone GameCLI preview must preserve the authored entry scene");
assert(previewTransition.includes("failTransition"), "preview transition must expose a failure exit instead of leaving the loading mask visible");
assert(previewPanel.includes("previewTransition.failTransition()"), "preview initialization errors must dismiss the loading mask");
assert(exportScriptSource.includes("normalizeCameraCommandFields"), "editor export must normalize nullable camera flags before live preview validation");

const nullCameraRegression = esbuild.buildSync({
  stdin: {
    contents: `
      import { exportScript } from "./editor/src/utils/exportScript";
      import { validateCameraCommand } from "./shared/camera/cameraMotion";

      const nodes = [
        {
          id: "start",
          type: "startNode",
          position: { x: 0, y: 0 },
          data: {
            nodeKind: "start",
            label: "入口",
            description: "",
            memoryMode: "hybrid",
            aiSettings: { authorGoal: "", generationOutline: "", autoExtractMemory: true, autoApplyMemory: false },
            previewState: { currentCommandIndex: 0, isPlaying: false },
            editorMeta: { collapsedInspectorSections: [], source: "manual" },
          },
        },
        {
          id: "scene",
          type: "sceneNode",
          position: { x: 0, y: 200 },
          data: {
            nodeKind: "scene",
            label: "开场",
            description: "",
            memoryMode: "hybrid",
            aiSettings: { authorGoal: "", generationOutline: "", autoExtractMemory: true, autoApplyMemory: false },
            previewState: { currentCommandIndex: 0, isPlaying: false },
            editorMeta: { collapsedInspectorSections: [], source: "ai_edited" },
            scene: {
              scene_id: "scene_opening",
              title: "开场",
              summary: "",
              chapter: 1,
              tags: [],
              commands: [{
                type: "camera",
                blocking: true,
                motion: {
                  schema_version: 1,
                  kind: "reframe",
                  to: { center_x: 0.5, center_y: 0.55, zoom: 1.15 },
                  duration_ms: 2500,
                  easing: "ease-in-out",
                  unsafe_overscan: null,
                },
              }],
            },
          },
        },
      ] as any;
      const script = exportScript(nodes, [{
        id: "edge",
        source: "start",
        target: "scene",
        sourceHandle: "default",
      }] as any);
      const camera = script.scenes[0].commands[0] as any;
      if ("unsafe_overscan" in camera.motion) {
        throw new Error("nullable unsafe_overscan must be removed before live preview");
      }
      const issues = validateCameraCommand(camera);
      if (issues.length > 0) {
        throw new Error("normalized camera command must validate: " + JSON.stringify(issues));
      }
    `,
    resolveDir: root,
    sourcefile: "live-preview-null-camera-regression.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  target: "node20",
});
const regressionModule = { exports: {} };
new Function("require", "module", "exports", nullCameraRegression.outputFiles[0].text)(
  require,
  regressionModule,
  regressionModule.exports,
);

console.log("live scene preview contract OK");
