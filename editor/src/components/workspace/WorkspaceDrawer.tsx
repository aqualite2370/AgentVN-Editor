import type { PropsWithChildren, ReactNode } from "react";
import { X } from "lucide-react";

export function WorkspaceDrawer({
  children,
  open,
  title,
  actions,
  onClose,
}: PropsWithChildren<{
  open: boolean;
  title?: string;
  actions?: ReactNode;
  onClose?: () => void;
}>) {
  if (!open) return null;
  return (
    <aside className="workspace-drawer" data-testid="workspace-drawer" data-state="open" aria-label={title ?? "工作区面板"}>
      {(title || actions) && (
        <header className="workspace-drawer-header">
          {title ? <strong>{title}</strong> : <span />}
          <div className="workspace-drawer-actions">
            {actions}
            {onClose ? (
              <button data-help-key="editor.control" type="button" aria-label="关闭面板" title="关闭面板" onClick={onClose}>
                <X size={16} />
              </button>
            ) : null}
          </div>
        </header>
      )}
      <div className="workspace-drawer-content">{children}</div>
    </aside>
  );
}
