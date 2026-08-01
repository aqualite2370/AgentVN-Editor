import type { CharacterSide } from "./commands";
import type { BackgroundFit } from "./manifest";
import type { CharacterSpriteAnimationConfig } from "../../../shared/animation/characterAnimation";
import type { NormalizedVisualTransitionConfig } from "../../../shared/animation/visualTransition";
import type { DialogVisualStyle } from "../../../shared/cartridge/types";

export interface RuntimeSettings {
  schemaVersion: 7;
  textSpeed: number;
  autoSpeed: number;
  autoSaveEnabled: boolean;
  skipUnread: boolean;
  volumeBgm: number;
  volumeSfx: number;
  volumeVoice: number;
  language: string;
}

export interface DialogState {
  character_id?: string;
  speaker?: string;
  text: string;
  text_key?: string;
  emotion?: string | null;
  portrait?: string | null;
  voice?: string | null;
  font_asset_id?: string | null;
  dialog_style?: DialogVisualStyle | null;
  dialog_style_mode?: "inherit" | "manual";
  isNarration?: boolean;
}

export interface SpriteReplacementState {
  previous_sprite_id: string;
  previous_position?: CharacterSide | string | null;
  previous_scale?: number | null;
  transition: NormalizedVisualTransitionConfig;
  key: number;
}

export interface SpriteState {
  character_id: string;
  sprite_id: string;
  position?: CharacterSide | string | null;
  layer?: number | null;
  animation?: string | null;
  animation_config?: CharacterSpriteAnimationConfig | null;
  scale?: number | null;
  visible: boolean;
  replacement?: SpriteReplacementState;
}

export interface FocusedImageState {
  image_id: string;
  image_fit: BackgroundFit;
  image_display_name?: string | null;
  caption?: string | null;
  alt?: string | null;
  backdrop_opacity: number;
  backdrop_blur_px: number;
}

export interface ActiveVideoState {
  video_id: string;
  video_fit: BackgroundFit;
  fade_in_ms: number;
  fade_out_ms: number;
}

export interface BgmState {
  bgm_id?: string | null;
  action: "play" | "stop" | "fade";
  volume?: number | null;
  fade_ms?: number | null;
}

export interface SfxEvent {
  id: string;
  sfx_id: string;
  volume?: number | null;
}

export interface RuntimeAnimationEffect {
  effect_id: string;
  playback_id?: string;
  animation_id: string;
  target: string;
  target_kind: "screen" | "background" | "sprite" | "dialog" | "ui" | "unknown";
  target_id?: string;
  params: Record<string, import("./commands").JsonValue>;
  started_at: number;
  duration_ms: number;
}
