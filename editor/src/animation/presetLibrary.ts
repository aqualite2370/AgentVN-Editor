import type { LucideIcon } from "lucide-react";
import { Aperture, Clapperboard, Focus, Image as ImageIcon, LogIn } from "lucide-react";
import { builtInAnimationPresets } from "./presets";
import type { AnimationKeyframe, AnimationPreset, AnimationTargetType } from "./types";

export type AnimationPresetCategoryId =
  | "sprite_enter"
  | "sprite_exit"
  | "sprite_emphasis"
  | "background_transition"
  | "camera_motion";

export type AnimationPresetControlKey = "duration_ms" | "intensity" | "direction" | "loop" | "softness";

export type AnimationPresetDirection = "left" | "right";

export interface AnimationPresetControlOption {
  label: string;
  value: string;
}

export interface AnimationPresetControlDefinition {
  key: AnimationPresetControlKey;
  label: string;
  type: "range" | "select" | "toggle";
  min?: number;
  max?: number;
  step?: number;
  options?: AnimationPresetControlOption[];
}

export interface AnimationPresetTweakValues {
  duration_ms: number;
  intensity: number;
  direction: AnimationPresetDirection;
  loop: boolean;
  softness: number;
}

export interface AnimationPresetCategory {
  id: AnimationPresetCategoryId;
  title: string;
  summary: string;
  icon: LucideIcon;
  targetType: AnimationTargetType;
}

export interface AnimationPresetTemplate {
  template_id: string;
  preset_id: string;
  category_id: AnimationPresetCategoryId;
  title: string;
  summary: string;
  target_type: AnimationTargetType;
  recommended_scene: string;
  controls: AnimationPresetControlDefinition[];
  defaults: AnimationPresetTweakValues;
  buildPreset: (values: AnimationPresetTweakValues) => AnimationPreset;
}

const presetMap = new Map(builtInAnimationPresets.map((preset) => [preset.preset_id, preset]));

export const animationPresetCategories: AnimationPresetCategory[] = [
  { id: "sprite_enter", title: "立绘入场", summary: "让角色自然进入画面。", icon: LogIn, targetType: "sprite" },
  { id: "sprite_exit", title: "立绘退场", summary: "快速收束角色存在感。", icon: Clapperboard, targetType: "sprite" },
  { id: "sprite_emphasis", title: "立绘强调", summary: "突出角色情绪和反应。", icon: Aperture, targetType: "sprite" },
  { id: "background_transition", title: "背景切换", summary: "营造场景气氛变化。", icon: ImageIcon, targetType: "background" },
  { id: "camera_motion", title: "镜头运动", summary: "增强镜头感和叙事节奏。", icon: Focus, targetType: "camera" },
];

const directionOptions: AnimationPresetControlOption[] = [
  { label: "从左", value: "left" },
  { label: "从右", value: "right" },
];

function cloneKeyframe(keyframe: AnimationKeyframe): AnimationKeyframe {
  return { ...keyframe };
}

function clonePreset(presetId: string): AnimationPreset {
  const preset = presetMap.get(presetId);
  if (!preset) throw new Error(`Unknown animation preset: ${presetId}`);
  return { ...preset, keyframes: preset.keyframes.map(cloneKeyframe) };
}

function scaleValue(value: number | undefined, multiplier: number): number | undefined {
  if (value === undefined) return undefined;
  return Number((value * multiplier).toFixed(2));
}

function adjustDuration(preset: AnimationPreset, duration_ms: number): AnimationPreset {
  preset.duration_ms = Math.max(120, Math.round(duration_ms));
  return preset;
}

function adjustLoop(preset: AnimationPreset, loop: boolean): AnimationPreset {
  preset.loop = loop;
  preset.direction = loop ? "alternate" : "normal";
  return preset;
}

function adjustSlideDirection(preset: AnimationPreset, direction: AnimationPresetDirection, intensity: number): AnimationPreset {
  const sign = direction === "left" ? -1 : 1;
  preset.keyframes = preset.keyframes.map((keyframe, index, all) => {
    if (index === all.length - 1) return { ...keyframe, x: 0 };
    const distance = Math.max(40, Math.round(120 * intensity));
    return { ...keyframe, x: sign * distance };
  });
  return preset;
}

