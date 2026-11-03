import { useLayoutEffect, useState } from "react";

/** Observe modal lifecycle only, not navigation layout or every rendered frame. */
export function useNovelTaskModalPriority(): boolean {
  const [blocked, setBlocked] = useState(false);
  useLayoutEffect(() => {
    const selector = '[aria-modal="true"]';
    const update = () => {
      const active = [...document.querySelectorAll<HTMLElement>(selector)].some(modal =>
        !modal.hidden && modal.getClientRects().length > 0
        && getComputedStyle(modal).visibility !== "hidden");
      for (const surface of document.querySelectorAll<HTMLElement>(".novel-task-layer,.novel-task-mini-entry"))
        surface.inert = active || surface.classList.contains("is-closing")
          || surface.dataset.suppressed === "true" || surface.dataset.dismissed === "true";
      setBlocked(active);
    };
    update();
    const hasModal = (node: Node) => node instanceof Element
      && (node.matches(selector) || Boolean(node.querySelector(selector)));
    const observer = new MutationObserver(records => {
      if (records.some(record => record.type === "attributes"
        || [...record.addedNodes, ...record.removedNodes].some(hasModal))) update();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["aria-modal", "aria-hidden", "hidden", "open"] });
    return () => observer.disconnect();
  }, []);
  return blocked;
}
