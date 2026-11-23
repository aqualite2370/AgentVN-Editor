import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { readEditorMotionTokens } from "../../utils/editorTransitionPresentation";

type Phase = "closed" | "entering" | "open" | "closing";

/** Editor-only presentation and input ownership for the GUI import portal.
 * No timers: a retained exit settles on actual WAAPI completion. */
export function useGuiImportDialog(canClose?: () => boolean) {
  const canCloseRef = useRef(canClose);
  canCloseRef.current = canClose;
  const [phase, setPhase] = useState<Phase>("closed");
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const open = useCallback(() => setPhase("entering"), []);
  const close = useCallback(() => {
    if (canCloseRef.current && !canCloseRef.current()) return;
    setPhase(current => current === "closed" ? current : "closing");
  }, []);
  const active = phase === "entering" || phase === "open";

  useLayoutEffect(() => {
    if (phase !== "entering" && phase !== "closing") return;
    const backdrop = backdropRef.current, dialog = dialogRef.current;
    if (!backdrop || !dialog) return;
    const entering = phase === "entering";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tokens = readEditorMotionTokens();
    // A zero motion preference must not turn a page/modal handoff into a hard cut.
    const duration = 480 * Math.max(1, tokens.motionScale);
    const resting = "translateY(0px) scale(1)";
    const away = reduced ? "translateY(2px) scale(.995)" : "translateY(10px) scale(.985)";
    const fresh = !dialog.style.opacity;
    const dialogStyle = getComputedStyle(dialog), backdropStyle = getComputedStyle(backdrop);
    const animations = [
      backdrop.animate([{ opacity: fresh ? 0 : backdropStyle.opacity }, { opacity: entering ? 1 : 0 }],
        { duration, easing: tokens.contentEasing, fill: "both" }),
      dialog.animate([
        { opacity: fresh ? 0 : dialogStyle.opacity, transform: fresh ? away : dialogStyle.transform },
        { opacity: entering ? 1 : 0, transform: entering ? resting : away },
      ], { duration, easing: tokens.contentEasing, fill: "both" }),
    ];
    let current = true;
    void Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (current) setPhase(entering ? "open" : "closed");
    }, () => { /* Cancellation is redirected from the live presentation below. */ });
    return () => {
      current = false;
      // Freeze live values BEFORE cancellation; reversal never restarts at an endpoint.
      backdrop.style.opacity = getComputedStyle(backdrop).opacity;
      const live = getComputedStyle(dialog);
      dialog.style.opacity = live.opacity;
      dialog.style.transform = live.transform;
      animations.forEach(animation => animation.cancel());
    };
  }, [phase]);

  useLayoutEffect(() => {
    if (!active) return;
    const backdrop = backdropRef.current, dialog = dialogRef.current;
    if (!backdrop || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = [...document.body.children].filter((node): node is HTMLElement =>
      node instanceof HTMLElement && node !== backdrop && !["SCRIPT", "STYLE", "LINK"].includes(node.tagName));
    const saved = background.map(node => ({ node, inert: node.inert }));
    for (const { node } of saved) node.inert = true;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    )].filter(node => node.getClientRects().length > 0 && !node.closest("[inert]"));
    const focusFirst = () => (focusable()[0] ?? dialog).focus({ preventScroll: true });
    focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // RichSelect owns its topmost popup; its handler stops further propagation.
        if (dialog.querySelector('[role="combobox"][aria-expanded="true"]')) return;
        event.preventDefault(); event.stopImmediatePropagation(); close();
      } else if (event.key === "Tab") {
        const items = focusable(), first = items[0], last = items[items.length - 1];
        if (!first || !dialog.contains(document.activeElement)) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus({ preventScroll: true });
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus({ preventScroll: true });
        }
      }
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && !backdrop.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin, true);
      for (const { node, inert } of saved) node.inert = inert;
      const target = triggerRef.current ?? previous;
      if (target?.isConnected && !target.closest("[inert]")) target.focus({ preventScroll: true });
    };
  }, [active, close]);

  return { phase, present: phase !== "closed", active, open, close, backdropRef, dialogRef, triggerRef };
}
