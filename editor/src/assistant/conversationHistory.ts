import type { AssistantChatMessage, AssistantCitation } from "./types";
import {
  validateAssistantCreationElementEditReviewItem,
  validateAssistantCreationDraft,
  type AssistantCreationDraft,
  type AssistantCreationElementEditReviewItem,
  type AssistantCreationReviewItem,
} from "./creationAgent";
import type { UILayoutScreenId } from "../../../shared/cartridge/uiSkin";
import { validateAssistantCreationPendingProcess, type AssistantCreationPendingProcess } from "./creationRecovery";

export type AssistantConversationMode = "inquiry" | "creation";

export interface AssistantConversation {
  id: string;
  projectId: string;
  mode: AssistantConversationMode;
  title: string;
  messages: AssistantChatMessage[];
  citations: AssistantCitation[];
  creationDraft?: AssistantCreationDraft;
  creationReviewItems?: AssistantCreationReviewItem[];
  creationElementEditItems?: AssistantCreationElementEditReviewItem[];
  authorizedComponentIds?: string[];
  authorizedProjectAssetIds?: string[];
  creationPendingProcess?: AssistantCreationPendingProcess;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface AssistantConversationChange {
  projectId: string;
  mode: AssistantConversationMode;
  conversationId: string;
  kind: "saved" | "archived" | "deleted";
}

const databaseName = "agentvn-assistant-workbench";
const databaseVersion = 1;
const conversationStoreName = "conversations";
const modeValues = new Set<AssistantConversationMode>(["inquiry", "creation"]);
const layoutScreenIds = new Set<UILayoutScreenId>([
  "title", "player", "game_menu", "save_load", "preferences", "history", "gallery", "about", "help",
]);

function isCreationReviewItem(value: unknown): value is AssistantCreationReviewItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<AssistantCreationReviewItem>;
  const rect = item.rect;
  return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 180
    && validateAssistantCreationDraft(item.draft)
    && layoutScreenIds.has(item.screenId as UILayoutScreenId)
    && Boolean(rect) && [rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite)
    && Number(rect?.x) >= 0 && Number(rect?.y) >= 0
    && Number(rect?.width) > 0 && Number(rect?.height) > 0
    && Number(rect?.x) + Number(rect?.width) <= 100
    && Number(rect?.y) + Number(rect?.height) <= 100
    && typeof item.included === "boolean";
}

let databasePromise: Promise<IDBDatabase> | undefined;
const conversationChangeListeners = new Set<(change: AssistantConversationChange) => void>();
let conversationChangeChannel: BroadcastChannel | undefined;

function isConversationChange(value: unknown): value is AssistantConversationChange {
  if (!value || typeof value !== "object") return false;
  const change = value as Partial<AssistantConversationChange>;
  return typeof change.projectId === "string"
    && modeValues.has(change.mode as AssistantConversationMode)
    && typeof change.conversationId === "string"
    && ["saved", "archived", "deleted"].includes(String(change.kind));
}

function emitConversationChange(change: AssistantConversationChange, broadcast: boolean): void {
  for (const listener of conversationChangeListeners) listener(change);
  if (broadcast) {
    try {
      conversationChangeChannel?.postMessage(change);
    } catch {
      // Local history remains valid when cross-window notifications are unavailable.
    }
  }
}

export function subscribeAssistantConversationChanges(
  listener: (change: AssistantConversationChange) => void,
): () => void {
  conversationChangeListeners.add(listener);
  if (!conversationChangeChannel && typeof BroadcastChannel !== "undefined") {
    try {
      conversationChangeChannel = new BroadcastChannel("agentvn-assistant-conversation-changes");
      conversationChangeChannel.onmessage = (event: MessageEvent<unknown>) => {
        if (isConversationChange(event.data)) emitConversationChange(event.data, false);
      };
    } catch {
      conversationChangeChannel = undefined;
    }
  }
  return () => {
    conversationChangeListeners.delete(listener);
    if (conversationChangeListeners.size === 0 && conversationChangeChannel) {
      conversationChangeChannel.close();
      conversationChangeChannel = undefined;
    }
  };
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前环境不支持本机会话历史存储。"));
  }
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(conversationStoreName)) {
        const store = database.createObjectStore(conversationStoreName, { keyPath: "id" });
        store.createIndex("projectModeUpdated", ["projectId", "mode", "updatedAt"]);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error ?? new Error("无法打开本机会话历史。"));
    };
    request.onblocked = () => {
      databasePromise = undefined;
      reject(new Error("会话历史数据库正被其他编辑器窗口升级，请关闭旧窗口后重试。"));
    };
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("会话历史操作失败。"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("会话历史写入已中止。"));
    transaction.onerror = () => reject(transaction.error ?? new Error("会话历史写入失败。"));
  });
}

