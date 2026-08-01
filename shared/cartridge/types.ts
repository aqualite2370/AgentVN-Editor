import type { CharacterSpriteAnimationConfig } from "../animation/characterAnimation";
import type { VisualTransitionConfig } from "../animation/visualTransition";
import type { CameraCommand } from "../camera/cameraMotion";

export type AssetType = "background" | "sprite" | "portrait" | "bgm" | "sfx" | "voice" | "video" | "animation" | "ui" | "font" | "other";
export type BackgroundFit = "stretch" | "contain" | "cover";
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface AboutPanelCopyField {
  label?: string;
  value?: string;
}

export interface AboutPanelCopy {
  title?: string;
  kicker?: string;
  heading?: string;
  description?: string;
  fields?: AboutPanelCopyField[];
  note?: string;
}

export interface AssetManifestItem {
  asset_id: string;
  asset_type: AssetType;
  path: string;
  filename: string;
  mime_type?: string;
  size_bytes?: number;
  hash_sha256?: string;
  preload?: boolean;
  width?: number;
  height?: number;
  duration_ms?: number;
  tags?: string[];
  placeholder?: boolean;
  ai_generated?: boolean;
  source_provider?: string;
  source_model?: string;
  license_note?: string;
}

export interface GameManifest {
  manifest_version: string;
  cartridge_version: string;
  runtime_version: string;
  game_id: string;
  title: string;
  subtitle?: string;
  author: string;
  description: string;
  version: string;
  language: string;
  tags: string[];
  cover?: string;
  shell?: {
    background?: string;
    background_video?: string;
    background_fit?: BackgroundFit;
    title_background_dimming?: number;
    icon?: string;
    settings_panel_background?: string;
    settings_panel_background_fit?: BackgroundFit;
    settings_panel_background_dimming?: number;
    settings_entry_image?: string;
    about?: AboutPanelCopy;
  };
  entry_script: string;
  entry_scene_id: string;
  assets: AssetManifestItem[];
  created_at: string;
  updated_at: string;
  save_compatibility_version?: string;
  breaking_save_compatibility?: boolean;
  ui_skin?: {
    path: string;
    version: string;
    name?: string;
  };
}

export interface DialogVisualStyle {
  background_asset_id?: string | null;
  background_fit?: BackgroundFit | null;
  theme_color?: string | null;
  text_color?: string | null;
  font_size?: number | null;
  font_weight?: number | null;
  font_style?: "normal" | "italic" | null;
}

export type StateValueType = "boolean" | "number" | "text" | "list";
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

export interface Choice {
  choice_id: string;
  choice_display_name?: string | null;
  text: string;
  target_scene_id: string;
  conditions: Array<string | Condition>;
}

export type GameCommand =
  | { type: "dialog"; character_id: string; text: string; emotion?: string | null; portrait?: string | null; voice?: string | null; side?: "left" | "right" | "center" | null; font_asset_id?: string | null; dialog_style?: DialogVisualStyle | null; dialog_style_mode?: "inherit" | "manual" }
  | { type: "narration"; text: string; font_asset_id?: string | null; dialog_style?: DialogVisualStyle | null; dialog_style_mode?: "inherit" | "manual" }
  | { type: "hide_dialog" }
  | { type: "background"; background_id: string; transition?: string | null; transition_config?: VisualTransitionConfig | null; background_fit?: BackgroundFit }
  | { type: "show_image"; image_id: string; image_fit?: BackgroundFit; image_display_name?: string | null; caption?: string | null; alt?: string | null; backdrop_opacity?: number | null; backdrop_blur_px?: number | null }
  | { type: "video"; video_id: string; video_fit?: BackgroundFit; fade_in_ms?: number; fade_out_ms?: number }
  | { type: "sprite"; character_id: string; sprite_id: string; position?: string | null; layer?: number | null; animation?: string | null; animation_config?: CharacterSpriteAnimationConfig | null; switch_transition?: VisualTransitionConfig | null; scale?: number | null; visible: boolean }
  | { type: "choice"; choices: Choice[] }
  | { type: "state_update"; key: string; operation: "set" | "set_if_unset" | "add" | "subtract" | "toggle" | "append" | "remove"; value: JsonValue; value_type?: StateValueType }
  | { type: "conditional_jump"; condition: string | Condition; target_scene_id: string; else_target_scene_id?: string | null }
  | { type: "jump"; target_scene_id: string }
  | { type: "animation"; animation_id: string; target: string; params: Record<string, JsonValue>; blocking: boolean }
  | { type: "bgm"; bgm_id?: string | null; action: "play" | "stop" | "fade"; volume?: number | null; fade_ms?: number | null }
  | { type: "sfx"; sfx_id: string; volume?: number | null }
  | CameraCommand
  | { type: "wait"; duration_ms: number };

export interface Scene {
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
  characters?: Array<{
    character_id: string;
    name: string;
    aliases?: string[];
    dialog_style?: DialogVisualStyle | null;
  }>;
  scenes: Scene[];
}

export interface GalleryItem {
  item_id: string;
  title: string;
  description?: string;
  asset_id: string;
  unlock_condition?: JsonValue;
  hidden_until_unlocked?: boolean;
}

export interface GalleryManifest {
  gallery_version: string;
  items: GalleryItem[];
}

export interface ChecksumFileEntry {
  path: string;
  size_bytes: number;
  hash_sha256: string;
}

export interface ChecksumManifest {
  checksum_version: string;
  algorithm: "sha256";
  generated_at: string;
  files: ChecksumFileEntry[];
  package_hash_sha256?: string;
}

export interface CartridgeMetadata {
  credits?: Record<string, unknown>;
  changelog?: Record<string, unknown>;
  license?: Record<string, unknown>;
}

export interface CartridgeAssetInput {
  path: string;
  data: Blob | ArrayBuffer | Uint8Array | string;
  manifestItem: AssetManifestItem;
}

export interface CartridgePackage {
  manifest: GameManifest;
  script: RuntimeScript;
  gallery: GalleryManifest;
  checksum: ChecksumManifest;
  metadata?: CartridgeMetadata;
  uiSkin?: import("./uiSkin").UISkinLayout;
  assetBlobUrls: Record<string, string>;
  uiAssetBlobUrls?: Record<string, string>;
  sourceFileName?: string;
}

export interface CartridgeInstallRecord {
  install_id: string;
  game_id: string;
  title: string;
  author: string;
  version: string;
  language: string;
  cover_asset_id?: string;
  installed_at: string;
  updated_at: string;
  manifest: GameManifest;
  script: RuntimeScript;
  gallery: GalleryManifest;
  ui_skin?: import("./uiSkin").UISkinLayout;
  asset_blob_urls: Record<string, string>;
  ui_asset_blob_urls?: Record<string, string>;
  source_file_name?: string;
}

export type IssueSeverity = "error" | "warning";
export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
  severity: IssueSeverity;
}

export interface CartridgeValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface CartridgeExportOptions {
  includeGallery: boolean;
  includeMetadata: boolean;
  fileName?: string;
}

export interface CartridgeImportOptions {
  runtimeVersion: string;
  maxPackageSizeMB?: number;
  maxSingleFileSizeMB?: number;
}

export type InstallAction = "install_new" | "update" | "reinstall" | "downgrade" | "reject";
export interface InstallPlan {
  action: InstallAction;
  current_version?: string;
  incoming_version: string;
  warnings: string[];
}
