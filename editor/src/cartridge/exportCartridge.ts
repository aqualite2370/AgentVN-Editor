import { CARTRIDGE_FORMAT_VERSION, MANIFEST_VERSION, SUPPORTED_RUNTIME_VERSION } from "../../../shared/cartridge/constants";
import { packCartridgeToBlob } from "../../../shared/cartridge/packer";
import { minimumRuntimeVersionForScript, runtimeScriptSchemaVersion } from "../../../shared/cartridge/runtimeCapabilities";
import { DEFAULT_UI_LAYOUT_PATH, UI_LAYOUT_VERSION, migrateLegacyUISkinLayout, validateUISkinHealth, validateUISkinLayout } from "../../../shared/cartridge/uiSkin";
import { validateAssetReferences, validateManifest, validateNoAIMetadata, validateNoEditorFields, validateRuntimeScript } from "../../../shared/cartridge/validators";
import type { AssetManifestItem, BackgroundFit, DialogVisualStyle, GalleryManifest, GameManifest, RuntimeScript } from "../../../shared/cartridge/types";
import type { UISkinLayout } from "../../../shared/cartridge/uiSkin";
import type { AssetRef } from "../types/assets";
import type { PackageAppearanceSettings } from "../types/project";
import { collectProjectAssets } from "./collectProjectAssets";
import { normalizeAssetManifestPath } from "../utils/projectAssets";

export interface EditorCartridgeExportInput {
  script: RuntimeScript;
  gameId?: string;
  title: string;
  author: string;
  version: string;
  language: string;
  description: string;
  includeGallery: boolean;
  includeMetadata: boolean;
  projectAssets?: AssetManifestItem[];
  projectAssetRefs?: AssetRef[];
  uiSkin?: UISkinLayout;
  packageAppearance?: PackageAppearanceSettings;
  characterDialogStyles?: Record<string, DialogVisualStyle>;
}

export interface EditorCartridgeExportResult {
  blob: Blob;
  fileName: string;
  manifest: GameManifest;
  gallery: GalleryManifest;
  assetReport: {
    missingAssets: Array<{ asset_id: string; asset_type: string; source: string }>;
    placeholderAssets: Array<{ asset_id: string; asset_type: string; path: string }>;
  };
  errors: string[];
  warnings: string[];
}

export interface EditorPreviewDirectoryTextFile {
  path: string;
  contents: string;
}

export interface EditorPreviewDirectoryAsset {
  cartridgePath: string;
  assetId: string;
  sourceFilePath?: string;
  data?: Uint8Array;
  mimeType?: string;
  expectedSize?: number;
}

export interface EditorPreviewDirectoryExportResult {
  fileName: string;
  manifest: GameManifest;
  gallery: GalleryManifest;
  textFiles: EditorPreviewDirectoryTextFile[];
  assets: EditorPreviewDirectoryAsset[];
  assetReport: EditorCartridgeExportResult["assetReport"];
  errors: string[];
  warnings: string[];
}

async function dataUrlToBinary(dataUrl: string): Promise<Uint8Array> {
  const response = await fetch(dataUrl);
  return new Uint8Array(await response.arrayBuffer());
}

