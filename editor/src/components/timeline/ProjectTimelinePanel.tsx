import { AlertTriangle, Clock3, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  onRestore: (project: EditorProjectFile, entry: ProjectBackupEntry) => void | Promise<void>;
}

function formatDate(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString();
}

function triggerLabel(trigger: string): string {
  if (trigger === "manual_save") return "保存工程";
  if (trigger === "return_home") return "返回主页";
  if (trigger === "legacy_animation_batch_migration") return "批量转换旧动画节点前";
  return trigger || "工程备份";
}

export function ProjectTimelinePanel({ onRestore }: ProjectTimelinePanelProps) {
  const project = useProjectStore();
  const setNotice = useEditorStore((state) => state.setNotice);
  const [entries, setEntries] = useState<ProjectBackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [pendingRestore, setPendingRestore] = useState<ProjectBackupEntry>();

  async function refresh() {
    setLoading(true);
    setError(undefined);
    try {
      setEntries(await listProjectBackups(project.projectId));
    } catch (listError) {
      reportFrontendError("editor.timeline", listError, {
        operation: "list",
        projectId: project.projectId,
      });
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
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [project.projectId]);

  async function restore(entry: ProjectBackupEntry) {
    try {
      const raw = await readProjectBackup(entry.file_name);
      const parsed = parseProjectJson(JSON.parse(raw));
      if (!parsed.project) {
        setNotice({
          tone: "error",
          source: "项目时间线",
          message: parsed.error ?? "时间线备份不可用。",
          detail: `Backup file: ${entry.file_name}`,
          action: "请确认 backup-timeline 文件夹中的工程备份没有被手动损坏。",
        });
        return;
      }
      await onRestore(parsed.project, entry);
      setPendingRestore(undefined);
    } catch (restoreError) {
      reportFrontendError("editor.timeline", restoreError, {
        operation: "restore",
        projectId: project.projectId,
        backup: entry.file_name,
      });
      setNotice({
        tone: "error",
        source: "项目时间线",
        message: restoreError instanceof Error ? restoreError.message : "恢复时间线备份失败。",
        detail: restoreError instanceof Error ? restoreError.stack : undefined,
        error: restoreError,
        action: "请检查 backup-timeline 文件夹权限，以及目标备份文件是否仍然存在。",
      });
    }
  }

  return (
    <section className="project-timeline-panel">
      <header>
        <div>
          <span className="panel-kicker">项目时间线</span>
          <h3>时间线（最近 {projectTimelineRecentLimit} 次）</h3>
        </div>
        <button type="button" data-help-key="timeline.refresh" onClick={() => void refresh()}>
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
          <p>点击“保存工程”或返回项目主页后，桌面版会把当前工程写入 backup-timeline 文件夹。</p>
        </div>
      )}
      {!loading && !error && entries.length > 0 && (
        <div className="timeline-list" aria-label="工程时间线记录">
          {entries.map((entry) => (
            <article className="timeline-entry" key={entry.file_name}>
              <button type="button" data-help-key="timeline.entry" onClick={() => setPendingRestore(entry)}>
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

      {pendingRestore && createPortal((
        <div className="timeline-confirm-backdrop" role="presentation" onPointerDown={() => setPendingRestore(undefined)}>
          <section className="timeline-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="timeline-confirm-title" onPointerDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="timeline-confirm-close"
              aria-label="关闭恢复确认"
              title="关闭恢复确认"
              data-tooltip="关闭恢复确认"
              data-help-key="timeline.restoreCancel"
              onClick={() => setPendingRestore(undefined)}
            >
              <X size={16} aria-hidden="true" />
            </button>
            <span className="panel-kicker">恢复备份</span>
            <h3 id="timeline-confirm-title">恢复这个时间点？</h3>
            <p>
              将用 <strong>{pendingRestore.title || "未命名视觉小说"}</strong> 在 {formatDate(pendingRestore.timestamp_ms)} 的备份覆盖当前工程。
            </p>
            <div className="timeline-confirm-actions">
              <button type="button" data-help-key="timeline.restoreCancel" onClick={() => setPendingRestore(undefined)}>取消</button>
              <button type="button" className="danger" data-help-key="timeline.restoreConfirm" onClick={() => void restore(pendingRestore)}>
                <RotateCcw size={16} /> 恢复备份
              </button>
            </div>
          </section>
        </div>
      ), document.body)}
    </section>
  );
}
