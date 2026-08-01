import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Sparkles } from "lucide-react";
import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { backendClient } from "../../api/backendClient";
import { requestAdvancedTools } from "../advanced/advancedToolsBridge";
import { getProviderSelectionPayload } from "../../providers/providerRegistry";
import type { ProviderSelectionPayload } from "../../providers/types";
import { useEditorStore } from "../../store/editorStore";
import type { Choice } from "../../types/commands";
import type { EditorEdge, EditorNode } from "../../types/nodes";
import type { SceneBeat } from "../../types/scene";
import { buildPreviousSummary } from "../../utils/graphTraversal";
import { buildEditorGenerationContextPackage } from "../../utils/generationContext";
import { commandsToText } from "../../utils/commandPreview";
import type { MemoryMode } from "../../types/memory";
import { choiceDisplayLabel, sceneDisplayLabel } from "../../utils/displayNames";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

const memoryModeLabels: Record<MemoryMode, string> = {
  none: "不启用记忆",
  chronicle_graph_only: "客观记忆",
  emotion_trace_only: "情感记忆",
  hybrid: "混合记忆",
};

const blankSceneTitles = new Set(["", "新场景", "鏂板満鏅?"]);
const blankSceneSummaries = new Set(["", "描述这个场景的剧情目的。", "在右侧检查器编辑场景标题、摘要、章节和剧情指令。"]);

function isBlankScene(scene: SceneBeat): boolean {
  return scene.commands.length === 0 && blankSceneTitles.has(scene.title.trim()) && blankSceneSummaries.has(scene.summary.trim());
}

function findIncomingSceneContext(nodeId: string, nodes: EditorNode[], edges: EditorEdge[]): { nodeId: string; scene: SceneBeat } | undefined {
  const incoming = edges.find((edge) => edge.target === nodeId && (!edge.targetHandle || edge.targetHandle === "default"));
  if (!incoming) return undefined;
  const source = nodes.find((node) => node.id === incoming.source);
  if (source?.data.nodeKind !== "scene" || !source.data.scene) return undefined;
  return { nodeId: source.id, scene: source.data.scene };
}

function sceneIdsFromNodes(nodes: EditorNode[]): Set<string> {
  return new Set(nodes.map((node) => node.data.scene?.scene_id).filter((sceneId): sceneId is string => Boolean(sceneId)));
}

function sceneIdForTargetNode(node: EditorNode | undefined): string {
  return node?.data.scene?.scene_id ?? "";
}

function isChoiceLinked(sourceNodeId: string, choice: Choice, nodes: EditorNode[], edges: EditorEdge[]): boolean {
  const sceneIds = sceneIdsFromNodes(nodes);
  if (choice.target_scene_id && sceneIds.has(choice.target_scene_id)) return true;
  const edge = edges.find((item) => item.source === sourceNodeId && item.sourceHandle === choice.choice_id);
  return Boolean(edge && sceneIdForTargetNode(nodes.find((node) => node.id === edge.target)));
}

function choicesFromScene(scene: SceneBeat): Choice[] {
  return scene.commands
    .filter((command) => command.type === "choice")
    .flatMap((command) => command.choices);
}

function collectUnlinkedBranchChoices(sourceNodeId: string, choices: Choice[], nodes: EditorNode[], edges: EditorEdge[]): Choice[] {
  return choices
    .filter((choice) => choice.choice_id.trim() && !isChoiceLinked(sourceNodeId, choice, nodes, edges));
}

function defaultSuccessorNode(sourceNodeId: string, nodes: EditorNode[], edges: EditorEdge[]): EditorNode | undefined {
  const edge = edges.find((item) => item.source === sourceNodeId && (!item.sourceHandle || item.sourceHandle === "default"));
  return edge ? nodes.find((node) => node.id === edge.target) : undefined;
}