async function urlToBinary(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`request timed out after 20 seconds`);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Asset fetch failed: ${url}. ${reason}`);
  } finally {
    window.clearTimeout(timeout);
  }
}

function isMissingTauriCommand(error: unknown, command: string): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes(`Command ${command} not found`) || message.includes(`command ${command} not found`);
}

async function readDesktopAssetFile(filePath: string | undefined): Promise<Uint8Array | undefined> {
  if (!filePath) return undefined;
  if (!("__TAURI_INTERNALS__" in window)) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const bytes = await invoke<number[]>("read_project_asset_file_bytes", { filePath });
    return new Uint8Array(bytes);
  } catch (error) {
    if (isMissingTauriCommand(error, "read_project_asset_file_bytes")) {
      throw new Error("当前 AgentVN 桌面宿主尚未更新，缺少本地素材读取能力。请重启桌面端；如果仍然出现，请重新构建/安装最新桌面端后再启动预览。");
    }
    throw error;
  }
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPlaceholderAsset(manifestItem: AssetManifestItem): string {
  const label = escapeSvgText(manifestItem.asset_id || "missing_asset");
  if (manifestItem.asset_type === "background" || manifestItem.asset_type === "sprite" || manifestItem.asset_type === "portrait" || manifestItem.asset_type === "ui") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#17243a"/>
      <stop offset="0.58" stop-color="#263d50"/>
      <stop offset="1" stop-color="#10271d"/>
    </linearGradient>
    <pattern id="grid" width="92" height="92" patternUnits="userSpaceOnUse">
      <path d="M92 0H0v92" fill="none" stroke="#ffffff" stroke-opacity=".11" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect width="1280" height="720" fill="url(#grid)"/>
  <rect x="82" y="86" width="1116" height="548" rx="20" fill="#07111f" fill-opacity=".42" stroke="#ffffff" stroke-opacity=".32" stroke-dasharray="18 16" stroke-width="3"/>
  <text x="118" y="170" font-family="sans-serif" font-size="42" font-weight="700" fill="#f4f8ff">Placeholder Asset</text>
  <text x="118" y="230" font-family="sans-serif" font-size="28" fill="#d8e3ef">Missing final asset: ${label}</text>
  <text x="118" y="560" font-family="monospace" font-size="22" fill="#aebdcc">placeholder=true</text>
</svg>`;
    return svg;
  }
  if (manifestItem.asset_type === "animation") {
    return JSON.stringify({ id: manifestItem.asset_id, placeholder: true, duration: 0 }, null, 2);
  }
  return `AgentVN placeholder asset: ${manifestItem.asset_id}\n`;
}

function normalizeGameId(value?: string): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_.-]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "agentvn_game";
}

