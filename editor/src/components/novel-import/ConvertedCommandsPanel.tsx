import type { SceneBeat } from "../../types/scene";
import { CommandListEditor } from "../command-editors/CommandListEditor";

export function ConvertedCommandsPanel({ scene, onChange }: { scene: SceneBeat; onChange: (scene: SceneBeat) => void }) {
  return <CommandListEditor sceneId={scene.scene_id} commands={scene.commands} onChange={(commands) => onChange({ ...scene, commands })} />;
}
