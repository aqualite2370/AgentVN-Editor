import {
  Check,
  Clock3,
  MoveHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type {
  CharacterAnimationDirection,
  CharacterAnimationKeyframe,
  CharacterAnimationKind,
  CharacterAnimationPhase,
  CharacterSpriteAnimationConfig,
} from "../../../../shared/animation/characterAnimation";
import {
  defaultCharacterAnimationConfig,
  keyframesForCharacterAnimation,
  SPRITE_FOCUS_BACKDROP_OPACITY,
  SPRITE_FOCUS_COMPANION_BRIGHTNESS,
  SPRITE_FOCUS_DURATION_MS,
  SPRITE_FOCUS_KEYFRAME_OFFSETS,
  SPRITE_FOCUS_PRESET_ID,
  spriteFocusKeyframes,
} from "../../../../shared/animation/characterAnimation";
import { easingOptions } from "../../utils/localizedOptions";
import { RichSelect, type RichSelectOption } from "../common/RichSelect";

type NumericKey = "opacity" | "x" | "y" | "scale" | "rotate" | "blur" | "brightness";

const kindOptions: ReadonlyArray<RichSelectOption<CharacterAnimationKind>> = [
  { value: "none", label: "无" },
  { value: "fade", label: "淡入淡出" },
  { value: "move", label: "位移" },
  { value: "tween", label: "补间关键帧" },
  { value: "preset", label: "预设" },
];

const phaseOptions: ReadonlyArray<RichSelectOption<CharacterAnimationPhase>> = [
  { value: "enter", label: "出场" },
  { value: "exit", label: "退场" },
  { value: "emphasis", label: "强调" },
];

const directionOptions: ReadonlyArray<RichSelectOption<CharacterAnimationDirection>> = [
  { value: "left", label: "左" },
  { value: "right", label: "右" },
  { value: "up", label: "上" },
  { value: "down", label: "下" },
  { value: "center", label: "中心" },
  { value: "none", label: "无方向" },
];

const transformOriginOptions = [
  { value: "center center", label: "中心" },
  { value: "center bottom", label: "脚底中心" },
  { value: "left bottom", label: "左下" },
  { value: "right bottom", label: "右下" },
  { value: "50% 100%", label: "50% / 100%" },
] as const;

const propertyTracks: Array<{ key: NumericKey; label: string; unit?: string }> = [
  { key: "opacity", label: "透明度" },
  { key: "x", label: "X", unit: "px" },
  { key: "y", label: "Y", unit: "px" },
  { key: "scale", label: "缩放" },
  { key: "rotate", label: "旋转", unit: "deg" },
  { key: "blur", label: "模糊", unit: "px" },
  { key: "brightness", label: "亮度" },
];

const fallbackTweenKeyframes: CharacterAnimationKeyframe[] = [
  { offset: 0, opacity: 0, x: -80, y: 0, scale: 0.98, easing: "ease-out" },
  { offset: 1, opacity: 1, x: 0, y: 0, scale: 1 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeKeyframes(input: CharacterAnimationKeyframe[] | undefined): CharacterAnimationKeyframe[] {
  const source = input?.length ? input : fallbackTweenKeyframes;
  const frames = source
    .map((frame) => {
      const next: CharacterAnimationKeyframe = { offset: round(clamp(Number(frame.offset), 0, 1)) };
      for (const key of propertyTracks.map((track) => track.key)) {
        if (finite(frame[key])) next[key] = frame[key];
      }
      if (typeof frame.easing === "string" && frame.easing.trim()) next.easing = frame.easing.trim();
      return next;
    })
    .sort((left, right) => left.offset - right.offset);

  if (frames.length === 0) return fallbackTweenKeyframes.map((frame) => ({ ...frame }));
  if (frames.length === 1) {
    return [
      { ...frames[0], offset: 0 },
      { ...frames[0], offset: 1 },
    ];
  }
  return frames.map((frame, index) => {
    if (index === 0) return { ...frame, offset: 0 };
    if (index === frames.length - 1) return { ...frame, offset: 1 };
    return frame;
  });
}

function normalizeConfig(value: CharacterSpriteAnimationConfig | null | undefined, visible: boolean): CharacterSpriteAnimationConfig {
  const base = { ...defaultCharacterAnimationConfig(visible), ...value };
  const keyframes = normalizeKeyframes(value?.keyframes?.length ? value.keyframes : keyframesForCharacterAnimation(base));
  return {
    ...base,
    phase: value?.phase ?? (visible ? "enter" : "exit"),
    delay_ms: value?.delay_ms ?? 0,
    transform_origin: value?.transform_origin ?? "center bottom",
    keyframes,
  };
}

function keyframeToWaapi(frame: CharacterAnimationKeyframe): Keyframe {
  const transform = [
    frame.x !== undefined || frame.y !== undefined ? `translate3d(${frame.x ?? 0}px, ${frame.y ?? 0}px, 0)` : "",
    frame.scale !== undefined ? `scale(${frame.scale})` : "",
    frame.rotate !== undefined ? `rotate(${frame.rotate}deg)` : "",
  ].filter(Boolean).join(" ");
  const filter = [
    frame.blur !== undefined ? `blur(${frame.blur}px)` : "",
    frame.brightness !== undefined ? `brightness(${frame.brightness})` : "",
  ].filter(Boolean).join(" ");
  return {
    offset: frame.offset,
    opacity: frame.opacity,
    transform: transform || undefined,
    filter: filter || undefined,
    easing: frame.easing,
  };
}

function interpolateValue(left: number | undefined, right: number | undefined, ratio: number): number | undefined {
  if (left === undefined && right === undefined) return undefined;
  if (left === undefined) return right;
  if (right === undefined) return left;
  return round(left + (right - left) * ratio, 2);
}

function sampleKeyframeAt(frames: CharacterAnimationKeyframe[], offset: number, easing: string): CharacterAnimationKeyframe {
  const sorted = normalizeKeyframes(frames);
  const nextIndex = sorted.findIndex((frame) => frame.offset >= offset);
  if (nextIndex <= 0) return { ...sorted[0], offset, easing };
  if (nextIndex === -1) return { ...sorted[sorted.length - 1], offset, easing };
  const left = sorted[nextIndex - 1];
  const right = sorted[nextIndex];
  const span = Math.max(0.0001, right.offset - left.offset);
  const ratio = clamp((offset - left.offset) / span, 0, 1);
  const sampled: CharacterAnimationKeyframe = { offset, easing };
  for (const track of propertyTracks) {
    const value = interpolateValue(left[track.key], right[track.key], ratio);
    if (value !== undefined) sampled[track.key] = value;
  }
  return sampled;
}

function keyframeSummary(frame: CharacterAnimationKeyframe): string {
  const pieces = propertyTracks
    .filter((track) => frame[track.key] !== undefined)
    .map((track) => `${track.label} ${frame[track.key]}${track.unit ?? ""}`);
  return pieces.length ? pieces.slice(0, 3).join(" / ") : "仅记录时间点";
}

export function CharacterAnimationStudioDialog({
  value,
  visible = true,
  title = "立绘动效工作室",
  targetLabel = "角色立绘",
  onApply,
  onClose,
}: {
  value?: CharacterSpriteAnimationConfig | null;
  visible?: boolean;
  title?: string;
  targetLabel?: string;
  onApply: (value: CharacterSpriteAnimationConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CharacterSpriteAnimationConfig>(() => normalizeConfig(value, visible));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const previewTargetRef = useRef<HTMLDivElement | null>(null);
  const previewBackdropRef = useRef<HTMLDivElement | null>(null);
  const previewCompanionRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const focusBackdropAnimationRef = useRef<Animation | null>(null);
  const focusCompanionAnimationRef = useRef<Animation | null>(null);
  const frameRef = useRef<number | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  const keyframes = useMemo(() => normalizeKeyframes(draft.keyframes), [draft.keyframes]);
  const selectedFrame = keyframes[clamp(selectedIndex, 0, Math.max(0, keyframes.length - 1))] ?? keyframes[0];
  const disabled = draft.kind === "none";
  const duration = clamp(Number(draft.duration_ms ?? 520), 80, 10000);
  const delay = clamp(Number(draft.delay_ms ?? 0), 0, 10000);
  const easing = draft.easing || "ease-out";
  const transformOrigin = draft.transform_origin || "center bottom";
  const originOptions = useMemo(() => {
    if (transformOriginOptions.some((option) => option.value === transformOrigin)) return transformOriginOptions;
    return [...transformOriginOptions, { value: transformOrigin, label: transformOrigin }];
  }, [transformOrigin]);

  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  function cancelPreview() {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    animationRef.current?.cancel();
    animationRef.current = null;
    focusBackdropAnimationRef.current?.cancel();
    focusBackdropAnimationRef.current = null;
    focusCompanionAnimationRef.current?.cancel();
    focusCompanionAnimationRef.current = null;
    setIsPlaying(false);
  }

  function compiledKeyframes(): Keyframe[] {
    return keyframes.map(keyframeToWaapi);
  }

  function isSpriteFocusDraft(): boolean {
    return draft.kind === "preset" && draft.preset_id === SPRITE_FOCUS_PRESET_ID;
  }

  function animateFocusScene(options: KeyframeAnimationOptions, currentTime?: number): void {
    if (!isSpriteFocusDraft()) return;
    const backdrop = previewBackdropRef.current;
    const companion = previewCompanionRef.current;
    if (backdrop) {
      const animation = backdrop.animate([
        { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[0], opacity: 0 },
        { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[1], opacity: SPRITE_FOCUS_BACKDROP_OPACITY },
        { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[2], opacity: SPRITE_FOCUS_BACKDROP_OPACITY },
        { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[3], opacity: 0 },
      ], options);
      if (currentTime !== undefined) {
        animation.pause();
        animation.currentTime = currentTime;
      }
      focusBackdropAnimationRef.current = animation;
    }
    if (companion) {
      const animation = companion.animate([
        { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[0], filter: "brightness(1)" },
        { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[1], filter: `brightness(${SPRITE_FOCUS_COMPANION_BRIGHTNESS})` },
        { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[2], filter: `brightness(${SPRITE_FOCUS_COMPANION_BRIGHTNESS})` },
        { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[3], filter: "brightness(1)" },
      ], options);
      if (currentTime !== undefined) {
        animation.pause();
        animation.currentTime = currentTime;
      }
      focusCompanionAnimationRef.current = animation;
    }
  }

  function scrubPreview(progress: number) {
    const node = previewTargetRef.current;
    if (!node) return;
    animationRef.current?.cancel();
    node.style.transformOrigin = transformOrigin;
    const animation = node.animate(compiledKeyframes(), {
      duration,
      easing,
      fill: "both",
    });
    animation.pause();
    animation.currentTime = clamp(progress, 0, 1) * duration;
    animationRef.current = animation;
    animateFocusScene({ duration, easing, fill: "both" }, animation.currentTime ?? 0);
  }

  function tickPreview() {
    const animation = animationRef.current;
    if (!animation) return;
    const currentTime = Number(animation.currentTime ?? 0);
    setPlayhead(clamp((currentTime - delay) / duration, 0, 1));
    if (animation.playState === "running") {
      frameRef.current = window.requestAnimationFrame(tickPreview);
    }
  }

  function playPreview(restart = false) {
    const node = previewTargetRef.current;
    if (!node) return;
    cancelPreview();
    node.style.transformOrigin = transformOrigin;
    if (prefersReducedMotion()) {
      setPlayhead(0.5);
      animateFocusScene({ duration, easing, fill: "both" }, duration * 0.5);
      return;
    }
    const animation = node.animate(compiledKeyframes(), {
      duration,
      delay,
      easing,
      fill: "both",
    });
    animationRef.current = animation;
    animateFocusScene({ duration, delay, easing, fill: "both" });
    setIsPlaying(true);
    if (restart) setPlayhead(0);
    animation.onfinish = () => {
      setIsPlaying(false);
      setPlayhead(1);
    };
    frameRef.current = window.requestAnimationFrame(tickPreview);
  }

  function pausePreview() {
    animationRef.current?.pause();
    setIsPlaying(false);
  }

  function setConfig(patch: Partial<CharacterSpriteAnimationConfig>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function commitKeyframes(nextFrames: CharacterAnimationKeyframe[], nextSelectedIndex = selectedIndex) {
    const normalized = normalizeKeyframes(nextFrames);
    setDraft((current) => ({ ...current, kind: "tween", keyframes: normalized }));
    setSelectedIndex(clamp(nextSelectedIndex, 0, normalized.length - 1));
  }

  function updateSelectedKeyframe(patch: Partial<CharacterAnimationKeyframe>, clearKeys: NumericKey[] = []) {
    const next = keyframes.map((frame, index) => {
      if (index !== selectedIndex) return frame;
      const updated: CharacterAnimationKeyframe = { ...frame, ...patch };
      for (const key of clearKeys) delete updated[key];
      return updated;
    });
    commitKeyframes(next);
  }

  function addKeyframeAtPlayhead() {
    const offset = round(clamp(playhead, 0.02, 0.98));
    const existingIndex = keyframes.findIndex((frame) => Math.abs(frame.offset - offset) < 0.01);
    if (existingIndex >= 0) {
      setSelectedIndex(existingIndex);
      return;
    }
    const frame = sampleKeyframeAt(keyframes, offset, easing);
    const next = [...keyframes, frame].sort((left, right) => left.offset - right.offset);
    commitKeyframes(next, next.findIndex((item) => item === frame));
  }

  function deleteSelectedKeyframe() {
    if (selectedIndex <= 0 || selectedIndex >= keyframes.length - 1) return;
    commitKeyframes(keyframes.filter((_, index) => index !== selectedIndex), selectedIndex - 1);
  }

  function progressFromPointer(event: PointerEvent | ReactPointerEvent): number {
    const rail = railRef.current;
    if (!rail) return playhead;
    const rect = rail.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
  }

  function scrubFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const next = round(progressFromPointer(event));
    cancelPreview();
    setPlayhead(next);
    scrubPreview(next);
  }

  function startPlayheadDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    scrubFromPointer(event);
    const onMove = (moveEvent: PointerEvent) => {
      const next = round(progressFromPointer(moveEvent));
      setPlayhead(next);
      scrubPreview(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startKeyframeDrag(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedIndex(index);
    if (index === 0 || index === keyframes.length - 1) return;
    cancelPreview();
    const onMove = (moveEvent: PointerEvent) => {
      const min = keyframes[index - 1].offset + 0.01;
      const max = keyframes[index + 1].offset - 0.01;
      const nextOffset = round(clamp(progressFromPointer(moveEvent), min, max));
      const next = keyframes.map((frame, frameIndex) => frameIndex === index ? { ...frame, offset: nextOffset } : frame);
      setPlayhead(nextOffset);
      setDraft((current) => ({ ...current, kind: "tween", keyframes: normalizeKeyframes(next) }));
      scrubPreview(nextOffset);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function applyTemplate(template: "slide-in" | "breath" | "fade-out" | "shake" | "focus") {
    if (template === "slide-in") {
      setDraft({
        ...draft,
        kind: "tween",
        phase: "enter",
        duration_ms: 620,
        easing: "cubic-bezier(.2,.8,.2,1)",
        direction: "left",
        display_name: "左侧柔滑入场",
        keyframes: normalizeKeyframes([
          { offset: 0, opacity: 0, x: -120, y: 0, scale: 0.98, easing: "cubic-bezier(.2,.8,.2,1)" },
          { offset: 1, opacity: 1, x: 0, y: 0, scale: 1 },
        ]),
      });
    }
    if (template === "breath") {
      setDraft({
        ...draft,
        kind: "tween",
        phase: "emphasis",
        duration_ms: 760,
        easing: "ease-in-out",
        display_name: "轻微呼吸强调",
        keyframes: normalizeKeyframes([
          { offset: 0, opacity: 1, scale: 1, y: 0, easing: "ease-in-out" },
          { offset: 0.5, opacity: 1, scale: 1.045, y: -8, easing: "ease-in-out" },
          { offset: 1, opacity: 1, scale: 1, y: 0 },
        ]),
      });
    }
    if (template === "fade-out") {
      setDraft({
        ...draft,
        kind: "tween",
        phase: "exit",
        duration_ms: 460,
        easing: "ease-in",
        display_name: "退场淡出",
        keyframes: normalizeKeyframes([
          { offset: 0, opacity: 1, x: 0, y: 0, scale: 1, easing: "ease-in" },
          { offset: 1, opacity: 0, x: 42, y: 0, scale: 0.98 },
        ]),
      });
    }
    if (template === "shake") {
      setDraft({
        ...draft,
        kind: "tween",
        phase: "emphasis",
        duration_ms: 420,
        easing: "linear",
        display_name: "紧张抖动",
        keyframes: normalizeKeyframes([
          { offset: 0, x: 0, rotate: 0, easing: "linear" },
          { offset: 0.24, x: -14, rotate: -1, easing: "linear" },
          { offset: 0.52, x: 12, rotate: 1, easing: "linear" },
          { offset: 0.78, x: -6, rotate: -0.5, easing: "linear" },
          { offset: 1, x: 0, rotate: 0 },
        ]),
      });
    }
    if (template === "focus") {
      setDraft({
        ...draft,
        kind: "preset",
        phase: "emphasis",
        duration_ms: SPRITE_FOCUS_DURATION_MS,
        delay_ms: 0,
        easing: "ease-in-out",
        direction: "center",
        transform_origin: "center bottom",
        blocking: false,
        display_name: "心理聚焦",
        preset_id: SPRITE_FOCUS_PRESET_ID,
        keyframes: spriteFocusKeyframes(),
      });
    }
    setSelectedIndex(0);
    setPlayhead(0);
  }

  useEffect(() => {
    dialogRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      cancelPreview();
    };
  }, [onClose]);

  useEffect(() => {
    setSelectedIndex((current) => clamp(current, 0, Math.max(0, keyframes.length - 1)));
    if (!isPlaying) scrubPreview(playhead);
  }, [draft.duration_ms, draft.easing, draft.transform_origin, draft.keyframes, isPlaying, keyframes.length, playhead]);

  return createPortal(
    <div className="character-animation-studio-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="character-animation-studio-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="character-animation-studio-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="character-animation-studio-header">
          <div>
            <span className="studio-kicker">
              <Sparkles size={14} />
              Adobe 式补间 V1
            </span>
            <h3 id="character-animation-studio-title">{title}</h3>
            <p>{targetLabel} 的入场、退场和强调动作可以在这里用关键帧直接调整。</p>
          </div>
          <button type="button" className="studio-icon-button" aria-label="关闭动效工作室" data-help-key="animation.studioCancel" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="character-animation-studio-body">
          <aside className="studio-panel studio-params-panel">
            <header>
              <SlidersHorizontal size={16} />
              <strong>动画参数</strong>
            </header>
            <div className="studio-field-grid">
              <label>
                类型
                <RichSelect value={draft.kind} options={kindOptions} helpKey="command.sprite.animationConfig.kind" onChange={(kind) => setConfig({ kind })} />
              </label>
              <label>
                阶段
                <RichSelect value={draft.phase} options={phaseOptions} disabled={disabled} helpKey="command.sprite.animationConfig.phase" onChange={(phase) => setConfig({ phase })} />
              </label>
              <label>
                方向
                <RichSelect value={draft.direction ?? "center"} options={directionOptions} disabled={disabled || draft.kind === "fade"} helpKey="command.sprite.animationConfig.direction" onChange={(direction) => setConfig({ direction })} />
              </label>
              <label>
                时长 ms
                <input type="number" min={80} max={10000} step={20} value={duration} disabled={disabled} data-help-key="command.sprite.animationConfig.duration" onChange={(event) => setConfig({ duration_ms: Number(event.target.value) })} />
              </label>
              <label>
                延迟 ms
                <input type="number" min={0} max={10000} step={20} value={delay} disabled={disabled} data-help-key="command.sprite.animationConfig.delay" onChange={(event) => setConfig({ delay_ms: Number(event.target.value) })} />
              </label>
              <label>
                全局缓动
                <RichSelect value={easing} options={easingOptions} disabled={disabled} helpKey="command.sprite.animationConfig.easing" onChange={(nextEasing) => setConfig({ easing: nextEasing })} />
              </label>
              <label>
                锚点
                <RichSelect value={transformOrigin} options={originOptions} disabled={disabled} helpKey="command.sprite.animationConfig.origin" onChange={(origin) => setConfig({ transform_origin: origin })} />
              </label>
              <label>
                显示名
                <input value={draft.display_name ?? ""} disabled={disabled} data-help-key="command.sprite.animationConfig.displayName" onChange={(event) => setConfig({ display_name: event.target.value || null })} />
              </label>
              <label className="check-row studio-blocking-row">
                <input type="checkbox" checked={draft.blocking === true} disabled={disabled} data-help-key="command.sprite.animationConfig.blocking" onChange={(event) => setConfig({ blocking: event.target.checked })} />
                等待动画结束
              </label>
            </div>
            <div className="studio-template-grid" aria-label="快速模板">
              <button type="button" data-template-id="slide-in" data-help-key="command.sprite.animationConfig.kind" onClick={() => applyTemplate("slide-in")}>柔滑入场</button>
              <button type="button" data-template-id="breath" data-help-key="command.sprite.animationConfig.kind" onClick={() => applyTemplate("breath")}>呼吸强调</button>
              <button type="button" data-template-id="fade-out" data-help-key="command.sprite.animationConfig.kind" onClick={() => applyTemplate("fade-out")}>退场淡出</button>
              <button type="button" data-template-id="shake" data-help-key="command.sprite.animationConfig.kind" onClick={() => applyTemplate("shake")}>紧张抖动</button>
              <button type="button" data-template-id="focus" data-help-key="animation.spriteFocus" onClick={() => applyTemplate("focus")}>心理聚焦</button>
            </div>
          </aside>

          <section className="studio-panel studio-preview-panel">
            <header>
              <MoveHorizontal size={16} />
              <strong>实时预览</strong>
              <small>{Math.round(playhead * 100)}%</small>
            </header>
            <div className="studio-preview-stage">
              {isSpriteFocusDraft() && <div className="studio-preview-focus-backdrop" ref={previewBackdropRef} aria-hidden="true" />}
              <div className="studio-preview-floor" />
              {isSpriteFocusDraft() && (
                <div className="studio-preview-companion" ref={previewCompanionRef} aria-hidden="true">
                  <span>陪衬角色</span>
                </div>
              )}
              <div className="studio-preview-target" ref={previewTargetRef}>
                <span>{targetLabel}</span>
              </div>
            </div>
            <div className="studio-preview-controls">
              <button type="button" data-help-key="animation.preview" onClick={() => playPreview(false)} disabled={disabled || isPlaying}>
                <Play size={15} />
                播放
              </button>
              <button type="button" data-help-key="animation.preview" onClick={pausePreview} disabled={!isPlaying}>
                <Pause size={15} />
                暂停
              </button>
              <button type="button" data-help-key="animation.preview" onClick={() => playPreview(true)} disabled={disabled}>
                <RotateCcw size={15} />
                重播
              </button>
            </div>
          </section>

          <aside className="studio-panel studio-inspector-panel">
            <header>
              <Clock3 size={16} />
              <strong>关键帧检查器</strong>
              <small>{selectedIndex + 1}/{keyframes.length}</small>
            </header>
            <div className="studio-keyframe-summary">
              <strong>{Math.round(selectedFrame.offset * duration)} ms</strong>
              <span>{keyframeSummary(selectedFrame)}</span>
            </div>
            <div className="studio-field-grid">
              <label>
                进度
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedFrame.offset}
                  disabled={selectedIndex === 0 || selectedIndex === keyframes.length - 1}
                  data-help-key="animation.keyframeOffset"
                  onChange={(event) => updateSelectedKeyframe({ offset: round(clamp(Number(event.target.value), 0, 1)) })}
                />
              </label>
              <label>
                段缓动
                <RichSelect value={selectedFrame.easing ?? easing} options={easingOptions} helpKey="animation.keyframeEasing" onChange={(nextEasing) => updateSelectedKeyframe({ easing: nextEasing })} />
              </label>
              {propertyTracks.map((track) => (
                <label key={track.key}>
                  {track.label}{track.unit ? ` ${track.unit}` : ""}
                  <input
                    type="number"
                    step={track.key === "scale" || track.key === "brightness" || track.key === "opacity" ? 0.05 : 1}
                    min={track.key === "opacity" ? 0 : undefined}
                    max={track.key === "opacity" ? 1 : undefined}
                    value={selectedFrame[track.key] ?? ""}
                    placeholder="自动"
                    data-help-key={`animation.keyframe${track.key.charAt(0).toUpperCase()}${track.key.slice(1)}`}
                    onChange={(event) => {
                      const next = readNumber(event.target.value);
                      updateSelectedKeyframe(next === undefined ? {} : { [track.key]: next }, next === undefined ? [track.key] : []);
                    }}
                  />
                </label>
              ))}
            </div>
            <button type="button" className="studio-delete-keyframe" disabled={selectedIndex === 0 || selectedIndex === keyframes.length - 1} data-help-key="animation.deleteKeyframe" onClick={deleteSelectedKeyframe}>
              <Trash2 size={15} />
              删除当前关键帧
            </button>
          </aside>
        </div>

        <section className="studio-timeline-panel" aria-label="补间时间轴">
          <header>
            <div>
              <strong>补间时间轴</strong>
              <span>首尾关键帧已锁定，中间关键帧可拖拽调时。</span>
            </div>
            <button type="button" data-help-key="animation.addKeyframe" onClick={addKeyframeAtPlayhead}>
              <Plus size={15} />
              按播放头插入
            </button>
          </header>
          <div className="studio-ruler">
            {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
              <span key={tick} style={{ left: `${tick * 100}%` }}>{Math.round(tick * duration)}ms</span>
            ))}
          </div>
          <div className="studio-main-track" ref={railRef} onPointerDown={startPlayheadDrag}>
            <span className="studio-playhead" style={{ left: `${playhead * 100}%` }} />
            {keyframes.map((frame, index) => (
              <button
                key={`${frame.offset}-${index}`}
                type="button"
                className={`studio-keyframe-diamond${index === selectedIndex ? " is-selected" : ""}${index === 0 || index === keyframes.length - 1 ? " is-locked" : ""}`}
                style={{ left: `${frame.offset * 100}%` }}
                aria-label={`关键帧 ${index + 1}`}
                data-help-key="animation.keyframeOffset"
                onPointerDown={(event) => startKeyframeDrag(event, index)}
                onClick={() => setSelectedIndex(index)}
              >
                <span />
              </button>
            ))}
          </div>
          <div className="studio-property-tracks">
            {propertyTracks.map((track) => (
              <div className="studio-property-track" key={track.key}>
                <span>{track.label}</span>
                <div>
                  {keyframes.map((frame, index) => frame[track.key] !== undefined && (
                    <button
                      key={`${track.key}-${index}`}
                      type="button"
                      className={`studio-property-dot${index === selectedIndex ? " is-selected" : ""}`}
                      style={{ left: `${frame.offset * 100}%` }}
                      data-help-key={`animation.keyframe${track.key.charAt(0).toUpperCase()}${track.key.slice(1)}`}
                      onClick={() => setSelectedIndex(index)}
                      aria-label={`${track.label} 关键帧 ${index + 1}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="character-animation-studio-footer">
          <span>
            <Check size={14} />
            应用后写回当前工作台配置，取消不会改动命令。
          </span>
          <div>
            <button type="button" data-help-key="animation.studioCancel" onClick={onClose}>取消</button>
            <button
              type="button"
              className="studio-apply-button"
              data-help-key="animation.studioApply"
              onClick={() => onApply({ ...draft, keyframes: normalizeKeyframes(draft.keyframes) })}
            >
              应用到工作台
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
