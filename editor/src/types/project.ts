import type { AssetRef } from "./assets";
import type { MemoryMode } from "./memory";
import type { NovelPersistenceState } from "../novel-import/types";
import type { AboutPanelCopy, BackgroundFit, DialogVisualStyle, SpeakerFocusConfig } from "../../../shared/cartridge/types";
import type { UISkinLayout } from "../../../shared/cartridge/uiSkin";

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

export interface ProjectSettings {
  defaultMemoryMode: MemoryMode;
  defaultSpriteScale: number;
  speakerFocus: SpeakerFocusConfig;
  packageAppearance: PackageAppearanceSettings;
  editorAppearance: EditorAppearanceSettings;
  runtimeUILayout?: UISkinLayout;
  characterDisplayNames: Record<string, string>;
  characterDialogStyles: Record<string, DialogVisualStyle>;
  assetLibrary: AssetLibrarySettings;
  assetStudio: AssetStudioProjectSettings;
  novelPersistence?: NovelPersistenceState;
}

export interface ProjectState extends ProjectMetadata {
  assetManifest: AssetRef[];
  recentFiles: string[];
  settings: ProjectSettings;
}
