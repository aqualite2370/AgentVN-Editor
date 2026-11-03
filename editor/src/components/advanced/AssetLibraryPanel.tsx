import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  ImageIcon,
  Link2,
  MoreHorizontal,
  MoveRight,
  PanelLeft,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  Type,
  UploadCloud,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type { AssetRef, AssetType } from "../../types/assets";
import type { AssetLibraryAssetLocation, AssetLibraryFolder, AssetLibrarySettings } from "../../types/project";
import {
  applyAssetLibraryDrop,
  assetLibraryLocation,
  physicalPointToCssPoint,
  uniqueLibraryAssetId,
  type AssetDragPayload,
  type AssetDropMode,
} from "../../utils/assetLibraryInteractions";
import {
  assetRefToLibraryRecord,
  buildProjectAssetPath,
  isImagePreviewSource,
  type LibraryAssetRecord,
} from "../../utils/projectAssets";
import { assetTypeOptions } from "../../utils/localizedOptions";
import { safeVisibleText } from "../../utils/textSafety";
import { assetCategoryHint, assetTypeDisplayLabel } from "../../../../shared/cartridge/assetTaxonomy";
import { RichSelect } from "../common/RichSelect";

const ASSET_DRAG_MIME = "application/x-agentvn-asset-ids";
const ROOT_FOLDER_DROP_KEY = "__root__";
const ALL_ASSET_TYPES = "__all_asset_types__";
const ALL_ASSET_SOURCES = "__all_asset_sources__";

type AssetTypeFilter = AssetType | typeof ALL_ASSET_TYPES;
type AssetSourceFilter = keyof typeof sourceLabels | typeof ALL_ASSET_SOURCES;
type AssetSortMode = "newest" | "name" | "type";

const sourceLabels: Record<string, string> = {
  generated: "生成素材",
  imported: "导入素材",
  edited: "编辑素材",
  bundled: "内置素材",
};

const assetSourceOptions = [
  { value: ALL_ASSET_SOURCES, label: "全部来源" },
  ...Object.entries(sourceLabels).map(([value, label]) => ({ value, label })),
];

const assetSortOptions: Array<{ value: AssetSortMode; label: string }> = [
  { value: "newest", label: "最近加入" },
  { value: "name", label: "按名称" },
  { value: "type", label: "按类型" },
];

interface PendingImport {
  dataUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  mediaWarning?: string;
}

interface FolderOption {
  id: string | null;
  label: string;
}

interface DropTargetState {
  folderId: string | null;
  mode: AssetDropMode;
  count: number;
  external: boolean;
  invalid?: boolean;
}

interface FeedbackState {
  tone: "success" | "warning" | "info";
  text: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("读取素材失败"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取素材失败"));
    reader.readAsDataURL(file);
  });
}

function readMediaMetadata(source: string): Promise<Pick<PendingImport, "width" | "height" | "durationMs">> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("音视频元数据读取超时。"));
    }, 10000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined;
      const result = {
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        durationMs,
      };
      cleanup();
      resolve(result);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("当前 WebView 无法解析该音视频的编码或容器。"));
    };
    video.src = source;
  });
}

function readImageMetadata(source: string): Promise<Pick<PendingImport, "width" | "height">> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({
      width: image.naturalWidth || undefined,
      height: image.naturalHeight || undefined,
    });
    image.onerror = () => reject(new Error("无法读取图片内容，文件可能已损坏。"));
    image.src = source;
  });
}

function inferImportMimeType(file: Pick<File, "name" | "type">): string {
  if (file.type) return file.type;
  if (/\.png$/i.test(file.name)) return "image/png";
  if (/\.jpe?g$/i.test(file.name)) return "image/jpeg";
  if (/\.webp$/i.test(file.name)) return "image/webp";
  if (/\.gif$/i.test(file.name)) return "image/gif";
  if (/\.bmp$/i.test(file.name)) return "image/bmp";
  if (/\.svg$/i.test(file.name)) return "image/svg+xml";
  if (/\.wav$/i.test(file.name)) return "audio/wav";
  if (/\.mp3$/i.test(file.name)) return "audio/mpeg";
  if (/\.ogg$/i.test(file.name)) return "audio/ogg";
  if (/\.m4a$/i.test(file.name)) return "audio/mp4";
  if (/\.flac$/i.test(file.name)) return "audio/flac";
  if (/\.woff2$/i.test(file.name)) return "font/woff2";
  if (/\.woff$/i.test(file.name)) return "font/woff";
  if (/\.ttf$/i.test(file.name)) return "font/ttf";
  if (/\.otf$/i.test(file.name)) return "font/otf";
  if (/\.mp4$/i.test(file.name)) return "video/mp4";
  if (/\.webm$/i.test(file.name)) return "video/webm";
  if (/\.mov$/i.test(file.name)) return "video/quicktime";
  if (/\.json$/i.test(file.name)) return "application/json";
  return "application/octet-stream";
}

function isSupportedImportFile(file: Pick<File, "name" | "type">): boolean {
  const mimeType = inferImportMimeType(file);
  return (
    mimeType.startsWith("image/")
    || mimeType.startsWith("audio/")
    || mimeType.startsWith("video/")
    || mimeType.startsWith("font/")
    || mimeType === "application/json"
    || /\.(png|jpe?g|webp|gif|bmp|svg|wav|mp3|ogg|m4a|flac|mp4|webm|mov|json|ttf|otf|woff2?)$/i.test(file.name)
  );
}

function defaultAssetTypeForFile(file: Pick<File, "name" | "type">): AssetType {
  const mimeType = inferImportMimeType(file);
  if (mimeType.startsWith("font/") || /\.(ttf|otf|woff2?)$/i.test(file.name)) return "font";
  if (mimeType.startsWith("audio/") || /\.(wav|mp3|ogg|m4a|flac)$/i.test(file.name)) return "bgm";
  if (mimeType.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name)) return "video";
  if (mimeType === "application/json" || /\.json$/i.test(file.name)) return "animation";
  return "background";
}

function fileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function assetDisplayName(asset: LibraryAssetRecord): string {
  return safeVisibleText(asset.display_name, safeAssetFilename(asset));
}

function updateAssetType(asset: AssetRef, nextAssetType: AssetType): AssetRef {
  return {
    ...asset,
    asset_type: nextAssetType,
    metadata: {
      ...asset.metadata,
      source: "edited",
      project_path: buildProjectAssetPath(
        nextAssetType,
        asset.asset_id,
        asset.metadata.filename ?? `${asset.asset_id}.bin`,
      ),
    },
  };
}

function safeAssetFilename(asset: LibraryAssetRecord): string {
  return safeVisibleText(asset.filename, `${asset.asset_id}.bin`);
}

