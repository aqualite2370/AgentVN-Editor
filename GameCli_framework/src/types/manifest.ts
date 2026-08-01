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

export type BackgroundFit = "stretch" | "contain" | "cover";

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
  filename?: string;
  mime_type?: string;
  preload?: boolean;
  tags?: string[];
  placeholder?: boolean;
}

export interface GameManifest {
  manifest_version: string;
  game_id: string;
  title: string;
  subtitle?: string;
  author: string;
  version: string;
  cover?: string;
  description: string;
  entry_script: string;
  assets: AssetManifestItem[];
  runtime_version: string;
  tags: string[];
  language: string;
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
  ui_skin?: {
    path: string;
    version: string;
    name?: string;
  };
}
