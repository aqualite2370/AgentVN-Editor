import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const panelRef = useRef<HTMLElement | null>(null);
  const closeLabel = `关闭${title}`;

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;

      const modals = Array.from(document.querySelectorAll<HTMLElement>("[data-runtime-modal='true']"));
      if (modals[modals.length - 1] !== panelRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      onClose();
    }

    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-runtime-modal="true"
        ref={panelRef}
      >
        <header>
          <strong>{title}</strong>
          <Button
            className="icon-button"
            variant="ghost"
            aria-label={closeLabel}
            title={closeLabel}
            data-tooltip={closeLabel}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </header>
        {children}
      </section>
    </div>
  );
}