function makeFolderId(): string {
  return `folder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sortFolders(folders: AssetLibraryFolder[]): AssetLibraryFolder[] {
  return [...folders].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function assetIsVisibleInFolder(assetLibrary: AssetLibrarySettings, assetId: string, folderId: string | null): boolean {
  const location = assetLibraryLocation(assetLibrary, assetId);
  return location.primaryFolderId === folderId || (folderId !== null && location.linkedFolderIds.includes(folderId));
}

function removeEmptyLocation(location: AssetLibraryAssetLocation | undefined): AssetLibraryAssetLocation | undefined {
  if (!location) return undefined;
  if (!location.primaryFolderId && location.linkedFolderIds.length === 0) return undefined;
  return location;
}

function folderDescendantIds(folders: AssetLibraryFolder[], folderId: string): Set<string> {
  const descendants = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parent_folder_id && descendants.has(folder.parent_folder_id) && !descendants.has(folder.folder_id)) {
        descendants.add(folder.folder_id);
        changed = true;
      }
    }
  }
  return descendants;
}

function folderPath(folders: AssetLibraryFolder[], folderId: string | null): AssetLibraryFolder[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((folder) => [folder.folder_id, folder]));
  const path: AssetLibraryFolder[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.folder_id)) {
    path.unshift(current);
    seen.add(current.folder_id);
    current = current.parent_folder_id ? byId.get(current.parent_folder_id) : undefined;
  }
  return path;
}

function buildFolderOptions(folders: AssetLibraryFolder[]): FolderOption[] {
  const children = new Map<string | null, AssetLibraryFolder[]>();
  for (const folder of folders) {
    const key = folder.parent_folder_id ?? null;
    children.set(key, [...(children.get(key) ?? []), folder]);
  }
  for (const [key, value] of children.entries()) children.set(key, sortFolders(value));

  const options: FolderOption[] = [{ id: null, label: "未归档素材" }];
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of children.get(parentId) ?? []) {
      options.push({ id: folder.folder_id, label: `${"　".repeat(depth)}${depth > 0 ? "└ " : ""}${folder.name}` });
      visit(folder.folder_id, depth + 1);
    }
  };
  visit(null, 0);
  return options;
}

function folderName(folders: AssetLibraryFolder[], folderId: string | null): string {
  if (!folderId) return "未归档素材";
  return folders.find((folder) => folder.folder_id === folderId)?.name ?? "目标文件夹";
}

async function prepareAutomaticImport(file: File): Promise<PendingImport> {
  if (!isSupportedImportFile(file)) throw new Error(`${file.name}：不支持的文件格式`);
  if (file.size === 0) throw new Error(`${file.name}：文件为空或无法读取`);
  const mimeType = inferImportMimeType(file);
  if (mimeType === "application/json" || /\.json$/i.test(file.name)) {
    try {
      JSON.parse(await file.text());
    } catch {
      throw new Error(`${file.name}：JSON 内容损坏或格式无效`);
    }
  }
  const dataUrl = await readFileAsDataUrl(file);
  const pending: PendingImport = {
    dataUrl,
    fileName: file.name,
    mimeType,
    sizeBytes: file.size,
  };
  if (pending.mimeType.startsWith("image/")) {
    Object.assign(pending, await readImageMetadata(dataUrl));
  } else if (pending.mimeType.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name)) {
    try {
      Object.assign(pending, await readMediaMetadata(dataUrl));
    } catch (error) {
      reportFrontendError("editor.asset-library", error, {
        operation: "read-video-metadata",
        fileName: file.name,
      });
      pending.mediaWarning = error instanceof Error ? error.message : "无法读取视频元数据。";
    }
  }
  return pending;
}

function pendingImportToAsset(
  pending: PendingImport,
  assetType: AssetType,
  assetId: string,
  licenseNote?: string,
): AssetRef {
  return {
    asset_id: assetId,
    asset_type: assetType,
    metadata: {
      display_name: fileStem(pending.fileName),
      filename: pending.fileName,
      mime_type: pending.mimeType,
      size_bytes: pending.sizeBytes,
      width: pending.width,
      height: pending.height,
      duration_ms: pending.durationMs,
      media_warning: pending.mediaWarning,
      source: "imported",
      license_note: licenseNote?.trim() || undefined,
      data_url: pending.dataUrl,
      blob_url: pending.dataUrl,
      project_path: buildProjectAssetPath(assetType, assetId, pending.fileName),
      created_at: new Date().toISOString(),
    },
  };
}

function parseDragPayload(dataTransfer: DataTransfer): AssetDragPayload | undefined {
  try {
    const value = dataTransfer.getData(ASSET_DRAG_MIME);
    if (!value) return undefined;
    const parsed = JSON.parse(value) as Partial<AssetDragPayload>;
    if (!Array.isArray(parsed.assetIds)) return undefined;
    return {
      assetIds: parsed.assetIds.filter((value): value is string => typeof value === "string"),
      sourceFolderId: typeof parsed.sourceFolderId === "string" ? parsed.sourceFolderId : null,
    };
  } catch {
    // error-log-ignore: 其他拖拽来源的数据不是素材库协议，直接忽略即可。
    return undefined;
  }
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button,input,select,textarea,label,[role='menu']"));
}

export function AssetLibraryPanel({
  assets,
  assetLibrary,
  onImportMany,
  onUpdateMany,
  onAssetLibraryChange,
  onDeleteMany,
}: {
  assets: AssetRef[];
  assetLibrary: AssetLibrarySettings;
  onImportMany: (entries: Array<{ asset: AssetRef; folderId: string | null }>) => void;
  onUpdateMany: (assets: AssetRef[]) => void;
  onAssetLibraryChange: (assetLibrary: AssetLibrarySettings) => void;
  onDeleteMany: (assetIds: string[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replacementReadGenerationRef = useRef(0);
  const replacementReadTypeRef = useRef<AssetType | undefined>(undefined);
  useEffect(() => () => { ++replacementReadGenerationRef.current; }, []);
  const hoverExpandTimerRef = useRef<number | undefined>(undefined);
  const hoverExpandFolderRef = useRef<string | undefined>(undefined);
  const nativePathsRef = useRef<string[]>([]);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [replacementTargetId, setReplacementTargetId] = useState<string | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<PendingImport | null>(null);
  const [assetType, setAssetType] = useState<AssetType>("background");
  const [licenseNote, setLicenseNote] = useState("");
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<FeedbackState>();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [showAllAssets, setShowAllAssets] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>(ALL_ASSET_TYPES);
  const [sourceFilter, setSourceFilter] = useState<AssetSourceFilter>(ALL_ASSET_SOURCES);
  const [sortMode, setSortMode] = useState<AssetSortMode>("newest");
  const [batchAssetType, setBatchAssetType] = useState<AssetType>("background");
  const [folderDraftName, setFolderDraftName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [batchTargetFolderId, setBatchTargetFolderId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set());
  const [dragPayload, setDragPayload] = useState<AssetDragPayload>();
  const [dropTarget, setDropTarget] = useState<DropTargetState>();
  const [isImporting, setIsImporting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const libraryAssets = useMemo(() => assets.map(assetRefToLibraryRecord), [assets]);
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.asset_id, asset])), [assets]);
  const folders = assetLibrary.folders;
  const childrenByFolderId = useMemo(() => {
    const children = new Map<string | null, AssetLibraryFolder[]>();
    for (const folder of folders) {
      const parentId = folder.parent_folder_id ?? null;
      children.set(parentId, [...(children.get(parentId) ?? []), folder]);
    }
    for (const [parentId, childFolders] of children.entries()) {
      children.set(parentId, sortFolders(childFolders));
    }
    return children;
  }, [folders]);
  const folderAssets = useMemo(
    () => showAllAssets
      ? libraryAssets
      : libraryAssets.filter((asset) => assetIsVisibleInFolder(assetLibrary, asset.asset_id, currentFolderId)),
    [assetLibrary, currentFolderId, libraryAssets, showAllAssets],
  );
  const visibleAssets = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("zh-CN");
    const filtered = folderAssets.filter((asset) => {
      if (typeFilter !== ALL_ASSET_TYPES && asset.asset_type !== typeFilter) return false;
      if (sourceFilter !== ALL_ASSET_SOURCES && asset.source !== sourceFilter) return false;
      if (!query) return true;
      return [
        assetDisplayName(asset),
        asset.asset_id,
        safeAssetFilename(asset),
        asset.license_note ?? "",
        assetTypeDisplayLabel(asset.asset_type),
        sourceLabels[asset.source] ?? "",
      ].some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
    });
    return [...filtered].sort((left, right) => {
      if (sortMode === "name") {
        return assetDisplayName(left).localeCompare(assetDisplayName(right), "zh-CN", { numeric: true });
      }
      if (sortMode === "type") {
        const typeOrder = assetTypeDisplayLabel(left.asset_type).localeCompare(assetTypeDisplayLabel(right.asset_type), "zh-CN");
        return typeOrder || assetDisplayName(left).localeCompare(assetDisplayName(right), "zh-CN", { numeric: true });
      }
      return Date.parse(right.created_at) - Date.parse(left.created_at)
        || assetDisplayName(left).localeCompare(assetDisplayName(right), "zh-CN", { numeric: true });
    });
  }, [folderAssets, searchQuery, sortMode, sourceFilter, typeFilter]);
  const selectedCount = selectedAssetIds.size;
  const allVisibleSelected = visibleAssets.length > 0
    && visibleAssets.every((asset) => selectedAssetIds.has(asset.asset_id));
  const hasActiveFilters = Boolean(searchQuery.trim())
    || typeFilter !== ALL_ASSET_TYPES
    || sourceFilter !== ALL_ASSET_SOURCES
    || sortMode !== "newest";
  const folderOptions = useMemo(() => buildFolderOptions(folders), [folders]);
  const typeFilterOptions = useMemo(
    () => [{ value: ALL_ASSET_TYPES, label: "全部类型" }, ...assetTypeOptions],
    [],
  );
  const folderCounts = useMemo(() => {
    const counts = new Map<string | null, number>();
    for (const asset of assets) {
      const location = assetLibraryLocation(assetLibrary, asset.asset_id);
      counts.set(location.primaryFolderId, (counts.get(location.primaryFolderId) ?? 0) + 1);
      for (const linkedFolderId of location.linkedFolderIds) {
        counts.set(linkedFolderId, (counts.get(linkedFolderId) ?? 0) + 1);
      }
    }
    return counts;
  }, [assetLibrary, assets]);
  const breadcrumbs = useMemo(
    () => showAllAssets ? [] : folderPath(folders, currentFolderId),
    [currentFolderId, folders, showAllAssets],
  );
  const activeFolderId = showAllAssets ? null : currentFolderId;

  useEffect(() => {
    if (currentFolderId && !folders.some((folder) => folder.folder_id === currentFolderId)) {
      setCurrentFolderId(null);
    }
  }, [currentFolderId, folders]);

  useEffect(() => {
    const visibleAssetIds = new Set(visibleAssets.map((asset) => asset.asset_id));
    setSelectedAssetIds((current) => {
      const next = new Set([...current].filter((assetId) => visibleAssetIds.has(assetId)));
      return next.size === current.size ? current : next;
    });
  }, [visibleAssets]);

  useEffect(() => {
    if (breadcrumbs.length === 0) return;
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const folder of breadcrumbs) {
        if (!next.has(folder.folder_id)) {
          next.add(folder.folder_id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [breadcrumbs]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(undefined), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const importFiles = useCallback(async (files: File[], targetFolderId: string | null) => {
    if (files.length === 0) return;
    setIsImporting(true);
    setError(undefined);
    setFeedback({ tone: "info", text: `正在导入 ${files.length} 个文件到${folderName(folders, targetFolderId)}…` });
    const prepared = await Promise.allSettled(files.map(prepareAutomaticImport));
    const usedIds = new Set(assets.map((asset) => asset.asset_id));
    const entries: Array<{ asset: AssetRef; folderId: string | null }> = [];
    const failures: string[] = [];

    prepared.forEach((result, index) => {
      if (result.status === "rejected") {
        failures.push(result.reason instanceof Error ? result.reason.message : `${files[index].name}：读取失败`);
        return;
      }
      const nextAssetType = defaultAssetTypeForFile(files[index]);
      const assetId = uniqueLibraryAssetId(fileStem(result.value.fileName), usedIds);
      entries.push({
        asset: pendingImportToAsset(result.value, nextAssetType, assetId),
        folderId: targetFolderId,
      });
    });

    if (entries.length > 0) onImportMany(entries);
    setIsImporting(false);
    if (failures.length > 0) {
      setError(failures.slice(0, 3).join("；") + (failures.length > 3 ? `；另有 ${failures.length - 3} 个文件` : ""));
    }
    setFeedback({
      tone: failures.length > 0 ? "warning" : "success",
      text: `已导入 ${entries.length} 个素材${failures.length > 0 ? `，跳过 ${failures.length} 个` : ""}，目标：${folderName(folders, targetFolderId)}。`,
    });
  }, [assets, folders, onImportMany]);

  const importNativePaths = useCallback(async (paths: string[], targetFolderId: string | null) => {
    if (paths.length === 0) return;
    const fileResults = await Promise.allSettled(paths.map(async (filePath) => {
      const name = fileNameFromPath(filePath);
      const type = inferImportMimeType({ name, type: "" });
      const bytes = await invoke<number[]>("read_project_asset_file_bytes", { filePath });
      const buffer = Uint8Array.from(bytes).buffer as ArrayBuffer;
      return new File([buffer], name, { type });
    }));
    const files: File[] = [];
    const unreadable: string[] = [];
    fileResults.forEach((result, index) => {
      if (result.status === "fulfilled") files.push(result.value);
      else unreadable.push(`${fileNameFromPath(paths[index])}：无法读取，目录不会递归导入`);
    });
    await importFiles(files, targetFolderId);
    if (unreadable.length > 0) {
      setError(unreadable.slice(0, 3).join("；"));
      setFeedback((current) => ({
        tone: "warning",
        text: `${current?.text ?? ""} 跳过 ${unreadable.length} 个无法读取的项目。`.trim(),
      }));
    }
  }, [importFiles]);

  const resolveNativeDropTarget = useCallback((x: number, y: number, scaleFactor: number): string | null | undefined => {
    const cssPoint = physicalPointToCssPoint(x, y, scaleFactor);
    const element = document.elementFromPoint(cssPoint.x, cssPoint.y);
    const folderTarget = element?.closest<HTMLElement>("[data-asset-drop-folder]");
    if (folderTarget) {
      const folderId = folderTarget.dataset.assetDropFolder;
      return folderId === ROOT_FOLDER_DROP_KEY ? null : folderId ?? currentFolderId;
    }
    if (element?.closest("[data-asset-drop-surface='current']")) {
      return showAllAssets ? undefined : currentFolderId;
    }
    return undefined;
  }, [currentFolderId, showAllAssets]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const scaleFactor = await getCurrentWindow().scaleFactor();
      const nextUnlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (disposed) return;
        const payload = event.payload;
        if (payload.type === "leave") {
          nativePathsRef.current = [];
          setDropTarget(undefined);
          return;
        }
        if (payload.type === "enter") nativePathsRef.current = payload.paths;
        const targetFolderId = resolveNativeDropTarget(payload.position.x, payload.position.y, scaleFactor);
        if (targetFolderId === undefined) {
          setDropTarget(undefined);
          if (payload.type === "drop") {
            nativePathsRef.current = [];
            setFeedback({ tone: "warning", text: "未导入文件：请投放到文件夹或当前素材区。" });
          }
          return;
        }
        const count = payload.type === "drop" ? payload.paths.length : nativePathsRef.current.length;
        setDropTarget({ folderId: targetFolderId, mode: "move", count, external: true });
        if (payload.type === "drop") {
          nativePathsRef.current = [];
          setDropTarget(undefined);
          void importNativePaths(payload.paths, targetFolderId);
        }
      });
      if (disposed) nextUnlisten();
      else unlisten = nextUnlisten;
    })().catch((reason) => {
      if (!disposed) {
        reportFrontendError("editor.asset-library", reason, {
          operation: "enable-native-drop",
        });
        setError(reason instanceof Error ? reason.message : "无法启用桌面文件拖入。");
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [importNativePaths, resolveNativeDropTarget]);

  async function prepareImport(file: File, forcedType?: AssetType) {
    try {
      const nextPending = await prepareAutomaticImport(file);
      setPendingImport(nextPending);
      setAssetType(forcedType ?? defaultAssetTypeForFile(file));
      setLicenseNote("");
      setError(undefined);
    } catch (readError) {
      reportFrontendError("editor.asset-library", readError, {
        operation: "read-import-file",
        fileName: file.name,
      });
      setError(readError instanceof Error ? readError.message : "读取素材失败");
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 1) {
      await prepareImport(files[0]);
      return;
    }
    if (files.length > 1) await importFiles(files, activeFolderId);
  }

  async function handleFontFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await prepareImport(file, "font");
  }

  async function handleReplacementFileChange(event: ChangeEvent<HTMLInputElement>) {
    const generation = ++replacementReadGenerationRef.current;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !replacementTargetId) return;
    setPendingReplacement(null);
    setError(undefined);
    const original = assetsById.get(replacementTargetId);
    if (!original) {
      setReplacementTargetId(null);
      setError("原素材已不存在，请重新选择。");
      return;
    }
    replacementReadTypeRef.current = original.asset_type;
    const mime = inferImportMimeType(file);
    const category = mime.startsWith("image/") ? "image"
      : mime.startsWith("audio/") ? "audio"
      : mime.startsWith("video/") ? "video"
      : mime.startsWith("font/") ? "font"
      : mime === "application/json" ? "animation" : "unsupported";
    const expected = ["background", "sprite", "portrait", "ui"].includes(original.asset_type) ? "image"
      : ["bgm", "sfx", "voice"].includes(original.asset_type) ? "audio"
      : original.asset_type === "other" ? category : original.asset_type;
    if (category === "unsupported" || category !== expected) {
      setError(`文件格式与${assetTypeDisplayLabel(original.asset_type)}不兼容，原素材未改变。`);
      return;
    }
    try {
      const pending = await prepareAutomaticImport(file);
      if (pending.mediaWarning) throw new Error(pending.mediaWarning);
      if (category === "audio") {
        Object.assign(pending, await readMediaMetadata(pending.dataUrl));
      }
      if (generation !== replacementReadGenerationRef.current) return;
      setPendingReplacement(pending);
      setError(undefined);
    } catch (reason) {
      if (generation !== replacementReadGenerationRef.current) {
        reportFrontendError("editor.asset-library", reason, { operation: "stale-replacement-read", fileName: file.name });
        return;
      }
      setError(`${reason instanceof Error ? reason.message : "无法读取替换文件。"} 原素材未改变。`);
    }
  }

  function confirmReplacement() {
    if (!replacementTargetId || !pendingReplacement) return;
    const original = assetsById.get(replacementTargetId);
    if (!original) {
      setError("原素材已不存在，请重新选择。");
      return;
    }
    if (original.asset_type !== replacementReadTypeRef.current) {
      setError("原素材类型已改变，请重新选择替换文件。原素材未改变。");
      return;
    }
    ++replacementReadGenerationRef.current;
    const replacement = pendingImportToAsset(pendingReplacement, original.asset_type, original.asset_id);
    onUpdateMany([{
      ...original,
      metadata: {
        ...original.metadata,
        ...replacement.metadata,
        display_name: original.metadata.display_name,
        source: "imported",
        license_note: undefined,
        provider_id: undefined,
        model: undefined,
        prompt: undefined,
        generation: undefined,
        filePath: undefined,
        url: undefined,
        backend_asset_path: undefined,
        bytes: undefined,
        path: undefined,
        hash_sha256: undefined,
        placeholder: undefined,
        created_at: original.metadata.created_at,
      },
    }]);
    setFeedback({ tone: "success", text: `已替换“${assetDisplayName(assetRefToLibraryRecord(original))}”的文件；原素材 ID 与引用保持不变。请重新核对授权说明。` });
    setPendingReplacement(null);
    setReplacementTargetId(null);
    setError(undefined);
  }

  function confirmImport() {
    if (!pendingImport) return;
    const assetId = uniqueLibraryAssetId(fileStem(pendingImport.fileName), new Set(assets.map((asset) => asset.asset_id)));
    onImportMany([{
      asset: pendingImportToAsset(pendingImport, assetType, assetId, licenseNote),
      folderId: activeFolderId,
    }]);
    setPendingImport(null);
    setAssetType("background");
    setLicenseNote("");
    setError(undefined);
    setFeedback({ tone: "success", text: `已将 ${pendingImport.fileName} 保存到${folderName(folders, activeFolderId)}。` });
  }

  function cancelImport() {
    setPendingImport(null);
    setAssetType("background");
    setLicenseNote("");
    setError(undefined);
  }

  function createFolder() {
    const name = folderDraftName.trim();
    if (!name) {
      setError("请先填写文件夹名称。");
      return;
    }
    const timestamp = new Date().toISOString();
    const folderId = makeFolderId();
    onAssetLibraryChange({
      ...assetLibrary,
      folders: [
        ...assetLibrary.folders,
        {
          folder_id: folderId,
          name,
          parent_folder_id: activeFolderId,
          created_at: timestamp,
          updated_at: timestamp,
        },
      ],
    });
    if (activeFolderId) {
      setExpandedFolderIds((current) => new Set(current).add(activeFolderId));
    }
    setFolderDraftName("");
    setError(undefined);
    setFeedback({ tone: "success", text: `已创建文件夹“${name}”。` });
  }

  function startRename(folder: AssetLibraryFolder) {
    setEditingFolderId(folder.folder_id);
    setEditingFolderName(folder.name);
  }

  function confirmRename() {
    const name = editingFolderName.trim();
    if (!editingFolderId || !name) {
      setEditingFolderId(null);
      setEditingFolderName("");
      return;
    }
    const timestamp = new Date().toISOString();
    onAssetLibraryChange({
      ...assetLibrary,
      folders: assetLibrary.folders.map((folder) =>
        folder.folder_id === editingFolderId ? { ...folder, name, updated_at: timestamp } : folder
      ),
    });
    setEditingFolderId(null);
    setEditingFolderName("");
    setFeedback({ tone: "success", text: `文件夹已重命名为“${name}”。` });
  }

  function deleteFolder(folder: AssetLibraryFolder) {
    if (!window.confirm(`删除文件夹“${folder.name}”及其子文件夹？素材不会被删除，会回到上一级文件夹。`)) return;
    const deletedIds = folderDescendantIds(assetLibrary.folders, folder.folder_id);
    const fallbackFolderId = folder.parent_folder_id ?? null;
    const assetLocations: AssetLibrarySettings["assetLocations"] = {};
    for (const [assetId, location] of Object.entries(assetLibrary.assetLocations)) {
      const primaryFolderId = location.primaryFolderId && deletedIds.has(location.primaryFolderId)
        ? fallbackFolderId
        : location.primaryFolderId;
      const linkedFolderIds = location.linkedFolderIds.filter((folderId) => !deletedIds.has(folderId) && folderId !== primaryFolderId);
      const nextLocation = removeEmptyLocation({ primaryFolderId, linkedFolderIds });
      if (nextLocation) assetLocations[assetId] = nextLocation;
    }
    onAssetLibraryChange({
      folders: assetLibrary.folders.filter((item) => !deletedIds.has(item.folder_id)),
      assetLocations,
    });
    if (currentFolderId && deletedIds.has(currentFolderId)) setCurrentFolderId(fallbackFolderId);
    setSelectedAssetIds(new Set());
    setFeedback({ tone: "success", text: `已删除文件夹“${folder.name}”，素材已移至上一级。` });
  }

  function toggleAssetSelection(assetId: string) {
    setSelectedAssetIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  function toggleAllVisibleAssets() {
    setSelectedAssetIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const asset of visibleAssets) next.delete(asset.asset_id);
      } else {
        for (const asset of visibleAssets) next.add(asset.asset_id);
      }
      return next;
    });
  }

  function invertVisibleSelection() {
    setSelectedAssetIds((current) => {
      const next = new Set(current);
      for (const asset of visibleAssets) {
        if (next.has(asset.asset_id)) next.delete(asset.asset_id);
        else next.add(asset.asset_id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedAssetIds(new Set());
  }

  function resetManagementFilters() {
    setSearchQuery("");
    setTypeFilter(ALL_ASSET_TYPES);
    setSourceFilter(ALL_ASSET_SOURCES);
    setSortMode("newest");
  }

  function changeSelectedAssetType() {
    const updatedAssets = [...selectedAssetIds]
      .map((assetId) => assetsById.get(assetId))
      .filter((asset): asset is AssetRef => Boolean(asset))
      .filter((asset) => asset.asset_type !== batchAssetType)
      .map((asset) => updateAssetType(asset, batchAssetType));
    if (updatedAssets.length === 0) {
      setFeedback({ tone: "warning", text: `选中的素材已经全部是${assetTypeDisplayLabel(batchAssetType)}。` });
      return;
    }
    onUpdateMany(updatedAssets);
    setFeedback({
      tone: "success",
      text: `已将 ${updatedAssets.length} 个素材批量修改为${assetTypeDisplayLabel(batchAssetType)}。`,
    });
  }

  function deleteSelectedAssets() {
    const selectedAssets = [...selectedAssetIds]
      .map((assetId) => assetsById.get(assetId))
      .filter((asset): asset is AssetRef => Boolean(asset));
    if (selectedAssets.length === 0) return;
    const sampleNames = selectedAssets
      .slice(0, 3)
      .map((asset) => safeVisibleText(asset.metadata.display_name, asset.metadata.filename ?? asset.asset_id))
      .join("、");
    const extraCount = Math.max(0, selectedAssets.length - 3);
    const summary = `${sampleNames}${extraCount > 0 ? ` 等 ${selectedAssets.length} 个素材` : ""}`;
    if (!window.confirm(`确定删除 ${summary}？已引用这些素材的位置可能会显示缺失，此操作无法撤销。`)) return;
    onDeleteMany(selectedAssets.map((asset) => asset.asset_id));
    clearSelection();
    setFeedback({ tone: "success", text: `已批量删除 ${selectedAssets.length} 个素材。` });
  }

  function performAssetDrop(payload: AssetDragPayload, targetFolderId: string | null, mode: AssetDropMode) {
    const result = applyAssetLibraryDrop(assetLibrary, payload, targetFolderId, mode);
    if (result.changedAssetIds.length === 0) {
      setFeedback({
        tone: "warning",
        text: mode === "link" && !targetFolderId
          ? "未归档素材不能作为关联分类，请直接移动。"
          : "素材已经位于目标位置，没有发生变更。",
      });
      return;
    }
    onAssetLibraryChange(result.library);
    clearSelection();
    setFeedback({
      tone: "success",
      text: `${mode === "link" ? "已关联" : "已移动"} ${result.changedAssetIds.length} 个素材到${folderName(folders, targetFolderId)}。`,
    });
  }

  function moveSelectedAssets() {
    performAssetDrop(
      { assetIds: [...selectedAssetIds], sourceFolderId: activeFolderId },
      batchTargetFolderId,
      "move",
    );
  }

  function copySelectedAssets() {
    performAssetDrop(
      { assetIds: [...selectedAssetIds], sourceFolderId: activeFolderId },
      batchTargetFolderId,
      "link",
    );
  }

  function clearHoverExpand() {
    if (hoverExpandTimerRef.current) window.clearTimeout(hoverExpandTimerRef.current);
    hoverExpandTimerRef.current = undefined;
    hoverExpandFolderRef.current = undefined;
  }

  function scheduleFolderExpand(folderId: string) {
    if (expandedFolderIds.has(folderId) || hoverExpandFolderRef.current === folderId) return;
    clearHoverExpand();
    hoverExpandFolderRef.current = folderId;
    hoverExpandTimerRef.current = window.setTimeout(() => {
      setExpandedFolderIds((current) => new Set(current).add(folderId));
      clearHoverExpand();
    }, 600);
  }

  function describeDropTarget(state: DropTargetState): string {
    if (state.invalid) return "不能复制到未归档素材";
    if (state.external) return `导入 ${state.count || "多个"} 个文件到${folderName(folders, state.folderId)}`;
    return `${state.mode === "link" ? "复制分类" : "移动"} ${state.count} 个素材到${folderName(folders, state.folderId)}`;
  }

  function handleDragOver(event: DragEvent<HTMLElement>, targetFolderId: string | null) {
    const payload = dragPayload ?? parseDragPayload(event.dataTransfer);
    const isExternal = !payload && event.dataTransfer.types.includes("Files");
    if (!isExternal && !payload) return;
    event.preventDefault();
    event.stopPropagation();
    const mode: AssetDropMode = !isExternal && event.ctrlKey ? "link" : "move";
    const invalid = mode === "link" && targetFolderId === null;
    event.dataTransfer.dropEffect = invalid ? "none" : mode === "link" ? "copy" : "move";
    setDropTarget({
      folderId: targetFolderId,
      mode,
      count: isExternal ? event.dataTransfer.files.length || 1 : payload?.assetIds.length ?? 0,
      external: isExternal,
      invalid,
    });
    if (targetFolderId && (childrenByFolderId.get(targetFolderId)?.length ?? 0) > 0) {
      scheduleFolderExpand(targetFolderId);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDropTarget(undefined);
    clearHoverExpand();
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetFolderId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);
    const payload = dragPayload ?? parseDragPayload(event.dataTransfer);
    const mode: AssetDropMode = files.length === 0 && event.ctrlKey ? "link" : "move";
    setDropTarget(undefined);
    setDragPayload(undefined);
    clearHoverExpand();
    if (files.length > 0) {
      void importFiles(files, targetFolderId);
      return;
    }
    if (payload) performAssetDrop(payload, targetFolderId, mode);
  }

  function startAssetDrag(event: DragEvent<HTMLElement>, assetId: string) {
    const assetIds = selectedAssetIds.has(assetId) ? [...selectedAssetIds] : [assetId];
    const payload: AssetDragPayload = { assetIds, sourceFolderId: activeFolderId };
    if (!selectedAssetIds.has(assetId)) setSelectedAssetIds(new Set([assetId]));
    setDragPayload(payload);
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", assetIds.join(", "));
  }

  function finishAssetDrag() {
    setDragPayload(undefined);
    setDropTarget(undefined);
    clearHoverExpand();
  }

  function openFolder(folderId: string | null) {
    setShowAllAssets(false);
    setCurrentFolderId(folderId);
    clearSelection();
    setSidebarOpen(false);
  }

  function openAllAssets() {
    setShowAllAssets(true);
    clearSelection();
    setSidebarOpen(false);
  }

  function renderFolderNode(folder: AssetLibraryFolder, depth: number): React.ReactElement {
    const children = childrenByFolderId.get(folder.folder_id) ?? [];
    const expanded = expandedFolderIds.has(folder.folder_id);
    const current = currentFolderId === folder.folder_id;
    const activeDrop = dropTarget?.folderId === folder.folder_id;
    const editing = editingFolderId === folder.folder_id;
    return (
      <li key={folder.folder_id} className="asset-folder-tree-item">
        <div
          className={`asset-folder-tree-row${current ? " is-current" : ""}${activeDrop ? " is-drop-target" : ""}${dropTarget?.invalid && activeDrop ? " is-drop-invalid" : ""}`}
          style={{ "--asset-folder-depth": depth } as CSSProperties}
          data-asset-drop-folder={folder.folder_id}
          onDragEnter={(event) => handleDragOver(event, folder.folder_id)}
          onDragOver={(event) => handleDragOver(event, folder.folder_id)}
          onDragLeave={handleDragLeave}
          onDrop={(event) => handleDrop(event, folder.folder_id)}
        >
          <button
            type="button"
            className="asset-folder-tree-toggle"
            data-help-key="asset.folder.toggle"
            aria-label={children.length > 0 ? `${expanded ? "折叠" : "展开"} ${folder.name}` : undefined}
            aria-expanded={children.length > 0 ? expanded : undefined}
            disabled={children.length === 0}
            onClick={() => setExpandedFolderIds((currentIds) => {
              const next = new Set(currentIds);
              if (next.has(folder.folder_id)) next.delete(folder.folder_id);
              else next.add(folder.folder_id);
              return next;
            })}
          >
            {children.length > 0 ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span />}
          </button>
          <button
            type="button"
            className="asset-folder-tree-main"
            data-help-key="asset.folder.open"
            onClick={() => openFolder(folder.folder_id)}
          >
            {current ? <FolderOpen size={17} /> : <Folder size={17} />}
            <span title={folder.name}>{folder.name}</span>
            <small>{folderCounts.get(folder.folder_id) ?? 0}</small>
          </button>
          <span className="asset-folder-tree-actions">
            <button type="button" data-help-key="asset.folder.rename" aria-label={`重命名 ${folder.name}`} title="重命名" onClick={() => startRename(folder)}>
              <Pencil size={13} />
            </button>
            <button type="button" data-help-key="asset.folder.delete" aria-label={`删除 ${folder.name}`} title="删除文件夹" onClick={() => deleteFolder(folder)}>
              <Trash2 size={13} />
            </button>
          </span>
          {activeDrop && <span className="asset-folder-drop-label">{describeDropTarget(dropTarget)}</span>}
        </div>
        {editing && (
          <div className="asset-folder-tree-rename" style={{ "--asset-folder-depth": depth } as CSSProperties}>
            <input
              value={editingFolderName}
              data-help-key="asset.folder.renameName"
              aria-label={`重命名 ${folder.name}`}
              autoFocus
              onChange={(event) => setEditingFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") confirmRename();
                if (event.key === "Escape") {
                  setEditingFolderId(null);
                  setEditingFolderName("");
                }
              }}
            />
            <button type="button" data-help-key="asset.folder.renameSave" onClick={confirmRename}><Check size={14} /></button>
          </div>
        )}
        {expanded && children.length > 0 && (
          <ul className="asset-folder-tree-children">
            {children.map((child) => renderFolderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <section className="advanced-card asset-library-panel">
      <div className="asset-library-header">
        <div>
          <h3>素材库</h3>
          <p>用文件夹整理项目素材。拖动卡片可移动，按住 Ctrl 拖动可复制分类，也可以从电脑直接拖入文件。</p>
        </div>
        <div className="row-actions">
          <button type="button" data-help-key="asset.folder.create" onClick={() => setFolderDraftName((current) => current || "新建文件夹")}>
            <FolderPlus size={15} /> 新建文件夹
          </button>
          <input data-help-key="editor.control" ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/*" hidden onChange={handleFontFileChange} />
          <button type="button" data-help-key="asset.importFont" onClick={() => fontInputRef.current?.click()}>
            <Type size={15} /> 导入字体
          </button>
          <input data-help-key="editor.control" ref={fileInputRef} type="file" multiple accept="image/*,audio/*,video/*,font/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.wav,.mp3,.ogg,.m4a,.flac,.mp4,.webm,.mov,.json,.ttf,.otf,.woff,.woff2" hidden onChange={handleFileChange} />
          <input data-help-key="asset.replace.file" ref={replaceInputRef} type="file" accept="image/*,audio/*,video/*,font/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.wav,.mp3,.ogg,.m4a,.flac,.mp4,.webm,.mov,.json,.ttf,.otf,.woff,.woff2" hidden onChange={(event) => void handleReplacementFileChange(event)} />
          <button type="button" data-help-key="asset.importImage" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud size={15} /> 导入素材
          </button>
        </div>
      </div>

      {pendingImport && (
        <section className="asset-import-card">
          <div className="asset-import-preview">
            {pendingImport.mimeType.startsWith("video/") ? (
              <video src={pendingImport.dataUrl} muted controls preload="metadata" />
            ) : isImagePreviewSource(pendingImport.dataUrl, { mimeType: pendingImport.mimeType, filename: pendingImport.fileName, assetType }) ? (
              <img src={pendingImport.dataUrl} alt={pendingImport.fileName} />
            ) : (
              <div className="asset-placeholder" title={pendingImport.mimeType || pendingImport.fileName}>{pendingImport.mimeType || pendingImport.fileName}</div>
            )}
          </div>
          <div className="asset-import-form">
            <strong>导入素材</strong>
            <small title={pendingImport.fileName}>素材 ID 将根据文件名自动生成并去重。</small>
            <label>
              素材类型
              <RichSelect value={assetType} options={assetTypeOptions} helpKey="asset.assetType" onChange={(nextAssetType) => setAssetType(nextAssetType as AssetType)} />
            </label>
            <label>
              授权备注（可选）
              <textarea
                value={licenseNote}
                data-help-key="asset.license"
                placeholder="例如 自绘 / 已购买商用授权 / 团队内部素材"
                onChange={(event) => setLicenseNote(event.target.value)}
              />
            </label>
            <small title={pendingImport.fileName}>{pendingImport.fileName} · {(pendingImport.sizeBytes / 1024).toFixed(1)} KB</small>
            {(pendingImport.width || pendingImport.height || pendingImport.durationMs) && (
              <small>
                {pendingImport.width && pendingImport.height ? `${pendingImport.width}×${pendingImport.height}` : ""}
                {pendingImport.durationMs ? ` · ${(pendingImport.durationMs / 1000).toFixed(1)} 秒` : ""}
              </small>
            )}
            {pendingImport.mediaWarning && <p className="inline-status warning">{pendingImport.mediaWarning}</p>}
            <div className="row-actions">
              <button type="button" data-help-key="asset.confirmImport" onClick={confirmImport}>保存到素材库</button>
              <button type="button" data-help-key="asset.cancelImport" onClick={cancelImport}>取消</button>
            </div>
          </div>
        </section>
      )}

      {pendingReplacement && replacementTargetId && (
        <section className="asset-import-card" role="dialog" aria-label="确认替换素材">
          <div className="asset-import-form">
            <strong>替换素材文件</strong>
            <p>将以“{pendingReplacement.fileName}”替换当前内容，保留素材 ID、类型、展示名、文件夹及工程引用。原文件授权和生成来源说明不会沿用，请重新核对。</p>
            <div className="row-actions">
              <button type="button" onClick={confirmReplacement}>确认替换</button>
              <button type="button" onClick={() => { ++replacementReadGenerationRef.current; setPendingReplacement(null); setReplacementTargetId(null); }}>取消</button>
            </div>
          </div>
        </section>
      )}

      <div className={`asset-library-workspace${dragPayload || dropTarget ? " is-drag-active" : ""}`}>
        {sidebarOpen && <button type="button" className="asset-library-sidebar-scrim" data-help-key="asset.sidebar.close" aria-label="关闭文件夹目录" onClick={() => setSidebarOpen(false)} />}
        <aside className={`asset-library-sidebar${sidebarOpen ? " is-open" : ""}`} aria-label="素材文件夹">
          <div className="asset-library-sidebar-header">
            <strong>文件夹</strong>
            <span>{assets.length} 个素材 · {folders.length} 个文件夹</span>
          </div>
          <nav aria-label="素材文件夹目录">
            <ul className="asset-folder-tree">
              <li className="asset-folder-tree-item">
                <div className={`asset-folder-tree-row asset-folder-tree-all${showAllAssets ? " is-current" : ""}`}>
                  <span className="asset-folder-tree-toggle" aria-hidden="true"><span /></span>
                  <button type="button" className="asset-folder-tree-main" data-help-key="asset.viewAll" onClick={openAllAssets}>
                    <ImageIcon size={17} />
                    <span>全部素材</span>
                    <small>{assets.length}</small>
                  </button>
                </div>
              </li>
              <li className="asset-folder-tree-item">
                <div
                  className={`asset-folder-tree-row asset-folder-tree-root${!showAllAssets && currentFolderId === null ? " is-current" : ""}${dropTarget && dropTarget.folderId === null ? " is-drop-target" : ""}${dropTarget?.invalid && dropTarget.folderId === null ? " is-drop-invalid" : ""}`}
                  data-asset-drop-folder={ROOT_FOLDER_DROP_KEY}
                  onDragEnter={(event) => handleDragOver(event, null)}
                  onDragOver={(event) => handleDragOver(event, null)}
                  onDragLeave={handleDragLeave}
                  onDrop={(event) => handleDrop(event, null)}
                >
                  <span className="asset-folder-tree-toggle" aria-hidden="true"><span /></span>
                  <button type="button" className="asset-folder-tree-main" data-help-key="asset.breadcrumb.root" onClick={() => openFolder(null)}>
                    <ImageIcon size={17} />
                    <span>未归档素材</span>
                    <small>{folderCounts.get(null) ?? 0}</small>
                  </button>
                  {dropTarget && dropTarget.folderId === null && <span className="asset-folder-drop-label">{describeDropTarget(dropTarget)}</span>}
                </div>
              </li>
              {(childrenByFolderId.get(null) ?? []).map((folder) => renderFolderNode(folder, 0))}
            </ul>
          </nav>
          <div className="asset-library-sidebar-tip">
            <MoveRight size={15} />
            <span>拖动素材移动位置<br />按住 Ctrl 复制分类</span>
          </div>
        </aside>

        <main
          className={`asset-library-content${!showAllAssets && dropTarget?.folderId === currentFolderId ? " is-drop-target" : ""}${isImporting ? " is-importing" : ""}`}
          data-asset-drop-surface={showAllAssets ? undefined : "current"}
          onDragEnter={(event) => {
            if (!showAllAssets) handleDragOver(event, currentFolderId);
          }}
          onDragOver={(event) => {
            if (showAllAssets) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "none";
              return;
            }
            handleDragOver(event, currentFolderId);
          }}
          onDragLeave={handleDragLeave}
          onDrop={(event) => {
            if (showAllAssets) {
              event.preventDefault();
              setFeedback({ tone: "warning", text: "“全部素材”是总览视图，请把文件或素材拖到左侧具体文件夹。" });
              return;
            }
            handleDrop(event, currentFolderId);
          }}
        >
          <div className="asset-library-content-toolbar">
            <button type="button" className="asset-library-sidebar-toggle" data-help-key="asset.sidebar.open" aria-label="打开文件夹目录" onClick={() => setSidebarOpen(true)}>
              <PanelLeft size={17} />
            </button>
            <nav className="asset-library-breadcrumbs" aria-label="素材库路径">
              {showAllAssets ? (
                <span className="asset-library-view-title"><ImageIcon size={15} /> 全部素材</span>
              ) : (
                <>
                  <button
                    type="button"
                    data-help-key="asset.breadcrumb.root"
                    data-asset-drop-folder={ROOT_FOLDER_DROP_KEY}
                    className={!currentFolderId ? "is-current" : ""}
                    onDragOver={(event) => handleDragOver(event, null)}
                    onDrop={(event) => handleDrop(event, null)}
                    onClick={() => openFolder(null)}
                  >
                    未归档素材
                  </button>
                  {breadcrumbs.map((folder) => (
                    <span key={folder.folder_id} className="asset-library-breadcrumb-item">
                      <ChevronRight size={14} aria-hidden="true" />
                      <button
                        type="button"
                        data-help-key="asset.breadcrumb.folder"
                        data-asset-drop-folder={folder.folder_id}
                        className={folder.folder_id === currentFolderId ? "is-current" : ""}
                        onDragOver={(event) => handleDragOver(event, folder.folder_id)}
                        onDrop={(event) => handleDrop(event, folder.folder_id)}
                        onClick={() => openFolder(folder.folder_id)}
                      >
                        {folder.name}
                      </button>
                    </span>
                  ))}
                </>
              )}
            </nav>
            <span className="asset-library-item-count">
              {visibleAssets.length === folderAssets.length ? `${folderAssets.length} 个素材` : `${visibleAssets.length} / ${folderAssets.length} 个素材`}
            </span>
          </div>

          {folderDraftName && (
            <section className="asset-folder-editor">
              <label>
                文件夹名称
                <input
                  value={folderDraftName}
                  data-help-key="asset.folder.name"
                  autoFocus
                  onChange={(event) => setFolderDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") createFolder();
                    if (event.key === "Escape") setFolderDraftName("");
                  }}
                />
              </label>
              <div className="row-actions">
                <button type="button" data-help-key="asset.folder.save" onClick={createFolder}>保存</button>
                <button type="button" data-help-key="asset.folder.cancel" onClick={() => setFolderDraftName("")}>取消</button>
              </div>
            </section>
          )}

          <div className="asset-library-managementbar" role="search" aria-label="筛选素材">
            <label className="asset-library-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                data-help-key="asset.search"
                aria-label="搜索素材"
                placeholder="搜索名称、ID、文件名或授权备注"
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              {searchQuery && (
                <button data-help-key="editor.control" type="button" aria-label="清空搜索" title="清空搜索" onClick={() => setSearchQuery("")}>
                  <X size={13} />
                </button>
              )}
            </label>
            <RichSelect
              value={typeFilter}
              options={typeFilterOptions}
              helpKey="asset.filterType"
              ariaLabel="按素材类型筛选"
              variant="compact"
              className="asset-library-type-filter"
              onChange={(nextType) => setTypeFilter(nextType as AssetTypeFilter)}
            />
            <RichSelect
              value={sourceFilter}
              options={assetSourceOptions}
              helpKey="asset.filterSource"
              ariaLabel="按素材来源筛选"
              variant="compact"
              className="asset-library-source-filter"
              onChange={(nextSource) => setSourceFilter(nextSource as AssetSourceFilter)}
            />
            <RichSelect
              value={sortMode}
              options={assetSortOptions}
              helpKey="asset.sort"
              ariaLabel="素材排序方式"
              variant="compact"
              className="asset-library-sort"
              onChange={setSortMode}
            />
            <button
              type="button"
              className="asset-library-reset-filters"
              data-help-key="asset.filters.reset"
              disabled={!hasActiveFilters}
              aria-label="重置素材筛选"
              title="重置筛选"
              onClick={resetManagementFilters}
            >
              <RotateCcw size={14} />
            </button>
          </div>

          <div className="asset-library-grid-tools">
            <div className="asset-library-selection-tools">
              <button type="button" data-help-key="asset.selectAllVisible" disabled={visibleAssets.length === 0} onClick={toggleAllVisibleAssets}>
                {allVisibleSelected ? "取消全选" : "全选筛选结果"}
              </button>
              <button type="button" data-help-key="asset.invertSelection" disabled={visibleAssets.length === 0} onClick={invertVisibleSelection}>反选</button>
            </div>
            <span>
              {selectedCount > 0
                ? `已选 ${selectedCount} 个；当前显示 ${visibleAssets.length} 个`
                : showAllAssets
                  ? "正在浏览整个素材库"
                  : "点击卡片选择，也可拖到左侧文件夹"}
            </span>
          </div>

          {selectedCount > 0 && (
            <div className="asset-library-batchbar" role="region" aria-label="批量整理素材">
              <div className="asset-library-batch-summary">
                <strong><CheckSquare size={15} /> 已选择 {selectedCount} 个素材</strong>
                <small>批量操作只作用于已选项目</small>
              </div>
              <div className="asset-library-batch-group">
                <RichSelect
                  value={batchAssetType}
                  options={assetTypeOptions}
                  helpKey="asset.batch.changeType"
                  ariaLabel="批量素材类型"
                  variant="compact"
                  onChange={(nextAssetType) => setBatchAssetType(nextAssetType as AssetType)}
                />
                <button type="button" data-help-key="asset.batch.applyType" onClick={changeSelectedAssetType}>
                  <Type size={14} /> 应用类型
                </button>
              </div>
              <div className="asset-library-batch-divider" aria-hidden="true" />
              <div className="asset-library-batch-group">
                <RichSelect
                  value={batchTargetFolderId ?? ROOT_FOLDER_DROP_KEY}
                  options={folderOptions.map((option) => ({ value: option.id ?? ROOT_FOLDER_DROP_KEY, label: option.label }))}
                  helpKey="asset.batch.target"
                  ariaLabel="批量目标文件夹"
                  variant="compact"
                  onChange={(nextFolderId) => setBatchTargetFolderId(nextFolderId === ROOT_FOLDER_DROP_KEY ? null : nextFolderId)}
                />
                <button type="button" data-help-key="asset.batch.move" onClick={moveSelectedAssets}><MoveRight size={14} /> 移动</button>
                <button type="button" data-help-key="asset.batch.copy" disabled={!batchTargetFolderId} onClick={copySelectedAssets}><Copy size={14} /> 复制分类</button>
              </div>
              <button type="button" className="is-danger" data-help-key="asset.batch.delete" onClick={deleteSelectedAssets}>
                <Trash2 size={14} /> 删除
              </button>
              <button type="button" className="asset-library-clear-selection" data-help-key="asset.batch.clearSelection" aria-label="取消选择素材" title="取消选择" onClick={clearSelection}><X size={14} /></button>
            </div>
          )}

          {error && <p className="provider-status error-text" role="alert">{error}</p>}
          {feedback && (
            <p className={`asset-library-feedback is-${feedback.tone}`} role="status" aria-live="polite">
              {feedback.tone === "success" ? <CheckCircle2 size={15} /> : feedback.tone === "warning" ? <AlertCircle size={15} /> : <UploadCloud size={15} />}
              <span>{feedback.text}</span>
            </p>
          )}

          <div className="asset-library-grid" role="listbox" aria-label={`${showAllAssets ? "全部素材" : folderName(folders, currentFolderId)}中的素材`} aria-multiselectable="true">
            {visibleAssets.length === 0 && (
              <div className={`empty-state asset-library-empty${!showAllAssets && dropTarget?.folderId === currentFolderId ? " is-drop-target" : ""}`}>
                {folderAssets.length > 0 ? <Search size={26} /> : <UploadCloud size={26} />}
                <strong>
                  {folderAssets.length > 0
                    ? "没有符合筛选条件的素材"
                    : showAllAssets
                      ? "素材库还是空的"
                      : currentFolderId
                        ? "这个文件夹还是空的"
                        : "还没有未归档素材"}
                </strong>
                <span>
                  {folderAssets.length > 0
                    ? "调整关键词、类型或来源筛选后再试。"
                    : showAllAssets
                      ? "导入图片、音频、视频、字体或动画配置开始整理。"
                      : "从电脑拖入文件，或将其他文件夹中的素材移动到这里。"}
                </span>
              </div>
            )}
            {visibleAssets.map((asset) => (
              <AssetLibraryCard
                key={`${currentFolderId ?? "root"}:${asset.asset_id}`}
                asset={asset}
                selected={selectedAssetIds.has(asset.asset_id)}
                dragging={dragPayload?.assetIds.includes(asset.asset_id) ?? false}
                onToggleSelected={() => toggleAssetSelection(asset.asset_id)}
                onDragStart={(event) => startAssetDrag(event, asset.asset_id)}
                onDragEnd={finishAssetDrag}
                onUpdateType={(nextAssetType) => {
                  const original = assetsById.get(asset.asset_id);
                  if (!original) return;
                  onUpdateMany([updateAssetType(original, nextAssetType)]);
                  setFeedback({ tone: "success", text: `已将 ${assetDisplayName(asset)} 修改为${assetTypeDisplayLabel(nextAssetType)}。` });
                }}
                onReplace={() => {
                  ++replacementReadGenerationRef.current;
                  setReplacementTargetId(asset.asset_id);
                  setPendingReplacement(null);
                  setError(undefined);
                  replaceInputRef.current?.click();
                }}
                onDelete={() => {
                  if (!window.confirm(`从素材库删除“${assetDisplayName(asset)}”？已引用该素材的位置可能会显示缺失。`)) return;
                  onDeleteMany([asset.asset_id]);
                  setFeedback({ tone: "success", text: `已删除素材“${assetDisplayName(asset)}”。` });
                }}
              />
            ))}
          </div>

          {(dropTarget || isImporting) && (
            <div className={`asset-library-drop-banner${dropTarget?.invalid ? " is-invalid" : ""}`} aria-hidden="true">
              {dropTarget?.invalid ? <AlertCircle size={18} /> : dropTarget?.mode === "link" ? <Link2 size={18} /> : <UploadCloud size={18} />}
              <strong>{isImporting ? "正在读取并导入素材…" : dropTarget ? describeDropTarget(dropTarget) : ""}</strong>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

function AssetLibraryCard({
  asset,
  selected,
  dragging,
  onToggleSelected,
  onDragStart,
  onDragEnd,
  onUpdateType,
  onReplace,
  onDelete,
}: {
  asset: LibraryAssetRecord;
  selected: boolean;
  dragging: boolean;
  onToggleSelected: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onUpdateType: (assetType: AssetType) => void;
  onReplace: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingType, setEditingType] = useState(false);
  const [draftType, setDraftType] = useState<AssetType>(asset.asset_type as AssetType);
  const suppressClickUntilRef = useRef(0);
  const typeLabel = assetTypeDisplayLabel(asset.asset_type);
  const sourceLabel = sourceLabels[asset.source] ?? "来源未知";
  const filename = safeAssetFilename(asset);
  const displayName = assetDisplayName(asset);
  const containPreview = asset.asset_type === "sprite" || asset.asset_type === "portrait";

  useEffect(() => setDraftType(asset.asset_type as AssetType), [asset.asset_type]);

  function saveType() {
    onUpdateType(draftType);
    setEditingType(false);
    setMenuOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== " " || isInteractiveTarget(event.target)) return;
    event.preventDefault();
    onToggleSelected();
  }

  return (
    <article
      className={`asset-library-card${selected ? " is-selected" : ""}${dragging ? " is-dragging" : ""}`}
      data-asset-id={asset.asset_id}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      draggable
      onDragStart={(event) => {
        suppressClickUntilRef.current = Number.POSITIVE_INFINITY;
        onDragStart(event);
      }}
      onDragEnd={() => {
        suppressClickUntilRef.current = Date.now() + 250;
        onDragEnd();
      }}
      onKeyDown={handleKeyDown}
      onClick={(event) => {
        if (Date.now() < suppressClickUntilRef.current) return;
        if (!isInteractiveTarget(event.target)) onToggleSelected();
      }}
    >
      <div className={`asset-card-preview${containPreview ? " is-contain" : " is-cover"}`}>
        {asset.asset_type === "video" && asset.preview_url ? (
          <video src={asset.preview_url} muted preload="metadata" aria-label={displayName} />
        ) : isImagePreviewSource(asset.preview_url, { mimeType: asset.mime_type, filename, assetType: asset.asset_type }) ? (
          <img src={asset.preview_url} alt={displayName} loading="lazy" />
        ) : (
          <div className="asset-placeholder" title={typeLabel}><ImageIcon size={28} /><span>{typeLabel}</span></div>
        )}
        <label className="asset-card-select" title={`选择 ${displayName}`}>
          <input type="checkbox" data-help-key="asset.select" checked={selected} aria-label={`选择 ${displayName}`} onChange={onToggleSelected} />
          <span aria-hidden="true"><Check size={13} /></span>
        </label>
        <span className="asset-card-type-badge">{typeLabel}</span>
        <div
          className="asset-card-menu"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
          }}
        >
          <button
            type="button"
            data-help-key="asset.card.menu"
            aria-label={`打开 ${displayName} 的操作菜单`}
            aria-expanded={menuOpen}
            title="更多操作"
            onClick={() => setMenuOpen((current) => !current)}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="asset-card-menu-popover" role="menu">
              <button type="button" role="menuitem" data-help-key="asset.editType" onClick={() => setEditingType(true)}>
                <Pencil size={14} /> 修改类型
              </button>
              <button type="button" role="menuitem" data-help-key="asset.replace" onClick={() => { setMenuOpen(false); onReplace(); }}>
                <UploadCloud size={14} /> 替换文件
              </button>
              <button type="button" role="menuitem" className="is-danger" data-help-key="asset.delete" onClick={onDelete}>
                <Trash2 size={14} /> 删除素材
              </button>
            </div>
          )}
        </div>
        <div className="asset-card-hover-info">
          <span>{sourceLabel}</span>
          {(asset.width || asset.height) && <span>{asset.width ?? "?"}×{asset.height ?? "?"}</span>}
          {asset.duration_ms && <span>{(asset.duration_ms / 1000).toFixed(1)} 秒</span>}
        </div>
      </div>
      <div className="asset-card-copy">
        <strong title={displayName}>{displayName}</strong>
        <small title={`${filename} · ${assetCategoryHint(asset.asset_type)}`}>{filename}</small>
      </div>
      {editingType && (
        <div className="asset-card-type-popover" role="dialog" aria-label={`修改 ${displayName} 的素材类型`}>
          <strong>素材类型</strong>
          <RichSelect
            value={draftType}
            options={assetTypeOptions}
            helpKey="asset.editType"
            variant="compact"
            onChange={(nextAssetType) => setDraftType(nextAssetType as AssetType)}
          />
          <div className="row-actions">
            <button type="button" data-help-key="asset.editType.save" onClick={saveType}>保存</button>
            <button type="button" data-help-key="asset.editType.cancel" onClick={() => setEditingType(false)}>取消</button>
          </div>
        </div>
      )}
    </article>
  );
}
