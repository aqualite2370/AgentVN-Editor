/** Editor-only presentation. The envelope never scales text or live controls. */
export function visibleMorphRect(shell: HTMLElement): DOMRect {
  const rect = shell.getBoundingClientRect();
  // CSSOM is allowed to shorten equal edges to one, two or three values.
  const match = /^inset\(([^)]*?)(?:\s+round\s+[^)]*)?\)$/.exec(getComputedStyle(shell).clipPath);
  if (!match) return rect;
  const values = match[1].trim().split(/\s+/).map(value => /^[-+\d.e]+px$/.test(value) ? parseFloat(value) : NaN);
  if (values.length < 1 || values.length > 4 || values.some(value => !Number.isFinite(value))) return rect;
  const [top, right = top, bottom = top, left = right] = values;
  return new DOMRect(rect.left + left, rect.top + top, rect.width - left - right, rect.height - top - bottom);
}

let morphGeneration = 0;

export function createEditorContainerMorph(node: HTMLElement, from: DOMRect, to: DOMRect,
  duration: number, easing: string) {
  const style = getComputedStyle(node);
  const owner = String(++morphGeneration);
  const width = Math.max(from.width, to.width), height = Math.max(from.height, to.height);
  const shell = document.createElement("div");
  shell.className = "editor-container-morph-shell";
  shell.inert = true; shell.setAttribute("aria-hidden", "true");
  Object.assign(shell.style, {
    position: "fixed", left: `${to.left}px`, top: `${to.top}px`, width: `${width}px`, height: `${height}px`,
    zIndex: String((Number(style.zIndex) || 50) - 1), pointerEvents: "none",
    background: style.background, boxShadow: style.boxShadow, border: style.border,
    boxSizing: "border-box", borderRadius: style.borderRadius, overflow: "hidden",
  });
  // The union envelope handles expansion AND contraction without negative
  // clipping or a background that jumps immediately to the smaller rectangle.
  const clip = (w: number, h: number) => `inset(0px ${Math.max(0, width - w)}px ${Math.max(0, height - h)}px 0px round ${style.borderRadius})`;
  // Remain in the live panel's stacking context. A body-level opaque shell can
  // otherwise cover the entire live editor, even with a numerically lower z.
  node.before(shell);
  const placed = shell.getBoundingClientRect();
  shell.style.left = `${to.left + (to.left - placed.left)}px`;
  shell.style.top = `${to.top + (to.top - placed.top)}px`;
  const timing: KeyframeAnimationOptions = { duration, easing, fill: "both" };
  const animation = shell.animate([
    { transform: `translate3d(${from.left - to.left}px,${from.top - to.top}px,0)`, clipPath: clip(from.width, from.height) },
    { transform: "translate3d(0,0,0)", clipPath: clip(to.width, to.height) },
  ], timing);
  node.classList.add("has-container-morph");
  node.dataset.editorMorphOwner = owner;
  const left = Math.max(0, from.left - to.left), right = Math.max(0, to.right - from.right);
  const top = Math.max(0, from.top - to.top), bottom = Math.max(0, to.bottom - from.bottom);
  const content = node.animate([
    { clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${style.borderRadius})` },
    { clipPath: `inset(0px 0px 0px 0px round ${style.borderRadius})` },
  ], timing);
  const onResize = () => animation.finish();
  window.addEventListener("resize", onResize, { once: true });
  let cleaned = false;
  return { shell, animation, cleanup() {
    if (cleaned) return;
    cleaned = true;
    window.removeEventListener("resize", onResize);
    content.cancel(); shell.remove();
    if (node.dataset.editorMorphOwner === owner) {
      delete node.dataset.editorMorphOwner;
      node.classList.remove("has-container-morph");
    }
  } };
}
