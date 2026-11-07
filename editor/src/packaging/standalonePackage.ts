import type { PackageTargetPlatform } from "./runtimePackage";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import type { EditorPreviewDirectoryExportResult } from "../cartridge/exportCartridge";

export interface StandalonePackageBuildArtifact {
  kind: string;
  path: string;
  bytes?: number;
}

export interface ReleaseIdentity {
  schemaVersion: 1;
  title: string;
  gameId: string;
  versionName: string;
  versionCode: number;
  androidApplicationId: string;
}

export type StandaloneIconSource = "project" | "default" | "fallback";

export interface StandalonePackageBuildResult {
  ok: boolean;
  status: "PASS" | "FAIL" | "BLOCKED";
  staticStatus?: "PASS" | "FAIL";
  runtimeStatus?: "PASS" | "FAIL" | "NOT_RUN" | "STATIC_ONLY";
  overallStatus?: "PASS" | "FAIL" | "STATIC_ONLY";
  runtimeSmokeReportPath?: string;
  message: string;
  artifacts: StandalonePackageBuildArtifact[];
  warnings: string[];
  verifyReportPath: string;
  buildLogPath: string;
  manifestPath: string;
  diagnosticsDir: string;
  diagnosticsArchivePath: string;
  failureCode?: "SYMLINK_PRIVILEGE_REQUIRED" | "UAC_CANCELLED" | "ELEVATED_SYMLINK_DENIED" | "SYMLINK_UNSUPPORTED" | "ELEVATED_HELPER_LOST" | "ENCODING_INVALID" | string;
  permissionDetails?: AndroidSymlinkCapability;
  releaseIdentity?: ReleaseIdentity;
  iconSource?: StandaloneIconSource;
  audioNormalization?: Record<string, unknown>;
  postBuildInspection?: Record<string, unknown>;
}

export type StandalonePackageUploadFileKind = "cartridge" | "icon";
export type ReleaseOptimizationProfile = "balanced" | "lossless" | "off";

export interface StandalonePackageUploadProgress {
  fileKind: StandalonePackageUploadFileKind;
  uploadedBytes: number;
  totalBytes: number;
  fileUploadedBytes: number;
  fileTotalBytes: number;
  percent: number;
}

interface StandalonePackageUpload {
  uploadId: string;
}

interface StandalonePackageUploadAppendResult {
  writtenBytes: number;
}

export const PACKAGE_BUILD_LOG_EVENT = "agentvn://package-build-log";
export const ANDROID_ENV_IMPORT_PROGRESS_EVENT = "agentvn://android-env-import-progress";
export const PACKAGE_ENVIRONMENT_OPERATION_PROGRESS_EVENT = "agentvn://package-environment-operation-progress";
const STANDALONE_PACKAGE_UPLOAD_CHUNK_BYTES = 256 * 1024;

export interface PackageBuildLogEvent {
  runId: string;
  level: "info" | "success" | "warning" | "error" | string;
  source: string;
  message: string;
  timestampMs: number;
}

export interface AndroidEnvironmentImportProgress {
  runId: string;
  phase: "checking" | "cleaning" | "installing" | "verifying" | "completed" | "validating" | "extracting" | "validated" | string;
  message: string;
  percent: number;
  processedBytes: number;
  totalBytes: number;
  processedFiles: number;
  totalFiles: number;
  reclaimedBytes: number;
  installSource: "avnenv" | "online" | string;
}

export interface PackageEnvironmentOperationProgress {
  runId: string;
  platform: "android" | "windows" | string;
  operation: "check" | "install" | "import" | string;
  phase: string;
  message: string;
  percent: number;
}

export interface AndroidEnvironmentCheck {
  id: string;
  label: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  path?: string;
  message?: string;
  fix?: string;
}

export interface AndroidSymlinkCapability {
  schemaVersion: number;
  probeRoot: string;
  success: boolean;
  win32ErrorCode?: number;
  error?: string;
  windowsBuild?: string;
  checkedAt?: string;
  isElevated?: boolean;
  developerModeEnabled?: boolean;
  developerModeRegistryValue?: number | null;
  symbolicLinkPrivilegePresent?: boolean;
  symbolicLinkPrivilegeEnabled?: boolean;
  symbolicLinkPrivilegeQueryError?: string;
  /** Legacy schema v1 field. New reports use structured privilege booleans. */
  symbolicLinkPrivilege?: string;
}

