import type { AdaptedScene } from "./types";

export function mergeAdaptedScenes(scenes: AdaptedScene[]): AdaptedScene[] {
  return scenes
    .slice()
    .sort((a, b) => a.source_mapping.start_offset - b.source_mapping.start_offset)
    .map((scene, index) => ({ ...scene, scene_beat: { ...scene.scene_beat, chapter: scene.scene_beat.chapter || Math.floor(index / 12) + 1 } }));
}
