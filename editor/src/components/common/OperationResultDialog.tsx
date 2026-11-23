import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type OperationResultTone = "success" | "warning" | "error";

export interface OperationResultDetail {
  label: string;
  value: string;
}

export interface OperationResultContextAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  dismissOnClick?: boolean;
}

interface OperationResultDialogProps {
  open: boolean;
  tone: OperationResultTone;
  label: string;
  title: string;
  message: string;
  icon: ReactNode;
  details?: OperationResultDetail[];
  contextAction?: OperationResultContextAction;
  secondaryAction?: OperationResultContextAction;
  busy?: boolean;
  confirmLabel?: string;
  testId?: string;
  closeAriaLabel?: string;
  surfaceTone?: "accent" | "semantic";
  suppressHoverHelp?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  inertBackground?: boolean;
  reducedMotionDurationMs?: number;
  onDismiss: () => void;
}

const operationResultExitMs = 280;

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null);
}

export function OperationResultDialog({
  open,
  tone,
  label,
  title,
  message,
  icon,
  details = [],
  contextAction,
  secondaryAction,
  busy = false,
  confirmLabel = "完成",
  testId,
  closeAriaLabel = "关闭结果提示",
  surfaceTone = "semantic",
  suppressHoverHelp = false,
  returnFocusRef,
  inertBackground = false,
  reducedMotionDurationMs = 1,
  onDismiss,
}: OperationResultDialogProps) {
  const [stage, setStage] = useState<"open" | "closing">("open");
  const dialogRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const fallbackReturnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const messageId = useId();

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const closeDialog = useCallback(() => {
    if (!open || busy || stage === "closing") return;
    setStage("closing");
    clearCloseTimer();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onDismiss();
      window.requestAnimationFrame(() => {
        const target = returnFocusRef?.current ?? fallbackReturnFocusRef.current;
        target?.focus();
      });
    }, reduced ? reducedMotionDurationMs : operationResultExitMs);
  }, [busy, clearCloseTimer, onDismiss, open, reducedMotionDurationMs, returnFocusRef, stage]);

  // Reset a retained dialog before it becomes interactive on reopening.
  // A passive effect leaves a frame with the previous "closing" handler.
  useLayoutEffect(() => {
    if (!open) return;
    clearCloseTimer();
    setStage("open");
    fallbackReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => confirmRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [clearCloseTimer, open, title]);

  useLayoutEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || stage === "closing" || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [closeDialog, open, stage]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  useLayoutEffect(() => {
    if (!open || !inertBackground) return;
    const backdrop = dialogRef.current?.parentElement;
    const siblings = [...document.body.children]
      .filter((node): node is HTMLElement => node instanceof HTMLElement && node !== backdrop);
    const original = siblings.map(node => ({ node, inert: node.inert }));
    siblings.forEach(node => { node.inert = true; });
    return () => original.forEach(({ node, inert }) => { node.inert = inert; });
  }, [inertBackground, open]);

  if (!open) return null;
  const reducedStyle = reducedMotionDurationMs > 1
    && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
    ? { animationDuration: `${reducedMotionDurationMs}ms` }
    : undefined;

  return createPortal((
    <div
      className={`operation-result-backdrop project-save-confirm-backdrop${stage === "closing" ? " is-closing" : ""}`}
      style={reducedStyle}
      data-testid={testId}
      data-toolbar-popover-keepopen="true"
      data-hover-help-suppressed={suppressHoverHelp ? "true" : undefined}
    >
      <section
        ref={dialogRef}
        className={`operation-result-dialog project-save-confirm-dialog is-${tone} surface-${surfaceTone}${stage === "closing" ? " is-closing" : ""}`}
        style={reducedStyle}
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button data-help-key="editor.control"
          type="button"
          className="operation-result-close project-save-confirm-close"
          aria-label={closeAriaLabel}
          onClick={closeDialog}
          disabled={busy}
        >
          <X size={18} />
        </button>
        <div className="operation-result-mark project-save-confirm-mark" aria-hidden="true">
          {icon}
        </div>
        <span className="toolbar-container-label">{label}</span>
        <h3 id={titleId}>{title}</h3>
        <p id={messageId}>{message}</p>
        {details.length > 0 && (
          <dl className="operation-result-details">
            {details.map((detail) => (
              <div key={`${detail.label}_${detail.value}`}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="operation-result-actions project-save-confirm-actions">
          {contextAction && (
            <button data-help-key="editor.control"
              type="button"
              className="operation-result-context-action"
              onClick={() => {
                if (stage === "closing") return;
                void Promise.resolve(contextAction.onClick()).then(() => {
                  if (contextAction.dismissOnClick) closeDialog();
                });
              }}
              disabled={busy || contextAction.disabled}
            >
              {contextAction.icon}
              <span>{contextAction.label}</span>
            </button>
          )}
          {secondaryAction && (
            <button type="button" className="operation-result-context-action"
              disabled={busy || secondaryAction.disabled}
              onClick={() => void secondaryAction.onClick()}>
              {secondaryAction.icon}<span>{secondaryAction.label}</span>
            </button>
          )}
          <button data-help-key="editor.control"
            ref={confirmRef}
            type="button"
            className="operation-result-confirm project-save-confirm-ok"
            onClick={closeDialog}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  ), document.body);
}
