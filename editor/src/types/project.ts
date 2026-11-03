import type { AssetRef } from "./assets";
import type { MemoryMode } from "./memory";
import type { NovelPersistenceState } from "../novel-import/types";
import type { AboutPanelCopy, BackgroundFit, DialogPresentationMode, DialogVisualStyle, SpeakerFocusConfig } from "../../../shared/cartridge/types";
import type { UISkinLayout } from "../../../shared/cartridge/uiSkin";
import type { RuntimeUILayoutProfiles } from "../../../shared/cartridge/uiLayoutProfiles";

export interface AssetLibraryFolder {
  folder_id: string;
  name: string;
  parent_folder_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetLibraryAssetLocation {
  primaryFolderId: string | null;
  linkedFolderIds: string[];
}

export interface AssetLibrarySettings {
  folders: AssetLibraryFolder[];
  assetLocations: Record<string, AssetLibraryAssetLocation>;
}

export interface PackageAppearanceSettings {
  coverAssetId?: string;
  titleBackgroundAssetId?: string;
  titleBackgroundVideoAssetId?: string;
  titleBackgroundFit?: BackgroundFit;
  titleBackgroundDimming?: number;
  iconAssetId?: string;
  standaloneIconAssetId?: string;
  androidApplicationId?: string;
  settingsPanelBackgroundAssetId?: string;
  settingsPanelBackgroundFit?: BackgroundFit;
  settingsPanelBackgroundDimming?: number;
  settingsEntryImageAssetId?: string;
  about?: AboutPanelCopy;
}

export interface EditorCanvasBackgroundImage {
  dataUrl?: string;
  url?: string;
  filePath?: string;
  backendAssetPath?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  updatedAt: string;
}

export interface EditorAppearanceSettings {
  /** @deprecated Older projects used a material-library asset id for editor canvas backgrounds. */
  canvasBackgroundAssetId?: string;
  canvasBackgroundImage?: EditorCanvasBackgroundImage;
  canvasBackgroundOpacity?: number;
  canvasBackgroundFit?: "cover" | "contain" | "tile";
}

export interface AssetStudioProjectSettings {
  version: 1;
  advancedOpen: boolean;
  leftWidth: number;
  rightWidth: number;
  customPresets: Array<{
    presetId: string;
    name: string;
    assetType: "background" | "sprite" | "portrait" | "cg" | "ui";
    stylePreset: string;
    aspectRatio: string;
    width: number;
    height: number;
    promptTemplate?: string;
  }>;
}

export interface ProjectMetadata {
  projectId: string;
  title: string;
  author: string;
  schemaVersion: string;
  editorVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterSpriteLayoutSettings {
  position?: string | null;
  offset_x: number;
  offset_y: number;
  scale: number;
}

export interface RollbackProjectSettings {
  enabled: boolean;
  hard_limit: number;
  log_length: number;
  pause_as_checkpoint: boolean;
  fixed_choice_mode: "selected_only" | "selected_marked";
}

export interface ProjectSettings {
  defaultMemoryMode: MemoryMode;
  defaultSpriteScale: number;
  defaultDialogPresentation?: DialogPresentationMode;
  characterDialogPresentations?: Record<string, DialogPresentationMode>;
  speakerFocus: SpeakerFocusConfig;
  rollback: RollbackProjectSettings;
  packageAppearance: PackageAppearanceSettings;
  editorAppearance: EditorAppearanceSettings;
  runtimeUILayout?: UISkinLayout;
  runtimeUILayoutProfiles?: RuntimeUILayoutProfiles;
  characterDisplayNames: Record<string, string>;
  characterDialogStyles: Record<string, DialogVisualStyle>;
  characterSpriteLayouts: Record<string, CharacterSpriteLayoutSettings>;
  assetLibrary: AssetLibrarySettings;
  assetStudio: AssetStudioProjectSettings;
  novelPersistence?: NovelPersistenceState;
}

export interface ProjectState extends ProjectMetadata {
  assetManifest: AssetRef[];
  recentFiles: string[];
  settings: ProjectSettings;
}
