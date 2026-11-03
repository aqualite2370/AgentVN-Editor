import type { PropsWithChildren, ReactNode } from "react";

export function WorkspacePanel({
  children,
  className = "",
  testId,
}: PropsWithChildren<{ className?: string; testId?: string }>) {
  return (
    <section className={`workspace-panel ${className}`.trim()} data-testid={testId}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="panel-header">
      <strong>{title}</strong>
      {actions ? <div className="panel-header-actions">{actions}</div> : null}
    </header>
  );
}

export function PanelSection({ children }: PropsWithChildren) {
  return <section className="panel-section">{children}</section>;
}

export function PanelFooter({ children }: PropsWithChildren) {
  return <footer className="panel-footer">{children}</footer>;
}

export function StatusBadge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: "neutral" | "success" | "warning" | "danger" }>) {
  return <span className={`status-badge is-${tone}`}>{children}</span>;
}

export function OperationState({ label, busy = false }: { label: string; busy?: boolean }) {
  return <span className={`operation-state${busy ? " is-busy" : ""}`} role="status" aria-live="polite">{label}</span>;
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return <div className="workspace-empty-state"><strong>{title}</strong>{description ? <p>{description}</p> : null}</div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="workspace-error-state" role="alert">{message}</div>;
}

export function ConfirmBar({ children }: PropsWithChildren) {
  return <div className="confirm-bar">{children}</div>;
}