function adjustSlideOutDirection(preset: AnimationPreset, direction: AnimationPresetDirection, intensity: number): AnimationPreset {
  const sign = direction === "left" ? -1 : 1;
  preset.keyframes = preset.keyframes.map((keyframe, index) => {
    if (index === 0) return { ...keyframe, x: 0 };
    const distance = Math.max(60, Math.round(140 * intensity));
    return { ...keyframe, x: sign * distance, opacity: 0 };
  });
  return preset;
}

function adjustScaleAmplitude(preset: AnimationPreset, intensity: number, baseScale = 1): AnimationPreset {
  preset.keyframes = preset.keyframes.map((keyframe) => {
    if (keyframe.scale === undefined) return keyframe;
    const delta = keyframe.scale - baseScale;
    return { ...keyframe, scale: Number((baseScale + delta * intensity).toFixed(3)) };
  });
  return preset;
}

function adjustOffsetAmplitude(preset: AnimationPreset, intensity: number): AnimationPreset {
  preset.keyframes = preset.keyframes.map((keyframe) => ({
    ...keyframe,
    x: scaleValue(keyframe.x, intensity),
    y: scaleValue(keyframe.y, intensity),
  }));
  return preset;
}

function adjustSoftness(preset: AnimationPreset, softness: number): AnimationPreset {
  const blurMultiplier = 0.6 + softness * 0.6;
  preset.keyframes = preset.keyframes.map((keyframe) => ({
    ...keyframe,
    blur: scaleValue(keyframe.blur, blurMultiplier),
    brightness:
      keyframe.brightness === undefined
        ? undefined
        : Number((1 + (keyframe.brightness - 1) * blurMultiplier).toFixed(3)),
  }));
  return preset;
}

function createPreset(
  presetId: string,
  mutator: (preset: AnimationPreset, values: AnimationPresetTweakValues) => AnimationPreset,
): (values: AnimationPresetTweakValues) => AnimationPreset {
  return (values) => mutator(clonePreset(presetId), values);
}

