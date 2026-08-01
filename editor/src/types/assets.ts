export type AssetType =
  | "background"
  | "sprite"
  | "portrait"
  | "bgm"
  | "sfx"
  | "voice"
  | "video"
  | "animation"
  | "font"
  | "ui"
  | "other";

export interface AssetMetadata {
  display_name?: string;
  filename?: string;
  mime_type?: string;
  size_bytes?: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  media_warning?: string;
  source?: "generated" | "imported" | "edited" | "bundled";
  placeholder?: boolean;
  license_note?: string;
  blob_url?: string;
  data_url?: string;
  project_path?: string;
  path?: string;
  filePath?: string;
  url?: string;
  character_name?: string;
  character_id?: string;
  provider_id?: string;
  model?: string;
  prompt?: string;
  generation?: Record<string, unknown>;
  created_at?: string;
  tags?: string[];
}

export interface AssetRef {
  asset_id: string;
  asset_type: AssetType;
  metadata: AssetMetadata;
}

export type PendingAssetKind = "background" | "sprite" | "portrait" | "audio" | "performance";

export interface PendingVisualAsset {
  id: string;
  kind: PendingAssetKind;
  asset_type?: AssetType;
  asset_id?: string;
  character_id?: string;
  scene_id: string;
  scene_title: string;
  node_id?: string;
  node_label?: string;
  command_type?: string;
  command_index?: number;
  field?: string;
  location?: string;
  label: string;
  reason: string;
  placeholder?: boolean;
  optional?: boolean;
}