export interface AndroidSymlinkElevation {
  attempted: boolean;
  status: "NOT_NEEDED" | "REQUESTED" | "PASS" | "DENIED" | "UAC_CANCELLED" | "HELPER_LOST" | "ERROR" | string;
  reason?: string;
  reportPath?: string;
  exitCode?: number | null;
  error?: string;
}

export interface AndroidEnvironmentResult {
  ok: boolean;
  status: "PASS" | "FAIL" | "BLOCKED";
  message: string;
  installAttempted?: boolean;
  toolRoot?: string;
  sdkRoot?: string;
  jdkHome?: string;
  ndkHome?: string;
  checks: AndroidEnvironmentCheck[];
  missing: string[];
  warnings: string[];
  actions?: string[];
  manualFix?: string[];
  reportPath?: string;
  logPath?: string;
  commandLogPath?: string;
  exitCode?: number;
  cacheSchemaVersion?: number;
  cachePlatform?: "android" | "windows" | string;
  cacheHit?: boolean;
  passCachePath?: string;
  symlinkCapability?: AndroidSymlinkCapability;
  symlinkElevation?: AndroidSymlinkElevation;
  importedEnvironmentPackage?: {
    path: string;
    packageId: string;
    packVersion: string;
    totalBytes: number;
    fileCount: number;
    reclaimedBytes?: number;
    installSource?: "avnenv" | "online" | string;
    buildElevationDeferred?: boolean;
    status: "PASS" | "BLOCKED" | string;
  };
  installSource?: "avnenv" | "online" | "existing" | string;
  reclaimedBytes?: number;
}

export type WindowsEnvironmentCheck = AndroidEnvironmentCheck;

export interface WindowsEnvironmentResult {
  ok: boolean;
  status: "PASS" | "FAIL" | "BLOCKED";
  message: string;
  installAttempted?: boolean;
  checks: WindowsEnvironmentCheck[];
  missing: string[];
  warnings: string[];
  actions?: string[];
  manualFix?: string[];
  reportPath?: string;
  logPath?: string;
  commandLogPath?: string;
  exitCode?: number;
  cacheSchemaVersion?: number;
  cachePlatform?: "android" | "windows" | string;
  cacheHit?: boolean;
  passCachePath?: string;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    // Rust Err(String) rejects with a string, while publishing UI uses Error
    // branches. Normalize at the native boundary so the actual cause survives.
    if (error instanceof Error) throw error;
    const detail = typeof error === "string" ? error
      : error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message : "";
    throw Object.assign(new Error(detail.trim() ? detail : `桌面打包操作失败（${command}）`), { cause: error });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

function isMissingTauriCommand(error: unknown, command: string): boolean {
  const message = errorMessage(error);
  return message.includes(`Command ${command} not found`) || message.includes(`command ${command} not found`);
}

const ANDROID_APPLICATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}$/;
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;

function normalizeAndroidPackageSegment(value: string): string {
  let normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
  if (!normalized) normalized = "game";
  if (!/^[a-z]/.test(normalized)) normalized = `g${normalized}`;
  return normalized;
}

export function defaultAndroidApplicationId(gameId: string): string {
  return `com.agentvn.game.${normalizeAndroidPackageSegment(gameId)}`;
}

