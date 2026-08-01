import { create } from "zustand";
import type { AssetRef } from "../types/assets";
import type { MemoryMode } from "../types/memory";
import type {
  AssetLibrarySettings,
  AssetStudioProjectSettings,
  EditorAppearanceSettings,
  EditorCanvasBackgroundImage,
  PackageAppearanceSettings,
  ProjectState,
} from "../types/project";
import type { NovelPersistenceState } from "../novel-import/types";
import { normalizeNovelPersistenceState } from "../novel-import/persistence";
import type { AboutPanelCopy, BackgroundFit, DialogVisualStyle } from "../../../shared/cartridge/types";
import { getDefaultUISkinLayout, migrateLegacyUISkinLayout, type UISkinLayout } from "../../../shared/cartridge/uiSkin";
import { DEFAULT_SPRITE_SCALE, sanitizeSpriteScale } from "../../../shared/cartridge/spriteScale";
import { DEFAULT_SPEAKER_FOCUS, sanitizeSpeakerFocus } from "../../../shared/cartridge/speakerFocus";

interface ProjectActions {
  setMetadata: (metadata: Partial<Pick<ProjectState, "title" | "author">>) => void;
  createProject: (metadata: { title: string; author: string }) => void;
  loadProjectMetadata: (project: {
    project_id: string;
    title: string;
    author: string;
    asset_manifest?: unknown[];
    created_at?: string;
    updated_at?: string;
    editor_settings?: Record<string, unknown>;
  }) => void;
  setDefaultMemoryMode: (memoryMode: MemoryMode) => void;
  setPackageAppearance: (packageAppearance: PackageAppearanceSettings) => void;
  setEditorAppearance: (editorAppearance: EditorAppearanceSettings) => void;
  setRuntimeUILayout: (runtimeUILayout: UISkinLayout) => void;
  setCharacterDialogStyle: (characterId: string, style?: DialogVisualStyle | null) => void;
  setAssetLibrary: (assetLibrary: AssetLibrarySettings) => void;
  setAssetStudio: (assetStudio: AssetStudioProjectSettings) => void;
  setAssetManifest: (assets: AssetRef[]) => void;
  setNovelPersistence: (persistence?: NovelPersistenceState) => void;
  setDefaultSpriteScale: (scale: number) => void;
  setSpeakerFocus: (speakerFocus: ProjectState["settings"]["speakerFocus"]) => void;
}

const now = new Date().toISOString();
let lastGeneratedProjectIdMs = 0;
let generatedProjectIdSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function defaultAssetLibrary(): AssetLibrarySettings {
  return {
    folders: [],
    assetLocations: {},
  };
}

function randomProjectIdSuffix(): string {
  const cryptoSource = globalThis.crypto;
  if (cryptoSource?.randomUUID) return cryptoSource.randomUUID().replace(/-/g, "").slice(0, 10);
  if (cryptoSource?.getRandomValues) {
    const bytes = new Uint8Array(6);
    cryptoSource.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 10);
  }
  return Math.random().toString(36).slice(2, 12).padEnd(10, "0");
}

export function createUniqueProjectId(nowMs = Date.now()): string {
  const timestampMs = Number.isFinite(nowMs) ? Math.max(Math.floor(nowMs), lastGeneratedProjectIdMs) : Date.now();
  if (timestampMs === lastGeneratedProjectIdMs) {
    generatedProjectIdSequence += 1;
  } else {
    lastGeneratedProjectIdMs = timestampMs;
    generatedProjectIdSequence = 0;
  }
  return [
    "project",
    timestampMs.toString(36),
    generatedProjectIdSequence.toString(36),
    randomProjectIdSuffix(),
  ].join("_");
}

function sanitizeCharacterDisplayNames(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const names: Record<string, string> = {};
  for (const [characterId, displayName] of Object.entries(value)) {
    const id = characterId.trim();
    const name = typeof displayName === "string" ? displayName.trim() : "";
    if (id && name) names[id] = name.slice(0, 80);
  }
  return names;
}

function sanitizeAssetId(value: unknown, assetIds?: Set<string>): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (assetIds && !assetIds.has(trimmed)) return undefined;
  return trimmed;
}

