export declare function normalizeNativeSafeInsets(
  detail: Partial<{ top: number; right: number; bottom: number; left: number;
    coordinateSpace: "physical" | "css" }> | undefined,
  devicePixelRatio?: number,
): { top: number; right: number; bottom: number; left: number };

export declare function resolveBrowserViewportSize(
  platform: "android" | "ios" | "desktop" | "web",
  measuredSize: { width: number; height: number } | undefined,
  visualViewportSize: { width: number; height: number } | undefined,
  windowSize: { width: number; height: number },
  previousSize?: { width: number; height: number },
): { width: number; height: number };

export declare function syncHandheldDocumentViewport(
  platform: "android" | "ios" | "desktop" | "web",
  size: { width: number; height: number; ready?: boolean; orientation?: "landscape" | "portrait" },
): void;
