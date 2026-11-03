import { useEffect, useRef, useSyncExternalStore } from "react";
import { backendClient } from "../api/backendClient";
import { listAssistantConversations } from "./conversationHistory";
import { getAssistantCreationProcesses, subscribeAssistantCreationProcesses } from "./creationProcessQueue";

/** Reattach an existing local tool consumer after the Editor page is reloaded. */
export function useAssistantCreationRecoveryWindow(
  projectId: string,
  windowOpen: boolean,
  restore: (conversationId: string) => void,
) {
  const processes = useSyncExternalStore(subscribeAssistantCreationProcesses, getAssistantCreationProcesses,
    getAssistantCreationProcesses);
  const restoreRef = useRef(restore);
  const projectRef = useRef(projectId);
  restoreRef.current = restore;
  projectRef.current = projectId;
  const owner = processes.find(process => process.projectId === projectId && process.status === "running");
  const events = owner?.toolEvents;
  const lastEvent = events?.[events.length - 1];

  useEffect(() => {
    if (windowOpen || !owner || !projectId) return;
    let disposed = false;
    const owns = () => !disposed && projectRef.current === projectId;
    void (async () => {
      const conversations = await listAssistantConversations(projectId, "creation");
      if (!owns()) return;
      const conversation = conversations.find(item => !item.archivedAt && item.projectId === projectId
        && item.id === owner.conversationId && item.creationPendingProcess?.id === owner.id);
      // A public task from another WebView has no local consent snapshot here.
      if (!conversation) return;
      const live = await backendClient.getAssistantCreationProcess(owner.id);
      if (!owns() || live.status !== "running" || !live.localToolRequest
        || live.projectId !== projectId || live.conversationId !== conversation.id
        || live.id !== conversation.creationPendingProcess?.id) return;
      restoreRef.current(conversation.id);
    })().catch(() => {
      // A missing/changed task cannot grant authority to start a replacement.
      // Existing task diagnostics and timeout/cancel handling remain authoritative.
    });
    return () => { disposed = true; };
  }, [projectId, windowOpen, owner?.id, owner?.conversationId, lastEvent?.time, lastEvent?.status]);
}
