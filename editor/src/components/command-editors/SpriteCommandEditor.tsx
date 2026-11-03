import { Move3d } from "lucide-react";
import { useState } from "react";
import { defaultCharacterAnimationConfig, legacySpriteAnimationToConfig } from "../../../../shared/animation/characterAnimation";
import { MAX_SPRITE_LAYER, MIN_SPRITE_LAYER } from "../../../../shared/cartridge/spriteLayer";
import { sanitizeSpriteOffsetX, sanitizeSpriteOffsetY } from "../../../../shared/cartridge/spritePlacement";
import { DEFAULT_SPRITE_SCALE, sanitizeSpriteScale, spriteScalePercent } from "../../../../shared/cartridge/spriteScale";
import type { GameCommand, SpriteCommand } from "../../types/commands";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { applySpritePlacementToCommand, applySpritePlacementToNodes } from "../../utils/spritePlacementApply";
import { spriteAnimationOptions, spritePositionOptions } from "../../utils/localizedOptions";
import { AssetPicker } from "../common/AssetPicker";
import { FieldHelp } from "../common/FieldHelp";
import { LocalizedValueSelect } from "../common/LocalizedValueSelect";
import { CharacterAnimationControls } from "./CharacterAnimationControls";
import { SpritePlacementStudioDialog } from "./SpritePlacementStudioDialog";
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
  commands = [command],
  commandIndex = 0,
  sceneId = "",
  sceneTitle,
  onChange,
}: {
  command: SpriteCommand;
  commands?: GameCommand[];
  commandIndex?: number;
  sceneId?: string;
  sceneTitle?: string;
  onChange: (command: SpriteCommand) => void;
}) {
  const [placementOpen, setPlacementOpen] = useState(false);
  const nodes = useEditorStore((state) => state.nodes);
  const setNodes = useEditorStore((state) => state.setNodes);
  const setNotice = useEditorStore((state) => state.setNotice);
  const projectSettings = useProjectStore((state) => state.settings);
  const setCharacterSpriteLayout = useProjectStore((state) => state.setCharacterSpriteLayout);
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
      <section className="sprite-placement-summary" aria-label="立绘位置与缩放">
        <div>
          <strong>立绘位置与缩放</strong>
          <span>
            {command.position || "继承位置"} · X {sanitizeSpriteOffsetX(command.offset_x).toFixed(1)}%
            {" · "}Y {sanitizeSpriteOffsetY(command.offset_y).toFixed(1)}%
            {" · "}{spriteScalePercent(sanitizeSpriteScale(command.scale, projectSettings.defaultSpriteScale ?? DEFAULT_SPRITE_SCALE))}
          </span>
        </div>
        <button type="button" data-help-key="command.sprite.placementStudio" onClick={() => setPlacementOpen(true)}>
          <Move3d size={16} />
          调整立绘
        </button>
      </section>
      <SpriteScaleControl
        characterId={command.character_id}
        value={command.scale}
        onChange={(scale) => onChange({ ...command, scale })}
      />
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
            <input data-help-key="editor.control"
              value={command.animation_display_name ?? ""}
              placeholder="例如：左滑入场、轻推退场"
              onChange={(event) => onChange({ ...command, animation_display_name: event.target.value || null })}
            />
          </label>
        </div>
      </details>
      {placementOpen && (
        <SpritePlacementStudioDialog
          command={command}
          commands={commands}
          commandIndex={commandIndex}
          sceneId={sceneId}
          sceneTitle={sceneTitle}
          onClose={() => setPlacementOpen(false)}
          onApply={(layout, scope) => {
            const result = sceneId
              ? applySpritePlacementToNodes(nodes, sceneId, command.character_id, layout, scope, projectSettings)
              : undefined;
            if (result && result.changedCommands > 0) {
              setNodes(result.nodes);
            } else {
              onChange(applySpritePlacementToCommand(command, layout));
            }
            if (scope === "character") {
              const ids = result?.matchingCharacterIds.length
                ? result.matchingCharacterIds
                : [command.character_id];
              ids.filter(Boolean).forEach((characterId) => setCharacterSpriteLayout(characterId, layout));
            }
            const targetLabel = result?.targetDisplayName || command.character_id || "当前角色";
            const changedCount = result?.changedCommands ?? 1;
            setNotice({
              message: scope === "character"
                ? `已应用到全部「${targetLabel}」立绘。`
                : `已应用到当前场景的「${targetLabel}」立绘。`,
              tone: "success",
              source: "立绘位置与缩放",
              detail: scope === "character"
                ? `更新 ${Math.max(1, changedCount)} 条命令，并保存为角色默认布局。`
                : `更新 ${Math.max(1, changedCount)} 条命令。`,
            });
            setPlacementOpen(false);
          }}
        />
      )}
    </div>
  );
}
