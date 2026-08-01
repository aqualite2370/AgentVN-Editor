import type { GameCommand } from "./commands";
import type { DialogVisualStyle } from "../../../shared/cartridge/types";

export type LoadingAnimationConfig =
  | { kind: "default" }
  | { kind: "video"; video_asset_id: string }
  | { kind: "image_sequence"; image_asset_ids: string[]; frame_duration_ms?: number };

export interface SpeakerFocusConfig {
  enabled: boolean;
  scale: number;
  duration_ms: number;
}

export interface RuntimeScript {
  schema_version: string;
  game_id: string;
  title: string;
  entry_scene_id: string;
  default_sprite_scale?: number;
  speaker_focus?: SpeakerFocusConfig;
  loading_animation?: LoadingAnimationConfig;
  characters?: CharacterProfile[];
  scenes: RuntimeScene[];
}

export interface CharacterProfile {
  character_id: string;
  name: string;
  aliases?: string[];
  dialog_style?: DialogVisualStyle | null;
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
