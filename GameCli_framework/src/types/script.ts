import type { GameCommand } from "./commands";
import type { DialogPresentationMode, DialogVisualStyle, OpeningAudioTrack } from "../../../shared/cartridge/types";

export type { LoadingAnimationConfig } from "../../../shared/cartridge/types";
import type { LoadingAnimationConfig } from "../../../shared/cartridge/types";

export interface SpeakerFocusConfig {
  enabled: boolean;
  scale: number;
  duration_ms: number;
}

export interface RollbackRuntimeConfig {
  enabled?: boolean;
  hard_limit?: number;
  log_length?: number;
  pause_as_checkpoint?: boolean;
  fixed_choice_mode?: "selected_only" | "selected_marked";
}

export interface RuntimeScript {
  schema_version: string;
  game_id: string;
  title: string;
  entry_scene_id: string;
  default_sprite_scale?: number;
  default_dialog_presentation?: DialogPresentationMode;
  speaker_focus?: SpeakerFocusConfig;
  loading_animation?: LoadingAnimationConfig;
  opening_audio?: OpeningAudioTrack[];
  rollback?: RollbackRuntimeConfig;
  characters?: CharacterProfile[];
  scenes: RuntimeScene[];
}

export interface CharacterProfile {
  character_id: string;
  name: string;
  aliases?: string[];
  dialog_style?: DialogVisualStyle | null;
  dialog_presentation?: DialogPresentationMode;
}

export interface RuntimeScene {
  scene_id: string;
  title: string;
  summary: string;
  chapter: number;
  tags: string[];
  commands: GameCommand[];
  next_scene_id?: string;
  is_ending?: boolean;
  ending_id?: string;
}