function sanitizeBackgroundFit(value: unknown): BackgroundFit {
  return value === "contain" || value === "cover" || value === "stretch" ? value : "stretch";
}

function sanitizeShellBackgroundDimming(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(0.9, value));
}

function sanitizeOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function sanitizeAboutPanelCopy(value: unknown): AboutPanelCopy | undefined {
  if (!isRecord(value)) return undefined;
  const fields = Array.isArray(value.fields)
    ? value.fields
        .flatMap((field) => {
          if (!isRecord(field)) return [];
          const label = sanitizeOptionalText(field.label, 80);
          const fieldValue = sanitizeOptionalText(field.value, 240);
          return label || fieldValue ? [{ label, value: fieldValue }] : [];
        })
        .slice(0, 12)
    : undefined;
  const copy: AboutPanelCopy = {
    title: sanitizeOptionalText(value.title, 80),
    kicker: sanitizeOptionalText(value.kicker, 80),
    heading: sanitizeOptionalText(value.heading, 120),
    description: sanitizeOptionalText(value.description, 800),
    fields: fields && fields.length > 0 ? fields : undefined,
    note: sanitizeOptionalText(value.note, 800),
  };
  return Object.values(copy).some((item) => Array.isArray(item) ? item.length > 0 : Boolean(item)) ? copy : undefined;
}

function sanitizeEditorCanvasBackgroundImage(value: unknown): EditorCanvasBackgroundImage | undefined {
  if (!isRecord(value)) return undefined;
  const dataUrl = typeof value.dataUrl === "string" ? value.dataUrl.trim() : "";
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const filePath = typeof value.filePath === "string" ? value.filePath.trim() : "";
  const backendAssetPath = typeof value.backendAssetPath === "string" ? value.backendAssetPath.trim() : "";
  const mimeType = typeof value.mimeType === "string" ? value.mimeType.trim().toLowerCase() : "";
  if (!dataUrl.startsWith("data:image/") && !url) return undefined;
  if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(mimeType)) return undefined;
  return {
    dataUrl: dataUrl || undefined,
    url: url || undefined,
    filePath: filePath || undefined,
    backendAssetPath: backendAssetPath || undefined,
    fileName: typeof value.fileName === "string" && value.fileName.trim() ? value.fileName.trim().slice(0, 180) : "editor-canvas-background",
    mimeType,
    sizeBytes: typeof value.sizeBytes === "number" && Number.isFinite(value.sizeBytes) && value.sizeBytes >= 0 ? Math.round(value.sizeBytes) : dataUrl.length,
    width: typeof value.width === "number" && Number.isFinite(value.width) && value.width > 0 ? Math.round(value.width) : undefined,
    height: typeof value.height === "number" && Number.isFinite(value.height) && value.height > 0 ? Math.round(value.height) : undefined,
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt : new Date().toISOString(),
  };
}

function sanitizePackageAppearance(value: unknown, assets?: AssetRef[]): PackageAppearanceSettings {
  const source = isRecord(value) ? value : {};
  const assetIds = assets ? new Set(assets.map((asset) => asset.asset_id)) : undefined;
  return {
    coverAssetId: sanitizeAssetId(source.coverAssetId, assetIds),
    titleBackgroundAssetId: sanitizeAssetId(source.titleBackgroundAssetId, assetIds),
    titleBackgroundVideoAssetId: sanitizeAssetId(source.titleBackgroundVideoAssetId, assetIds),
    titleBackgroundFit: sanitizeBackgroundFit(source.titleBackgroundFit),
    titleBackgroundDimming: sanitizeShellBackgroundDimming(source.titleBackgroundDimming, 0.18),
    iconAssetId: sanitizeAssetId(source.iconAssetId, assetIds),
    standaloneIconAssetId: sanitizeAssetId(source.standaloneIconAssetId, assetIds),
    settingsPanelBackgroundAssetId: sanitizeAssetId(source.settingsPanelBackgroundAssetId, assetIds),
    settingsPanelBackgroundFit: sanitizeBackgroundFit(source.settingsPanelBackgroundFit),
    settingsPanelBackgroundDimming: sanitizeShellBackgroundDimming(source.settingsPanelBackgroundDimming, 0.24),
    settingsEntryImageAssetId: sanitizeAssetId(source.settingsEntryImageAssetId, assetIds),
    about: sanitizeAboutPanelCopy(source.about),
  };
}

