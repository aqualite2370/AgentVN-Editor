import type { JumpCommand } from "../../types/commands";

export function JumpCommandEditor({ command, sceneIds = [], onChange }: { command: JumpCommand; sceneIds?: string[]; onChange: (command: JumpCommand) => void }) {
  const datalistId = `jump-scenes-${command.target_scene_id || "target"}`;
  return (
    <section className="condition-builder-card">
      <div className="condition-builder-card-header">
        <strong>直接跳转</strong>
        <span>播放到这里时立即进入目标场景，可用于回跳、传送、循环入口。</span>
      </div>
      <label>
        目标场景
        <input value={command.target_scene_id} list={datalistId} data-help-key="command.jump.target" onChange={(event) => onChange({ ...command, target_scene_id: event.target.value })} />
      </label>
      <datalist id={datalistId}>
        {sceneIds.map((sceneId) => <option key={sceneId} value={sceneId} />)}
      </datalist>
    </section>
  );
}
