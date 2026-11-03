import { Archive, Bot, ChevronDown, History, MessageCircle, RotateCcw, Send, Sparkles, Trash2, User, Wand2, SlidersHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { backendClient } from "../../api/backendClient";
import { retrieveAssistantDocs } from "../../assistant/retrieval";
import { readLayoutHelpContext } from "../../assistant/layoutHelpContext";
import { assistantCreationDefaultRect } from "../../assistant/creationPlacement";
import { assistantKnowledgeDestination } from "../../assistant/knowledgeNavigation";
import { resolveRuntimeUILayoutSettings } from "../../../../shared/cartridge/uiLayoutProfiles";
import type { AssistantChatMessage, AssistantCitation } from "../../assistant/types";
import {
  buildAssistantCreationAuthorization,
  assistantCreationCapabilities,
  parseAssistantCreationDraftBatchValue,
  parseAssistantCreationDraftValue,
  type AssistantCreationDraft,
  type AssistantCreationElementEditReviewItem,
  type AssistantCreationElementEditTarget,
  type AssistantCreationReviewItem,
} from "../../assistant/creationAgent";
import {
  captureAssistantCreationLayoutBaseline,
  planAssistantCreationElementEditBatch,
  planAssistantCreationProjectMerge,
  planAssistantCreationProjectMergeBatch,
} from "../../assistant/assistantCreationProjectMerge";
import { getProviderSelectionPayload } from "../../providers/providerRegistry";
import { packAssistantContext, type ContextBudgetReport } from "../../utils/contextBudget";
import { AssistantMarkdownMessage } from "./AssistantMarkdownMessage";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { requestAdvancedTools } from "../advanced/advancedToolsBridge";
import {
  assistantConversationTitle,
  deleteAssistantConversation,
  listAssistantConversations,
  newAssistantConversation,
  saveAssistantConversation,
  saveAssistantConversationRecovery,
  subscribeAssistantConversationChanges,
  updateAssistantConversationArchive,
  type AssistantConversationMode,
  type AssistantConversation,
} from "../../assistant/conversationHistory";
import { useProjectStore } from "../../store/projectStore";
import type { UILayoutScreenId } from "../../../../shared/cartridge/uiSkin";
import { stableSerialize } from "../../utils/stableSerialize";
import { listPersonalComponents, type PersonalComponentRecord } from "../../renpy/personalComponentLibrary";
import { AssistantCreationDraftPreview } from "./AssistantCreationDraftPreview";
import { AssistantCreationWorkbenchStudio } from "./AssistantCreationWorkbenchStudio";
import { AssistantCreationProcessMonitor } from "./AssistantCreationProcessMonitor";
import { useEditorDeleteConfirmation } from "../common/useEditorDeleteConfirmation";
import {
  cancelAssistantCreationProcess,
  createAssistantCreationProcessId,
  enqueueAssistantCreationProcess,
  getAssistantCreationProcesses,
  subscribeAssistantCreationProcesses,
} from "../../assistant/creationProcessQueue";
import { recoverAssistantCreationConversation } from "../../assistant/creationRecovery";
import { readProjectCreationAssetAuthorization } from "../../assistant/projectAssetAuthorization";
import { executeAssistantCreationLocalTool } from "../../assistant/creationLocalTools";
import type { AssistantCreationProcess } from "../../api/types";

const disclaimer = "大模型会阅读AgentVN各个功能的文档，综合考量来返回答案，不一定准确，请详细甄别。开发者提醒您：可以在官方群聊和用户一起交流呀～";

const quickQuestions = [
  "如何添加背景音乐并预览？",
  "如何设置分支选项和跳转？",
  "如何让当前场景更有演出感？",
];

function appendToLastAssistantMessage(messages: AssistantChatMessage[], delta: string): AssistantChatMessage[] {
  const next = [...messages];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index].role === "assistant") {
      next[index] = { ...next[index], content: `${next[index].content}${delta}` };
      return next;
    }
  }
  return [...next, { role: "assistant", content: delta }];
}

function replaceLastAssistantMessage(messages: AssistantChatMessage[], content: string): AssistantChatMessage[] {
  const next = [...messages];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index].role === "assistant") {
      next[index] = { ...next[index], content };
      return next;
    }
  }
  return [...next, { role: "assistant", content }];
}

function contextBudgetHint(report: ContextBudgetReport): string {
  if (report.compression_level === "chunked_merge") {
    return `长文已切片合并：${report.chunks_used ?? 0}/${report.chunks_available ?? 0} 段`;
  }
  if (report.compression_level === "compressed_summary") {
    return `已压缩参考上下文：保留 ${report.chunks_used ?? 0}/${report.chunks_available ?? 0} 段`;
  }
  if (report.compression_level === "fallback_trimmed") {
    return "上下文超预算，已执行兜底裁剪";
  }
  return "上下文预算正常";
}

export interface AssistantChatPanelProps {
  initialMode?: AssistantConversationMode;
  recoveryConversationId?: string;
  onOpenCreationWorkbench?: () => void;
  creationWorkbenchLayout?: boolean;
  onCreationDraftChange?: (draft: AssistantCreationDraft | undefined) => void;
  creationDraftOverride?: AssistantCreationDraft;
  onChooseCreationExample?: (prompt: string) => void;
}