function sanitizeEditorAppearance(value: unknown, assets?: AssetRef[]): EditorAppearanceSettings {
  const source = isRecord(value) ? value : {};
  const opacity = typeof source.canvasBackgroundOpacity === "number" && Number.isFinite(source.canvasBackgroundOpacity)
    ? Math.min(0.72, Math.max(0, source.canvasBackgroundOpacity))
    : 0.38;
  const fit = source.canvasBackgroundFit === "contain" || source.canvasBackgroundFit === "tile" || source.canvasBackgroundFit === "cover"
    ? source.canvasBackgroundFit
    : "cover";
  const migratedAsset = typeof source.canvasBackgroundAssetId === "string" && assets
    ? assets.find((asset) => asset.asset_id === source.canvasBackgroundAssetId)
    : undefined;
  let migratedImage: EditorCanvasBackgroundImage | undefined;
  const migratedDataUrl = migratedAsset?.metadata.data_url;
  if (migratedAsset && migratedDataUrl?.startsWith("data:image/")) {
    const mimeEnd = migratedDataUrl.indexOf(";");
    migratedImage = {
      dataUrl: migratedDataUrl,
      fileName: migratedAsset.metadata.filename ?? migratedAsset.metadata.display_name ?? `${migratedAsset.asset_id}.png`,
      mimeType: migratedAsset.metadata.mime_type ?? (mimeEnd > 5 ? migratedDataUrl.slice(5, mimeEnd) : "image/png"),
      sizeBytes: migratedAsset.metadata.size_bytes ?? migratedDataUrl.length,
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    canvasBackgroundImage: sanitizeEditorCanvasBackgroundImage(source.canvasBackgroundImage) ?? sanitizeEditorCanvasBackgroundImage(migratedImage),
    canvasBackgroundOpacity: opacity,
    canvasBackgroundFit: fit,
  };
}

function sanitizeThemeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : undefined;
}

function sanitizeDialogFontSize(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded >= 10 && rounded <= 96 ? rounded : undefined;
}

function sanitizeDialogFontWeight(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value / 50) * 50;
  return rounded >= 100 && rounded <= 900 ? rounded : undefined;
}

function sanitizeDialogFontStyle(value: unknown): "normal" | "italic" | undefined {
  return value === "normal" || value === "italic" ? value : undefined;
}

function sanitizeDialogVisualStyle(value: unknown, assets?: AssetRef[]): DialogVisualStyle | undefined {
  if (!isRecord(value)) return undefined;
  const assetIds = assets ? new Set(assets.map((asset) => asset.asset_id)) : undefined;
  const backgroundAssetId = sanitizeAssetId(value.background_asset_id, assetIds) ?? null;
  const style: DialogVisualStyle = {
    background_asset_id: backgroundAssetId,
    background_fit: value.background_fit === "stretch" || value.background_fit === "contain" || value.background_fit === "cover"
      ? value.background_fit
      : null,
    theme_color: sanitizeThemeColor(value.theme_color) ?? null,
    text_color: sanitizeThemeColor(value.text_color) ?? null,
    font_size: sanitizeDialogFontSize(value.font_size) ?? null,
    font_weight: sanitizeDialogFontWeight(value.font_weight) ?? null,
    font_style: sanitizeDialogFontStyle(value.font_style) ?? null,
  };
  return style.background_asset_id || style.background_fit || style.theme_color || style.text_color || style.font_size || style.font_weight || style.font_style ? style : undefined;
}

function sanitizeCharacterDialogStyles(value: unknown, assets?: AssetRef[]): Record<string, DialogVisualStyle> {
  const source = isRecord(value) ? value : {};
  const styles: Record<string, DialogVisualStyle> = {};
  for (const [characterId, rawStyle] of Object.entries(source)) {
    const id = characterId.trim();
    if (!id) continue;
    const style = sanitizeDialogVisualStyle(rawStyle, assets);
    if (style) styles[id] = style;
  }
  return styles;
}

