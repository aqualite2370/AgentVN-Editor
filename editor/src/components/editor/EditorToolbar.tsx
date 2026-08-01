import { useReactFlow } from "@xyflow/react";
import { BookOpen, Bot, Clock3, Download, FileInput, GitBranch, Home, Radio, Save, Sparkles, X } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { backendClient } from "../../api/backendClient";
import { applyCharacterDialogStylesToScript } from "../../cartridge/exportCartridge";
import { RoseTwoLoader } from "../common/RoseTwoLoader";
import { useEditorStore } from "../../store/editorStore";
import { useNovelImportStore } from "../../store/novelImportStore";
import { useProjectStore } from "../../store/projectStore";
import type { NovelPersistenceState } from "../../novel-import/types";
import type { AssetRef } from "../../types/assets";
import { stripEmbeddedAssetPayloads } from "../../utils/embeddedAssetPayloads";
import { applyProjectRuntimeSettingsToScript, validateExportScript } from "../../utils/exportScript";
import { buildProjectExportFileName, buildRuntimeScriptFileName } from "../../utils/fileNames";
import { parseProjectFile } from "../../utils/projectImport";
import { writeProjectBackup, type ProjectBackupEntry } from "../../utils/projectTimeline";
import { advancedToolsEventName, type AdvancedToolsRequest } from "../advanced/advancedToolsBridge";
import { MemoryModeSelector } from "./MemoryModeSelector";
import { ThemeToneSelector } from "./ThemeToneSelector";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