export function AssistantChatPanel({
  initialMode = "inquiry",
  recoveryConversationId,
  onOpenCreationWorkbench,
  creationWorkbenchLayout = false,
  onCreationDraftChange,
  creationDraftOverride,
  onChooseCreationExample,
}: AssistantChatPanelProps = {}) {
  const { requestDeleteConfirmation, deleteConfirmation } = useEditorDeleteConfirmation();
  const recoveryInFlightRef = useRef(new Set<string>());
  const localToolInFlightRef = useRef(new Set<string>());
  const projectId = useProjectStore((state) => state.projectId);
  const projectTitle = useProjectStore((state) => state.title);
  const creationProcesses = useSyncExternalStore(
    subscribeAssistantCreationProcesses,
    getAssistantCreationProcesses,
    getAssistantCreationProcesses,
  );
  const [mode, setMode] = useState<AssistantConversationMode>(initialMode);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [citations, setCitations] = useState<AssistantCitation[]>([]);
  const [status, setStatus] = useState<string>();
  const [budgetReport, setBudgetReport] = useState<ContextBudgetReport>();
  const [loading, setLoading] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<string>();
  const [historyReady, setHistoryReady] = useState(false);
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMenuTop, setHistoryMenuTop] = useState(120);
  const [activeReadOnly, setActiveReadOnly] = useState(false);
  const [creationDraft, setCreationDraft] = useState<AssistantCreationDraft>();
  const [creationReviewItems, setCreationReviewItems] = useState<AssistantCreationReviewItem[]>();
  const [creationElementEditItems, setCreationElementEditItems] =
    useState<AssistantCreationElementEditReviewItem[]>();
  const [authorizedElementTargets, setAuthorizedElementTargets] =
    useState<AssistantCreationElementEditTarget[]>([]);
  const [personalComponents, setPersonalComponents] = useState<PersonalComponentRecord[]>([]);
  const [authorizedComponentIds, setAuthorizedComponentIds] = useState<string[]>([]);
  const [authorizedProjectAssetIds, setAuthorizedProjectAssetIds] = useState<string[]>([]);
  const assetPreparationRef = useRef(false);
  const [creationSaveBusy, setCreationSaveBusy] = useState(false);
  const reviewPersistTimerRef = useRef<number | undefined>(undefined);
  const pendingElementEditPersistenceRef = useRef<{
    conversationId: string;
    items: AssistantCreationElementEditReviewItem[];
  } | undefined>(undefined);
  const historyPopoverRef = useRef<HTMLDetailsElement>(null);
  const historyTriggerRef = useRef<HTMLElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const activeConversationRef = useRef<AssistantConversation | null>(null);
  const activeProjectRef = useRef(projectId);
  const loadGenerationRef = useRef(0);
  const conversationSyncGenerationRef = useRef(0);
  const messagesRef = useRef(messages);
  const citationsRef = useRef(citations);
  const bodyRef = useRef<HTMLDivElement>(null);
  const authorizedComponents = useMemo(
    () => personalComponents.filter((component) => authorizedComponentIds.includes(component.id)),
    [personalComponents, authorizedComponentIds],
  );
  const activeCreationProcesses = creationProcesses.filter((process) =>
    process.status === "queued" || process.status === "running" || process.status === "cancelling");

  messagesRef.current = messages;
  citationsRef.current = citations;

  useEffect(() => () => {
    flushCreationElementEditPersistence();
  }, []);

  useEffect(() => {
    if (creationWorkbenchLayout) onCreationDraftChange?.(creationDraft);
  }, [creationDraft, creationWorkbenchLayout, onCreationDraftChange]);

  const chatBody = (
    <div className="assistant-chat-body" key={`assistant-body-${mode}`} aria-live="polite" ref={bodyRef}>
      {messages.length === 0 ? (
        <div className="assistant-empty">
          {mode === "inquiry" ? <>
            <Bot size={24} />
            <strong>询问 AgentVN 的编辑方法</strong>
            <div className="assistant-quick-questions">
              {quickQuestions.map((question) => (
                <button type="button" key={question} disabled={!historyReady} data-help-key="assistant.quickQuestion" onClick={() => void sendQuestion(question)}>
                  {question}
                </button>
              ))}
            </div>
          </> : <>
            <Sparkles size={24} />
            <strong>描述目标，构建可预览的界面方案</strong>
            <p>可新增安全组件，也可修改本次明确授权的现有控件；先预览，再审核应用。</p>
          </>}
        </div>
      ) : (
        messages.map((message, index) => {
          const streaming = loading && index === messages.length - 1 && message.role === "assistant";
          const content = message.content || (message.role === "assistant" ? "正在组织回答..." : "");
          return (
            <article
              className={`assistant-message is-${message.role}${streaming ? " is-streaming ai-flow-border ai-flow-active" : ""}`}
              key={`${message.role}-${index}`}
            >
              {message.role === "assistant" ? <Bot size={17} /> : <User size={17} />}
              <div className="assistant-message-content">
                <AssistantMarkdownMessage content={content} role={message.role} streaming={streaming} />
                {message.role === "assistant" && index === messages.length - 1 && citations.length > 0 && (
                  <div className="assistant-message-citations">
                    <strong>参考：</strong>
                    {citations.map((citation) => {
                      const destination = assistantKnowledgeDestination(citation.id);
                      return <span key={citation.id} title={citation.source}>
                        {citation.title}
                        {destination && <button type="button" onClick={() => requestAdvancedTools({
                          tab: destination.tab, title: citation.title, workspaceNavigation: true,
                          message: `资料来源：${citation.source}。仅打开入口，未修改工程。`,
                        })}>打开：{destination.label}</button>}
                      </span>;
                    })}
                  </div>
                )}
              </div>
            </article>
          );
        })
      )}
      {mode === "creation" && creationDraft && !creationWorkbenchLayout && (
        <AssistantCreationDraftPreview
          draft={creationDraft}
          busy={creationSaveBusy || loading || activeReadOnly}
          onSave={() => void saveCreationDraftToLibrary()}
          onMerge={mergeCreationDraftIntoProject}
        />
      )}
    </div>
  );

  const inputArea = (
    <div className="assistant-input-area" key={`assistant-composer-${mode}`}>
      <div className="assistant-input-field">
        <small>{mode === "inquiry"
          ? disclaimer
          : "仅发送本创造会话中的需求、隔离草稿及本次明确授权控件的最小描述；不附带工程图、工程文件或未授权素材。所有提案需通过本地结构与基线校验。"}</small>
        <textarea
          value={input}
          rows={3}
          aria-label="向大模型助手提问"
          data-help-key="assistant.input"
          disabled={!historyReady}
          placeholder={mode === "inquiry"
            ? "描述你想在编辑器里实现的效果，或询问某个控件/流程怎么使用。"
            : "描述要新增的组件，或修改本次已授权的页面控件…"}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendQuestion();
            }
          }}
        />
      </div>
      <button type="button" className={`ai-glow-button${loading ? " ai-flow-active" : ""}`} data-help-key="assistant.send" disabled={!historyReady || loading || activeReadOnly || !input.trim()} onClick={() => void sendQuestion()}>
        <Send size={16} /> {loading ? "生成中" : mode === "creation" ? "生成创作提案" : "发送"}
      </button>
    </div>
  );

  useLayoutEffect(() => {
    const pendingReviewWrite = flushCreationElementEditPersistence();
    const generation = ++loadGenerationRef.current;
    activeProjectRef.current = projectId;
    activeConversationRef.current = null;
    messagesRef.current = [];
    citationsRef.current = [];
    setMessages([]);
    setCitations([]);
    setInput("");
    setLoading(false);
    setBudgetReport(undefined);
    setStatus(undefined);
    setHistoryStatus(undefined);
    setHistoryReady(false);
    setConversations([]);
    setHistoryStatus("正在读取本机会话…");
    setHistoryOpen(false);
    setActiveReadOnly(false);
    setPersonalComponents([]);
    setAuthorizedComponentIds([]);
    setAuthorizedProjectAssetIds([]);
    setAuthorizedElementTargets([]);
    setCreationElementEditItems(undefined);
    void pendingReviewWrite.then(() => Promise.all([
      listAssistantConversations(projectId, mode),
      mode === "creation" ? listPersonalComponents() : Promise.resolve([]),
    ])).then(([conversations, library]) => {
      if (loadGenerationRef.current !== generation || activeProjectRef.current !== projectId) return;
      setConversations(conversations);
      const active = conversations.find((conversation) => !conversation.archivedAt);
      const recovered = mode === "creation" && recoveryConversationId
        ? conversations.find(conversation => conversation.id === recoveryConversationId && !conversation.archivedAt
          && conversation.creationPendingProcess)
        : undefined;
      const selected = recovered ?? active ?? newAssistantConversation(projectId, mode);
      activeConversationRef.current = selected;
      messagesRef.current = selected.messages;
      citationsRef.current = selected.citations;
      setMessages(selected.messages);
      setCitations(selected.citations);
      setCreationDraft(selected.creationDraft);
      setCreationReviewItems(selected.creationReviewItems);
      setCreationElementEditItems(selected.creationElementEditItems);
      setPersonalComponents(library);
      setAuthorizedComponentIds((selected.authorizedComponentIds ?? [])
        .filter((id) => library.some((component) => component.id === id)));
      setAuthorizedProjectAssetIds(selected.authorizedProjectAssetIds ?? []);
      setHistoryStatus(undefined);
      setHistoryReady(true);
    }).catch((error) => {
      if (loadGenerationRef.current !== generation) return;
      setHistoryStatus(error instanceof Error ? `本机历史读取失败：${error.message}` : "本机历史读取失败。");
      setHistoryReady(true);
    });
    return () => {
      if (loadGenerationRef.current === generation) loadGenerationRef.current += 1;
    };
  }, [projectId, mode, recoveryConversationId]);

  useEffect(() => subscribeAssistantConversationChanges((change) => {
    if (change.projectId !== projectId || change.mode !== mode) return;
    const syncGeneration = ++conversationSyncGenerationRef.current;
    const projectGeneration = loadGenerationRef.current;
    void listAssistantConversations(projectId, mode).then((latestConversations) => {
      if (conversationSyncGenerationRef.current !== syncGeneration
        || loadGenerationRef.current !== projectGeneration
        || activeProjectRef.current !== projectId) return;
      setConversations(latestConversations);
      if (activeConversationRef.current?.id !== change.conversationId) return;
      const latest = latestConversations.find((conversation) => conversation.id === change.conversationId);
      if (!latest) {
        activeConversationRef.current = newAssistantConversation(projectId, mode);
        messagesRef.current = [];
        citationsRef.current = [];
        setMessages([]);
        setCitations([]);
        setCreationDraft(undefined);
        setCreationReviewItems(undefined);
        setCreationElementEditItems(undefined);
        setAuthorizedElementTargets([]);
        setAuthorizedComponentIds([]);
        setAuthorizedProjectAssetIds([]);
        setActiveReadOnly(false);
        setHistoryStatus("该会话已在其他工作区删除。");
        return;
      }
      activeConversationRef.current = latest;
      messagesRef.current = latest.messages;
      citationsRef.current = latest.citations;
      setMessages(latest.messages);
      setCitations(latest.citations);
      setCreationDraft(latest.creationDraft);
      setCreationReviewItems(latest.creationReviewItems);
      setCreationElementEditItems(latest.creationElementEditItems);
      setAuthorizedComponentIds((latest.authorizedComponentIds ?? [])
        .filter((id) => personalComponents.some((component) => component.id === id)));
      setAuthorizedProjectAssetIds(latest.authorizedProjectAssetIds ?? []);
      setActiveReadOnly(Boolean(latest.archivedAt));
    }).catch((error) => {
      if (conversationSyncGenerationRef.current !== syncGeneration) return;
      setHistoryStatus(error instanceof Error
        ? `跨工作区同步失败：${error.message}`
        : "跨工作区同步失败。");
    });
  }), [projectId, mode, personalComponents]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, status]);

  useEffect(() => {
    if (mode !== "creation" || !historyReady || loading) return;
    const generation = loadGenerationRef.current;
    for (const conversation of conversations) {
      const pending = conversation.creationPendingProcess;
      if (!pending || recoveryInFlightRef.current.has(pending.id)) continue;
      const publicProcess = creationProcesses.find(process => process.id === pending.id);
      if (publicProcess && ["queued", "cancelling"].includes(publicProcess.status)) continue;
      recoveryInFlightRef.current.add(pending.id);
      void backendClient.getAssistantCreationProcess(pending.id).then(async process => {
        if (loadGenerationRef.current !== generation || activeProjectRef.current !== projectId) return;
        const latest = (await listAssistantConversations(projectId, "creation"))
          .find(item => item.id === conversation.id && item.creationPendingProcess?.id === pending.id);
        if (!latest || loadGenerationRef.current !== generation) return;
        if (process.localToolRequest && latest.id === activeConversationRef.current?.id) {
          await executeOwnedLocalTool(process);
        }
        const recovered = recoverAssistantCreationConversation(latest, process);
        if (recovered) await saveAssistantConversationRecovery(latest, recovered);
      }).catch(error => {
        // Another window can observe the local pending record before enqueue
        // commits. A missing public row during that handshake is not a failure.
        if (publicProcess && loadGenerationRef.current === generation) setHistoryStatus(error instanceof Error
          ? `本机草稿恢复失败：${error.message}` : "本机草稿恢复失败；未重复调用模型。");
      }).finally(() => { recoveryInFlightRef.current.delete(pending.id); });
    }
  }, [conversations, creationProcesses, historyReady, loading, mode, projectId]);

  useLayoutEffect(() => {
    if (!historyOpen) return;
    const measure = () => {
      if (window.matchMedia("(min-width: 761px)").matches) return;
      const trigger = historyTriggerRef.current?.getBoundingClientRect();
      const menu = historyMenuRef.current;
      if (!trigger || !menu) return;
      const maxMenuHeight = Math.min(menu.offsetHeight, window.innerHeight - 24);
      const maxTop = Math.max(12, window.innerHeight - maxMenuHeight - 12);
      const nextTop = Math.max(12, Math.min(trigger.bottom + 8, maxTop));
      setHistoryMenuTop((previous) => Math.abs(previous - nextTop) < 1 ? previous : nextTop);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [historyOpen, conversations.length]);

  async function sendInquiryQuestion(questionOverride?: string) {
    const question = (questionOverride ?? input).trim();
    if (!question || loading || !historyReady) return;
    if (activeReadOnly) {
      setStatus("已归档对话为只读，请恢复归档或新建问询后继续。");
      return;
    }
    const providerSelection = getProviderSelectionPayload("text_generation", { allowFallbackWithKey: true });
    if (!providerSelection) {
      setStatus("请先在“工具/设置 > 模型/连接”配置可用的文本生成模型。");
      return;
    }
    const retrievedChunks = retrieveAssistantDocs(question, 12);
    const currentSettings = useProjectStore.getState().settings;
    const activeLayout = resolveRuntimeUILayoutSettings(currentSettings).runtimeUILayoutProfiles.activeType;
    const packedContext = packAssistantContext({
      question,
      chunks: retrievedChunks,
      editorContext: readLayoutHelpContext(projectId, activeLayout),
      messages: messages.slice(-8),
      providerSelection,
    });
    const contextChunks = packedContext.chunks;
    const conversation = activeConversationRef.current?.projectId === projectId
      && !activeConversationRef.current.archivedAt
      ? activeConversationRef.current
      : newAssistantConversation(projectId, "inquiry");
    const outgoingMessages = [...messagesRef.current, { role: "user", content: question }, { role: "assistant", content: "" }] satisfies AssistantChatMessage[];
    let requestMessages = outgoingMessages;
    let requestCitations: AssistantCitation[] = [];
    const pendingConversation: AssistantConversation = {
      ...conversation,
      title: assistantConversationTitle(outgoingMessages),
      messages: outgoingMessages,
      citations: [],
      updatedAt: new Date().toISOString(),
    };
    const requestProjectGeneration = loadGenerationRef.current;
    activeConversationRef.current = pendingConversation;
    messagesRef.current = outgoingMessages;
    citationsRef.current = [];
    setMessages(outgoingMessages);
    setInput("");
    setCitations([]);
    setBudgetReport(packedContext.report);
    setLoading(true);
    setStatus(`已检索 ${contextChunks.length} 条 AgentVN 文档片段，正在请求模型...`);
    setHistoryStatus("正在保存本机会话…");

    const persist = async (nextMessages: AssistantChatMessage[], nextCitations: AssistantCitation[]) => {
      const updated: AssistantConversation = {
        ...pendingConversation,
        title: assistantConversationTitle(nextMessages),
        messages: nextMessages,
        citations: nextCitations,
        updatedAt: new Date().toISOString(),
      };
      await saveAssistantConversation(updated);
      setConversations((current) => [
        updated,
        ...current.filter((conversationItem) => conversationItem.id !== updated.id),
      ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
      if (activeConversationRef.current?.id === updated.id
        && activeProjectRef.current === updated.projectId) {
        activeConversationRef.current = updated;
        setHistoryStatus("对话已保存到本机");
      }
    };
    let persistenceTimer: number | undefined;
    const schedulePersist = (nextMessages: AssistantChatMessage[], nextCitations: AssistantCitation[]) => {
      if (persistenceTimer !== undefined) window.clearTimeout(persistenceTimer);
      persistenceTimer = window.setTimeout(() => {
        persistenceTimer = undefined;
        void persist(nextMessages, nextCitations).catch((error) => {
          if (isCurrentConversation()) {
            setHistoryStatus(error instanceof Error ? `本机历史保存失败：${error.message}` : "本机历史保存失败。");
          }
        });
      }, 450);
    };
    const flushPersist = async (nextMessages: AssistantChatMessage[], nextCitations: AssistantCitation[]) => {
      if (persistenceTimer !== undefined) {
        window.clearTimeout(persistenceTimer);
        persistenceTimer = undefined;
      }
      await persist(nextMessages, nextCitations);
    };
    void persist(outgoingMessages, []).catch((error) => {
      if (isCurrentConversation()) {
        setHistoryStatus(error instanceof Error ? `本机历史保存失败：${error.message}` : "本机历史保存失败。");
      }
    });
    const isCurrentConversation = () => loadGenerationRef.current === requestProjectGeneration
      && activeProjectRef.current === projectId
      && activeConversationRef.current?.id === pendingConversation.id;

    try {
      const response = await backendClient.streamAssistant(
        {
          question,
          context_chunks: contextChunks,
          messages: messages.slice(-8),
          editor_context: [
            packedContext.editorContext,
            "",
            "[Context budget report]",
            JSON.stringify(packedContext.report),
          ].join("\n"),
          provider_selection: providerSelection,
        },
        {
          onStatus: (nextStatus) => {
            if (isCurrentConversation()) setStatus(nextStatus);
          },
          onDelta: (delta) => {
            requestMessages = appendToLastAssistantMessage(requestMessages, delta);
            schedulePersist(requestMessages, requestCitations);
            if (!isCurrentConversation()) return;
            messagesRef.current = requestMessages;
            setMessages(requestMessages);
          },
          onCitations: (nextCitations) => {
            requestCitations = nextCitations;
            schedulePersist(requestMessages, requestCitations);
            if (!isCurrentConversation()) return;
            citationsRef.current = requestCitations;
            setCitations(requestCitations);
          },
          onFinal: (finalValue) => {
            requestMessages = replaceLastAssistantMessage(
              requestMessages,
              finalValue.answer || "模型没有返回内容。",
            );
            requestCitations = finalValue.citations;
            if (isCurrentConversation()) {
              messagesRef.current = requestMessages;
              citationsRef.current = requestCitations;
              setMessages(requestMessages);
              setCitations(requestCitations);
            }
            schedulePersist(requestMessages, requestCitations);
          },
        }
      );
      requestMessages = replaceLastAssistantMessage(
        requestMessages,
        response.answer || "模型没有返回内容。",
      );
      if (isCurrentConversation()) {
        messagesRef.current = requestMessages;
        citationsRef.current = response.citations;
        setMessages(requestMessages);
        setCitations(response.citations);
        setStatus(undefined);
      }
      requestCitations = response.citations;
      await flushPersist(requestMessages, requestCitations);
    } catch (error) {
      reportFrontendError("editor.assistant", error, { operation: "chat" });
      const message = error instanceof Error ? error.message : "助手请求失败。";
      requestMessages = replaceLastAssistantMessage(requestMessages, `请求失败：${message}`);
      if (isCurrentConversation()) {
        messagesRef.current = requestMessages;
        setMessages(requestMessages);
        setStatus(message);
      }
      await flushPersist(requestMessages, requestCitations).catch((persistError) => {
        if (isCurrentConversation()) {
          setHistoryStatus(persistError instanceof Error
            ? `本机历史保存失败：${persistError.message}`
            : "本机历史保存失败。");
        }
      });
    } finally {
      if (isCurrentConversation()) setLoading(false);
    }
  }

  async function sendCreationRequest(questionOverride?: string) {
    const question = (questionOverride ?? input).trim();
    if (!question || loading || assetPreparationRef.current || !historyReady || activeReadOnly) return;
    if (question.length > 4000) {
      setStatus("组件需求最多 4,000 个字符，请先精简后重试。");
      return;
    }
    const providerSelection = getProviderSelectionPayload("text_generation", { allowFallbackWithKey: true });
    if (!providerSelection) {
      setStatus("请先在“工具/设置 > 模型/连接”配置可用的文本生成模型。");
      return;
    }
    let authorization: ReturnType<typeof buildAssistantCreationAuthorization>;
    let projectAuthorization: Awaited<ReturnType<typeof readProjectCreationAssetAuthorization>>;
    const preparationGeneration = loadGenerationRef.current;
    const preparationConversation = activeConversationRef.current;
    const assetsAtPreparation = useProjectStore.getState().assetManifest;
    assetPreparationRef.current = true;
    setLoading(true);
    try {
      authorization = buildAssistantCreationAuthorization(authorizedComponents);
      projectAuthorization = await readProjectCreationAssetAuthorization(assetsAtPreparation, authorizedProjectAssetIds);
      if (loadGenerationRef.current !== preparationGeneration || activeProjectRef.current !== projectId
        || activeConversationRef.current?.id !== preparationConversation?.id
        || stableSerialize(activeConversationRef.current?.authorizedProjectAssetIds ?? []) !== stableSerialize(authorizedProjectAssetIds)
        || authorizedProjectAssetIds.some(id => useProjectStore.getState().assetManifest.find(asset => asset.asset_id === id)
          !== assetsAtPreparation.find(asset => asset.asset_id === id))) return;
      authorization.authorizedAssets.push(...projectAuthorization.assets);
      if (authorization.authorizedAssets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0) > 32 * 1024 * 1024) {
        throw new Error("本次所有来源授权素材合计超过 32 MiB，未发起模型请求。");
      }
    } catch (error) {
      if (loadGenerationRef.current === preparationGeneration && activeProjectRef.current === projectId
        && activeConversationRef.current?.id === preparationConversation?.id) {
        setStatus(error instanceof Error ? error.message : "本会话授权素材无法读取。");
      }
      return;
    } finally {
      assetPreparationRef.current = false;
      if (loadGenerationRef.current === preparationGeneration && activeProjectRef.current === projectId) setLoading(false);
    }
    const authorizedTargetsAtSubmission = [...authorizedElementTargets];
    if (authorizedTargetsAtSubmission.length > 8) {
      setStatus("每次请求最多授权修改 8 个现有控件。");
      return;
    }
    let authorizedTargetPayload: Array<{
      target_id: string;
      screen_id: UILayoutScreenId;
      component_type: string;
      label?: string;
      rect?: { x: number; y: number; width: number; height: number };
    }> = [];
    if (authorizedTargetsAtSubmission.length) {
      const state = useProjectStore.getState();
      const layout = state.settings.runtimeUILayout;
      const screenIds = new Set(authorizedTargetsAtSubmission.map(target => target.screenId));
      if (state.projectId !== projectId || layout?.layout_type !== "renpy"
        || state.settings.runtimeUILayoutProfiles?.activeType !== "renpy"
        || screenIds.size !== 1
        || authorizedTargetsAtSubmission.some(target => {
          const component = layout.screens.find(screen => screen.screen_id === target.screenId)
            ?.components.find(item => item.component_id === target.componentId);
          return !component || component.component_type !== target.componentType
            || component.label !== target.label
            || stableSerialize(component.rect) !== stableSerialize(target.rect);
        })) {
        setStatus("授权控件已被编辑、切换工程或不属于同一页面；请重新选择后再发送。");
        setAuthorizedElementTargets([]);
        return;
      }
      authorizedTargetPayload = authorizedTargetsAtSubmission.map(target => ({
        target_id: target.targetId,
        screen_id: target.screenId,
        component_type: target.componentType,
        ...(target.label !== undefined ? { label: target.label } : {}),
        ...(target.rect ? { rect: target.rect } : {}),
      }));
    }
    let projectBaseline: AssistantCreationDraft["projectBaseline"];
    const projectStateAtSubmission = useProjectStore.getState();
    if (projectStateAtSubmission.projectId === projectId
      && projectStateAtSubmission.settings.runtimeUILayoutProfiles?.activeType === "renpy"
      && projectStateAtSubmission.settings.runtimeUILayout) {
      try {
        projectBaseline = captureAssistantCreationLayoutBaseline(
          projectId,
          projectStateAtSubmission.settings.runtimeUILayout,
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "无法为当前页面建立合并基线；请先修复布局后重试。");
        return;
      }
    }
    const conversation = activeConversationRef.current?.projectId === projectId
      && activeConversationRef.current.mode === "creation"
      && !activeConversationRef.current.archivedAt
      ? activeConversationRef.current
      : newAssistantConversation(projectId, "creation");
    const previousMessages = messagesRef.current.slice(-8);
    const outgoingMessages = [
      ...messagesRef.current,
      { role: "user", content: question },
      { role: "assistant", content: "" },
    ] satisfies AssistantChatMessage[];
    const pendingConversation: AssistantConversation = {
      ...conversation,
      title: assistantConversationTitle(outgoingMessages),
      messages: outgoingMessages,
      citations: [],
      creationDraft,
      creationReviewItems,
      creationElementEditItems,
      authorizedComponentIds,
      authorizedProjectAssetIds,
      updatedAt: new Date().toISOString(),
    };
    const requestGeneration = loadGenerationRef.current;
    activeConversationRef.current = pendingConversation;
    messagesRef.current = outgoingMessages;
    setMessages(outgoingMessages);
    setInput("");
    setCitations([]);
    setLoading(true);
    setStatus("正在构建受限组件草稿并校验安全结构…");
    setHistoryStatus("正在保存创造会话…");

    const isCurrentConversation = () => loadGenerationRef.current === requestGeneration
      && activeProjectRef.current === projectId
      && activeConversationRef.current?.id === pendingConversation.id
      && activeConversationRef.current.mode === "creation";
    const persist = async (
      nextMessages: AssistantChatMessage[],
      draft: AssistantCreationDraft | undefined = creationDraft,
      reviewItems: AssistantCreationReviewItem[] | undefined = creationReviewItems,
      elementEditItems: AssistantCreationElementEditReviewItem[] | undefined = creationElementEditItems,
    ) => {
      const updated: AssistantConversation = {
        ...pendingConversation,
        title: assistantConversationTitle(nextMessages),
        messages: nextMessages,
        citations: [],
        authorizedComponentIds,
        authorizedProjectAssetIds,
        creationDraft: draft,
        creationReviewItems: reviewItems,
        creationElementEditItems: elementEditItems,
        updatedAt: new Date().toISOString(),
      };
      await saveAssistantConversation(updated);
      if (isCurrentConversation()) {
        activeConversationRef.current = updated;
        setConversations((current) => [
          updated,
          ...current.filter((item) => item.id !== updated.id),
        ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
        setHistoryStatus("创造会话已保存到本机");
      }
    };

    try {
      const processId = createAssistantCreationProcessId();
      pendingConversation.creationPendingProcess = {
        version: 1, id: processId, baseline: projectBaseline,
        authorizedAssets: authorization.authorizedAssets, targets: authorizedTargetsAtSubmission,
        previewLayout: projectBaseline ? structuredClone(projectStateAtSubmission.settings.runtimeUILayout) : undefined,
        previewAssets: projectBaseline ? projectStateAtSubmission.assetManifest.map(asset => ({
          asset_id: asset.asset_id, asset_type: asset.asset_type, metadata: {
            filename: asset.metadata.filename, mime_type: asset.metadata.mime_type,
            data_url: asset.metadata.data_url, blob_url: asset.metadata.blob_url, url: asset.metadata.url,
            filePath: asset.metadata.filePath, project_path: asset.metadata.project_path,
            ...(asset.metadata.bytes ? { bytes: new Uint8Array(asset.metadata.bytes) } : {}),
          },
        })) : undefined,
      };
      // Commit recovery consent/baseline before making a potentially paid call.
      await persist(outgoingMessages, creationDraft);
      if (!isCurrentConversation()) return;
      const process = enqueueAssistantCreationProcess({
        id: processId,
        projectId,
        projectTitle,
        conversationId: pendingConversation.id,
        onLocalTool: executeOwnedLocalTool,
      }, {
        user_request: question,
        agent_tools: true,
        messages: previousMessages
          .filter((message) => message.content.trim())
          .slice(-8),
        current_draft: creationDraft
          ? {
            name: creationDraft.name,
            description: creationDraft.description,
            html: creationDraft.html,
            css: creationDraft.css,
          }
          : null,
        authorized_components: authorization.components,
        authorized_assets: projectAuthorization.context,
        authorized_targets: authorizedTargetPayload,
        provider_selection: providerSelection,
      });
      const response = await process.result;
      delete pendingConversation.creationPendingProcess;
      const result = parseAssistantCreationDraftBatchValue(response, new Date().toISOString(), {
        authorizedAssets: authorization.authorizedAssets,
        authorizedTargets: authorizedTargetsAtSubmission,
      });
      if (!result.ok || (!result.drafts?.length && !result.edits?.length)) {
        const failure = `未创建草稿：${result.issues.join(" ")}`;
        const nextMessages = replaceLastAssistantMessage(outgoingMessages, failure);
        if (isCurrentConversation()) {
          messagesRef.current = nextMessages;
          setMessages(nextMessages);
          setStatus(failure);
        }
        await persist(nextMessages, creationDraft, creationReviewItems, creationElementEditItems);
        return;
      }
      const nextDrafts: AssistantCreationDraft[] = (result.drafts ?? []).map(item => ({
        ...item,
        ...(projectBaseline ? { projectBaseline } : {}),
      }));
      const nextDraft = nextDrafts[0] ?? creationDraft;
      const nextElementEditItems = (result.edits ?? []).map((edit, index) => {
        const target = authorizedTargetsAtSubmission.find(item => item.targetId === edit.targetId);
        if (!target || !projectBaseline) {
          throw new Error("控件修改提案缺少有效的本机目标或页面基线；未创建可应用提案。");
        }
        return {
          id: `${process.id}:edit:${index + 1}`,
          baseline: projectBaseline,
          target,
          edit,
          included: true,
        } satisfies AssistantCreationElementEditReviewItem;
      });
      const nextReviewItems = nextDrafts.length > 1
        ? nextDrafts.map((draft, index): AssistantCreationReviewItem => {
          const screenId = result.screenIds?.[index] ?? "title";
          return {
            id: `${process.id}:${index + 1}`,
            draft,
            screenId,
            rect: assistantCreationDefaultRect(index, nextDrafts.length, screenId),
            included: true,
          };
        })
        : undefined;
      const summaryParts = [
        nextReviewItems
          ? `已生成 ${nextReviewItems.length} 个组件候选`
          : nextDraft ? (nextDraft.description || `“${nextDraft.name}”已通过结构校验`) : "",
        nextElementEditItems.length ? `并提出 ${nextElementEditItems.length} 项现有控件修改` : "",
      ].filter(Boolean);
      const nextMessages = replaceLastAssistantMessage(
        outgoingMessages,
        `${summaryParts.join("；")}。请在右侧逐项审核；工程尚未修改。`,
      );
      if (isCurrentConversation()) {
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        if (nextDraft) setCreationDraft(nextDraft);
        setCreationReviewItems(nextReviewItems);
        setCreationElementEditItems(nextElementEditItems.length ? nextElementEditItems : undefined);
        setAuthorizedElementTargets([]);
        setStatus(undefined);
      }
      await persist(nextMessages, nextDraft, nextReviewItems,
        nextElementEditItems.length ? nextElementEditItems : undefined);
    } catch (error) {
      delete pendingConversation.creationPendingProcess;
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      if (!cancelled) reportFrontendError("editor.assistant", error, { operation: "creation-draft" });
      const message = cancelled
        ? "创作进程已取消。"
        : error instanceof Error ? error.message : "组件草稿生成失败。";
      const nextMessages = replaceLastAssistantMessage(
        outgoingMessages,
        cancelled ? message : `草稿生成失败：${message}`,
      );
      if (isCurrentConversation()) {
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        setStatus(message);
      }
      await persist(nextMessages, creationDraft, creationReviewItems, creationElementEditItems).catch((persistError) => {
        if (isCurrentConversation()) {
          setHistoryStatus(persistError instanceof Error
            ? `本机历史保存失败：${persistError.message}`
            : "本机历史保存失败。");
        }
      });
    } finally {
      if (isCurrentConversation()) setLoading(false);
    }
  }

  async function saveCreationDraftToLibrary(selectedDraft = creationDraft) {
    if (!selectedDraft || creationSaveBusy || selectedDraft.savedComponentId || activeReadOnly) return;
    setCreationSaveBusy(true);
    setHistoryStatus("正在保存到本机个人组件库…");
    try {
      const id = globalThis.crypto?.randomUUID?.()
        ?? `assistant-component-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const { savePersonalComponent } = await import("../../renpy/personalComponentLibrary");
      await savePersonalComponent({
        id,
        name: selectedDraft.name,
        description: selectedDraft.description,
        html: selectedDraft.html,
        css: selectedDraft.css,
        definition: selectedDraft.definition,
        assets: selectedDraft.assets ?? [],
      });
      const savedDraft = { ...selectedDraft, savedComponentId: id };
      const matchingReview = creationReviewItems?.find(item => item.draft.generatedAt === selectedDraft.generatedAt
        && item.draft.name === selectedDraft.name);
      const updatedReviewItems = matchingReview
        ? creationReviewItems!.map(item => item.id === matchingReview.id ? { ...item, draft: savedDraft } : item)
        : creationReviewItems;
      if (matchingReview) setCreationReviewItems(updatedReviewItems);
      else setCreationDraft(savedDraft);
      const conversation = activeConversationRef.current;
      if (conversation?.projectId === projectId && conversation.mode === "creation") {
        const updated = {
          ...conversation,
          ...(!matchingReview ? { creationDraft: savedDraft } : {}),
          ...(updatedReviewItems ? { creationReviewItems: updatedReviewItems } : {}),
          updatedAt: new Date().toISOString(),
        };
        activeConversationRef.current = updated;
        await saveAssistantConversation(updated);
        setConversations((current) => [
          updated,
          ...current.filter((item) => item.id !== updated.id),
        ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
      }
      setHistoryStatus("已保存到本机个人组件库");
    } catch (error) {
      setStatus(error instanceof Error ? `保存到个人组件库失败：${error.message}` : "保存到个人组件库失败。");
    } finally {
      setCreationSaveBusy(false);
    }
  }

  function mergeCreationDraftIntoProject(
    targetScreenId: UILayoutScreenId,
    rect: { x: number; y: number; width: number; height: number },
  ): { ok: boolean; reason: string } {
    const draft = creationDraftOverride ?? creationDraft;
    if (!draft || draft.projectMerge) return { ok: false, reason: "当前草稿不存在或已经应用。" };
    if (creationSaveBusy || loading || activeReadOnly) return { ok: false, reason: "当前会话正在处理，暂不能应用草稿。" };
    const state = useProjectStore.getState();
    if (!state.settings.runtimeUILayout) {
      return { ok: false, reason: "当前工程没有可应用的客户端布局。" };
    }
    const componentId = `assistant-${globalThis.crypto?.randomUUID?.()
      ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
    const plan = planAssistantCreationProjectMerge({
      currentProjectId: state.projectId,
      currentLayout: state.settings.runtimeUILayout,
      currentAssets: state.assetManifest,
      baseline: draft.projectBaseline,
      targetScreenId,
      rect,
      draft,
      componentId,
    });
    if (plan.status !== "ready") return { ok: false, reason: plan.reason };
    const applied = state.mergeRuntimeUILayoutIfScreenMatches({
      expectedProjectId: draft.projectBaseline!.projectId,
      expectedLayoutType: "renpy",
      screenId: targetScreenId,
      expectedScreenSnapshot: plan.expectedScreenSnapshot,
      runtimeUILayout: plan.layout,
      assetManifest: plan.assets,
    });
    if (!applied) {
      return { ok: false, reason: "工程或目标页面在提交瞬间发生变化；没有写入任何内容，请重新审核。" };
    }

    const mergedDraft: AssistantCreationDraft = {
      ...draft,
      projectMerge: {
        projectId: state.projectId,
        screenId: targetScreenId,
        componentId,
        appliedAt: new Date().toISOString(),
      },
    };
    setCreationDraft(mergedDraft);
    onCreationDraftChange?.(mergedDraft);
    const conversation = activeConversationRef.current;
    if (conversation?.projectId === state.projectId && conversation.mode === "creation") {
      const updated = { ...conversation, creationDraft: mergedDraft, updatedAt: new Date().toISOString() };
      activeConversationRef.current = updated;
      void saveAssistantConversation(updated).then(() => {
        setConversations((current) => [
          updated,
          ...current.filter((item) => item.id !== updated.id),
        ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
        setHistoryStatus("组件已合并到工程；审核记录已保存到本机");
      }).catch((error) => {
        setHistoryStatus(error instanceof Error
          ? `组件已应用，但本机审核记录保存失败：${error.message}`
          : "组件已应用，但本机审核记录保存失败。");
      });
    }
    return { ok: true, reason: `已将“${draft.name}”应用到“${targetScreenId}”页面；工程正常保存流程已接管。` };
  }

  function updateCreationReviewItems(items: AssistantCreationReviewItem[]) {
    setCreationReviewItems(items);
    if (reviewPersistTimerRef.current !== undefined) {
      window.clearTimeout(reviewPersistTimerRef.current);
    }
    const conversation = activeConversationRef.current;
    if (!conversation || conversation.mode !== "creation" || conversation.projectId !== projectId) return;
    reviewPersistTimerRef.current = window.setTimeout(() => {
      reviewPersistTimerRef.current = undefined;
      const latest = activeConversationRef.current;
      if (!latest || latest.id !== conversation.id || latest.projectId !== projectId || latest.mode !== "creation") return;
      const updated: AssistantConversation = {
        ...latest,
        creationReviewItems: items,
        updatedAt: new Date().toISOString(),
      };
      activeConversationRef.current = updated;
      void saveAssistantConversation(updated).then(() => {
        setConversations(current => [
          updated,
          ...current.filter(item => item.id !== updated.id),
        ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
      }).catch(error => {
        setHistoryStatus(error instanceof Error
          ? `审核选择保存失败：${error.message}`
          : "审核选择保存失败；候选仍保留在当前工作区。");
      });
    }, 220);
  }

  function mergeCreationReviewItemsIntoProject(
    selectedItems: AssistantCreationReviewItem[],
  ): { ok: boolean; reason: string } {
    if (!selectedItems.length) return { ok: false, reason: "至少选择一个候选后才能应用。" };
    if (selectedItems.length > 16 || creationSaveBusy || loading || activeReadOnly) {
      return { ok: false, reason: "候选数量无效或当前会话正在处理，整批未应用。" };
    }
    if (selectedItems.some(item => !item.included || item.draft.projectMerge)) {
      return { ok: false, reason: "批量项包含未选中或已应用的候选；整批未应用。" };
    }
    const baseline = selectedItems[0].draft.projectBaseline;
    if (!baseline || selectedItems.some(item =>
      !item.draft.projectBaseline || stableSerialize(item.draft.projectBaseline) !== stableSerialize(baseline))) {
      return { ok: false, reason: "候选没有相同的生成时工程基线；请在当前工程重新构建。" };
    }
    const state = useProjectStore.getState();
    if (!state.settings.runtimeUILayout) return { ok: false, reason: "当前工程没有可应用的客户端布局。" };
    const plan = planAssistantCreationProjectMergeBatch({
      currentProjectId: state.projectId,
      currentLayout: state.settings.runtimeUILayout,
      currentAssets: state.assetManifest,
      baseline,
      items: selectedItems.map(item => ({
        itemId: item.id,
        screenId: item.screenId,
        rect: item.rect,
        draft: item.draft,
        componentId: `assistant-${globalThis.crypto?.randomUUID?.()
          ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`,
      })),
    });
    if (plan.status !== "ready") return { ok: false, reason: plan.reason };
    const applied = state.mergeRuntimeUILayoutIfScreensMatch({
      expectedProjectId: baseline.projectId,
      expectedLayoutType: "renpy",
      expectedScreenSnapshots: plan.expectedScreenSnapshots,
      expectedRuntimeUILayoutSnapshot: plan.expectedRuntimeUILayoutSnapshot,
      expectedAssetManifestSnapshot: plan.expectedAssetManifestSnapshot,
      runtimeUILayout: plan.layout,
      assetManifest: plan.assets,
    });
    if (!applied) {
      return { ok: false, reason: "工程布局或素材在提交瞬间发生变化；整批均未写入，请重新审核。" };
    }

    const appliedAt = new Date().toISOString();
    const records = new Map(plan.items.map(item => [item.itemId, item]));
    const latestReviewItems = creationReviewItems ?? [];
    const mergedReviewItems = latestReviewItems.map(item => {
      const appliedItem = records.get(item.id);
      if (!appliedItem) return item;
      return {
        ...item,
        draft: {
          ...item.draft,
          projectMerge: {
            projectId: state.projectId,
            screenId: appliedItem.screenId,
            componentId: appliedItem.componentId,
            appliedAt,
          },
        },
      };
    });
    const firstApplied = mergedReviewItems.find(item => records.has(item.id));
    const mergedDraft = firstApplied?.draft;
    if (mergedDraft) {
      setCreationDraft(mergedDraft);
      onCreationDraftChange?.(mergedDraft);
    }
    setCreationReviewItems(mergedReviewItems);
    const conversation = activeConversationRef.current;
    if (conversation?.projectId === state.projectId && conversation.mode === "creation") {
      const updated = {
        ...conversation,
        ...(mergedDraft ? { creationDraft: mergedDraft } : {}),
        creationReviewItems: mergedReviewItems,
        updatedAt: appliedAt,
      };
      activeConversationRef.current = updated;
      void saveAssistantConversation(updated).then(() => {
        setConversations(current => [
          updated,
          ...current.filter(item => item.id !== updated.id),
        ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
        setHistoryStatus("所选组件已一次性合并到工程；审核记录已保存到本机");
      }).catch(error => {
        setHistoryStatus(error instanceof Error
          ? `组件已应用，但审核记录保存失败：${error.message}`
          : "组件已应用，但审核记录保存失败。");
      });
    }
    return { ok: true, reason: `已将 ${selectedItems.length} 个候选一次性应用到工程；未勾选项保持未应用。` };
  }

  function updateCreationElementEditItems(items: AssistantCreationElementEditReviewItem[]) {
    setCreationElementEditItems(items);
    const conversation = activeConversationRef.current;
    if (!conversation || conversation.mode !== "creation" || conversation.projectId !== projectId) return;
    const updated = { ...conversation, creationElementEditItems: items, updatedAt: new Date().toISOString() };
    activeConversationRef.current = updated;
    pendingElementEditPersistenceRef.current = { conversationId: conversation.id, items };
    setConversations(current => [
      updated,
      ...current.filter(item => item.id !== updated.id),
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    if (reviewPersistTimerRef.current !== undefined) window.clearTimeout(reviewPersistTimerRef.current);
    reviewPersistTimerRef.current = window.setTimeout(() => {
      flushCreationElementEditPersistence();
    }, 220);
  }

  function flushCreationElementEditPersistence(): Promise<void> {
    if (reviewPersistTimerRef.current !== undefined) {
      window.clearTimeout(reviewPersistTimerRef.current);
      reviewPersistTimerRef.current = undefined;
    }
    const pending = pendingElementEditPersistenceRef.current;
    if (!pending) return Promise.resolve();
    pendingElementEditPersistenceRef.current = undefined;
    const conversation = activeConversationRef.current;
    if (!conversation || conversation.id !== pending.conversationId) return Promise.resolve();
    const updated = {
      ...conversation,
      creationElementEditItems: pending.items,
      updatedAt: new Date().toISOString(),
    };
    activeConversationRef.current = updated;
    return saveAssistantConversation(updated).then(() => {
      setConversations(current => [
        updated,
        ...current.filter(item => item.id !== updated.id),
      ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    }).catch(error => {
      setHistoryStatus(error instanceof Error
        ? `控件修改审核状态保存失败：${error.message}`
        : "控件修改审核状态保存失败；提案仍保留在当前工作区。");
    });
  }

  function mergeCreationElementEditsIntoProject(
    selectedItems: AssistantCreationElementEditReviewItem[],
  ): { ok: boolean; reason: string } {
    void flushCreationElementEditPersistence();
    if (!selectedItems.length || selectedItems.length > 8
      || creationSaveBusy || loading || activeReadOnly) {
      return { ok: false, reason: "控件修改数量无效或当前会话正在处理；工程未修改。" };
    }
    if (selectedItems.some(item => !item.included || item.appliedAt)) {
      return { ok: false, reason: "审核项包含未选中或已应用的控件；整批未修改。" };
    }
    const baseline = selectedItems[0].baseline;
    if (selectedItems.some(item => stableSerialize(item.baseline) !== stableSerialize(baseline))) {
      return { ok: false, reason: "控件修改来自不同工程基线；整批未修改。" };
    }
    const state = useProjectStore.getState();
    const layout = state.settings.runtimeUILayout;
    if (!layout) return { ok: false, reason: "当前工程没有可应用的布局。" };
    const plan = planAssistantCreationElementEditBatch({
      currentProjectId: state.projectId,
      currentLayout: layout,
      baseline,
      authorizedTargets: selectedItems.map(item => item.target),
      edits: selectedItems.map(item => item.edit),
    });
    if (plan.status !== "ready") return { ok: false, reason: plan.reason };
    const applied = state.mergeRuntimeUILayoutIfScreenMatches({
      expectedProjectId: baseline.projectId,
      expectedLayoutType: "renpy",
      screenId: selectedItems[0].target.screenId,
      expectedScreenSnapshot: plan.expectedScreenSnapshot,
      runtimeUILayout: plan.layout,
      assetManifest: state.assetManifest,
    });
    if (!applied) {
      return { ok: false, reason: "页面或工程在提交瞬间发生变化；整批未修改，请重新加载并审核。" };
    }

    const appliedAt = new Date().toISOString();
    const ids = new Set(selectedItems.map(item => item.id));
    const updatedItems = (creationElementEditItems ?? []).map(item =>
      ids.has(item.id) ? { ...item, appliedAt } : item);
    pendingElementEditPersistenceRef.current = undefined;
    if (reviewPersistTimerRef.current !== undefined) {
      window.clearTimeout(reviewPersistTimerRef.current);
      reviewPersistTimerRef.current = undefined;
    }
    setCreationElementEditItems(updatedItems);
    const conversation = activeConversationRef.current;
    if (conversation?.projectId === state.projectId && conversation.mode === "creation") {
      const updated = {
        ...conversation,
        creationElementEditItems: updatedItems,
        updatedAt: appliedAt,
      };
      activeConversationRef.current = updated;
      void saveAssistantConversation(updated).then(() => {
        setConversations(current => [
          updated,
          ...current.filter(item => item.id !== updated.id),
        ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
        setHistoryStatus("所选控件修改已应用；审核记录已保存到本机");
      }).catch(error => {
        setHistoryStatus(error instanceof Error
          ? `控件修改已应用，但审核记录保存失败：${error.message}`
          : "控件修改已应用，但审核记录保存失败。");
      });
    }
    return { ok: true, reason: `已将 ${selectedItems.length} 项修改应用到“${selectedItems[0].target.screenId}”页面；工程正常保存流程已接管。` };
  }

  function sendQuestion(questionOverride?: string) {
    if (mode === "creation") {
      void sendCreationRequest(questionOverride);
      return;
    }
    void sendInquiryQuestion(questionOverride);
  }

  async function startNewConversation() {
    if (loading) return;
    await flushCreationElementEditPersistence();
    const conversation = newAssistantConversation(projectId, mode);
    activeConversationRef.current = conversation;
    messagesRef.current = [];
    citationsRef.current = [];
    setMessages(conversation.messages);
    setCitations(conversation.citations);
    setCreationDraft(undefined);
    setCreationReviewItems(undefined);
    setCreationElementEditItems(undefined);
    setAuthorizedElementTargets([]);
    setAuthorizedComponentIds([]);
    setAuthorizedProjectAssetIds([]);
    setInput("");
    setBudgetReport(undefined);
    setStatus(undefined);
    setHistoryStatus("已开启新问询");
    setActiveReadOnly(false);
  }

  async function selectConversation(conversation: AssistantConversation) {
    if (loading) return;
    await flushCreationElementEditPersistence();
    activeConversationRef.current = conversation;
    messagesRef.current = conversation.messages;
    citationsRef.current = conversation.citations;
    setMessages(conversation.messages);
    setCitations(conversation.citations);
    setCreationDraft(conversation.creationDraft);
    setCreationReviewItems(conversation.creationReviewItems);
    setCreationElementEditItems(conversation.creationElementEditItems);
    setAuthorizedElementTargets([]);
    setAuthorizedComponentIds((conversation.authorizedComponentIds ?? [])
      .filter((id) => personalComponents.some((component) => component.id === id)));
    setAuthorizedProjectAssetIds(conversation.authorizedProjectAssetIds ?? []);
    setInput("");
    setBudgetReport(undefined);
    setStatus(undefined);
    setHistoryStatus(conversation.archivedAt ? "已归档 · 只读历史" : "已载入本机历史");
    setActiveReadOnly(Boolean(conversation.archivedAt));
    setHistoryOpen(false);
  }

  async function archiveConversation(conversation: AssistantConversation) {
    if (loading) return;
    try {
      const updated = await updateAssistantConversationArchive(
        projectId,
        mode,
        conversation.id,
        !conversation.archivedAt,
      );
      if (!updated) return;
      setConversations((current) => [
        updated,
        ...current.filter((item) => item.id !== updated.id),
      ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
      if (activeConversationRef.current?.id === updated.id) {
        if (updated.archivedAt) await startNewConversation();
        else await selectConversation(updated);
      }
    } catch (error) {
      setHistoryStatus(error instanceof Error ? `归档失败：${error.message}` : "归档失败。");
    }
  }

  async function permanentlyDeleteConversation(conversation: AssistantConversation) {
    if (loading) return;
    const generation = loadGenerationRef.current;
    if (!await requestDeleteConfirmation(`永久删除“${conversation.title}”及其本机历史？此操作无法撤销。`)) return;
    if (loadGenerationRef.current !== generation || conversation.projectId !== projectId || conversation.mode !== mode) return;
    try {
      const deleted = await deleteAssistantConversation(projectId, mode, conversation.id);
      if (!deleted || loadGenerationRef.current !== generation) return;
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (activeConversationRef.current?.id === conversation.id) await startNewConversation();
      setHistoryStatus("已永久删除该对话");
    } catch (error) {
      if (loadGenerationRef.current === generation)
        setHistoryStatus(error instanceof Error ? `删除失败：${error.message}` : "删除失败。");
    }
  }

  async function switchMode(nextMode: AssistantConversationMode) {
    if (nextMode === mode || loading || !historyReady) return;
    await flushCreationElementEditPersistence();
    activeConversationRef.current = null;
    messagesRef.current = [];
    citationsRef.current = [];
    setMessages([]);
    setCitations([]);
    setCreationDraft(undefined);
    setCreationReviewItems(undefined);
    setCreationElementEditItems(undefined);
    setAuthorizedElementTargets([]);
    setAuthorizedComponentIds([]);
    setAuthorizedProjectAssetIds([]);
    setInput("");
    setBudgetReport(undefined);
    setStatus(undefined);
    setHistoryStatus("正在读取本机历史…");
    setHistoryReady(false);
    setConversations([]);
    setHistoryOpen(false);
    setActiveReadOnly(false);
    setMode(nextMode);
  }

  function toggleAuthorizedComponent(componentId: string, checked: boolean) {
    const current = activeConversationRef.current;
    if (mode !== "creation" || !current || current.archivedAt || loading) return;
    const nextIds = checked
      ? [...new Set([...authorizedComponentIds, componentId])]
      : authorizedComponentIds.filter((id) => id !== componentId);
    if (nextIds.length > 8) {
      setStatus("每个创造会话最多授权 8 个个人组件。");
      return;
    }
    setAuthorizedComponentIds(nextIds);
    const updated = { ...current, authorizedComponentIds: nextIds, updatedAt: new Date().toISOString() };
    activeConversationRef.current = updated;
    setConversations((items) => [
      updated,
      ...items.filter((item) => item.id !== updated.id),
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    void saveAssistantConversation(updated).catch((error) => {
      setHistoryStatus(error instanceof Error ? `授权选择保存失败：${error.message}` : "授权选择保存失败。");
    });
  }

  function toggleAuthorizedProjectAsset(assetId: string, checked: boolean) {
    const current = activeConversationRef.current;
    if (mode !== "creation" || !current || current.archivedAt || loading || assetPreparationRef.current) return;
    const nextIds = checked ? [...new Set([...authorizedProjectAssetIds, assetId])]
      : authorizedProjectAssetIds.filter(id => id !== assetId);
    if (nextIds.length > 16) { setStatus("每个创造会话最多授权 16 张工程图片。"); return; }
    setAuthorizedProjectAssetIds(nextIds);
    const updated = { ...current, authorizedProjectAssetIds: nextIds, updatedAt: new Date().toISOString() };
    activeConversationRef.current = updated;
    setConversations(items => [updated, ...items.filter(item => item.id !== updated.id)]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    const generation = loadGenerationRef.current;
    void saveAssistantConversation(updated).catch(error => {
      if (generation !== loadGenerationRef.current || activeConversationRef.current?.id !== updated.id) return;
      setHistoryStatus(error instanceof Error ? `工程素材授权保存失败：${error.message}` : "工程素材授权保存失败。");
    });
  }

  async function executeOwnedLocalTool(process: AssistantCreationProcess) {
    const request = process.localToolRequest;
    const conversation = activeConversationRef.current;
    const pending = conversation?.creationPendingProcess;
    if (!request || !conversation || !pending || localToolInFlightRef.current.has(request.id)
      || conversation.projectId !== process.projectId || conversation.id !== process.conversationId
      || activeProjectRef.current !== process.projectId || conversation.archivedAt) return;
    const generation = loadGenerationRef.current;
    const owns = () => generation === loadGenerationRef.current && activeProjectRef.current === process.projectId
      && activeConversationRef.current?.id === conversation.id
      && activeConversationRef.current?.creationPendingProcess?.id === process.id;
    localToolInFlightRef.current.add(request.id);
    try {
      const result = await executeAssistantCreationLocalTool(process, pending, owns);
      if (!result || !owns()) return;
      await backendClient.submitAssistantCreationLocalResult(process.id, { request_id: request.id,
        project_id: process.projectId, conversation_id: conversation.id, result });
      return result;
    } catch (error) {
      if (owns()) setStatus("本机工具回执未被采纳；任务可能已取消或请求已变化，请查看任务状态。");
    } finally { localToolInFlightRef.current.delete(request.id); }
  }

  return (
    <section className={`assistant-chat-panel ai-glow-surface ai-flow-border${loading ? " ai-flow-active" : ""}${creationWorkbenchLayout ? " is-creation-workbench-layout" : ""}`}
      data-testid={creationWorkbenchLayout ? "assistant-creation-workbench-chat" : undefined}>
      {deleteConfirmation}
      <header className="assistant-workbench-header">
        <div>
          <h3>大模型助手</h3>
          <span className="assistant-history-status" role="status">
            {historyStatus ?? `${mode === "inquiry" ? "问询" : "创造"}模式 · 会话按工程保存在本机`}
          </span>
        </div>
        <div className="assistant-header-actions">
          {!creationWorkbenchLayout && <div className="assistant-mode-switch" role="group" aria-label="助手工作模式">
            <button type="button" aria-pressed={mode === "inquiry"} disabled={loading || !historyReady}
              onClick={() => void switchMode("inquiry")}>
              <MessageCircle size={15} /> 问询模式
            </button>
            <button type="button" aria-pressed={mode === "creation"} disabled={loading || !historyReady}
              onClick={() => void switchMode("creation")}>
              <Sparkles size={15} /> 创造模式
            </button>
          </div>}
          {mode === "creation" && onOpenCreationWorkbench && !creationWorkbenchLayout && (
            <button type="button" data-testid="open-creation-workbench"
              aria-label="在独立窗口打开创造工作台"
              onClick={onOpenCreationWorkbench}>
              <Sparkles size={16} /> 独立工作台
            </button>
          )}
          {status && <span className="assistant-inline-status">{status}</span>}
          <button type="button" data-testid="assistant-new-conversation" disabled={loading || !historyReady}
            onClick={() => void startNewConversation()}>
            <History size={16} /> 新对话
          </button>
          <details className="assistant-history-popover" ref={historyPopoverRef}
            style={{ "--assistant-history-menu-top": `${historyMenuTop}px` } as React.CSSProperties}
            open={historyOpen} onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
            <summary ref={historyTriggerRef} aria-label="会话历史" aria-disabled={!historyReady}
              onClick={(event) => { if (!historyReady) event.preventDefault(); }}>
              <History size={16} /> 历史
              <span className="assistant-history-count">{conversations.filter((item) => !item.archivedAt).length}</span>
            </summary>
            <div className="assistant-history-menu" ref={historyMenuRef} aria-label={`${mode === "inquiry" ? "问询" : "创造"}会话历史`}>
              <section>
                <h4>当前工程 · {mode === "inquiry" ? "问询" : "创造"}</h4>
                {conversations.filter((item) => !item.archivedAt).length === 0
                  ? <p className="assistant-history-empty">尚无已保存的问询。</p>
                  : conversations.filter((item) => !item.archivedAt).map((conversation) => (
                    <div className="assistant-history-item" key={conversation.id}>
                      <button type="button" className="assistant-history-select"
                        aria-current={activeConversationRef.current?.id === conversation.id ? "true" : undefined}
                        disabled={loading} onClick={() => void selectConversation(conversation)}>
                        <strong>{conversation.title}</strong>
                        <time dateTime={conversation.updatedAt}>{new Date(conversation.updatedAt).toLocaleString("zh-CN", {
                          month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
                        })}</time>
                      </button>
                      <button type="button" aria-label={`归档 ${conversation.title}`} title="归档"
                        disabled={loading} onClick={() => void archiveConversation(conversation)}>
                        <Archive size={14} />
                      </button>
                      <button type="button" aria-label={`永久删除 ${conversation.title}`} title="永久删除"
                        disabled={loading} onClick={() => void permanentlyDeleteConversation(conversation)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
              </section>
              <section>
                <h4>已归档</h4>
                {conversations.filter((item) => Boolean(item.archivedAt)).length === 0
                  ? <p className="assistant-history-empty">暂无归档对话。</p>
                  : conversations.filter((item) => Boolean(item.archivedAt)).map((conversation) => (
                    <div className="assistant-history-item is-archived" key={conversation.id}>
                      <button type="button" className="assistant-history-select"
                        aria-current={activeConversationRef.current?.id === conversation.id ? "true" : undefined}
                        disabled={loading} onClick={() => void selectConversation(conversation)}>
                        <strong>{conversation.title}</strong>
                        <time dateTime={conversation.updatedAt}>{new Date(conversation.updatedAt).toLocaleString("zh-CN", {
                          month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
                        })}</time>
                      </button>
                      <button type="button" aria-label={`恢复 ${conversation.title}`} title="恢复归档"
                        disabled={loading} onClick={() => void archiveConversation(conversation)}>
                        <RotateCcw size={14} />
                      </button>
                      <button type="button" aria-label={`永久删除 ${conversation.title}`} title="永久删除"
                        disabled={loading} onClick={() => void permanentlyDeleteConversation(conversation)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
              </section>
            </div>
          </details>
          {mode === "inquiry" && <button type="button" data-help-key="assistant.assetGeneration" onClick={() => requestAdvancedTools({ tab: "assets" })}>
              <Wand2 size={16} /> 素材生成
            </button>}
          <button type="button" data-help-key="assistant.providerSettings" onClick={() => requestAdvancedTools({ tab: "providers" })}>
            <SlidersHorizontal size={16} /> 模型设置
          </button>
        </div>
      </header>

      <div className="assistant-context-strip" key={`assistant-context-${mode}`}>
        <Bot size={15} />
        {mode === "inquiry" ? <>
          <span>会参考 AgentVN 文档与当前编辑上下文，结果请甄别。</span>
          {budgetReport?.compression_triggered && <span className="assistant-budget-pill">{contextBudgetHint(budgetReport)}</span>}
          <details className="assistant-context-details">
            <summary>说明 <ChevronDown size={13} /></summary>
            <p>{disclaimer}</p>
          </details>
        </> : <>
          <span data-testid="assistant-creation-capabilities">AI 只提交隔离的组件或已授权控件提案；个人组件和工程图片仅在你勾选后进入本会话。</span>
          <details className="assistant-context-details">
            <summary>本次授权 <ChevronDown size={13} /></summary>
            <div className="assistant-creation-capability-list" data-testid="assistant-creation-capability-list">
              {assistantCreationCapabilities.map((capability) => (
                <p key={capability.id}><strong>{capability.label}</strong> · {capability.description}</p>
              ))}
              <p>AI 只能看到当前创造会话勾选的个人组件结构及图片别名、文件名与格式；图片字节留在本机用于安全预览和保存。不会读取工程图、工程文件、路径、密钥或未授权资源。生成结果只写入隔离会话草稿，需由你审核后保存。</p>
            </div>
          </details>
        </>}
      </div>

      {(mode === "creation" || activeCreationProcesses.length > 0) && (
        <AssistantCreationProcessMonitor processes={creationProcesses} onCancel={cancelAssistantCreationProcess} />
      )}

      {creationWorkbenchLayout ? (
        <div className="assistant-creation-workbench-grid">
          <div className="assistant-creation-workbench-conversation"
            data-testid="assistant-creation-workbench-conversation">
            {chatBody}
            {inputArea}
          </div>
          <AssistantCreationWorkbenchStudio
            draft={creationDraftOverride ?? creationDraft}
            reviewItems={creationReviewItems}
            busy={creationSaveBusy || loading || activeReadOnly}
            onSave={(selectedDraft) => void saveCreationDraftToLibrary(selectedDraft)}
            onMerge={mergeCreationDraftIntoProject}
            onMergeBatch={mergeCreationReviewItemsIntoProject}
            onReviewItemsChange={updateCreationReviewItems}
            elementEditItems={creationElementEditItems}
            onElementEditItemsChange={updateCreationElementEditItems}
            onElementEditTargetsChange={setAuthorizedElementTargets}
            onMergeElementEdits={mergeCreationElementEditsIntoProject}
            personalComponents={personalComponents}
            authorizedComponentIds={authorizedComponentIds}
            onToggleAuthorizedComponent={toggleAuthorizedComponent}
            authorizedProjectAssetIds={authorizedProjectAssetIds}
            onToggleAuthorizedProjectAsset={toggleAuthorizedProjectAsset}
            onChoosePrompt={(prompt) => {
              setInput(prompt);
              onChooseCreationExample?.(prompt);
            }}
          />
        </div>
      ) : <>
        {chatBody}
        {inputArea}
      </>}
    </section>
  );
}
