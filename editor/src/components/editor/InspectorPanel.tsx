import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, Copy, Film, HelpCircle, ImagePlus, Repeat2, Sparkles, Trash2, UploadCloud, WandSparkles, X } from "lucide-react";
import { backendClient } from "../../api/backendClient";
import { requestAdvancedTools } from "../advanced/advancedToolsBridge";
import { getProviderSelectionPayload } from "../../providers/providerRegistry";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { useSelectedNode } from "../../store/selectors";
import type { AnimationCommand, StateUpdateCommand } from "../../types/commands";
import type { AssetRef, AssetType } from "../../types/assets";
import type { LoadingAnimationConfig } from "../../../../shared/cartridge/types";
import { assetTypeDisplayLabel } from "../../../../shared/cartridge/assetTaxonomy";
import type { EditorNode, LoopData } from "../../types/nodes";
import { EmptyState } from "../common/EmptyState";
import { AssetPicker } from "../common/AssetPicker";
import { FieldHelp } from "../common/FieldHelp";
import { JsonPreview } from "../common/JsonPreview";
import { AnimationCommandEditor } from "../command-editors/AnimationCommandEditor";
import { ChoiceCommandEditor } from "../command-editors/ChoiceCommandEditor";
import { CommandListEditor, currentPoseBeforeList } from "../command-editors/CommandListEditor";
import { ConditionBuilderEditor } from "../command-editors/ConditionBuilderEditor";
import { FloatingCommandWorkbench } from "../command-editors/FloatingCommandWorkbench";
import { CameraStudioDialog } from "../command-editors/CameraStudioDialog";
import { StateUpdateCommandEditor } from "../command-editors/StateUpdateCommandEditor";
import { MemoryModeSelector } from "./MemoryModeSelector";
import { collectStateVariableKeys, conditionOperatorLabels, type ConditionValueType } from "../../utils/conditions";
import { buildPreviousSummary } from "../../utils/graphTraversal";
import { buildEditorGenerationContextPackage } from "../../utils/generationContext";
import { buildSceneAssetAudit } from "../../utils/assetAudit";
import { buildProjectAssetPath, sanitizeAssetId } from "../../utils/projectAssets";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { analyzeAnimationNodeMigration } from "../../utils/animationNodeMigration";
import { TimelineUnavailableError, writeProjectBackup } from "../../utils/projectTimeline";
import { createDefaultCameraCommand } from "../../../../shared/camera/cameraMotion";

const inspectorExitDurationMs = 220;

type InspectorExitReason = "selection-clear" | "workbench-close";
type SceneAssetAudit = ReturnType<typeof buildSceneAssetAudit>;

