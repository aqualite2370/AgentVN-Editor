import { FileInput, FolderOpen, Plus, Sparkles, Trash2, X } from "lucide-react";
import { MessageCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { ProjectSummary } from "../../api/types";
import type { EditorProjectFile } from "../../types/nodes";

export interface RecentProjectRecord extends ProjectSummary {
  project?: EditorProjectFile;
}

const QQ_GROUP_QR_IMAGE = "/agentvn-qq-qrcode.jpg";
const QR_DIALOG_EXIT_MS = 220;
const HOME_DISPLAY_VERSION = "2.0";

function formatProjectTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString();
}

function formatProjectSize(sizeBytes: number | undefined, source?: RecentProjectRecord["size_source"]): string {
  if (source === "unknown" || !Number.isFinite(sizeBytes) || (sizeBytes ?? 0) <= 0) return "未保存";
  const bytes = sizeBytes ?? 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function projectNodeStatus(record: RecentProjectRecord): string {
  const sceneCount = record.project
    ? record.project.nodes.filter((node) => node.data.nodeKind === "scene").length
    : record.node_count;
  if (sceneCount === 0) return "新项目";
  return `${sceneCount} 个节点`;
}

function projectStatus(record: RecentProjectRecord): string {
  return `${projectNodeStatus(record)} · ${formatProjectSize(record.size_bytes, record.size_source)}`;
}

export function ProjectHome({
  recentProjects,
  currentDraft,
  onCreateProject,
  onOpenDraft,
  onOpenProject,
  onDeleteProject,
  onImportProject,
  onSelectProjectFile,
  statusMessage,
  busyMessage,
  isHydrating = false,
}: {
  recentProjects: RecentProjectRecord[];
  currentDraft?: EditorProjectFile;
  onCreateProject: () => void;
  onOpenDraft: () => void;
  onOpenProject: (record: RecentProjectRecord) => void;
  onDeleteProject: (record: RecentProjectRecord) => void;
  onImportProject: (file: File) => void;
  onSelectProjectFile?: () => void;
  statusMessage?: string;
  busyMessage?: string;
  isHydrating?: boolean;
}) {
  const hasDraft = Boolean(currentDraft);
  // Resume loads the saved project by ID. Its catalog name is authoritative;
  // keep the local fallback draft itself untouched, including unsaved content.
  const draftTitle = recentProjects.find((record) => record.project_id === currentDraft?.project_id)?.title
    ?? currentDraft?.title;
  const draftTime = currentDraft ? formatProjectTime(currentDraft.updated_at) : undefined;
  const [pendingDelete, setPendingDelete] = useState<RecentProjectRecord>();
  const [isQrDialogOpen, setIsQrDialogOpen] = useState(false);
  const [isQrDialogClosing, setIsQrDialogClosing] = useState(false);
  const qrDialogCloseTimerRef = useRef<number | null>(null);
  const modalRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalTrigger = useRef<HTMLButtonElement>(null);
  const modalOpen = isQrDialogOpen || Boolean(pendingDelete);
  const actionsDisabled = isHydrating || Boolean(busyMessage);

  function clearQrDialogCloseTimer() {
    if (qrDialogCloseTimerRef.current === null) return;
    window.clearTimeout(qrDialogCloseTimerRef.current);
    qrDialogCloseTimerRef.current = null;
  }

  function openQrDialog() {
    clearQrDialogCloseTimer();
    setIsQrDialogClosing(false);
    setIsQrDialogOpen(true);
  }

  function closeQrDialog() {
    if (!isQrDialogOpen || isQrDialogClosing) return;
    setIsQrDialogClosing(true);
    clearQrDialogCloseTimer();
    const exitMs = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 1 : QR_DIALOG_EXIT_MS;
    qrDialogCloseTimerRef.current = window.setTimeout(() => {
      setIsQrDialogOpen(false);
      setIsQrDialogClosing(false);
      qrDialogCloseTimerRef.current = null;
    }, exitMs);
  }

  useEffect(() => {
    return () => clearQrDialogCloseTimer();
  }, []);

  useLayoutEffect(() => {
    if (!modalOpen) return;
    const trigger = modalTrigger.current;
    modalRef.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => {
      // React has to remove inert before the trigger can receive focus again.
      queueMicrotask(() => {
        if (modalRef.current || !headingRef.current?.isConnected) return;
        (trigger?.isConnected ? trigger : headingRef.current).focus();
      });
    };
  }, [modalOpen]);

  function handleModalKeyDown(event: KeyboardEvent<HTMLElement>, close: () => void) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key !== "Tab") return;
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const next = event.shiftKey && document.activeElement === first ? last
      : !event.shiftKey && document.activeElement === last ? first
      : undefined;
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  function confirmDeleteProject() {
    if (!pendingDelete) return;
    onDeleteProject(pendingDelete);
    setPendingDelete(undefined);
  }

  function renderImportAction(className: string, iconSize: number) {
    return (
      <button
        type="button"
        className={className}
        data-help-key="home.importProject"
        disabled={isHydrating}
        aria-disabled={actionsDisabled}
        onClick={() => {
          if (actionsDisabled) return;
          if (onSelectProjectFile) onSelectProjectFile();
          else fileInputRef.current?.click();
        }}
      >
        <FileInput size={iconSize} />
        <span>导入项目</span>
      </button>
    );
  }

  return (
    <main className="project-home">
      <header className="project-home-header" inert={modalOpen}>
        <div>
          <h1 ref={headingRef} tabIndex={-1}>创作启动台</h1>
        </div>
        <p>{isHydrating ? "正在恢复项目..." : hasDraft ? `上次自动保存于 ${draftTime}` : "选择项目，或开始一部新的视觉小说。"}</p>
      </header>

      <section className="project-home-layout" aria-label="项目入口" inert={modalOpen}>
        {!onSelectProjectFile && (
          <input
            ref={fileInputRef}
            type="file"
            accept=".vnproj,.json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file && !actionsDisabled) onImportProject(file);
            }}
          />
        )}
        <section className="project-command-panel" aria-label="创建或打开项目">
          <div className="command-panel-copy">
            <h2>{isHydrating ? "正在恢复项目" : hasDraft ? "继续上次编辑" : "新建项目"}</h2>
            {(isHydrating || hasDraft) && (
              <p>{isHydrating ? "请稍候，项目就绪后即可继续编辑。" : draftTitle || "未命名视觉小说"}</p>
            )}
          </div>

          <div className="project-action-stack">
            {hasDraft ? (
              <>
                <button type="button" className="home-action home-action-primary" data-help-key="home.openDraft" onClick={() => !actionsDisabled && onOpenDraft()} disabled={isHydrating} aria-disabled={actionsDisabled}>
                  <FolderOpen size={20} />
                  <span>继续上次编辑</span>
                </button>
                <button type="button" className="home-action home-action-secondary" data-help-key="home.createProject" onClick={() => !actionsDisabled && onCreateProject()} disabled={isHydrating} aria-disabled={actionsDisabled}>
                  <Plus size={18} />
                  <span>新建项目</span>
                </button>
              </>
            ) : (
              <button type="button" className="home-action home-action-primary" data-help-key="home.createProject" onClick={() => !actionsDisabled && onCreateProject()} disabled={isHydrating} aria-disabled={actionsDisabled}>
                <Plus size={20} />
                <span>新建项目</span>
              </button>
            )}

            {renderImportAction("home-action home-action-file project-import-button", 18)}
            <button
              type="button"
              className="home-action home-action-qq"
              data-help-key="home.qqGroup"
              aria-label={`查看 QQ 群聊 135397938 二维码，当前版本 ${HOME_DISPLAY_VERSION}`}
              aria-haspopup="dialog"
              aria-expanded={isQrDialogOpen && !isQrDialogClosing}
              onClick={(event) => {
                modalTrigger.current = event.currentTarget;
                openQrDialog();
              }}
            >
              <MessageCircle size={18} />
              <span className="qq-group-copy">
                <span>QQ群聊：135397938</span>
                <small>当前版本[{HOME_DISPLAY_VERSION}]</small>
              </span>
              <span className="qq-group-hover-card" aria-hidden="true">
                加入群聊，获取版本更新或反馈问题。
              </span>
            </button>
          </div>

          {busyMessage && <p className="project-import-status is-working" role="status">{busyMessage}</p>}
          {statusMessage && <p className="project-import-status" role="alert">{statusMessage}</p>}
        </section>

        <section className="recent-projects-panel" aria-label="最近项目">
          <header>
            <div>
              <h2>最近项目</h2>
            </div>
            <span>{recentProjects.length} 个项目</span>
          </header>

          {recentProjects.length === 0 ? (
            <div className="project-empty-state">
              <Sparkles size={22} />
              <strong>尚无最近项目</strong>
              <p>新建或导入的项目会显示在这里。</p>
            </div>
          ) : (
            <div className="recent-project-list">
              {recentProjects.map((record, index) => (
                <article
                  key={record.project_id}
                  className="recent-project-item"
                  style={{ "--item-index": index } as CSSProperties}
                >
                  <button
                    type="button"
                    className="recent-project-open"
                    data-help-key="home.recentProject"
                    onClick={() => !actionsDisabled && onOpenProject(record)}
                    disabled={isHydrating}
                    aria-disabled={actionsDisabled}
                  >
                    <span className="recent-project-mark">{record.title.slice(0, 2) || "VN"}</span>
                    <span className="recent-project-main">
                      <strong>{record.title || "未命名视觉小说"}</strong>
                      <small>{record.author || "未填写作者"}</small>
                    </span>
                    <span className="recent-project-meta">
                      <time>{formatProjectTime(record.updated_at)}</time>
                      <em>{projectStatus(record)}</em>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="recent-project-delete"
                    data-help-key="home.deleteRecentProject"
                    aria-label={`删除项目 ${record.title || "未命名视觉小说"}`}
                    title={`删除项目 ${record.title || "未命名视觉小说"}`}
                    data-tooltip={`删除项目 ${record.title || "未命名视觉小说"}`}
                    disabled={isHydrating}
                    aria-disabled={actionsDisabled}
                    onClick={(event) => {
                      if (actionsDisabled) return;
                      modalTrigger.current = event.currentTarget;
                      setPendingDelete(record);
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
      {isQrDialogOpen && (
        <div className={`qq-qrcode-dialog-backdrop${isQrDialogClosing ? " is-closing" : ""}`} role="presentation" onMouseDown={closeQrDialog}>
          <section
            ref={modalRef}
            className="qq-qrcode-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qq-qrcode-title"
            aria-describedby="qq-qrcode-description"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => handleModalKeyDown(event, closeQrDialog)}
          >
            <button
              type="button"
              className="qq-qrcode-close"
              data-initial-focus
              data-help-key="home.qqDialogClose"
              aria-label="关闭 QQ 群二维码"
              title="关闭 QQ 群二维码"
              data-tooltip="关闭 QQ 群二维码"
              onClick={closeQrDialog}
            >
              <X size={17} aria-hidden="true" />
            </button>
            <div className="qq-qrcode-copy">
              <h3 id="qq-qrcode-title">AgentVN 视觉小说交流群</h3>
              <p id="qq-qrcode-description">扫描二维码加入群聊，获取版本更新与使用反馈支持。</p>
            </div>
            <div className="qq-qrcode-image-frame">
              <img src={QQ_GROUP_QR_IMAGE} alt="AgentVN QQ 群聊二维码，群号 135397938" />
            </div>
          </section>
        </div>
      )}
      {pendingDelete && (
        <div className="project-delete-dialog-backdrop" role="presentation" onMouseDown={() => setPendingDelete(undefined)}>
          <section
            ref={modalRef}
            className="project-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-delete-title"
            aria-describedby="project-delete-description"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => handleModalKeyDown(event, () => setPendingDelete(undefined))}
          >
            <button
              type="button"
              className="project-delete-close"
              data-help-key="home.deleteDialogClose"
              aria-label="关闭删除项目确认"
              title="关闭删除项目确认"
              data-tooltip="关闭删除项目确认"
              onClick={() => setPendingDelete(undefined)}
            >
              <X size={17} aria-hidden="true" />
            </button>
            <div className="project-delete-icon">
              <Trash2 size={22} />
            </div>
            <div>
              <h3 id="project-delete-title">删除这个项目？</h3>
            </div>
            <p id="project-delete-description">
              将从 AgentVN 的项目库中删除
              <strong> {pendingDelete.title || "未命名视觉小说"} </strong>
              和对应的本机草稿。已导出的 .vnproj 文件会保留。
            </p>
            <dl>
              <div>
                <dt>更新时间</dt>
                <dd>{formatProjectTime(pendingDelete.updated_at)}</dd>
              </div>
              <div>
                <dt>项目状态</dt>
                <dd>{projectStatus(pendingDelete)}</dd>
              </div>
            </dl>
            <div className="project-delete-actions">
              <button type="button" className="home-action home-action-ghost" data-initial-focus data-help-key="home.deleteDialogCancel" onClick={() => setPendingDelete(undefined)}>
                取消
              </button>
              <button type="button" className="home-action project-delete-confirm" data-help-key="home.deleteDialogConfirm" onClick={confirmDeleteProject}>
                删除项目
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