function findBranchEntryPoint(sourceNodeId: string, scene: SceneBeat, nodes: EditorNode[], edges: EditorEdge[]): {
  sourceNodeId: string;
  choices: Choice[];
  sourceLabel: string;
  viaChoiceNode: boolean;
} {
  const sceneChoices = choicesFromScene(scene);
  if (sceneChoices.length > 0) {
    return {
      sourceNodeId,
      choices: sceneChoices,
      sourceLabel: sceneDisplayLabel(scene),
      viaChoiceNode: false,
    };
  }

  const successor = defaultSuccessorNode(sourceNodeId, nodes, edges);
  const choiceNodeChoices = successor?.data.nodeKind === "choice" ? successor.data.choice?.choices ?? [] : [];
  if (successor && choiceNodeChoices.length > 0) {
    return {
      sourceNodeId: successor.id,
      choices: choiceNodeChoices,
      sourceLabel: successor.data.label,
      viaChoiceNode: true,
    };
  }

  return { sourceNodeId, choices: [], sourceLabel: sceneDisplayLabel(scene), viaChoiceNode: false };
}

function safeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+/, "").slice(0, 40) || "branch";
}

function buildBranchTargetStub(sourceScene: SceneBeat, choice: Choice): SceneBeat {
  const label = choiceDisplayLabel(choice);
  return {
    ...sourceScene,
    scene_id: `${sourceScene.scene_id}_${safeIdPart(choice.choice_id)}_next`,
    scene_display_name: `${label} 后续`,
    title: `${label} 后续`,
    summary: `玩家选择“${label}”后的直接后续场景。`,
    commands: [],
    tags: Array.from(new Set([...sourceScene.tags, "branch"])),
  };
}

function buildBranchAuthorGoal(authorGoal: string, choice: Choice, allChoices: Choice[]): string {
  const label = choiceDisplayLabel(choice);
  return [
    authorGoal,
    `当前场景出现选项分支。本次只生成选项“${label}”对应的直接后续场景。`,
    "请把玩家的选择文本当作剧情因果：先承接选择动机，再写角色反应、短期后果和新的可延展冲突。",
    "不要生成其它选项的后续，不要把多个分支混在同一个场景里。",
    `同一分支点的其它选项仅作对照：${allChoices.map(choiceDisplayLabel).join(" / ")}`,
  ].filter(Boolean).join("\n");
}

function buildBranchOutline(generationOutline: string | null, choice: Choice): string {
  const label = choiceDisplayLabel(choice);
  return [
    generationOutline ? `作者下一步大纲：${generationOutline}` : "",
    `剧情联想分支：玩家选择“${label}”。围绕这个选择推演下一段场景，保留当前角色动机和世界事实，并让该分支具备继续发展的明确钩子。`,
  ].filter(Boolean).join("\n");
}

function appendBranchContext(editorContext: string, sourceNodeId: string, sourceScene: SceneBeat, choice: Choice, allChoices: Choice[]): string {
  return [
    editorContext,
    "[Active branch generation JSON]",
    JSON.stringify({
      source_node_id: sourceNodeId,
      source_scene_id: sourceScene.scene_id,
      active_choice: {
        choice_id: choice.choice_id,
        choice_display_name: choice.choice_display_name ?? null,
        text: choice.text,
        conditions: choice.conditions,
      },
      sibling_choices: allChoices.map((item) => ({
        choice_id: item.choice_id,
        choice_display_name: item.choice_display_name ?? null,
        text: item.text,
      })),
      instruction: "Generate only the direct successor SceneBeat for active_choice, then the editor will link it through sourceHandle=choice_id.",
    }),
  ].join("\n");
}

function memoryExtractionSelection(selection: ProviderSelectionPayload): ProviderSelectionPayload {
  if (selection.parameters?.thinking_mode !== true) return selection;
  return {
    ...selection,
    parameters: {
      ...selection.parameters,
      structured_mode: "json_object",
    },
  };
}