export function buildReleaseIdentity(input: {
  title: string;
  gameId: string;
  versionName: string;
  androidApplicationId?: string;
}): ReleaseIdentity {
  const title = input.title.trim();
  const gameId = input.gameId.trim();
  if (!title || !gameId) {
    throw new Error("RELEASE_METADATA_INVALID：游戏标题和游戏编号不能为空。");
  }
  const versionName = input.versionName.trim();
  const match = SEMVER_PATTERN.exec(versionName);
  if (!match) {
    throw new Error("RELEASE_METADATA_INVALID：版本号必须使用 major.minor.patch 格式，例如 1.2.3。");
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  if (minor > 999 || patch > 999) {
    throw new Error("RELEASE_METADATA_INVALID：版本号的 minor 和 patch 均不能超过 999。");
  }
  const versionCode = major * 1_000_000 + minor * 1_000 + patch;
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0 || versionCode > MAX_ANDROID_VERSION_CODE) {
    throw new Error(`RELEASE_METADATA_INVALID：Android versionCode 必须在 1 到 ${MAX_ANDROID_VERSION_CODE} 之间。`);
  }
  const androidApplicationId = (
    input.androidApplicationId?.trim() || defaultAndroidApplicationId(gameId)
  ).toLowerCase();
  if (!ANDROID_APPLICATION_ID_PATTERN.test(androidApplicationId)) {
    throw new Error(
      "INVALID_ANDROID_APPLICATION_ID：Android 包名至少包含三段，每段以小写字母开头，并且只能包含小写字母和数字。",
    );
  }
  return {
    schemaVersion: 1,
    title,
    gameId,
    versionName,
    versionCode,
    androidApplicationId,
  };
}

async function blobSliceToByteArray(blob: Blob): Promise<number[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const result = new Array<number>(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) result[index] = bytes[index];
  return result;
}

async function uploadStandalonePackageBlob(input: {
  uploadId: string;
  fileKind: StandalonePackageUploadFileKind;
  blob: Blob;
  completedBefore: number;
  overallTotal: number;
  onProgress?: (event: StandalonePackageUploadProgress) => void;
}): Promise<number> {
  let acknowledgedBytes = 0;
  for (let offset = 0; offset < input.blob.size; offset += STANDALONE_PACKAGE_UPLOAD_CHUNK_BYTES) {
    const slice = input.blob.slice(offset, Math.min(input.blob.size, offset + STANDALONE_PACKAGE_UPLOAD_CHUNK_BYTES));
    const chunkBytes = await blobSliceToByteArray(slice);
    const appendResult = await invokeTauri<StandalonePackageUploadAppendResult>("append_standalone_package_upload_chunk", {
      uploadId: input.uploadId,
      fileKind: input.fileKind,
      offsetBytes: acknowledgedBytes,
      chunkBytes,
    });
    const expectedBytes = Math.min(offset + chunkBytes.length, input.blob.size);
    acknowledgedBytes = appendResult.writtenBytes;
    if (acknowledgedBytes !== expectedBytes) {
      throw new Error(
        `Standalone package ${input.fileKind} upload verification failed: acknowledged ${acknowledgedBytes} / expected ${expectedBytes} bytes.`,
      );
    }
    const uploadedBytes = input.completedBefore + acknowledgedBytes;
    input.onProgress?.({
      fileKind: input.fileKind,
      uploadedBytes,
      totalBytes: input.overallTotal,
      fileUploadedBytes: acknowledgedBytes,
      fileTotalBytes: input.blob.size,
      percent: input.overallTotal > 0 ? Math.min(100, Math.round((uploadedBytes / input.overallTotal) * 100)) : 100,
    });
  }
  if (acknowledgedBytes !== input.blob.size) {
    throw new Error(
      `Standalone package ${input.fileKind} upload incomplete: acknowledged ${acknowledgedBytes} / ${input.blob.size} bytes.`,
    );
  }
  return acknowledgedBytes;
}

export async function selectStandalonePackageOutputDir(): Promise<string | undefined> {
  if (!isTauriRuntime()) {
    throw new Error("当前浏览器开发模式无法选择本机软件包目录。请使用 AgentVN 桌面版构建 .exe/.msi/.apk。");
  }
  const selected = await invokeTauri<string | null>("select_package_output_dir");
  return selected ?? undefined;
}

