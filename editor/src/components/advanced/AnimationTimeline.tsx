import { useState } from "react";
import { RichSelect } from "../common/RichSelect";
import { NumberInput } from "../common/NumberInput";
import type { AnimationKeyframe } from "../../animation/types";

function updateKeyframe(
  keyframes: AnimationKeyframe[],
  index: number,
  patch: Partial<AnimationKeyframe>,
  clearKeys: Array<keyof AnimationKeyframe> = [],
): AnimationKeyframe[] {
  return keyframes.map((item, itemIndex) => {
    if (itemIndex !== index) return item;
    const next: AnimationKeyframe = { ...item, ...patch };
    for (const key of clearKeys) delete next[key];
    return next;
  });
}

function readNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function AnimationTimeline({
  keyframes,
  onChange,
  showExpertCss = false,
  onToggleExpertCss,
}: {
  keyframes: AnimationKeyframe[];
  onChange: (keyframes: AnimationKeyframe[]) => void;
  showExpertCss?: boolean;
  onToggleExpertCss: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const index = Math.max(0, Math.min(activeIndex, keyframes.length - 1));
  const keyframe = keyframes[index];
  return (
    <section className="advanced-card compact animation-timeline-panel">
      <header className="animation-section-header">
        <h4>关键帧</h4>
        <div className="animation-keyframe-actions">
          <button type="button" aria-pressed={showExpertCss} data-help-key="animation.expertMode" onClick={onToggleExpertCss}>
            {showExpertCss ? "隐藏 CSS 入口" : "显示 CSS 入口"}
          </button>
          <button
            type="button"
            data-help-key="animation.addKeyframe"
            onClick={() => {
              setActiveIndex(keyframes.length);
              onChange([...keyframes, { offset: 1, opacity: 1, x: 0, y: 0, scale: 1 }]);
            }}
          >
            添加关键帧
          </button>
        </div>
      </header>
      {keyframe && (
        <article className="timeline-row">
          <header>
            <RichSelect
              value={String(index)}
              options={keyframes.map((frame, position) => ({
                value: String(position), label: `关键帧 ${position + 1} · ${Math.round(frame.offset * 100)}%`,
              }))}
              ariaLabel="选择要编辑的关键帧"
              onChange={value => setActiveIndex(Number(value))}
            />
            <button
              type="button"
              data-help-key="animation.deleteKeyframe"
              onClick={() => {
                setActiveIndex(Math.max(0, index - 1));
                onChange(keyframes.filter((_, itemIndex) => itemIndex !== index));
              }}
            >
              删除
            </button>
          </header>
          <div className="timeline-row-grid">
            <label>
              进度
              <NumberInput
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={keyframe.offset}
                data-help-key="animation.keyframeOffset"
                onChange={(event) => onChange(updateKeyframe(keyframes, index, { offset: Number(event.target.value) }))}
              />
            </label>
            <label>
              透明度
              <NumberInput emptyValue=""
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={keyframe.opacity ?? ""}
                placeholder="自动"
                data-help-key="animation.keyframeOpacity"
                onChange={(event) => {
                  const next = readNumber(event.target.value);
                  onChange(updateKeyframe(keyframes, index, next === undefined ? {} : { opacity: next }, next === undefined ? ["opacity"] : []));
                }}
              />
            </label>
            <label>
              横向位移
              <NumberInput emptyValue=""
                type="number"
                value={keyframe.x ?? ""}
                placeholder="0"
                data-help-key="animation.keyframeX"
                onChange={(event) => {
                  const next = readNumber(event.target.value);
                  onChange(updateKeyframe(keyframes, index, next === undefined ? {} : { x: next }, next === undefined ? ["x"] : []));
                }}
              />
            </label>
            <label>
              纵向位移
              <NumberInput emptyValue=""
                type="number"
                value={keyframe.y ?? ""}
                placeholder="0"
                data-help-key="animation.keyframeY"
                onChange={(event) => {
                  const next = readNumber(event.target.value);
                  onChange(updateKeyframe(keyframes, index, next === undefined ? {} : { y: next }, next === undefined ? ["y"] : []));
                }}
              />
            </label>
            <label>
              缩放
              <NumberInput emptyValue=""
                type="number"
                step="0.01"
                value={keyframe.scale ?? ""}
                placeholder="1"
                data-help-key="animation.keyframeScale"
                onChange={(event) => {
                  const next = readNumber(event.target.value);
                  onChange(updateKeyframe(keyframes, index, next === undefined ? {} : { scale: next }, next === undefined ? ["scale"] : []));
                }}
              />
            </label>
            <label>
              旋转
              <NumberInput emptyValue=""
                type="number"
                step="1"
                value={keyframe.rotate ?? ""}
                placeholder="0"
                data-help-key="animation.keyframeRotate"
                onChange={(event) => {
                  const next = readNumber(event.target.value);
                  onChange(updateKeyframe(keyframes, index, next === undefined ? {} : { rotate: next }, next === undefined ? ["rotate"] : []));
                }}
              />
            </label>
            <label>
              模糊
              <NumberInput emptyValue=""
                type="number"
                step="0.5"
                value={keyframe.blur ?? ""}
                placeholder="0"
                data-help-key="animation.keyframeBlur"
                onChange={(event) => {
                  const next = readNumber(event.target.value);
                  onChange(updateKeyframe(keyframes, index, next === undefined ? {} : { blur: next }, next === undefined ? ["blur"] : []));
                }}
              />
            </label>
            <label>
              亮度
              <NumberInput emptyValue=""
                type="number"
                step="0.05"
                value={keyframe.brightness ?? ""}
                placeholder="1"
                data-help-key="animation.keyframeBrightness"
                onChange={(event) => {
                  const next = readNumber(event.target.value);
                  onChange(updateKeyframe(keyframes, index, next === undefined ? {} : { brightness: next }, next === undefined ? ["brightness"] : []));
                }}
              />
            </label>
          </div>
          {showExpertCss && (
            <label className="timeline-row-textarea animation-expert-css">
              自定义 CSS（专家模式）
              <textarea
                rows={2}
                value={keyframe.custom_css ?? ""}
                placeholder="此字段随关键帧保留，当前预览不执行自定义 CSS。"
                data-help-key="animation.keyframeCustomCss"
                onChange={(event) =>
                  onChange(
                    updateKeyframe(
                      keyframes,
                      index,
                      event.target.value.trim() ? { custom_css: event.target.value } : {},
                      event.target.value.trim() ? [] : ["custom_css"],
                    ),
                  )
                }
              />
            </label>
          )}
        </article>
      )}
    </section>
  );
}
