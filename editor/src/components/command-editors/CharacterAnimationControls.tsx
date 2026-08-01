import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { CharacterSpriteAnimationConfig } from "../../../../shared/animation/characterAnimation";
import { defaultCharacterAnimationConfig } from "../../../../shared/animation/characterAnimation";
import { easingOptions } from "../../utils/localizedOptions";
import { RichSelect } from "../common/RichSelect";
import { CharacterAnimationStudioDialog } from "./CharacterAnimationStudioDialog";

const kindOptions = [
  { value: "none", label: "无" },
  { value: "fade", label: "淡入淡出" },
  { value: "move", label: "位移" },
  { value: "tween", label: "补间关键帧" },
  { value: "preset", label: "预设" },
] as const;

const phaseOptions = [
  { value: "enter", label: "出场" },
  { value: "exit", label: "退场" },
  { value: "emphasis", label: "强调" },
] as const;

const directionOptions = [
  { value: "left", label: "左" },
  { value: "right", label: "右" },
  { value: "up", label: "上" },
  { value: "down", label: "下" },
  { value: "center", label: "中心" },
  { value: "none", label: "无方向" },
] as const;

function withDefaults(config: CharacterSpriteAnimationConfig | null | undefined, visible: boolean): CharacterSpriteAnimationConfig {
  return {
    ...defaultCharacterAnimationConfig(visible),
    ...config,
    phase: config?.phase ?? (visible ? "enter" : "exit"),
  };
}

function animationSummary(config: CharacterSpriteAnimationConfig): string {
  if (config.kind === "none") return "不播放立绘动画";
  const parts = [
    config.kind === "tween" ? "补间" : config.kind === "move" ? "位移" : config.kind === "fade" ? "淡入淡出" : "预设",
    config.phase === "enter" ? "出场" : config.phase === "exit" ? "退场" : "强调",
    `${config.duration_ms ?? 520}ms`,
  ];
  if (config.delay_ms) parts.push(`延迟 ${config.delay_ms}ms`);
  if (config.keyframes?.length) parts.push(`${config.keyframes.length} 帧`);
  return parts.join(" / ");
}

export function CharacterAnimationControls({
  value,
  visible = true,
  compact = false,
  studioTitle = "立绘动效工作室",
  targetLabel = "角色立绘",
  onChange,
}: {
  value?: CharacterSpriteAnimationConfig | null;
  visible?: boolean;
  compact?: boolean;
  studioTitle?: string;
  targetLabel?: string;
  onChange: (value: CharacterSpriteAnimationConfig | null) => void;
}) {
  const [studioOpen, setStudioOpen] = useState(false);
  const config = withDefaults(value, visible);
  const disabled = config.kind === "none";

  function update(patch: Partial<CharacterSpriteAnimationConfig>) {
    const next = { ...config, ...patch };
    onChange(next.kind === "none" ? { ...next, blocking: false } : next);
  }

  return (
    <fieldset className={`character-animation-controls${compact ? " is-compact" : ""}`} data-help-key="command.sprite.animationConfig">
      <legend>角色动画</legend>
      <div className="character-animation-summary">
        <div>
          <strong>{config.display_name || "未命名立绘动画"}</strong>
          <span>{animationSummary(config)}</span>
        </div>
        <button type="button" className="character-animation-studio-launch" data-help-key="animation.openStudio" onClick={() => setStudioOpen(true)}>
          <SlidersHorizontal size={15} />
          打开动效工作室
        </button>
      </div>
      <div className="character-animation-grid">
        <label>
          类型
          <RichSelect value={config.kind} options={kindOptions} helpKey="command.sprite.animationConfig.kind" onChange={(nextKind) => update({ kind: nextKind as CharacterSpriteAnimationConfig["kind"] })} />
        </label>
        <label>
          阶段
          <RichSelect value={config.phase} options={phaseOptions} disabled={disabled} helpKey="command.sprite.animationConfig.phase" onChange={(nextPhase) => update({ phase: nextPhase as CharacterSpriteAnimationConfig["phase"] })} />
        </label>
        <label>
          方向
          <RichSelect value={config.direction ?? "center"} options={directionOptions} disabled={disabled || config.kind === "fade"} helpKey="command.sprite.animationConfig.direction" onChange={(nextDirection) => update({ direction: nextDirection as CharacterSpriteAnimationConfig["direction"] })} />
        </label>
        <label>
          时长 ms
          <input
            type="number"
            data-help-key="command.sprite.animationConfig.duration"
            min={80}
            max={10000}
            step={20}
            value={config.duration_ms ?? 520}
            disabled={disabled}
            onChange={(event) => update({ duration_ms: Number(event.target.value) })}
          />
        </label>
        <label>
          缓动
          <RichSelect value={config.easing ?? "ease-out"} options={easingOptions} disabled={disabled} helpKey="command.sprite.animationConfig.easing" onChange={(nextEasing) => update({ easing: nextEasing })} />
        </label>
        <label>
          延迟 ms
          <input
            type="number"
            data-help-key="command.sprite.animationConfig.delay"
            min={0}
            max={10000}
            step={20}
            value={config.delay_ms ?? 0}
            disabled={disabled}
            onChange={(event) => update({ delay_ms: Number(event.target.value) })}
          />
        </label>
        <label>
          显示名
          <input data-help-key="command.sprite.animationConfig.displayName" value={config.display_name ?? ""} disabled={disabled} onChange={(event) => update({ display_name: event.target.value || null })} />
        </label>
        {config.kind === "preset" && (
          <label>
            预设 ID
            <input data-help-key="command.sprite.animationConfig.presetId" value={config.preset_id ?? ""} onChange={(event) => update({ preset_id: event.target.value || null })} />
          </label>
        )}
        <label className="check-row character-animation-blocking">
          <input type="checkbox" data-help-key="command.sprite.animationConfig.blocking" checked={config.blocking === true} disabled={disabled} onChange={(event) => update({ blocking: event.target.checked })} />
          等待动画结束
        </label>
      </div>
      {studioOpen && (
        <CharacterAnimationStudioDialog
          value={config}
          visible={visible}
          title={studioTitle}
          targetLabel={targetLabel}
          onClose={() => setStudioOpen(false)}
          onApply={(next) => {
            onChange(next);
            setStudioOpen(false);
          }}
        />
      )}
    </fieldset>
  );
}