function folderHasCycle(folderId: string, parentById: Map<string, string | null>): boolean {
  const seen = new Set<string>();
  let current: string | null | undefined = folderId;
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentById.get(current) ?? null;
  }
  return false;
}

function sanitizeAssetLibrary(value: unknown, assets?: AssetRef[]): AssetLibrarySettings {
  const source = isRecord(value) ? value : {};
  const rawFolders = Array.isArray(source.folders) ? source.folders : [];
  const timestamp = new Date().toISOString();
  const folders = rawFolders
    .map((item) => {
      if (!isRecord(item) || typeof item.folder_id !== "string" || !item.folder_id.trim()) return undefined;
      return {
        folder_id: item.folder_id.trim(),
        name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "未命名文件夹",
        parent_folder_id: typeof item.parent_folder_id === "string" && item.parent_folder_id.trim() ? item.parent_folder_id.trim() : null,
        created_at: typeof item.created_at === "string" ? item.created_at : timestamp,
        updated_at: typeof item.updated_at === "string" ? item.updated_at : timestamp,
      };
    })
    .filter((folder): folder is AssetLibrarySettings["folders"][number] => Boolean(folder));
  const uniqueFolders = Array.from(new Map(folders.map((folder) => [folder.folder_id, folder])).values());
  const folderIds = new Set(uniqueFolders.map((folder) => folder.folder_id));
  const parentById = new Map<string, string | null>();
  for (const folder of uniqueFolders) {
    parentById.set(folder.folder_id, folder.parent_folder_id && folderIds.has(folder.parent_folder_id) && folder.parent_folder_id !== folder.folder_id ? folder.parent_folder_id : null);
  }
  const safeFolders = uniqueFolders.map((folder) => ({
    ...folder,
    parent_folder_id: folderHasCycle(folder.folder_id, parentById) ? null : parentById.get(folder.folder_id) ?? null,
  }));
  const safeFolderIds = new Set(safeFolders.map((folder) => folder.folder_id));
  const assetIds = assets ? new Set(assets.map((asset) => asset.asset_id)) : undefined;
  const rawLocations = isRecord(source.assetLocations) ? source.assetLocations : {};
  const assetLocations: AssetLibrarySettings["assetLocations"] = {};
  for (const [assetId, location] of Object.entries(rawLocations)) {
    if (assetIds && !assetIds.has(assetId)) continue;
    if (!isRecord(location)) continue;
    const primaryFolderId = typeof location.primaryFolderId === "string" && safeFolderIds.has(location.primaryFolderId)
      ? location.primaryFolderId
      : null;
    const linkedFolderIds = Array.isArray(location.linkedFolderIds)
      ? Array.from(new Set(location.linkedFolderIds.filter((id): id is string => typeof id === "string" && safeFolderIds.has(id) && id !== primaryFolderId)))
      : [];
    if (primaryFolderId || linkedFolderIds.length > 0) {
      assetLocations[assetId] = { primaryFolderId, linkedFolderIds };
    }
  }
  return { folders: safeFolders, assetLocations };
}

function defaultSettings(): ProjectState["settings"] {
  return {
    defaultMemoryMode: "hybrid",
    defaultSpriteScale: DEFAULT_SPRITE_SCALE,
    speakerFocus: DEFAULT_SPEAKER_FOCUS,
    packageAppearance: sanitizePackageAppearance(undefined),
    editorAppearance: sanitizeEditorAppearance(undefined),
    runtimeUILayout: getDefaultUISkinLayout(),
    characterDisplayNames: {},
    characterDialogStyles: {},
    assetLibrary: defaultAssetLibrary(),
    assetStudio: defaultAssetStudio(),
  };
}