async function buildCartridgeAssets(manifestAssets: AssetManifestItem[], projectAssetRefs: AssetRef[] = []) {
  const refById = new Map(projectAssetRefs.map((asset) => [asset.asset_id, asset]));
  const assets = [];
  for (const manifestItem of manifestAssets) {
    const ref = refById.get(manifestItem.asset_id);
    const dataUrl = ref?.metadata.data_url;
    const blobUrl = ref?.metadata.blob_url;
    const assetUrl = ref?.metadata.url;
    const filePath = ref?.metadata.filePath;
    if (dataUrl) {
      assets.push({ path: manifestItem.path, data: await dataUrlToBinary(dataUrl), manifestItem });
    } else if (blobUrl?.startsWith("blob:")) {
      assets.push({ path: manifestItem.path, data: new Uint8Array(await (await fetch(blobUrl)).arrayBuffer()), manifestItem });
    } else if (assetUrl) {
      try {
        assets.push({ path: manifestItem.path, data: await urlToBinary(assetUrl), manifestItem });
      } catch (error) {
        const fallbackData = await readDesktopAssetFile(filePath);
        if (fallbackData) {
          assets.push({ path: manifestItem.path, data: fallbackData, manifestItem });
          continue;
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to package asset ${manifestItem.asset_id} (${manifestItem.asset_type}) from ${assetUrl}: ${reason}`);
      }
    } else if (filePath) {
      const fallbackData = await readDesktopAssetFile(filePath);
      if (fallbackData) {
        assets.push({ path: manifestItem.path, data: fallbackData, manifestItem });
      } else {
        assets.push({ path: manifestItem.path, data: buildPlaceholderAsset(manifestItem), manifestItem });
      }
    } else {
      assets.push({ path: manifestItem.path, data: buildPlaceholderAsset(manifestItem), manifestItem });
    }
  }
  return assets;
}

async function buildPreviewDirectoryAssets(manifestAssets: AssetManifestItem[], projectAssetRefs: AssetRef[] = []): Promise<EditorPreviewDirectoryAsset[]> {
  const refById = new Map(projectAssetRefs.map((asset) => [asset.asset_id, asset]));
  const assets: EditorPreviewDirectoryAsset[] = [];
  for (const manifestItem of manifestAssets) {
    const ref = refById.get(manifestItem.asset_id);
    const dataUrl = ref?.metadata.data_url;
    const blobUrl = ref?.metadata.blob_url;
    const assetUrl = ref?.metadata.url;
    const filePath = ref?.metadata.filePath;
    if (filePath) {
      assets.push({
        cartridgePath: manifestItem.path,
        assetId: manifestItem.asset_id,
        sourceFilePath: filePath,
        mimeType: manifestItem.mime_type,
        expectedSize: manifestItem.size_bytes,
      });
    } else if (dataUrl) {
      const data = await dataUrlToBinary(dataUrl);
      assets.push({ cartridgePath: manifestItem.path, assetId: manifestItem.asset_id, data, mimeType: manifestItem.mime_type, expectedSize: data.byteLength });
    } else if (blobUrl?.startsWith("blob:")) {
      const data = new Uint8Array(await (await fetch(blobUrl)).arrayBuffer());
      assets.push({ cartridgePath: manifestItem.path, assetId: manifestItem.asset_id, data, mimeType: manifestItem.mime_type, expectedSize: data.byteLength });
    } else if (assetUrl) {
      const data = await urlToBinary(assetUrl);
      assets.push({ cartridgePath: manifestItem.path, assetId: manifestItem.asset_id, data, mimeType: manifestItem.mime_type, expectedSize: data.byteLength });
    } else {
      const placeholder = new TextEncoder().encode(buildPlaceholderAsset(manifestItem));
      assets.push({ cartridgePath: manifestItem.path, assetId: manifestItem.asset_id, data: placeholder, mimeType: manifestItem.mime_type, expectedSize: placeholder.byteLength });
    }
  }
  return assets;
}

function mergeManifestAssets(baseAssets: AssetManifestItem[], extraAssets: AssetManifestItem[]): AssetManifestItem[] {
  return Array.from(new Map([...baseAssets, ...extraAssets].map((asset) => [asset.asset_id, asset])).values());
}

function sanitizeManifestAssetPaths(assets: AssetManifestItem[]): AssetManifestItem[] {
  return assets.map((asset) => ({
    ...asset,
    path: normalizeAssetManifestPath(asset.asset_type, asset.asset_id, asset.filename || `${asset.asset_id}.bin`, asset.path),
  }));
}

function normalizeBackgroundFit(value: unknown): BackgroundFit {
  return value === "contain" || value === "cover" || value === "stretch" ? value : "stretch";
}

function normalizeShellBackgroundDimming(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(0.9, parsed)) : fallback;
}

function buildRuntimeVisualAssets(
  appearance: PackageAppearanceSettings | undefined,
  projectAssetRefs: AssetRef[] = [],
  projectAssets: AssetManifestItem[] = [],
): { appearance: Pick<PackageAppearanceSettings, "settingsPanelBackgroundAssetId" | "settingsPanelBackgroundFit" | "settingsPanelBackgroundDimming" | "settingsEntryImageAssetId" | "about">; assets: AssetManifestItem[]; warnings: string[] } {
  const assetById = new Map(projectAssets.map((asset) => [asset.asset_id, asset]));
  const refById = new Map(projectAssetRefs.map((asset) => [asset.asset_id, asset]));
  const warnings: string[] = [];
  const assets: AssetManifestItem[] = [];
  const imageLikeTypes = new Set(["background", "sprite", "portrait", "ui"]);

  function resolveAsset(assetId: string | undefined, label: string): string | undefined {
    if (!assetId) return undefined;
    const manifestItem = assetById.get(assetId);
    const ref = refById.get(assetId);
    const assetType = manifestItem?.asset_type ?? ref?.asset_type;
    if (!manifestItem || !ref) {
      warnings.push(`${label} ${assetId} was not found in the asset library and will be skipped for runtime visuals.`);
      return undefined;
    }
    if (!assetType || !imageLikeTypes.has(assetType)) {
      warnings.push(`${label} ${assetId} is not an image or UI asset and will be skipped for runtime visuals.`);
      return undefined;
    }
    assets.push(manifestItem);
    return assetId;
  }

  return {
    appearance: {
      settingsPanelBackgroundAssetId: resolveAsset(appearance?.settingsPanelBackgroundAssetId, "Settings panel background"),
      settingsPanelBackgroundFit: normalizeBackgroundFit(appearance?.settingsPanelBackgroundFit),
      settingsPanelBackgroundDimming: normalizeShellBackgroundDimming(appearance?.settingsPanelBackgroundDimming, 0.24),
      settingsEntryImageAssetId: resolveAsset(appearance?.settingsEntryImageAssetId, "Settings entry image"),
      about: appearance?.about,
    },
    assets,
    warnings,
  };
}

function buildPackageAppearanceAssets(
  appearance: PackageAppearanceSettings | undefined,
  projectAssetRefs: AssetRef[] = [],
  projectAssets: AssetManifestItem[] = [],
): { appearance: PackageAppearanceSettings; assets: AssetManifestItem[]; warnings: string[] } {
  const assetById = new Map(projectAssets.map((asset) => [asset.asset_id, asset]));
  const refById = new Map(projectAssetRefs.map((asset) => [asset.asset_id, asset]));
  const warnings: string[] = [];
  const assets: AssetManifestItem[] = [];
  const imageLikeTypes = new Set(["background", "sprite", "portrait", "ui"]);

  function resolveAsset(assetId: string | undefined, label: string): string | undefined {
    if (!assetId) return undefined;
    const manifestItem = assetById.get(assetId);
    const ref = refById.get(assetId);
    const assetType = manifestItem?.asset_type ?? ref?.asset_type;
    if (!manifestItem || !ref) {
      warnings.push(`${label} ${assetId} was not found in the asset library and will be skipped for package appearance.`);
      return undefined;
    }
    if (!assetType || !imageLikeTypes.has(assetType)) {
      warnings.push(`${label} ${assetId} is not an image or UI asset and will be skipped for package appearance.`);
      return undefined;
    }
    assets.push(manifestItem);
    return assetId;
  }

  function resolveVideoAsset(assetId: string | undefined, label: string): string | undefined {
    if (!assetId) return undefined;
    const manifestItem = assetById.get(assetId);
    const ref = refById.get(assetId);
    const assetType = manifestItem?.asset_type ?? ref?.asset_type;
    if (!manifestItem || !ref) {
      warnings.push(`${label} ${assetId} was not found in the asset library and will be skipped for package appearance.`);
      return undefined;
    }
    if (assetType !== "video") {
      warnings.push(`${label} ${assetId} is not a video asset and will be skipped for package appearance.`);
      return undefined;
    }
    assets.push(manifestItem);
    return assetId;
  }

  return {
    appearance: {
      coverAssetId: resolveAsset(appearance?.coverAssetId, "Cover image"),
      titleBackgroundAssetId: resolveAsset(appearance?.titleBackgroundAssetId, "Title background"),
      titleBackgroundVideoAssetId: resolveVideoAsset(appearance?.titleBackgroundVideoAssetId, "Title background video"),
      titleBackgroundFit: normalizeBackgroundFit(appearance?.titleBackgroundFit),
      titleBackgroundDimming: normalizeShellBackgroundDimming(appearance?.titleBackgroundDimming, 0.18),
      iconAssetId: resolveAsset(appearance?.iconAssetId, "Game icon"),
    } as PackageAppearanceSettings,
    assets,
    warnings,
  };
}

function buildUISkinFontAssets(
  uiSkin: UISkinLayout | undefined,
  projectAssetRefs: AssetRef[] = [],
  projectAssets: AssetManifestItem[] = [],
): { assets: AssetManifestItem[]; warnings: string[] } {
  if (!uiSkin) return { assets: [], warnings: [] };
  const assetById = new Map(projectAssets.map((asset) => [asset.asset_id, asset]));
  const refById = new Map(projectAssetRefs.map((asset) => [asset.asset_id, asset]));
  const fontAssetIds = new Set<string>();
  if (typeof uiSkin.tokens?.fontAssetId === "string" && uiSkin.tokens.fontAssetId.trim()) {
    fontAssetIds.add(uiSkin.tokens.fontAssetId.trim());
  }
  for (const screen of uiSkin.screens ?? []) {
    for (const component of screen.components ?? []) {
      const fontAssetId = component.style?.fontAssetId;
      if (typeof fontAssetId === "string" && fontAssetId.trim()) fontAssetIds.add(fontAssetId.trim());
    }
  }

  const assets: AssetManifestItem[] = [];
  const warnings: string[] = [];
  for (const assetId of fontAssetIds) {
    const manifestItem = assetById.get(assetId);
    const ref = refById.get(assetId);
    const assetType = manifestItem?.asset_type ?? ref?.asset_type;
    if (!manifestItem || !ref) {
      warnings.push(`UI font asset ${assetId} was not found in the asset library and will not be packaged.`);
      continue;
    }
    if (assetType !== "font") {
      warnings.push(`UI font asset ${assetId} is ${assetType ?? "unknown"} instead of font and will not be packaged.`);
      continue;
    }
    assets.push(manifestItem);
  }
  return { assets, warnings };
}

function cleanDialogStyle(style: DialogVisualStyle | null | undefined): DialogVisualStyle | undefined {
  if (!style) return undefined;
  const fontSize = typeof style.font_size === "number" && Number.isFinite(style.font_size)
    ? Math.min(96, Math.max(10, Math.round(style.font_size)))
    : null;
  const fontWeight = typeof style.font_weight === "number" && Number.isFinite(style.font_weight)
    ? Math.min(900, Math.max(100, Math.round(style.font_weight / 50) * 50))
    : null;
  const next: DialogVisualStyle = {
    background_asset_id: style.background_asset_id || null,
    background_fit: style.background_fit === "stretch" || style.background_fit === "contain" || style.background_fit === "cover"
      ? style.background_fit
      : null,
    theme_color: /^#[0-9a-f]{6}$/i.test(style.theme_color ?? "") ? style.theme_color : null,
    text_color: /^#[0-9a-f]{6}$/i.test(style.text_color ?? "") ? style.text_color : null,
    font_size: fontSize,
    font_weight: fontWeight,
    font_style: style.font_style === "normal" || style.font_style === "italic" ? style.font_style : null,
  };
  return next.background_asset_id || next.background_fit || next.theme_color || next.text_color || next.font_size || next.font_weight || next.font_style ? next : undefined;
}

type DialogStyleRuntimeScript = {
  characters?: RuntimeScript["characters"];
};

export function applyCharacterDialogStylesToScript<T extends DialogStyleRuntimeScript>(script: T, styles: Record<string, DialogVisualStyle> | undefined): T {
  if (!styles || Object.keys(styles).length === 0) return script;
  const charactersById = new Map((script.characters ?? []).map((character) => [character.character_id, character]));
  for (const [characterId, style] of Object.entries(styles)) {
    const id = characterId.trim();
    const dialogStyle = cleanDialogStyle(style);
    if (!id || !dialogStyle) continue;
    const current = charactersById.get(id);
    charactersById.set(id, {
      character_id: id,
      name: current?.name ?? id,
      aliases: current?.aliases ?? [],
      dialog_style: dialogStyle,
    });
  }
  return { ...script, characters: [...charactersById.values()].sort((a, b) => a.character_id.localeCompare(b.character_id)) } as T;
}

export async function exportEditorCartridge(input: EditorCartridgeExportInput): Promise<EditorCartridgeExportResult> {
  const packageData = await createEditorCartridgeData(input);
  const cartridgeAssets = await buildCartridgeAssets(packageData.manifestAssets, input.projectAssetRefs);
  const blob = await packCartridgeToBlob({
    manifest: packageData.manifest,
    script: packageData.normalizedScript,
    gallery: packageData.gallery,
    uiSkin: packageData.uiSkin,
    assets: cartridgeAssets,
    exportOptions: {
      includeGallery: input.includeGallery,
      includeMetadata: input.includeMetadata,
      fileName: packageData.fileName
    }
  });
  return {
    blob,
    fileName: packageData.fileName,
    manifest: packageData.manifest,
    gallery: packageData.gallery,
    assetReport: packageData.assetReport,
    errors: packageData.errors,
    warnings: packageData.warnings,
  };
}

async function createEditorCartridgeData(input: EditorCartridgeExportInput) {
  const now = new Date().toISOString();
  const uiSkin = input.uiSkin ? migrateLegacyUISkinLayout(input.uiSkin) : undefined;
  const preparedScript: RuntimeScript = applyCharacterDialogStylesToScript({
    ...input.script,
    game_id: normalizeGameId(input.gameId || input.script.game_id),
    title: input.title || input.script.title || "AgentVN Game"
  }, input.characterDialogStyles);
  const normalizedScript: RuntimeScript = {
    ...preparedScript,
    schema_version: runtimeScriptSchemaVersion(preparedScript),
  };
  const scan = collectProjectAssets(normalizedScript, input.projectAssets);
  const packageAppearance = buildPackageAppearanceAssets(input.packageAppearance, input.projectAssetRefs, input.projectAssets);
  const runtimeVisuals = buildRuntimeVisualAssets(input.packageAppearance, input.projectAssetRefs, input.projectAssets);
  const uiSkinFonts = buildUISkinFontAssets(uiSkin, input.projectAssetRefs, input.projectAssets);
  const manifestAssets = sanitizeManifestAssetPaths(mergeManifestAssets(scan.manifestAssets, [...packageAppearance.assets, ...runtimeVisuals.assets, ...uiSkinFonts.assets]));
  const shell: NonNullable<GameManifest["shell"]> = {
    ...(packageAppearance.appearance.titleBackgroundAssetId ? { background: packageAppearance.appearance.titleBackgroundAssetId } : {}),
    ...(packageAppearance.appearance.titleBackgroundVideoAssetId ? { background_video: packageAppearance.appearance.titleBackgroundVideoAssetId } : {}),
    ...(packageAppearance.appearance.titleBackgroundAssetId ? { background_fit: packageAppearance.appearance.titleBackgroundFit ?? "stretch" } : {}),
    ...(packageAppearance.appearance.titleBackgroundAssetId ? { title_background_dimming: packageAppearance.appearance.titleBackgroundDimming ?? 0.18 } : {}),
    ...(packageAppearance.appearance.iconAssetId ? { icon: packageAppearance.appearance.iconAssetId } : {}),
    ...(runtimeVisuals.appearance.settingsPanelBackgroundAssetId ? { settings_panel_background: runtimeVisuals.appearance.settingsPanelBackgroundAssetId } : {}),
    ...(runtimeVisuals.appearance.settingsPanelBackgroundAssetId ? { settings_panel_background_fit: runtimeVisuals.appearance.settingsPanelBackgroundFit ?? "stretch" } : {}),
    ...(runtimeVisuals.appearance.settingsPanelBackgroundAssetId ? { settings_panel_background_dimming: runtimeVisuals.appearance.settingsPanelBackgroundDimming ?? 0.24 } : {}),
    ...(runtimeVisuals.appearance.settingsEntryImageAssetId ? { settings_entry_image: runtimeVisuals.appearance.settingsEntryImageAssetId } : {}),
    ...(runtimeVisuals.appearance.about ? { about: runtimeVisuals.appearance.about } : {}),
  };
  const manifest: GameManifest = {
    manifest_version: MANIFEST_VERSION,
    cartridge_version: CARTRIDGE_FORMAT_VERSION,
    runtime_version: minimumRuntimeVersionForScript(normalizedScript),
    game_id: normalizedScript.game_id,
    title: normalizedScript.title,
    author: input.author || "Unknown",
    description: input.description,
    version: input.version || "0.1.0",
    language: input.language || "zh-CN",
    tags: [],
    ...(packageAppearance.appearance.coverAssetId ? { cover: packageAppearance.appearance.coverAssetId } : {}),
    ...(Object.keys(shell).length > 0 ? { shell } : {}),
    entry_script: "script.json",
    entry_scene_id: normalizedScript.entry_scene_id,
    assets: manifestAssets,
    created_at: now,
    updated_at: now,
    ...(uiSkin ? { ui_skin: { path: DEFAULT_UI_LAYOUT_PATH, version: UI_LAYOUT_VERSION, name: uiSkin.name } } : {})
  };
  const gallery: GalleryManifest = { gallery_version: "1.0.0", items: [] };
  const validations = [
    validateManifest(manifest),
    validateRuntimeScript(normalizedScript, manifest),
    validateAssetReferences(normalizedScript, manifest),
    ...(uiSkin ? [validateUISkinLayout(uiSkin)] : []),
    ...(uiSkin ? [validateUISkinHealth(uiSkin, {
      availableAssetPaths: manifestAssets.map((asset) => asset.path),
      availableAssetIds: manifestAssets.map((asset) => asset.asset_id),
    })] : []),
    validateNoEditorFields(normalizedScript),
    ...(uiSkin ? [validateNoEditorFields(uiSkin)] : []),
    validateNoAIMetadata(normalizedScript),
    ...(uiSkin ? [validateNoAIMetadata(uiSkin)] : [])
  ];
  const errors = validations.flatMap((result) => result.errors.map((item) => item.message));
  const warnings = [
    ...validations.flatMap((result) => result.warnings.map((item) => item.message)),
    ...packageAppearance.warnings,
    ...runtimeVisuals.warnings,
    ...uiSkinFonts.warnings,
    ...scan.missingAssets.map((asset) => `Missing asset ${asset.asset_type} ${asset.asset_id} (${asset.source}). A placeholder was written into the exported package; replace it before release.`)
  ];
  if (errors.length > 0) throw new Error(errors.join("; "));
  const fileName = `${manifest.game_id}-${manifest.version}.vncart`;
  return {
    fileName,
    manifest,
    normalizedScript,
    gallery,
    uiSkin,
    manifestAssets,
    assetReport: {
      missingAssets: scan.missingAssets.map((asset) => ({ asset_id: asset.asset_id, asset_type: asset.asset_type, source: asset.source })),
      placeholderAssets: manifestAssets
        .filter((asset) => asset.placeholder || asset.tags?.includes("placeholder"))
        .map((asset) => ({ asset_id: asset.asset_id, asset_type: asset.asset_type, path: asset.path })),
    },
    errors,
    warnings,
  };
}

export async function createEditorLivePreviewData(input: EditorCartridgeExportInput) {
  const packageData = await createEditorCartridgeData(input);
  return {
    manifest: packageData.manifest,
    script: packageData.normalizedScript,
    uiSkin: packageData.uiSkin,
  };
}

export async function exportEditorPreviewDirectory(input: EditorCartridgeExportInput): Promise<EditorPreviewDirectoryExportResult> {
  const packageData = await createEditorCartridgeData(input);
  const textFiles: EditorPreviewDirectoryTextFile[] = [
    { path: "manifest.json", contents: JSON.stringify(packageData.manifest, null, 2) },
    { path: "script.json", contents: JSON.stringify(packageData.normalizedScript, null, 2) },
  ];
  if (input.includeGallery !== false) {
    textFiles.push({ path: "gallery.json", contents: JSON.stringify(packageData.gallery, null, 2) });
  }
  if (packageData.uiSkin) {
    textFiles.push({
      path: packageData.manifest.ui_skin?.path ?? DEFAULT_UI_LAYOUT_PATH,
      contents: JSON.stringify(packageData.uiSkin, null, 2),
    });
  }
  const assets = await buildPreviewDirectoryAssets(packageData.manifestAssets, input.projectAssetRefs);
  return {
    fileName: packageData.fileName,
    manifest: packageData.manifest,
    gallery: packageData.gallery,
    textFiles,
    assets,
    assetReport: packageData.assetReport,
    errors: packageData.errors,
    warnings: packageData.warnings,
  };
}

export function downloadCartridge(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
