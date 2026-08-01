import type { GameCommand } from "../types/commands";
import { choiceDisplayLabel, performanceAnimationDisplayLabel, transitionDisplayLabel } from "./displayNames";

export function commandPreview(command: GameCommand): string {
  switch (command.type) {
    case "dialog":
      return `角色台词：${command.text}`;
    case "narration":
      return command.text;
    case "hide_dialog":
      return "隐藏当前对话框";
    case "background":
      return transitionDisplayLabel(command) ? `切换背景 / 过场：${transitionDisplayLabel(command)}` : "切换背景";
    case "show_image":
      return `展示图片：${command.image_display_name?.trim() || command.image_id || "未选择素材"}`;
    case "video":
      return `播放过场视频：${command.video_id || "未选择素材"}`;
    case "sprite":
      return command.visible
        ? `显示角色立绘${transitionDisplayLabel(command) ? ` / 过场：${transitionDisplayLabel(command)}` : ""}`
        : "隐藏角色立绘";
    case "choice":
      return `选项 ${command.choices.length} 个 / ${command.choices.map(choiceDisplayLabel).join("、")}`;
    case "state_update":
      return `更新状态：${command.key}`;
    case "conditional_jump":
      return `判断跳转：${command.target_scene_id || "未设置目标"}`;
    case "animation":
      return `播放演出动画：${performanceAnimationDisplayLabel(command)}`;
    case "bgm":
      return "调整背景音乐";
    case "sfx":
      return "播放音效";
    case "camera":
      return "播放镜头效果";
    case "wait":
      return `等待 ${command.duration_ms} 毫秒`;
    default:
      return "未知指令";
  }
}

export function commandsToText(commands: GameCommand[], limit = 3): string[] {
  return commands.slice(0, limit).map(commandPreview);
}