export async function buildStandalonePackage(input: {
  targetPlatform: PackageTargetPlatform;
  outputDir: string;
  cartridge: Blob;
  fileName: string;
  runId?: string;
  standaloneIcon?: Blob;
  standaloneIconFileName?: string;
  releaseIdentity: ReleaseIdentity;
  iconSource?: StandaloneIconSource;
  optimizationProfile?: ReleaseOptimizationProfile;
  onUploadProgress?: (event: StandalonePackageUploadProgress) => void;
}): Promise<StandalonePackageBuildResult> {
  if (!isTauriRuntime()) {
    throw new Error("当前浏览器开发模式无法调用本机打包工具链。请使用 AgentVN 桌面版构建 .exe/.msi/.apk。");
  }
  let uploadId: string | undefined;
  let committed = false;
  try {
    const upload = await invokeTauri<StandalonePackageUpload>("begin_standalone_package_upload", {
      fileName: input.fileName,
      expectedSize: input.cartridge.size,
      iconFileName: input.standaloneIconFileName,
      expectedIconSize: input.standaloneIcon?.size,
    });
    uploadId = upload.uploadId;
    const totalBytes = input.cartridge.size + (input.standaloneIcon?.size ?? 0);
    const cartridgeBytes = await uploadStandalonePackageBlob({
      uploadId,
      fileKind: "cartridge",
      blob: input.cartridge,
      completedBefore: 0,
      overallTotal: totalBytes,
      onProgress: input.onUploadProgress,
    });
    if (input.standaloneIcon) {
      await uploadStandalonePackageBlob({
        uploadId,
        fileKind: "icon",
        blob: input.standaloneIcon,
        completedBefore: cartridgeBytes,
        overallTotal: totalBytes,
        onProgress: input.onUploadProgress,
      });
    }
    const result = await invokeTauri<StandalonePackageBuildResult>("build_standalone_package_from_upload", {
      uploadId,
      targetPlatform: input.targetPlatform,
      outputDir: input.outputDir,
      runId: input.runId,
      optimizationProfile: input.optimizationProfile ?? "balanced",
      releaseIdentity: input.releaseIdentity,
      iconSource: input.iconSource ?? (input.standaloneIcon ? "project" : "default"),
    });
    committed = true;
    return result;
  } catch (error) {
    if (isMissingTauriCommand(error, "begin_standalone_package_upload")) {
      throw new Error("当前 AgentVN 桌面宿主版本过旧，不支持大文件分块打包。请重新构建并重启 AgentVN 桌面端。");
    }
    throw error;
  } finally {
    if (uploadId && !committed) {
      try {
        await invokeTauri<void>("abort_standalone_package_upload", { uploadId });
      } catch (error) {
        reportFrontendError("editor.packaging", error, {
          operation: "abort-upload",
          uploadId,
        });
        // The host may already have consumed or removed the failed upload.
      }
    }
  }
}

export async function buildStandalonePackageFromFiles(input: {
  targetPlatform: PackageTargetPlatform;
  outputDir: string;
  directory: EditorPreviewDirectoryExportResult;
  runId?: string;
  standaloneIcon?: Blob;
  standaloneIconFileName?: string;
  releaseIdentity: ReleaseIdentity;
  iconSource?: StandaloneIconSource;
  optimizationProfile?: ReleaseOptimizationProfile;
}): Promise<StandalonePackageBuildResult> {
  if (!isTauriRuntime()) {
    throw new Error("本机文件流式卡带打包仅可在 AgentVN 桌面版运行。");
  }
  if (input.directory.assets.some((asset) => !asset.sourceFilePath || asset.data)) {
    throw new Error("本机文件流式卡带需要所有素材由桌面宿主托管。");
  }
  return invokeTauri<StandalonePackageBuildResult>("build_standalone_package_from_files", {
    fileName: input.directory.fileName,
    textFiles: input.directory.textFiles,
    assets: input.directory.assets.map((asset) => ({
      path: asset.cartridgePath,
      sourceFilePath: asset.sourceFilePath,
    })),
    iconFileName: input.standaloneIconFileName,
    iconBytes: input.standaloneIcon ? await blobSliceToByteArray(input.standaloneIcon) : undefined,
    targetPlatform: input.targetPlatform,
    outputDir: input.outputDir,
    runId: input.runId,
    optimizationProfile: input.optimizationProfile ?? "balanced",
    releaseIdentity: input.releaseIdentity,
    iconSource: input.iconSource ?? (input.standaloneIcon ? "project" : "default"),
  });
}

