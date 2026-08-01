import { useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { AlertTriangle, CircleCheck, CircleX, FolderOpen, PackageCheck, RefreshCw, ShieldCheck, Terminal, Trash2, Wrench } from "lucide-react";
import { useEditorStore } from "../store/editorStore";
import { useProjectStore } from "../store/projectStore";
import { applyProjectRuntimeSettingsToScript } from "../utils/exportScript";
import { RoseTwoLoader } from "../components/common/RoseTwoLoader";
import { collectProjectAssets } from "./collectProjectAssets";
import { downloadPackagingArtifact, exportPackagingArtifact, type PackageExportMode, type PackageTargetPlatform } from "../packaging/runtimePackage";
import {
  buildStandalonePackage,
  checkAndroidBuildEnvironment,
  checkWindowsBuildEnvironment,
  installAndroidBuildEnvironment,
  installWindowsBuildEnvironment,
  listenStandalonePackageLogs,
  selectStandalonePackageOutputDir,
  type AndroidEnvironmentResult,
  type PackageBuildLogEvent,
  type ReleaseOptimizationProfile,
  type StandalonePackageBuildResult,
  type WindowsEnvironmentResult,
} from "../packaging/standalonePackage";
import { exportEditorCartridge } from "./exportCartridge";
import type { RuntimeScript } from "../../../shared/cartridge/types";
import { manifestAssetsFromProjectAssets } from "../utils/projectAssets";
import { buildProjectAssetAudit } from "../utils/assetAudit";
import { normalizeGameId, runExportPreflight, type PreflightCheck, type PreflightStatus } from "./preflight";
import { RichSelect, type RichSelectOption } from "../components/common/RichSelect";
import { RuntimeVisualAssetsPanel } from "../components/advanced/RuntimeVisualAssetsPanel";
import type { AssetRef } from "../types/assets";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import {
  deriveActivePackageEnvironment,
  shouldPublishPackageEnvironmentMessages,
  visiblePackageEnvironmentManualFix,
} from "../packaging/packageEnvironmentState";

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

const packageScriptRows = [
  { label: "GameCLI 容器 Windows", command: "scripts/build-game-shell-windows.ps1" },
  { label: "独立 Windows 安装包", command: "scripts/build-runtime-standalone-windows.ps1 -OutputDir ..." },
  { label: "独立 Android APK", command: "scripts/build-runtime-standalone-android.ps1 -OutputDir ..." },
  { label: "Android 环境补齐", command: "scripts/setup-android-build-env.ps1 -Install" },
] as const;

interface ExportProgressState {
  stage: string;
  detail: string;
  percent: number;
  startedAt: number;
  updatedAt: number;
}

type PackageConsoleLevel = "info" | "success" | "warning" | "error" | string;

interface PackageConsoleEntry {
  id: string;
  time: number;
  level: PackageConsoleLevel;
  source: string;
  message: string;
}

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

type PackageAppearanceForIcon = {
  standaloneIconAssetId?: string;
  iconAssetId?: string;
  coverAssetId?: string;
};

function findStandaloneIconAsset(appearance: PackageAppearanceForIcon, assets: AssetRef[]): AssetRef | undefined {
  const assetId = appearance.standaloneIconAssetId || appearance.iconAssetId || appearance.coverAssetId;
  return assetId ? assets.find((asset) => asset.asset_id === assetId) : undefined;
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
  const dataUrl = asset.metadata.data_url;
  const blobUrl = asset.metadata.blob_url;
  const assetUrl = asset.metadata.url;
  const filename = asset.metadata.filename ?? `${asset.asset_id}.png`;
  const sourceBlob = dataUrl
    ? await (await fetch(dataUrl)).blob()
    : blobUrl?.startsWith("blob:")
      ? await (await fetch(blobUrl)).blob()
      : assetUrl
        ? await (await fetch(assetUrl)).blob()
        : undefined;
  if (!sourceBlob) {
    throw new Error(`软件包图标素材 ${asset.asset_id} 没有可读取的图片数据。`);
  }

  if (/\.ico$/i.test(filename) || /icon|ico/i.test(sourceBlob.type)) {
    return { blob: sourceBlob, fileName: filename.replace(/[\\/:*?"<>|]+/g, "_") || `${asset.asset_id}.ico` };
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

function PreflightCheckRow({ check }: { check: PreflightCheck }) {
  const StatusIcon = preflightStatusIcons[check.status];
  const shouldShowEveryIssue = check.id === "asset_references";
  const visibleIssues = shouldShowEveryIssue ? check.issues : check.issues.slice(0, 5);
  return (
    <article className={`preflight-check is-${check.status}`}>
      <header>
        <span><StatusIcon size={15} /> {check.title}</span>
        <small>{preflightStatusLabels[check.status]}</small>
      </header>
      {check.issues.length > 0 && (
        <ul>
          {visibleIssues.map((issue, index) => (
            <li key={`${issue.code}_${issue.subject ?? ""}_${index}_${issue.message}`}>
              <div className="preflight-issue-message"><strong>问题：</strong>{issue.message}</div>
              <div className="preflight-issue-solution"><strong>解决方案：</strong>{issue.solution}</div>
            </li>
          ))}
          {!shouldShowEveryIssue && check.issues.length > 5 && <li>还有 {check.issues.length - 5} 项同类问题，请修复后重新检查。</li>}
        </ul>
      )}
    </article>
  );
}

export function ExportCartridgePanel({ onClose }: { onClose: () => void }) {
  const exportScript = useEditorStore((state) => state.exportScript);
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const selectNode = useEditorStore((state) => state.selectNode);
  const project = useProjectStore();
  const reactFlow = useReactFlow();
  const script = useMemo(() => applyProjectRuntimeSettingsToScript(exportScript() as RuntimeScript, project.settings), [exportScript, nodes, edges, project.settings]);
  const [mode, setMode] = useState<PackageExportMode>("standalone_package");
  const [targetPlatform, setTargetPlatform] = useState<PackageTargetPlatform>("windows");
  const [gameId, setGameId] = useState(() => normalizeGameId(script.game_id || project.projectId || "agentvn_game") || "agentvn_game");
  const [title, setTitle] = useState(project.title);
  const [author, setAuthor] = useState(project.author);
  const [version, setVersion] = useState("0.1.0");
  const [language, setLanguage] = useState("zh-CN");
  const [description, setDescription] = useState("由 AgentVN 导出的视觉小说发布内容。");
  const [includeGallery, setIncludeGallery] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [messages, setMessages] = useState<string[]>([]);
  const [warningsConfirmed, setWarningsConfirmed] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgressState>();
  const [consoleEntries, setConsoleEntries] = useState<PackageConsoleEntry[]>([]);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);
  const exportProgressStepRef = useRef(0);
  const [packageOutputDir, setPackageOutputDir] = useState("");
  const [releaseOptimizationProfile, setReleaseOptimizationProfile] = useState<ReleaseOptimizationProfile>("balanced");
  const [packageBuildResult, setPackageBuildResult] = useState<StandalonePackageBuildResult>();
  const [androidEnvResult, setAndroidEnvResult] = useState<AndroidEnvironmentResult>();
  const [androidEnvBusy, setAndroidEnvBusy] = useState<"check" | "install" | null>(null);
  const [windowsEnvResult, setWindowsEnvResult] = useState<WindowsEnvironmentResult>();
  const [windowsEnvBusy, setWindowsEnvBusy] = useState<"check" | "install" | null>(null);
  const activeTargetPlatformRef = useRef<PackageTargetPlatform>(targetPlatform);
  const activeModeRef = useRef<PackageExportMode>(mode);
  const environmentBusyRef = useRef<Record<PackageTargetPlatform, boolean>>({ android: false, windows: false });
  const environmentRequestSeqRef = useRef<Record<PackageTargetPlatform, number>>({ android: 0, windows: 0 });
  const environmentMessagesRef = useRef<Record<PackageTargetPlatform, string[]>>({ android: [], windows: [] });
  activeTargetPlatformRef.current = targetPlatform;
  activeModeRef.current = mode;
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
  const activeEnvResult = activeEnvironment.result;
  const activeEnvBlocked = activeEnvironment.blocked;
  const exportDisabled =
    isExporting ||
    Boolean(activeEnvBusy) ||
    preflight.blockers.length > 0 ||
    (preflight.warnings.length > 0 && !warningsConfirmed) ||
    (needsPackageOutputDir && (!packageOutputDir.trim() || !isDesktopRuntime));
  const packageModeOptions = useMemo<Array<RichSelectOption<PackageExportMode>>>(() => [
    {
      value: "standalone_package",
      label: "打包独立软件包",
      description: "生成可分发的独立玩家客户端",
    },
    {
      value: "cartridge",
      label: "游戏卡带 .vncart",
      description: "导出轻量卡带文件",
    },
    {
      value: "standalone_project",
      label: "固定容器工程 ZIP",
      description: "只导出 GameCLI 容器工程",
    },
  ], []);
  const exportActionLabel = isExporting
    ? "正在导出..."
    : activeEnvBusy
    ? `正在${activeEnvBusy === "install" ? "补齐" : "检测"} ${targetLabels[targetPlatform]} 环境...`
    : activeEnvBlocked
    ? `请先补齐 ${targetLabels[targetPlatform]} 环境`
    : preflight.blockers.length > 0
    ? "存在阻断项，禁止导出"
    : preflight.warnings.length > 0 && !warningsConfirmed
      ? "确认警告后导出"
    : mode === "cartridge"
      ? "打包与发布"
      : mode === "standalone_package"
        ? `构建 ${targetLabels[targetPlatform]} 独立软件包`
        : `导出${targetLabels[targetPlatform]}固定容器工程 ZIP`;
  useElapsedTicker(isExporting);

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

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ block: "end" });
  }, [consoleEntries]);

  function locateNode(nodeId?: string) {
    if (!nodeId) return;
    selectNode(nodeId);
    window.requestAnimationFrame(() => {
      void reactFlow.fitView({ nodes: [{ id: nodeId }], padding: 0.42, duration: 420 });
    });
  }

  useEffect(() => {
    setTitle(project.title);
  }, [project.title]);

  useEffect(() => {
    setAuthor(project.author);
  }, [project.author]);

  useEffect(() => {
    setWarningsConfirmed(false);
  }, [preflight.signature]);

  useEffect(() => {
    setPackageBuildResult(undefined);
  }, [mode, targetPlatform, packageOutputDir]);

  useEffect(() => {
    if (mode === "standalone_package") {
      setMessages(environmentMessagesRef.current[targetPlatform]);
    }
  }, [mode, targetPlatform]);

  useEffect(() => {
    if (mode === "standalone_package" && targetPlatform === "android" && isDesktopRuntime) {
      void runAndroidEnvironmentCheck(false);
    }
    if (mode === "standalone_package" && targetPlatform === "windows" && isDesktopRuntime) {
      void runWindowsEnvironmentCheck(false);
    }
  }, [mode, targetPlatform, isDesktopRuntime]);

  async function choosePackageOutputDir() {
    try {
      const selected = await selectStandalonePackageOutputDir();
      if (selected) {
        setPackageOutputDir(selected);
        appendConsole("info", "output", `已选择软件包导出目录：${selected}`);
        setMessages([`已选择软件包导出目录：${selected}`]);
      }
    } catch (error) {
      reportFrontendError("editor.packaging", error, { operation: "select-output-directory" });
      setMessages([error instanceof Error ? error.message : "选择软件包导出目录失败"]);
    }
  }

  function publishEnvironmentMessages(platform: PackageTargetPlatform, requestId: number, nextMessages: string[]) {
    environmentMessagesRef.current = {
      ...environmentMessagesRef.current,
      [platform]: nextMessages,
    };
    if (shouldPublishPackageEnvironmentMessages({
      mode: activeModeRef.current,
      activePlatform: activeTargetPlatformRef.current,
      resultPlatform: platform,
      requestId,
      latestRequestId: environmentRequestSeqRef.current[platform],
    })) {
      setMessages(nextMessages);
    }
  }

  async function runAndroidEnvironmentCheck(install: boolean) {
    if (environmentBusyRef.current.android) return;
    environmentBusyRef.current.android = true;
    const requestId = ++environmentRequestSeqRef.current.android;
    const runId = createPackageRunId();
    let unlistenEnvLogs: (() => void) | undefined;
    setAndroidEnvBusy(install ? "install" : "check");
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
      const result = install ? await installAndroidBuildEnvironment(runId) : await checkAndroidBuildEnvironment(runId);
      if (environmentRequestSeqRef.current.android !== requestId) return result;
      setAndroidEnvResult(result);
      const missing = result.missing?.length ? `缺失：${result.missing.join("、")}` : "环境已就绪";
      const action = install ? "Android 打包环境补齐" : "Android 打包环境检测";
      appendConsole(result.status === "PASS" ? "success" : "warning", "android-env", `${action}：${packageStatusLabel(result.status)}`);
      for (const item of result.missing ?? []) appendConsole("warning", "android-env", `缺失：${item}`);
      for (const item of result.warnings ?? []) appendConsole("warning", "android-env", item);
      if (result.reportPath) appendConsole("info", "android-env", `环境报告：${result.reportPath}`);
      if (result.logPath) appendConsole("info", "android-env", `环境日志：${result.logPath}`);
      publishEnvironmentMessages("android", requestId, [
        `${action}：${packageStatusLabel(result.status)}。${missing}`,
        result.reportPath ? `环境报告：${result.reportPath}` : "",
        result.logPath ? `环境日志：${result.logPath}` : "",
        result.commandLogPath ? `命令日志：${result.commandLogPath}` : "",
        ...visiblePackageEnvironmentManualFix(result),
        ...(result.warnings ?? []),
      ].filter(Boolean));
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
      if (environmentRequestSeqRef.current.android === requestId) setAndroidEnvResult(failureResult);
      appendConsole("error", "android-env", message);
      publishEnvironmentMessages("android", requestId, [`Android 打包环境${install ? "补齐" : "检测"}失败：${message}`]);
      return undefined;
    } finally {
      unlistenEnvLogs?.();
      if (environmentRequestSeqRef.current.android === requestId) {
        environmentBusyRef.current.android = false;
        setAndroidEnvBusy(null);
      }
    }
  }


  async function runWindowsEnvironmentCheck(install: boolean) {
    if (environmentBusyRef.current.windows) return;
    environmentBusyRef.current.windows = true;
    const requestId = ++environmentRequestSeqRef.current.windows;
    const runId = createPackageRunId();
    let unlistenEnvLogs: (() => void) | undefined;
    setWindowsEnvBusy(install ? "install" : "check");
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
      const result = install ? await installWindowsBuildEnvironment(runId) : await checkWindowsBuildEnvironment(runId);
      if (environmentRequestSeqRef.current.windows !== requestId) return result;
      setWindowsEnvResult(result);
      const missing = result.missing?.length ? "缺失：" + result.missing.join("、") : "环境已就绪";
      const action = install ? "Windows 打包环境补齐" : "Windows 打包环境检测";
      appendConsole(result.status === "PASS" ? "success" : "warning", "windows-env", action + "：" + packageStatusLabel(result.status));
      for (const item of result.missing ?? []) appendConsole("warning", "windows-env", "缺失：" + item);
      for (const item of result.warnings ?? []) appendConsole("warning", "windows-env", item);
      for (const item of result.actions ?? []) appendConsole("info", "windows-env", item);
      if (result.reportPath) appendConsole("info", "windows-env", "环境报告：" + result.reportPath);
      if (result.logPath) appendConsole("info", "windows-env", "环境日志：" + result.logPath);
      publishEnvironmentMessages("windows", requestId, [
        action + "：" + packageStatusLabel(result.status) + "。" + missing,
        result.message ? "检测详情：" + result.message : "",
        result.reportPath ? "环境报告：" + result.reportPath : "",
        result.logPath ? "环境日志：" + result.logPath : "",
        result.commandLogPath ? "命令日志：" + result.commandLogPath : "",
        ...visiblePackageEnvironmentManualFix(result),
        ...(result.warnings ?? []),
      ].filter(Boolean));
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
          "也可以在 AgentVN 工作区手动运行 scripts/setup-windows-build-env.ps1 -Json 检查环境。",
        ],
      };
      if (environmentRequestSeqRef.current.windows === requestId) setWindowsEnvResult(failureResult);
      appendConsole("error", "windows-env", message);
      publishEnvironmentMessages("windows", requestId, [`Windows 打包环境${install ? "补齐" : "检测"}失败：${message}`]);
      return undefined;
    } finally {
      unlistenEnvLogs?.();
      if (environmentRequestSeqRef.current.windows === requestId) {
        environmentBusyRef.current.windows = false;
        setWindowsEnvBusy(null);
      }
    }
  }

  async function runExport() {
    if (isExporting) return;
    const startedAt = Date.now();
    exportProgressStepRef.current = 0;
    const runId = createPackageRunId();
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
          setMessages(["Build cancelled before automatic environment repair."]);
          setExportProgress(undefined);
          return;
        }
        updateExportProgress("Repairing build environment", "Installing missing components and rechecking before continuing.");
        const repaired = targetPlatform === "android"
          ? await runAndroidEnvironmentCheck(true)
          : await runWindowsEnvironmentCheck(true);
        if (repaired?.status !== "PASS") {
          setMessages([repaired?.message ?? "Build environment repair failed; packaging did not continue."]);
          setExportProgress(undefined);
          return;
        }
      }
      updateExportProgress("校验剧本", "正在检查入口、连线、资源引用和发布元数据。");
      if (preflight.blockers.length > 0) {
        appendConsole("error", "preflight", `导出已阻断：${preflight.blockers.map((issue) => issue.message).join("；")}`);
        setMessages([`导出已阻断：${preflight.blockers.map((issue) => issue.message).join("；")}`]);
        setExportProgress(undefined);
        return;
      }
      if (preflight.warnings.length > 0 && !warningsConfirmed) {
        appendConsole("warning", "preflight", "存在发布前警告，等待用户确认后继续。");
        setMessages(["导出前仍有警告项。请确认这些警告不会影响本次发布，然后再继续导出。"]);
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
        packageAppearance: project.settings.packageAppearance,
        characterDialogStyles: project.settings.characterDialogStyles,
      };

      if (mode === "standalone_package") {
        if (!packageOutputDir.trim()) {
          appendConsole("error", "output", "请先选择软件包导出目录。");
          setMessages(["请先选择软件包导出目录。"]);
          setExportProgress(undefined);
          return;
        }
        updateExportProgress("打包 vncart", `正在压缩 ${scan.manifestAssets.length} 个资源并准备内嵌到 ${targetLabels[targetPlatform]} 软件包。`);
        const cartridge = await exportEditorCartridge(exportInput);
        appendConsole("success", "vncart", `${cartridge.fileName} 已生成，资源 ${cartridge.manifest.assets.length} 项。`);
        for (const warning of cartridge.warnings) appendConsole("warning", "vncart", warning);
        const standaloneIconWarnings: string[] = [];
        const standaloneIconAsset = findStandaloneIconAsset(packageAppearance, project.assetManifest);
        let standaloneIcon: { blob: Blob; fileName: string } | undefined;
        if (standaloneIconAsset) {
          try {
            standaloneIcon = await assetToStandaloneIconBlob(standaloneIconAsset);
            appendConsole("info", "icon", `单软件包图标：${standaloneIconAsset.asset_id}`);
          } catch (error) {
            reportFrontendError("editor.packaging", error, {
              operation: "read-standalone-icon",
              assetId: standaloneIconAsset.asset_id,
            });
            const message = error instanceof Error ? error.message : "单软件包图标读取失败，将继续使用默认 Player 图标。";
            standaloneIconWarnings.push(message);
            appendConsole("warning", "icon", message);
          }
        }
        updateExportProgress("传输卡带", `正在向桌面打包宿主传输 ${formatUploadMiB(cartridge.blob.size)} MiB 卡带数据。`);
        appendConsole("info", "upload", `开始分块传输 ${cartridge.fileName}（${formatUploadMiB(cartridge.blob.size)} MiB）。`);
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
            return await buildStandalonePackage({
              targetPlatform,
              outputDir: packageOutputDir.trim(),
              cartridge: cartridge.blob,
              fileName: cartridge.fileName,
              runId,
              optimizationProfile: releaseOptimizationProfile,
              standaloneIcon: standaloneIcon?.blob,
              standaloneIconFileName: standaloneIcon?.fileName,
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
        appendConsole(buildResult.status === "PASS" ? "success" : "error", "result", `${targetLabels[targetPlatform]} 构建结果：${packageStatusLabel(buildResult.status)}`);
        if (buildResult.buildLogPath) appendConsole("info", "result", `构建日志：${buildResult.buildLogPath}`);
        if (buildResult.manifestPath) appendConsole("info", "result", `构建清单：${buildResult.manifestPath}`);
        for (const artifact of buildResult.artifacts) appendConsole("success", "artifact", `${artifact.kind}: ${artifact.path}`);
        for (const warning of buildResult.warnings) appendConsole("warning", "result", warning);
        const artifactLines = buildResult.artifacts.map((artifact) => `${artifact.kind}: ${artifact.path}`);
        setMessages([
          buildResult.status === "PASS"
            ? `构建成功：${targetLabels[targetPlatform]} 独立软件包已输出到所选目录。`
            : buildResult.status === "BLOCKED"
              ? `构建被阻断：${buildResult.message}`
              : `构建失败：${buildResult.message}`,
          ...(buildResult.verifyReportPath ? [`vncart 校验报告：${buildResult.verifyReportPath}`] : []),
          ...(buildResult.buildLogPath ? [`构建日志：${buildResult.buildLogPath}`] : []),
          ...(buildResult.manifestPath ? [`构建清单：${buildResult.manifestPath}`] : []),
          ...artifactLines,
          ...buildResult.warnings,
          ...standaloneIconWarnings,
          ...preflight.warnings.map((issue) => issue.message),
          ...cartridge.warnings,
        ]);
        return;
      }

      updateExportProgress(
        mode === "cartridge" ? "打包 vncart" : "打包固定容器工程",
        mode === "cartridge"
          ? `正在压缩 ${scan.manifestAssets.length} 个资源并写入 .vncart。`
          : `正在生成 ${targetLabels[targetPlatform]} 固定卡带容器工程 ZIP。`,
      );
      const result = await exportPackagingArtifact(mode, exportInput);
      appendConsole("success", mode === "cartridge" ? "vncart" : "project", `${result.fileName} 已生成。`);
      appendConsole("info", "assets", `缺失资源 ${result.assetReport.missingAssets.length} 项，占位资源 ${result.assetReport.placeholderAssets.length} 项。`);
      for (const warning of result.warnings) appendConsole("warning", "export", warning);

      updateExportProgress("准备下载", `已生成 ${result.fileName}，正在交给浏览器下载。`);
      downloadPackagingArtifact(mode, result);
      appendConsole("success", "download", "已交给浏览器下载。");
      setMessages([
        mode === "cartridge"
          ? "导出成功：游戏卡带已下载。"
          : `导出成功：${targetLabels[targetPlatform]} GameCLI 固定卡带容器工程 ZIP 已下载。`,
        `导出报告：缺失资产 ${result.assetReport.missingAssets.length} 项，占位资产 ${result.assetReport.placeholderAssets.length} 项。`,
        ...preflight.warnings.map((issue) => issue.message),
        ...result.warnings,
      ]);
    } catch (error) {
      reportFrontendError("editor.packaging", error, {
        operation: mode === "cartridge" ? "export-cartridge" : "export-runtime-package",
        targetPlatform,
      });
      appendConsole("error", "export", error instanceof Error ? error.message : "导出失败");
      setMessages([error instanceof Error ? error.message : "导出失败"]);
    } finally {
      setExportProgress(undefined);
    }
  }

  return (
    <section className="cartridge-export-panel">
      <header>
        <strong><PackageCheck size={17} /> 发布与打包</strong>
        <button type="button" data-help-key="package.close" onClick={onClose}>关闭</button>
      </header>

      <div className="package-export-layout">
      <section className="package-section package-publish-section">
        <header>
          <div>
            <strong>发布设置</strong>
            <span>{mode === "standalone_package" ? `${modeLabels[mode]} · ${targetLabels[targetPlatform]}` : modeLabels[mode]}</span>
          </div>
        </header>
        <fieldset className="form-grid" disabled={isExporting}>
          <label>
            发布形式
            <RichSelect value={mode} options={packageModeOptions} helpKey="package.mode" variant="hero" onChange={setMode} />
          </label>
          <div className={`package-transition-slot package-platform-slot${mode !== "cartridge" ? " is-open" : ""}`}>
            <div className="package-transition-content">
              <label>
                目标平台
                <RichSelect value={targetPlatform} options={targetOptions} helpKey="package.platform" variant="hero" disabled={mode === "cartridge"} onChange={setTargetPlatform} />
              </label>
            </div>
          </div>
          <div className={`package-transition-slot package-output-slot${mode === "standalone_package" ? " is-open" : ""}`}>
            <div className="package-transition-content">
              <div className="package-output-row">
                <label>
                  软件包导出目录
                  <input value={packageOutputDir} readOnly placeholder="请选择 .exe/.msi/.apk 输出目录" data-help-key="package.outputDir" />
                </label>
                <button type="button" data-help-key="package.chooseOutputDir" onClick={() => void choosePackageOutputDir()} disabled={isExporting}>
                  <FolderOpen size={16} /> 选择目录
                </button>
                {!isDesktopRuntime && <small className="inline-error">浏览器开发模式不能调用本机打包工具链，请使用 AgentVN 桌面版构建软件包。</small>}
                {isDesktopRuntime && !packageOutputDir.trim() && <small className="inline-note">构建安装包前必须先选择输出目录。</small>}
              </div>
              <label>
                发行资源优化
                <RichSelect
                  value={releaseOptimizationProfile}
                  options={releaseOptimizationOptions}
                  helpKey="package.releaseOptimization"
                  onChange={setReleaseOptimizationProfile}
                />
              </label>
            </div>
          </div>
          <div className={`package-transition-slot package-windows-slot${mode === "standalone_package" && targetPlatform === "windows" ? " is-open" : ""}`}>
            <div className="package-transition-content">
              <section className={`android-env-panel windows-env-panel is-${windowsEnvResult?.status?.toLowerCase() ?? "idle"}`} aria-live="polite">
                <header>
                  <strong>Windows EXE 环境</strong>
                  <span>{windowsEnvBusy ? "处理中" : packageStatusLabel(windowsEnvResult?.status)}</span>
                </header>
                <p>
                  Windows 单 exe / 安装包构建需要 Node.js LTS、npm、Rust/rustup/cargo，以及 Visual Studio Build Tools / MSVC。缺失时可先检测，再手动点击一键补齐环境。
                </p>
                {windowsEnvResult?.missing?.length ? (
                  <ul>
                    {windowsEnvResult.missing.slice(0, 8).map((item) => <li key={item}>{item}</li>)}
                    {windowsEnvResult.missing.length > 8 && <li>还有 {windowsEnvResult.missing.length - 8} 项缺失</li>}
                  </ul>
                ) : windowsEnvResult?.status === "PASS" ? (
                  <small className="inline-note">Windows 打包环境已就绪。</small>
                ) : (
                  <small className="inline-note">选择 Windows 后会自动检测环境，也可以手动重新检测。</small>
                )}
                <div className="android-env-actions windows-env-actions">
                  <button type="button" data-help-key="package.windowsEnvCheck" onClick={() => void runWindowsEnvironmentCheck(false)} disabled={isExporting || Boolean(windowsEnvBusy) || !isDesktopRuntime}>
                    {windowsEnvBusy === "check" ? <RoseTwoLoader className="inline-spinner" particleCount={36} /> : <RefreshCw size={15} />}
                    检测环境
                  </button>
                  <button type="button" data-help-key="package.windowsEnvInstall" onClick={() => void runWindowsEnvironmentCheck(true)} disabled={isExporting || Boolean(windowsEnvBusy) || !isDesktopRuntime}>
                    {windowsEnvBusy === "install" ? <RoseTwoLoader className="inline-spinner" particleCount={36} /> : <Wrench size={15} />}
                    一键补齐环境
                  </button>
                </div>
                {windowsEnvResult?.reportPath && <small>报告：{windowsEnvResult.reportPath}</small>}
                {windowsEnvResult?.logPath && <small>日志：{windowsEnvResult.logPath}</small>}
              </section>
            </div>
          </div>

          <div className={`package-transition-slot package-android-slot${mode === "standalone_package" && targetPlatform === "android" ? " is-open" : ""}`}>
            <div className="package-transition-content">
              <section className={`android-env-panel is-${androidEnvResult?.status?.toLowerCase() ?? "idle"}`} aria-live="polite">
                <header>
                  <strong>Android APK 环境</strong>
                  <span>{androidEnvBusy ? "处理中" : packageStatusLabel(androidEnvResult?.status)}</span>
                </header>
                <p>
                  APK 构建需要 JDK、Android SDK、NDK 和 Rust Android targets。缺失时可先检测，再用一键补齐安装到用户目录。
                </p>
                {androidEnvResult?.missing?.length ? (
                  <ul>
                    {androidEnvResult.missing.slice(0, 8).map((item) => <li key={item}>{item}</li>)}
                    {androidEnvResult.missing.length > 8 && <li>还有 {androidEnvResult.missing.length - 8} 项缺失</li>}
                  </ul>
                ) : androidEnvResult?.status === "PASS" ? (
                  <small className="inline-note">Android 打包环境已就绪。</small>
                ) : (
                  <small className="inline-note">选择 Android 后会自动检测环境，也可以手动重新检测。</small>
                )}
                <div className="android-env-actions">
                  <button type="button" data-help-key="package.androidEnvCheck" onClick={() => void runAndroidEnvironmentCheck(false)} disabled={isExporting || Boolean(androidEnvBusy) || !isDesktopRuntime}>
                    {androidEnvBusy === "check" ? <RoseTwoLoader className="inline-spinner" particleCount={36} /> : <RefreshCw size={15} />}
                    检测环境
                  </button>
                  <button type="button" data-help-key="package.androidEnvInstall" onClick={() => void runAndroidEnvironmentCheck(true)} disabled={isExporting || Boolean(androidEnvBusy) || !isDesktopRuntime}>
                    {androidEnvBusy === "install" ? <RoseTwoLoader className="inline-spinner" particleCount={36} /> : <Wrench size={15} />}
                    一键补齐环境
                  </button>
                </div>
                {androidEnvResult?.reportPath && <small>报告：{androidEnvResult.reportPath}</small>}
                {androidEnvResult?.logPath && <small>日志：{androidEnvResult.logPath}</small>}
              </section>
            </div>
          </div>
          <label>游戏编号<input value={gameId} onChange={(event) => setGameId(event.target.value)} title="游戏编号" data-help-key="package.gameId" /></label>
          <label>游戏标题<input value={title} onChange={(event) => setTitle(event.target.value)} title="游戏标题" data-help-key="package.title" /></label>
          <label>作者<input value={author} onChange={(event) => setAuthor(event.target.value)} title="作者" data-help-key="package.author" /></label>
          <label>版本号<input value={version} onChange={(event) => setVersion(event.target.value)} title="游戏版本" data-help-key="package.version" /></label>
          <label>语言<input value={language} onChange={(event) => setLanguage(event.target.value)} title="游戏语言" data-help-key="package.language" /></label>
          <label>
            游戏简介
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} title="游戏简介" data-help-key="package.description" />
          </label>
          <label className="check-row"><input type="checkbox" checked={includeGallery} data-help-key="package.includeGallery" onChange={(event) => setIncludeGallery(event.target.checked)} /> 包含画廊清单</label>
          <label className="check-row"><input type="checkbox" checked={includeMetadata} data-help-key="package.includeMetadata" onChange={(event) => setIncludeMetadata(event.target.checked)} /> 包含发布信息</label>
        </fieldset>
      </section>

      <div className="package-middle-column">
      <RuntimeVisualAssetsPanel
        appearance={packageAppearance}
        onChange={updatePackageAppearance}
        compact
        helpPrefix="package.runtimeVisual"
      />
      <section className="package-section package-assets-section">
        <header>
          <div>
            <strong>资产与资源</strong>
            <span>{assetAudit.pending.length} 项待处理</span>
          </div>
        </header>
        <div className="cartridge-scan">
          <span>资源引用：{scan.references.length}</span>
          <span>清单资源：{scan.manifestAssets.length}</span>
          <span>缺失资源：{preflight.checks.find((item) => item.id === "asset_references")?.issues.length ?? scan.missingAssets.length}</span>
        </div>

      <section className="asset-preflight-panel" aria-label="发布前资产检查">
        <header>
          <strong>发布前资产检查</strong>
          <span>{assetAudit.pending.length} 项待处理</span>
        </header>
        <dl>
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
                <small>{item.label}{item.character_id ? ` · ${item.character_id}` : ""}{item.asset_id ? ` · ${item.asset_id}` : ""}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="inline-status">没有发现缺失视觉资产。</p>
        )}
      </section>
      </section>

      {exportProgress && (
        <section className="operation-heartbeat export-heartbeat export-progress-card" role="status" aria-live="polite">
          <span className="operation-heartbeat-pulse" aria-hidden="true" />
          <div>
            <strong>{exportProgress.stage}</strong>
            <span>{exportProgress.detail}</span>
            <progress value={exportProgress.percent} max={100} aria-label="打包发布进度" />
          </div>
          <small>已运行 {formatDuration(Date.now() - exportProgress.startedAt)}</small>
        </section>
      )}

      <section className="package-section package-log-console" aria-label="发布与打包日志控制台">
        <header>
          <strong><Terminal size={16} /> 导出控制台</strong>
          <span>{isExporting ? "流式输出" : consoleEntries.length > 0 ? `${consoleEntries.length} 条日志` : "待命"}</span>
          <button type="button" data-help-key="package.console.clear" onClick={() => setConsoleEntries([])} disabled={isExporting && consoleEntries.length === 0} aria-label="清空导出控制台">
            <Trash2 size={14} /> 清空
          </button>
        </header>
        <div className="package-log-console-body" role="log" aria-live="polite" aria-relevant="additions text">
          {consoleEntries.length === 0 ? (
            <p className="package-log-empty">等待下一次卡带导出或软件包构建。</p>
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
      </section>

      <section className="package-section package-script-panel">
        <header>
          <div>
            <strong>玩家客户端与打包脚本</strong>
            <span>构建链路</span>
          </div>
        </header>
        <div className="package-script-list">
          {packageScriptRows.map((row) => (
            <div className="package-script-row" key={row.command}>
              <span>{row.label}</span>
              <code>{row.command}</code>
            </div>
          ))}
        </div>
        <p>构建独立软件包会先校验 .vncart，再以 GameCLI fixed-only 模式内嵌卡带；成功输出目录只保留安装包/APK。</p>
      </section>

      {messages.length > 0 && <pre className="json-preview">{messages.join("\n")}</pre>}
      </div>

      <div className="package-check-column">
      {packageBuildResult && (
        <section className={`package-section package-build-panel is-${packageBuildResult.status.toLowerCase()}`} aria-live="polite">
          <header>
            <strong>软件包构建结果</strong>
            <span>{packageStatusLabel(packageBuildResult.status)}</span>
          </header>
          <p>{packageBuildResult.message}</p>
          <dl>
            {packageBuildResult.verifyReportPath && <div><dt>vncart 校验</dt><dd>{packageBuildResult.verifyReportPath}</dd></div>}
            {packageBuildResult.buildLogPath && <div><dt>构建日志</dt><dd>{packageBuildResult.buildLogPath}</dd></div>}
            {packageBuildResult.manifestPath && <div><dt>构建清单</dt><dd>{packageBuildResult.manifestPath}</dd></div>}
          </dl>
          {packageBuildResult.artifacts.length > 0 ? (
            <ul>
              {packageBuildResult.artifacts.map((artifact) => (
                <li key={`${artifact.kind}_${artifact.path}`}>
                  <strong>{artifact.kind}</strong>
                  <span>{artifact.path}</span>
                  {artifact.bytes ? <small>{Math.round(artifact.bytes / 1024 / 1024)} MB</small> : null}
                </li>
              ))}
            </ul>
          ) : (
            <small className={packageBuildResult.status === "PASS" ? "inline-note" : "inline-error"}>没有发现可复制的软件包产物。</small>
          )}
          {packageBuildResult.status !== "PASS" && <strong className="inline-error">本次软件包带风险：请修复阻断/失败原因后重新构建，或仅导出 .vncart。</strong>}
        </section>
      )}

      <section className={`package-section preflight-panel is-${preflight.status}`} aria-live="polite">
        <header>
          <strong><ShieldCheck size={17} /> 发布前检查</strong>
          <span className={`preflight-status is-${preflight.status}`}>{preflightStatusLabels[preflight.status]}</span>
        </header>
        <div className="preflight-summary">
          {preflight.groups.map((group) => (
            <span className={`is-${group.status}`} key={group.category}>
              {group.title}：{group.passed}/{group.total} 通过
            </span>
          ))}
          <span className="is-warning">警告 {preflight.warnings.length}</span>
          <span className="is-blocked">阻断 {preflight.blockers.length}</span>
        </div>
        <div className="preflight-checks">
          {preflight.checks.map((item) => <PreflightCheckRow key={item.id} check={item} />)}
        </div>
        {preflight.blockers.length > 0 && <p className="inline-error">存在阻断项，已禁止导出。请修复后再发布。</p>}
        {preflight.blockers.length === 0 && preflight.warnings.length > 0 && (
          <label className="check-row preflight-confirm">
            <input type="checkbox" data-help-key="package.confirmWarnings" checked={warningsConfirmed} disabled={isExporting} onChange={(event) => setWarningsConfirmed(event.target.checked)} />
            我已确认警告项，本次继续导出
          </label>
        )}
      </section>
      </div>

      <button type="button" data-help-key="package.export" data-environment-status={activeEnvResult?.status?.toLowerCase() ?? "idle"} disabled={exportDisabled} aria-busy={isExporting || undefined} onClick={runExport}>
        {isExporting && <RoseTwoLoader className="inline-spinner" particleCount={36} />}
        <span className="package-cta-label" key={exportActionLabel}>{exportActionLabel}</span>
      </button>
      </div>
    </section>
  );
}
