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

const sourceLabels: Record<string, string> = {
  generated: "生成素材",
  imported: "导入素材",
  edited: "编辑素材",
  bundled: "内置素材",
};

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

function readVideoMetadata(source: string): Promise<Pick<PendingImport, "width" | "height" | "durationMs">> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };
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
      reject(new Error("当前 WebView 无法解析该视频的编码或容器。素材仍可导入，但运行时可能无法播放。"));
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
      Object.assign(pending, await readVideoMetadata(dataUrl));
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
  onDelete,
  onImportMany,
  onUpdate,
  onAssetLibraryChange,
}: {
  assets: AssetRef[];
  assetLibrary: AssetLibrarySettings;
  onDelete: (assetId: string) => void;
  onImportMany: (entries: Array<{ asset: AssetRef; folderId: string | null }>) => void;
  onUpdate: (asset: AssetRef) => void;
  onAssetLibraryChange: (assetLibrary: AssetLibrarySettings) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const hoverExpandTimerRef = useRef<number>();
  const hoverExpandFolderRef = useRef<string>();
  const nativePathsRef = useRef<string[]>([]);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [assetType, setAssetType] = useState<AssetType>("background");
  const [licenseNote, setLicenseNote] = useState("");
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<FeedbackState>();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set());
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
  const visibleAssets = useMemo(
    () => libraryAssets.filter((asset) => assetIsVisibleInFolder(assetLibrary, asset.asset_id, currentFolderId)),
    [assetLibrary, currentFolderId, libraryAssets],
  );
  const selectedCount = selectedAssetIds.size;
  const folderOptions = useMemo(() => buildFolderOptions(folders), [folders]);
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
  const breadcrumbs = useMemo(() => folderPath(folders, currentFolderId), [currentFolderId, folders]);

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
    if (element?.closest("[data-asset-drop-surface='current']")) return currentFolderId;
    return undefined;
  }, [currentFolderId]);

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
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await prepareImport(file);
  }

  async function handleFontFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await prepareImport(file, "font");
  }

  function confirmImport() {
    if (!pendingImport) return;
    const assetId = uniqueLibraryAssetId(fileStem(pendingImport.fileName), new Set(assets.map((asset) => asset.asset_id)));
    onImportMany([{
      asset: pendingImportToAsset(pendingImport, assetType, assetId, licenseNote),
      folderId: currentFolderId,
    }]);
    setPendingImport(null);
    setAssetType("background");
    setLicenseNote("");
    setError(undefined);
    setFeedback({ tone: "success", text: `已将 ${pendingImport.fileName} 保存到${folderName(folders, currentFolderId)}。` });
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
          parent_folder_id: currentFolderId,
          created_at: timestamp,
          updated_at: timestamp,
        },
      ],
    });
    if (currentFolderId) {
      setExpandedFolderIds((current) => new Set(current).add(currentFolderId));
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

  function selectAllVisibleAssets() {
    setSelectedAssetIds(new Set(visibleAssets.map((asset) => asset.asset_id)));
  }

  function clearSelection() {
    setSelectedAssetIds(new Set());
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
      { assetIds: [...selectedAssetIds], sourceFolderId: currentFolderId },
      batchTargetFolderId,
      "move",
    );
  }

  function copySelectedAssets() {
    performAssetDrop(
      { assetIds: [...selectedAssetIds], sourceFolderId: currentFolderId },
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
    const payload: AssetDragPayload = { assetIds, sourceFolderId: currentFolderId };
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
    setCurrentFolderId(folderId);
    setSidebarOpen(false);
  }

  function renderFolderNode(folder: AssetLibraryFolder, depth: number): JSX.Element {
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
          <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/*" hidden onChange={handleFontFileChange} />
          <button type="button" data-help-key="asset.importFont" onClick={() => fontInputRef.current?.click()}>
            <Type size={15} /> 导入字体
          </button>
          <input ref={fileInputRef} type="file" accept="image/*,audio/*,video/*,font/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.wav,.mp3,.ogg,.m4a,.flac,.mp4,.webm,.mov,.json,.ttf,.otf,.woff,.woff2" hidden onChange={handleFileChange} />
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

      <div className={`asset-library-workspace${dragPayload || dropTarget ? " is-drag-active" : ""}`}>
        {sidebarOpen && <button type="button" className="asset-library-sidebar-scrim" data-help-key="asset.sidebar.close" aria-label="关闭文件夹目录" onClick={() => setSidebarOpen(false)} />}
        <aside className={`asset-library-sidebar${sidebarOpen ? " is-open" : ""}`} aria-label="素材文件夹">
          <div className="asset-library-sidebar-header">
            <strong>文件夹</strong>
            <span>{folders.length}</span>
          </div>
          <nav aria-label="素材文件夹目录">
            <ul className="asset-folder-tree">
              <li className="asset-folder-tree-item">
                <div
                  className={`asset-folder-tree-row asset-folder-tree-root${currentFolderId === null ? " is-current" : ""}${dropTarget && dropTarget.folderId === null ? " is-drop-target" : ""}${dropTarget?.invalid && dropTarget.folderId === null ? " is-drop-invalid" : ""}`}
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
          className={`asset-library-content${dropTarget?.folderId === currentFolderId ? " is-drop-target" : ""}${isImporting ? " is-importing" : ""}`}
          data-asset-drop-surface="current"
          onDragEnter={(event) => handleDragOver(event, currentFolderId)}
          onDragOver={(event) => handleDragOver(event, currentFolderId)}
          onDragLeave={handleDragLeave}
          onDrop={(event) => handleDrop(event, currentFolderId)}
        >
          <div className="asset-library-content-toolbar">
            <button type="button" className="asset-library-sidebar-toggle" data-help-key="asset.sidebar.open" aria-label="打开文件夹目录" onClick={() => setSidebarOpen(true)}>
              <PanelLeft size={17} />
            </button>
            <nav className="asset-library-breadcrumbs" aria-label="素材库路径">
              <button
                type="button"
                data-help-key="asset.breadcrumb.root"
                data-asset-drop-folder={ROOT_FOLDER_DROP_KEY}
                className={!currentFolderId ? "is-current" : ""}
                onDragOver={(event) => handleDragOver(event, null)}
                onDrop={(event) => handleDrop(event, null)}
                onClick={() => setCurrentFolderId(null)}
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
                    onClick={() => setCurrentFolderId(folder.folder_id)}
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </nav>
            <span className="asset-library-item-count">{visibleAssets.length} 个素材</span>
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

          {selectedCount > 0 ? (
            <div className="asset-library-batchbar" role="region" aria-label="批量整理素材">
              <strong><CheckSquare size={15} /> 已选择 {selectedCount} 个素材</strong>
              <RichSelect
                value={batchTargetFolderId ?? ROOT_FOLDER_DROP_KEY}
                options={folderOptions.map((option) => ({ value: option.id ?? ROOT_FOLDER_DROP_KEY, label: option.label }))}
                helpKey="asset.batch.target"
                variant="compact"
                onChange={(nextFolderId) => setBatchTargetFolderId(nextFolderId === ROOT_FOLDER_DROP_KEY ? null : nextFolderId)}
              />
              <button type="button" data-help-key="asset.batch.move" onClick={moveSelectedAssets}><MoveRight size={14} /> 移动</button>
              <button type="button" data-help-key="asset.batch.copy" disabled={!batchTargetFolderId} onClick={copySelectedAssets}><Copy size={14} /> 复制分类</button>
              <button type="button" data-help-key="asset.batch.clearSelection" aria-label="取消选择素材" title="取消选择" onClick={clearSelection}><X size={14} /></button>
            </div>
          ) : (
            <div className="asset-library-grid-tools">
              <button type="button" data-help-key="asset.selectAllVisible" disabled={visibleAssets.length === 0} onClick={selectAllVisibleAssets}>全选当前素材</button>
              <span>点击卡片选择，也可直接拖到左侧文件夹</span>
            </div>
          )}

          {error && <p className="provider-status error-text" role="alert">{error}</p>}
          {feedback && (
            <p className={`asset-library-feedback is-${feedback.tone}`} role="status" aria-live="polite">
              {feedback.tone === "success" ? <CheckCircle2 size={15} /> : feedback.tone === "warning" ? <AlertCircle size={15} /> : <UploadCloud size={15} />}
              <span>{feedback.text}</span>
            </p>
          )}

          <div className="asset-library-grid" role="listbox" aria-label={`${folderName(folders, currentFolderId)}中的素材`} aria-multiselectable="true">
            {visibleAssets.length === 0 && (
              <div className={`empty-state asset-library-empty${dropTarget?.folderId === currentFolderId ? " is-drop-target" : ""}`}>
                <UploadCloud size={26} />
                <strong>{currentFolderId ? "这个文件夹还是空的" : "还没有未归档素材"}</strong>
                <span>从电脑拖入文件，或将其他文件夹中的素材移动到这里。</span>
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
                  onUpdate({
                    ...original,
                    asset_type: nextAssetType,
                    metadata: {
                      ...original.metadata,
                      source: "edited",
                      project_path: buildProjectAssetPath(nextAssetType, original.asset_id, original.metadata.filename ?? `${original.asset_id}.bin`),
                    },
                  });
                  setFeedback({ tone: "success", text: `已将 ${assetDisplayName(asset)} 修改为${assetTypeDisplayLabel(nextAssetType)}。` });
                }}
                onDelete={() => {
                  if (!window.confirm(`从素材库删除“${assetDisplayName(asset)}”？已引用该素材的位置可能会显示缺失。`)) return;
                  onDelete(asset.asset_id);
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
  onDelete,
}: {
  asset: LibraryAssetRecord;
  selected: boolean;
  dragging: boolean;
  onToggleSelected: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onUpdateType: (assetType: AssetType) => void;
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