export function canBuildStandaloneFromFileBackedAssets(directory: EditorPreviewDirectoryExportResult): boolean {
  return isTauriRuntime()
    && directory.assets.every((asset) => Boolean(asset.sourceFilePath) && !asset.data);
}

export async function listenStandalonePackageLogs(
  runId: string,
  onLog: (event: PackageBuildLogEvent) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<PackageBuildLogEvent>(PACKAGE_BUILD_LOG_EVENT, (event) => {
    if (event.payload.runId === runId) onLog(event.payload);
  });
}

export async function listenAndroidEnvironmentImportProgress(
  runId: string,
  onProgress: (event: AndroidEnvironmentImportProgress) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<AndroidEnvironmentImportProgress>(ANDROID_ENV_IMPORT_PROGRESS_EVENT, (event) => {
    if (event.payload.runId === runId) onProgress(event.payload);
  });
}

export async function listenPackageEnvironmentOperationProgress(
  runId: string,
  onProgress: (event: PackageEnvironmentOperationProgress) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<PackageEnvironmentOperationProgress>(PACKAGE_ENVIRONMENT_OPERATION_PROGRESS_EVENT, (event) => {
    if (event.payload.runId === runId) onProgress(event.payload);
  });
}

export async function openStandalonePackageDiagnostics(diagnosticsDir: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error("当前浏览器开发模式无法打开本机诊断目录。请使用 AgentVN 桌面版。");
  await invokeTauri<void>("open_standalone_package_diagnostics", { diagnosticsDir });
}

export async function openStandalonePackageOutputDirectory(outputDir: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error("当前浏览器开发模式无法打开本机软件包目录。请使用 AgentVN 桌面版。");
  await invokeTauri<void>("open_standalone_package_output_directory", { outputDir });
}

export async function exportStandalonePackageDiagnostics(diagnosticsDir: string): Promise<string> {
  if (!isTauriRuntime()) throw new Error("当前浏览器开发模式无法导出本机诊断包。请使用 AgentVN 桌面版。");
  return invokeTauri<string>("export_standalone_package_diagnostics", { diagnosticsDir });
}

export async function checkAndroidBuildEnvironment(runId?: string, forceRecheck = false): Promise<AndroidEnvironmentResult> {
  if (!isTauriRuntime()) {
    throw new Error("当前浏览器开发模式无法检测本机 Android 打包环境。请使用 AgentVN 桌面版。");
  }
  return invokeTauri<AndroidEnvironmentResult>("check_android_build_environment", { runId, forceRecheck });
}

export async function installAndroidBuildEnvironment(runId?: string): Promise<AndroidEnvironmentResult> {
  if (!isTauriRuntime()) {
    throw new Error("当前浏览器开发模式无法修复本机 Android 打包环境。请使用 AgentVN 桌面版。");
  }
  return invokeTauri<AndroidEnvironmentResult>("install_android_build_environment", { runId });
}

export async function importAndroidEnvironmentPackage(runId?: string): Promise<AndroidEnvironmentResult | undefined> {
  if (!isTauriRuntime()) {
    throw new Error("当前浏览器开发模式无法导入 Android 构建依赖。请使用 AgentVN 桌面版。");
  }
  const result = await invokeTauri<AndroidEnvironmentResult | null>("import_android_environment_package", { runId });
  return result ?? undefined;
}

export async function checkWindowsBuildEnvironment(runId?: string, forceRecheck = false): Promise<WindowsEnvironmentResult> {
  if (!isTauriRuntime()) {
    throw new Error("当前浏览器开发模式无法检测本机 Windows 打包环境。请使用 AgentVN 桌面版。");
  }
  return invokeTauri<WindowsEnvironmentResult>("check_windows_build_environment", { runId, forceRecheck });
}

export async function installWindowsBuildEnvironment(runId?: string): Promise<WindowsEnvironmentResult> {
  if (!isTauriRuntime()) {
    throw new Error("当前浏览器开发模式无法修复本机 Windows 打包环境。请使用 AgentVN 桌面版。");
  }
  return invokeTauri<WindowsEnvironmentResult>("install_windows_build_environment", { runId });
}
