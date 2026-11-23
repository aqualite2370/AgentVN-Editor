import { AlertTriangle, Clock3, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { OperationResultDialog } from "../common/OperationResultDialog";
import {
  assertEditorProjectRevision, captureEditorProjectRevision, EditorSaveSupersededError,
  editorProjectOwner, ownsEditorProject, restoreEditorTimelineProject,
} from "../../utils/editorProjectPersistence";
import { RoseTwoLoader } from "../common/RoseTwoLoader";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import type { EditorProjectFile } from "../../types/nodes";
import { parseProjectJson } from "../../utils/projectImport";
import {
  listProjectBackups,
  projectTimelineRecentLimit,
  readProjectBackup,
  TimelineUnavailableError,
  type ProjectBackupEntry,
} from "../../utils/projectTimeline";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

interface ProjectTimelinePanelProps {
  onRestore?: (project: EditorProjectFile, entry: ProjectBackupEntry) => void | Promise<void>;
}

function formatDate(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString();
}

function triggerLabel(trigger: string): string {
  if (trigger === "manual_save") return "保存工程";
  if (trigger === "return_home") return "返回主页";
  if (trigger === "auto_save") return "自动恢复点";
  if (trigger === "before_restore") return "恢复前保留";
  if (trigger === "legacy_animation_batch_migration") return "批量转换旧动画节点前";
  return trigger || "工程备份";
}

export function ProjectTimelinePanel({ onRestore = restoreEditorTimelineProject }: ProjectTimelinePanelProps) {
  const project = useProjectStore();
  const generation = useEditorStore(state => state.projectLoadGeneration);
  const setNotice = useEditorStore((state) => state.setNotice);
  const [entries, setEntries] = useState<ProjectBackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [pendingRestore, setPendingRestore] = useState<ProjectBackupEntry>();
  const [restoring, setRestoring] = useState(false);
  const sequence = useRef(0);
  const restoringRef = useRef<symbol | undefined>(undefined);

  async function refresh() {
    const owner = editorProjectOwner();
    const request = ++sequence.current;
    const current = () => request === sequence.current && ownsEditorProject(owner);
    setLoading(true);
    setError(undefined);
    try {
      const next = await listProjectBackups(owner.projectId);
      if (!current()) return;
      if (next.some(entry => entry.project_id !== owner.projectId)) throw new Error("时间线记录的工程归属不匹配。");
      setEntries(next);
    } catch (listError) {
      reportFrontendError("editor.timeline", listError, {
        operation: "list",
        projectId: project.projectId,
      });
      if (!current()) return;
      const message = listError instanceof TimelineUnavailableError
        ? listError.message
        : listError instanceof Error
          ? listError.message
          : "读取时间线失败。";
      setError(message);
      setNotice({
        tone: listError instanceof TimelineUnavailableError ? "warning" : "error",
        source: "项目时间线",
        message,
        detail: listError instanceof Error ? listError.stack : undefined,
        error: listError,
        action: "文件式时间线需要桌面版，并且 backup-timeline 文件夹需要可读写。",
      });
    } finally {
      if (current()) setLoading(false);
    }
  }

  useEffect(() => {
    restoringRef.current = undefined;
    setEntries([]);
    setPendingRestore(undefined);
    setRestoring(false);
    void refresh();
    return () => {
      sequence.current += 1;
      restoringRef.current = undefined;
    };
  }, [project.projectId, generation]);

  async function restore(entry: ProjectBackupEntry) {
    if (restoringRef.current) return;
    const owner = editorProjectOwner();
    const confirmed = captureEditorProjectRevision();
    const request = sequence.current;
    const current = () => request === sequence.current && ownsEditorProject(owner);
    const operation = Symbol("timeline-restore");
    restoringRef.current = operation;
    setRestoring(true);
    try {
      if (entry.project_id !== owner.projectId) throw new Error("该记录不属于当前工程。");
      const raw = await readProjectBackup(entry.file_name);
      if (!current()) return;
      assertEditorProjectRevision(confirmed);
      const parsed = parseProjectJson(JSON.parse(raw));
      if (!parsed.project) {
        throw new Error(parsed.error ?? "时间线备份不可用。");
      }
      if (parsed.project.project_id !== owner.projectId) throw new Error("备份内容的工程归属不匹配。");
      await onRestore(parsed.project, entry);
      if (useProjectStore.getState().projectId === owner.projectId
        && useEditorStore.getState().projectLoadGeneration === owner.generation + 1) {
        setNotice(`已恢复 ${formatDate(entry.timestamp_ms)} 的工程快照。`, "success");
      }
    } catch (restoreError) {
      reportFrontendError("editor.timeline", restoreError, {
        operation: "restore",
        projectId: project.projectId,
        backup: entry.file_name,
      });
      if (!current()) return;
      setError(restoreError instanceof Error ? restoreError.message : "恢复失败。");
      setNotice({
        tone: "error",
        source: "项目时间线",
        message: restoreError instanceof Error ? restoreError.message : "恢复时间线备份失败。",
        detail: restoreError instanceof Error ? restoreError.stack : undefined,
        error: restoreError,
        action: restoreError instanceof EditorSaveSupersededError
          ? "当前内容已变化，请重新选择时间线记录后再恢复。"
          : "请检查 backup-timeline 文件夹权限，以及目标备份文件是否仍然存在。",
      });
    } finally {
      // An old project's read may finish while the new project is restoring.
      // It must neither hold nor release the new operation's guard.
      if (restoringRef.current === operation) {
        restoringRef.current = undefined;
        if (request === sequence.current) setRestoring(false);
      }
    }
  }

  return (
    <section className="project-timeline-panel">
      <header>
        <div>
          <h3>时间线（最近 {projectTimelineRecentLimit} 次）</h3>
        </div>
        <button type="button" disabled={restoring} data-help-key="timeline.refresh" onClick={() => void refresh()}>
          刷新
        </button>
      </header>

      {loading && (
        <div className="timeline-state">
          <span className="timeline-state-loader" aria-hidden="true">
            <RoseTwoLoader particleCount={38} />
          </span>
          <span>正在读取工程备份...</span>
        </div>
      )}
      {!loading && error && (
        <div className="timeline-state is-warning">
          <AlertTriangle size={18} />
          <p>{error}</p>
        </div>
      )}
      {!loading && !error && entries.length === 0 && (
        <div className="timeline-empty">
          <Clock3 size={24} />
          <strong>还没有时间线记录</strong>
          <p>导出工程或返回项目主页可以保留备份。恢复其他备份前，也会保留当前工程。桌面版最近保留 {projectTimelineRecentLimit} 次。</p>
        </div>
      )}
      {!loading && !error && entries.length > 0 && (
        <div className="timeline-list" aria-label="工程时间线记录">
          {entries.map((entry) => (
            <article className="timeline-entry" key={entry.file_name}>
              <button type="button" disabled={restoring} data-help-key="timeline.entry" onClick={() => setPendingRestore(entry)}>
                <span className="timeline-entry-icon"><Clock3 size={16} /></span>
                <span className="timeline-entry-main">
                  <strong>{entry.title || "未命名视觉小说"}</strong>
                  <small>{formatDate(entry.timestamp_ms)} · {triggerLabel(entry.trigger)}</small>
                </span>
                <span className="timeline-entry-meta">
                  {entry.node_count ?? "?"} 节点 / {entry.edge_count ?? "?"} 连线
                </span>
              </button>
            </article>
          ))}
        </div>
      )}

      <OperationResultDialog open={Boolean(pendingRestore)} tone="warning" label="时间线"
        title="恢复这个时间点？" message={pendingRestore
          ? `恢复 ${formatDate(pendingRestore.timestamp_ms)} 的工程。当前内容会先保存为恢复点。` : ""}
        icon={<RotateCcw size={20} />} testId="timeline-restore-confirmation" confirmLabel="取消"
        busy={restoring} inertBackground reducedMotionDurationMs={120}
        contextAction={{ label: "恢复备份", onClick: () => pendingRestore ? restore(pendingRestore) : undefined }}
        onDismiss={() => setPendingRestore(undefined)} />
    </section>
  );
}
