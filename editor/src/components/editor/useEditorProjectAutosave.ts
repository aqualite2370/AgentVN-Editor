import { useEffect } from "react";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { captureEditorProject, EditorSaveSupersededError, editorProjectOwner, ownsEditorProject, persistEditorProject } from "../../utils/editorProjectPersistence";
import { writeProjectBackup } from "../../utils/projectTimeline";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { stableSerialize } from "../../utils/stableSerialize";
import type { EditorProjectFile } from "../../types/nodes";

function recoveryMetadataRevision(project: EditorProjectFile): string {
  // Export timestamps and graph measurement/selection changes are not new edits.
  // Compare the JSON representation actually persisted by the backend: optional
  // undefined properties disappear on that round-trip and are not author edits.
  return stableSerialize(JSON.parse(JSON.stringify({
    projectId: project.project_id, title: project.title, author: project.author,
    createdAt: project.created_at, assets: project.asset_manifest, settings: project.editor_settings,
  })));
}

/** One coalesced graph+metadata writer; switching workspaces flushes pending edits. */
export function useEditorProjectAutosave() {
  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let deadlineTimer: number | undefined;
    let inFlight = false;
    let pending = false;
    let recoveryOwner: ReturnType<typeof editorProjectOwner> | undefined = editorProjectOwner();
    let recoveredMetadata = recoveryMetadataRevision(captureEditorProject());
    let persistedMetadata = recoveredMetadata;
    let recoveryRetry = false;
    const resetRecoveryOwner = () => {
      recoveryOwner = editorProjectOwner();
      recoveredMetadata = recoveryMetadataRevision(captureEditorProject());
      persistedMetadata = recoveredMetadata;
      recoveryRetry = false;
    };
    const flush = async () => {
      window.clearTimeout(timer);
      timer = undefined;
      window.clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
      if (disposed) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      const owner = editorProjectOwner();
      if (!recoveryOwner || !ownsEditorProject(recoveryOwner)) resetRecoveryOwner();
      try {
        const saved = await persistEditorProject();
        if (!disposed && ownsEditorProject(owner)) {
          const revision = recoveryMetadataRevision(saved.snapshot);
          // Disk success is independent of the optional recovery-point write.
          persistedMetadata = revision;
          if ((saved.wasDirty || recoveryRetry || revision !== recoveredMetadata) && "__TAURI_INTERNALS__" in window) {
            try {
              await writeProjectBackup(saved.snapshot, "auto_save");
              if (!disposed && ownsEditorProject(owner)) {
                recoveredMetadata = revision;
                recoveryRetry = false;
              }
            } catch (error) {
              reportFrontendError("editor.timeline", error, { operation: "auto-save-backup", projectId: owner.projectId });
              if (!disposed && ownsEditorProject(owner)) {
                recoveryRetry = true;
                useEditorStore.getState().setNotice({
                  tone: "warning", source: "时间线", message: "工程已保存，但本次恢复点写入失败。",
                  detail: error instanceof Error ? error.message : String(error),
                  action: "请检查备份目录的权限和可用空间，再保存工程。",
                });
              }
            }
          } else {
            recoveredMetadata = revision;
            recoveryRetry = false;
          }
        }
      } catch (error) {
        if (!(error instanceof EditorSaveSupersededError)) {
          reportFrontendError("editor.project", error, { operation: "autosave", projectId: owner.projectId });
          if (!disposed && ownsEditorProject(owner)) {
            recoveryRetry = true;
            useEditorStore.getState().setNotice({
              tone: "error", source: "自动保存", message: "自动保存失败，当前修改仍保留在编辑器中。",
              detail: error instanceof Error ? error.message : String(error), action: "请恢复服务或磁盘权限后重试保存。",
            });
          }
        }
      } finally {
        inFlight = false;
        if (!disposed && pending) { pending = false; void flush(); }
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void flush(); }, 800);
      // Typing and dragging may never pause for 800ms. Keep the deadline from
      // the first edit, while still coalescing writes through the shared queue.
      if (deadlineTimer === undefined) {
        deadlineTimer = window.setTimeout(() => { void flush(); }, 5000);
      }
    };
    const stopGraph = useEditorStore.subscribe((next, previous) => {
      if (next.projectLoadGeneration !== previous.projectLoadGeneration) {
        window.clearTimeout(timer);
        timer = undefined;
        window.clearTimeout(deadlineTimer);
        deadlineTimer = undefined;
        pending = false;
        recoveryOwner = undefined;
        recoveryRetry = false;
      }
      if (next.nodes !== previous.nodes || next.edges !== previous.edges || next.viewport !== previous.viewport
        || next.memoryMode !== previous.memoryMode) schedule();
    });
    const stopMetadata = useProjectStore.subscribe((next, previous) => {
      if (!recoveryOwner || !ownsEditorProject(recoveryOwner)) resetRecoveryOwner();
      if (next.projectId !== previous.projectId || next.title !== previous.title || next.author !== previous.author
        || next.assetManifest !== previous.assetManifest || next.settings !== previous.settings) schedule();
    });
    const flushPending = () => { if (timer !== undefined || pending || recoveryRetry || useEditorStore.getState().dirty) void flush(); };
    const hidden = () => { if (document.visibilityState === "hidden") flushPending(); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      // pagehide cannot keep an HTTP request alive. Ask before navigation while
      // author content or a save is pending; never treat a failed backup alone
      // as unsaved data after the database acknowledged the actual content.
      if (inFlight || pending || useEditorStore.getState().dirty
        || recoveryMetadataRevision(captureEditorProject()) !== persistedMetadata) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("agentvn:workspace-surface-changed", flushPending);
    window.addEventListener("pagehide", flushPending);
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", hidden);
    if (useEditorStore.getState().dirty) schedule();
    return () => {
      disposed = true;
      pending = false;
      window.clearTimeout(timer);
      window.clearTimeout(deadlineTimer);
      stopGraph(); stopMetadata();
      window.removeEventListener("agentvn:workspace-surface-changed", flushPending);
      window.removeEventListener("pagehide", flushPending);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
}