export const animationPresetTemplates: AnimationPresetTemplate[] = [
  {
    template_id: "sprite_fade_in",
    preset_id: "sprite_fade_in",
    category_id: "sprite_enter",
    title: "柔和淡入",
    summary: "最稳妥的角色出场方式。",
    target_type: "sprite",
    recommended_scene: "日常对话、普通切入、安静登场",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 180, max: 1400, step: 20 },
      { key: "intensity", label: "强度", type: "range", min: 0.6, max: 1.6, step: 0.05 },
    ],
    defaults: { duration_ms: 500, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("sprite_fade_in", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      preset.keyframes[0].opacity = Number(Math.max(0, 1 - values.intensity).toFixed(2));
      return preset;
    }),
  },
  {
    template_id: "sprite_slide_in",
    preset_id: "sprite_slide_in_left",
    category_id: "sprite_enter",
    title: "侧向滑入",
    summary: "更有存在感的角色入场。",
    target_type: "sprite",
    recommended_scene: "切换发言人、角色突然进入、镜头切换后接话",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 220, max: 1400, step: 20 },
      { key: "intensity", label: "强度", type: "range", min: 0.6, max: 1.8, step: 0.05 },
      { key: "direction", label: "方向", type: "select", options: directionOptions },
    ],
    defaults: { duration_ms: 560, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("sprite_slide_in_left", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      return adjustSlideDirection(preset, values.direction, values.intensity);
    }),
  },
  {
    template_id: "sprite_fade_out",
    preset_id: "sprite_fade_out",
    category_id: "sprite_exit",
    title: "柔和淡出",
    summary: "自然退场，不抢画面节奏。",
    target_type: "sprite",
    recommended_scene: "话题结束、角色退出、平稳转场",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 180, max: 1200, step: 20 },
      { key: "intensity", label: "强度", type: "range", min: 0.7, max: 1.6, step: 0.05 },
    ],
    defaults: { duration_ms: 420, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("sprite_fade_out", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      preset.keyframes[0].opacity = Number(Math.min(1, 0.65 + values.intensity * 0.35).toFixed(2));
      return preset;
    }),
  },
  {
    template_id: "sprite_slide_out",
    preset_id: "sprite_slide_out_left",
    category_id: "sprite_exit",
    title: "侧向滑出",
    summary: "更干脆地带角色离场。",
    target_type: "sprite",
    recommended_scene: "强节奏切换、快速让位、打断后退场",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 180, max: 1000, step: 20 },
      { key: "intensity", label: "强度", type: "range", min: 0.6, max: 1.8, step: 0.05 },
      { key: "direction", label: "方向", type: "select", options: directionOptions },
    ],
    defaults: { duration_ms: 460, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("sprite_slide_out_left", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      return adjustSlideOutDirection(preset, values.direction, values.intensity);
    }),
  },
  {
    template_id: "sprite_pop",
    preset_id: "sprite_pop",
    category_id: "sprite_emphasis",
    title: "轻微放大",
    summary: "一句重点台词就够用了。",
    target_type: "sprite",
    recommended_scene: "情绪抬高、强调、注意力聚焦",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 180, max: 1000, step: 20 },
      { key: "intensity", label: "强度", type: "range", min: 0.5, max: 1.8, step: 0.05 },
    ],
    defaults: { duration_ms: 420, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("sprite_pop", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      return adjustScaleAmplitude(preset, values.intensity, 1);
    }),
  },
  {
    template_id: "sprite_focus",
    preset_id: "sprite_focus",
    category_id: "sprite_emphasis",
    title: "心理聚焦",
    summary: "让背景与陪衬角色退暗，把注意力收束到目标角色。",
    target_type: "sprite",
    recommended_scene: "心理活动、内心独白、短暂失神与关键自省",
    controls: [],
    defaults: { duration_ms: 1400, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: () => clonePreset("sprite_focus"),
  },
  {
    template_id: "sprite_shake",
    preset_id: "sprite_shake",
    category_id: "sprite_emphasis",
    title: "抖动强调",
    summary: "让惊讶、愤怒和受击更有反应。",
    target_type: "sprite",
    recommended_scene: "爆点台词、打断、受击、惊吓",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 140, max: 880, step: 20 },
      { key: "intensity", label: "强度", type: "range", min: 0.5, max: 2, step: 0.05 },
    ],
    defaults: { duration_ms: 360, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("sprite_shake", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      return adjustOffsetAmplitude(preset, values.intensity);
    }),
  },
  {
    template_id: "sprite_heartbeat",
    preset_id: "sprite_heartbeat",
    category_id: "sprite_emphasis",
    title: "心跳缩放",
    summary: "让角色保持轻微情绪波动。",
    target_type: "sprite",
    recommended_scene: "暧昧、紧张、持续情绪压迫",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 300, max: 1800, step: 20 },
      { key: "intensity", label: "强度", type: "range", min: 0.5, max: 1.8, step: 0.05 },
      { key: "loop", label: "循环", type: "toggle" },
    ],
    defaults: { duration_ms: 780, intensity: 1, direction: "left", loop: true, softness: 1 },
    buildPreset: createPreset("sprite_heartbeat", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      adjustLoop(preset, values.loop);
      return adjustScaleAmplitude(preset, values.intensity, 1);
    }),
  },
  {
    template_id: "background_fade",
    preset_id: "background_fade",
    category_id: "background_transition",
    title: "背景淡入",
    summary: "最适合常规场景切换。",
    target_type: "background",
    recommended_scene: "地点切换、时间推移、柔和过场",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 200, max: 1600, step: 20 },
      { key: "softness", label: "柔和度", type: "range", min: 0.5, max: 1.6, step: 0.05 },
    ],
    defaults: { duration_ms: 620, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("background_fade", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      preset.easing = values.softness >= 1 ? "ease-out" : "ease-in-out";
      preset.keyframes[0].opacity = Number((0.2 * (2 - values.softness)).toFixed(2));
      return preset;
    }),
  },
  {
    template_id: "background_blur_in",
    preset_id: "background_blur_in",
    category_id: "background_transition",
    title: "模糊转清晰",
    summary: "像镜头重新对焦一样切入场景。",
    target_type: "background",
    recommended_scene: "回忆切入、主角聚焦、梦境转醒",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 260, max: 1800, step: 20 },
      { key: "softness", label: "柔和度", type: "range", min: 0.5, max: 1.8, step: 0.05 },
    ],
    defaults: { duration_ms: 620, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("background_blur_in", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      return adjustSoftness(preset, values.softness);
    }),
  },
  {
    template_id: "background_push_in",
    preset_id: "background_push_in",
    category_id: "background_transition",
    title: "轻微推进",
    summary: "给静态背景一点镜头呼吸感。",
    target_type: "background",
    recommended_scene: "强调地点氛围、情绪酝酿、过场停顿",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 320, max: 2200, step: 20 },
      { key: "intensity", label: "强度", type: "range", min: 0.5, max: 1.6, step: 0.05 },
      { key: "softness", label: "柔和度", type: "range", min: 0.5, max: 1.6, step: 0.05 },
    ],
    defaults: { duration_ms: 860, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("background_push_in", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      adjustScaleAmplitude(preset, values.intensity, 1);
      preset.easing = values.softness > 1.1 ? "ease-in-out" : "ease-out";
      return preset;
    }),
  },
  {
    template_id: "camera_zoom_in",
    preset_id: "camera_zoom_in",
    category_id: "camera_motion",
    title: "镜头推进",
    summary: "把注意力拉向角色或细节。",
    target_type: "camera",
    recommended_scene: "重要表情、压迫感、揭示信息",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 240, max: 1800, step: 20 },
      { key: "intensity", label: "强度", type: "range", min: 0.5, max: 1.6, step: 0.05 },
    ],
    defaults: { duration_ms: 900, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("camera_zoom_in", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      return adjustScaleAmplitude(preset, values.intensity, 1);
    }),
  },
  {
    template_id: "camera_zoom_out",
    preset_id: "camera_zoom_out",
    category_id: "camera_motion",
    title: "镜头拉远",
    summary: "给场景留出呼吸和空间感。",
    target_type: "camera",
    recommended_scene: "段落收尾、气氛冷却、环境展示",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 240, max: 1800, step: 20 },
      { key: "intensity", label: "强度", type: "range", min: 0.5, max: 1.6, step: 0.05 },
    ],
    defaults: { duration_ms: 820, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("camera_zoom_out", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      return adjustScaleAmplitude(preset, values.intensity, 1);
    }),
  },
  {
    template_id: "camera_shake",
    preset_id: "camera_shake",
    category_id: "camera_motion",
    title: "镜头震动",
    summary: "快速制造冲击感。",
    target_type: "camera",
    recommended_scene: "撞击、爆点、惊吓、突发事件",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 120, max: 1000, step: 20 },
      { key: "intensity", label: "强度", type: "range", min: 0.5, max: 2, step: 0.05 },
    ],
    defaults: { duration_ms: 420, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("camera_shake", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      return adjustOffsetAmplitude(preset, values.intensity);
    }),
  },
  {
    template_id: "camera_impact",
    preset_id: "camera_impact",
    category_id: "camera_motion",
    title: "瞬时冲击",
    summary: "适合用在短促而重的句点上。",
    target_type: "camera",
    recommended_scene: "强提示、击打、高潮句、悬念落点",
    controls: [
      { key: "duration_ms", label: "时长", type: "range", min: 120, max: 900, step: 20 },
      { key: "intensity", label: "强度", type: "range", min: 0.6, max: 1.8, step: 0.05 },
    ],
    defaults: { duration_ms: 320, intensity: 1, direction: "left", loop: false, softness: 1 },
    buildPreset: createPreset("camera_impact", (preset, values) => {
      adjustDuration(preset, values.duration_ms);
      adjustOffsetAmplitude(preset, values.intensity);
      return adjustScaleAmplitude(preset, values.intensity, 1);
    }),
  },
];

export function getAnimationTemplate(templateId: string): AnimationPresetTemplate | undefined {
  return animationPresetTemplates.find((template) => template.template_id === templateId);
}

export function buildAnimationPresetFromTemplate(templateId: string, values: AnimationPresetTweakValues): AnimationPreset {
  const template = getAnimationTemplate(templateId);
  if (!template) throw new Error(`Unknown animation template: ${templateId}`);
  return template.buildPreset(values);
}
