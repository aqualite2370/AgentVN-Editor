import { ChevronDown } from "lucide-react";
import { useId, type ReactNode } from "react";

/** Collapsed diagnostics retain their state while leaving the input/focus path. */
export function NovelDetails({
  title, description, badge, active, open, onToggle, className, children,
}: {
  title: string; description?: string; badge?: string; active?: boolean;
  open: boolean; onToggle: () => void; className?: string; children: ReactNode;
}) {
  const regionId = useId();
  return (
    <article className={`novel-expand-control novel-secondary-drawer${active ? " is-active" : ""}${open ? " is-expanded" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="novel-expand-toggle novel-secondary-drawer-summary"
        data-hover-help-suppressed="true" aria-expanded={open} aria-controls={regionId} onClick={onToggle}>
        <div><strong>{title}</strong></div>
        <span className="novel-secondary-drawer-meta">
          {badge && <small>{badge}</small>}
          <small className="editor-disclosure-state">{open ? "收起" : "展开"}</small>
          <ChevronDown className="novel-expand-chevron" size={16} aria-hidden="true" />
        </span>
      </button>
      <div className="novel-expand-content-wrap" inert={!open} aria-hidden={!open}>
        <div id={regionId} className="novel-expand-content">
          <div className="novel-secondary-drawer-body">
            {description && <p className="novel-disclosure-description">{description}</p>}
            {children}
          </div>
        </div>
      </div>
    </article>
  );
}
