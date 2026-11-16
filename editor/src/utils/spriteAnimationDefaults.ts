import {
  normalizeCharacterAnimationConfig,
  validateCharacterAnimationConfig,
  type CharacterSpriteAnimationConfig,
} from "../../../shared/animation/characterAnimation";
import type { AnimationPreset } from "../animation/types";
import type { SpriteCommand } from "../types/commands";
import type { EditorNode } from "../types/nodes";

export type SpriteDefaultPhase = "enter" | "exit";
export type SpriteAnimationDefaults = Partial<Record<SpriteDefaultPhase, CharacterSpriteAnimationConfig>>;

export function validateSpriteAnimationDefaults(value: SpriteAnimationDefaults | undefined): SpriteAnimationDefaults {
  const result: SpriteAnimationDefaults = {};
  for (const phase of ["enter", "exit"] as const) {
    const config = value?.[phase];
    if (!config) continue;
    if (config.phase !== phase) throw new Error("立绘默认动画的入场／退场阶段不匹配。");
    const errors = validateCharacterAnimationConfig(config);
    if (errors.length) throw new Error(errors.map(error => error.message).join("\n"));
    result[phase] = structuredClone(config);
  }
  return result;
}

export function spriteDefaultFromPreset(preset: AnimationPreset, phase: SpriteDefaultPhase, blocking: boolean): CharacterSpriteAnimationConfig {
  if (preset.target_type !== "sprite") throw new Error("全局入退场仅支持立绘动画。");
  if (preset.loop || preset.direction !== "normal") throw new Error("全局入退场不能循环或反向播放，请关闭循环。");
  if (preset.keyframes.some(frame => frame.custom_css?.trim()))
    throw new Error("全局立绘动画不支持自定义 CSS，请使用关键帧控件。");
  const config: CharacterSpriteAnimationConfig = {
    kind: "tween", phase, duration_ms: preset.duration_ms, delay_ms: 0,
    easing: preset.easing, blocking, display_name: preset.name, preset_id: preset.preset_id,
    transform_origin: "center bottom",
    keyframes: preset.keyframes.map(({custom_css: _css, ...frame}) => ({...frame})),
  };
  return validateSpriteAnimationDefaults({[phase]:config})[phase]!;
}

/** Legacy explicit animations remain overrides until the author opts into inheritance. */
export function inheritsSpriteAnimation(command: SpriteCommand): boolean {
  return command.animation_source === "project" || (command.animation_source !== "manual"
    && !command.animation_config && !command.animation?.trim());
}

export function resolveSpriteAnimation(command: SpriteCommand, defaults?: SpriteAnimationDefaults): SpriteCommand {
  const phase = command.visible ? "enter" : "exit";
  const inherited = inheritsSpriteAnimation(command) ? defaults?.[phase] : undefined;
  const {animation_source: _source, ...runtime} = command;
  return inherited ? {...runtime, animation: null, animation_display_name: null, animation_config: structuredClone(inherited)} : runtime;
}

/** Emphasis events and standalone animation commands are never rewritten. */
export function useGlobalSpriteAnimation(nodes: EditorNode[], phase: SpriteDefaultPhase): {nodes: EditorNode[]; count: number} {
  let count = 0;
  const next = nodes.map(node => {
    if (!node.data.scene) return node;
    let changed = false;
    const commands = node.data.scene.commands.map(command => {
      if (command.type !== "sprite" || (command.visible ? "enter" : "exit") !== phase) return command;
      const config = normalizeCharacterAnimationConfig(command.animation_config, command.animation, null, command.visible);
      if (config?.phase === "emphasis") return command;
      count++;
      if (command.animation_source === "project" && !command.animation_config && !command.animation) return command;
      changed = true;
      return {...command, animation_source: "project" as const, animation_config: undefined, animation: null, animation_display_name: null};
    });
    return changed ? {...node, data:{...node.data, scene:{...node.data.scene, commands}}} : node;
  });
  return {nodes:next, count};
}
