import type { AssistantDocChunk } from "../assistant/types";
import type { ProviderSelectionPayload } from "../api/types";

export type ContextPriority = "P0" | "P1" | "P2" | "P3";

export interface ContextBudgetReport {
  budget_tokens: number;
  reserved_tokens: number;
  available_input_tokens: number;
  estimated_input_tokens: number;
  compression_triggered: boolean;
  compression_level: "none" | "compressed_summary" | "chunked_merge" | "fallback_trimmed" | "trimmed" | "chunked";
  chunks_available?: number;
  chunks_used?: number;
  summaries_created?: number;
  dropped_chunks?: number;
  dropped_low_priority_chars?: number;
  fallback_trimmed_chars?: number;
  priority_counts?: Partial<Record<ContextPriority, number>>;
  notes: string[];
}

export interface PrioritizedContextItem {
  id: string;
  priority: ContextPriority;
  title: string;
  text: string;
  summary?: string;
  tags?: string[];
}

export interface PackedAssistantContext {
  chunks: AssistantDocChunk[];
  editorContext: string;
  report: ContextBudgetReport;
}

export interface PackedTextContext {
  text: string;
  report: ContextBudgetReport;
}

const DEFAULT_CONTEXT_BUDGET = 24000;
const MIN_RESERVED_TOKENS = 1600;
const RESERVE_RATIO = 0.3;
export const CJK_CHARS_PER_TOKEN = 0.7;

export function estimateTokensFromCjkCharCount(charCount: number): number {
  if (!Number.isFinite(charCount) || charCount <= 0) return 0;
  return Math.ceil((charCount * 10) / 7);
}

export function estimateTextTokens(text: string | null | undefined): number {
  const value = text ?? "";
  const cjk = (value.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = value.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9_]+(?:[-'][A-Za-z0-9_]+)*/g)?.length ?? 0;
  const punctuation = value.replace(/[\u3400-\u9fffA-Za-z0-9_\s]/g, "").length;
  return Math.ceil((cjk * 10) / 7 + latin * 1.3 + punctuation * 0.25);
}

export function getContextBudgetTokens(selection?: ProviderSelectionPayload | null): number {
  const configured = Number(selection?.parameters?.context_budget_tokens ?? DEFAULT_CONTEXT_BUDGET);
  if (!Number.isFinite(configured)) return DEFAULT_CONTEXT_BUDGET;
  return Math.max(4000, Math.min(200000, Math.floor(configured)));
}

export function getAvailableInputTokens(selection?: ProviderSelectionPayload | null): { budget: number; reserved: number; available: number } {
  const budget = getContextBudgetTokens(selection);
  const maxTokens = Number(selection?.parameters?.max_tokens ?? 0);
  const reserved = Math.max(MIN_RESERVED_TOKENS, Math.ceil(budget * RESERVE_RATIO), Number.isFinite(maxTokens) ? Math.ceil(maxTokens * 1.25) : 0);
  return { budget, reserved, available: Math.max(1000, budget - reserved) };
}

export function tokensToApproxChars(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.floor((tokens * 7) / 10);
}

export function trimToTokenBudget(text: string, maxTokens: number): { text: string; estimatedTokens: number; trimmedChars: number } {
  const estimatedTokens = estimateTextTokens(text);
  if (estimatedTokens <= maxTokens) return { text, estimatedTokens, trimmedChars: 0 };
  const maxChars = tokensToApproxChars(maxTokens);
  if (text.length <= maxChars) return { text, estimatedTokens, trimmedChars: 0 };
  const headChars = Math.floor(maxChars * 0.68);
  const tailChars = Math.max(0, maxChars - headChars - 180);
  const next = [
    text.slice(0, headChars),
    "\n\n[ContextBudget: 中间低优先级内容因上下文预算不足被省略]\n\n",
    tailChars > 0 ? text.slice(-tailChars) : "",
  ].join("");
  return {
    text: next,
    estimatedTokens: estimateTextTokens(next),
    trimmedChars: Math.max(0, text.length - next.length),
  };
}

export function packTextContext(text: string, selection?: ProviderSelectionPayload | null, options?: { minimumKeepTokens?: number; note?: string }): PackedTextContext {
  const { budget, reserved, available } = getAvailableInputTokens(selection);
  const keepTokens = Math.max(options?.minimumKeepTokens ?? 1000, available);
  const before = estimateTextTokens(text);
  const trimmed = trimToTokenBudget(text, keepTokens);
  const compression = trimmed.trimmedChars > 0;
  return {
    text: trimmed.text,
    report: {
      budget_tokens: budget,
      reserved_tokens: reserved,
      available_input_tokens: available,
      estimated_input_tokens: before,
      compression_triggered: compression,
      compression_level: compression ? "fallback_trimmed" : "none",
      dropped_low_priority_chars: trimmed.trimmedChars,
      fallback_trimmed_chars: trimmed.trimmedChars,
      notes: [
        options?.note ?? "P0/P1 上下文优先保留，低优先级长文本在超预算时裁剪。",
        compression ? "已触发上下文压缩；关键标识和当前节点内容应保持在请求中。" : "未触发上下文压缩。",
      ],
    },
  };
}

function compactForSummary(text: string, maxChars = 900): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= maxChars) return value;
  const head = Math.floor(maxChars * 0.72);
  const tail = Math.max(0, maxChars - head - 24);
  return `${value.slice(0, head)} ... ${tail > 0 ? value.slice(-tail) : ""}`.trim();
}

