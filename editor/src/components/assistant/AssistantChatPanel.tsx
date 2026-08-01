import { Bot, ChevronDown, Eraser, Send, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { backendClient } from "../../api/backendClient";
import { retrieveAssistantDocs } from "../../assistant/retrieval";
import type { AssistantChatMessage, AssistantCitation } from "../../assistant/types";
import { getProviderSelectionPayload } from "../../providers/providerRegistry";
import { useSelectedNode } from "../../store/selectors";
import { packAssistantContext, type ContextBudgetReport } from "../../utils/contextBudget";
import { AssistantMarkdownMessage } from "./AssistantMarkdownMessage";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

const disclaimer = "大模型会阅读AgentVN各个功能的文档，综合考量来返回答案，不一定准确，请详细甄别。开发者提醒您：可以在官方群聊和用户一起交流呀～";

const quickQuestions = [
  "如何添加背景音乐并预览？",
  "如何设置分支选项和跳转？",
  "如何让当前场景更有演出感？",
];

function selectedNodeContext(node: ReturnType<typeof useSelectedNode>): string {
  if (!node) return "当前没有选中节点。";
  const scene = node.data.scene;
  if (!scene) return `当前选中 ${node.data.nodeKind} 节点：${node.data.label}`;
  return [
    `当前选中场景：${scene.title} (${scene.scene_id})`,
    `章节：${scene.chapter}`,
    `摘要：${scene.summary}`,
    `事件数量：${scene.commands.length}`,
    `记忆模式：${node.data.memoryMode ?? "hybrid"}`,
  ].join("\n");
}

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

export function AssistantChatPanel() {
  const selectedNode = useSelectedNode();
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [citations, setCitations] = useState<AssistantCitation[]>([]);
  const [status, setStatus] = useState<string>();
  const [budgetReport, setBudgetReport] = useState<ContextBudgetReport>();
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const editorContext = useMemo(() => selectedNodeContext(selectedNode), [selectedNode]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, status]);

  async function sendQuestion(questionOverride?: string) {
    const question = (questionOverride ?? input).trim();
    if (!question || loading) return;
    const providerSelection = getProviderSelectionPayload("text_generation", { allowFallbackWithKey: true });
    if (!providerSelection) {
      setStatus("请先在“工具/设置 > 模型/连接”配置可用的文本生成模型。");
      return;
    }

    const retrievedChunks = retrieveAssistantDocs(question, 12);
    const packedContext = packAssistantContext({
      question,
      chunks: retrievedChunks,
      editorContext,
      messages: messages.slice(-8),
      providerSelection,
    });
    const contextChunks = packedContext.chunks;
    const outgoingMessages = [...messages, { role: "user", content: question }, { role: "assistant", content: "" }] satisfies AssistantChatMessage[];
    setMessages(outgoingMessages);
    setInput("");
    setCitations([]);
    setBudgetReport(packedContext.report);
    setLoading(true);
    setStatus(`已检索 ${contextChunks.length} 条 AgentVN 文档片段，正在请求模型...`);

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
          onStatus: setStatus,
          onDelta: (delta) => {
            setMessages((current) => appendToLastAssistantMessage(current, delta));
          },
          onCitations: (nextCitations) => setCitations(nextCitations),
          onFinal: (finalValue) => {
            setMessages((current) => replaceLastAssistantMessage(current, finalValue.answer || "模型没有返回内容。"));
            setCitations(finalValue.citations);
          },
        }
      );
      setMessages((current) => replaceLastAssistantMessage(current, response.answer || "模型没有返回内容。"));
      setCitations(response.citations);
      setStatus(undefined);
    } catch (error) {
      reportFrontendError("editor.assistant", error, { operation: "chat" });
      const message = error instanceof Error ? error.message : "助手请求失败。";
      setMessages((current) => replaceLastAssistantMessage(current, `请求失败：${message}`));
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  function clearConversation() {
    setMessages([]);
    setCitations([]);
    setBudgetReport(undefined);
    setStatus(undefined);
  }

  return (
    <section className={`assistant-chat-panel ai-glow-surface ai-flow-border${loading ? " ai-flow-active" : ""}`}>
      <header className="assistant-workbench-header">
        <div>
          <span className="panel-kicker">AgentVN 文档助手</span>
          <h3>大模型助手</h3>
        </div>
        <div className="assistant-header-actions">
          {status && <span className="assistant-inline-status">{status}</span>}
          <button type="button" data-help-key="assistant.clear" onClick={clearConversation}>
            <Eraser size={16} /> 清空对话
          </button>
        </div>
      </header>

      <div className="assistant-context-strip">
        <Bot size={15} />
        <span>会参考 AgentVN 文档与当前编辑上下文，结果请甄别。</span>
        {budgetReport?.compression_triggered && <span className="assistant-budget-pill">{contextBudgetHint(budgetReport)}</span>}
        <details className="assistant-context-details">
          <summary>
            说明 <ChevronDown size={13} />
          </summary>
          <p>{disclaimer}</p>
        </details>
      </div>

      <div className="assistant-chat-body" aria-live="polite" ref={bodyRef}>
        {messages.length === 0 ? (
          <div className="assistant-empty">
            <Bot size={24} />
            <strong>询问 AgentVN 的编辑方法</strong>
            <p>描述你想实现的效果，助手会结合文档、当前节点和编辑器功能给出操作建议。</p>
            <div className="assistant-quick-questions">
              {quickQuestions.map((question) => (
                <button type="button" key={question} data-help-key="assistant.quickQuestion" onClick={() => void sendQuestion(question)}>
                  {question}
                </button>
              ))}
            </div>
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
                      {citations.map((citation) => (
                        <span key={citation.id}>{citation.title}</span>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="assistant-input-area">
        <div className="assistant-input-field">
          <small>{disclaimer}</small>
          <textarea
            value={input}
            rows={3}
            aria-label="向大模型助手提问"
            data-help-key="assistant.input"
            placeholder="描述你想在编辑器里实现的效果，或询问某个控件/流程怎么使用。"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendQuestion();
              }
            }}
          />
        </div>
        <button type="button" className={`ai-glow-button${loading ? " ai-flow-active" : ""}`} data-help-key="assistant.send" disabled={loading || !input.trim()} onClick={() => void sendQuestion()}>
          <Send size={16} /> {loading ? "生成中" : "发送"}
        </button>
      </div>
    </section>
  );
}
