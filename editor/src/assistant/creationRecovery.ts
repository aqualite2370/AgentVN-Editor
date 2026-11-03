import type { AssistantCreationProcess } from "../api/types";
import type { AssetRef } from "../types/assets";
import { validateUISkinLayout, type UISkinLayout } from "../../../shared/cartridge/uiSkin";
import type { AssistantConversation } from "./conversationHistory";
import { assistantCreationDefaultRect } from "./creationPlacement";
import {
  parseAssistantCreationDraftBatchValue,
  validateAssistantCreationElementEditReviewItem,
  isAssistantCreationProjectBaseline,
  type AssistantCreationAuthorizedAsset,
  type AssistantCreationElementEditTarget,
  type AssistantCreationProjectBaseline,
  type AssistantCreationReviewItem,
} from "./creationAgent";

/** Local only. Contains no provider selection, credential or model request. */
export interface AssistantCreationPendingProcess {
  version: 1;
  id: string;
  baseline?: AssistantCreationProjectBaseline;
  authorizedAssets: AssistantCreationAuthorizedAsset[];
  targets: AssistantCreationElementEditTarget[];
  previewLayout?: UISkinLayout;
  previewAssets?: AssetRef[];
}

export function validateAssistantCreationPendingProcess(value: unknown): value is AssistantCreationPendingProcess {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pending = value as AssistantCreationPendingProcess;
  if (Object.keys(value).some(key => !["version", "id", "baseline", "authorizedAssets", "targets", "previewLayout", "previewAssets"].includes(key))
    || pending.version !== 1 || typeof pending.id !== "string" || !pending.id || pending.id.length > 180
    || (pending.baseline !== undefined && !isAssistantCreationProjectBaseline(pending.baseline))
    || !Array.isArray(pending.authorizedAssets) || pending.authorizedAssets.length > 128
    || !Array.isArray(pending.targets) || pending.targets.length > 8) return false;
  if (pending.previewLayout && (!validateUISkinLayout(pending.previewLayout).ok || pending.previewLayout.layout_type !== "renpy")) return false;
  if (pending.previewAssets && (!Array.isArray(pending.previewAssets) || pending.previewAssets.length > 4096
    || pending.previewAssets.some(asset => !asset || typeof asset.asset_id !== "string" || !asset.metadata
      || Object.keys(asset.metadata).some(key => !["filename", "mime_type", "data_url", "blob_url", "url", "filePath", "project_path", "bytes"].includes(key))))) return false;
  let bytes = 0;
  const ids = new Set<string>();
  for (const asset of pending.authorizedAssets) {
    if (!asset || typeof asset.id !== "string" || !asset.id || ids.has(asset.id)
      || typeof asset.filename !== "string" || typeof asset.mimeType !== "string"
      || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(asset.mimeType)
      || !(asset.bytes instanceof Uint8Array) || !asset.bytes.length || asset.bytes.length > 8 * 1024 * 1024) return false;
    ids.add(asset.id); bytes += asset.bytes.length;
  }
  if (bytes > 32 * 1024 * 1024) return false;
  return pending.targets.every(target => target && typeof target === "object" && pending.baseline && validateAssistantCreationElementEditReviewItem({
    id: "pending-validation", baseline: pending.baseline, target,
    edit: { targetId: target.targetId, screenId: target.screenId, label: "pending-validation" }, included: true,
  })) && new Set(pending.targets.map(target => target.targetId)).size === pending.targets.length;
}

export function recoverAssistantCreationConversation(
  conversation: AssistantConversation, process: AssistantCreationProcess,
): AssistantConversation | undefined {
  const pending = conversation.creationPendingProcess;
  if (conversation.mode !== "creation" || !validateAssistantCreationPendingProcess(pending)
    || pending.id !== process.id || conversation.id !== process.conversationId
    || conversation.projectId !== process.projectId
    || (pending.baseline && pending.baseline.projectId !== conversation.projectId)
    || !["completed", "failed", "cancelled"].includes(process.status)) return undefined;
  const next = structuredClone(conversation);
  delete next.creationPendingProcess;
  next.updatedAt = new Date().toISOString();
  const replaceReply = (content: string) => {
    let index = next.messages.length - 1;
    while (index >= 0 && next.messages[index].role !== "assistant") index--;
    if (index >= 0) next.messages[index] = { role: "assistant", content };
    else next.messages.push({ role: "assistant", content });
  };
  if (process.status !== "completed" || !process.result) {
    replaceReply(process.status === "cancelled" ? "创作进程已取消。"
      : `草稿生成失败：${process.errorMessage || "执行进程已停止；未自动重复模型调用，请重新提交。"}`);
    return next;
  }
  const parsed = parseAssistantCreationDraftBatchValue(process.result, next.updatedAt, {
    authorizedAssets: pending.authorizedAssets, authorizedTargets: pending.targets,
  });
  if (!parsed.ok) {
    replaceReply(`未恢复草稿：${parsed.issues.join(" ")}；工程未修改。`);
    return next;
  }
  const drafts = (parsed.drafts ?? []).map(draft => ({ ...draft,
    ...(pending.baseline ? { projectBaseline: structuredClone(pending.baseline) } : {}) }));
  next.creationDraft = drafts[0] ?? next.creationDraft;
  next.creationReviewItems = drafts.length > 1 ? drafts.map((draft, index): AssistantCreationReviewItem => {
    const screenId = parsed.screenIds?.[index] ?? "title";
    return {
      id: `${process.id}:${index + 1}`, draft, screenId,
      rect: assistantCreationDefaultRect(index, drafts.length, screenId), included: true,
    };
  }) : undefined;
  const edits = (parsed.edits ?? []).map((edit, index) => {
    const target = pending.targets.find(candidate => candidate.targetId === edit.targetId);
    if (!target || !pending.baseline) throw new Error("恢复提案缺少提交时的授权与工程基线。");
    return { id: `${process.id}:edit:${index + 1}`, baseline: pending.baseline, target, edit, included: true };
  });
  next.creationElementEditItems = edits.length ? edits : undefined;
  replaceReply(`已恢复 ${drafts.length} 个组件候选、${edits.length} 项控件提案。请审核后应用；工程尚未修改。`);
  return next;
}