function formatPrioritizedBlock(item: PrioritizedContextItem, mode: "full" | "summary"): string {
  const tags = item.tags?.length ? `\nTags: ${item.tags.join(", ")}` : "";
  const body = mode === "full" ? item.text : (item.summary || compactForSummary(item.text));
  return [`[${item.priority}${mode === "summary" ? " Summary" : ""}] ${item.title}`, `ID: ${item.id}${tags}`, body].join("\n");
}

export function packPrioritizedContext(
  items: PrioritizedContextItem[],
  selection?: ProviderSelectionPayload | null,
  options?: { minimumKeepTokens?: number; note?: string },
): PackedTextContext {
  const { budget, reserved, available } = getAvailableInputTokens(selection);
  const keepTokens = Math.max(options?.minimumKeepTokens ?? 1000, available);
  const before = items.reduce((sum, item) => sum + estimateTextTokens(item.text) + estimateTextTokens(item.summary), 0);
  const priorityCounts = items.reduce<Partial<Record<ContextPriority, number>>>((counts, item) => {
    counts[item.priority] = (counts[item.priority] ?? 0) + 1;
    return counts;
  }, {});
  const blocks: string[] = [];
  let summariesCreated = 0;
  let droppedChunks = 0;
  let droppedLowPriorityChars = 0;
  let fallbackTrimmedChars = 0;

  function currentTokensWith(nextBlock?: string): number {
    return estimateTextTokens(nextBlock ? [...blocks, nextBlock].join("\n\n") : blocks.join("\n\n"));
  }

  function addBlock(block: string): boolean {
    if (currentTokensWith(block) <= keepTokens) {
      blocks.push(block);
      return true;
    }
    return false;
  }

  for (const item of items.filter((entry) => entry.priority === "P0")) {
    const block = formatPrioritizedBlock(item, "full");
    if (addBlock(block)) continue;
    const remaining = Math.max(800, keepTokens - currentTokensWith());
    const trimmed = trimToTokenBudget(block, remaining);
    blocks.push(trimmed.text);
    fallbackTrimmedChars += trimmed.trimmedChars;
  }

  for (const item of items.filter((entry) => entry.priority === "P1")) {
    const fullBlock = formatPrioritizedBlock(item, "full");
    if (addBlock(fullBlock)) continue;
    const summaryBlock = formatPrioritizedBlock(item, "summary");
    if (addBlock(summaryBlock)) {
      summariesCreated += 1;
    } else {
      droppedChunks += 1;
      droppedLowPriorityChars += item.text.length;
    }
  }

  for (const item of items.filter((entry) => entry.priority === "P2")) {
    const summaryBlock = formatPrioritizedBlock(item, "summary");
    if (addBlock(summaryBlock)) {
      summariesCreated += 1;
    } else {
      droppedChunks += 1;
      droppedLowPriorityChars += item.text.length;
    }
  }

  for (const item of items.filter((entry) => entry.priority === "P3")) {
    const summaryBlock = formatPrioritizedBlock(item, "summary");
    if (currentTokensWith(summaryBlock) <= Math.floor(keepTokens * 0.95)) {
      blocks.push(summaryBlock);
      summariesCreated += 1;
    } else {
      droppedChunks += 1;
      droppedLowPriorityChars += item.text.length;
    }
  }

  let text = blocks.join("\n\n");
  const finalTrim = trimToTokenBudget(text, keepTokens);
  if (finalTrim.trimmedChars > 0) {
    text = finalTrim.text;
    fallbackTrimmedChars += finalTrim.trimmedChars;
  }
  const compression = summariesCreated > 0 || droppedChunks > 0 || fallbackTrimmedChars > 0 || before > keepTokens;
  const compressionLevel: ContextBudgetReport["compression_level"] = fallbackTrimmedChars > 0
    ? "fallback_trimmed"
    : summariesCreated > 0 || droppedChunks > 0
      ? "compressed_summary"
      : "none";

  return {
    text,
    report: {
      budget_tokens: budget,
      reserved_tokens: reserved,
      available_input_tokens: available,
      estimated_input_tokens: before,
      compression_triggered: compression,
      compression_level: compressionLevel,
      chunks_available: items.length,
      chunks_used: blocks.length,
      summaries_created: summariesCreated,
      dropped_chunks: droppedChunks,
      dropped_low_priority_chars: droppedLowPriorityChars,
      fallback_trimmed_chars: fallbackTrimmedChars,
      priority_counts: priorityCounts,
      notes: [
        options?.note ?? "上下文按 P0/P1/P2/P3 优先级打包：当前任务完整保留，远端资料摘要化。",
        compression ? "上下文超过预算，已优先保留 P0 当前节点并压缩或丢弃低优先级内容。" : "上下文未超过预算，已完整打包。",
      ],
    },
  };
}

