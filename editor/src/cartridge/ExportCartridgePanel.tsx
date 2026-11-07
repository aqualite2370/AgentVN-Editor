import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useReactFlow } from "@xyflow/react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleX,
  FileArchive,
  FolderOpen,
  Image as ImageIcon,
  PackageCheck,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useEditorStore } from "../store/editorStore";
import { useProjectStore } from "../store/projectStore";
import { applyProjectRuntimeSettingsToScript } from "../utils/exportScript";
import { RoseTwoLoader } from "../components/common/RoseTwoLoader";
import { collectProjectAssets } from "./collectProjectAssets";
import { downloadPackagingArtifact, exportPackagingArtifact, type PackageExportMode, type PackageTargetPlatform } from "../packaging/runtimePackage";
import {
  buildReleaseIdentity,
  buildStandalonePackage,
  buildStandalonePackageFromFiles,
  canBuildStandaloneFromFileBackedAssets,
  checkAndroidBuildEnvironment,
  checkWindowsBuildEnvironment,
  installAndroidBuildEnvironment,
  importAndroidEnvironmentPackage,
  installWindowsBuildEnvironment,
  listenAndroidEnvironmentImportProgress,
  listenPackageEnvironmentOperationProgress,
  listenStandalonePackageLogs,
  openStandalonePackageDiagnostics,
  openStandalonePackageOutputDirectory,
  exportStandalonePackageDiagnostics,
  selectStandalonePackageOutputDir,
  type AndroidEnvironmentResult,
  type AndroidEnvironmentImportProgress,
  type PackageEnvironmentOperationProgress,
  type PackageBuildLogEvent,
  type ReleaseOptimizationProfile,
  type StandalonePackageBuildResult,
  type WindowsEnvironmentResult,
} from "../packaging/standalonePackage";
import { exportEditorCartridge, exportEditorPreviewDirectory } from "./exportCartridge";
import type { RuntimeScript } from "../../../shared/cartridge/types";
import { manifestAssetsFromProjectAssets } from "../utils/projectAssets";
import { buildProjectAssetAudit } from "../utils/assetAudit";
import { normalizeGameId, runExportPreflight, type PreflightCheck, type PreflightStatus } from "./preflight";
import { RichSelect, type RichSelectOption } from "../components/common/RichSelect";
import { OperationResultDialog } from "../components/common/OperationResultDialog";
import { RuntimeVisualAssetsPanel } from "../components/advanced/RuntimeVisualAssetsPanel";
import type { AssetRef } from "../types/assets";
import { readStandaloneIconSourceBlob, resolveStandaloneIconAsset } from "../packaging/standaloneIcon";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import {
  deriveActivePackageEnvironment,
  derivePackageEnvironmentVerification,
  visiblePackageEnvironmentManualFix,
} from "../packaging/packageEnvironmentState";
import {
  createPackageBuildBlockedDialogModel,
  createPackageBuildExceptionDialogModel,
  createPackageBuildResultDialogModel,
  type PackageBuildResultDialogModel,
} from "../packaging/packageBuildResultDialog";
import {
  getPackageTaskSession,
  type ExportProgressState,
  type PackageConsoleEntry,
  type PackageEnvironmentOperation,
  type PackageEnvironmentOperationDialogPhase,
  type PackageEnvironmentOperationDialogState,
  type PackageTaskDraft,
  type PackageTaskSessionState,
  type PackageWorkspaceStage,
} from "../packaging/packageTaskSession";

const modeLabels: Record<PackageExportMode, string> = {
  cartridge: "游戏卡带 .vncart",
  standalone_package: "打包独立软件包",
  standalone_project: "仅导出固定容器工程",
};

const targetLabels: Record<PackageTargetPlatform, string> = {
  windows: "Windows",
  android: "Android",
};

const targetOptions: Array<RichSelectOption<PackageTargetPlatform>> = [
  { value: "windows", label: "Windows", description: "构建 Windows 独立软件包" },
  { value: "android", label: "Android", description: "构建 Android APK" },
];

const releaseOptimizationOptions: Array<RichSelectOption<ReleaseOptimizationProfile>> = [
  { value: "balanced", label: "均衡优化", description: "默认：感知无损图片优化、字体子集化，失败时保留原资源" },
  { value: "lossless", label: "严格无损", description: "仅采用无损图片转换和字体子集化" },
  { value: "off", label: "关闭优化", description: "保持原始资源，仅生成渐进加载索引" },
];

function formatUploadMiB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

type PackageConsoleLevel = PackageConsoleEntry["level"];

const preflightStatusLabels: Record<PreflightStatus, string> = {
  pass: "通过",
  warning: "警告",
  blocked: "阻断",
};

const preflightStatusIcons: Record<PreflightStatus, typeof CircleCheck> = {
  pass: CircleCheck,
  warning: AlertTriangle,
  blocked: CircleX,
};

function packageStatusLabel(status?: "PASS" | "FAIL" | "BLOCKED" | string): string {
  if (!status) return "未检测";
  if (status === "PASS") return "通过";
  if (status === "FAIL") return "失败";
  if (status === "BLOCKED") return "阻断";
  return status;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function formatImportBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Math.round(bytes)} B`;
}

function useElapsedTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

function createPackageRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `package-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createConsoleEntry(level: PackageConsoleLevel, source: string, message: string, time = Date.now()): PackageConsoleEntry {
  return {
    id: `${time}_${Math.random().toString(16).slice(2)}`,
    time,
    level,
    source,
    message,
  };
}

function formatConsoleTime(time: number): string {
  return new Date(time).toLocaleTimeString("zh-CN", { hour12: false });
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("软件包图标图片无法解码，请更换为可读取的 PNG/JPG/ICO 素材。"));
    image.src = url;
  });
}

