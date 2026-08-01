import { ArrowLeftRight, PersonStanding } from "lucide-react";
import { defaultCharacterAnimationConfig, legacySpriteAnimationToConfig } from "../../../../shared/animation/characterAnimation";
import { MAX_SPRITE_LAYER, MIN_SPRITE_LAYER } from "../../../../shared/cartridge/spriteLayer";
import type { SpriteCommand } from "../../types/commands";
import { spriteAnimationOptions, spritePositionOptions } from "../../utils/localizedOptions";
import { AssetPicker } from "../common/AssetPicker";
import { FieldHelp } from "../common/FieldHelp";
import { LocalizedValueSelect } from "../common/LocalizedValueSelect";
import { CharacterAnimationControls } from "./CharacterAnimationControls";
import { SpriteScaleControl } from "./SpriteScaleControl";
import { VisualTransitionControls } from "./VisualTransitionControls";

function replacementContextHint(command: SpriteCommand): string {
  if (!command.character_id.trim() && !command.sprite_id.trim()) {
    return "角色编号和立绘素材尚未设置；仍可预设参数，补全后会在同角色换装或表情替换时生效。";
  }
  if (!command.character_id.trim()) {
    return "角色编号尚未设置；替换过场需要用角色编号识别前后是否为同一角色。";
  }
  if (!command.sprite_id.trim()) {
    return "立绘素材尚未设置；选择新素材后，此设置用于同角色旧立绘到新立绘的切换。";
  }
  return "仅在同一角色的 sprite_id 从旧素材变为新素材时生效，不负责首次入场或最终退场。";
}

export function SpriteCommandEditor({
  command,
  onChange,
}: {
  command: SpriteCommand;
  onChange: (command: SpriteCommand) => void;
}) {
  const animationConfig =
    command.animation_config ??
    legacySpriteAnimationToConfig(command.animation, command.animation_display_name, command.visible) ??
    { ...defaultCharacterAnimationConfig(command.visible), kind: "none" as const };
  const replacementDisabledReason = command.visible
    ? undefined
    : "当前命令用于隐藏立绘：退出效果由“角色出入场动画”负责，替换过场不会执行。";

  return (
    <div className="form-grid sprite-command-editor">
      <label>
        角色编号 <FieldHelp field="character_id" />
        <input
          value={command.character_id}
          data-help-key="command.sprite.characterId"
          onChange={(event) => onChange({ ...command, character_id: event.target.value })}
        />
      </label>
      <AssetPicker
        label="立绘素材"
        field="sprite_id"
        value={command.sprite_id}
        allowedTypes={["sprite"]}
        helpKey="command.sprite.spriteId"
        onChange={(assetId) => onChange({ ...command, sprite_id: assetId })}
      />
      <label>
        立绘位置 <FieldHelp field="position" />
        <LocalizedValueSelect
          value={command.position ?? ""}
          options={spritePositionOptions}
          emptyLabel="不指定"
          helpKey="command.sprite.position"
          customPlaceholder="填写自定义位置代码"
          onChange={(position) => onChange({ ...command, position: position || null })}
        />
      </label>
      <label className="sprite-layer-control">
        人物层级 <FieldHelp field="layer" />
        <input
          type="number"
          min={MIN_SPRITE_LAYER}
          max={MAX_SPRITE_LAYER}
          step={1}
          value={command.layer ?? ""}
          placeholder="继承当前层级"
          data-help-key="command.sprite.layer"
          onChange={(event) => onChange({
            ...command,
            layer: event.target.value === "" ? undefined : Number(event.target.value),
          })}
        />
        <small>数值越大越靠前；留空时继承该角色当前层级，输入 0 恢复默认层级。</small>
      </label>
      <label className="check-row sprite-visible-toggle">
        <input
          type="checkbox"
          checked={command.visible}
          data-help-key="command.sprite.visible"
          onChange={(event) => {
            const visible = event.target.checked;
            onChange({
              ...command,
              visible,
              animation_config: command.animation_config
                ? { ...command.animation_config, phase: visible ? "enter" : "exit" }
                : command.animation_config,
            });
          }}
        />
        显示立绘
      </label>

      <SpriteScaleControl
        characterId={command.character_id}
        value={command.scale}
        onChange={(scale) => onChange({ ...command, scale })}
      />

      <section className="sprite-motion-guide" aria-label="立绘动作分工">
        <header>
          <strong>两类动作各司其职</strong>
          <span>避免入退场动画与换装过场重复驱动同一层</span>
        </header>
        <div>
          <span><PersonStanding size={15} aria-hidden="true" /><b>角色出入场动画</b>首次出现、退出和强调</span>
          <span><ArrowLeftRight size={15} aria-hidden="true" /><b>立绘替换过场</b>同角色换装或表情切换</span>
        </div>
      </section>

      <CharacterAnimationControls
        value={animationConfig}
        visible={command.visible}
        targetLabel={`${command.character_id || "角色"} 立绘`}
        onChange={(animation_config) => onChange({ ...command, animation_config })}
      />

      <VisualTransitionControls
        value={command.switch_transition}
        targetLabel="立绘替换过场"
        disabled={!command.visible}
        disabledReason={replacementDisabledReason}
        contextHint={replacementContextHint(command)}
        onChange={(switch_transition) => onChange({ ...command, switch_transition })}
      />

      <details className="background-legacy-transition sprite-legacy-animation">
        <summary>
          <span>旧版立绘动画字段兼容</span>
          <small>仅用于旧项目和自定义动画代码；角色动画精细设置优先生效</small>
        </summary>
        <div className="background-legacy-transition-fields">
          <label>
            旧版立绘动画 <FieldHelp field="animation" />
            <LocalizedValueSelect
              value={command.animation ?? ""}
              options={spriteAnimationOptions}
              emptyLabel="不使用动画"
              helpKey="command.sprite.animation"
              customPlaceholder="填写自定义动画代码"
              onChange={(animation) => onChange({ ...command, animation: animation || null })}
            />
          </label>
          <label>
            旧版动画代称 <FieldHelp field="animation_display_name" />
            <input
              value={command.animation_display_name ?? ""}
              placeholder="例如：左滑入场、轻推退场"
              onChange={(event) => onChange({ ...command, animation_display_name: event.target.value || null })}
            />
          </label>
        </div>
      </details>
    </div>
  );
}
