import type { AdaptedScene } from "../../novel-import/types";
import { sceneReferenceLabel } from "../../utils/displayNames";

export function SceneMappingPanel({ scene }: { scene: AdaptedScene }) {
  return (
    <section className="advanced-card compact">
      <strong>来源映射</strong>
      <span>{sceneReferenceLabel(scene.scene_beat)}</span>
      <span>
        {scene.source_mapping.start_offset} - {scene.source_mapping.end_offset}
      </span>
      <p>{scene.source_mapping.source_excerpt}</p>
    </section>
  );
}
