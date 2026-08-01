import { nanoid } from "nanoid";
import type { GameCommand, GameCommandType } from "../types/commands";
import { defaultCharacterAnimationConfig } from "../../../shared/animation/characterAnimation";
import { choiceDisplayLabel, transitionDisplayLabel } from "./displayNames";
import {
  createDefaultCameraCommand,
  isLegacyCameraCommand,
  isStructuredCameraCommand,
  type CameraCommand,
} from "../../../shared/camera/cameraMotion";

export const commandTypes: GameCommandType[] = [
  "dialog",
  "narration",
  "hide_dialog",
  "background",
  "show_image",
  "video",
  "sprite",
  "choice",
  "state_update",
  "conditional_jump",
  "jump",
  "animation",
  "bgm",
  "sfx",
  "camera",
  "wait",
];

export const commandLabels: Record<GameCommandType, string> = {
  dialog: "角色对话",
  narration: "旁白",
  hide_dialog: "隐藏对话框",
  background: "背景切换",
  show_image: "展示图片",
  video: "播放过场视频",
  sprite: "立绘控制",
  choice: "选项分支",
  state_update: "状态修改",
  conditional_jump: "判断跳转",
  jump: "场景跳转",
  animation: "演出动画",
  bgm: "背景音乐",
  sfx: "音效",
  camera: "运镜",
  wait: "等待",
};

export function defaultCommand(type: GameCommandType): GameCommand {
  switch (type) {
    case "dialog":
      return { type, character_id: "alice", text: "新的台词", emotion: "", portrait: "", voice: "", side: "left" };
    case "narration":
      return { type, text: "新的旁白" };
    case "hide_dialog":
      return { type };
    case "background":
      return { type, background_id: "", background_fit: "stretch", transition: "fade", transition_display_name: "淡入过场" };
    case "show_image":
      return { type, image_id: "", image_fit: "contain", image_display_name: "", caption: "", alt: "", backdrop_opacity: 0.62, backdrop_blur_px: 12 };
    case "video":
      return { type, video_id: "", video_fit: "contain", fade_in_ms: 500, fade_out_ms: 500 };
    case "sprite":
      return { type, character_id: "alice", sprite_id: "", position: "center", animation: "", animation_display_name: "", animation_config: defaultCharacterAnimationConfig(true), visible: true };
    case "choice":
      return { type, choices: [{ choice_id: "choice_" + nanoid(6), choice_display_name: null, text: "", target_scene_id: "", conditions: [] }] };
    case "state_update":
      return { type, key: "flag", operation: "set", value: true, value_type: "boolean" };
    case "conditional_jump":
      return { type, condition: { key: "flag", operator: "truthy" }, target_scene_id: "", else_target_scene_id: null };
    case "jump":
      return { type, target_scene_id: "" };
    case "animation":
      return { type, animation_id: "", animation_display_name: "淡入演出", target: "screen", params: { duration: 500 }, blocking: true };
    case "bgm":
      return { type, bgm_id: null, action: "play", volume: 0.8, fade_ms: 500 };
    case "sfx":
      return { type, sfx_id: "", volume: 1 };
    case "camera":
      return createDefaultCameraCommand("reframe");
    case "wait":
      return { type, duration_ms: 500 };
  }
}

function animationSummaryLabel(command: Extract<GameCommand, { type: "animation" }>): string {
  return command.animation_display_name?.trim() || (command.animation_id ? "演出动画" : "未设置演出动画");
}

function animationTargetLabel(target?: string): string {
  const value = target?.trim();
  if (!value) return "未设置目标";
  if (value === "screen" || value === "camera") return "全屏镜头";
  if (value === "background") return "背景图";
  if (value === "dialog" || value === "dialog_panel") return "对白框";
  if (value === "ui") return "界面控件";
  if (value === "sprite:selected") return "当前角色图像";
  if (value === "sprite:all") return "全部角色图像";
  if (value.startsWith("sprite:")) return `角色图像：${value.slice("sprite:".length)}`;
  return value;
}

function bgmActionLabel(action: Extract<GameCommand, { type: "bgm" }>["action"]): string {
  if (action === "stop") return "停止";
  if (action === "fade") return "淡出";
  return "播放";
}

