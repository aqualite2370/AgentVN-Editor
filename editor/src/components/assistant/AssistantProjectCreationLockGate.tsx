import { AlertTriangle, ArrowLeft, Ban, LoaderCircle, LockKeyhole } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  cancelAssistantCreationProcess,
  getAssistantCreationProcesses,
  subscribeAssistantCreationProcesses,
  type AssistantCreationProcess,
} from "../../assistant/creationProcessQueue";
import "./assistant-project-creation-lock.css";

interface AssistantProjectCreationLockGateProps {
  projectId: string;
  projectTitle: string;
  onReturnHome: () => void;
  children: ReactNode;
}

function isActive(process: AssistantCreationProcess): boolean {
  return process.status === "queued" || process.status === "running" || process.status === "cancelling";
}

function statusDescription(process: AssistantCreationProcess, queuePosition: number): string {
  if (process.status === "queued") return `正在等待全局队列 · 第 ${queuePosition} 位`;
  if (process.status === "cancelling") return "正在停止当前任务并丢弃其结果";
  return "正在构建隔离草稿";
}

export function AssistantProjectCreationLockGate({
  projectId,
  projectTitle,
  onReturnHome,
  children,
}: AssistantProjectCreationLockGateProps) {
  const processes = useSyncExternalStore(
    subscribeAssistantCreationProcesses,
    getAssistantCreationProcesses,
    getAssistantCreationProcesses,
  );
  const activeProcesses = useMemo(
    () => processes.filter(isActive).sort((left, right) => left.submittedAt - right.submittedAt),
    [processes],
  );
  const process = activeProcesses.find((item) => item.projectId === projectId);
  const queuePosition = process
    ? activeProcesses.findIndex((item) => item.id === process.id) + 1
    : 0;
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const cancellable = process?.status === "queued" || process?.status === "running";

  useLayoutEffect(() => {
    if (!process) return;
    const overlay = dialogRef.current?.parentElement;
    const siblings = [...document.body.children]
      .filter((node): node is HTMLElement => node instanceof HTMLElement && node !== overlay);
    const original = siblings.map(node => ({ node, inert: node.inert }));
    siblings.forEach(node => { node.inert = true; });
    return () => original.forEach(({ node, inert }) => { node.inert = inert; });
  }, [Boolean(process)]);

  useLayoutEffect(() => {
    if (process) {
      dialogRef.current?.focus({ preventScroll: true });
      return;
    }
    const previous = returnFocusRef.current;
    if (previous?.isConnected && !previous.closest("[inert]")) {
      previous.focus({ preventScroll: true });
    }
  }, [Boolean(process)]);

  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = [...(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ))];
    if (focusable.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="assistant-project-lock-host" data-testid="assistant-project-lock-host"
      data-project-locked={process ? "true" : "false"}
      onFocusCapture={(event) => {
        if (!process && event.target instanceof HTMLElement) returnFocusRef.current = event.target;
      }}>
      <div className="assistant-project-lock-content" data-testid="locked-project-content"
        inert={process ? true : undefined} aria-hidden={process ? true : undefined}>
        {children}
      </div>
      {process && createPortal((
        <div className="assistant-project-lock-overlay" data-testid="assistant-project-lock-overlay">
          <section
            ref={dialogRef}
            className="assistant-project-lock-dialog"
            data-testid="assistant-project-lock-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assistant-project-lock-title"
            aria-describedby="assistant-project-lock-description"
            tabIndex={-1}
            onKeyDown={trapFocus}
          >
            <div className="assistant-project-lock-icon" aria-hidden="true">
              {process.status === "failed"
                ? <AlertTriangle size={24} />
                : process.status === "cancelling"
                  ? <LoaderCircle size={24} className="is-spinning" />
                  : <LockKeyhole size={24} />}
            </div>
            <div className="assistant-project-lock-copy">
              <span className="assistant-project-lock-eyebrow">工程临时只读</span>
              <h1 id="assistant-project-lock-title">{projectTitle}正在进行创造任务</h1>
              <p id="assistant-project-lock-description">{statusDescription(process, queuePosition)}</p>
              <div className="assistant-project-lock-progress" role="status" aria-live="polite">
                <span className={process.status === "queued" ? "is-queued" : ""} />
              </div>
              <small>任务进入可审核状态后，本工程会自动解锁。其他工程不受影响。</small>
            </div>
            <div className="assistant-project-lock-actions">
              {cancellable && (
                <button type="button" className="assistant-project-lock-cancel"
                  onClick={() => cancelAssistantCreationProcess(process.id)}
                  aria-label="取消此创造任务">
                  <Ban size={16} />取消任务
                </button>
              )}
              {process.status === "cancelling" && (
                <span className="assistant-project-lock-cancelling" role="status">正在结束任务…</span>
              )}
              <button type="button" className="assistant-project-lock-home"
                onClick={onReturnHome} aria-label="返回工程列表">
                <ArrowLeft size={16} />返回工程列表
              </button>
            </div>
          </section>
        </div>
      ), document.body)}
    </div>
  );
}
