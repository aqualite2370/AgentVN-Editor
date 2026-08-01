import { RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DEFAULT_VISUAL_TRANSITION_CONFIG,
  MAX_VISUAL_TRANSITION_DURATION_MS,
  MIN_VISUAL_TRANSITION_DURATION_MS,
  normalizeVisualTransitionDuration,
  parseVisualTransitionEasing,
  resolveVisualTransition,
  type VisualTransitionConfig,
  type VisualTransitionKind,
} from "../../../../shared/animation/visualTransition";
import { RichSelect, type RichSelectOption } from "../common/RichSelect";

const transitionKindOptions: ReadonlyArray<RichSelectOption<VisualTransitionKind>> = [
  { value: "none", label: "瞬时切换", description: "不播放过渡，立即替换画面" },
  { value: "fade", label: "淡入", description: "新画面逐渐显现" },
  { value: "crossfade", label: "交叉淡化", description: "旧画面淡出，同时新画面淡入" },
  { value: "reveal_center", label: "中心展开", description: "从画面中心向两侧展开" },
  { value: "wipe_left_to_right", label: "从左向右擦除", description: "新画面由左向右覆盖" },
  { value: "wipe_right_to_left", label: "从右向左擦除", description: "新画面由右向左覆盖" },
  { value: "blur", label: "模糊过渡", description: "通过柔和失焦完成切换" },
  { value: "slide_left", label: "向左滑动", description: "画面向左滑动替换" },
  { value: "slide_right", label: "向右滑动", description: "画面向右滑动替换" },
  { value: "slide_up", label: "向上滑动", description: "画面向上滑动替换" },
  { value: "slide_down", label: "向下滑动", description: "画面向下滑动替换" },
];

type TransitionSource = "explicit" | "legacy" | "default";

function transitionSource(
  value: VisualTransitionConfig | null | undefined,
  legacyValue: string | null | undefined,
): TransitionSource {
  if (value !== null && value !== undefined) return "explicit";
  return resolveVisualTransition(undefined, legacyValue) ? "legacy" : "default";
}

export function VisualTransitionControls({
  value,
  legacyValue,
  targetLabel,
  disabled = false,
  disabledReason,
  contextHint,
  onChange,
}: {
  value?: VisualTransitionConfig | null;
  legacyValue?: string | null;
  targetLabel: string;
  disabled?: boolean;
  disabledReason?: string;
  contextHint?: string;
  onChange: (value: VisualTransitionConfig | null) => void;
}) {
  const resolved = resolveVisualTransition(value, legacyValue) ?? DEFAULT_VISUAL_TRANSITION_CONFIG;
  const source = transitionSource(value, legacyValue);
  const valueControlsDisabled = disabled || resolved.kind === "none";
  const [easingDraft, setEasingDraft] = useState<string>(resolved.easing);
  const [easingError, setEasingError] = useState("");

  useEffect(() => {
    setEasingDraft(resolved.easing);
    setEasingError("");
  }, [resolved.easing]);

  function commit(patch: Partial<VisualTransitionConfig>) {
    const kind = patch.kind ?? resolved.kind;
    const next: VisualTransitionConfig = {
      kind,
      duration_ms: normalizeVisualTransitionDuration(
        patch.duration_ms ?? resolved.duration_ms,
        kind,
      ),
      easing: patch.easing ?? resolved.easing,
    };
    onChange(next);
  }

  function updateEasing(nextDraft: string) {
    setEasingDraft(nextDraft);
    const parsed = parseVisualTransitionEasing(nextDraft);
    if (!parsed) {
      setEasingError("请输入 linear、ease、ease-in、ease-out、ease-in-out 或安全的 cubic-bezier(...)。");
      return;
    }
    setEasingError("");
    commit({ easing: parsed });
  }

  return (
    <fieldset
      className={`visual-transition-controls${disabled ? " is-disabled" : ""}`}
      data-testid="visual-transition-controls"
      data-transition-source={source}
      data-transition-disabled={disabled ? "true" : "false"}
      data-disabled-reason={disabledReason}
      aria-disabled={disabled}
    >
      <legend className="visual-transition-legend">
        <span className="visual-transition-icon" aria-hidden="true">
          <Sparkles size={15} />
        </span>
        <span>
          <strong>{targetLabel}</strong>
          <small>
            {source === "explicit"
              ? "当前事件的精细设置"
              : source === "legacy"
                ? "已兼容映射旧版过场；首次调整后写入精细设置"
                : "使用推荐默认值；首次调整后写入事件"}
          </small>
        </span>
        <span className={`visual-transition-source is-${source}`} data-testid="visual-transition-source">
          {source === "explicit" ? "已自定义" : source === "legacy" ? "旧版兼容" : "推荐默认"}
        </span>
      </legend>

      {contextHint && (
        <p className="visual-transition-context-hint" data-testid="visual-transition-context-hint">
          {contextHint}
        </p>
      )}

      <div className="visual-transition-grid">
        <label>
          过渡类型
          <RichSelect
            ariaLabel={`${targetLabel}过渡类型`}
            value={resolved.kind}
            options={transitionKindOptions}
            disabled={disabled}
            helpKey="command.visualTransition.kind"
            onChange={(kind) => commit({ kind })}
          />
        </label>

        <label>
          过渡时长
          <span className="visual-transition-input-with-unit">
            <input
              type="number"
              min={MIN_VISUAL_TRANSITION_DURATION_MS}
              max={MAX_VISUAL_TRANSITION_DURATION_MS}
              step={20}
              value={resolved.duration_ms}
              disabled={valueControlsDisabled}
              aria-label={`${targetLabel}过渡时长`}
              data-help-key="command.visualTransition.duration"
              data-testid="visual-transition-duration"
              onChange={(event) => commit({ duration_ms: Number(event.target.value) })}
            />
            <span aria-hidden="true">ms</span>
          </span>
        </label>

        <label>
          缓动曲线
          <input
            value={easingDraft}
            disabled={valueControlsDisabled}
            aria-label={`${targetLabel}缓动曲线`}
            aria-invalid={Boolean(easingError)}
            aria-describedby={easingError ? "visual-transition-easing-error" : undefined}
            data-help-key="command.visualTransition.easing"
            data-testid="visual-transition-easing"
            placeholder="例如 ease-in-out"
            onChange={(event) => updateEasing(event.target.value)}
          />
        </label>
      </div>

      {easingError && (
        <p
          id="visual-transition-easing-error"
          className="visual-transition-error"
          role="alert"
          data-testid="visual-transition-easing-error"
        >
          {easingError}
        </p>
      )}

      <div className="visual-transition-footer">
        <span>
          {disabled
            ? disabledReason || "当前状态不使用此替换过场。"
            : resolved.kind === "none"
              ? "瞬时切换不需要设置时长和缓动。"
              : "时长范围 80–10000ms，缓动值会经过安全校验。"}
        </span>
        <button
          type="button"
          className="visual-transition-reset"
          data-help-key="command.visualTransition.reset"
          data-testid="visual-transition-reset"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          <RotateCcw size={14} />
          重置精细设置
        </button>
      </div>
    </fieldset>
  );
}