function conditionSummary(command: Extract<GameCommand, { type: "conditional_jump" }>): string {
  const condition = typeof command.condition === "string" ? command.condition : `${command.condition.key} ${command.condition.operator}`;
  const elseTarget = command.else_target_scene_id ? ` / else -> ${command.else_target_scene_id}` : " / else 继续";
  return `if ${condition} -> ${command.target_scene_id || "未设置目标"}${elseTarget}`;
}

function cameraSummary(command: CameraCommand): string {
  if (isLegacyCameraCommand(command)) {
    return `旧版镜头效果${command.blocking ? " / 等待完成" : ""}`;
  }
  if (!isStructuredCameraCommand(command)) return "镜头设置不完整";
  const motion = command.motion;
  if (motion.kind === "reset") {
    return `回正 / ${(motion.duration_ms / 1000).toFixed(2)} 秒${command.blocking ? " / 等待完成" : ""}`;
  }
  if (motion.kind === "shake") {
    return `震动 / 强度 ${Math.round(motion.intensity * 100)}% / ${(motion.duration_ms / 1000).toFixed(2)} 秒${command.blocking ? " / 等待完成" : ""}`;
  }
  if (motion.kind === "impact") {
    return `冲击 / 强度 ${Math.round(motion.intensity * 100)}% / ${(motion.duration_ms / 1000).toFixed(2)} 秒${command.blocking ? " / 等待完成" : ""}`;
  }
  if (motion.kind === "sequence") {
    const durationMs = motion.shots.reduce((total, shot) => total + shot.duration_ms, 0);
    return `连续运镜 / ${motion.shots.length} 个镜头 / ${(durationMs / 1000).toFixed(2)} 秒 / 等待完成`;
  }
  const isDefaultPush = Math.abs(motion.to.center_x - 0.5) < 0.0001
    && Math.abs(motion.to.center_y - 0.5) < 0.0001
    && Math.abs(motion.to.zoom - 1.12) < 0.0001;
  const action = isDefaultPush ? "轻推" : "重新构图";
  return `${action} / 中心 ${Math.round(motion.to.center_x * 100)}%, ${Math.round(motion.to.center_y * 100)}% / ${motion.to.zoom.toFixed(2)} 倍 / ${(motion.duration_ms / 1000).toFixed(2)} 秒${command.blocking ? " / 等待完成" : ""}`;
}

export function commandSummary(command: GameCommand): string {
  switch (command.type) {
    case "dialog":
      return `${command.character_id || "角色"}：${command.text || "空台词"}`;
    case "narration":
      return command.text || "空旁白";
    case "hide_dialog":
      return "隐藏当前对白或旁白，保留其他界面";
    case "background": {
      const transition = transitionDisplayLabel(command);
      return `${command.background_id || "未设置背景"}${transition ? ` / 过场：${transition}` : ""}`;
    }
    case "show_image":
      return `${command.image_display_name?.trim() || command.image_id || "未选择图片"}${command.caption?.trim() ? ` / ${command.caption.trim()}` : ""}`;
    case "video":
      return `${command.video_id || "未选择视频"} / 淡入 ${command.fade_in_ms ?? 500}ms / 淡出 ${command.fade_out_ms ?? 500}ms`;
    case "sprite": {
      const transition = transitionDisplayLabel(command);
      const base = `${command.character_id || "角色"} / ${command.visible ? command.sprite_id || "立绘" : "隐藏"}`;
      const layer = command.layer === null || command.layer === undefined ? "" : ` / 人物层级 ${command.layer}`;
      return transition ? `${base}${layer} / 过场：${transition}` : `${base}${layer}`;
    }
    case "choice":
      return `${command.choices.length} 个选项 / ${command.choices.map(choiceDisplayLabel).join("、")}`;
    case "state_update":
      return `${command.key || "变量"} ${command.operation} ${String(command.value ?? "")}`;
    case "conditional_jump":
      return conditionSummary(command);
    case "jump":
      return `跳转到 ${command.target_scene_id || "未设置目标"}`;
    case "animation":
      return `${animationSummaryLabel(command)} / 目标：${animationTargetLabel(command.target)}`;
    case "bgm":
      return `${bgmActionLabel(command.action)} ${command.bgm_id || "当前音乐"} / ${command.volume ?? 1}`;
    case "sfx":
      return `${command.sfx_id || "音效"} / ${command.volume ?? 1}`;
    case "camera":
      return cameraSummary(command);
    case "wait":
      return `${command.duration_ms} ms`;
  }
}