const ExportCartridgePanel = lazy(() =>
  import("../../cartridge/ExportCartridgePanel").then((module) => ({ default: module.ExportCartridgePanel }))
);
const AdvancedToolsPanel = lazy(() =>
  import("../advanced/AdvancedToolsPanel").then((module) => ({ default: module.AdvancedToolsPanel }))
);
const AssistantChatPanel = lazy(() =>
  import("../assistant/AssistantChatPanel").then((module) => ({ default: module.AssistantChatPanel }))
);
const NovelImportWizard = lazy(() =>
  import("../novel-import/NovelImportWizard").then((module) => ({ default: module.NovelImportWizard }))
);
const ProjectTimelinePanel = lazy(() =>
  import("../timeline/ProjectTimelinePanel").then((module) => ({ default: module.ProjectTimelinePanel }))
);

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(stripEmbeddedAssetPayloads(value), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function isAssetRef(value: unknown): value is AssetRef {
  return Boolean(value) &&
    typeof value === "object" &&
    typeof (value as AssetRef).asset_id === "string" &&
    typeof (value as AssetRef).asset_type === "string" &&
    Boolean((value as AssetRef).metadata) &&
    typeof (value as AssetRef).metadata === "object";
}

function mergeAssetManifest(current: AssetRef[], incoming: unknown[]): AssetRef[] {
  const assets = new Map(current.map((asset) => [asset.asset_id, asset]));
  for (const asset of incoming) {
    if (!isAssetRef(asset)) continue;
    assets.set(asset.asset_id, { ...assets.get(asset.asset_id), ...asset });
  }
  return [...assets.values()];
}

function scheduleCanvasViewportWork(callback: () => void, options: { delayMs?: number; idleTimeoutMs?: number } = {}) {
  const delayMs = options.delayMs ?? 0;
  const run = () => {
    window.requestAnimationFrame(() => {
      const idleWindow = window as Window & {
        requestIdleCallback?: (handler: IdleRequestCallback, options?: IdleRequestOptions) => number;
      };
      if (idleWindow.requestIdleCallback) {
        idleWindow.requestIdleCallback(callback, { timeout: options.idleTimeoutMs ?? 500 });
        return;
      }
      window.setTimeout(callback, 0);
    });
  };
  if (delayMs > 0) {
    window.setTimeout(run, delayMs);
    return;
  }
  run();
}

const popoverExitMs = 360;
const novelWorkbenchExitMs = 220;
const popoverMorphMs = 520;
const popoverMorphSettleMs = 220;

type ToolbarPanel = "cartridge" | "advanced" | "assistant" | "timeline";
type ToolbarPanelStage = "closed" | "open" | "closing";
type AdvancedLayoutModeOptions = { animate?: boolean };
type FocusCanvasNodeEvent = CustomEvent<{
  nodeId?: string;
  nodeIds?: string[];
  select?: boolean;
  padding?: number;
  zoom?: number;
  duration?: number;
}>;

const toolbarPanelLabels: Record<ToolbarPanel, string> = {
  cartridge: "打包与发布",
  advanced: "工具 / 设置",
  assistant: "AI 助手",
  timeline: "时间线",
};

function ToolbarPanelLoading({ panel }: { panel: ToolbarPanel }) {
  return (
    <div className="toolbar-panel-loading" role="status" aria-live="polite">
      <strong>正在加载{toolbarPanelLabels[panel]}</strong>
      <span>请稍候，面板即将就绪。</span>
    </div>
  );
}

function NovelWorkbenchLoading() {
  return (
    <div className="toolbar-panel-loading" role="status" aria-live="polite">
      <strong>正在加载小说导入</strong>
      <span>正在准备长文解析工作台。</span>
    </div>
  );
}

export function EditorToolbar({ onReturnHome }: { onReturnHome: () => void }) {
  const [renderedPanel, setRenderedPanel] = useState<ToolbarPanel | null>(null);
  const [panelStage, setPanelStage] = useState<ToolbarPanelStage>("closed");
  const [advancedRequest, setAdvancedRequest] = useState<AdvancedToolsRequest>();
  const [popoverLayoutMode, setPopoverLayoutMode] = useState(false);
  const [novelWorkbenchOpen, setNovelWorkbenchOpen] = useState(false);
  const [novelWorkbenchClosing, setNovelWorkbenchClosing] = useState(false);
  const [restoringEntry, setRestoringEntry] = useState<ProjectBackupEntry>();
  const memoryMode = useEditorStore((state) => state.memoryMode);
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const updateMemoryMode = useEditorStore((state) => state.updateMemoryMode);
  const autoArrangeNodes = useEditorStore((state) => state.autoArrangeNodes);
  const exportProject = useEditorStore((state) => state.exportProject);
  const exportScript = useEditorStore((state) => state.exportScript);
  const importProject = useEditorStore((state) => state.importProject);
  const importProjectAsRoute = useEditorStore((state) => state.importProjectAsRoute);
  const setNotice = useEditorStore((state) => state.setNotice);
  const project = useProjectStore();
  const reactFlow = useReactFlow();
  const toolbarRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const novelWorkbenchCloseTimerRef = useRef<number | null>(null);
  const previousPopoverRectRef = useRef<DOMRect | null>(null);
  const popoverMorphRef = useRef<Animation | null>(null);
  const popoverMorphSettleTimerRef = useRef<number | null>(null);
  const activePanel = panelStage === "open" ? renderedPanel : null;
  const visiblePanel = renderedPanel;
  const popoverClassName = `toolbar-popover${visiblePanel === "cartridge" ? " cartridge" : ""}${visiblePanel === "advanced" ? " advanced" : ""}${visiblePanel === "assistant" ? " assistant" : ""}${visiblePanel === "timeline" ? " timeline" : ""}${popoverLayoutMode && visiblePanel === "advanced" ? " is-layout-mode" : ""}${panelStage === "open" ? " is-open" : ""}${panelStage === "closing" ? " is-closing" : ""}`;
  const aiToolsActive = activePanel === "assistant" || novelWorkbenchOpen;
  const settingsToolsActive = activePanel === "advanced";
  const timelineToolsActive = activePanel === "timeline";

  useEffect(() => {
    const hasVisiblePopover = renderedPanel !== null && panelStage !== "closed";
    document.body.classList.toggle("is-toolbar-popover-open", hasVisiblePopover);
    return () => document.body.classList.remove("is-toolbar-popover-open");
  }, [panelStage, renderedPanel]);

  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  function capturePopoverRect() {
    const node = popoverRef.current;
    previousPopoverRectRef.current = node ? node.getBoundingClientRect() : null;
  }

  function clearPopoverMorphSettleTimer() {
    if (popoverMorphSettleTimerRef.current !== null) {
      window.clearTimeout(popoverMorphSettleTimerRef.current);
      popoverMorphSettleTimerRef.current = null;
    }
  }

  const setAdvancedLayoutMode = useCallback((nextLayoutMode: boolean, options: AdvancedLayoutModeOptions = {}): number => {
    if (popoverLayoutMode === nextLayoutMode) return 0;
    if (options.animate === false) {
      clearPopoverMorphSettleTimer();
      popoverMorphRef.current?.cancel();
      previousPopoverRectRef.current = null;
      const node = popoverRef.current;
      node?.classList.remove("is-morphing");
      node?.classList.remove("is-morph-settled");
      if (node) {
        node.style.transform = "";
        node.style.opacity = "";
        node.style.filter = "";
      }
    } else {
      capturePopoverRect();
    }
    setPopoverLayoutMode(nextLayoutMode);
    return options.animate === false || prefersReducedMotion() ? 0 : popoverMorphMs;
  }, [popoverLayoutMode]);

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function clearNovelWorkbenchCloseTimer() {
    if (novelWorkbenchCloseTimerRef.current === null) return;
    window.clearTimeout(novelWorkbenchCloseTimerRef.current);
    novelWorkbenchCloseTimerRef.current = null;
  }

  function closePanel(panel = activePanel) {
    if (!panel) return;
    clearCloseTimer();
    capturePopoverRect();
    setRenderedPanel(panel);
    setPanelStage("closing");
    closeTimerRef.current = window.setTimeout(() => {
      setRenderedPanel((current) => (current === panel ? null : current));
      setPanelStage("closed");
      setPopoverLayoutMode(false);
      closeTimerRef.current = null;
    }, popoverExitMs);
  }

  function togglePanel(panel: ToolbarPanel) {
    if (activePanel === panel) {
      closePanel(panel);
      return;
    }
    clearCloseTimer();
    capturePopoverRect();
    if (panel !== "advanced") setPopoverLayoutMode(false);
    setRenderedPanel(panel);
    setPanelStage("open");
  }

  function openNovelWorkbench() {
    clearCloseTimer();
    clearNovelWorkbenchCloseTimer();
    popoverMorphRef.current?.cancel();
    setRenderedPanel(null);
    setPanelStage("closed");
    setPopoverLayoutMode(false);
    setNovelWorkbenchClosing(false);
    setNovelWorkbenchOpen(true);
  }

  function closeNovelWorkbench() {
    if (!novelWorkbenchOpen || novelWorkbenchClosing) return;
    setNovelWorkbenchClosing(true);
    clearNovelWorkbenchCloseTimer();
    const exitMs = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 1 : novelWorkbenchExitMs;
    novelWorkbenchCloseTimerRef.current = window.setTimeout(() => {
      setNovelWorkbenchOpen(false);
      setNovelWorkbenchClosing(false);
      novelWorkbenchCloseTimerRef.current = null;
    }, exitMs);
  }

  function buildCurrentProjectSnapshot() {
    return exportProject({
      projectId: project.projectId,
      title: project.title,
      author: project.author,
      assetManifest: project.assetManifest,
      editorSettings: { ...project.settings },
      createdAt: project.createdAt,
    });
  }

  async function saveTimelineSnapshot(trigger: string) {
    return await writeProjectBackup(buildCurrentProjectSnapshot(), trigger);
  }

  function autoArrangeCanvas() {
    const result = autoArrangeNodes({ scope: "all" });
    if (result.arrangedNodeIds.length === 0) {
      setNotice("没有可整理的节点。", "info");
      return;
    }
    const focusNodeId = nodes.find((node) => node.data.nodeKind === "start")?.id ?? result.arrangedNodeIds[0];
    window.requestAnimationFrame(() => {
      void reactFlow.fitView({
        nodes: [{ id: focusNodeId }],
        padding: 0.42,
        duration: 420,
      });
    });
    setNotice(
      `已整理画布：移动 ${result.movedCount} 个节点。`,
      result.movedCount > 0 ? "success" : "info",
    );
  }

  async function restoreTimelineProject(nextProject: Parameters<typeof importProject>[0], entry: ProjectBackupEntry) {
    setRestoringEntry(entry);
    let savedProject: Parameters<typeof importProject>[0] = nextProject;
    try {
      savedProject = await backendClient.saveProject(nextProject);
    } catch (error) {
      reportFrontendError("editor.timeline", error, {
        operation: "save-restored-project",
        projectId: nextProject.project_id,
      });
      setNotice(error instanceof Error ? error.message : "Timeline restore failed.", "error");
      setRestoringEntry(undefined);
      return;
    }
    window.requestAnimationFrame(() => {
      try {
        importProject(savedProject);
        project.loadProjectMetadata(savedProject);
        useNovelImportStore.getState().hydratePersistence(savedProject.editor_settings?.novelPersistence as NovelPersistenceState | undefined);
        setNotice(`已恢复 ${new Date(entry.timestamp_ms).toLocaleString()} 的工程快照。`, "success");
        closePanel("timeline");
        window.setTimeout(() => setRestoringEntry(undefined), prefersReducedMotion() ? 320 : 1300);
      } catch (error) {
        reportFrontendError("editor.timeline", error, {
          operation: "apply-restored-project",
          projectId: savedProject.project_id,
        });
        setNotice({
          tone: "error",
          source: "时间线恢复",
          message: error instanceof Error ? error.message : "恢复工程快照失败。",
          detail: error instanceof Error ? error.stack : undefined,
          error,
          action: "请检查备份文件是否完整，或选择其他时间线记录。",
        });
        setRestoringEntry(undefined);
      }
    });
  }

  useLayoutEffect(() => {
    const previousRect = previousPopoverRectRef.current;
    const node = popoverRef.current;
    previousPopoverRectRef.current = null;
    if (!previousRect || !node || panelStage !== "open" || prefersReducedMotion()) return;

    const nextRect = node.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    const scaleX = previousRect.width / Math.max(nextRect.width, 1);
    const scaleY = previousRect.height / Math.max(nextRect.height, 1);
    const moved = Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1 || Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01;
    if (!moved) return;

    clearPopoverMorphSettleTimer();
    popoverMorphRef.current?.cancel();
    node.classList.remove("is-morph-settled");
    node.classList.add("is-morphing");
    const animation = node.animate(
      [
        {
          transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
          opacity: 0.96,
        },
        {
          transform: "translate(0, 0) scale(1, 1)",
          opacity: 1,
        },
      ],
      {
        duration: popoverMorphMs,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "both",
      }
    );
    popoverMorphRef.current = animation;
    let cleaned = false;
    const cleanupMorphAnimation = () => {
      if (cleaned) return;
      cleaned = true;
      animation.oncancel = null;
      animation.cancel();
      node.style.transform = "";
      node.style.opacity = "";
      node.style.filter = "";
      if (popoverMorphRef.current === animation) popoverMorphRef.current = null;
    };
    animation.onfinish = () => {
      node.classList.add("is-morph-settled");
      popoverMorphSettleTimerRef.current = window.setTimeout(() => {
        node.classList.remove("is-morphing");
        popoverMorphSettleTimerRef.current = null;
      }, popoverMorphSettleMs);
      cleanupMorphAnimation();
    };
    animation.oncancel = () => {
      clearPopoverMorphSettleTimer();
      node.classList.remove("is-morph-settled");
      node.classList.remove("is-morphing");
      cleanupMorphAnimation();
    };
  }, [panelStage, popoverLayoutMode, renderedPanel]);

  useEffect(() => {
    if (!activePanel) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolbarRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      const targetElement = target instanceof Element ? target : target.parentElement;
      if (targetElement?.closest('[data-toolbar-popover-keepopen="true"], .rich-select-popover, .color-picker-backdrop, .color-picker-dialog, .animation-template-popover, .asset-picker-popover')) return;
      if (targetElement?.closest(".novel-task-mini-entry, .novel-task-workbench")) return;
      closePanel();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && document.querySelector(".animation-template-popover")) return;
      if (event.key === "Escape") closePanel();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePanel]);

  useEffect(() => {
    function handleFocusCanvasNode(event: Event) {
      const detail = (event as FocusCanvasNodeEvent).detail;
      const requestedIds = detail?.nodeIds?.length ? detail.nodeIds : detail?.nodeId ? [detail.nodeId] : [];
      const store = useEditorStore.getState();
      const nodeIds = requestedIds.filter((id) => store.nodes.some((node) => node.id === id));
      if (nodeIds.length === 0) return;
      if (detail?.select !== false) store.selectNode(nodeIds[0]);
      window.requestAnimationFrame(() => {
        if (nodeIds.length > 1) {
          void reactFlow.fitView({
            nodes: nodeIds.map((id) => ({ id })),
            padding: detail?.padding ?? 0.32,
            duration: detail?.duration ?? 180,
          });
          return;
        }
        const target = useEditorStore.getState().nodes.find((node) => node.id === nodeIds[0]);
        if (!target) return;
        const measured = target.measured as { width?: number; height?: number } | undefined;
        const centerX = target.position.x + (measured?.width ?? 300) / 2;
        const centerY = target.position.y + (measured?.height ?? 180) / 2;
        void reactFlow.setCenter(centerX, centerY, {
          zoom: detail?.zoom ?? 0.82,
          duration: detail?.duration ?? 180,
        });
      });
    }

    window.addEventListener("agentvn:focus-canvas-node", handleFocusCanvasNode);
    return () => window.removeEventListener("agentvn:focus-canvas-node", handleFocusCanvasNode);
  }, [reactFlow]);

  useEffect(() => () => {
    clearCloseTimer();
    clearNovelWorkbenchCloseTimer();
    clearPopoverMorphSettleTimer();
    popoverMorphRef.current?.cancel();
  }, []);

  useEffect(() => {
    if (!novelWorkbenchOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeNovelWorkbench();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [novelWorkbenchOpen, novelWorkbenchClosing]);

  useEffect(() => {
    function handleAdvancedRequest(event: Event) {
      const detail = (event as CustomEvent<AdvancedToolsRequest>).detail;
      if (!detail) return;
      clearCloseTimer();
      capturePopoverRect();
      if (detail.tab === "novel") {
        setAdvancedRequest(undefined);
        setPopoverLayoutMode(false);
        setRenderedPanel(null);
        setPanelStage("closed");
        openNovelWorkbench();
        return;
      }
      setAdvancedRequest(detail);
      setPopoverLayoutMode(detail.tab === "layout");
      setRenderedPanel("advanced");
      setPanelStage("open");
    }

    window.addEventListener(advancedToolsEventName, handleAdvancedRequest);
    return () => window.removeEventListener(advancedToolsEventName, handleAdvancedRequest);
  }, []);

  return (
    <header className="editor-toolbar" ref={toolbarRef}>
      <div className="toolbar-inner">
        <div className="toolbar-brand">
          <strong>AgentVN</strong>
          <span>可视化叙事工程</span>
        </div>

        <button type="button" className="toolbar-home-button" data-help-key="toolbar.home" onClick={onReturnHome}>
          <Home size={16} />
          返回首页
        </button>

        <div className="toolbar-group toolbar-project-group">
          <button
            type="button"
            data-help-key="toolbar.saveProject"
            onClick={() => {
              const exportedProject = buildCurrentProjectSnapshot();
              downloadJson(buildProjectExportFileName(project.title), exportedProject);
              void saveTimelineSnapshot("manual_save").catch((error) => {
                reportFrontendError("editor.timeline", error, {
                  operation: "manual-backup",
                  projectId: project.projectId,
                });
                setNotice({
                  tone: "warning",
                  source: "工程备份",
                  message: error instanceof Error ? error.message : "保存时间线快照失败。",
                  detail: error instanceof Error ? error.stack : undefined,
                  action: "工程 JSON 已导出；如需排查备份，请检查 backup-timeline 目录。",
                });
              });
            }}
          >
            <Save size={16} />
            保存工程
          </button>

          <label className="file-button" data-help-key="toolbar.importProject">
            <FileInput size={16} />
            导入工程
            <input
              type="file"
              accept=".vnproj,.json"
              onChange={async (event) => {
                const input = event.currentTarget;
                const file = event.target.files?.[0];
                if (!file) return;

                const result = await parseProjectFile(file);
                if (!result.project) {
                  setNotice({
                    tone: "error",
                    source: "工程导入",
                    message: result.error ?? "导入失败。",
                    action: "请选择有效的 AgentVN 工程文件（.vnproj 或 .json）。",
                  });
                  input.value = "";
                  return;
                }

                const importResult = importProjectAsRoute(result.project);
                if (result.project.asset_manifest.length > 0) {
                  project.setAssetManifest(mergeAssetManifest(project.assetManifest, result.project.asset_manifest));
                }

                if (importResult.nodes > 0) {
                  const largeImport = importResult.nodes > 80;
                  scheduleCanvasViewportWork(() => {
                    void reactFlow.fitView({
                      nodes: importResult.selectedNodeId ? [{ id: importResult.selectedNodeId }] : undefined,
                      padding: 0.36,
                      duration: largeImport ? 0 : 420,
                    });
                  }, { delayMs: largeImport ? 3000 : 0, idleTimeoutMs: largeImport ? 1200 : 500 });
                  setNotice({
                    tone: "success",
                    source: "项目路线导入",
                    message: "已导入独立线路：" + importResult.nodes + " 个节点 / " + importResult.edges + " 条内部连线。",
                    action: "新线路已放在画布右侧，不会自动连接到入口；需要启用时请手动连线。",
                  });
                } else {
                  setNotice({
                    tone: "info",
                    source: "项目路线导入",
                    message: "导入文件中没有可追加的节点。",
                    action: "请检查工程内容，或使用首页导入来替换当前工程。",
                  });
                }

                input.value = "";
              }}
            />
          </label>

          <button
            type="button"
            data-help-key="toolbar.exportScript"
            onClick={() => {
              const script = applyProjectRuntimeSettingsToScript(
                applyCharacterDialogStylesToScript(exportScript(), project.settings.characterDialogStyles),
                project.settings,
              );
              const issues = validateExportScript(script, { nodes, edges });
              const errors = issues.filter((issue) => issue.severity !== "warning");
              const warnings = issues.filter((issue) => issue.severity === "warning");

              if (errors.length > 0) {
                setNotice({
                  tone: "error",
                  source: "脚本导出",
                  message: "脚本校验失败：" + errors.map((issue) => issue.message).join("；"),
                  action: "请修复连线、入口或节点内容后再导出 Runtime JSON。",
                });
                return;
              }

              downloadJson(buildRuntimeScriptFileName(project.title), script);
              setNotice(
                warnings.length > 0
                  ? "脚本已导出，但存在警告：" + warnings.map((issue) => issue.message).join("；")
                  : "脚本已导出。",
                warnings.length > 0 ? "warning" : "success",
              );
            }}
          >
            <Download size={16} />
            导出脚本
          </button>

          <button
            type="button"
            data-help-key="toolbar.exportCartridge"
            aria-expanded={activePanel === "cartridge"}
            onClick={() => togglePanel("cartridge")}
          >
            <GitBranch size={16} />
            打包与发布
          </button>

          <button
            type="button"
            className="toolbar-arrange-button"
            data-help-key="toolbar.autoArrange"
            onClick={autoArrangeCanvas}
          >
            整理画布
          </button>
        </div>

        <div className="toolbar-group toolbar-right toolbar-tools-group">
          <section
            className={"toolbar-tool-container toolbar-ai-tools ai-glow-surface ai-flow-border" + (aiToolsActive ? " ai-flow-active" : "")}
            aria-label="AI 工具"
          >
            <span className="toolbar-container-label">AI 工具</span>
            <div className="toolbar-container-actions">
              <button
                type="button"
                className={"ai-glow-button" + (activePanel === "assistant" ? " ai-flow-active" : "")}
                aria-expanded={activePanel === "assistant"}
                data-help-key="toolbar.assistant"
                onClick={() => togglePanel("assistant")}
              >
                <Bot size={16} />
                AI 助手
              </button>
              <button
                type="button"
                className={"ai-glow-button" + (novelWorkbenchOpen ? " ai-flow-active" : "")}
                aria-expanded={novelWorkbenchOpen}
                data-help-key="toolbar.novelImport"
                onClick={openNovelWorkbench}
              >
                <BookOpen size={16} />
                小说导入
              </button>
            </div>
          </section>

          <section
            className={"toolbar-tool-container toolbar-settings-tools ai-glow-surface ai-flow-border" + (settingsToolsActive ? " ai-flow-active" : "")}
            aria-label="工具 / 设置"
          >
            <span className="toolbar-container-label">工具 / 设置</span>
            <div className="toolbar-container-actions">
              <button
                type="button"
                className={"ai-glow-button" + (settingsToolsActive ? " ai-flow-active" : "")}
                aria-expanded={activePanel === "advanced"}
                data-help-key="toolbar.advanced"
                onClick={() => togglePanel("advanced")}
              >
                <Sparkles size={16} />
                工具 / 设置
              </button>
            </div>
          </section>

          <section
            className={"toolbar-tool-container toolbar-timeline-tools ai-glow-surface ai-flow-border" + (timelineToolsActive ? " ai-flow-active" : "")}
            aria-label="时间线"
          >
            <span className="toolbar-container-label">时间线</span>
            <div className="toolbar-container-actions">
              <button
                type="button"
                className={"ai-glow-button" + (timelineToolsActive ? " ai-flow-active" : "")}
                aria-expanded={activePanel === "timeline"}
                data-help-key="toolbar.timeline"
                onClick={() => togglePanel("timeline")}
              >
                <Clock3 size={16} />
                历史记录
              </button>
            </div>
          </section>


          <MemoryModeSelector compact value={memoryMode} onChange={(mode) => updateMemoryMode(mode)} />
          <ThemeToneSelector />
          <Radio size={16} className="status-dot" />
        </div>
      </div>

      {visiblePanel && (
        <div className={popoverClassName} ref={popoverRef}>
          <Suspense fallback={<ToolbarPanelLoading panel={visiblePanel} />}>
            {visiblePanel === "cartridge" ? (
              <ExportCartridgePanel onClose={() => closePanel("cartridge")} />
            ) : visiblePanel === "assistant" ? (
              <AssistantChatPanel />
            ) : visiblePanel === "timeline" ? (
              <ProjectTimelinePanel onRestore={restoreTimelineProject} />
            ) : (
              <AdvancedToolsPanel request={advancedRequest} onLayoutModeChange={setAdvancedLayoutMode} />
            )}
          </Suspense>
        </div>
      )}

      {novelWorkbenchOpen && createPortal((
        <div
          className={"novel-import-workbench-backdrop" + (novelWorkbenchClosing ? " is-closing" : "")}
          role="presentation"
          onMouseDown={closeNovelWorkbench}
        >
          <section
            className={"novel-import-workbench-dialog" + (novelWorkbenchClosing ? " is-closing" : "")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="novel-import-workbench-title"
            data-testid="novel-import-workbench"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="novel-import-workbench-header">
              <div>
                <span className="toolbar-container-label">AI 工具</span>
                <h3 id="novel-import-workbench-title">小说导入工作台</h3>
                <p>解析长篇文本，生成可编辑的剧情节点与线路草稿。</p>
              </div>
              <button type="button" className="studio-icon-button" data-help-key="toolbar.novelImport.closeWorkbench" aria-label="关闭小说导入工作台" onClick={closeNovelWorkbench}>
                <X size={18} />
              </button>
            </header>
            <div className="novel-import-workbench-body">
              <Suspense fallback={<NovelWorkbenchLoading />}>
                <section className="advanced-tools-panel layout-mode novel-tool-frame">
                  <div className="advanced-tab-viewport">
                    <div className="advanced-tab-content" data-tab="novel">
                      <NovelImportWizard />
                    </div>
                  </div>
                </section>
              </Suspense>
            </div>
          </section>
        </div>
      ), document.body)}

      {restoringEntry && (
        <div className="timeline-restore-toast" role="status" aria-live="polite">
          <span>
            <strong>正在恢复时间线</strong>
            <RoseTwoLoader particleCount={42} />
          </span>
          <div>
            <strong>{new Date(restoringEntry.timestamp_ms).toLocaleString()}</strong>
            <span>工程快照恢复中，请稍候。</span>
          </div>
        </div>
      )}
    </header>
  );
}
