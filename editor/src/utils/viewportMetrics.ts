export interface ViewportMetrics {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function readViewportMetrics(): ViewportMetrics {
  const visualViewport = typeof window !== "undefined" ? window.visualViewport : undefined;
  const width = Math.max(1, visualViewport?.width ?? window.innerWidth);
  const height = Math.max(1, visualViewport?.height ?? window.innerHeight);
  const left = Math.max(0, visualViewport?.offsetLeft ?? 0);
  const top = Math.max(0, visualViewport?.offsetTop ?? 0);

  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

export function subscribeToViewportChanges(listener: () => void): () => void {
  const visualViewport = typeof window !== "undefined" ? window.visualViewport : undefined;
  window.addEventListener("resize", listener);
  window.addEventListener("scroll", listener, true);
  visualViewport?.addEventListener("resize", listener);
  visualViewport?.addEventListener("scroll", listener);

  return () => {
    window.removeEventListener("resize", listener);
    window.removeEventListener("scroll", listener, true);
    visualViewport?.removeEventListener("resize", listener);
    visualViewport?.removeEventListener("scroll", listener);
  };
}