function isAssistantConversation(value: unknown): value is AssistantConversation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AssistantConversation>;
  return typeof candidate.id === "string"
    && typeof candidate.projectId === "string"
    && modeValues.has(candidate.mode as AssistantConversationMode)
    && typeof candidate.title === "string"
    && Array.isArray(candidate.messages)
    && candidate.messages.every((message) => message
      && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string")
    && Array.isArray(candidate.citations)
    && (candidate.creationPendingProcess === undefined || (candidate.mode === "creation"
      && validateAssistantCreationPendingProcess(candidate.creationPendingProcess)))
    && (candidate.creationDraft === undefined
      || (candidate.mode === "creation" && validateAssistantCreationDraft(candidate.creationDraft)))
    && (candidate.creationReviewItems === undefined
      || (candidate.mode === "creation"
        && Array.isArray(candidate.creationReviewItems)
        && candidate.creationReviewItems.length >= 1
        && candidate.creationReviewItems.length <= 16
        && candidate.creationReviewItems.every(isCreationReviewItem)
        && new Set(candidate.creationReviewItems.map((item) => item.id)).size === candidate.creationReviewItems.length))
    && (candidate.creationElementEditItems === undefined
      || (candidate.mode === "creation"
        && Array.isArray(candidate.creationElementEditItems)
        && candidate.creationElementEditItems.length >= 1
        && candidate.creationElementEditItems.length <= 8
        && candidate.creationElementEditItems.every(validateAssistantCreationElementEditReviewItem)
        && new Set(candidate.creationElementEditItems.map((item) => item.id)).size
          === candidate.creationElementEditItems.length))
    && (candidate.authorizedComponentIds === undefined
      || (candidate.mode === "creation"
        && candidate.authorizedComponentIds.length <= 8
        && candidate.authorizedComponentIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 160)
        && new Set(candidate.authorizedComponentIds).size === candidate.authorizedComponentIds.length))
    && (candidate.authorizedProjectAssetIds === undefined
      || (candidate.mode === "creation" && Array.isArray(candidate.authorizedProjectAssetIds)
        && candidate.authorizedProjectAssetIds.length <= 16
        && candidate.authorizedProjectAssetIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 160)
        && new Set(candidate.authorizedProjectAssetIds).size === candidate.authorizedProjectAssetIds.length))
    && typeof candidate.createdAt === "string"
    && typeof candidate.updatedAt === "string";
}

export function createAssistantConversationId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `assistant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function listAssistantConversations(
  projectId: string,
  mode: AssistantConversationMode,
): Promise<AssistantConversation[]> {
  const database = await openDatabase();
  const transaction = database.transaction(conversationStoreName, "readonly");
  const done = transactionDone(transaction);
  const rows = await requestResult(transaction.objectStore(conversationStoreName).index("projectModeUpdated").getAll(
    IDBKeyRange.bound([projectId, mode, ""], [projectId, mode, "\uffff"]),
  ));
  await done;
  return rows
    .filter(isAssistantConversation)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveAssistantConversation(conversation: AssistantConversation): Promise<void> {
  if (!isAssistantConversation(conversation)) {
    throw new Error("会话内容无效，未写入历史记录。");
  }
  const database = await openDatabase();
  const transaction = database.transaction(conversationStoreName, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(conversationStoreName).put(conversation);
  await done;
  emitConversationChange({
    projectId: conversation.projectId,
    mode: conversation.mode,
    conversationId: conversation.id,
    kind: "saved",
  }, true);
}

/** Compare-and-swap: stale recovery must not resurrect deleted/reviewed history. */
export async function saveAssistantConversationRecovery(
  previous: AssistantConversation, recovered: AssistantConversation,
): Promise<boolean> {
  if (!previous.creationPendingProcess || !isAssistantConversation(recovered)
    || previous.id !== recovered.id || previous.projectId !== recovered.projectId
    || previous.mode !== "creation" || recovered.mode !== "creation") return false;
  const database = await openDatabase();
  const transaction = database.transaction(conversationStoreName, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(conversationStoreName);
  const latest = await requestResult(store.get(previous.id));
  if (!isAssistantConversation(latest) || latest.projectId !== previous.projectId
    || latest.mode !== previous.mode || latest.updatedAt !== previous.updatedAt
    || latest.creationPendingProcess?.id !== previous.creationPendingProcess.id) {
    transaction.abort(); await done.catch(() => undefined); return false;
  }
  store.put(recovered); await done;
  emitConversationChange({projectId: previous.projectId, mode: "creation", conversationId: previous.id, kind: "saved"}, true);
  return true;
}

export async function updateAssistantConversationArchive(
  projectId: string,
  mode: AssistantConversationMode,
  conversationId: string,
  archived: boolean,
): Promise<AssistantConversation | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(conversationStoreName, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(conversationStoreName);
  const conversation = await requestResult(store.get(conversationId));
  if (!isAssistantConversation(conversation)
    || conversation.projectId !== projectId || conversation.mode !== mode) {
    transaction.abort();
    await done.catch(() => undefined);
    return undefined;
  }
  const updated = {
    ...conversation,
    archivedAt: archived ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  };
  store.put(updated);
  await done;
  emitConversationChange({
    projectId,
    mode,
    conversationId,
    kind: "archived",
  }, true);
  return updated;
}

export async function deleteAssistantConversation(
  projectId: string,
  mode: AssistantConversationMode,
  conversationId: string,
): Promise<boolean> {
  const database = await openDatabase();
  const transaction = database.transaction(conversationStoreName, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(conversationStoreName);
  const conversation = await requestResult(store.get(conversationId));
  if (!isAssistantConversation(conversation)
    || conversation.projectId !== projectId || conversation.mode !== mode) {
    transaction.abort();
    await done.catch(() => undefined);
    return false;
  }
  store.delete(conversationId);
  await done;
  emitConversationChange({
    projectId,
    mode,
    conversationId,
    kind: "deleted",
  }, true);
  return true;
}

export function newAssistantConversation(
  projectId: string,
  mode: AssistantConversationMode,
  now = new Date().toISOString(),
): AssistantConversation {
  return {
    id: createAssistantConversationId(),
    projectId,
    mode,
    title: "新对话",
    messages: [],
    citations: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function assistantConversationTitle(messages: AssistantChatMessage[]): string {
  const firstQuestion = messages.find((message) => message.role === "user")?.content?.trim();
  if (!firstQuestion) return "新对话";
  return firstQuestion.replace(/\s+/g, " ").slice(0, 48);
}
