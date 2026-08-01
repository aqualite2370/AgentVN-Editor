const EDITABLE_TEXT_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
].join(", ");

function targetElement(target: EventTarget | null, targetDocument: Document): Element | null {
  const view = targetDocument.defaultView;
  if (view && target instanceof view.Element) return target;
  if (view && target instanceof view.Node) return target.parentElement;
  return targetDocument.activeElement;
}

function allowsTextSelection(target: EventTarget | null, targetDocument: Document): boolean {
  return Boolean(targetElement(target, targetDocument)?.closest(EDITABLE_TEXT_SELECTOR));
}

export function installNativeInteractionGuards(targetDocument: Document): () => void {
  function preventContextMenu(event: Event) {
    event.preventDefault();
  }

  function preventOrdinaryTextSelection(event: Event) {
    if (allowsTextSelection(event.target, targetDocument)) return;
    event.preventDefault();
  }

  targetDocument.addEventListener("contextmenu", preventContextMenu, true);
  targetDocument.addEventListener("selectstart", preventOrdinaryTextSelection, true);

  return () => {
    targetDocument.removeEventListener("contextmenu", preventContextMenu, true);
    targetDocument.removeEventListener("selectstart", preventOrdinaryTextSelection, true);
  };
}