function sanitizeSettings(settings?: Record<string, unknown>, assets?: AssetRef[]): ProjectState["settings"] {
  const next = { ...defaultSettings(), ...(settings as Partial<ProjectState["settings"]> | undefined) };
  return {
    defaultMemoryMode: next.defaultMemoryMode,
    defaultSpriteScale: sanitizeSpriteScale(next.defaultSpriteScale, DEFAULT_SPRITE_SCALE),
    speakerFocus: sanitizeSpeakerFocus(next.speakerFocus),
    packageAppearance: sanitizePackageAppearance(next.packageAppearance, assets),
    editorAppearance: sanitizeEditorAppearance(next.editorAppearance, assets),
    runtimeUILayout: migrateLegacyUISkinLayout(next.runtimeUILayout),
    characterDisplayNames: sanitizeCharacterDisplayNames(next.characterDisplayNames),
    characterDialogStyles: sanitizeCharacterDialogStyles(next.characterDialogStyles, assets),
    assetLibrary: sanitizeAssetLibrary(next.assetLibrary, assets),
    assetStudio: sanitizeAssetStudio(next.assetStudio),
    novelPersistence: next.novelPersistence ? normalizeNovelPersistenceState(next.novelPersistence) : undefined,
  };
}

export const useProjectStore = create<ProjectState & ProjectActions>()(
  (set) => ({
      projectId: "project_local",
      title: "\u672A\u547D\u540D\u89C6\u89C9\u5C0F\u8BF4",
      author: "",
      schemaVersion: "1.0.0",
      editorVersion: "0.1.0",
      createdAt: now,
      updatedAt: now,
      assetManifest: [],
      recentFiles: [],
      settings: defaultSettings(),

      setMetadata: (metadata) =>
        set({
          ...metadata,
          updatedAt: new Date().toISOString(),
        }),

      createProject: ({ title, author }) => {
        const timestamp = new Date().toISOString();
        set({
          projectId: createUniqueProjectId(),
          title: title.trim() || "\u672A\u547D\u540D\u89C6\u89C9\u5C0F\u8BF4",
          author: author.trim(),
          schemaVersion: "1.0.0",
          editorVersion: "0.1.0",
          createdAt: timestamp,
          updatedAt: timestamp,
          assetManifest: [],
          recentFiles: [],
          settings: defaultSettings(),
        });
      },

      loadProjectMetadata: (project) =>
        set((state) => {
          const assetManifest = (project.asset_manifest as AssetRef[] | undefined) ?? state.assetManifest;
          return {
            projectId: project.project_id,
            title: project.title || "\u672A\u547D\u540D\u89C6\u89C9\u5C0F\u8BF4",
            author: project.author || "",
            assetManifest,
            createdAt: project.created_at ?? state.createdAt,
            updatedAt: project.updated_at ?? new Date().toISOString(),
            settings: sanitizeSettings(project.editor_settings, assetManifest),
          };
        }),

      setDefaultMemoryMode: (defaultMemoryMode) =>
        set((state) => ({
          settings: { ...state.settings, defaultMemoryMode },
          updatedAt: new Date().toISOString(),
        })),

      setDefaultSpriteScale: (defaultSpriteScale) =>
        set((state) => ({
          settings: { ...state.settings, defaultSpriteScale: sanitizeSpriteScale(defaultSpriteScale, DEFAULT_SPRITE_SCALE) },
          updatedAt: new Date().toISOString(),
        })),

      setSpeakerFocus: (speakerFocus) =>
        set((state) => ({
          settings: { ...state.settings, speakerFocus: sanitizeSpeakerFocus(speakerFocus) },
          updatedAt: new Date().toISOString(),
        })),

      setPackageAppearance: (packageAppearance) =>
        set((state) => ({
          settings: { ...state.settings, packageAppearance: sanitizePackageAppearance(packageAppearance, state.assetManifest) },
          updatedAt: new Date().toISOString(),
        })),

      setEditorAppearance: (editorAppearance) =>
        set((state) => ({
          settings: { ...state.settings, editorAppearance: sanitizeEditorAppearance(editorAppearance, state.assetManifest) },
          updatedAt: new Date().toISOString(),
        })),

      setRuntimeUILayout: (runtimeUILayout) =>
        set((state) => ({
          settings: { ...state.settings, runtimeUILayout: migrateLegacyUISkinLayout(runtimeUILayout) },
          updatedAt: new Date().toISOString(),
        })),

      setCharacterDialogStyle: (characterId, style) =>
        set((state) => {
          const id = characterId.trim();
          if (!id) return state;
          const characterDialogStyles = { ...state.settings.characterDialogStyles };
          const sanitized = sanitizeDialogVisualStyle(style, state.assetManifest);
          if (sanitized) characterDialogStyles[id] = sanitized;
          else delete characterDialogStyles[id];
          return {
            settings: { ...state.settings, characterDialogStyles },
            updatedAt: new Date().toISOString(),
          };
        }),

      setAssetLibrary: (assetLibrary) =>
        set((state) => ({
          settings: { ...state.settings, assetLibrary: sanitizeAssetLibrary(assetLibrary, state.assetManifest) },
          updatedAt: new Date().toISOString(),
        })),

      setAssetStudio: (assetStudio) =>
        set((state) => ({
          settings: { ...state.settings, assetStudio: sanitizeAssetStudio(assetStudio) },
          updatedAt: new Date().toISOString(),
        })),

      setAssetManifest: (assetManifest) =>
        set((state) => ({
          assetManifest,
          settings: {
            ...state.settings,
            packageAppearance: sanitizePackageAppearance(state.settings.packageAppearance, assetManifest),
            editorAppearance: sanitizeEditorAppearance(state.settings.editorAppearance, assetManifest),
            characterDialogStyles: sanitizeCharacterDialogStyles(state.settings.characterDialogStyles, assetManifest),
            assetLibrary: sanitizeAssetLibrary(state.settings.assetLibrary, assetManifest),
          },
          updatedAt: new Date().toISOString(),
        })),

      setNovelPersistence: (persistence) =>
        set((state) => ({
          settings: {
            ...state.settings,
            novelPersistence: persistence ? normalizeNovelPersistenceState(persistence) : undefined,
          },
          updatedAt: new Date().toISOString(),
        })),
    })
);

