import type { GalleryItem } from "./gallery";
import type { GameManifest } from "./manifest";
import type { RuntimeScript } from "./script";
import type { UISkinLayout } from "../../../shared/cartridge/uiSkin";

export interface StartupIndexFile {
  assetId?: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface StartupIndex {
  schemaVersion: "1.0";
  contentId: string;
  files: Record<string, StartupIndexFile>;
  titleAssets: string[];
  entrySceneAssets: string[];
  sceneAssets: Record<string, string[]>;
  nextScenes: Record<string, string[]>;
  legacyPreloadHints: string[];
}

export interface CartridgePackage {
  manifest: GameManifest;
  script: RuntimeScript;
  gallery: GalleryItem[];
  uiSkin?: UISkinLayout;
  assetUrls: Record<string, string>;
  uiAssetUrls?: Record<string, string>;
  startupIndex?: StartupIndex;
  contentId?: string;
}

export interface LibraryGame {
  install_id: string;
  game_id: string;
  title: string;
  author: string;
  version: string;
  description: string;
  cover?: string;
  manifest: GameManifest;
  script: RuntimeScript;
  gallery: GalleryItem[];
  uiSkin?: UISkinLayout;
  assetUrls: Record<string, string>;
  uiAssetUrls?: Record<string, string>;
  imported_at: string;
  updated_at?: string;
  language?: string;
  source_file_name?: string;
  cartridge_path?: string;
  startupIndex?: StartupIndex;
  contentId?: string;
}

export interface InstalledCartridgeIndex {
  installId: string;
  gameId: string;
  title: string;
  author: string;
  version: string;
  language: string;
  description: string;
  coverAssetId?: string;
  sourceFileName?: string;
  installedAt: string;
  updatedAt: string;
  cartridgePath: string;
}
