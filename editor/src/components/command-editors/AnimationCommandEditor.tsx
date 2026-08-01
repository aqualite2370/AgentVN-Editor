import { useMemo } from "react";
import type { AnimationCommand } from "../../types/commands";
import { animationTargetOptions } from "../../utils/localizedOptions";
import { characterIdFromSpriteTarget, collectCharacterIdsFromNodes, spriteTargetForCharacter } from "../../utils/characterReferences";
import { useEditorStore } from "../../store/editorStore";
import { LocalizedValueSelect } from "../common/LocalizedValueSelect";
import { FieldHelp } from "../common/FieldHelp";
import { AssetPicker } from "../common/AssetPicker";
import { RichSelect } from "../common/RichSelect";

export function AnimationCommandEditor({
  command,
  onChange,
}: {
  command: AnimationCommand;
  onChange: (command: AnimationCommand) => void;
}) {
  const nodes = useEditorStore((state) => state.nodes);
  const characterIds = useMemo(() => collectCharacterIdsFromNodes(nodes), [nodes]);
  const spriteTargetId = characterIdFromSpriteTarget(command.target);
  const isSpriteTarget = command.target.trim().toLowerCase().startsWith("sprite:");
  const targetOptions = ["selected", "all", ...characterIds];
  if (spriteTargetId && !targetOptions.includes(spriteTargetId)) targetOptions.push(spriteTargetId);

  return (
    <div className="form-grid">
      <AssetPicker
        label="演出动画素材"
        field="animation_id"
        value={command.animation_id}
        allowedTypes={["animation"]}
        helpKey="command.animation.animationId"
        onChange={(assetId) => onChange({ ...command, animation_id: assetId })}
      />
      <label>
        演出动画代称 <FieldHelp field="animation_display_name" />
        <input
          value={command.animation_display_name ?? ""}
          placeholder="例如：闪白强调、镜头震动"
          onChange={(event) => onChange({ ...command, animation_display_name: event.target.value || null })}
        />
      </label>
      {isSpriteTarget && (
        <div className="character-target-panel">
          <label>
            角色目标
            <RichSelect
              value={spriteTargetId || "selected"}
              options={targetOptions.map((id) => ({ value: id, label: id === "selected" ? "当前立绘" : id === "all" ? "全部立绘" : id }))}
              helpKey="command.animation.spriteTarget"
              onChange={(nextTargetId) => onChange({ ...command, target: spriteTargetForCharacter(nextTargetId) })}
            />
          </label>
          <label>
            自定义角色 ID
            <input data-help-key="command.animation.spriteTargetCustom" value={spriteTargetId || ""} onChange={(event) => onChange({ ...command, target: spriteTargetForCharacter(event.target.value) })} />
          </label>
        </div>
      )}
      <label>
        演出目标 <FieldHelp field="target" />
        <LocalizedValueSelect
          value={command.target}
          options={animationTargetOptions}
          helpKey="command.animation.target"
          customPlaceholder="填写自定义演出目标"
          onChange={(target) => onChange({ ...command, target: target || command.target })}
        />
      </label>
      <label>
        演出参数 <FieldHelp field="params" />
        <textarea
          value={JSON.stringify(command.params)}
          data-help-key="command.animation.params"
          onChange={(event) => {
            try {
              onChange({ ...command, params: JSON.parse(event.target.value) });
            } catch {
              // error-log-ignore: 作者输入 JSON 的过程中允许暂时不完整，继续保留上次有效值。
              onChange(command);
            }
          }}
        />
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={command.blocking}
          data-help-key="command.animation.blocking"
          onChange={(event) => onChange({ ...command, blocking: event.target.checked })}
        />
        阻塞后续剧情
      </label>
    </div>
  );
}
