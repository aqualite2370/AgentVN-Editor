import type { PreviewStartSpec } from "./livePreviewProtocol";

export interface LivePreviewSceneIndex {
  entry_scene_id: string;
  scenes: Array<{ scene_id: string }>;
}

function hasScene(script: LivePreviewSceneIndex, sceneId: string | undefined): sceneId is string {
  return Boolean(sceneId && script.scenes.some((scene) => scene.scene_id === sceneId));
}

export function resolveLivePreviewPatchSceneId(
  script: LivePreviewSceneIndex,
  activeSceneId: string | undefined,
): string | undefined {
  if (hasScene(script, activeSceneId)) return activeSceneId;
  return hasScene(script, script.entry_scene_id) ? script.entry_scene_id : undefined;
}

export function resolveLivePreviewPatchStart(
  script: LivePreviewSceneIndex,
  requestedStart: PreviewStartSpec,
  requestId: string,
): PreviewStartSpec {
  if (hasScene(script, requestedStart.target.sceneId)) return requestedStart;
  const sceneId = resolveLivePreviewPatchSceneId(script, undefined);
  if (!sceneId) return requestedStart;
  return {
    requestId,
    target: { sceneId },
    entryPath: [],
    mode: "stable_frame",
    playbackRate: requestedStart.playbackRate,
    reducedMotion: requestedStart.reducedMotion,
  };
}
