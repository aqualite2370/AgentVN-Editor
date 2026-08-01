import { useNovelImportStore } from "../../store/novelImportStore";
import { sceneReferenceLabel } from "../../utils/displayNames";
import { OriginalTextPanel } from "./OriginalTextPanel";
import { ConvertedCommandsPanel } from "./ConvertedCommandsPanel";
import { SceneMappingPanel } from "./SceneMappingPanel";

export function AdaptationPreviewStep() {
  const adapted = useNovelImportStore((state) => state.session.adapted_scenes);
  const updateAdaptedScene = useNovelImportStore((state) => state.updateAdaptedScene);

  return (
    <section className="advanced-card">
      <h3>6. 改编预览与人工校对</h3>
      {adapted.map((scene) => (
        <div className="advanced-grid-2" key={scene.adapted_scene_id}>
          <div>
            <OriginalTextPanel text={scene.source_mapping.source_excerpt} />
            <SceneMappingPanel scene={scene} />
          </div>
          <div>
            <strong>
              {sceneReferenceLabel(scene.scene_beat)}
              {scene.needs_review ? " / 需复查" : ""}
            </strong>
            <ConvertedCommandsPanel scene={scene.scene_beat} onChange={(sceneBeat) => updateAdaptedScene({ ...scene, scene_beat: sceneBeat })} />
          </div>
        </div>
      ))}
    </section>
  );
}
