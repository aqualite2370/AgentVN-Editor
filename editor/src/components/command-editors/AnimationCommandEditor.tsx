import { useEffect, useMemo, useRef, useState } from "react";
import type { AnimationCommand } from "../../types/commands";
import { animationTargetOptions } from "../../utils/localizedOptions";
import { characterIdFromSpriteTarget, collectCharacterIdsFromNodes, spriteTargetForCharacter } from "../../utils/characterReferences";
import { useEditorStore } from "../../store/editorStore";
import { LocalizedValueSelect } from "../common/LocalizedValueSelect";
import { FieldHelp } from "../common/FieldHelp";
import { AssetPicker } from "../common/AssetPicker";
import { RichSelect } from "../common/RichSelect";
import { inspectEditorAnimationAsset } from "../../animation/animationAsset";
import type { AssetRef } from "../../types/assets";

export function AnimationCommandEditor({
  command,
  onChange,
}: {
  command: AnimationCommand;
  onChange: (command: AnimationCommand) => void;
}) {
  const nodes = useEditorStore((state) => state.nodes);
  const [assetError, setAssetError] = useState<string>();
  const [assetPending, setAssetPending] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    setAssetPending(false);
    setAssetError(undefined);
    return () => { ++generation.current; };
  }, [command]);
  async function selectAsset(assetId: string, asset?: AssetRef) {
    const owner = ++generation.current;
    setAssetError(undefined);
    if (!assetId) {
      setAssetPending(false);
      onChange({ ...command, animation_asset_id: undefined, animation_id: "custom", params: {} });
      return;
    }
    if (!asset) { setAssetError("找不到所选动画素材。"); return; }
    setAssetPending(true);
    try {
      await inspectEditorAnimationAsset(asset);
      if (generation.current !== owner) return;
      onChange({ ...command, animation_id: assetId, animation_asset_id: assetId, params: {} });
    } catch (error) {
      if (generation.current === owner) setAssetError(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation.current === owner) setAssetPending(false);
    }
  }
  const characterIds = useMemo(() => collectCharacterIdsFromNodes(nodes), [nodes]);
  const spriteTargetId = characterIdFromSpriteTarget(command.target);
  const isSpriteTarget = command.target.trim().toLowerCase().startsWith("sprite:");
  const targetOptions = ["selected", "all", ...characterIds];
  if (spriteTargetId && !targetOptions.includes(spriteTargetId)) targetOptions.push(spriteTargetId);

  return (
    <div className="form-grid">
      <AssetPicker
        label="演出动画素材"
        field="animation_asset_id"
        value={command.animation_asset_id ?? command.animation_id}
        allowedTypes={["animation"]}
        helpKey="command.animation.animationId"
        onChange={(assetId, asset) => void selectAsset(assetId, asset)}
      />
      {assetPending && <span role="status">正在检查动画素材…</span>}
      {assetError && <span role="alert">{assetError}</span>}
      {command.animation_asset_id && <small>当前使用素材文件；演出参数可覆盖素材值，留空对象则沿用素材。重新选素材会清除参数覆盖。</small>}
      <label>
        演出动画代称 <FieldHelp field="animation_display_name" />
        <input data-help-key="editor.control"
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