async function assetToStandaloneIconBlob(asset: AssetRef): Promise<{ blob: Blob; fileName: string }> {
  const source = await readStandaloneIconSourceBlob(asset);
  const sourceBlob = source.blob;
  if (/\.ico$/i.test(source.fileName) || /icon|ico/i.test(sourceBlob.type)) {
    return { blob: sourceBlob, fileName: source.fileName };
  }

  const objectUrl = URL.createObjectURL(sourceBlob);
  try {
    const image = await loadImageElement(objectUrl);
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建软件包图标画布。");
    context.clearRect(0, 0, size, size);
    const scale = Math.min(size / Math.max(1, image.naturalWidth), size / Math.max(1, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.drawImage(image, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((next) => next ? resolve(next) : reject(new Error("软件包图标 PNG 生成失败。")), "image/png");
    });
    return { blob, fileName: `${asset.asset_id}_standalone_icon.png` };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function PreflightCheckRow({
  check,
  onOpen,
}: {
  check: PreflightCheck;
  onOpen: (check: PreflightCheck, trigger: HTMLButtonElement) => void;
}) {
  const StatusIcon = preflightStatusIcons[check.status];
  const issueCountLabel = check.issues.length === 0
    ? "未发现问题"
    : `${check.issues.length} 项待处理`;
  return (
    <article className={`preflight-check is-${check.status}`}>
      <button
        type="button"
        data-help-key="package.preflight.details"
        data-preflight-check-id={check.id}
        aria-label={`查看${check.title}诊断，${preflightStatusLabels[check.status]}，${issueCountLabel}`}
        onClick={(event) => onOpen(check, event.currentTarget)}
      >
        <span className="preflight-check-title"><StatusIcon size={15} /> {check.title}</span>
        <small>{preflightStatusLabels[check.status]}</small>
        <span className="preflight-check-summary">{issueCountLabel}</span>
        <span className="preflight-check-action">查看 <ChevronRight size={15} aria-hidden="true" /></span>
      </button>
    </article>
  );
}

export function ExportCartridgePanel({ onClose }: { onClose: () => void }) {
  const exportScript = useEditorStore((state) => state.exportScript);
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const selectNode = useEditorStore((state) => state.selectNode);
  const setNotice = useEditorStore((state) => state.setNotice);
  const project = useProjectStore();
  const reactFlow = useReactFlow();
  const script = useMemo(() => applyProjectRuntimeSettingsToScript(exportScript() as RuntimeScript, project.settings), [exportScript, nodes, edges, project.settings]);
  const initialPackageDraft = useMemo<Partial<PackageTaskDraft>>(() => ({
    gameId: normalizeGameId(script.game_id || project.projectId || "agentvn_game") || "agentvn_game",
    title: project.title,
    author: project.author,
    androidApplicationId: project.settings.packageAppearance?.androidApplicationId ?? "",
  }), [project.author, project.projectId, project.settings.packageAppearance?.androidApplicationId, project.title, script.game_id]);
  const packageSession = useMemo(
    () => getPackageTaskSession(project.projectId, initialPackageDraft),
    [project.projectId],
  );
  const packageSessionState = useSyncExternalStore(
    packageSession.subscribe,
    packageSession.getState,
    packageSession.getState,
  );
  const {
    mode,
    targetPlatform,
    gameId,
    title,
    author,
    version,
    androidApplicationId,
    language,
    description,
    includeGallery,
    includeMetadata,
    workspaceStage,
    warningsConfirmed,
    exportProgress,
    consoleEntries,
    consoleOpen,
    packageOutputDir,
    releaseOptimizationProfile,
    packageBuildResult,
    packageResultDialog,
    androidEnvResult,
    androidEnvBusy,
    environmentOperationDialog,
    windowsEnvResult,
    windowsEnvBusy,
  } = {
    ...packageSessionState.draft,
    exportProgress: packageSessionState.exportProgress,
    consoleEntries: packageSessionState.consoleEntries,
    packageBuildResult: packageSessionState.packageBuildResult,
    packageResultDialog: packageSessionState.packageResultDialog,
    androidEnvResult: packageSessionState.androidEnvResult,
    androidEnvBusy: packageSessionState.androidEnvBusy,
    environmentOperationDialog: packageSessionState.environmentOperationDialog,
    windowsEnvResult: packageSessionState.windowsEnvResult,
    windowsEnvBusy: packageSessionState.windowsEnvBusy,
  };
  const setMode = (value: PackageExportMode) => packageSession.setDraft({ mode: value });
  const setTargetPlatform = (value: PackageTargetPlatform) => packageSession.setDraft({ targetPlatform: value });
  const setGameId = (value: string) => packageSession.setDraft({ gameId: value });
  const setTitle = (value: string) => packageSession.setDraft({ title: value });
  const setAuthor = (value: string) => packageSession.setDraft({ author: value });
  const setVersion = (value: string) => packageSession.setDraft({ version: value });
  const setAndroidApplicationId = (value: string) => packageSession.setDraft({ androidApplicationId: value });
  const setLanguage = (value: string) => packageSession.setDraft({ language: value });
  const setDescription = (value: string) => packageSession.setDraft({ description: value });
  const setIncludeGallery = (value: boolean) => packageSession.setDraft({ includeGallery: value });
  const setIncludeMetadata = (value: boolean) => packageSession.setDraft({ includeMetadata: value });
  const setWorkspaceStage = (value: PackageWorkspaceStage) => packageSession.setDraft({ workspaceStage: value });
  const setWarningsConfirmed = (value: boolean) => packageSession.setDraft({ warningsConfirmed: value });
  const setConsoleOpen = (value: boolean | ((current: boolean) => boolean)) => packageSession.setDraft({
    consoleOpen: typeof value === "function" ? value(consoleOpen) : value,
  });
  const setPackageOutputDir = (value: string) => packageSession.setDraft({ packageOutputDir: value });
  const setReleaseOptimizationProfile = (value: ReleaseOptimizationProfile) => packageSession.setDraft({ releaseOptimizationProfile: value });
  function setSessionValue<K extends keyof PackageTaskSessionState>(
    key: K,
    value: PackageTaskSessionState[K] | ((current: PackageTaskSessionState[K]) => PackageTaskSessionState[K]),
  ) {
    packageSession.update((current) => ({
      ...current,
      [key]: typeof value === "function"
        ? (value as (current: PackageTaskSessionState[K]) => PackageTaskSessionState[K])(current[key])
        : value,
    }));
  }
  const setExportProgress = (value: ExportProgressState | undefined) => setSessionValue("exportProgress", value);
  const setConsoleEntries = (value: PackageConsoleEntry[] | ((current: PackageConsoleEntry[]) => PackageConsoleEntry[])) => setSessionValue("consoleEntries", value);
  const setPackageBuildResult = (value: StandalonePackageBuildResult | undefined | ((current: StandalonePackageBuildResult | undefined) => StandalonePackageBuildResult | undefined)) => setSessionValue("packageBuildResult", value);
  const setPackageResultDialog = (value: PackageBuildResultDialogModel | undefined) => setSessionValue("packageResultDialog", value);
  const setAndroidEnvResult = (value: AndroidEnvironmentResult | undefined) => setSessionValue("androidEnvResult", value);
  const setAndroidEnvBusy = (value: "check" | "install" | "import" | null) => setSessionValue("androidEnvBusy", value);
  const setEnvironmentOperationDialog = (value: PackageEnvironmentOperationDialogState | undefined | ((current: PackageEnvironmentOperationDialogState | undefined) => PackageEnvironmentOperationDialogState | undefined)) => setSessionValue("environmentOperationDialog", value);
  const setWindowsEnvResult = (value: WindowsEnvironmentResult | undefined) => setSessionValue("windowsEnvResult", value);
  const setWindowsEnvBusy = (value: "check" | "install" | null) => setSessionValue("windowsEnvBusy", value);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);
  const stageViewportRef = useRef<HTMLElement | null>(null);
  const exportButtonRef = useRef<HTMLButtonElement | null>(null);
  const preflightDetailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const exportProgressStepRef = useRef(0);
  const [preflightDetailCheck, setPreflightDetailCheck] = useState<PreflightCheck>();
  const manifestAssets = useMemo(() => manifestAssetsFromProjectAssets(project.assetManifest), [project.assetManifest]);
  const packageAppearance = project.settings.packageAppearance ?? {};
  const scan = useMemo(() => collectProjectAssets(script, manifestAssets), [manifestAssets, script]);
  const assetAudit = useMemo(() => buildProjectAssetAudit(nodes, project.assetManifest, { includeOptional: true }), [nodes, project.assetManifest]);
  const preflight = useMemo(() => runExportPreflight({
    script,
    nodes,
    edges,
    assets: project.assetManifest,
    metadata: { gameId, title, author, description },
  }), [author, description, edges, gameId, nodes, project.assetManifest, script, title]);
  const isExporting = Boolean(exportProgress);
  const isDesktopRuntime = useMemo(() => "__TAURI_INTERNALS__" in window, []);
  const needsPackageOutputDir = mode === "standalone_package";
  const activeEnvironment = deriveActivePackageEnvironment({
    mode,
    targetPlatform,
    androidBusy: androidEnvBusy,
    windowsBusy: windowsEnvBusy,
    androidResult: androidEnvResult,
    windowsResult: windowsEnvResult,
  });
  const activeEnvBusy = activeEnvironment.busy;
  const activeEnvVerification = activeEnvironment.verification;
  const activeEnvBlocked = activeEnvironment.blocked;
  const activeEnvNeedsVerification = mode === "standalone_package"
    && isDesktopRuntime
    && !activeEnvVerification.freshPass;
  const androidEnvVerification = derivePackageEnvironmentVerification({
    busy: androidEnvBusy,
    result: androidEnvResult,
  });
  const windowsEnvVerification = derivePackageEnvironmentVerification({
    busy: windowsEnvBusy,
    result: windowsEnvResult,
  });
  const exportDisabled =
    isExporting ||
    Boolean(activeEnvBusy) ||
    activeEnvNeedsVerification ||
    preflight.blockers.length > 0 ||
    (preflight.warnings.length > 0 && !warningsConfirmed) ||
    (needsPackageOutputDir && (!packageOutputDir.trim() || !isDesktopRuntime));
  const packageModeOptions = useMemo<Array<RichSelectOption<PackageExportMode>>>(() => [
    {
      value: "standalone_package",
      label: `打包 ${targetLabels[targetPlatform]} 单软件`,
      description: "生成可分发的独立玩家客户端",
    },
    {
      value: "cartridge",
      label: "游戏卡带 .vncart",
      description: "导出轻量卡带文件",
    },
  ], [targetPlatform]);
  const exportActionLabel = isExporting
    ? "正在导出..."
    : mode === "cartridge"
    ? "打包与发布"
    : activeEnvBusy
    ? `正在${activeEnvBusy === "install" ? "补齐" : activeEnvBusy === "import" ? "导入" : "检测"} ${targetLabels[targetPlatform]} 环境...`
    : activeEnvVerification.state === "unchecked"
    ? `请先检测 ${targetLabels[targetPlatform]} 环境`
    : activeEnvBlocked
    ? `请先补齐 ${targetLabels[targetPlatform]} 环境`
    : preflight.blockers.length > 0
    ? "存在阻断项，禁止导出"
    : preflight.warnings.length > 0 && !warningsConfirmed
      ? "确认警告后导出"
    : mode === "standalone_package"
        ? `构建 ${targetLabels[targetPlatform]} 独立软件包`
        : `导出${targetLabels[targetPlatform]}固定容器工程`;
  const exportActionHint = isExporting
    ? exportProgress?.detail ?? "正在准备发布内容"
    : mode === "cartridge"
      ? "生成可导入和分发的 .vncart 文件"
    : activeEnvBusy
      ? "环境操作完成后即可继续"
      : activeEnvVerification.state === "unchecked"
        ? activeEnvVerification.detail
      : activeEnvBlocked
        ? `${targetLabels[targetPlatform]} 构建环境尚未就绪`
        : preflight.blockers.length > 0
          ? `${preflight.blockers.length} 个阻断项需要先处理`
          : preflight.warnings.length > 0 && !warningsConfirmed
            ? `${preflight.warnings.length} 个警告等待确认`
            : needsPackageOutputDir && !packageOutputDir.trim()
              ? "请选择软件包输出目录"
              : `开始生成 ${targetLabels[targetPlatform]} 发布产物`;
  const buildDockStatusLabel = isExporting
    ? exportProgress?.stage ?? "正在构建"
    : mode === "cartridge"
      ? "准备就绪"
    : activeEnvVerification.state === "unchecked"
      ? "环境尚未检测"
    : activeEnvBlocked
      ? "构建环境未就绪"
      : preflight.blockers.length > 0
        ? "发布被阻断"
        : preflight.warnings.length > 0 && !warningsConfirmed
          ? "等待确认警告"
          : needsPackageOutputDir && !packageOutputDir.trim()
            ? "等待选择输出目录"
            : "准备就绪";
  const passedCheckCount = preflight.checks.filter((check) => check.status === "pass").length;
  const workspaceStages = [
    {
      id: "settings" as const,
      label: "发布设置",
      description: mode === "cartridge" ? "卡带发布" : `${targetLabels[targetPlatform]} 软件包`,
      status: mode === "cartridge"
        ? "无需环境"
        : activeEnvVerification.label,
      tone: mode === "cartridge" || activeEnvVerification.state === "passed"
        ? "pass"
        : activeEnvVerification.state === "failed"
          ? "blocked"
          : "neutral",
      icon: Settings2,
    },
    {
      id: "assets" as const,
      label: "视觉资源",
      description: `${scan.manifestAssets.length} 项已收录`,
      status: assetAudit.pending.length > 0 ? `${assetAudit.pending.length} 项待处理` : "资源完整",
      tone: assetAudit.pending.length > 0 ? "warning" : "pass",
      icon: ImageIcon,
    },
    {
      id: "checks" as const,
      label: "发布检查",
      description: `${passedCheckCount}/${preflight.checks.length} 项通过`,
      status: preflight.blockers.length > 0
        ? `${preflight.blockers.length} 项阻断`
        : preflight.warnings.length > 0
          ? `${preflight.warnings.length} 项警告`
          : "全部通过",
      tone: preflight.status,
      icon: ShieldCheck,
    },
  ];
  useElapsedTicker(isExporting);
  useElapsedTicker(Boolean(environmentOperationDialog && !["completed", "failed"].includes(environmentOperationDialog.phase)));

  function updatePackageAppearance(partial: Partial<typeof packageAppearance>) {
    project.setPackageAppearance({ ...packageAppearance, ...partial });
  }

  function appendConsole(level: PackageConsoleLevel, source: string, message: string, time?: number) {
    const normalized = message.trim();
    if (!normalized) return;
    if (level === "error") {
      reportFrontendError("editor.package", normalized, { source, time: time ?? Date.now() });
    }
    setConsoleEntries((current) => [...current.slice(-399), createConsoleEntry(level, source, normalized, time)]);
  }

  function appendBuildLog(event: PackageBuildLogEvent) {
    appendConsole(event.level, event.source || "build", event.message, event.timestampMs || Date.now());
  }

  function beginEnvironmentOperation(
    platform: PackageTargetPlatform,
    operation: PackageEnvironmentOperation,
    input?: Partial<Pick<PackageEnvironmentOperationDialogState, "phase" | "message" | "percent" | "installSource">>,
  ) {
    const action = operation === "check" ? "检测" : operation === "install" ? "补齐" : "导入";
    setEnvironmentOperationDialog({
      platform,
      operation,
      phase: input?.phase ?? "preparing",
      message: input?.message ?? `正在初始化 ${targetLabels[platform]} 构建环境${action}…`,
      percent: input?.percent ?? 2,
      processedBytes: 0,
      totalBytes: 0,
      processedFiles: 0,
      totalFiles: 0,
      reclaimedBytes: 0,
      installSource: input?.installSource,
      startedAt: Date.now(),
    });
  }

  function completeEnvironmentOperation(
    platform: PackageTargetPlatform,
    operation: PackageEnvironmentOperation,
    result: { status?: string; message?: string; reclaimedBytes?: number },
    successMessage?: string,
  ) {
    setEnvironmentOperationDialog((current) => {
      if (!current || current.platform !== platform || current.operation !== operation) return current;
      const passed = result.status === "PASS";
      return {
        ...current,
        phase: passed ? "completed" : "failed",
        message: passed
          ? successMessage ?? `${targetLabels[platform]} 构建环境已通过本次${operation === "check" ? "检测" : "补齐"}。`
          : `${targetLabels[platform]} 构建环境${operation === "check" ? "检测" : "补齐"}未通过。`,
        percent: 100,
        reclaimedBytes: Math.max(current.reclaimedBytes, result.reclaimedBytes ?? 0),
        detail: passed ? current.detail : result.message,
      };
    });
  }

  function failEnvironmentOperation(
    platform: PackageTargetPlatform,
    operation: PackageEnvironmentOperation,
    message: string,
  ) {
    setEnvironmentOperationDialog((current) => (
      !current || current.platform !== platform || current.operation !== operation
        ? current
        : { ...current, phase: "failed", message: `${targetLabels[platform]} 构建环境操作失败。`, detail: message }
    ));
  }

  function applyEnvironmentOperationProgress(progress: PackageEnvironmentOperationProgress) {
    setEnvironmentOperationDialog((current) => {
      if (
        !current
        || current.platform !== progress.platform
        || current.operation !== progress.operation
        || ["completed", "failed"].includes(current.phase)
      ) {
        return current;
      }
      const phase = [
        "preparing",
        "selecting",
        "checking",
        "cleaning",
        "installing",
        "verifying",
        "validating",
        "extracting",
        "validated",
        "deploying",
        "completed",
        "failed",
      ].includes(progress.phase)
        ? progress.phase as PackageEnvironmentOperationDialogPhase
        : current.phase;
      return {
        ...current,
        phase,
        message: progress.message || current.message,
        percent: Math.min(100, Math.max(current.percent, progress.percent)),
      };
    });
  }

  function applyAndroidEnvironmentInstallProgress(progress: AndroidEnvironmentImportProgress) {
    setEnvironmentOperationDialog((current) => {
      if (!current || !["install", "import"].includes(current.operation)) return current;
      const phase = [
        "checking",
        "cleaning",
        "installing",
        "verifying",
        "validating",
        "extracting",
        "validated",
        "deploying",
        "completed",
      ].includes(progress.phase)
        ? progress.phase as PackageEnvironmentOperationDialogPhase
        : current.phase;
      return {
        ...current,
        phase,
        message: progress.message || current.message,
        percent: Math.min(100, Math.max(current.percent, progress.percent)),
        processedBytes: progress.processedBytes,
        totalBytes: progress.totalBytes,
        processedFiles: progress.processedFiles,
        totalFiles: progress.totalFiles,
        reclaimedBytes: Math.max(current.reclaimedBytes, progress.reclaimedBytes ?? 0),
        installSource: progress.installSource === "online" || progress.installSource === "avnenv"
          ? progress.installSource
          : current.installSource,
      };
    });
  }

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ block: "end" });
  }, [consoleEntries]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      stageViewportRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [workspaceStage]);

  function locateNode(nodeId?: string) {
    if (!nodeId) return;
    selectNode(nodeId);
    window.requestAnimationFrame(() => {
      void reactFlow.fitView({ nodes: [{ id: nodeId }], padding: 0.42, duration: 420 });
    });
  }

  function openPreflightDetail(check: PreflightCheck, trigger: HTMLButtonElement) {
    preflightDetailTriggerRef.current = trigger;
    setPreflightDetailCheck(check);
  }

  const preflightSignatureRef = useRef(preflight.signature);
  const packageBuildResetKeyRef = useRef(`${mode}:${targetPlatform}:${packageOutputDir}`);
  const automaticEnvironmentChecks = useRef(new Set<string>());

  useEffect(() => {
    if (!isDesktopRuntime || mode !== "standalone_package" || isExporting || androidEnvBusy || windowsEnvBusy) return;
    const key = `${project.projectId}:${targetPlatform}`;
    const result = targetPlatform === "android" ? androidEnvResult : windowsEnvResult;
    if (result || automaticEnvironmentChecks.current.has(key)) return;
    automaticEnvironmentChecks.current.add(key);
    // The host persists successful checks with its editor version. After an
    // upgrade it rejects the old result and runs a new check automatically.
    if (targetPlatform === "android") void runAndroidEnvironmentCheck(false);
    else void runWindowsEnvironmentCheck(false);
  }, [isDesktopRuntime, mode, targetPlatform, project.projectId, isExporting, androidEnvBusy, windowsEnvBusy, androidEnvResult, windowsEnvResult]);

  useEffect(() => {
    if (preflightSignatureRef.current === preflight.signature) return;
    preflightSignatureRef.current = preflight.signature;
    setWarningsConfirmed(false);
  }, [preflight.signature]);

  useEffect(() => {
    const resetKey = `${mode}:${targetPlatform}:${packageOutputDir}`;
    if (packageBuildResetKeyRef.current === resetKey) return;
    packageBuildResetKeyRef.current = resetKey;
    setPackageBuildResult(undefined);
  }, [mode, targetPlatform, packageOutputDir]);

  async function choosePackageOutputDir() {
    try {
      const selected = await selectStandalonePackageOutputDir();
      if (selected) {
        setPackageOutputDir(selected);
        appendConsole("info", "output", `已选择软件包导出目录：${selected}`);
      }
    } catch (error) {
      reportFrontendError("editor.packaging", error, { operation: "select-output-directory" });
      appendConsole("error", "output", error instanceof Error ? error.message : "选择软件包导出目录失败");
    }
  }

  async function openPackageDiagnostics() {
    const diagnosticsDir = packageBuildResult?.diagnosticsDir;
    if (!diagnosticsDir) return;
    try {
      await openStandalonePackageDiagnostics(diagnosticsDir);
      appendConsole("info", "diagnostics", `已打开错误目录：${diagnosticsDir}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法打开错误目录。";
      reportFrontendError("editor.packaging", error, { operation: "open-package-diagnostics", diagnosticsDir });
      appendConsole("error", "diagnostics", message);
      appendConsole("info", "diagnostics", `错误目录：${diagnosticsDir}`);
    }
  }

  async function openPackageResultContextAction() {
    const action = packageResultDialog?.action;
    if (!action) return;
    try {
      if (action.kind === "output") {
        await openStandalonePackageOutputDirectory(action.path);
        appendConsole("info", "result", `已打开输出目录：${action.path}`);
      } else {
        await openStandalonePackageDiagnostics(action.path);
        appendConsole("info", "diagnostics", `已打开诊断目录：${action.path}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法打开构建结果目录。";
      reportFrontendError("editor.packaging", error, {
        operation: action.kind === "output" ? "open-package-output-directory" : "open-package-result-diagnostics",
        path: action.path,
      });
      appendConsole("error", "result", message);
      setNotice({
        tone: "error",
        source: "软件构建结果",
        message,
        detail: action.path,
        action: "结果弹窗会保持打开，请检查目录是否仍然存在。",
      });
    }
  }

  async function exportPackageDiagnostics() {
    const diagnosticsDir = packageBuildResult?.diagnosticsDir;
    if (!diagnosticsDir) return;
    try {
      const archivePath = await exportStandalonePackageDiagnostics(diagnosticsDir);
      appendConsole("success", "diagnostics", `诊断包已生成：${archivePath}`);
      appendConsole("info", "diagnostics", "请将该 ZIP 文件发送给开发者。");
      setPackageBuildResult((current) => current ? { ...current, diagnosticsArchivePath: archivePath } : current);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法导出诊断包。";
      reportFrontendError("editor.packaging", error, { operation: "export-package-diagnostics", diagnosticsDir });
      appendConsole("error", "diagnostics", message);
      appendConsole("info", "diagnostics", `错误目录：${diagnosticsDir}`);
    }
  }

  async function runAndroidEnvironmentCheck(install: boolean, forceRecheck = false) {
    const runId = createPackageRunId();
    const operation: PackageEnvironmentOperation = install ? "install" : "check";
    if (!packageSession.beginTask({ kind: "environment", platform: "android", operation, runId })) return;
    let unlistenEnvLogs: (() => void) | undefined;
    let unlistenOperationProgress: (() => void) | undefined;
    let unlistenInstallProgress: (() => void) | undefined;
    setAndroidEnvBusy(install ? "install" : "check");
    beginEnvironmentOperation("android", install ? "install" : "check", {
      message: install ? "正在准备补齐 Android 构建环境…" : "正在准备检测 Android 构建环境…",
      installSource: install ? "online" : undefined,
    });
    appendConsole("info", "android-env", install ? "开始补齐 Android 打包环境。" : "开始检测 Android 打包环境。");
    try {
      try {
        unlistenEnvLogs = await listenStandalonePackageLogs(runId, appendBuildLog);
      } catch (error) {
        reportFrontendError("editor.packaging", error, {
          operation: "listen-android-environment-log",
          runId,
        });
        appendConsole("warning", "console", error instanceof Error ? error.message : "无法监听 Android 环境修复实时日志，仍会继续执行。");
      }
      try {
        unlistenOperationProgress = await listenPackageEnvironmentOperationProgress(
          runId,
          applyEnvironmentOperationProgress,
        );
      } catch (error) {
        reportFrontendError("editor.packaging", error, {
          operation: "listen-android-environment-operation-progress",
          runId,
        });
      }
      if (install) {
        try {
          unlistenInstallProgress = await listenAndroidEnvironmentImportProgress(
            runId,
            applyAndroidEnvironmentInstallProgress,
          );
        } catch (error) {
          reportFrontendError("editor.packaging", error, {
            operation: "listen-android-environment-install-progress",
            runId,
          });
        }
      }
      const result = install
        ? await installAndroidBuildEnvironment(runId)
        : await checkAndroidBuildEnvironment(runId, forceRecheck);
      setAndroidEnvResult(result);
      const action = install ? "Android 打包环境补齐" : "Android 打包环境检测";
      appendConsole(result.status === "PASS" ? "success" : "warning", "android-env", `${action}：${packageStatusLabel(result.status)}`);
      if (result.cacheHit) appendConsole("success", "android-env", "已复用此前通过的环境检测，本次未重复执行完整检查。");
      for (const item of result.missing ?? []) appendConsole("warning", "android-env", `缺失：${item}`);
      for (const item of result.warnings ?? []) appendConsole("warning", "android-env", item);
      if (result.symlinkElevation?.status === "PASS") {
        appendConsole("success", "android-env", "已通过一次性管理员探针确认 Windows 符号链接能力。");
      } else if (result.symlinkElevation?.status === "DEFERRED_TO_BUILD") {
        appendConsole("info", "android-env", result.status === "PASS"
          ? "Android 工具链已就绪；Android 独立包构建默认需要管理员权限，开始构建时会请求 UAC 授权。"
          : "符号链接权限将在实际构建时检查；当前环境检测尚未通过。");
      } else if (result.symlinkElevation?.status === "UAC_CANCELLED") {
        appendConsole("warning", "android-env", "用户取消了管理员权限请求；Android 工具链已保留，下次构建仍会再次请求一次权限。");
      }
      if (result.reportPath) appendConsole("info", "android-env", `环境报告：${result.reportPath}`);
      if (result.logPath) appendConsole("info", "android-env", `环境日志：${result.logPath}`);
      if (result.commandLogPath) appendConsole("info", "android-env", `命令日志：${result.commandLogPath}`);
      for (const item of visiblePackageEnvironmentManualFix(result)) appendConsole("warning", "android-env", item);
      const deferredElevation = result.status === "PASS" && result.symlinkElevation?.status === "DEFERRED_TO_BUILD";
      completeEnvironmentOperation("android", install ? "install" : "check", result, deferredElevation
        ? "Android 构建环境已通过检测；Android 独立包构建默认需要管理员权限，开始构建时会请求 UAC 授权。"
        : install
          ? "Android 构建依赖已安装完成，后续打包会直接复用。"
          : "Android 构建环境已完成本次检测。");
      if (install) {
        setEnvironmentOperationDialog((current) => (
          current?.platform === "android" && current.operation === "install"
            ? {
            ...current,
            installSource: "online",
            detail: result.status === "PASS"
              ? deferredElevation
                ? "当前只保留本次安装的 AgentVN Android 环境。Android 独立包构建默认需要管理员权限，开始构建时会请求 UAC 授权。"
                : "当前只保留本次安装的 AgentVN Android 环境。"
              : result.message,
            }
            : current
        ));
      }
      return result;
    } catch (error) {
      reportFrontendError("editor.packaging", error, {
        operation: install ? "install-android-environment" : "check-android-environment",
        runId,
      });
      const message = error instanceof Error ? error.message : "Android 打包环境检测失败";
      const failureResult: AndroidEnvironmentResult = {
        ok: false,
        status: "BLOCKED",
        message,
        installAttempted: install,
        checks: [],
        missing: ["Android 环境检测调用失败"],
        warnings: [message],
        manualFix: [
          "请确认当前运行的是最新 AgentVN 桌面版；如刚更新源码，请重新构建/重启桌面端。",
          "也可以在 AgentVN 工作区手动运行 scripts/setup-android-build-env.ps1 -Json 检查环境。",
        ],
      };
      setAndroidEnvResult(failureResult);
      appendConsole("error", "android-env", message);
      failEnvironmentOperation("android", install ? "install" : "check", message);
      packageSession.completeTask({ platform: "android", runId, status: "failed", error: message });
      return undefined;
    } finally {
      unlistenEnvLogs?.();
      unlistenOperationProgress?.();
      unlistenInstallProgress?.();
      setAndroidEnvBusy(null);
      if (packageSession.getState().environmentTasks.android?.runId === runId
        && packageSession.getState().environmentTasks.android?.status === "running") {
        packageSession.completeTask({ platform: "android", runId, status: "completed" });
      }
    }
  }

  async function runAndroidEnvironmentImport() {
    const runId = createPackageRunId();
    if (!packageSession.beginTask({ kind: "environment", platform: "android", operation: "import", runId })) return;
    let unlistenEnvLogs: (() => void) | undefined;
    let unlistenOperationProgress: (() => void) | undefined;
    let unlistenImportProgress: (() => void) | undefined;
    setAndroidEnvBusy("import");
    beginEnvironmentOperation("android", "import", {
      phase: "selecting",
      message: "请选择 AgentVN Android 构建依赖包。",
      installSource: "avnenv",
    });
    appendConsole("info", "android-env-import", "请选择 AgentVN Android 构建依赖包（.avnenv 或 .zip）。");
    try {
      try {
        unlistenEnvLogs = await listenStandalonePackageLogs(runId, appendBuildLog);
      } catch (error) {
        reportFrontendError("editor.packaging", error, {
          operation: "listen-android-environment-import-log",
          runId,
        });
      }
      try {
        unlistenOperationProgress = await listenPackageEnvironmentOperationProgress(
          runId,
          applyEnvironmentOperationProgress,
        );
      } catch (error) {
        reportFrontendError("editor.packaging", error, {
          operation: "listen-android-environment-import-operation-progress",
          runId,
        });
      }
      try {
        unlistenImportProgress = await listenAndroidEnvironmentImportProgress(
          runId,
          applyAndroidEnvironmentInstallProgress,
        );
      } catch (error) {
        reportFrontendError("editor.packaging", error, {
          operation: "listen-android-environment-import-progress",
          runId,
        });
      }
      const result = await importAndroidEnvironmentPackage(runId);
      if (!result) {
        setEnvironmentOperationDialog(undefined);
        return result;
      }
      setAndroidEnvResult(result);
      const imported = result.importedEnvironmentPackage;
      const summary = imported
        ? `已导入 ${imported.packVersion}（${imported.fileCount.toLocaleString()} 个文件）`
        : result.message;
      const deferredElevation = result.symlinkElevation?.status === "DEFERRED_TO_BUILD";
      const completionMessage = deferredElevation
        ? "构建依赖已经导入完成。Android 独立包构建默认需要管理员权限，开始构建时会请求 UAC 授权。"
        : "构建依赖已经导入完成，可以继续打包。";
      appendConsole(
        result.status === "PASS" ? "success" : "warning",
        "android-env-import",
        summary,
      );
      if (deferredElevation) {
        appendConsole("info", "android-env-import", "Android 独立包构建默认需要管理员权限；开始构建时会执行权威符号链接探测并请求 UAC 授权。");
      }
      for (const item of result.warnings ?? []) appendConsole("warning", "android-env-import", item);
      if (result.reportPath) appendConsole("info", "android-env-import", `环境报告：${result.reportPath}`);
      if (result.logPath) appendConsole("info", "android-env-import", `环境日志：${result.logPath}`);
      completeEnvironmentOperation("android", "import", result, completionMessage);
      setEnvironmentOperationDialog((current) => (
        current?.platform === "android" && current.operation === "import"
          ? {
            ...current,
            processedBytes: imported?.totalBytes ?? current.processedBytes,
            totalBytes: imported?.totalBytes ?? current.totalBytes,
            processedFiles: imported?.fileCount ?? current.processedFiles,
            totalFiles: imported?.fileCount ?? current.totalFiles,
            reclaimedBytes: imported?.reclaimedBytes ?? result.reclaimedBytes ?? current.reclaimedBytes,
            installSource: "avnenv",
            detail: result.status === "PASS"
              ? deferredElevation
                ? `${summary}。Android 独立包构建默认需要管理员权限，开始构建时会请求 UAC 授权。`
                : summary
              : result.message,
          }
          : current
      ));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Android 构建依赖导入失败";
      reportFrontendError("editor.packaging", error, {
        operation: "import-android-environment-package",
        runId,
      });
      appendConsole("error", "android-env-import", message);
      failEnvironmentOperation("android", "import", message);
      packageSession.completeTask({ platform: "android", runId, status: "failed", error: message });
      return undefined;
    } finally {
      unlistenEnvLogs?.();
      unlistenOperationProgress?.();
      unlistenImportProgress?.();
      setAndroidEnvBusy(null);
      if (packageSession.getState().environmentTasks.android?.runId === runId
        && packageSession.getState().environmentTasks.android?.status === "running") {
        packageSession.completeTask({ platform: "android", runId, status: "completed" });
      }
    }
  }


  async function runWindowsEnvironmentCheck(install: boolean, forceRecheck = false) {
    const runId = createPackageRunId();
    const operation: PackageEnvironmentOperation = install ? "install" : "check";
    if (!packageSession.beginTask({ kind: "environment", platform: "windows", operation, runId })) return;
    let unlistenEnvLogs: (() => void) | undefined;
    let unlistenOperationProgress: (() => void) | undefined;
    setWindowsEnvBusy(install ? "install" : "check");
    beginEnvironmentOperation("windows", install ? "install" : "check", {
      message: install ? "正在准备补齐 Windows 构建环境…" : "正在准备检测 Windows 构建环境…",
    });
    appendConsole("info", "windows-env", install ? "开始补齐 Windows 打包环境。" : "开始检测 Windows 打包环境。");
    try {
      try {
        unlistenEnvLogs = await listenStandalonePackageLogs(runId, appendBuildLog);
      } catch (error) {
        reportFrontendError("editor.packaging", error, {
          operation: "listen-windows-environment-log",
          runId,
        });
        appendConsole("warning", "console", error instanceof Error ? error.message : "无法监听 Windows 环境修复实时日志，仍会继续执行。");
      }
      try {
        unlistenOperationProgress = await listenPackageEnvironmentOperationProgress(
          runId,
          applyEnvironmentOperationProgress,
        );
      } catch (error) {
        reportFrontendError("editor.packaging", error, {
          operation: "listen-windows-environment-operation-progress",
          runId,
        });
      }
      const result = install
        ? await installWindowsBuildEnvironment(runId)
        : await checkWindowsBuildEnvironment(runId, forceRecheck);
      setWindowsEnvResult(result);
      const action = install ? "Windows 打包环境补齐" : "Windows 打包环境检测";
      appendConsole(result.status === "PASS" ? "success" : "warning", "windows-env", action + "：" + packageStatusLabel(result.status));
      if (result.cacheHit) appendConsole("success", "windows-env", "已复用此前通过的环境检测，本次未重复执行完整检查。");
      for (const item of result.missing ?? []) appendConsole("warning", "windows-env", "缺失：" + item);
      for (const item of result.warnings ?? []) appendConsole("warning", "windows-env", item);
      for (const item of result.actions ?? []) appendConsole("info", "windows-env", item);
      if (result.reportPath) appendConsole("info", "windows-env", "环境报告：" + result.reportPath);
      if (result.logPath) appendConsole("info", "windows-env", "环境日志：" + result.logPath);
      if (result.message) appendConsole("info", "windows-env", "检测详情：" + result.message);
      if (result.commandLogPath) appendConsole("info", "windows-env", "命令日志：" + result.commandLogPath);
      for (const item of visiblePackageEnvironmentManualFix(result)) appendConsole("warning", "windows-env", item);
      completeEnvironmentOperation("windows", install ? "install" : "check", result, install
        ? "Windows 构建环境已补齐并通过复检。"
        : "Windows 构建环境已完成本次检测。");
      return result;
    } catch (error) {
      reportFrontendError("editor.packaging", error, {
        operation: install ? "install-windows-environment" : "check-windows-environment",
        runId,
      });
      const message = error instanceof Error ? error.message : "Windows 打包环境检测失败";
      const failureResult: WindowsEnvironmentResult = {
        ok: false,
        status: "BLOCKED",
        message,
        installAttempted: install,
        checks: [],
        missing: ["Windows 环境检测调用失败"],
        warnings: [message],
        manualFix: [
          "请确认当前运行的是最新 AgentVN 桌面版；如刚更新源码，请重新构建/重启桌面端。",
          "也可以手动检查 Node.js LTS、npm、rustup/cargo 和 Visual Studio 2022 Build Tools（桌面 C++ 工作负载）。",
        ],
      };
      setWindowsEnvResult(failureResult);
      appendConsole("error", "windows-env", message);
      failEnvironmentOperation("windows", install ? "install" : "check", message);
      packageSession.completeTask({ platform: "windows", runId, status: "failed", error: message });
      return undefined;
    } finally {
      unlistenEnvLogs?.();
      unlistenOperationProgress?.();
      setWindowsEnvBusy(null);
      if (packageSession.getState().environmentTasks.windows?.runId === runId
        && packageSession.getState().environmentTasks.windows?.status === "running") {
        packageSession.completeTask({ platform: "windows", runId, status: "completed" });
      }
    }
  }

  async function runExport() {
    if (isExporting) return;
    const startedAt = Date.now();
    const runMode = mode;
    const runTargetPlatform = targetPlatform;
    const runOutputDir = packageOutputDir.trim();
    exportProgressStepRef.current = 0;
    const runId = createPackageRunId();
    if (!packageSession.beginTask({
      kind: "export",
      platform: runTargetPlatform,
      runId,
      startedAt,
    })) return;
    setPackageBuildResult(undefined);
    setPackageResultDialog(undefined);
    setConsoleEntries([
      createConsoleEntry(
        "info",
        "export",
        `开始${mode === "cartridge" ? "打包与发布" : mode === "standalone_package" ? `构建 ${targetLabels[targetPlatform]} 独立软件包` : `导出 ${targetLabels[targetPlatform]} 固定容器工程`}。`,
        startedAt,
      ),
    ]);
    const updateExportProgress = (stage: string, detail: string) => {
      exportProgressStepRef.current += 1;
      const percent = Math.min(96, Math.max(4, Math.round((exportProgressStepRef.current / 8) * 100)));
      setExportProgress({ stage, detail, percent, startedAt, updatedAt: Date.now() });
      appendConsole("info", "stage", `${stage}：${detail}`);
    };
    try {
      const needsEnvironmentRepair = mode === "standalone_package" && isDesktopRuntime && activeEnvBlocked;
      if (needsEnvironmentRepair) {
        const confirmed = window.confirm("Build environment is missing required components. AgentVN will install and recheck them, possibly requiring elevation. Continue?");
        if (!confirmed) {
          appendConsole("warning", "environment", "Build cancelled before automatic environment repair.");
          setExportProgress(undefined);
          return;
        }
        updateExportProgress("Repairing build environment", "Installing missing components and rechecking before continuing.");
        const repaired = targetPlatform === "android"
          ? await runAndroidEnvironmentCheck(true)
          : await runWindowsEnvironmentCheck(true);
        if (repaired?.status !== "PASS") {
          const message = repaired?.message ?? "Build environment repair failed; packaging did not continue.";
          appendConsole("error", "environment", message);
          setPackageResultDialog(createPackageBuildBlockedDialogModel(runTargetPlatform, message));
          setExportProgress(undefined);
          return;
        }
      }
      updateExportProgress("校验剧本", "正在检查入口、连线、资源引用和发布元数据。");
      if (preflight.blockers.length > 0) {
        appendConsole("error", "preflight", `导出已阻断：${preflight.blockers.map((issue) => issue.message).join("；")}`);
        setExportProgress(undefined);
        return;
      }
      if (preflight.warnings.length > 0 && !warningsConfirmed) {
        appendConsole("warning", "preflight", "存在发布前警告，等待用户确认后继续。");
        appendConsole("info", "preflight", "请确认这些警告不会影响本次发布，然后再继续导出。");
        setExportProgress(undefined);
        return;
      }
      const exportInput = {
        script,
        gameId: normalizeGameId(gameId),
        title: title.trim(),
        author: author.trim(),
        version,
        language,
        description: description.trim(),
        includeGallery,
        includeMetadata,
        targetPlatform,
        projectAssets: manifestAssets,
        projectAssetRefs: project.assetManifest,
        uiSkin: project.settings.runtimeUILayout,
        uiLayoutProfiles: project.settings.runtimeUILayoutProfiles,
        packageAppearance: project.settings.packageAppearance,
        characterDialogStyles: project.settings.characterDialogStyles,
      };

      if (mode === "standalone_package") {
        const releaseIdentity = buildReleaseIdentity({
          title,
          gameId: normalizeGameId(gameId),
          versionName: version,
          androidApplicationId,
        });
        if (androidApplicationId.trim() !== (packageAppearance.androidApplicationId ?? "")) {
          updatePackageAppearance({ androidApplicationId: androidApplicationId.trim() || undefined });
        }
        if (!packageOutputDir.trim()) {
          appendConsole("error", "output", "请先选择软件包导出目录。");
          setExportProgress(undefined);
          return;
        }
        updateExportProgress("打包 vncart", `正在准备 ${scan.manifestAssets.length} 个资源并内嵌到 ${targetLabels[targetPlatform]} 软件包。`);
        const directory = "__TAURI_INTERNALS__" in window
          ? await exportEditorPreviewDirectory(exportInput)
          : undefined;
        const nativeDirectory = directory && canBuildStandaloneFromFileBackedAssets(directory)
          ? directory : undefined;
        const cartridge = nativeDirectory ? undefined : await exportEditorCartridge(exportInput);
        const cartridgeFileName = nativeDirectory?.fileName ?? cartridge!.fileName;
        const cartridgeManifest = nativeDirectory?.manifest ?? cartridge!.manifest;
        const cartridgeWarnings = nativeDirectory?.warnings ?? cartridge!.warnings;
        appendConsole("success", "vncart", nativeDirectory
          ? `${cartridgeFileName} 已准备磁盘流式打包，资源 ${cartridgeManifest.assets.length} 项。`
          : `${cartridgeFileName} 已生成，资源 ${cartridgeManifest.assets.length} 项。`);
        for (const warning of cartridgeWarnings) appendConsole("warning", "vncart", warning);
        const standaloneIconSelection = resolveStandaloneIconAsset(packageAppearance, project.assetManifest);
        const standaloneIconAsset = standaloneIconSelection.asset;
        let standaloneIcon: { blob: Blob; fileName: string } | undefined;
        let standaloneIconSource: "project" | "default" | "fallback" = "default";
        if (standaloneIconSelection.assetId && !standaloneIconAsset) {
          throw new Error(`已配置的软件包图标素材不存在：${standaloneIconSelection.assetId}。请重新选择图标后再打包。`);
        }
        if (standaloneIconAsset) {
          try {
            standaloneIcon = await assetToStandaloneIconBlob(standaloneIconAsset);
            standaloneIconSource = "project";
            appendConsole("info", "icon", `单软件包图标：${standaloneIconAsset.asset_id}`);
          } catch (error) {
            reportFrontendError("editor.packaging", error, {
              operation: "read-standalone-icon",
              assetId: standaloneIconAsset.asset_id,
            });
            const message = error instanceof Error ? error.message : "软件包图标读取失败。";
            appendConsole("error", "icon", `${message} 为避免生成错误图标的安装包，本次打包已停止。`);
            throw error;
          }
        }
        updateExportProgress(nativeDirectory ? "磁盘流式打包" : "传输卡带", nativeDirectory
          ? `正在由桌面宿主逐个读取并校验 ${nativeDirectory.assets.length} 个素材，避免浏览器内存峰值。`
          : `正在向桌面打包宿主传输 ${formatUploadMiB(cartridge!.blob.size)} MiB 卡带数据。`);
        appendConsole("info", "upload", nativeDirectory
          ? `由桌面宿主流式生成 ${cartridgeFileName}（${nativeDirectory.assets.length} 个本机文件）。`
          : `开始分块传输 ${cartridgeFileName}（${formatUploadMiB(cartridge!.blob.size)} MiB）。`);
        let uploadCompleted = false;
        let unlistenBuildLogs: (() => void) | undefined;
        try {
          unlistenBuildLogs = await listenStandalonePackageLogs(runId, appendBuildLog);
        } catch (error) {
          reportFrontendError("editor.packaging", error, {
            operation: "listen-build-log",
            runId,
          });
          appendConsole("warning", "console", error instanceof Error ? error.message : "无法监听构建流式日志，仍会继续构建。");
        }
        const buildResult = await (async () => {
          try {
            return nativeDirectory
              ? await buildStandalonePackageFromFiles({
                targetPlatform,
                outputDir: packageOutputDir.trim(),
                directory: nativeDirectory,
                runId,
                optimizationProfile: releaseOptimizationProfile,
                standaloneIcon: standaloneIcon?.blob,
                standaloneIconFileName: standaloneIcon?.fileName,
                releaseIdentity,
                iconSource: standaloneIconSource,
              })
              : await buildStandalonePackage({
              targetPlatform,
              outputDir: packageOutputDir.trim(),
              cartridge: cartridge!.blob,
              fileName: cartridgeFileName,
              runId,
              optimizationProfile: releaseOptimizationProfile,
              standaloneIcon: standaloneIcon?.blob,
              standaloneIconFileName: standaloneIcon?.fileName,
              releaseIdentity,
              iconSource: standaloneIconSource,
              onUploadProgress: (progress) => {
                const uploadPercent = Math.max(0, Math.min(100, progress.percent));
                const uploadDetail = `已传输 ${formatUploadMiB(progress.uploadedBytes)} MiB / ${formatUploadMiB(progress.totalBytes)} MiB（${uploadPercent}%）`;
                setExportProgress({
                  stage: uploadPercent >= 100 ? `构建 ${targetLabels[targetPlatform]} 独立软件包` : "传输卡带",
                  detail: uploadPercent >= 100
                    ? `${uploadDetail}；传输完成，后端正在构建。`
                    : uploadDetail,
                  percent: Math.min(96, 32 + Math.round(uploadPercent * 0.28)),
                  startedAt,
                  updatedAt: Date.now(),
                });
                if (uploadPercent >= 100 && !uploadCompleted) {
                  uploadCompleted = true;
                  appendConsole("success", "upload", `卡带传输完成（${formatUploadMiB(progress.totalBytes)} MiB），开始后端构建。`);
                }
              },
              });
          } finally {
            unlistenBuildLogs?.();
          }
        })();
        if (buildResult.status !== "PASS") {
          reportFrontendError("editor.package", buildResult.message, {
            status: buildResult.status,
            targetPlatform,
            warnings: buildResult.warnings,
            buildLogPath: buildResult.buildLogPath,
          });
        }
        setPackageBuildResult(buildResult);
        setPackageResultDialog(createPackageBuildResultDialogModel({
          result: buildResult,
          targetPlatform: runTargetPlatform,
          outputDir: runOutputDir,
        }));
        appendConsole(buildResult.status === "PASS" ? "success" : "error", "result", `${targetLabels[targetPlatform]} 构建结果：${packageStatusLabel(buildResult.status)}`);
        if (buildResult.buildLogPath) appendConsole("info", "result", `构建日志：${buildResult.buildLogPath}`);
        if (buildResult.manifestPath) appendConsole("info", "result", `构建清单：${buildResult.manifestPath}`);
        if (buildResult.verifyReportPath) appendConsole("info", "result", `vncart 校验报告：${buildResult.verifyReportPath}`);
        for (const artifact of buildResult.artifacts) appendConsole("success", "artifact", `${artifact.kind}: ${artifact.path}`);
        for (const warning of buildResult.warnings) appendConsole("warning", "result", warning);
        for (const warning of preflight.warnings) appendConsole("warning", "preflight", warning.message);
        return;
      }

      updateExportProgress(
        mode === "cartridge" ? "打包 vncart" : "打包固定容器工程",
        mode === "cartridge"
          ? `正在压缩 ${scan.manifestAssets.length} 个资源并写入 .vncart。`
          : `正在生成 ${targetLabels[targetPlatform]} 固定卡带容器工程。`,
      );
      const result = await exportPackagingArtifact(mode, exportInput);
      appendConsole("success", mode === "cartridge" ? "vncart" : "project", `${result.fileName} 已生成。`);
      appendConsole("info", "assets", `缺失资源 ${result.assetReport.missingAssets.length} 项，占位资源 ${result.assetReport.placeholderAssets.length} 项。`);
      for (const warning of result.warnings) appendConsole("warning", "export", warning);

      updateExportProgress("准备下载", `已生成 ${result.fileName}，正在交给浏览器下载。`);
      downloadPackagingArtifact(mode, result);
      appendConsole("success", "download", "已交给浏览器下载。");
      appendConsole(
        "success",
        "result",
        mode === "cartridge"
          ? "导出成功：游戏卡带已下载。"
          : `导出成功：${targetLabels[targetPlatform]} GameCLI 固定卡带容器工程已下载。`,
      );
      for (const warning of preflight.warnings) appendConsole("warning", "preflight", warning.message);
    } catch (error) {
      reportFrontendError("editor.packaging", error, {
        operation: mode === "cartridge" ? "export-cartridge" : "export-runtime-package",
        targetPlatform,
      });
      appendConsole("error", "export", error instanceof Error ? error.message : "导出失败");
      packageSession.completeTask({
        status: "failed",
        runId,
        error: error instanceof Error ? error.message : "导出失败",
      });
      if (runMode === "standalone_package") {
        setPackageResultDialog(createPackageBuildExceptionDialogModel(runTargetPlatform, error));
      }
    } finally {
      setExportProgress(undefined);
      if (packageSession.getState().task?.runId === runId
        && packageSession.getState().task?.status === "running") {
        packageSession.completeTask({ status: "completed", runId });
      }
    }
  }

  const PackageResultIcon = packageResultDialog?.tone === "success"
    ? PackageCheck
    : packageResultDialog?.tone === "warning"
      ? AlertTriangle
      : CircleX;
  const PreflightDetailIcon = preflightDetailCheck
    ? preflightStatusIcons[preflightDetailCheck.status]
    : ShieldCheck;
  const preflightDetailTone = preflightDetailCheck?.status === "pass"
    ? "success"
    : preflightDetailCheck?.status === "warning"
      ? "warning"
      : "error";
  const preflightDetailItems = preflightDetailCheck?.issues.length
    ? preflightDetailCheck.issues.flatMap((issue, index) => [
      { label: `问题 ${index + 1}`, value: issue.message },
      { label: `解决方案：${index + 1}`, value: issue.solution },
    ])
    : [{ label: "检查结果", value: "未发现需要处理的问题。" }];
  const environmentDialogStages = environmentOperationDialog
    ? environmentOperationDialog.operation === "check"
      ? [
        ["准备检测", "连接本机环境检测服务"],
        ["检查当前环境", `检查 ${targetLabels[environmentOperationDialog.platform]} 所需的构建依赖`],
        ["汇总检测结果", "显示本次真实检测结果"],
      ]
      : environmentOperationDialog.operation === "import"
        ? [
          ["检查依赖包", "读取 .avnenv 格式、完整性清单和磁盘空间"],
          ["清理旧环境", "仅清理 AgentVN 管理的 Android 依赖"],
          ["安装新依赖", "直接流式写入最终工具链目录"],
          ["验证环境", "校验工具版本与构建能力；安装 MSVC 时会请求管理员权限"],
          ["完成", "后续构建直接复用本次安装环境"],
        ]
        : environmentOperationDialog.platform === "windows"
          ? [
            ["检查当前环境", "检查 Node.js、Rust、MSVC 与 Windows SDK"],
            ["补齐缺失依赖", "使用本机工具链或 winget 安装所需组件"],
            ["复检构建环境", "再次验证 Windows 软件包构建能力"],
            ["完成", "后续构建直接复用本次通过结果"],
          ]
          : [
            ["检查当前环境", "检查磁盘空间和 Android 构建前置条件"],
            ["清理旧环境", "仅清理 AgentVN 管理的 Android 依赖"],
            ["安装构建依赖", "使用国内镜像并保留官方回退"],
            ["验证环境", "校验工具版本、文件完整性与构建能力"],
            ["完成", "后续构建直接复用本次安装环境"],
          ]
    : [];
  const environmentDialogPhaseIndex = environmentOperationDialog
    ? (() => {
      const phase = environmentOperationDialog.phase;
      if (environmentOperationDialog.operation === "check") {
        if (phase === "completed") return 2;
        return ["checking", "validating", "verifying"].includes(phase) ? 1 : 0;
      }
      if (environmentOperationDialog.operation === "import" || environmentOperationDialog.platform === "android") {
        if (phase === "completed") return 4;
        if (phase === "verifying") return 3;
        if (["installing", "extracting", "validated", "deploying"].includes(phase)) return 2;
        if (phase === "cleaning") return 1;
        return 0;
      }
      if (phase === "completed") return 3;
      if (phase === "verifying") return 2;
      if (["installing", "cleaning"].includes(phase)) return 1;
      return 0;
    })()
    : -1;
  const environmentDialogSuccess = environmentOperationDialog?.phase === "completed";
  const environmentDialogFailed = environmentOperationDialog?.phase === "failed";
  const EnvironmentOperationIcon = environmentDialogSuccess
    ? CircleCheck
    : environmentDialogFailed
      ? CircleX
      : environmentOperationDialog?.operation === "check"
        ? RefreshCw
        : environmentOperationDialog?.operation === "install"
          ? Wrench
          : FileArchive;

  return (
    <section className="cartridge-export-panel package-workbench">
      <header className="package-workbench-header">
        <div className="package-workbench-title">
          <PackageCheck size={18} />
          <div>
            <strong>发布与打包</strong>
            <span>{modeLabels[mode]}{mode === "standalone_package" ? ` · ${targetLabels[targetPlatform]}` : ""}</span>
          </div>
        </div>
        <button className="package-panel-close" type="button" data-help-key="package.close" aria-label="关闭发布与打包" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="package-workbench-body">
        <nav className="package-stage-navigation" aria-label="发布工作台阶段">
          <header>
            <strong>发布流程</strong>
            <span>一次专注一项任务</span>
          </header>
          <div className="package-stage-navigation-list">
            {workspaceStages.map((stage) => {
              const StageIcon = stage.icon;
              return (
                <button data-help-key="editor.control"
                  className={`package-stage-navigation-item is-${stage.tone}${workspaceStage === stage.id ? " is-active" : ""}`}
                  type="button"
                  key={stage.id}
                  aria-current={workspaceStage === stage.id ? "page" : undefined}
                  data-package-stage={stage.id}
                  onClick={() => setWorkspaceStage(stage.id)}
                >
                  <span className="package-stage-navigation-icon"><StageIcon size={17} /></span>
                  <span className="package-stage-navigation-copy">
                    <strong>{stage.label}</strong>
                    <small>{stage.description}</small>
                  </span>
                  <span className="package-stage-navigation-status">{stage.status}</span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <footer className={`package-stage-overview is-${preflight.status}`}>
            <span>当前状态</span>
            <strong>{preflightStatusLabels[preflight.status]}</strong>
            <small>{preflight.blockers.length > 0 ? "修复阻断项后才能构建" : preflight.warnings.length > 0 ? "确认警告后即可继续" : "发布内容已准备就绪"}</small>
          </footer>
        </nav>

        <main ref={stageViewportRef} className="package-stage-viewport" data-active-stage={workspaceStage}>
          {workspaceStage === "settings" && (
            <section className="package-stage package-settings-stage" aria-labelledby="package-settings-title">
              <header className="package-stage-header">
                <div>
                  <span>01</span>
                  <div>
                    <h2 id="package-settings-title">发布设置</h2>
                    <p>确定产物、构建平台和作品信息。</p>
                  </div>
                </div>
                <strong>{mode === "standalone_package" ? `${targetLabels[targetPlatform]} 软件包` : "游戏卡带"}</strong>
              </header>

              <fieldset className="package-section package-publish-section" disabled={isExporting}>
                <div className="package-target-strip">
                  <label className="package-target-field">
                    <span>发布形式</span>
                    <RichSelect value={mode} options={packageModeOptions} helpKey="package.mode" variant="hero" onChange={setMode} />
                  </label>
                  {mode === "standalone_package" && (
                    <label className="package-target-field">
                      <span>目标平台</span>
                      <RichSelect value={targetPlatform} options={targetOptions} helpKey="package.platform" variant="hero" onChange={setTargetPlatform} />
                    </label>
                  )}
                  {mode === "standalone_package" && (
                    <div className="package-target-field package-output-field">
                      <span>软件包导出目录</span>
                      <div>
                        <input value={packageOutputDir} readOnly placeholder="请选择 .exe/.msi/.apk 输出目录" data-help-key="package.outputDir" />
                        <button className="package-action-button is-secondary" type="button" data-help-key="package.chooseOutputDir" onClick={() => void choosePackageOutputDir()} disabled={isExporting}>
                          <FolderOpen size={16} /> 选择目录
                        </button>
                      </div>
                      {!isDesktopRuntime && <small className="inline-error">请使用 AgentVN 桌面版导出安装包。</small>}
                      {isDesktopRuntime && !packageOutputDir.trim() && <small className="inline-note">构建前需要选择输出目录。</small>}
                    </div>
                  )}
                  {mode === "standalone_package" && (
                    <label className="package-target-field">
                      <span>发行资源优化</span>
                      <RichSelect
                        value={releaseOptimizationProfile}
                        options={releaseOptimizationOptions}
                        helpKey="package.releaseOptimization"
                        onChange={setReleaseOptimizationProfile}
                      />
                    </label>
                  )}
                </div>

                {mode === "standalone_package" && targetPlatform === "windows" && (
                  <section className={`android-env-panel windows-env-panel package-environment-card is-${windowsEnvVerification.state}`} aria-live="polite" data-environment-verification={windowsEnvVerification.state}>
                    <div className="package-environment-copy">
                      <header>
                        <div>
                          <strong>Windows 构建环境</strong>
                          <span>{windowsEnvVerification.label}</span>
                        </div>
                        <p>首次构建会自动检测依赖，缺失项可直接补齐。</p>
                      </header>
                      {windowsEnvResult?.missing?.length ? (
                        <ul>
                          {windowsEnvResult.missing.slice(0, 6).map((item) => <li key={item}>{item}</li>)}
                          {windowsEnvResult.missing.length > 6 && <li>还有 {windowsEnvResult.missing.length - 6} 项缺失</li>}
                        </ul>
                      ) : windowsEnvVerification.state === "passed" ? (
                        <small className="inline-note">{windowsEnvVerification.detail}</small>
                      ) : (
                        <small className={windowsEnvVerification.state === "failed" ? "inline-error" : "inline-note"}>{windowsEnvVerification.detail}</small>
                      )}
                      {(windowsEnvResult?.reportPath || windowsEnvResult?.logPath) && (
                        <details className="package-environment-details">
                          <summary>检测详情</summary>
                          {windowsEnvResult?.reportPath && <small>报告：{windowsEnvResult.reportPath}</small>}
                          {windowsEnvResult?.logPath && <small>日志：{windowsEnvResult.logPath}</small>}
                        </details>
                      )}
                    </div>
                    <div className="android-env-actions windows-env-actions">
                      <button className="package-action-button is-primary" type="button" data-help-key="package.windowsEnvInstall" onClick={() => void runWindowsEnvironmentCheck(true)} disabled={isExporting || Boolean(windowsEnvBusy) || !isDesktopRuntime}>
                        {windowsEnvBusy === "install" ? <RoseTwoLoader className="inline-spinner" particleCount={36} /> : <Wrench size={15} />}
                        一键补齐环境
                      </button>
                      <button className="package-action-button is-secondary" type="button" data-help-key="package.windowsEnvCheck" onClick={() => void runWindowsEnvironmentCheck(false)} disabled={isExporting || Boolean(windowsEnvBusy) || !isDesktopRuntime}>
                        {windowsEnvBusy === "check" ? <RoseTwoLoader className="inline-spinner" particleCount={36} /> : <RefreshCw size={15} />}
                        重新检测
                      </button>
                    </div>
                  </section>
                )}

                {mode === "standalone_package" && targetPlatform === "android" && (
                  <section className={`android-env-panel package-environment-card is-${androidEnvVerification.state}`} aria-live="polite" data-environment-verification={androidEnvVerification.state}>
                    <div className="package-environment-copy">
                      <header>
                        <div>
                          <strong>Android 构建环境</strong>
                          <span>{androidEnvVerification.label}</span>
                        </div>
                        <p>一键补齐会优先调用国内镜像；也可以导入已下载的离线依赖包。</p>
                      </header>
                      {androidEnvResult?.missing?.length ? (
                        <ul>
                          {androidEnvResult.missing.slice(0, 6).map((item) => <li key={item}>{item}</li>)}
                          {androidEnvResult.missing.length > 6 && <li>还有 {androidEnvResult.missing.length - 6} 项缺失</li>}
                        </ul>
                      ) : androidEnvVerification.state === "passed" ? (
                        <small className="inline-note">{androidEnvVerification.detail}</small>
                      ) : (
                        <small className={androidEnvVerification.state === "failed" ? "inline-error" : "inline-note"}>{androidEnvVerification.detail}</small>
                      )}
                      {(androidEnvResult?.reportPath || androidEnvResult?.logPath) && (
                        <details className="package-environment-details">
                          <summary>检测详情</summary>
                          {androidEnvResult?.reportPath && <small>报告：{androidEnvResult.reportPath}</small>}
                          {androidEnvResult?.logPath && <small>日志：{androidEnvResult.logPath}</small>}
                        </details>
                      )}
                    </div>
                    <div className="android-env-actions">
                      <button className="package-action-button is-primary" type="button" data-help-key="package.androidEnvInstall" onClick={() => void runAndroidEnvironmentCheck(true)} disabled={isExporting || Boolean(androidEnvBusy) || !isDesktopRuntime}>
                        {androidEnvBusy === "install" ? <RoseTwoLoader className="inline-spinner" particleCount={36} /> : <Wrench size={15} />}
                        一键补齐环境
                      </button>
                      <button className="package-action-button is-secondary" type="button" data-help-key="package.androidEnvCheck" onClick={() => void runAndroidEnvironmentCheck(false)} disabled={isExporting || Boolean(androidEnvBusy) || !isDesktopRuntime}>
                        {androidEnvBusy === "check" ? <RoseTwoLoader className="inline-spinner" particleCount={36} /> : <RefreshCw size={15} />}
                        重新检测
                      </button>
                      <button className="package-action-button is-tertiary" type="button" data-help-key="package.androidEnvImport" onClick={() => void runAndroidEnvironmentImport()} disabled={isExporting || Boolean(androidEnvBusy) || !isDesktopRuntime}>
                        {androidEnvBusy === "import" ? <RoseTwoLoader className="inline-spinner" particleCount={36} /> : <FileArchive size={15} />}
                        导入构建依赖
                      </button>
                    </div>
                  </section>
                )}

                <section className="package-metadata-panel">
                  <header>
                    <div>
                      <strong>作品信息</strong>
                      <span>写入发布产物和玩家端信息页</span>
                    </div>
                  </header>
                  <div className="package-metadata-grid">
                    <label>游戏编号<input value={gameId} onChange={(event) => setGameId(event.target.value)} title="游戏编号" data-help-key="package.gameId" /></label>
                    <label>游戏标题<input value={title} onChange={(event) => setTitle(event.target.value)} title="游戏标题" data-help-key="package.title" /></label>
                    <label>作者<input value={author} onChange={(event) => setAuthor(event.target.value)} title="作者" data-help-key="package.author" /></label>
                    <label>版本号<input value={version} onChange={(event) => setVersion(event.target.value)} title="游戏版本" data-help-key="package.version" /></label>
                    {targetPlatform === "android" && mode === "standalone_package" && (
                      <label>
                        Android 包名
                        <input
                          value={androidApplicationId}
                          onChange={(event) => setAndroidApplicationId(event.target.value)}
                          placeholder={`com.agentvn.game.${normalizeGameId(gameId).toLowerCase() || "game"}`}
                          title="Android 应用包名"
                          data-help-key="package.androidApplicationId"
                        />
                      </label>
                    )}
                    <label>语言<input value={language} onChange={(event) => setLanguage(event.target.value)} title="游戏语言" data-help-key="package.language" /></label>
                    <label className="package-description-field">
                      游戏简介
                      <textarea value={description} onChange={(event) => setDescription(event.target.value)} title="游戏简介" data-help-key="package.description" />
                    </label>
                  </div>
                  <div className="package-option-row">
                    <label className="check-row"><input type="checkbox" checked={includeGallery} data-help-key="package.includeGallery" onChange={(event) => setIncludeGallery(event.target.checked)} /> 包含画廊</label>
                    <label className="check-row"><input type="checkbox" checked={includeMetadata} data-help-key="package.includeMetadata" onChange={(event) => setIncludeMetadata(event.target.checked)} /> 包含制作信息</label>
                  </div>
                </section>
              </fieldset>
            </section>
          )}

          {workspaceStage === "assets" && (
            <section className="package-stage package-assets-stage" aria-labelledby="package-assets-title">
              <header className="package-stage-header">
                <div>
                  <span>02</span>
                  <div>
                    <h2 id="package-assets-title">视觉资源</h2>
                    <p>集中设置玩家端视觉，并处理缺失素材。</p>
                  </div>
                </div>
                <strong>{assetAudit.pending.length > 0 ? `${assetAudit.pending.length} 项待处理` : "资源完整"}</strong>
              </header>

              <div className="package-assets-workspace">
                <RuntimeVisualAssetsPanel
                  appearance={packageAppearance}
                  onChange={updatePackageAppearance}
                  helpPrefix="package.runtimeVisual"
                />
                <section className="package-section package-assets-section package-asset-audit" aria-label="发布前素材检查">
                  <header>
                    <div>
                      <strong>素材完整性</strong>
                      <span>{assetAudit.pending.length > 0 ? `${assetAudit.pending.length} 项需要处理` : "没有发现缺失资源"}</span>
                    </div>
                  </header>
                  <div className="cartridge-scan">
                    <span><strong>{scan.references.length}</strong> 已使用</span>
                    <span><strong>{scan.manifestAssets.length}</strong> 已收录</span>
                    <span><strong>{preflight.checks.find((item) => item.id === "asset_references")?.issues.length ?? scan.missingAssets.length}</strong> 缺失引用</span>
                  </div>
                  <dl className="package-asset-audit-summary">
                    <div><dt>缺背景场景</dt><dd>{assetAudit.missing_background_scenes.length}</dd></div>
                    <div><dt>缺立绘角色</dt><dd>{assetAudit.missing_sprite_characters.length}</dd></div>
                    <div><dt>缺头像角色</dt><dd>{assetAudit.missing_portrait_characters.length}</dd></div>
                    <div><dt>音频/演出可选项</dt><dd>{assetAudit.optional_audio_performance.length}</dd></div>
                  </dl>
                  {assetAudit.pending.length > 0 ? (
                    <div className="asset-preflight-list">
                      {assetAudit.pending.slice(0, 10).map((item) => (
                        <button type="button" key={item.id} data-help-key="package.assetPreflightItem" onClick={() => locateNode(item.node_id)} disabled={!item.node_id}>
                          <span>{item.optional ? "可选" : item.placeholder ? "占位" : "缺失"}</span>
                          <strong>{item.scene_title}</strong>
                          <small>{item.label}</small>
                          <ChevronRight size={15} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="inline-status">视觉资源已满足发布要求。</p>
                  )}
                </section>
              </div>
            </section>
          )}

          {workspaceStage === "checks" && (
            <section className="package-stage package-checks-stage" aria-labelledby="package-checks-title">
              <header className="package-stage-header">
                <div>
                  <span>03</span>
                  <div>
                    <h2 id="package-checks-title">发布检查</h2>
                    <p>检查详情按需打开，主页面只保留结论。</p>
                  </div>
                </div>
                <strong className={`is-${preflight.status}`}>{preflightStatusLabels[preflight.status]}</strong>
              </header>

              <section className={`package-section preflight-panel is-${preflight.status}`} aria-live="polite">
                <div className="preflight-overview">
                  <div>
                    <span>总体状态</span>
                    <strong>{preflightStatusLabels[preflight.status]}</strong>
                  </div>
                  <div><span>通过</span><strong>{passedCheckCount}</strong></div>
                  <div><span>警告</span><strong>{preflight.warnings.length}</strong></div>
                  <div><span>阻断</span><strong>{preflight.blockers.length}</strong></div>
                </div>
                <div className="preflight-summary">
                  {preflight.groups.map((group) => (
                    <span className={`is-${group.status}`} key={group.category}>
                      {group.title} {group.passed}/{group.total}
                    </span>
                  ))}
                </div>
                <div className="preflight-checks">
                  {preflight.checks.map((item) => (
                    <PreflightCheckRow key={item.id} check={item} onOpen={openPreflightDetail} />
                  ))}
                </div>
                {preflight.blockers.length > 0 && (
                  <p className="package-check-callout is-blocked">
                    <CircleX size={16} />
                    存在 {preflight.blockers.length} 个阻断项，修复后才能构建。
                  </p>
                )}
                {preflight.blockers.length === 0 && preflight.warnings.length > 0 && (
                  <label className="check-row preflight-confirm">
                    <input type="checkbox" data-help-key="package.confirmWarnings" checked={warningsConfirmed} disabled={isExporting} onChange={(event) => setWarningsConfirmed(event.target.checked)} />
                    我已检查全部警告，本次继续导出
                  </label>
                )}
              </section>
            </section>
          )}
        </main>
      </div>

      <section className={`package-build-dock${consoleOpen ? " is-open" : " is-collapsed"}`}
        data-novel-task-avoid aria-label="构建控制台与发布操作">
        <section className="package-section package-log-console" aria-label="发布与打包日志控制台">
          <header>
            <div>
              <strong><Terminal size={16} /> 构建控制台</strong>
              <span>{isExporting ? "实时输出" : consoleEntries.length > 0 ? `${consoleEntries.length} 条日志` : "待命"}</span>
            </div>
            <div className="package-console-actions">
              <button className="package-console-clear" type="button" data-help-key="package.console.clear" onClick={() => setConsoleEntries([])} disabled={consoleEntries.length === 0} aria-label="清空导出控制台">
                <Trash2 size={14} /> 清空
              </button>
              <button data-help-key="editor.control" className="package-console-toggle" type="button" onClick={() => setConsoleOpen((open) => !open)} aria-expanded={consoleOpen} aria-controls="package-log-console-body">
                {consoleOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                {consoleOpen ? "收起" : "展开"}
              </button>
            </div>
          </header>
          {consoleOpen && (
            <div id="package-log-console-body" className="package-log-console-body" role="log" aria-live="polite" aria-relevant="additions text">
              {consoleEntries.length === 0 ? (
                <p className="package-log-empty">暂无构建日志。环境检测、预检和构建输出会统一显示在这里。</p>
              ) : (
                consoleEntries.map((entry) => (
                  <div className={`package-log-line is-${entry.level}`} key={entry.id}>
                    <time>{formatConsoleTime(entry.time)}</time>
                    <span>{entry.source}</span>
                    <code>{entry.message}</code>
                  </div>
                ))
              )}
              <div ref={consoleEndRef} />
            </div>
          )}
        </section>

        <aside className="package-build-action">
          <div className="package-build-action-status">
            <span>{isExporting ? "正在构建" : "发布状态"}</span>
            <strong>{buildDockStatusLabel}</strong>
            <small>{exportActionHint}</small>
          </div>
          {exportProgress && (
            <div className="package-build-progress" role="status" aria-live="polite">
              <div>
                <span>{exportProgress.stage}</span>
                <small>已运行 {formatDuration(Date.now() - exportProgress.startedAt)}</small>
              </div>
              <progress value={exportProgress.percent} max={100} aria-label="打包发布进度" />
            </div>
          )}
          {packageBuildResult && !isExporting && (
            <div className={`package-build-result-summary is-${packageBuildResult.status.toLowerCase()}`}>
              <strong>{packageStatusLabel(packageBuildResult.status)}</strong>
              <span>{packageBuildResult.message}</span>
              {packageBuildResult.artifacts.length > 0 && <small>{packageBuildResult.artifacts.length} 个发布产物</small>}
            </div>
          )}
          <div className="package-build-secondary-actions">
            {activeEnvBlocked && (
              <button data-help-key="editor.control" type="button" onClick={() => setWorkspaceStage("settings")}>
                <Wrench size={15} /> 查看构建环境
              </button>
            )}
            {preflight.blockers.length > 0 && (
              <button data-help-key="editor.control" type="button" onClick={() => setWorkspaceStage("checks")}>
                <CircleX size={15} /> 查看阻断项
              </button>
            )}
            {preflight.blockers.length === 0 && preflight.warnings.length > 0 && !warningsConfirmed && (
              <button data-help-key="editor.control" type="button" onClick={() => setWorkspaceStage("checks")}>
                <AlertTriangle size={15} /> 查看并确认警告
              </button>
            )}
            {needsPackageOutputDir && !packageOutputDir.trim() && (
              <button data-help-key="editor.control" type="button" onClick={() => void choosePackageOutputDir()} disabled={isExporting}>
                <FolderOpen size={15} /> 选择输出目录
              </button>
            )}
            {packageBuildResult?.status !== "PASS" && packageBuildResult?.diagnosticsDir && (
              <>
                <button data-help-key="editor.control" type="button" onClick={() => void openPackageDiagnostics()}>
                  <FolderOpen size={15} /> 错误目录
                </button>
                <button data-help-key="editor.control" type="button" onClick={() => void exportPackageDiagnostics()}>
                  <FileArchive size={15} /> 导出诊断
                </button>
              </>
            )}
          </div>
          <button
            ref={exportButtonRef}
            className={`package-primary-action is-${preflight.status}`}
            type="button"
            data-help-key="package.export"
            data-environment-status={activeEnvVerification.state}
            disabled={exportDisabled}
            aria-busy={isExporting || undefined}
            onClick={runExport}
          >
            {isExporting ? <RoseTwoLoader className="inline-spinner" particleCount={36} /> : <PackageCheck size={20} />}
            <span className="package-cta-copy">
              <strong className="package-cta-label" key={exportActionLabel}>{exportActionLabel}</strong>
              <small>{exportActionHint}</small>
            </span>
          </button>
        </aside>
      </section>
      {packageResultDialog && (
        <OperationResultDialog
          open
          tone={packageResultDialog.tone}
          label={packageResultDialog.label}
          title={packageResultDialog.title}
          message={packageResultDialog.message}
          icon={<PackageResultIcon size={20} />}
          details={packageResultDialog.details}
          contextAction={packageResultDialog.action ? {
            label: packageResultDialog.action.label,
            icon: <FolderOpen size={16} />,
            onClick: openPackageResultContextAction,
          } : undefined}
          testId="package-build-result-dialog"
          closeAriaLabel="关闭软件构建结果"
          returnFocusRef={exportButtonRef}
          onDismiss={() => setPackageResultDialog(undefined)}
        />
      )}
      {preflightDetailCheck && (
        <OperationResultDialog
          open
          tone={preflightDetailTone}
          label="发布前检查"
          title={preflightDetailCheck.title}
          message={preflightDetailCheck.issues.length > 0
            ? `发现 ${preflightDetailCheck.issues.length} 项诊断，请按建议处理后重新检查。`
            : "该检查项已通过。"}
          icon={<PreflightDetailIcon size={20} />}
          details={preflightDetailItems}
          confirmLabel="返回检查"
          testId="package-preflight-detail-dialog"
          closeAriaLabel="关闭发布前诊断"
          returnFocusRef={preflightDetailTriggerRef}
          onDismiss={() => setPreflightDetailCheck(undefined)}
        />
      )}
      {environmentOperationDialog && (
        <div
          className="android-env-import-backdrop"
          role="presentation"
          onMouseDown={(event) => event.preventDefault()}
        >
          <section
            className={`android-env-import-dialog is-${environmentOperationDialog.phase}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="package-environment-operation-title"
            aria-describedby="package-environment-operation-description"
            data-testid="package-environment-operation-dialog"
            data-environment-platform={environmentOperationDialog.platform}
            data-environment-operation={environmentOperationDialog.operation}
            data-environment-phase={environmentOperationDialog.phase}
            data-environment-run-id={packageSessionState.environmentTasks[environmentOperationDialog.platform]?.runId}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !environmentDialogSuccess && !environmentDialogFailed) event.preventDefault();
            }}
          >
            <header>
              <div className="android-env-import-dialog-icon" aria-hidden="true">
                <EnvironmentOperationIcon size={27} />
              </div>
              <div>
                <span>{targetLabels[environmentOperationDialog.platform]} 构建环境</span>
                <h2 id="package-environment-operation-title">
                  {environmentDialogSuccess
                    ? environmentOperationDialog.operation === "check"
                      ? "环境检测已完成"
                      : environmentOperationDialog.operation === "import"
                        ? "构建依赖已导入"
                        : "构建环境已补齐"
                    : environmentDialogFailed
                      ? environmentOperationDialog.operation === "check"
                        ? "环境检测未通过"
                        : environmentOperationDialog.operation === "import"
                          ? "构建依赖导入未完成"
                          : "构建环境补齐未完成"
                      : environmentOperationDialog.operation === "check"
                        ? "正在检测构建环境"
                        : environmentOperationDialog.operation === "import"
                          ? "正在导入构建依赖"
                          : "正在一键补齐构建环境"}
                </h2>
              </div>
              <strong>{Math.round(environmentOperationDialog.percent)}%</strong>
            </header>

            <div
              className="android-env-import-body"
              data-environment-operation-phase={environmentOperationDialog.phase}
            >
              <div className="android-env-import-progress" aria-live="polite">
                <div className="android-env-import-track">
                  <span style={{ width: `${environmentOperationDialog.percent}%` }} />
                </div>
                <div className="android-env-import-progress-copy">
                  <strong>{environmentOperationDialog.message}</strong>
                  <span id="package-environment-operation-description">
                    {environmentOperationDialog.phase === "completed"
                      ? "操作已完成，可以继续发布。"
                      : environmentOperationDialog.phase === "failed"
                        ? "操作未通过，请查看检测结果与日志。"
                      : environmentOperationDialog.totalFiles > 0
                      ? `${environmentOperationDialog.processedFiles.toLocaleString()} / ${environmentOperationDialog.totalFiles.toLocaleString()} 个文件 · ${formatImportBytes(environmentOperationDialog.processedBytes)} / ${formatImportBytes(environmentOperationDialog.totalBytes)}`
                      : environmentOperationDialog.phase === "selecting"
                        ? "正在等待选择依赖包…"
                        : environmentOperationDialog.operation === "check"
                          ? "正在读取本机工具链并生成本次检测结果…"
                          : environmentOperationDialog.installSource === "online"
                          ? "正在通过国内镜像下载并配置依赖…"
                          : environmentOperationDialog.operation === "install"
                            ? "正在安装、配置并复检本机构建工具链…"
                            : "正在准备依赖包…"}
                  </span>
                  {environmentOperationDialog.reclaimedBytes > 0 && (
                    <span>已清理旧环境并释放 {formatImportBytes(environmentOperationDialog.reclaimedBytes)}</span>
                  )}
                </div>
              </div>

              <ol className="android-env-import-stages" aria-label={`${targetLabels[environmentOperationDialog.platform]} 构建环境操作步骤`}>
                {environmentDialogStages.map(([title, detail], index) => {
                  const isComplete = environmentDialogSuccess || (!environmentDialogFailed && index < environmentDialogPhaseIndex);
                  const isActive = !environmentDialogSuccess && !environmentDialogFailed && index === environmentDialogPhaseIndex;
                  return (
                    <li key={title} className={`${isComplete ? "is-complete" : ""}${isActive ? " is-active" : ""}`}>
                      <span aria-hidden="true">{isComplete ? "✓" : index + 1}</span>
                      <div><strong>{title}</strong><small>{detail}</small></div>
                    </li>
                  );
                })}
              </ol>
              {environmentOperationDialog.detail && <p className={environmentDialogFailed ? "inline-error" : "inline-note"}>{environmentOperationDialog.detail}</p>}
            </div>

            <footer>
              <span>已用时 {formatDuration(Date.now() - environmentOperationDialog.startedAt)}</span>
              {environmentDialogSuccess ? (
                <button data-help-key="editor.control" type="button" autoFocus onClick={() => setEnvironmentOperationDialog(undefined)}>
                  完成
                </button>
              ) : environmentDialogFailed ? (
                <button data-help-key="editor.control" type="button" autoFocus onClick={() => setEnvironmentOperationDialog(undefined)}>
                  关闭
                </button>
              ) : (
                <button data-help-key="editor.control" type="button" disabled aria-disabled="true">
                  {environmentOperationDialog.operation === "check"
                    ? "正在检测…"
                    : environmentOperationDialog.operation === "install"
                      ? "正在补齐…"
                      : "正在导入…"}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
