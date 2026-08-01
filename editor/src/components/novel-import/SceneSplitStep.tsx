import { useNovelImportStore } from "../../store/novelImportStore";

export function SceneSplitStep() {
  const scenes = useNovelImportStore((state) => state.session.scenes);
  const updateSceneCandidate = useNovelImportStore((state) => state.updateSceneCandidate);
  const extractCharacters = useNovelImportStore((state) => state.extractCharacters);
  return (
    <section className="advanced-card">
      <h3>4. 场景切分</h3>
      {scenes.map((scene) => (
        <div className="advanced-list-item" key={scene.scene_candidate_id}>
          <input value={scene.title} data-help-key="novel.sceneTitle" onChange={(event) => updateSceneCandidate({ ...scene, title: event.target.value })} />
          <span>{scene.location_hint ?? "未知地点"} · {scene.time_hint ?? "未知时间"} · {scene.characters.join(", ")}</span>
          <p>{scene.source_excerpt.slice(0, 420)}{scene.source_excerpt.length > 420 ? "..." : ""}</p>
        </div>
      ))}
      <button type="button" data-help-key="novel.extractCharacters" onClick={extractCharacters}>识别角色</button>
    </section>
  );
}
