import { useEffect, useState } from "react";
import {
  DEFAULT_SPRITE_SCALE,
  MAX_SPRITE_SCALE,
  MIN_SPRITE_SCALE,
  sanitizeSpriteScale,
  SPRITE_SCALE_STEP,
  spriteScalePercent,
} from "../../../../shared/cartridge/spriteScale";
import { useProjectStore } from "../../store/projectStore";
import { useEditorStore } from "../../store/editorStore";
import { applySpriteScaleByDisplayName } from "../../utils/spriteScaleApply";
import { RangeControl } from "../common/RangeControl";

interface SpriteScaleControlProps {
  characterId: string;
  value?: number | null;
  compact?: boolean;
  onChange: (scale: number | null) => void;
}

export function SpriteScaleControl({ characterId, value, compact, onChange }: SpriteScaleControlProps) {
  const defaultSpriteScale = useProjectStore((state) => state.settings.defaultSpriteScale ?? DEFAULT_SPRITE_SCALE);
  const projectSettings = useProjectStore((state) => state.settings);
  const setDefaultSpriteScale = useProjectStore((state) => state.setDefaultSpriteScale);
  const nodes = useEditorStore((state) => state.nodes);
  const setNodes = useEditorStore((state) => state.setNodes);
  const setNotice = useEditorStore((state) => state.setNotice);
  const hasLocalScale = value !== null && value !== undefined;
  const effectiveScale = sanitizeSpriteScale(hasLocalScale ? value : defaultSpriteScale, DEFAULT_SPRITE_SCALE);
  const [draftScale, setDraftScale] = useState(effectiveScale);
  const [scaleNotice, setScaleNotice] = useState<string | undefined>();

  useEffect(() => {
    setDraftScale(effectiveScale);
  }, [effectiveScale, hasLocalScale]);

  const updateDraft = (nextValue: number) => {
    const next = sanitizeSpriteScale(nextValue, DEFAULT_SPRITE_SCALE);
    setDraftScale(next);
    if (hasLocalScale) onChange(next);
  };

  const toggleLocalScale = (enabled: boolean) => {
    if (enabled) {
      onChange(draftScale);
      return;
    }
    onChange(null);
    setDraftScale(sanitizeSpriteScale(defaultSpriteScale, DEFAULT_SPRITE_SCALE));
  };

  const applyToAll = () => {
    const nextScale = sanitizeSpriteScale(draftScale, DEFAULT_SPRITE_SCALE);
    const result = applySpriteScaleByDisplayName(nodes, characterId, nextScale, projectSettings);
    setDefaultSpriteScale(nextScale);
    if (result.changedCommands > 0) setNodes(result.nodes);
    const targetLabel = result.targetDisplayName || "当前角色";
    const message = `已把 ${targetLabel} 的立绘缩放 ${spriteScalePercent(nextScale)} 应用到同名角色`;
    const detail = result.changedCommands > 0
      ? `已同步 ${result.changedCommands} 条立绘事件；后续新增立绘也会继承这个项目默认值。`
      : `当前项目没有需要同步的 ${targetLabel} 立绘事件；后续新增立绘会继承这个项目默认值。`;
    setScaleNotice(`${message}。${detail}`);
    setNotice({ message, tone: "success", source: "立绘缩放", detail });
  };

  return (
    <section className={`sprite-scale-control${compact ? " is-compact" : ""}`} aria-label="立绘等比缩放">
      <div className="sprite-scale-header">
        <div>
          <strong>立绘等比缩放</strong>
          <small>{hasLocalScale ? "当前命令单独设置" : `继承全局默认 ${spriteScalePercent(defaultSpriteScale)}`}</small>
        </div>
        <output aria-label="当前立绘缩放">{spriteScalePercent(draftScale)}</output>
      </div>
      <RangeControl
        value={draftScale}
        min={MIN_SPRITE_SCALE}
        max={MAX_SPRITE_SCALE}
        step={SPRITE_SCALE_STEP}
        ariaLabel="立绘等比缩放"
        helpKey="command.sprite.scale"
        onChange={updateDraft}
      />
      <div className="sprite-scale-actions">
        <label className="check-row">
          <input
            type="checkbox"
            checked={hasLocalScale}
            data-help-key="command.sprite.scaleMode"
            onChange={(event) => toggleLocalScale(event.target.checked)}
          />
          单独设置
        </label>
        <button type="button" data-help-key="command.sprite.scaleApplyAll" onClick={applyToAll}>
          应用到全体
        </button>
      </div>
      {scaleNotice && (
        <div className="sprite-scale-toast" role="status" aria-live="polite">
          <span>{scaleNotice}</span>
          <button type="button" data-help-key="command.sprite.scaleNotice.close" aria-label="关闭立绘缩放提示" onClick={() => setScaleNotice(undefined)}>×</button>
        </div>
      )}
    </section>
  );
}
