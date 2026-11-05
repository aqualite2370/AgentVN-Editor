import type { CharacterSpriteAnimationConfig } from "../../../shared/animation/characterAnimation";
import type { VisualTransitionConfig } from "../../../shared/animation/visualTransition";
import type { BackgroundFit, BubblePositionConfig, DialogPresentationMode, DialogVisualStyle } from "../../../shared/cartridge/types";
import type { UILayoutComponentStyle } from "../../../shared/cartridge/uiSkin";
import type { CameraCommand as SharedCameraCommand } from "../../../shared/camera/cameraMotion";

export type CharacterSide = "left" | "right" | "center";
export type StateOperation = "set" | "set_if_unset" | "add" | "subtract" | "toggle" | "append" | "remove";
export type StateValueType = "boolean" | "number" | "text" | "list";
export type BgmAction = "play" | "stop";
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "greater_or_equal"
  | "less_or_equal"
  | "truthy"
  | "falsy"
  | "includes"
  | "not_includes";

export interface Condition {
  key: string;
  operator: ConditionOperator;
  value?: JsonValue;
}

export interface DialogCommand {
  type: "dialog";
  presentation_mode?: DialogPresentationMode;
  bubble_position?: BubblePositionConfig;
  clear_nvl_page_before?: boolean;
  character_id: string;
  text: string;
  emotion?: string | null;
  portrait?: string | null;
  voice?: string | null;
  side?: CharacterSide | null;
  font_asset_id?: string | null;
  dialog_style?: DialogVisualStyle | null;
  dialog_style_mode?: "inherit" | "manual";
}

export interface NarrationCommand {
  type: "narration";
  presentation_mode?: DialogPresentationMode;
  bubble_position?: BubblePositionConfig;
  clear_nvl_page_before?: boolean;
  text: string;
  font_asset_id?: string | null;
  dialog_style?: DialogVisualStyle | null;
  dialog_style_mode?: "inherit" | "manual";
  narration_style?: "dialog" | "centered";
}

export interface HideDialogCommand {
  type: "hide_dialog";
}

export interface BackgroundCommand {
  type: "background";
  background_id: string;
  background_fit?: BackgroundFit;
  transition?: string | null;
  transition_display_name?: string | null;
  transition_config?: VisualTransitionConfig | null;
}

export interface ShowImageCommand {
  type: "show_image";
  image_id: string;
  image_fit?: BackgroundFit;
  image_display_name?: string | null;
  caption?: string | null;
  alt?: string | null;
  backdrop_opacity?: number | null;
  backdrop_blur_px?: number | null;
}

export interface VideoCommand {
  type: "video";
  video_id: string;
  video_fit?: BackgroundFit;
  fade_in_ms?: number;
  fade_out_ms?: number;
}

export interface SpriteCommand {
  type: "sprite";
  character_id: string;
  sprite_id: string;
  position?: string | null;
  offset_x?: number | null;
  offset_y?: number | null;
  layer?: number | null;
  animation?: string | null;
  animation_display_name?: string | null;
  animation_config?: CharacterSpriteAnimationConfig | null;
  switch_transition?: VisualTransitionConfig | null;
  scale?: number | null;
  visible: boolean;
}

export interface Choice {
  choice_id: string;
  choice_display_name?: string | null;
  text: string;
  target_scene_id: string;
  conditions: Array<string | Condition>;
  button_style?: UILayoutComponentStyle;
}

export interface ChoiceCommand {
  type: "choice";
  choices: Choice[];
  button_style?: UILayoutComponentStyle;
}

export interface StateUpdateCommand {
  type: "state_update";
  key: string;
  operation: StateOperation;
  value: JsonValue;
  value_type?: StateValueType;
}

export interface ConditionalJumpCommand {
  type: "conditional_jump";
  condition: string | Condition;
  target_scene_id: string;
  else_target_scene_id?: string | null;
}

export interface JumpCommand {
  type: "jump";
  target_scene_id: string;
}

export interface AnimationCommand {
  type: "animation";
  animation_id: string;
  animation_asset_id?: string;
  animation_display_name?: string | null;
  target: string;
  params: Record<string, JsonValue>;
  blocking: boolean;
}

export interface BgmCommand {
  type: "bgm";
  bgm_id?: string | null;
  action: BgmAction;
  volume?: number | null;
  fade_ms?: number | null;
}

export interface SfxCommand {
  type: "sfx";
  sfx_id: string;
  volume?: number | null;
}

export type CameraCommand = SharedCameraCommand;

export interface WaitCommand {
  type: "wait";
  duration_ms: number;
}

export interface GalleryAnchorCommand {
  type: "gallery_anchor";
  anchor_id: string;
  title: string;
  asset_id: string;
  description?: string | null;
}

export type RollbackControlCommand =
  | { type: "rollback"; action: "checkpoint"; hard?: boolean }
  | { type: "rollback"; action: "block" | "fix" | "suspend" | "resume" };

export type GameCommand =
  | DialogCommand
  | NarrationCommand
  | HideDialogCommand
  | BackgroundCommand
  | ShowImageCommand
  | VideoCommand
  | SpriteCommand
  | ChoiceCommand
  | StateUpdateCommand
  | ConditionalJumpCommand
  | JumpCommand
  | AnimationCommand
  | BgmCommand
  | SfxCommand
  | CameraCommand
  | WaitCommand
  | GalleryAnchorCommand
  | RollbackControlCommand;

export type GameCommandType = GameCommand["type"];
