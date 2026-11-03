// WindowInsetsCompat reports physical pixels; all Runtime geometry uses CSS px.
// Keep the native sample unchanged so a later DPR change can be recomputed once.
export function normalizeNativeSafeInsets(detail, devicePixelRatio = 1) {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const divisor = detail?.coordinateSpace === "css" ? 1 : ratio;
  return Object.fromEntries(["top", "right", "bottom", "left"].map(side => {
    const value = detail?.[side];
    return [side, typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) / divisor : 0];
  }));
}

export function resolveBrowserViewportSize(
  platform,
  measuredSize,
  visualViewportSize,
  windowSize,
  previousSize,
) {
  const isUsableViewportSize = (size) => Boolean(
    size
      && Number.isFinite(size.width)
      && Number.isFinite(size.height)
      && size.width >= 240
      && size.height >= 180,
  );
  const fallbackSize = isUsableViewportSize(previousSize)
    ? previousSize
    : windowSize;
  const visualSize = visualViewportSize?.width && visualViewportSize?.height
    ? visualViewportSize
    : undefined;
  const browserViewport = visualSize
    && (visualSize.width >= visualSize.height) === (windowSize.width >= windowSize.height)
    // On Android/iOS the visual viewport is the compositor's usable window.
    // `window.innerHeight` can remain oversized while immersive landscape is
    // settling; taking the per-axis maximum would preserve that stale height
    // and vertically center the 16:9 frame below the captured screen.
    ? visualSize
    : windowSize;
  const resolvedSize = platform === "android" || platform === "ios"
    ? (isUsableViewportSize(browserViewport) ? browserViewport : fallbackSize)
    : (isUsableViewportSize(measuredSize)
      ? measuredSize
      : (isUsableViewportSize(browserViewport) ? browserViewport : fallbackSize));
  // Android activities are locked to landscape. During screen unlock the
  // WebView can briefly publish a portrait viewport before immersive mode and
  // surface rotation settle. Accepting that sample pins html/body/root to a
  // portrait document and leaves the authored 16:9 frame as a displaced
  // horizontal strip. Preserve the last stable landscape size until Android
  // reports another landscape sample.
  if (
    platform === "android"
      && isUsableViewportSize(previousSize)
      && previousSize.width >= previousSize.height
      && resolvedSize.width < resolvedSize.height
  ) {
    return previousSize;
  }
  return resolvedSize;
}

export function syncHandheldDocumentViewport(platform, size) {
  if (platform !== "android" && platform !== "ios" || typeof document === "undefined") return;
  if (size?.ready === false || size?.orientation === "portrait") return;
  const width = `${Math.max(1, Math.round(size.width))}px`;
  const height = `${Math.max(1, Math.round(size.height))}px`;
  for (const element of [document.documentElement, document.body, document.getElementById("root")]) {
    if (!element) continue;
    element.style.setProperty("width", width, "important");
    element.style.setProperty("height", height, "important");
    element.style.setProperty("min-width", "0px", "important");
    element.style.setProperty("min-height", "0px", "important");
    element.style.setProperty("max-width", width, "important");
    element.style.setProperty("max-height", height, "important");
  }
}
