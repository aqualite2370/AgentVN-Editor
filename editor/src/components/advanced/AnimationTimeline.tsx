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
}: {
  keyframes: AnimationKeyframe[];
  onChange: (keyframes: AnimationKeyframe[]) => void;
  showExpertCss?: boolean;
}) {
  return (
    <section className="advanced-card compact animation-timeline-panel">
      <header className="animation-section-header">
        <div>
          <h3>高级关键帧</h3>
          <p>需要精修时，再调整时间点、位移、缩放和滤镜。CSS 只在专家模式中显示。</p>
        </div>
      </header>
      <div className="animation-keyframe-list">
        {keyframes.map((keyframe, index) => (
          <article className="timeline-row" key={`${keyframe.offset}-${index}`}>
            <header>
              <strong>关键帧 {index + 1}</strong>
              <button
                type="button"
                data-help-key="animation.deleteKeyframe"
                onClick={() => onChange(keyframes.filter((_, itemIndex) => itemIndex !== index))}
              >
                删除
              </button>
            </header>
            <div className="timeline-row-grid">
              <label>
                进度
                <input
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
                <input
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
                <input
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
                <input
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
                <input
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
                <input
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
                <input
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
                <input
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
                  placeholder="可选：补充 transform / filter 以外的样式；错误内容会被运行端忽略。"
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
        ))}
      </div>
      <button
        type="button"
        data-help-key="animation.addKeyframe"
        onClick={() => onChange([...keyframes, { offset: 1, opacity: 1, x: 0, y: 0, scale: 1 }])}
      >
        添加关键帧
      </button>
    </section>
  );
}