export function SceneNode({ id, data, selected }: NodeProps<EditorNode>) {
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const globalMemoryMode = useEditorStore((state) => state.memoryMode);
  const applyGeneratedScene = useEditorStore((state) => state.applyGeneratedScene);
  const applyGeneratedBranchScene = useEditorStore((state) => state.applyGeneratedBranchScene);
  const applyGeneratedSceneToNode = useEditorStore((state) => state.applyGeneratedSceneToNode);
  const connectChoiceTargetsFromSceneIds = useEditorStore((state) => state.connectChoiceTargetsFromSceneIds);
  const activeGeneration = useEditorStore((state) => state.activeGeneration);
  const beginGeneration = useEditorStore((state) => state.beginGeneration);
  const endGeneration = useEditorStore((state) => state.endGeneration);
  const selectNode = useEditorStore((state) => state.selectNode);
  const setGenerationDebugStatus = useEditorStore((state) => state.setGenerationDebugStatus);
  const appendGenerationDecisionDelta = useEditorStore((state) => state.appendGenerationDecisionDelta);
  const addGenerationTrace = useEditorStore((state) => state.addGenerationTrace);
  const setNotice = useEditorStore((state) => state.setNotice);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamStatus, setStreamStatus] = useState("");
  const generationInFlightRef = useRef(false);
  const clickStartRef = useRef<{ x: number; y: number; valid: boolean } | null>(null);
  const pointerMovedRef = useRef(false);
  const scene = data.scene;
  const source = data.editorMeta?.source;
  const isAiGenerated = source === "ai_generated";
  const isAiEdited = source === "ai_edited";
  const isImported = source === "imported";
  const isThisNodeGenerating = isGenerating || activeGeneration?.nodeId === id;
  const choices = scene?.commands.filter((command) => command.type === "choice").flatMap((command) => command.choices) ?? [];
  const shouldShowChoiceHandles = choices.length > 0;

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && Boolean(target.closest("button,input,textarea,select,[role='button'],.react-flow__handle"));
  }

  function recordNodePointerDown(event: PointerEvent<HTMLElement>) {
    clickStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      valid: !isInteractiveTarget(event.target),
    };
    pointerMovedRef.current = false;
  }

  function trackNodePointerMove(event: PointerEvent<HTMLElement>) {
    const start = clickStartRef.current;
    if (!start?.valid) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance > 8) pointerMovedRef.current = true;
  }

  function finishNodePointer(event: PointerEvent<HTMLElement>) {
    trackNodePointerMove(event);
  }

  function notifyNodeCardClick(event: MouseEvent<HTMLElement>) {
    const start = clickStartRef.current;
    clickStartRef.current = null;
    if (!start?.valid || pointerMovedRef.current || isInteractiveTarget(event.target)) {
      pointerMovedRef.current = false;
      return;
    }
    pointerMovedRef.current = false;
    selectNode(id);
    window.dispatchEvent(new CustomEvent("agentvn:node-card-click", { detail: { nodeId: id } }));
  }

  async function generateNext(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!scene) return;
    selectNode(id);
    if (generationInFlightRef.current || activeGeneration?.nodeId === id) {
      setNotice("当前节点正在生成后续，请等待这次生成完成后再点击。", "warning");
      return;
    }
    if (activeGeneration) {
      setNotice("已有场景正在生成后续，请等待当前生成完成后再点击。", "warning");
      return;
    }

    const providerSelection = getProviderSelectionPayload("text_generation");
    if (!providerSelection) {
      requestAdvancedTools({
        tab: "providers",
        title: "请先添加模型",
        message: "还没有可用于文本生成的模型。先在“模型/连接”里添加连接、模型并保存 Token，再回来生成后续剧情。",
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
    const selectedProvider: ProviderSelectionPayload = providerSelection;
    if (selectedProvider.parameters?.thinking_mode === true) {
      setNotice({
        tone: "warning",
        reportable: false,
        source: "AI Generation",
        message: "已启用思考模式：模型可能返回长推理或非结构化内容，存在无法完全写入项目的风险。",
        detail: "本次生成会继续执行。AgentVN 仍会用后端 schema 校验最终结果；如果模型输出无法稳定转成 SceneBeat 或 MemoryUpdate，剧情可能生成成功但记忆抽取或部分结构化写入会以 warning 形式失败。",
        action: "如果频繁出现结构化失败，建议把结构化输出模式切为“自动兼容”或关闭思考模式。",
        context: {
          connection_id: selectedProvider.connection_id,
          model_id: selectedProvider.model_id,
          thinking_mode: true,
          structured_mode: selectedProvider.parameters?.structured_mode ?? "auto",
        },
      });
    }

    const generationLock = beginGeneration(id);
    if (!generationLock.ok) {
      setNotice(generationLock.activeNodeId === id ? "当前节点正在生成后续，请等待这次生成完成后再点击。" : "已有场景正在生成后续，请等待当前生成完成后再点击。", "warning");
      return;
    }

    generationInFlightRef.current = true;
    setIsGenerating(true);
    setStreamText("");
    setStreamStatus("准备连接模型...");
    try {
      const memoryMode = data.memoryMode ?? globalMemoryMode;
      const shouldReplaceCurrentNode = isBlankScene(scene);
      const incomingContext = shouldReplaceCurrentNode ? findIncomingSceneContext(id, nodes, edges) : undefined;
      const contextScene = incomingContext?.scene ?? scene;
      const contextNodeId = incomingContext?.nodeId ?? id;
      const generationOutline = data.aiSettings.generationOutline?.trim() || null;
      const editorContextPackage = buildEditorGenerationContextPackage({
        currentNodeId: id,
        contextNodeId,
        nodes,
        edges,
        memoryMode,
        providerSelection: selectedProvider,
      });
      addGenerationTrace({
        id: `context_budget_${Date.now()}`,
        time: new Date().toISOString(),
        phase: "context_budget",
        level: editorContextPackage.report.compression_triggered ? "warning" : "info",
        title: "Context budget prepared",
        message: editorContextPackage.report.compression_triggered
          ? "Editor blueprint context exceeded the model budget and was compressed before generation."
          : "Editor blueprint context fits inside the current model budget.",
        details: editorContextPackage.report as unknown as Record<string, unknown>,
      });
      if (editorContextPackage.report.compression_triggered) {
        const remoteCount = editorContextPackage.report.priority_counts?.P2 ?? 0;
        setStreamStatus(`上下文超过预算，已压缩 ${remoteCount} 组远端资料并保留当前节点。`);
        setGenerationDebugStatus("上下文超过预算，已优先保留当前节点并压缩远端场景。");
      }

      async function extractGeneratedMemory(generatedScene: SceneBeat): Promise<boolean> {
        if (!data.aiSettings.autoExtractMemory) return true;
        const memoryProviderSelection = memoryExtractionSelection(selectedProvider);
        try {
          setStreamStatus("正在流式抽取记忆...");
          setGenerationDebugStatus("正在流式抽取记忆...");
          const update = await backendClient.extractMemoryStream(
            {
              scene: generatedScene,
              memory_mode: memoryMode,
              chapter: generatedScene.chapter,
              provider_selection: memoryProviderSelection,
            },
            {
              onStatus: (status) => {
                setStreamStatus(status);
                setGenerationDebugStatus(status);
              },
              onTrace: addGenerationTrace,
            },
          );
          if (data.aiSettings.autoApplyMemory) await backendClient.applyMemoryUpdate(update, generatedScene.chapter);
          return true;
        } catch (error) {
          reportFrontendError("editor.scene-generation", error, {
            operation: "extract-memory",
            sceneId: scene?.scene_id ?? generatedScene.scene_id,
          });
          const detail = error instanceof Error ? error.message : "AI 记忆抽取失败";
          setNotice({
            tone: "warning",
            reportable: false,
            source: "AI Generation / Memory Extraction",
            message: "记忆抽取未完成：剧情已写入节点，但记忆结构化写入失败。",
            detail: `记忆抽取失败：${detail}。剧情已生成并写入节点。`,
            action: memoryProviderSelection.parameters?.thinking_mode === true
              ? "当前模型启用了思考模式，记忆抽取已改用 JSON 兼容模式；如果仍频繁失败，建议关闭自动记忆抽取或改用更快的非思考文本模型。"
              : "可稍后重试，或在模型配置中调大请求超时、切换结构化模式为自动兼容/JSON 兼容。",
            context: {
              connection_id: memoryProviderSelection.connection_id,
              model_id: memoryProviderSelection.model_id,
              structured_mode: memoryProviderSelection.parameters?.structured_mode ?? "auto",
              thinking_mode: memoryProviderSelection.parameters?.thinking_mode === true,
              request_timeout_seconds: memoryProviderSelection.parameters?.request_timeout_seconds,
              generated_scene_id: generatedScene.scene_id,
            },
          });
          return false;
        }
      }

      let latestBranchState = useEditorStore.getState();
      const branchEntry = shouldReplaceCurrentNode
        ? undefined
        : findBranchEntryPoint(id, scene, latestBranchState.nodes, latestBranchState.edges);
      if (branchEntry && branchEntry.choices.length > 0) {
        const connectedTargetCount = connectChoiceTargetsFromSceneIds(branchEntry.sourceNodeId);
        if (connectedTargetCount > 0) latestBranchState = useEditorStore.getState();
      }
      const allBranchChoices = branchEntry?.choices ?? [];
      const branchChoices = shouldReplaceCurrentNode
        ? []
        : collectUnlinkedBranchChoices(branchEntry?.sourceNodeId ?? id, allBranchChoices, latestBranchState.nodes, latestBranchState.edges);
      if (!shouldReplaceCurrentNode && allBranchChoices.length > 0 && branchChoices.length === 0) {
        setNotice("当前场景的选项分支都已有目标场景或连线，未生成新的默认后续。", "info");
        return;
      }
      if (branchChoices.length > 0) {
        const createdScenes: string[] = [];
        let memoryWarningCount = 0;
        for (const [branchIndex, choice] of branchChoices.entries()) {
          const branchLabel = choiceDisplayLabel(choice);
          const latestState = useEditorStore.getState();
          const branchContextPackage = buildEditorGenerationContextPackage({
            currentNodeId: branchEntry?.sourceNodeId ?? id,
            contextNodeId,
            nodes: latestState.nodes,
            edges: latestState.edges,
            memoryMode,
            providerSelection: selectedProvider,
          });
          addGenerationTrace({
            id: `branch_context_budget_${choice.choice_id}_${Date.now()}`,
            time: new Date().toISOString(),
            phase: "context_budget",
            level: branchContextPackage.report.compression_triggered ? "warning" : "info",
            title: `Branch context prepared: ${branchLabel}`,
            message: branchContextPackage.report.compression_triggered
              ? "Branch generation context exceeded the model budget and was compressed before generation."
              : "Branch generation context fits inside the current model budget.",
            details: branchContextPackage.report as unknown as Record<string, unknown>,
          });
          setStreamStatus(`正在生成分支 ${branchIndex + 1}/${branchChoices.length}：${branchLabel}`);
          setGenerationDebugStatus(`正在生成分支 ${branchIndex + 1}/${branchChoices.length}：${branchLabel}`);
          let branchGenerated: SceneBeat;
          try {
            branchGenerated = await backendClient.generateSceneStream(
              {
                current_scene: JSON.stringify(contextScene),
                target_scene_stub: JSON.stringify(buildBranchTargetStub(scene, choice)),
                previous_summary: [
                  buildPreviousSummary(contextNodeId, latestState.nodes, latestState.edges),
                  `当前分支选择：${branchLabel} / ${choice.text}`,
                ].filter(Boolean).join("\n"),
                author_goal: buildBranchAuthorGoal(data.aiSettings.authorGoal, choice, allBranchChoices),
                generation_outline: buildBranchOutline(generationOutline, choice),
                editor_context: appendBranchContext(branchContextPackage.context, branchEntry?.sourceNodeId ?? id, scene, choice, allBranchChoices),
                memory_mode: memoryMode,
                chapter: scene.chapter,
                provider_selection: selectedProvider,
              },
              {
                onStatus: (status) => {
                  setStreamStatus(`分支 ${branchIndex + 1}/${branchChoices.length}：${status}`);
                  setGenerationDebugStatus(`分支 ${branchIndex + 1}/${branchChoices.length}：${status}`);
                },
                onDelta: (delta) => {
                  setStreamText((current) => `${current}${delta}`);
                  appendGenerationDecisionDelta(delta);
                },
                onTrace: addGenerationTrace,
              },
            );
          } catch (error) {
            reportFrontendError("editor.scene-generation", error, {
              operation: "generate-branch",
              sceneId: scene.scene_id,
              branch: branchLabel,
            });
            setNotice({
              tone: "error",
              source: "AI Generation",
              message: `生成分支“${branchLabel}”失败：${error instanceof Error ? error.message : "AI 生成失败"}`,
              error,
              action: "检查模型连接、Token、Base URL 与后端日志后重试。",
              context: { nodeId: id, sceneId: scene.scene_id, branchSourceNodeId: branchEntry?.sourceNodeId ?? id, choiceId: choice.choice_id, choiceText: choice.text },
            });
            return;
          }

          const appliedBranch = applyGeneratedBranchScene(branchEntry?.sourceNodeId ?? id, choice.choice_id, branchGenerated, {
            branchIndex,
            branchCount: branchChoices.length,
          });
          const generatedScene = appliedBranch.node?.data.scene ?? branchGenerated;
          createdScenes.push(generatedScene.scene_id);
          if (!(await extractGeneratedMemory(generatedScene))) {
            memoryWarningCount += 1;
          }
        }
        if (memoryWarningCount > 0) {
          setNotice({
            tone: "warning",
            reportable: false,
            source: "AI Generation / Branch Generation",
            message: `已生成并链接 ${createdScenes.length} 条分支后续，但 ${memoryWarningCount} 条分支记忆抽取未完成。`,
            detail: `已写入的分支场景：${createdScenes.join("、")}。剧情节点已保留，记忆可稍后重新抽取。`,
            action: "如频繁出现记忆抽取失败，请检查模型结构化输出模式、超时和 Token 预算。",
            context: { nodeId: id, sceneId: scene.scene_id, generatedSceneIds: createdScenes, memoryWarningCount },
          });
          return;
        }
        setNotice(`已生成并链接 ${createdScenes.length} 条分支后续：${createdScenes.join("、")}`, "success");
        return;
      }

      let generated: SceneBeat;
      try {
        generated = await backendClient.generateSceneStream(
          {
            current_scene: JSON.stringify(contextScene),
            target_scene_stub: shouldReplaceCurrentNode ? JSON.stringify(scene) : null,
            previous_summary: buildPreviousSummary(contextNodeId, nodes, edges),
            author_goal: data.aiSettings.authorGoal,
            generation_outline: generationOutline,
            editor_context: editorContextPackage.context,
            memory_mode: memoryMode,
            chapter: scene.chapter,
            provider_selection: selectedProvider,
          },
          {
            onStatus: (status) => {
              setStreamStatus(status);
              setGenerationDebugStatus(status);
            },
            onDelta: (delta) => {
              setStreamText((current) => `${current}${delta}`);
              appendGenerationDecisionDelta(delta);
            },
            onTrace: addGenerationTrace,
          },
        );
      } catch (error) {
        reportFrontendError("editor.scene-generation", error, {
          operation: "generate-next",
          sceneId: scene.scene_id,
        });
        setNotice({
          tone: "error",
          source: "AI Generation",
          message: `生成后续失败：${error instanceof Error ? error.message : "AI 生成失败"}`,
          error,
          action: "检查模型连接、Token、Base URL 与后端日志后重试。",
          context: { nodeId: id, sceneId: scene.scene_id },
        });
        return;
      }

      const applied = shouldReplaceCurrentNode
        ? applyGeneratedSceneToNode(id, generated, { preserveSceneId: true, preserveChapter: true, generatedFromNodeId: contextNodeId })
        : applyGeneratedScene(id, generated);
      const generatedScene = applied.node?.data.scene ?? generated;

      const memoryOk = await extractGeneratedMemory(generatedScene);
      if (!memoryOk) return;

      if ("replaced" in applied) {
        setNotice(applied.replaced ? "已填充当前空白场景节点" : "生成完成，但未能写入当前节点，请检查节点状态。", applied.replaced ? "success" : "warning");
      } else {
        setNotice(applied.linked ? "生成后续完成" : "源场景已有后续，新生成卡片已放在旁边但未自动连线，请手动选择要接哪条剧情。", applied.linked ? "success" : "warning");
      }
    } catch (error) {
      reportFrontendError("editor.scene-generation", error, {
        operation: "generate",
        sceneId: scene.scene_id,
      });
      setNotice({
        tone: "error",
        source: "AI Generation",
        message: error instanceof Error ? error.message : "AI 生成失败",
        error,
        action: "检查模型连接和当前场景数据后重试。",
        context: { nodeId: id, sceneId: scene.scene_id },
      });
    } finally {
      generationInFlightRef.current = false;
      endGeneration(generationLock.token);
      setIsGenerating(false);
      setStreamStatus("");
    }
  }

  return (
    <article
      className={`vn-node scene-node ${shouldShowChoiceHandles ? "has-choice-handles" : ""} ${isAiGenerated ? "is-ai-generated ai-glow-surface ai-flow-border" : ""} ${isAiEdited ? "is-ai-edited" : ""} ${isImported ? "is-imported" : ""} ${selected ? "is-selected" : ""}`}
      onPointerDown={recordNodePointerDown}
      onPointerMove={trackNodePointerMove}
      onPointerUp={finishNodePointer}
      onClick={notifyNodeCardClick}
    >
      <Handle id="default" type="target" position={Position.Top} />
      <header>
        <span className="node-kicker">场景 / 第 {scene?.chapter ?? "-"} 章</span>
        <strong>{scene ? sceneDisplayLabel(scene) : data.label}</strong>
        {(isAiGenerated || isAiEdited || isImported) && (
          <span className={`ai-source-badge ${isAiEdited ? "is-edited" : ""} ${isImported ? "is-imported" : ""}`}>
            <Sparkles size={12} />
            {isImported ? "来源于解析小说" : isAiEdited ? "AI 生成后已编辑" : "AI 生成"}
          </span>
        )}
      </header>
      <p>{scene?.summary || data.description}</p>
      <div className={"node-preview" + (isGenerating ? " is-streaming ai-glow-surface ai-flow-border ai-flow-active" : "")} aria-live={isGenerating ? "polite" : undefined}>
        {isGenerating ? (
          <>
            <strong>{streamStatus || "生成中..."}</strong>
            <pre>{streamText || "正在等待模型返回公开创作过程..."}</pre>
          </>
        ) : (
          scene ? commandsToText(scene.commands).map((line, index) => <span key={index}>{line}</span>) : <span>无场景数据</span>
        )}
      </div>
      <footer>
        <span className="memory-pill">{data.memoryMode ? memoryModeLabels[data.memoryMode] : "继承全局"}</span>
        <button
          type="button"
          className={`ai-node-button ai-glow-button nodrag nopan${isThisNodeGenerating ? " is-generating ai-flow-active" : ""}`}
          aria-busy={isThisNodeGenerating}
          data-state={isThisNodeGenerating ? "generating" : "idle"}
          data-help-key="scene.generateNext"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={generateNext}
        >
          <Sparkles size={14} /> {isThisNodeGenerating ? "生成中..." : "辅助生成后续"}
        </button>
      </footer>
      <Handle id="default" type="source" position={Position.Bottom} aria-label="默认后续" />
      {shouldShowChoiceHandles && choices.map((choice, index) => (
        <Handle
          key={choice.choice_id}
          id={choice.choice_id}
          type="source"
          position={Position.Bottom}
          className="scene-choice-handle"
          style={{ left: `${choices.length === 1 ? 50 : 18 + (64 * index) / Math.max(1, choices.length - 1)}%` }}
          aria-label={choiceDisplayLabel(choice)}
        />
      ))}
    </article>
  );
}
