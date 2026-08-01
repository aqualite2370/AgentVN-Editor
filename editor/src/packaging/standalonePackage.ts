import type { PackageTargetPlatform } from "./runtimePackage";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

export interface StandalonePackageBuildArtifact {
  kind: string;
  path: string;
  bytes?: number;
}

export interface StandalonePackageBuildResult {
  ok: boolean;
  status: "PASS" | "FAIL" | "BLOCKED";
  message: string;
  artifacts: StandalonePackageBuildArtifact[];
  warnings: string[];
  verifyReportPath: string;
  buildLogPath: string;
  manifestPath: string;
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
const STANDALONE_PACKAGE_UPLOAD_CHUNK_BYTES = 256 * 1024;

export interface PackageBuildLogEvent {
  runId: string;
  level: "info" | "success" | "warning" | "error" | string;
  source: string;
  message: string;
  timestampMs: number;
}

export interface AndroidEnvironmentCheck {
  id: string;
  label: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  path?: string;
  message?: string;
  fix?: string;
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
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

function isMissingTauriCommand(error: unknown, command: string): boolean {
  const message = errorMessage(error);
  return message.includes(`Command ${command} not found`) || message.includes(`command ${command} not found`);
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

export async function checkAndroidBuildEnvironment(runId?: string): Promise<AndroidEnvironmentResult> {
  if (!isTauriRuntime()) {
    throw new Error("当前浏览器开发模式无法检测本机 Android 打包环境。请使用 AgentVN 桌面版。");
  }
  return invokeTauri<AndroidEnvironmentResult>("check_android_build_environment", { runId });
}

export async function installAndroidBuildEnvironment(runId?: string): Promise<AndroidEnvironmentResult> {
  if (!isTauriRuntime()) {
    throw new Error("当前浏览器开发模式无法修复本机 Android 打包环境。请使用 AgentVN 桌面版。");
  }
  return invokeTauri<AndroidEnvironmentResult>("install_android_build_environment", { runId });
}

export async function checkWindowsBuildEnvironment(runId?: string): Promise<WindowsEnvironmentResult> {
  if (!isTauriRuntime()) {
    throw new Error("当前浏览器开发模式无法检测本机 Windows 打包环境。请使用 AgentVN 桌面版。");
  }
  return invokeTauri<WindowsEnvironmentResult>("check_windows_build_environment", { runId });
}

export async function installWindowsBuildEnvironment(runId?: string): Promise<WindowsEnvironmentResult> {
  if (!isTauriRuntime()) {
    throw new Error("当前浏览器开发模式无法修复本机 Windows 打包环境。请使用 AgentVN 桌面版。");
  }
  return invokeTauri<WindowsEnvironmentResult>("install_windows_build_environment", { runId });
}
