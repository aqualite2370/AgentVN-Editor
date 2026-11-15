export type GalleryImageOrigin = { left: number; top: number; width: number; height: number };

/** Animate the image alone, never text, focus ownership or the modal frame. */
export function presentGalleryImage(image: HTMLImageElement, origin?: GalleryImageOrigin): () => void {
  if (!origin || origin.width <= 0 || origin.height <= 0) return () => {};
  const rect = image.getBoundingClientRect();
  if (!rect.width || !rect.height) return () => {};
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const style = getComputedStyle(image);
  const token = style.getPropertyValue(reduced ? "--motion-fast" : "--motion").trim();
  const duration = (parseFloat(token) || (reduced ? 140 : 240)) * (/^[\d.]+s$/.test(token) ? 1000 : 1);
  const scale = Math.min(1, Math.max(.02, Math.min(origin.width / rect.width, origin.height / rect.height)));
  const x = origin.left + origin.width / 2 - rect.left - rect.width / 2;
  const y = origin.top + origin.height / 2 - rect.top - rect.height / 2;
  const animation = image.animate([
    { opacity: reduced ? .35 : .65, transform: reduced ? "scale(.98)" : `translate(${x}px, ${y}px) scale(${scale})` },
    { opacity: 1, transform: "translate(0px, 0px) scale(1)" },
  ], { duration, easing: style.getPropertyValue("--ease-out").trim() || "cubic-bezier(0.23,1,0.32,1)", fill: "both" });
  void animation.finished.then(() => animation.cancel()).catch(() => {});
  return () => animation.cancel();
}