export function packAssistantContext(input: {
  question: string;
  chunks: AssistantDocChunk[];
  editorContext: string;
  messages?: Array<{ content: string }>;
  providerSelection?: ProviderSelectionPayload | null;
}): PackedAssistantContext {
  const { budget, reserved, available } = getAvailableInputTokens(input.providerSelection);
  const fixedTokens = estimateTextTokens(input.question) + estimateTextTokens(input.editorContext) + estimateTextTokens(input.messages?.map((item) => item.content).join("\n") ?? "");
  const chunkBudget = Math.max(800, available - fixedTokens);
  const selected: AssistantDocChunk[] = [];
  let usedChunkTokens = 0;
  let summariesCreated = 0;

  for (const chunk of input.chunks) {
    const chunkTokens = estimateTextTokens(`${chunk.title}\n${chunk.tags.join(" ")}\n${chunk.text}`);
    if (selected.length > 0 && usedChunkTokens + chunkTokens > chunkBudget) {
      const summary = compactForSummary(chunk.text, 700);
      const summaryTokens = estimateTextTokens(`${chunk.title}\n${chunk.tags.join(" ")}\n${summary}`);
      if (usedChunkTokens + summaryTokens <= chunkBudget) {
        selected.push({ ...chunk, text: `[上下文预算摘要]\n${summary}` });
        usedChunkTokens += summaryTokens;
        summariesCreated += 1;
      }
      continue;
    }
    if (chunkTokens > chunkBudget && selected.length === 0) {
      const trimmed = trimToTokenBudget(chunk.text, Math.max(400, chunkBudget - estimateTextTokens(chunk.title)));
      selected.push({ ...chunk, text: trimmed.text });
      usedChunkTokens += estimateTextTokens(trimmed.text);
      summariesCreated += trimmed.trimmedChars > 0 ? 1 : 0;
      continue;
    }
    selected.push(chunk);
    usedChunkTokens += chunkTokens;
  }

  const before = fixedTokens + input.chunks.reduce((sum, chunk) => sum + estimateTextTokens(chunk.text), 0);
  const droppedChunks = Math.max(0, input.chunks.length - selected.length);
  return {
    chunks: selected,
    editorContext: input.editorContext,
    report: {
      budget_tokens: budget,
      reserved_tokens: reserved,
      available_input_tokens: available,
      estimated_input_tokens: before,
      compression_triggered: before > available || droppedChunks > 0 || summariesCreated > 0,
      compression_level: droppedChunks > 0 || summariesCreated > 0 ? "compressed_summary" : before > available ? "fallback_trimmed" : "none",
      chunks_available: input.chunks.length,
      chunks_used: selected.length,
      summaries_created: summariesCreated,
      dropped_chunks: droppedChunks,
      notes: [
        "助手文档按检索分数进入上下文；超预算时保留高分片段并摘要化低分片段。",
        droppedChunks > 0 ? "部分参考文档未发送给模型，回答区会显示压缩提示。" : "参考文档未超过本次预算或已用摘要纳入。",
      ],
    },
  };
}
