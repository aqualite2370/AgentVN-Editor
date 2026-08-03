import { FileInput, FolderOpen, Plus, Sparkles, Trash2, X } from "lucide-react";
import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ProjectSummary } from "../../api/types";
import type { EditorProjectFile } from "../../types/nodes";

export interface RecentProjectRecord extends ProjectSummary {
  project?: EditorProjectFile;
}

const QQ_GROUP_QR_IMAGE = "/agentvn-qq-qrcode.jpg";
const QQ_GROUP_VERSION = "1.7";
const QR_DIALOG_EXIT_MS = 220;

function formatProjectTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString();
}

function projectStatus(record: RecentProjectRecord): string {
  const sceneCount = record.project
    ? record.project.nodes.filter((node) => node.data.nodeKind === "scene").length
    : record.node_count;
  if (sceneCount === 0) return "新项目";
  return `${sceneCount} 个节点`;
}

export function ProjectHome({
  recentProjects,
  currentDraft,
  onCreateProject,
  onOpenDraft,
  onOpenProject,
  onDeleteProject,
  onImportProject,
  statusMessage,
  isHydrating = false,
}: {
  recentProjects: RecentProjectRecord[];
  currentDraft?: EditorProjectFile;
  onCreateProject: () => void;
  onOpenDraft: () => void;
  onOpenProject: (record: RecentProjectRecord) => void;
  onDeleteProject: (record: RecentProjectRecord) => void;
  onImportProject: (file: File) => void;
  statusMessage?: string;
  isHydrating?: boolean;
}) {
  const hasDraft = Boolean(currentDraft);
  const draftTime = currentDraft ? formatProjectTime(currentDraft.updated_at) : undefined;
  const [pendingDelete, setPendingDelete] = useState<RecentProjectRecord>();
  const [isQrDialogOpen, setIsQrDialogOpen] = useState(false);
  const [isQrDialogClosing, setIsQrDialogClosing] = useState(false);
  const qrDialogCloseTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    if (!pendingDelete) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingDelete(undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingDelete]);

  useEffect(() => {
    if (!isQrDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeQrDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isQrDialogOpen, isQrDialogClosing]);

  function confirmDeleteProject() {
    if (!pendingDelete) return;
    onDeleteProject(pendingDelete);
    setPendingDelete(undefined);
  }

  return (
    <main className="project-home">
      <header className="project-home-header">
        <div>
          <span className="project-home-kicker">AgentVN 创作端</span>
          <h1>创作启动台</h1>
        </div>
        <p>{isHydrating ? "正在同步本机草稿与后端项目状态..." : hasDraft ? `上次自动保存于 ${draftTime}` : "选择项目，或开始一部新的视觉小说。"}</p>
      </header>

      <section className="project-home-layout" aria-label="项目入口">
        <section className="project-command-panel" aria-label="创建或打开项目">
          <div className="command-panel-copy">
            <span className="project-home-kicker">准备就绪</span>
            <h2>{isHydrating ? "正在同步项目" : hasDraft ? "继续上次编辑" : "新建项目"}</h2>
            <p>{isHydrating ? "请稍等片刻，避免在草稿载入前覆盖当前蓝图。" : hasDraft ? currentDraft?.title || "未命名视觉小说" : "从一个干净工程开始，搭建节点、角色与导出流程。"}</p>
          </div>

          <div className="project-action-stack">
            {hasDraft ? (
              <>
                <button type="button" className="home-action home-action-primary" data-help-key="home.openDraft" onClick={onOpenDraft} disabled={isHydrating}>
                  <FolderOpen size={20} />
                  <span>继续上次编辑</span>
                </button>
                <button type="button" className="home-action home-action-secondary" data-help-key="home.createProject" onClick={onCreateProject} disabled={isHydrating}>
                  <Plus size={18} />
                  <span>新建项目</span>
                </button>
              </>
            ) : (
              <button type="button" className="home-action home-action-primary" data-help-key="home.createProject" onClick={onCreateProject} disabled={isHydrating}>
                <Plus size={20} />
                <span>新建项目</span>
              </button>
            )}

            <label className="home-action home-action-file project-import-button" data-help-key="home.importProject" aria-disabled={isHydrating}>
              <FileInput size={18} />
              <span>导入项目</span>
              <input
                type="file"
                accept=".vnproj,.json"
                disabled={isHydrating}
                onChange={(event) => {
                  if (isHydrating) return;
                  const file = event.target.files?.[0];
                  if (file) onImportProject(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              className="home-action home-action-qq"
              data-help-key="home.qqGroup"
              aria-label={`查看 QQ 群聊 135397938 二维码，当前版本 ${QQ_GROUP_VERSION}`}
              aria-haspopup="dialog"
              aria-expanded={isQrDialogOpen && !isQrDialogClosing}
              onClick={openQrDialog}
            >
              <MessageCircle size={18} />
              <span className="qq-group-copy">
                <span>QQ群聊：135397938</span>
                <small>当前版本[{QQ_GROUP_VERSION}]</small>
              </span>
              <span className="qq-group-hover-card" aria-hidden="true">
                加入群聊分享/反馈您的使用感受~ 并获取最新的 AgentVN 咨询！
              </span>
            </button>
          </div>

          {statusMessage && <p className="project-import-status" role="alert">{statusMessage}</p>}
        </section>

        <section className="recent-projects-panel" aria-label="最近项目">
          <header>
            <div>
              <span className="project-home-kicker">最近项目</span>
              <h2>最近项目</h2>
            </div>
            <span>{recentProjects.length} 个项目</span>
          </header>

          {recentProjects.length === 0 ? (
            <div className="project-empty-state">
              <Sparkles size={22} />
              <strong>尚无最近项目</strong>
              <p>新建一个项目，或导入已有的 project.vnproj。</p>
              <div className="project-empty-actions">
                <button type="button" className="home-action home-action-secondary" data-help-key="home.createProject" onClick={onCreateProject} disabled={isHydrating}>
                  <Plus size={17} />
                  <span>新建项目</span>
                </button>
                <label className="home-action home-action-ghost project-import-button" aria-disabled={isHydrating}>
                  <FileInput size={17} />
                  <span>导入项目</span>
                  <input
                    type="file"
                    accept=".vnproj,.json"
                    disabled={isHydrating}
                    onChange={(event) => {
                      if (isHydrating) return;
                      const file = event.target.files?.[0];
                      if (file) onImportProject(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
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
                    onClick={() => onOpenProject(record)}
                    disabled={isHydrating}
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
                    onClick={(event) => {
                      event.stopPropagation();
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
            className="qq-qrcode-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qq-qrcode-title"
            aria-describedby="qq-qrcode-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="qq-qrcode-close"
              data-help-key="home.qqDialogClose"
              aria-label="关闭 QQ 群二维码"
              title="关闭 QQ 群二维码"
              data-tooltip="关闭 QQ 群二维码"
              onClick={closeQrDialog}
            >
              <X size={17} aria-hidden="true" />
            </button>
            <div className="qq-qrcode-copy">
              <span className="project-home-kicker">QQ 群聊</span>
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
            className="project-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-delete-title"
            aria-describedby="project-delete-description"
            onMouseDown={(event) => event.stopPropagation()}
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
              <span className="project-home-kicker">删除项目</span>
              <h3 id="project-delete-title">删除这个项目？</h3>
            </div>
            <p id="project-delete-description">
              将从最近项目、当前草稿和当前保存状态中移除
              <strong> {pendingDelete.title || "未命名视觉小说"} </strong>
              。这不会删除你手动导出的 .vnproj 文件。
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
              <button type="button" className="home-action home-action-ghost" data-help-key="home.deleteDialogCancel" onClick={() => setPendingDelete(undefined)}>
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