if (typeof window !== "undefined") {
  (window as Window & { __AGENTVN_PROJECT_STORE__?: typeof useProjectStore }).__AGENTVN_PROJECT_STORE__ = useProjectStore;
}

function defaultAssetStudio(): AssetStudioProjectSettings {
  return {
    version: 1,
    advancedOpen: false,
    leftWidth: 360,
    rightWidth: 344,
    customPresets: [],
  };
}

function sanitizeAssetStudio(value: unknown): AssetStudioProjectSettings {
  if (!isRecord(value)) return defaultAssetStudio();
  const clamp = (candidate: unknown, fallback: number, min: number, max: number) =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.min(max, Math.max(min, Math.round(candidate)))
      : fallback;
  const redactPresetSecrets = (text: string) => text
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[密钥已移除]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}\b/gi, "Bearer [密钥已移除]");
  return {
    version: 1,
    advancedOpen: value.advancedOpen === true,
    leftWidth: clamp(value.leftWidth, 360, 320, 460),
    rightWidth: clamp(value.rightWidth, 344, 300, 440),
    customPresets: Array.isArray(value.customPresets)
      ? value.customPresets.slice(0, 50).flatMap((candidate) => {
          if (!isRecord(candidate)) return [];
          const assetType = typeof candidate.assetType === "string"
            && ["background", "sprite", "portrait", "cg", "ui"].includes(candidate.assetType)
            ? candidate.assetType as AssetStudioProjectSettings["customPresets"][number]["assetType"]
            : undefined;
          if (
            typeof candidate.presetId !== "string"
            || typeof candidate.name !== "string"
            || typeof candidate.stylePreset !== "string"
            || typeof candidate.aspectRatio !== "string"
            || !assetType
          ) return [];
          return [{
            presetId: candidate.presetId.slice(0, 120),
            name: candidate.name.slice(0, 80),
            assetType,
            stylePreset: candidate.stylePreset.slice(0, 120),
            aspectRatio: candidate.aspectRatio.slice(0, 20),
            width: clamp(candidate.width, 1024, 64, 4096),
            height: clamp(candidate.height, 1024, 64, 4096),
            promptTemplate: typeof candidate.promptTemplate === "string"
              ? redactPresetSecrets(candidate.promptTemplate).slice(0, 8_000)
              : undefined,
          }];
        })
      : [],
  };
}
