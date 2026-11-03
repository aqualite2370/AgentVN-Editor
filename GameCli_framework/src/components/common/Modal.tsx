import { useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useConfirmationLayoutStyle, useRenpyButtonRoleStyle, useRuntimeUILayout, useUILayoutFrameSize } from "../../uiSkin/uiSkinRuntime";
import { presentRuntimeModal } from "../../utils/runtimeModalPresentation";
import { PresentedControl } from "../../uiSkin/PresentedControl";

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const panelRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const focusInitialRef = useRef<() => void>(() => {});
  const closeLabel = `关闭${title}`;
  const runtimeScreen = useRuntimeStore((state) => state.screen);
  const layout = useRuntimeUILayout();
  const frame = useUILayoutFrameSize();
  const scale = Math.min(frame.width / 1280, frame.height / 720);
  const assetUrls = useRuntimeStore(state => state.currentGame?.assetUrls);
  const control = (region: "panel" | "title" | "text") => ({
    component_id: `confirmation_${region}Style`, component_type: "about_panel" as const,
    presentation: layout.confirmationLayout?.[`${region}Presentation`],
  });
  const rolePage = runtimeScreen === "settings" ? "preferences"
    : runtimeScreen === "playing" ? "player"
      : ["save_load", "history", "about", "help", "gallery"].includes(runtimeScreen)
        ? runtimeScreen as "save_load" | "history" | "about" | "help" | "gallery"
        : "title";
  const role = useRenpyButtonRoleStyle("modal_action",
    layout.renpy?.confirmation?.buttonRoles?.modal_action ? "confirmation" : rolePage);
  const confirmation = useConfirmationLayoutStyle();

  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel) return presentRuntimeModal(panel, title);
  }, [title]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const backdrop = panel?.parentElement;
    if (!panel || !backdrop?.parentElement) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = [...backdrop.parentElement.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop)
      .map((element) => ({ element, inert: element.inert }));
    for (const { element } of siblings) element.inert = true;

    const getFocusable = () => [...panel.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )].filter((element) => !element.hidden && element.getClientRects().length > 0);
    const focusInitial = () => {
      const focusable = getFocusable();
      const initial = panel.querySelector<HTMLElement>("[data-modal-initial-focus]:not([disabled])")
        ?? panel.querySelector<HTMLElement>("[data-modal-cancel]:not([disabled])")
        ?? focusable[0];
      (initial ?? panel).focus({ preventScroll: true });
    };
    focusInitialRef.current = focusInitial;
    focusInitial();

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;

      const modals = Array.from(document.querySelectorAll<HTMLElement>("[data-runtime-modal='true']"));
      if (modals[modals.length - 1] !== panel) return;

      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    }

    function handleTab(event: KeyboardEvent) {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const modals = Array.from(document.querySelectorAll<HTMLElement>("[data-runtime-modal='true']"));
      if (modals[modals.length - 1] !== panel) return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    function containFocus(event: FocusEvent) {
      const modals = Array.from(document.querySelectorAll<HTMLElement>("[data-runtime-modal='true']"));
      if (modals[modals.length - 1] !== panel || panel.contains(event.target as Node)) return;
      focusInitial();
    }

    function handleSystemBack(event: Event) {
      if (event.defaultPrevented) return;
      const modals = Array.from(document.querySelectorAll<HTMLElement>("[data-runtime-modal='true']"));
      if (modals[modals.length - 1] !== panel) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    }

    document.addEventListener("keydown", handleEscape, true);
    document.addEventListener("keydown", handleTab, true);
    document.addEventListener("focusin", containFocus, true);
    window.addEventListener("agentvn:system-back", handleSystemBack, true);
    return () => {
      document.removeEventListener("keydown", handleEscape, true);
      document.removeEventListener("keydown", handleTab, true);
      document.removeEventListener("focusin", containFocus, true);
      window.removeEventListener("agentvn:system-back", handleSystemBack, true);
      for (const { element, inert } of siblings) element.inert = inert;
      if (previouslyFocused?.isConnected && !previouslyFocused.inert) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  // Loading and error states can disable or remove the focused action.
  // Keep focus valid after those DOM updates without polling/observers.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const modals = Array.from(document.querySelectorAll<HTMLElement>("[data-runtime-modal='true']"));
    if (modals[modals.length - 1] !== panel) return;
    const active = document.activeElement;
    if (!panel.contains(active) || (active instanceof HTMLButtonElement && active.disabled)) {
      focusInitialRef.current();
    }
  });

  return (
    <div className="modal-backdrop" role="presentation">
      <PresentedControl layout={layout} component={control("panel")} assetUrls={assetUrls} scale={scale}>
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-runtime-modal="true"
        data-runtime-screen={runtimeScreen}
        data-layout-type={layout.layout_type ?? "agentvn"}
        data-confirmation-layout-source={confirmation.configured ? "override" : "theme"}
        data-renpy-role-custom={role.enabled ? "true" : undefined}
        data-renpy-role-styled={role.styled ? "true" : undefined}
        data-renpy-role-bordered={role.bordered ? "true" : undefined}
        data-renpy-role-opacity={role.opacityConfigured ? "true" : undefined}
        style={{ ...(role.enabled ? role.style : {}), ...confirmation.panelStyle }}
        tabIndex={-1}
        ref={panelRef}
      >
        <header>
          <PresentedControl layout={layout} component={control("title")} assetUrls={assetUrls} scale={scale}>
            <strong style={confirmation.titleStyle}>{title}</strong>
          </PresentedControl>
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
        <PresentedControl layout={layout} component={control("text")} assetUrls={assetUrls} scale={scale}>
          <div className="modal-content" style={confirmation.textStyle}>{children}</div>
        </PresentedControl>
      </section>
      </PresentedControl>
    </div>
  );
}