function scheduleInspectorDerivedWork(callback: () => void, timeout = 180): () => void {
  const idleWindow = window as Window & {
    requestIdleCallback?: (handler: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  let timeoutId: number | undefined;
  let idleId: number | undefined;
  if (idleWindow.requestIdleCallback) {
    idleId = idleWindow.requestIdleCallback(callback, { timeout });
  } else {
    timeoutId = window.setTimeout(callback, 0);
  }
  return () => {
    if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  };
}

const nodeKindLabels: Record<string, string> = {
  choice: "选项分支节点",
  scene: "场景节点",
  modifier: "修饰节点",
  condition: "条件节点",
  loop: "重复剧情节点",
  animation: "旧版演出动画节点",
  start: "入口节点",
  end: "结局节点",
};

const phaseLabels: Record<string, string> = {
  public_decision: "公开决策",
  structured_write: "结构化写入",
  mcp_tool: "MCP 工具",
  json_mode: "JSON 兼容",
  fallback: "降级重试",
  validation: "结构校验",
  memory: "记忆抽取",
};

function formatGeneratedAt(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function aiSourceLabel(source?: string): string | undefined {
  if (source === "imported") return "来源于解析小说";
  if (source === "ai_generated") return "AI 生成后续";
  if (source === "ai_edited") return "AI 生成后已编辑";
  return undefined;
}

function formatTraceTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("读取文件失败"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function fileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function uniqueAssetId(base: string, usedIds: Set<string>): string {
  const normalized = sanitizeAssetId(base);
  if (!usedIds.has(normalized)) return normalized;
  let index = 2;
  while (usedIds.has(`${normalized}_${index}`)) index += 1;
  return `${normalized}_${index}`;
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name);
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name);
}

function loopConditionValueType(loop: LoopData): ConditionValueType {
  const condition = loop.continueCondition;
  if (condition.operator === "truthy" || condition.operator === "falsy") return "boolean";
  if (typeof condition.value === "number") return "number";
  if (Array.isArray(condition.value)) return "list";
  return "text";
}

function readableLoopCondition(loop: LoopData): string {
  const condition = loop.continueCondition;
  const label = conditionOperatorLabels[condition.operator];
  if (condition.operator === "truthy" || condition.operator === "falsy") {
    return `${condition.key || "变量"}${label}`;
  }
  const value = Array.isArray(condition.value) ? condition.value.join("、") : String(condition.value ?? "");
  return `${condition.key || "变量"}${label}${value}`;
}

function numericConditionMatches(loop: LoopData, value: number): boolean | undefined {
  const condition = loop.continueCondition;
  if (condition.key !== loop.variableKey || typeof condition.value !== "number") return undefined;
  switch (condition.operator) {
    case "equals": return value === condition.value;
    case "not_equals": return value !== condition.value;
    case "greater_than": return value > condition.value;
    case "less_than": return value < condition.value;
    case "greater_or_equal": return value >= condition.value;
    case "less_or_equal": return value <= condition.value;
    default: return undefined;
  }
}

function estimateLoopPasses(loop: LoopData): { count: number; mayNotExit: boolean } | undefined {
  let currentValue = loop.initialValue;
  let count = 0;
  for (let iteration = 0; iteration < 1000; iteration += 1) {
    currentValue += loop.step;
    const matches = numericConditionMatches(loop, currentValue);
    if (matches === undefined) return undefined;
    if (!matches) return { count, mayNotExit: false };
    count += 1;
  }
  return { count, mayNotExit: true };
}

function loadingAssetFromFile(file: File, dataUrl: string, assetType: Extract<AssetType, "ui" | "video">, assetId: string): AssetRef {
  return {
    asset_id: assetId,
    asset_type: assetType,
    metadata: {
      filename: file.name,
      mime_type: file.type || (assetType === "video" ? "video/mp4" : "image/png"),
      size_bytes: file.size,
      source: "imported",
      data_url: dataUrl,
      blob_url: dataUrl,
      project_path: buildProjectAssetPath(assetType, assetId, file.name),
      created_at: new Date().toISOString(),
      tags: ["loading_animation"],
    },
  };
}

function assetDisplayName(asset: AssetRef | undefined, fallback: string): string {
  return asset?.metadata.filename || asset?.asset_id || fallback;
}

function GenerationDebugPanel() {
  const debug = useEditorStore((state) => state.generationDebug);
  const activeGeneration = useEditorStore((state) => state.activeGeneration);
  const selectionRevision = useEditorStore((state) => state.selectionRevision);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (activeGeneration) return;
    setIsOpen(false);
  }, [selectionRevision]);

  useEffect(() => {
    const closeForNodeClick = () => {
      if (!useEditorStore.getState().activeGeneration) {
        setIsOpen(false);
      }
    };
    window.addEventListener("agentvn:node-card-click", closeForNodeClick);
    return () => window.removeEventListener("agentvn:node-card-click", closeForNodeClick);
  }, []);

  useEffect(() => {
    if (!activeGeneration) return;
    setIsOpen(true);
    window.requestAnimationFrame(() => {
      if (!detailsRef.current) return;
      detailsRef.current.open = true;
      detailsRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [activeGeneration?.startedAt]);

  if (!debug) return null;

  return (
    <details
      ref={detailsRef}
      className={`generation-debug-panel ai-glow-surface ai-flow-border${activeGeneration ? " ai-flow-active" : ""}`}
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary>调试信息</summary>
      <div className="generation-debug-status ai-glow-surface">
        <span>当前阶段</span>
        <strong>{debug.status || "等待生成事件"}</strong>
      </div>
      <section>
        <h4>公开决策过程</h4>
        <pre>{debug.decisionText || "尚未收到公开决策文本；后端会继续记录 MCP 工具与结构校验状态。"}</pre>
      </section>
      <section>
        <h4>工具与校验日志</h4>
        {debug.traces.length === 0 ? (
          <p className="debug-data-note">尚未收到 trace 事件。</p>
        ) : (
          <ol className="generation-trace-list">
            {debug.traces.map((trace) => (
              <li key={trace.id} className={`is-${trace.level}`}>
                <span>{formatTraceTime(trace.time)}</span>
                <strong>{phaseLabels[trace.phase] ?? trace.phase} / {trace.title}</strong>
                <p>{trace.message}</p>
                {trace.details && <pre>{JSON.stringify(trace.details, null, 2)}</pre>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </details>
  );
}

export function InspectorPanel() {
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchCameraOpen, setWorkbenchCameraOpen] = useState(false);
  const [loadingImageToAddId, setLoadingImageToAddId] = useState("");
  const [displayNode, setDisplayNode] = useState<EditorNode | undefined>();
  const [panelPhase, setPanelPhase] = useState<"idle" | "closing">("idle");
  const [isEnrichingCurrentScene, setIsEnrichingCurrentScene] = useState(false);
  const [isBatchMigratingAnimations, setIsBatchMigratingAnimations] = useState(false);
  const node = useSelectedNode();
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const globalMemoryMode = useEditorStore((state) => state.memoryMode);
  const updateNodeData = useEditorStore((state) => state.updateNodeData);
  const updateSceneCommands = useEditorStore((state) => state.updateSceneCommands);
  const migrateAnimationNode = useEditorStore((state) => state.migrateAnimationNode);
  const migrateAllAnimationNodes = useEditorStore((state) => state.migrateAllAnimationNodes);
  const updateMemoryMode = useEditorStore((state) => state.updateMemoryMode);
  const deleteNode = useEditorStore((state) => state.deleteNode);
  const duplicateNode = useEditorStore((state) => state.duplicateNode);
  const assetManifest = useProjectStore((state) => state.assetManifest);
  const activeGeneration = useEditorStore((state) => state.activeGeneration);
  const beginGeneration = useEditorStore((state) => state.beginGeneration);
  const endGeneration = useEditorStore((state) => state.endGeneration);
  const setGenerationDebugStatus = useEditorStore((state) => state.setGenerationDebugStatus);
  const appendGenerationDecisionDelta = useEditorStore((state) => state.appendGenerationDecisionDelta);
  const addGenerationTrace = useEditorStore((state) => state.addGenerationTrace);
  const applyGeneratedSceneToNode = useEditorStore((state) => state.applyGeneratedSceneToNode);
  const setNotice = useEditorStore((state) => state.setNotice);
  const setAssetManifest = useProjectStore((state) => state.setAssetManifest);
  const closeTimerRef = useRef<number>();
  const lastNodeRef = useRef<EditorNode>();
  const exitReasonRef = useRef<InspectorExitReason | null>(null);

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  }

  function finishClosing(reason: InspectorExitReason) {
    clearCloseTimer();
    setWorkbenchOpen(false);
    setPanelPhase("idle");
    exitReasonRef.current = null;
    if (reason === "workbench-close") {
      return;
    }
    setDisplayNode(undefined);
    lastNodeRef.current = undefined;
  }

  function startClosing(reason: InspectorExitReason) {
    const closingNode = node ?? displayNode ?? lastNodeRef.current;
    if (!closingNode || panelPhase === "closing") return;
    if (displayNode?.id !== closingNode.id) {
      setDisplayNode(closingNode);
    }
    clearCloseTimer();
    exitReasonRef.current = reason;
    setPanelPhase("closing");
    closeTimerRef.current = window.setTimeout(() => {
      finishClosing(reason);
    }, inspectorExitDurationMs);
  }

  function handleWorkbenchMinimize() {
    clearCloseTimer();
    exitReasonRef.current = null;
    setPanelPhase("idle");
    setWorkbenchOpen(false);
  }

  useEffect(() => {
    if (!node) return;
    lastNodeRef.current = node;
    clearCloseTimer();
    exitReasonRef.current = null;
    setDisplayNode(node);
    setPanelPhase("idle");
  }, [node]);

  useEffect(() => {
    setWorkbenchCameraOpen(false);
  }, [node?.id]);

  useEffect(() => {
    const openWorkbenchForNodeClick = (event: Event) => {
      const nodeId = event instanceof CustomEvent ? event.detail?.nodeId : undefined;
      if (typeof nodeId !== "string") return;
      const clickedNode = useEditorStore.getState().nodes.find((item) => item.id === nodeId);
      if (clickedNode?.data.nodeKind !== "scene") return;
      clearCloseTimer();
      exitReasonRef.current = null;
      setPanelPhase("idle");
      setDisplayNode(clickedNode);
      lastNodeRef.current = clickedNode;
      setWorkbenchOpen(true);
    };
    window.addEventListener("agentvn:node-card-click", openWorkbenchForNodeClick);
    return () => window.removeEventListener("agentvn:node-card-click", openWorkbenchForNodeClick);
  }, []);

  useEffect(() => {
    const fallbackNode = displayNode ?? lastNodeRef.current;
    if (node || !fallbackNode) return;
    if (!displayNode) {
      setDisplayNode(fallbackNode);
    }

    if (exitReasonRef.current === "workbench-close") {
      setDisplayNode(undefined);
      setPanelPhase("idle");
      exitReasonRef.current = null;
      return;
    }

    if (panelPhase === "idle") {
      startClosing("selection-clear");
    }
  }, [displayNode, node, panelPhase]);

  useEffect(() => {
    return () => {
      clearCloseTimer();
    };
  }, []);

  const activeNode = (node ?? displayNode) as EditorNode;
  const animationMigration = useMemo(
    () => activeNode?.data.nodeKind === "animation"
      ? analyzeAnimationNodeMigration(nodes, edges, activeNode.id)
      : undefined,
    [activeNode?.data.nodeKind, activeNode?.id, edges, nodes],
  );
  const legacyAnimationNodeCount = useMemo(
    () => nodes.filter((item) => item.data.nodeKind === "animation" && Boolean(item.data.animation)).length,
    [nodes],
  );
  const complexLegacyAnimationNodeCount = useMemo(
    () => nodes
      .filter((item) => item.data.nodeKind === "animation" && Boolean(item.data.animation))
      .filter((item) => analyzeAnimationNodeMigration(nodes, edges, item.id).recommendedMode === "convert_scene")
      .length,
    [edges, nodes],
  );
  const [stateVariableKeys, setStateVariableKeys] = useState<string[]>(() => collectStateVariableKeys(useEditorStore.getState().nodes));
  const [runtimeSceneIds, setRuntimeSceneIds] = useState<string[]>(() =>
    useEditorStore.getState().nodes.map((item) => item.data.scene?.scene_id).filter((sceneId): sceneId is string => Boolean(sceneId))
  );
  const [sceneAssetAudit, setSceneAssetAudit] = useState<SceneAssetAudit | undefined>();

  useEffect(() => {
    const timeout = nodes.length > 80 ? 260 : 120;
    return scheduleInspectorDerivedWork(() => {
      const currentNodes = useEditorStore.getState().nodes;
      setStateVariableKeys(collectStateVariableKeys(currentNodes));
      setRuntimeSceneIds(currentNodes.map((item) => item.data.scene?.scene_id).filter((sceneId): sceneId is string => Boolean(sceneId)));
    }, timeout);
  }, [nodes]);

  useEffect(() => {
    if (!activeNode?.data.scene) {
      setSceneAssetAudit(undefined);
      return;
    }
    const scene = activeNode.data.scene;
    const nodeId = activeNode.id;
    const timeout = nodes.length > 80 ? 260 : 120;
    return scheduleInspectorDerivedWork(() => {
      setSceneAssetAudit(buildSceneAssetAudit(scene, {
        nodeId,
        projectAssets: assetManifest,
        includeOptional: true,
      }));
    }, timeout);
  }, [activeNode?.id, activeNode?.data.scene, assetManifest, nodes.length]);

  async function migrateAllLegacyAnimationNodes() {
    if (isBatchMigratingAnimations || legacyAnimationNodeCount === 0) return;
    const fallbackText = complexLegacyAnimationNodeCount > 0
      ? `其中 ${complexLegacyAnimationNodeCount} 个节点连接较复杂，会原地转成普通场景以保留全部路线。`
      : "所有节点都能安全移入相邻场景。";
    if (!window.confirm(
      `将先创建一份项目时间线备份，再批量转换 ${legacyAnimationNodeCount} 个旧版动画节点。${fallbackText}继续吗？`,
    )) return;

    setIsBatchMigratingAnimations(true);
    try {
      const editor = useEditorStore.getState();
      const project = useProjectStore.getState();
      const snapshot = editor.exportProject({
        projectId: project.projectId,
        title: project.title,
        author: project.author,
        assetManifest: project.assetManifest,
        editorSettings: { ...project.settings },
        createdAt: project.createdAt,
      });
      await writeProjectBackup(snapshot, "legacy_animation_batch_migration");
      const result = migrateAllAnimationNodes();
      if (!result) {
        setNotice({ tone: "info", source: "旧版动画节点批量转换", message: "没有找到需要转换的旧版动画节点。" });
        return;
      }
      setNotice({
        tone: "success",
        source: "旧版动画节点批量转换",
        message: `已先创建时间线备份，再转换 ${result.migratedCount} 个旧版动画节点。`,
        detail: `安全移入场景 ${result.prependCount + result.appendCount} 个；原地转成普通场景 ${result.convertedSceneCount} 个。整次转换可用一次撤销恢复。`,
      });
    } catch (error) {
      reportFrontendError("editor.animation-node-migration", error, {
        operation: "batch-migrate",
      });
      setNotice({
        tone: error instanceof TimelineUnavailableError ? "warning" : "error",
        source: "旧版动画节点批量转换",
        message: "无法创建迁移前备份，所以没有执行批量转换。",
        detail: error instanceof Error ? error.message : undefined,
        error,
        action: error instanceof TimelineUnavailableError
          ? "请在 AgentVN 桌面版中重新执行。"
          : "请检查工程时间线目录是否可写，然后重试。",
      });
    } finally {
      setIsBatchMigratingAnimations(false);
    }
  }

  if (!activeNode) {
    return (
      <aside className="inspector-panel">
        <EmptyState title="未选择节点" description="选择画布上的节点以编辑属性。" />
      </aside>
    );
  }

  const aiSource = aiSourceLabel(activeNode.data.editorMeta?.source);
  const generatedAt = formatGeneratedAt(activeNode.data.editorMeta?.generatedAt);
  const nodeHelpKey = `palette.${activeNode.data.nodeKind}` as const;
  const activeLoop = activeNode.data.nodeKind === "loop" ? activeNode.data.loop : undefined;
  const loopContinueEdge = activeLoop ? edges.find((edge) => edge.source === activeNode.id && edge.sourceHandle === "loop") : undefined;
  const loopExitEdge = activeLoop ? edges.find((edge) => edge.source === activeNode.id && edge.sourceHandle === "exit") : undefined;
  const loopContinueTarget = loopContinueEdge ? nodes.find((item) => item.id === loopContinueEdge.target)?.data.label : undefined;
  const loopExitTarget = loopExitEdge ? nodes.find((item) => item.id === loopExitEdge.target)?.data.label : undefined;
  const loopPassEstimate = activeLoop ? estimateLoopPasses(activeLoop) : undefined;

  function applyFixedLoopPreset(rounds: number) {
    if (!activeLoop) return;
    const variableKey = activeLoop.variableKey.trim() || "loop_count";
    updateNodeData(activeNode.id, {
      loop: {
        ...activeLoop,
        variableKey,
        initialValue: 0,
        step: 1,
        continueCondition: { key: variableKey, operator: "less_or_equal", value: rounds },
        loopLabel: `再做一次（共 ${rounds} 次）`,
        exitLabel: "重复完成，继续剧情",
      },
    });
    setNotice(`已设置为“重复 ${rounds} 次”。接下来只需连接“再做一次”和“重复完成”两条路线。`, "success");
  }

  function applyFlagLoopPreset() {
    if (!activeLoop) return;
    const variableKey = activeLoop.variableKey.trim() || "loop_count";
    updateNodeData(activeNode.id, {
      loop: {
        ...activeLoop,
        variableKey,
        initialValue: 0,
        step: 1,
        continueCondition: { key: "loop_done", operator: "falsy" },
        loopLabel: "还没完成，再做一次",
        exitLabel: "已经完成，继续剧情",
      },
    });
    setNotice("已设置为“直到某件事完成”。请在下方把“是否已经完成”改成剧情实际使用的记录名称。", "success");
  }

  async function enrichCurrentSceneFromOutline() {
    if (activeNode.data.nodeKind !== "scene" || !activeNode.data.scene) return;
    const scene = activeNode.data.scene;
    const outline = activeNode.data.aiSettings.generationOutline?.trim();
    if (!outline) {
      setNotice("请先填写“下一步生成大纲”，再丰富当前节点。", "warning");
      return;
    }
    if (activeGeneration) {
      setNotice(activeGeneration.nodeId === activeNode.id ? "当前节点正在生成，请等待完成后再点击。" : "已有场景正在生成，请等待当前生成完成后再点击。", "warning");
      return;
    }
    const providerSelection = getProviderSelectionPayload("text_generation");
    if (!providerSelection) {
      requestAdvancedTools({
        tab: "providers",
        title: "请先添加模型",
        message: "还没有可用于文本生成的模型。先在“模型/连接”里添加连接、模型并保存 Token，再回来丰富当前节点。",
      });
      setNotice({
        tone: "warning",
        source: "AI Generation",
        message: "还没有可用于文本生成的模型，请先完成模型配置。",
        action: "打开“工具/设置”的“模型/连接”，添加连接、模型并保存 Token。",
        reportable: false,
      });
      return;
    }

    const generationLock = beginGeneration(activeNode.id);
    if (!generationLock.ok) {
      setNotice(generationLock.activeNodeId === activeNode.id ? "当前节点正在生成，请等待完成后再点击。" : "已有场景正在生成，请等待当前生成完成后再点击。", "warning");
      return;
    }

    setIsEnrichingCurrentScene(true);
    try {
      const memoryMode = activeNode.data.memoryMode ?? globalMemoryMode;
      const editorContextPackage = buildEditorGenerationContextPackage({
        currentNodeId: activeNode.id,
        contextNodeId: activeNode.id,
        nodes,
        edges,
        memoryMode,
        providerSelection,
      });
      addGenerationTrace({
        id: `context_budget_${Date.now()}`,
        time: new Date().toISOString(),
        phase: "context_budget",
        level: editorContextPackage.report.compression_triggered ? "warning" : "info",
        title: "Context budget prepared",
        message: editorContextPackage.report.compression_triggered
          ? "Editor blueprint context exceeded the model budget and was compressed before enriching the current node."
          : "Editor blueprint context fits inside the current model budget.",
        details: editorContextPackage.report as unknown as Record<string, unknown>,
      });
      if (editorContextPackage.report.compression_triggered) {
        setGenerationDebugStatus("上下文超过预算，已压缩远端场景并保留当前节点。");
      }
      const generated = await backendClient.generateSceneStream(
        {
          current_scene: JSON.stringify(scene),
          target_scene_stub: JSON.stringify({
            ...scene,
            summary: outline,
            commands: [],
          }),
          previous_summary: buildPreviousSummary(activeNode.id, nodes, edges),
          author_goal: [
            activeNode.data.aiSettings.authorGoal,
            "请不要生成后续新场景。请根据 generation_outline 丰富当前场景本身：补全标题、摘要、旁白、对白、背景/音乐/镜头等命令，并保持原 scene_id 与章节编号不变。",
            "保留当前场景中所有仍然合法的事件及其完整字段（包括样式、转场、动画、图层、缩放、条件、状态类型和结构化运镜）；除非 generation_outline 明确要求替换，否则只补充或有针对性地修改，不要把已有丰富字段降级为简化命令。",
          ].filter(Boolean).join("\n"),
          generation_outline: outline,
          editor_context: editorContextPackage.context,
          memory_mode: memoryMode,
          chapter: scene.chapter,
          provider_selection: providerSelection,
        },
        {
          onStatus: setGenerationDebugStatus,
          onDelta: appendGenerationDecisionDelta,
          onTrace: addGenerationTrace,
        },
      );
      const applied = applyGeneratedSceneToNode(activeNode.id, generated, { preserveSceneId: true, preserveChapter: true, generatedFromNodeId: activeNode.id });
      setNotice(applied.replaced ? "已根据大纲丰富当前节点内容，没有创建新节点。" : "生成完成，但未能写入当前节点，请检查节点状态。", applied.replaced ? "success" : "warning");
    } catch (error) {
      reportFrontendError("editor.scene-generation", error, {
        operation: "enrich-current-scene",
        sceneId: activeNode.id,
      });
      setNotice({
        tone: "error",
        source: "AI Generation",
        message: `丰富当前节点失败：${error instanceof Error ? error.message : "AI 生成失败"}`,
        error,
        action: "检查模型连接、Token、Base URL 与后端日志后重试。",
        context: { nodeId: activeNode.id, sceneId: scene.scene_id },
      });
    } finally {
      endGeneration(generationLock.token);
      setIsEnrichingCurrentScene(false);
    }
  }

  const loadingAnimation = activeNode.data.loadingAnimation ?? { kind: "default" as const };
  const loadingVideoAsset = loadingAnimation.kind === "video"
    ? assetManifest.find((asset) => asset.asset_id === loadingAnimation.video_asset_id)
    : undefined;
  const loadingImageAssets = loadingAnimation.kind === "image_sequence"
    ? loadingAnimation.image_asset_ids.map((assetId) => assetManifest.find((asset) => asset.asset_id === assetId))
    : [];

  function updateLoadingAnimation(next: LoadingAnimationConfig) {
    updateNodeData(activeNode.id, { loadingAnimation: next });
  }

  function setLoadingAnimationMode(kind: LoadingAnimationConfig["kind"]) {
    if (kind === "default") {
      updateLoadingAnimation({ kind: "default" });
      return;
    }
    if (kind === "video") {
      updateLoadingAnimation({ kind: "video", video_asset_id: loadingAnimation.kind === "video" ? loadingAnimation.video_asset_id : "" });
      return;
    }
    updateLoadingAnimation({
      kind: "image_sequence",
      image_asset_ids: loadingAnimation.kind === "image_sequence" ? loadingAnimation.image_asset_ids : [],
      frame_duration_ms: loadingAnimation.kind === "image_sequence" ? loadingAnimation.frame_duration_ms ?? 1000 : 1000,
    });
  }

  async function importLoadingVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isVideoFile(file)) {
      setNotice("请选择视频文件作为载入动画。", "warning");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const usedIds = new Set(assetManifest.map((asset) => asset.asset_id));
      const assetId = uniqueAssetId(`loading_video_${fileStem(file.name)}`, usedIds);
      const asset = loadingAssetFromFile(file, dataUrl, "video", assetId);
      setAssetManifest([asset, ...assetManifest.filter((item) => item.asset_id !== asset.asset_id)]);
      updateLoadingAnimation({ kind: "video", video_asset_id: asset.asset_id });
      setNotice("载入动画视频已导入。", "success");
    } catch (error) {
      reportFrontendError("editor.loading-animation", error, {
        operation: "import-video",
        fileName: file.name,
      });
      setNotice(error instanceof Error ? error.message : "导入视频失败", "error");
    }
  }

  async function importLoadingImages(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length === 0) {
      setNotice("请选择图片文件作为载入动画帧。", "warning");
      return;
    }
    try {
      const usedIds = new Set(assetManifest.map((asset) => asset.asset_id));
      const importedAssets: AssetRef[] = [];
      for (const [index, file] of imageFiles.entries()) {
        const dataUrl = await readFileAsDataUrl(file);
        const assetId = uniqueAssetId(`loading_image_${index + 1}_${fileStem(file.name)}`, usedIds);
        usedIds.add(assetId);
        importedAssets.push(loadingAssetFromFile(file, dataUrl, "ui", assetId));
      }
      const importedIds = new Set(importedAssets.map((asset) => asset.asset_id));
      setAssetManifest([...importedAssets, ...assetManifest.filter((item) => !importedIds.has(item.asset_id))]);
      updateLoadingAnimation({
        kind: "image_sequence",
        image_asset_ids: [
          ...(loadingAnimation.kind === "image_sequence" ? loadingAnimation.image_asset_ids : []),
          ...importedAssets.map((asset) => asset.asset_id),
        ],
        frame_duration_ms: loadingAnimation.kind === "image_sequence" ? loadingAnimation.frame_duration_ms ?? 1000 : 1000,
      });
      setNotice(`已导入 ${importedAssets.length} 张载入动画图片。`, "success");
    } catch (error) {
      reportFrontendError("editor.loading-animation", error, {
        operation: "import-images",
        fileCount: files.length,
      });
      setNotice(error instanceof Error ? error.message : "导入图片失败", "error");
    }
  }

  function updateImageFrameDuration(value: number) {
    if (loadingAnimation.kind !== "image_sequence") return;
    updateLoadingAnimation({
      ...loadingAnimation,
      frame_duration_ms: Math.max(100, Math.round(value || 1000)),
    });
  }

  function addLoadingImageAsset(assetId: string) {
    if (!assetId.trim()) return;
    const current = loadingAnimation.kind === "image_sequence" ? loadingAnimation : { kind: "image_sequence" as const, image_asset_ids: [], frame_duration_ms: 1000 };
    updateLoadingAnimation({
      ...current,
      image_asset_ids: [...current.image_asset_ids, assetId],
      frame_duration_ms: current.frame_duration_ms ?? 1000,
    });
    setLoadingImageToAddId("");
  }

  function removeLoadingImage(assetId: string) {
    if (loadingAnimation.kind !== "image_sequence") return;
    updateLoadingAnimation({
      ...loadingAnimation,
      image_asset_ids: loadingAnimation.image_asset_ids.filter((item) => item !== assetId),
    });
  }

  return (
    <aside className={`inspector-panel${panelPhase === "closing" ? " is-node-closing" : ""}`}>
      <header>
        <div>
          <span className="panel-kicker">{nodeKindLabels[activeNode.data.nodeKind] ?? "节点"}</span>
          <strong>{activeNode.data.label}</strong>
        </div>
        <div className="row-actions">
          <button type="button" aria-label="节点说明" title="节点说明" data-help-key={nodeHelpKey}>
            <HelpCircle size={14} />
          </button>
          <button type="button" aria-label="复制节点" data-help-key="inspector.duplicateNode" onClick={() => duplicateNode(activeNode.id)}>
            <Copy size={14} />
          </button>
          <button type="button" aria-label="删除节点" data-help-key="inspector.deleteNode" onClick={() => deleteNode(activeNode.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      {activeNode.data.nodeKind === "scene" && activeNode.data.scene && (
        <div className="inspector-section">
          {aiSource && (
            <div className={`inspector-source-card ${activeNode.data.editorMeta?.source === "ai_edited" ? "is-edited" : ""} ${activeNode.data.editorMeta?.source === "imported" ? "is-imported" : ""} ${activeNode.data.editorMeta?.source === "ai_generated" ? "ai-glow-surface ai-flow-border" : ""}`}>
              <Sparkles size={16} />
              <div>
                <strong>来源：{aiSource}</strong>
                {generatedAt && <span>生成时间：{generatedAt}</span>}
              </div>
            </div>
          )}
          {sceneAssetAudit && sceneAssetAudit.pending.length > 0 && (
            <section className="inspector-asset-audit">
              <header>
                <strong>待补视觉资产</strong>
                <span>{sceneAssetAudit.pending.filter((item) => !item.optional).length} 项必补 / {sceneAssetAudit.optional_audio_performance.length} 项可选</span>
              </header>
              <div className="inspector-asset-audit-list">
                {sceneAssetAudit.pending.slice(0, 8).map((item) => (
                  <article key={item.id} className={item.optional ? "is-optional" : item.placeholder ? "is-placeholder" : ""}>
                    <span>{item.optional ? "可选" : item.placeholder ? "占位" : "缺失"}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.character_id ? `${item.character_id} · ` : ""}{item.asset_id ?? assetTypeDisplayLabel(item.asset_type ?? item.kind)}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          <label>
            场景稳定索引 ID <FieldHelp field="scene_id" />
            <input value={activeNode.data.scene.scene_id} data-help-key="field.scene_id" readOnly />
          </label>
          <label>
            场景中文代称 <FieldHelp field="scene_display_name" />
            <input
              value={activeNode.data.scene.scene_display_name ?? ""}
              data-help-key="field.scene_display_name"
              placeholder="例如：雨夜车站、告白前夜"
              onChange={(event) =>
                updateNodeData(activeNode.id, {
                  scene: { ...activeNode.data.scene!, scene_display_name: event.target.value || null },
                })
              }
            />
          </label>
          <label>
            场景标题 <FieldHelp field="title" />
            <input
              value={activeNode.data.scene.title}
              data-help-key="field.title"
              onChange={(event) => updateNodeData(activeNode.id, { scene: { ...activeNode.data.scene!, title: event.target.value } })}
            />
          </label>
          <label>
            场景摘要 <FieldHelp field="summary" />
            <textarea
              value={activeNode.data.scene.summary}
              data-help-key="field.summary"
              onChange={(event) => updateNodeData(activeNode.id, { scene: { ...activeNode.data.scene!, summary: event.target.value } })}
            />
          </label>
          <label>
            章节编号 <FieldHelp field="chapter" />
            <input
              type="number"
              value={activeNode.data.scene.chapter}
              data-help-key="field.chapter"
              onChange={(event) => updateNodeData(activeNode.id, { scene: { ...activeNode.data.scene!, chapter: Number(event.target.value) } })}
            />
          </label>
          <label>
            标签 <FieldHelp field="tags" />
            <input
              value={activeNode.data.scene.tags.join(",")}
              data-help-key="field.tags"
              onChange={(event) =>
                updateNodeData(activeNode.id, {
                  scene: {
                    ...activeNode.data.scene!,
                    tags: event.target.value
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </label>
          <MemoryModeSelector value={activeNode.data.memoryMode ?? "hybrid"} onChange={(mode) => updateMemoryMode(mode, activeNode.id)} />
          <label>
            作者目标 <FieldHelp field="authorGoal" />
            <textarea
              value={activeNode.data.aiSettings.authorGoal}
              data-help-key="field.authorGoal"
              onChange={(event) =>
                updateNodeData(activeNode.id, {
                  aiSettings: { ...activeNode.data.aiSettings, authorGoal: event.target.value },
                })
              }
            />
          </label>
          <section className="generation-outline-card ai-glow-surface ai-flow-border" data-help-key="field.generationOutline">
            <div>
              <strong>下一步生成大纲</strong>
              <span>留空则由模型根据上下文自由决策；填写后会作为高优先级创作方向传给模型。</span>
            </div>
            <textarea
              value={activeNode.data.aiSettings.generationOutline ?? ""}
              data-help-key="field.generationOutline"
              placeholder="例如：下一章跳到三年后，主角回到旧车站，先用旁白铺垫变化，再让林澈出现。"
              onChange={(event) =>
                updateNodeData(activeNode.id, {
                  aiSettings: { ...activeNode.data.aiSettings, generationOutline: event.target.value },
                })
              }
            />
          </section>
          <button
            type="button"
            className={`ai-glow-button${isEnrichingCurrentScene ? " ai-flow-active" : ""}`}
            data-help-key="scene.enrichCurrent"
            disabled={isEnrichingCurrentScene || Boolean(activeGeneration)}
            onClick={() => void enrichCurrentSceneFromOutline()}
          >
            <Sparkles size={15} />
            {isEnrichingCurrentScene ? "正在丰富当前节点..." : "根据当前大纲丰富节点内容"}
          </button>
          <label className="check-row">
            <input
              type="checkbox"
              data-help-key="field.autoExtractMemory"
              checked={activeNode.data.aiSettings.autoExtractMemory}
              onChange={(event) =>
                updateNodeData(activeNode.id, {
                  aiSettings: { ...activeNode.data.aiSettings, autoExtractMemory: event.target.checked },
                })
              }
            />
            自动提取记忆
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              data-help-key="field.autoApplyMemory"
              checked={activeNode.data.aiSettings.autoApplyMemory}
              onChange={(event) =>
                updateNodeData(activeNode.id, {
                  aiSettings: { ...activeNode.data.aiSettings, autoApplyMemory: event.target.checked },
                })
              }
            />
            自动应用记忆
          </label>
          <section className={`inspector-secondary-panel command-workbench-launcher${workbenchOpen ? " is-open" : ""}`}>
            <div>
              <strong>事件工作台</strong>
              <p>{workbenchOpen ? "悬浮工作台已打开；可最小化以专注编辑当前场景事件。" : "工作台已最小化，右侧场景事件编辑会继续保留。"}</p>
            </div>
            <button type="button" data-help-key="workbench.commandType" onClick={() => setWorkbenchOpen((current) => !current)}>
              {workbenchOpen ? "隐藏工作台" : "打开工作台"}
            </button>
          </section>
          {workbenchOpen && (
            <FloatingCommandWorkbench
              onAdd={(command) => updateSceneCommands(activeNode.id, [...activeNode.data.scene!.commands, command])}
              onOpenCameraStudio={() => {
                setWorkbenchOpen(false);
                setWorkbenchCameraOpen(true);
              }}
              onClose={() => startClosing("workbench-close")}
              onMinimize={handleWorkbenchMinimize}
              isClosing={panelPhase === "closing"}
            />
          )}
          <CommandListEditor
            commands={activeNode.data.scene.commands}
            sceneId={activeNode.data.scene.scene_id}
            variableKeys={stateVariableKeys}
            sceneIds={runtimeSceneIds}
            onChange={(commands) => updateSceneCommands(activeNode.id, commands)}
          />
          {workbenchCameraOpen && (
            <CameraStudioDialog
              command={createDefaultCameraCommand(
                "reframe",
                currentPoseBeforeList(activeNode.data.scene.commands, activeNode.data.scene.commands.length),
              )}
              commands={activeNode.data.scene.commands}
              commandIndex={activeNode.data.scene.commands.length}
              sceneId={activeNode.data.scene.scene_id}
              inserting
              onApply={(command) => {
                updateSceneCommands(activeNode.id, [...activeNode.data.scene!.commands, command]);
                setWorkbenchCameraOpen(false);
                setWorkbenchOpen(true);
              }}
              onClose={() => {
                setWorkbenchCameraOpen(false);
                setWorkbenchOpen(true);
              }}
            />
          )}
          <GenerationDebugPanel />
        </div>
      )}

      {activeNode.data.nodeKind === "choice" && activeNode.data.choice && (
        <div className="inspector-section">
          <section className="inspector-secondary-panel">
            <div>
              <strong>选项分支</strong>
              <p>这里的选项会作为独立节点导出。你可以从每个选项手柄连到不同场景，也可以保留目标场景编号手动填写。</p>
            </div>
          </section>
          <ChoiceCommandEditor
            command={activeNode.data.choice}
            variableKeys={stateVariableKeys}
            onChange={(choice) => updateNodeData(activeNode.id, { choice })}
          />
          <JsonPreview value={activeNode.data.choice} />
        </div>
      )}

      {activeNode.data.nodeKind === "modifier" && (
        <div className="inspector-section">
          <StateUpdateCommandEditor
            command={activeNode.data.stateUpdate as StateUpdateCommand}
            onChange={(stateUpdate) => updateNodeData(activeNode.id, { stateUpdate })}
          />
          <JsonPreview value={activeNode.data.stateUpdate} />
        </div>
      )}

      {activeNode.data.nodeKind === "condition" && (
        <div className="inspector-section">
          <section className="inspector-secondary-panel condition-helper-card">
            <div>
              <strong>条件节点会决定两条出口</strong>
              <p>满足条件时走 true 出口，不满足时走 false 出口。建议用变量、判断方式和值来构建条件，减少手写表达式出错。</p>
            </div>
          </section>
          <ConditionBuilderEditor
            condition={activeNode.data.condition}
            variableKeys={stateVariableKeys}
            onChange={(condition) => updateNodeData(activeNode.id, { condition })}
          />
          <JsonPreview value={activeNode.data.condition} />
        </div>
      )}

      {false && (activeNode as EditorNode).data.nodeKind === "condition" && (
        <div className="inspector-section">
          <label>
            条件表达式
            <input
              value={activeNode.data.condition?.expression ?? ""}
              data-help-key="field.conditionExpression"
              onChange={(event) =>
                updateNodeData(activeNode.id, {
                  condition: { ...(activeNode.data.condition ?? { trueLabel: "true", falseLabel: "false" }), expression: event.target.value },
                })
              }
            />
          </label>
          <label>
            满足条件出口
            <input
              value={activeNode.data.condition?.trueLabel ?? "true"}
              data-help-key="field.trueLabel"
              onChange={(event) =>
                updateNodeData(activeNode.id, {
                  condition: { ...(activeNode.data.condition ?? { expression: "", falseLabel: "false" }), trueLabel: event.target.value },
                })
              }
            />
          </label>
          <label>
            不满足条件出口
            <input
              value={activeNode.data.condition?.falseLabel ?? "false"}
              data-help-key="field.falseLabel"
              onChange={(event) =>
                updateNodeData(activeNode.id, {
                  condition: { ...(activeNode.data.condition ?? { expression: "", trueLabel: "true" }), falseLabel: event.target.value },
                })
              }
            />
          </label>
          <JsonPreview value={activeNode.data.condition} />
        </div>
      )}



      {activeNode.data.nodeKind === "loop" && activeNode.data.loop && (
        <div className="inspector-section loop-inspector">
          <section className="loop-guide-card" data-help-key="node.loop">
            <header>
              <Repeat2 size={18} />
              <div>
                <strong>让一段剧情重复执行</strong>
                <p>这个节点会决定接下来是“再做一次”，还是“重复完成后继续剧情”。只想重复固定次数时，直接选择下方方案即可。</p>
              </div>
            </header>
            <ol className="loop-flow-steps">
              <li><span>1</span><div><strong>记住已经做了几次</strong><small>系统用“{activeNode.data.loop.variableKey || "次数记录"}”保存进度，返回这里时不会从头清零。</small></div></li>
              <li><span>2</span><div><strong>每回来一次就更新记录</strong><small>当前设置：把记录的数字 {activeNode.data.loop.step >= 0 ? "增加" : "减少"} {Math.abs(activeNode.data.loop.step)}。</small></div></li>
              <li><span>3</span><div><strong>决定是再做一次还是结束</strong><small>检查“{readableLoopCondition(activeNode.data.loop)}”；满足时再做一次，不满足时继续后面的剧情。</small></div></li>
            </ol>
          </section>

          <section className="loop-preset-panel">
            <div className="loop-section-heading">
              <div>
                <strong><WandSparkles size={15} /> 先选择最接近的重复方式</strong>
                <span>零基础用户建议从这里开始。选择后，系统会自动填好下面的大部分内容。</span>
              </div>
            </div>
            <div className="loop-preset-actions" role="group" aria-label="选择剧情重复方式">
              <button type="button" onClick={() => applyFixedLoopPreset(3)}>重复 3 次（推荐）</button>
              <button type="button" onClick={() => applyFixedLoopPreset(5)}>重复 5 次</button>
              <button type="button" onClick={applyFlagLoopPreset}>直到某件事完成</button>
            </div>
          </section>

          <fieldset className="loop-config-card">
            <legend>1. 设置“已经做了几次”的记录方式</legend>
            <p>使用固定次数方案时，下面三个设置通常保持默认即可。</p>
            <div className="loop-counter-grid">
              <label>
                次数记录名称
                <input
                  data-help-key="field.loop.variableKey"
                  value={activeNode.data.loop.variableKey}
                  placeholder="例如：search_count（搜索次数）"
                  onChange={(event) => updateNodeData(activeNode.id, {
                    loop: {
                      ...activeNode.data.loop!,
                      variableKey: event.target.value,
                      continueCondition: activeNode.data.loop!.continueCondition.key === activeNode.data.loop!.variableKey
                        ? { ...activeNode.data.loop!.continueCondition, key: event.target.value }
                        : activeNode.data.loop!.continueCondition,
                    },
                  })}
                />
                <small>这是系统保存进度时使用的名称。建议用英文和下划线，例如 search_count；同一项目内不要重名。</small>
              </label>
              <label>
                开始前记作几次
                <input type="number" data-help-key="field.loop.initialValue" value={activeNode.data.loop.initialValue} onChange={(event) => updateNodeData(activeNode.id, { loop: { ...activeNode.data.loop!, initialValue: Number(event.target.value) } })} />
                <small>填 0 表示开始前还没有执行过；一般不用修改。</small>
              </label>
              <label>
                每完成一轮增加多少
                <input type="number" data-help-key="field.loop.step" value={activeNode.data.loop.step} onChange={(event) => updateNodeData(activeNode.id, { loop: { ...activeNode.data.loop!, step: Number(event.target.value) } })} />
                <small>通常填 1。只有倒数时才填负数；填 0 会让记录一直停在同一个数字。</small>
              </label>
            </div>
          </fieldset>

          <div className="loop-section-heading">
            <div>
              <strong>2. 设置“什么时候再做一次”</strong>
              <span>把下面的判断补成一句话：满足时再做一次，不满足时结束重复。</span>
            </div>
          </div>
          <ConditionBuilderEditor
            condition={{ expression: activeNode.data.loop.variableKey, mode: "builder", key: activeNode.data.loop.continueCondition.key, operator: activeNode.data.loop.continueCondition.operator, value: activeNode.data.loop.continueCondition.value, valueType: loopConditionValueType(activeNode.data.loop), trueLabel: activeNode.data.loop.loopLabel, falseLabel: activeNode.data.loop.exitLabel }}
            variableKeys={stateVariableKeys}
            datalistId={`loop-condition-variable-candidates-${activeNode.id}`}
            copyVariant="beginner-loop"
            onChange={(condition) => updateNodeData(activeNode.id, { loop: { ...activeNode.data.loop!, continueCondition: { key: condition.key || activeNode.data.loop!.variableKey, operator: condition.operator || "less_than", value: condition.value }, loopLabel: condition.trueLabel, exitLabel: condition.falseLabel } })}
          />

          <section className={`loop-preview-card${activeNode.data.loop.step === 0 || loopPassEstimate?.mayNotExit ? " is-warning" : ""}`} aria-live="polite">
            <header>
              <strong>3. 确认结果并连接两条路线</strong>
              {activeNode.data.loop.step === 0 && <span>“每完成一轮增加多少”不能为 0</span>}
              {activeNode.data.loop.step !== 0 && loopPassEstimate && !loopPassEstimate.mayNotExit && <span>按当前设置，会重复 {loopPassEstimate.count} 次</span>}
              {activeNode.data.loop.step !== 0 && loopPassEstimate?.mayNotExit && <span>当前设置可能会一直重复，无法结束</span>}
              {activeNode.data.loop.step !== 0 && !loopPassEstimate && <span>重复次数由剧情中的记录决定</span>}
            </header>
            <p>
              每次回到这里，系统会把 <code>{activeNode.data.loop.variableKey || "次数记录"}</code>
              {activeNode.data.loop.step >= 0 ? " 增加 " : " 减少 "}<code>{Math.abs(activeNode.data.loop.step)}</code>，
              然后检查“{readableLoopCondition(activeNode.data.loop)}”。满足就再做一次，不满足就结束重复。
            </p>
            <div className="loop-connection-checks">
              <div className={loopContinueTarget ? "is-complete" : ""}>
                {loopContinueTarget ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                <span><strong>{activeNode.data.loop.loopLabel || "再做一次"}</strong><small>{loopContinueTarget ? `已连接到「${loopContinueTarget}」` : "从节点底部左边的圆点，拖到需要重复的第一个场景。"}</small></span>
              </div>
              <div className={loopExitTarget ? "is-complete" : ""}>
                {loopExitTarget ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                <span><strong>{activeNode.data.loop.exitLabel || "重复完成，继续剧情"}</strong><small>{loopExitTarget ? `已连接到「${loopExitTarget}」` : "从节点底部右边的圆点，拖到重复结束后的第一个场景。"}</small></span>
              </div>
            </div>
            <p className="loop-return-reminder"><Repeat2 size={14} /> 最后一步：把需要重复的最后一个场景连回本节点，否则这段剧情只会执行一次。</p>
          </section>
          <JsonPreview value={activeNode.data.loop} />
        </div>
      )}

      {activeNode.data.nodeKind === "animation" && (
        <div className="inspector-section">
          <section className="legacy-animation-migration-panel">
            <header>
              <strong>旧版独立动画节点</strong>
              <span>新作品请在场景事件中添加动画。这个旧节点仍可编辑和导出。</span>
            </header>
            {legacyAnimationNodeCount > 1 && (
              <div className="legacy-animation-batch-migration">
                <p>
                  当前工程共有 {legacyAnimationNodeCount} 个旧版动画节点。
                  批量转换前会先创建项目时间线备份，整次操作只占用一个撤销记录。
                </p>
                <button
                  type="button"
                  disabled={isBatchMigratingAnimations}
                  onClick={() => void migrateAllLegacyAnimationNodes()}
                >
                  {isBatchMigratingAnimations ? "正在备份…" : `批量转换全部 ${legacyAnimationNodeCount} 个`}
                </button>
              </div>
            )}
            {animationMigration && (
              <>
                <p>
                  当前连接：前方 {animationMigration.predecessorCount} 条，后方 {animationMigration.successorCount} 条
                  {animationMigration.bypassPathCount > 0 ? `，另有 ${animationMigration.bypassPathCount} 条路线会绕过这个动画` : ""}。
                </p>
                <div>
                  <button
                    type="button"
                    disabled={!animationMigration.canPrepend}
                    onClick={() => {
                      if (
                        animationMigration.prependAffectedPathCount > 0
                        && !window.confirm(
                          `移到后续场景开头后，会有 ${animationMigration.prependAffectedPathCount} 条原本绕过动画的路线也播放它。确定这样转换吗？`,
                        )
                      ) return;
                      migrateAnimationNode(activeNode.id, "prepend_successor");
                    }}
                  >
                    移到后续场景开头
                    {animationMigration.prependAffectedPathCount > 0
                      ? `（影响 ${animationMigration.prependAffectedPathCount} 条路线）`
                      : ""}
                  </button>
                  <button
                    type="button"
                    disabled={!animationMigration.canAppend}
                    onClick={() => {
                      if (
                        animationMigration.appendAffectedPathCount > 0
                        && !window.confirm(
                          `移到前置场景末尾后，会有 ${animationMigration.appendAffectedPathCount} 条原本不经过动画的出口也播放它。确定这样转换吗？`,
                        )
                      ) return;
                      migrateAnimationNode(activeNode.id, "append_predecessor");
                    }}
                  >
                    移到前置场景末尾
                    {animationMigration.appendAffectedPathCount > 0
                      ? `（影响 ${animationMigration.appendAffectedPathCount} 条路线）`
                      : ""}
                  </button>
                  <button type="button" onClick={() => migrateAnimationNode(activeNode.id, "convert_scene")}>
                    原地转成普通场景
                  </button>
                </div>
                {!animationMigration.safePrepend && !animationMigration.safeAppend && (
                  <p className="is-warning">
                    当前分支较复杂。你可以确认受影响路线后选择相邻落点；如果不想改变任何路线，请使用“原地转成普通场景”，它会保留编号、位置和全部连线。
                  </p>
                )}
              </>
            )}
          </section>
          <AnimationCommandEditor
            command={activeNode.data.animation as AnimationCommand}
            onChange={(animation) => updateNodeData(activeNode.id, { animation })}
          />
          <JsonPreview value={activeNode.data.animation} />
        </div>
      )}

      {activeNode.data.nodeKind === "start" && (
        <div className="inspector-section">
          <p>入口节点是项目入口。导出时会从该节点的第一条连线确定玩家开始播放的位置。</p>
          <section className="loading-animation-panel" data-help-key="start.loadingAnimation">
            <header>
              <div>
                <strong>载入动画</strong>
                <span>默认使用编辑器启动时的圆环；也可以导入视频或多张图片作为 GameCLI 启动动画。</span>
              </div>
            </header>
            <div className="loading-animation-mode" role="group" aria-label="载入动画类型">
              <button
                type="button"
                className={loadingAnimation.kind === "default" ? "is-active" : ""}
                aria-pressed={loadingAnimation.kind === "default"}
                data-help-key="start.loadingAnimation.default"
                onClick={() => setLoadingAnimationMode("default")}
              >
                默认圆环
              </button>
              <button
                type="button"
                className={loadingAnimation.kind === "video" ? "is-active" : ""}
                aria-pressed={loadingAnimation.kind === "video"}
                data-help-key="start.loadingAnimation.video"
                onClick={() => setLoadingAnimationMode("video")}
              >
                <Film size={14} /> 视频
              </button>
              <button
                type="button"
                className={loadingAnimation.kind === "image_sequence" ? "is-active" : ""}
                aria-pressed={loadingAnimation.kind === "image_sequence"}
                data-help-key="start.loadingAnimation.imageSequence"
                onClick={() => setLoadingAnimationMode("image_sequence")}
              >
                <ImagePlus size={14} /> 多图
              </button>
            </div>

            {loadingAnimation.kind === "video" && (
              <div className="loading-animation-editor">
                <AssetPicker
                  label="当前视频素材"
                  field="loading_animation.video_asset_id"
                  value={loadingAnimation.video_asset_id}
                  allowedTypes={["video"]}
                  helpKey="start.loadingAnimation.videoAsset"
                  emptyLabel="暂无可用视频素材"
                  onChange={(assetId) => updateLoadingAnimation({ kind: "video", video_asset_id: assetId })}
                />
                <label className="loading-animation-import" data-help-key="start.loadingAnimation.videoImport">
                  <input type="file" accept="video/*,.mp4,.webm,.mov,.m4v,.ogv" onChange={(event) => void importLoadingVideo(event)} />
                  <UploadCloud size={15} /> 导入视频
                </label>
              </div>
            )}

            {loadingAnimation.kind === "image_sequence" && (
              <div className="loading-animation-editor">
                <div className="loading-animation-picker-row">
                  <AssetPicker
                    label="添加图片帧"
                    field="loading_animation.image_asset_ids"
                    value={loadingImageToAddId}
                    allowedTypes={["ui", "background"]}
                    helpKey="start.loadingAnimation.imageAsset"
                    emptyLabel="暂无可用图片帧素材"
                    onChange={setLoadingImageToAddId}
                  />
                  <button type="button" data-help-key="start.loadingAnimation.addFrame" disabled={!loadingImageToAddId} onClick={() => addLoadingImageAsset(loadingImageToAddId)}>
                    添加为帧
                  </button>
                </div>
                <label className="loading-animation-import" data-help-key="start.loadingAnimation.imageImport">
                  <input type="file" accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg" multiple onChange={(event) => void importLoadingImages(event)} />
                  <UploadCloud size={15} /> 导入图片
                </label>
                <label className="loading-animation-duration">
                  切换时间（毫秒）
                  <input
                    type="number"
                    data-help-key="start.loadingAnimation.frameDuration"
                    min={100}
                    step={100}
                    value={loadingAnimation.frame_duration_ms ?? 1000}
                    onChange={(event) => updateImageFrameDuration(Number(event.target.value))}
                  />
                </label>
                <div className="loading-animation-frame-list">
                  {loadingAnimation.image_asset_ids.length === 0 ? (
                    <p>尚未导入图片帧；导入多张图片后默认每 1 秒切换一张。</p>
                  ) : (
                    loadingAnimation.image_asset_ids.map((assetId, index) => {
                      const asset = loadingImageAssets[index];
                      const src = asset?.metadata.data_url ?? asset?.metadata.blob_url ?? asset?.metadata.url;
                      return (
                        <article key={`${assetId}_${index}`} className="loading-animation-frame">
                          {src ? <img src={src} alt={assetId} /> : <span>{index + 1}</span>}
                          <div>
                            <strong>{assetDisplayName(asset, assetId)}</strong>
                            <small>{assetId}</small>
                          </div>
                          <button type="button" data-help-key="start.loadingAnimation.removeFrame" aria-label="移除图片帧" title="移除图片帧" onClick={() => removeLoadingImage(assetId)}>
                            <X size={14} />
                          </button>
                        </article>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </section>
          <JsonPreview value={activeNode.data} />
        </div>
      )}

      {activeNode.data.nodeKind === "end" && (
        <div className="inspector-section">
          <label>
            结局编号
            <input
              value={activeNode.data.ending?.ending_id ?? ""}
              data-help-key="field.endingId"
              onChange={(event) =>
                updateNodeData(activeNode.id, {
                  ending: { ...(activeNode.data.ending ?? { ending_title: "" }), ending_id: event.target.value },
                })
              }
            />
          </label>
          <label>
            结局标题
            <input
              value={activeNode.data.ending?.ending_title ?? ""}
              data-help-key="field.endingTitle"
              onChange={(event) =>
                updateNodeData(activeNode.id, {
                  ending: { ...(activeNode.data.ending ?? { ending_id: "" }), ending_title: event.target.value },
                })
              }
            />
          </label>
          <JsonPreview value={activeNode.data.ending} />
        </div>
      )}
    </aside>
  );
}
