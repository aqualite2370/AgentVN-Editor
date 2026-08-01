import type { ConditionalJumpCommand } from "../../types/commands";
import { conditionToRuntimeCondition, runtimeConditionToConditionData } from "../../utils/conditions";
import { ConditionBuilderEditor } from "./ConditionBuilderEditor";

export function ConditionalJumpCommandEditor({
  command,
  variableKeys,
  sceneIds = [],
  onChange,
}: {
  command: ConditionalJumpCommand;
  variableKeys: string[];
  sceneIds?: string[];
  onChange: (command: ConditionalJumpCommand) => void;
}) {
  const sceneDatalistId = `conditional-jump-scenes-${command.target_scene_id || "target"}`;

  return (
    <div className="conditional-jump-editor">
      <ConditionBuilderEditor
        condition={runtimeConditionToConditionData(command.condition)}
        variableKeys={variableKeys}
        datalistId="conditional-jump-variable-candidates"
        showExitLabels={false}
        onChange={(condition) => onChange({ ...command, condition: conditionToRuntimeCondition(condition) })}
      />
      <section className="condition-builder-card">
        <div className="condition-builder-card-header">
          <strong>跳转目标</strong>
          <span>条件满足时跳到目标场景；不满足时可跳到 else 场景，留空则继续下一条事件。</span>
        </div>
        <div className="condition-builder-grid is-two-column">
          <label>
            满足时跳转场景
            <input
              value={command.target_scene_id}
              list={sceneDatalistId}
              data-help-key="command.conditionalJump.target"
              onChange={(event) => onChange({ ...command, target_scene_id: event.target.value })}
            />
          </label>
          <label>
            不满足时跳转场景
            <input
              value={command.else_target_scene_id ?? ""}
              list={sceneDatalistId}
              placeholder="留空则继续"
              data-help-key="command.conditionalJump.elseTarget"
              onChange={(event) => onChange({ ...command, else_target_scene_id: event.target.value || null })}
            />
          </label>
          <datalist id={sceneDatalistId}>
            {sceneIds.map((sceneId) => <option key={sceneId} value={sceneId} />)}
          </datalist>
        </div>
      </section>
    </div>
  );
}
