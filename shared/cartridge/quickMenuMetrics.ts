import { QUICK_MENU_DEFAULT_METRICS, QUICK_MENU_KNOWN_DEFAULT_FINGERPRINTS } from "./quickMenuDefaults";

export type QuickMenuVariant = "A" | "C";
export type QuickMenuDirection = "auto" | "up" | "down" | "left" | "right";
export type QuickMenuBreakpoint = "desktop" | "mobile";

export const QUICK_MENU_VARIANT_METRICS: Record<QuickMenuVariant, {
  widthMultiplier: number;
  heightMultiplier: number;
  axis: "horizontal" | "vertical";
}> = {
  A: { widthMultiplier: 5.2, heightMultiplier: 1, axis: "horizontal" },
  C: { widthMultiplier: 2.2, heightMultiplier: 4.1, axis: "vertical" },
};

export const QUICK_MENU_VISUAL_RATIO = {
  toggle: 35,
  action: 65,
} as const;

export interface QuickMenuSurfaceMetricsInput {
  safeInsets?: { left: number; top: number; right: number; bottom: number };
  variant?: QuickMenuVariant | string;
  direction?: QuickMenuDirection | string;
  anchor?: string;
  breakpoint?: QuickMenuBreakpoint;
  layoutWidth: number;
  layoutHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  mobile?: boolean;
  anchorY?: number;
  /** Top of the dialogue panel in logical frame pixels. */
  dialogueTop?: number;
  /**
   * Scale applied after the resolver fits the complete authored frame.
   *
   * Runtime passes 1 because its viewport is the authored frame itself.
   * Editor preview passes stageSize / authoredFrame so it renders the same
   * metrics in a smaller 16:9 canvas without re-solving the drawer against
   * the canvas' reduced safe height.
   */
  renderScale?: number;
}

export interface QuickMenuAuthoredFrame {
  width: number;
  height: number;
  rotated: boolean;
}

export interface QuickMenuSurfaceMetrics {
  variant: QuickMenuVariant;
  axis: "horizontal" | "vertical";
  direction: Exclude<QuickMenuDirection, "auto">;
  breakpoint: QuickMenuBreakpoint;
  compact: boolean;
  uniformScale: number;
  columns: number;
  rows: number;
  surfaceWidth: number;
  surfaceHeight: number;
  actionVisualWidth: number;
  actionVisualHeight: number;
  actionVisualSize: number;
  toggleVisualSize: number;
  toggleVisualWidth: number;
  toggleVisualHeight: number;
  toggleHitSize: number;
  actionHitSize: number;
  surfacePadding: number;
  actionGap: number;
  toggleGap: number;
  cellWidth: number;
  cellHeight: number;
  toggleCell: {
    column: number;
    row: number;
  };
  expandedBounds: {
    width: number;
    height: number;
  };
  contentHeight: number;
  scrollable: boolean;
}

export interface FixedQuickMenuGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

export interface QuickMenuPresentationInput {
  dialogueTop?: number;
  dialogRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  safeInsets?: { left: number; top: number; right: number; bottom: number };
  layout?: {
    rect?: {
      x: number;
      y: number;
      width: number;
      height: number;
      anchor?: string;
    };
    style?: {
      quickMenuVariant?: string;
      quickMenuDirection?: string;
      borderRadius?: number;
      borderWidth?: number;
      backdropBlur?: number;
      opacity?: number;
    };
    actionStyle?: {
      borderRadius?: number;
      borderWidth?: number;
      backdropBlur?: number;
      opacity?: number;
    };
  };
  authoredFrame: {
    width: number;
    height: number;
  };
  viewport: {
    width: number;
    height: number;
  };
  state: "collapsed" | "expanded";
  mobile?: boolean;
  renderScale?: number;
}

export interface QuickMenuPresentation {
  placement: "dialog-top-right" | "authored";
  anchor: {
    x: number;
    y: number;
    horizontal: "left" | "center" | "right";
    vertical: "top" | "center" | "bottom";
  };
  root: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  surface: {
    width: number;
    height: number;
    contentHeight: number;
  };
  toggle: {
    width: number;
    height: number;
    left: number;
    top: number;
  };
  actions: QuickMenuSurfaceMetrics;
  uniformScale: number;
  scrollable: boolean;
  material: {
    surface: {
      borderRadius: number;
      borderWidth: number;
      backdropBlur: number;
      opacity: number;
    };
    action: {
      borderRadius: number;
      borderWidth: number;
      backdropBlur: number;
      opacity: number;
    };
  };
}

/**
 * Runtime-only quick-menu geometry.  The drawer is a fixed C-shaped surface
 * whose bottom-right corner sits just outside the authored dialog's top-right
 * edge and on the speaker label's horizontal axis.  Project-authored rects
 * are intentionally not inputs here; they remain legacy data for import
 * compatibility but cannot move or resize the client control.
 */
export function resolveFixedQuickMenuGeometry(input: {
  frameWidth: number;
  frameHeight: number;
  quickMenuRect?: { x: number; y: number; width: number; height: number; anchor?: string };
  dialogRect?: { x: number; y: number; width: number; height: number };
  speakerRect?: { x: number; y: number; width: number; height: number };
}): FixedQuickMenuGeometry {
  const frameWidth = safeNumber(input.frameWidth, 1280);
  const frameHeight = safeNumber(input.frameHeight, 720);
  const authored = input.quickMenuRect;
  if (authored && !input.dialogRect) {
    const factorX = authored.anchor === "top_center" || authored.anchor === "bottom_center" || authored.anchor === "center"
      ? 0.5
      : authored.anchor === "top_right" || authored.anchor === "bottom_right" ? 1 : 0;
    const factorY = authored.anchor === "bottom_left" || authored.anchor === "bottom_center" || authored.anchor === "bottom_right"
      ? 1
      : authored.anchor === "center" ? 0.5 : 0;
    const authoredLeft = ((authored.x - authored.width * factorX) / 100) * frameWidth;
    const authoredTop = ((authored.y - authored.height * factorY) / 100) * frameHeight;
    const authoredRight = authoredLeft + (authored.width / 100) * frameWidth;
    const authoredBottom = authoredTop + (authored.height / 100) * frameHeight;
    const baseWidth = QUICK_MENU_DEFAULT_METRICS.desktopSurfaceWidth;
    const baseHeight = 7 * QUICK_MENU_DEFAULT_METRICS.actionHitSize
      + QUICK_MENU_DEFAULT_METRICS.desktopToggleHitSize
      + 7 * QUICK_MENU_DEFAULT_METRICS.actionGap
      + QUICK_MENU_DEFAULT_METRICS.surfacePadding * 2;
    const scale = Math.min(1, (frameWidth - 16) / baseWidth, (frameHeight - 16) / baseHeight);
    const width = baseWidth * scale;
    const height = baseHeight * scale;
    // The persisted rect is the authored placement of the collapsed
    // control. The drawer grows up and left from that point; a narrow or
    // short authored hit area must never resize the menu's visual system.
    // Clamp only at the authored frame boundary, never to dialog/speaker
    // geometry, so restore events cannot replace the project position.
    const authoredCenterX = (authoredLeft + authoredRight) / 2;
    const authoredCenterY = (authoredTop + authoredBottom) / 2;
    const anchorX = factorX === 1 ? authoredRight : factorX === 0.5 ? authoredCenterX : authoredLeft;
    const anchorY = factorY === 1 ? authoredBottom : factorY === 0.5 ? authoredCenterY : authoredTop;
    const rawLeft = factorX === 1 ? authoredRight - width : factorX === 0.5 ? authoredCenterX - width / 2 : authoredLeft;
    const rawTop = factorY === 1 ? authoredBottom - height : factorY === 0.5 ? authoredCenterY - height / 2 : authoredTop;
    const left = Math.max(8, Math.min(frameWidth - width - 8, rawLeft));
    const top = Math.max(8, Math.min(frameHeight - height - 8, rawTop));
    const right = left + width;
    const bottom = top + height;
    return {
      left: right - width,
      top,
      width,
      height,
      anchorX,
      anchorY,
    };
  }
  const dialog = input.dialogRect ?? { x: 4.8, y: 70.6, width: 91.2, height: 23.6 };
  const baseWidth = QUICK_MENU_DEFAULT_METRICS.desktopSurfaceWidth;
  const baseHeight = 7 * QUICK_MENU_DEFAULT_METRICS.actionHitSize
    + QUICK_MENU_DEFAULT_METRICS.desktopToggleHitSize
    + 7 * QUICK_MENU_DEFAULT_METRICS.actionGap
    + QUICK_MENU_DEFAULT_METRICS.surfacePadding * 2;
  const fitScale = Math.min(1, (frameWidth - 16) / baseWidth, (frameHeight - 16) / baseHeight);
  const width = baseWidth * fitScale;
  const height = baseHeight * fitScale;
  const anchorX = ((dialog.x + dialog.width) / 100) * frameWidth;
  const anchorY = (dialog.y / 100) * frameHeight;
  const right = Math.min(frameWidth - 8, Math.max(width + 8, anchorX));
  const bottom = Math.min(frameHeight - 8, Math.max(height + 8, anchorY));
  return {
    left: right - width,
    top: bottom - height,
    width,
    height,
    anchorX: right,
    anchorY: bottom,
  };
}

export function normalizeQuickMenuVariant(value: unknown): QuickMenuVariant {
  return value === "A" ? "A" : "C";
}

export function resolveQuickMenuDirection(input: {
  variant?: QuickMenuVariant | string;
  configuredDirection?: QuickMenuDirection | string;
  anchor?: string;
  y?: number;
}): Exclude<QuickMenuDirection, "auto"> {
  const variant = normalizeQuickMenuVariant(input.variant);
  const configured = input.configuredDirection;
  if (configured === "up" || configured === "down") return configured;
  if (variant === "A" && (configured === "left" || configured === "right")) return configured;
  if (variant === "A") return "left";
  // C is a vertical drawer. Its authored default is upward; legacy
  // horizontal/auto values must not silently turn the default top-right
  // menu into a downward glass panel. Callers may still opt into `down`.
  return "up";
}

function safeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeScale(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 1;
}

/**
 * Returns the logical 16:9 authored frame used by runtime layout percentages.
 * Portrait playback rotates this logical frame in CSS, so callers must not
 * substitute the post-rotation physical viewport dimensions.
 */
export function resolveQuickMenuAuthoredFrame(input: {
  viewportWidth: number;
  viewportHeight: number;
}): QuickMenuAuthoredFrame {
  const viewportWidth = safeNumber(input.viewportWidth, 1280);
  const viewportHeight = safeNumber(input.viewportHeight, 720);
  if (viewportHeight > viewportWidth) {
    const width = Math.min(viewportHeight, viewportWidth * 16 / 9);
    return { width, height: width * 9 / 16, rotated: true };
  }
  const width = Math.min(viewportWidth, viewportHeight * 16 / 9);
  return { width, height: width * 9 / 16, rotated: false };
}

/**
 * Resolves expanded quick-menu geometry from the same authored component
 * dimensions used by the editor preview. The returned values are pixels in
 * the current viewport and intentionally avoid fixed 154px/286px limits.
 */
export function resolveQuickMenuSurfaceMetrics(input: QuickMenuSurfaceMetricsInput): QuickMenuSurfaceMetrics {
  const variant = normalizeQuickMenuVariant(input.variant);
  const definition = QUICK_MENU_VARIANT_METRICS[variant];
  const viewportWidth = safeNumber(input.viewportWidth, 1280);
  const viewportHeight = safeNumber(input.viewportHeight, 720);
  const renderScale = safeScale(input.renderScale);
  const mobile = Boolean(input.mobile);
  const breakpoint: QuickMenuBreakpoint = input.breakpoint ?? (mobile ? "mobile" : "desktop");
  const direction = resolveQuickMenuDirection({
    variant,
    configuredDirection: input.direction,
    anchor: input.anchor,
  });
  const baseToggleHitSize = mobile
    ? QUICK_MENU_DEFAULT_METRICS.mobileToggleHitSize
    : QUICK_MENU_DEFAULT_METRICS.desktopToggleHitSize;
  const baseActionHitSize = QUICK_MENU_DEFAULT_METRICS.actionHitSize;

  if (variant === "C") {
    // C is one authored 1 × 8 drawer. Seven full-width actions occupy the
    // first seven rows and the toggle owns the final row. If the complete
    // surface cannot fit a short logical frame, every material, visual and
    // hit metric scales by the same factor instead of changing columns.
    const columns = QUICK_MENU_DEFAULT_METRICS.drawerColumns;
    const rows = QUICK_MENU_DEFAULT_METRICS.drawerRows;
    const baseSurfacePadding = QUICK_MENU_DEFAULT_METRICS.surfacePadding;
    const baseToggleGap = QUICK_MENU_DEFAULT_METRICS.actionGap;
    const targetWidth = mobile
      ? QUICK_MENU_DEFAULT_METRICS.mobileSurfaceWidth
      : QUICK_MENU_DEFAULT_METRICS.desktopSurfaceWidth;
    const targetHeight = 7 * baseActionHitSize
      + baseToggleHitSize
      + 7 * baseToggleGap
      + baseSurfacePadding * 2;
    const insets = input.safeInsets ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const availableWidth = Math.max(1, viewportWidth - insets.left - insets.right - 16);
    // Fit the complete eight-row surface above dialogue, then translate it
    // within that safe band. Authored anchors never rewrite project data.
    const dialogueTop = input.dialogueTop ?? viewportHeight * 0.706;
    const availableHeight = Math.max(1, Math.min(viewportHeight - insets.bottom, dialogueTop) - insets.top - 16);
    // Keep the entire visual system proportional to the logical frame, not
    // the physical device/DPR. At 1080p the approved enlarged baseline is
    // 140%; larger frames preserve that proportion. The editor separately
    // applies one canvas scale after this fit.
    const frameScale = viewportHeight / 1080 * 1.4;
    const fitScale = Math.min(frameScale, availableWidth / targetWidth, availableHeight / targetHeight);
    const uniformScale = fitScale * renderScale;
    const actionHitSize = baseActionHitSize * uniformScale;
    const toggleHitSize = baseToggleHitSize * uniformScale;
    const surfacePadding = baseSurfacePadding * uniformScale;
    const toggleGap = baseToggleGap * uniformScale;
    const surfaceWidth = targetWidth * uniformScale;
    const cellWidth = surfaceWidth - surfacePadding * 2;
    const cellHeight = actionHitSize;
    const contentHeight = 7 * actionHitSize
      + toggleHitSize
      + 7 * toggleGap
      + surfacePadding * 2;
    const surfaceHeight = contentHeight;
    const actionVisualWidth = cellWidth;
    const actionVisualHeight = cellHeight;
    const actionVisualSize = Math.min(actionVisualWidth, actionVisualHeight);
    const toggleVisualSize = actionVisualHeight
      * (QUICK_MENU_VISUAL_RATIO.toggle / QUICK_MENU_VISUAL_RATIO.action)
      * 1.5;
    const toggleCell = {
      column: 1,
      row: 8,
    };

    return {
      variant,
      axis: definition.axis,
      direction,
      breakpoint,
      compact: fitScale < frameScale,
      uniformScale,
      columns,
      rows,
      surfaceWidth,
      surfaceHeight,
      actionVisualWidth,
      actionVisualHeight,
      actionVisualSize,
      toggleVisualSize,
      toggleVisualWidth: toggleVisualSize,
      toggleVisualHeight: toggleVisualSize,
      toggleHitSize,
      actionHitSize,
      surfacePadding,
      actionGap: toggleGap,
      toggleGap,
      cellWidth,
      cellHeight,
      toggleCell,
      expandedBounds: {
        width: surfaceWidth,
        height: surfaceHeight,
      },
      contentHeight,
      scrollable: false,
    };
  }

  const aBaseActionGap = 4;
  const aBaseSurfacePadding = 8;
  const aBaseActionHitSize = QUICK_MENU_DEFAULT_METRICS.actionHitSize;
  const aBaseToggleHitSize = mobile
    ? QUICK_MENU_DEFAULT_METRICS.mobileToggleHitSize
    : QUICK_MENU_DEFAULT_METRICS.desktopToggleHitSize;
  const requiredSurfaceWidth = 7 * aBaseActionHitSize
    + 6 * aBaseActionGap
    + aBaseToggleHitSize
    + aBaseSurfacePadding * 2;
  // A is one authored capsule: seven non-overlapping 48px action hit areas
  // plus the toggle. Miniature editor adapters scale this complete geometry
  // as a unit; shrinking only the surface would leave the internal grid
  // outside its visible and interactive bounds.
  const fitScale = Math.min(
    1,
    viewportWidth / requiredSurfaceWidth,
    viewportHeight / (mobile ? 64 : 72),
  );
  const uniformScale = fitScale * renderScale;
  const actionGap = aBaseActionGap * uniformScale;
  const surfacePadding = aBaseSurfacePadding * uniformScale;
  const actionHitSize = aBaseActionHitSize * uniformScale;
  const toggleHitSize = aBaseToggleHitSize * uniformScale;
  const surfaceWidth = requiredSurfaceWidth * uniformScale;
  const surfaceHeight = (mobile ? 64 : 72) * uniformScale;
  const columns = 7;
  const rows = 1;
  const compactViewport = viewportHeight < 600 || viewportWidth < 520;
  const actionVisualHeight = actionHitSize;
  const actionVisualWidth = actionHitSize;
  const actionVisualSize = Math.min(actionVisualWidth, actionVisualHeight);
  const toggleVisualSize = Math.max(actionVisualHeight, actionHitSize)
    * (QUICK_MENU_VISUAL_RATIO.toggle / QUICK_MENU_VISUAL_RATIO.action)
    * 1.5;

  return {
    variant,
    axis: definition.axis,
    direction,
    breakpoint,
    compact: compactViewport,
    uniformScale,
    columns,
    rows,
    surfaceWidth,
    surfaceHeight,
    actionVisualWidth,
    actionVisualHeight,
    actionVisualSize,
    toggleVisualSize,
    toggleVisualWidth: toggleVisualSize,
    toggleVisualHeight: toggleVisualSize,
    toggleHitSize,
    actionHitSize,
    surfacePadding,
    actionGap,
    toggleGap: 0,
    cellWidth: actionHitSize,
    cellHeight: surfaceHeight,
    toggleCell: {
      column: 8,
      row: 1,
    },
    expandedBounds: {
      width: surfaceWidth,
      height: surfaceHeight,
    },
    contentHeight: surfaceHeight,
    scrollable: false,
  };
}

function quickMenuAnchor(
  rect: NonNullable<QuickMenuPresentationInput["layout"]>["rect"],
  dialogRect?: QuickMenuPresentationInput["dialogRect"],
): {
  horizontal: "left" | "center" | "right";
  vertical: "top" | "center" | "bottom";
  x: number;
  y: number;
} {
  if (dialogRect && isDefaultQuickMenuPlacement(rect)) {
    return {
      horizontal: "right",
      vertical: "top",
      x: (dialogRect.x + dialogRect.width) / 100,
      y: dialogRect.y / 100,
    };
  }
  const value = rect ?? { x: 93.3, y: 9.5, width: 48, height: 8, anchor: "top_right" };
  const horizontal = value.anchor?.endsWith("_right") || value.anchor === "top_right" || value.anchor === "bottom_right"
    ? "right"
    : value.anchor?.endsWith("_center") || value.anchor === "center"
      ? "center"
      : "left";
  const vertical = value.anchor?.startsWith("bottom")
    ? "bottom"
    : value.anchor === "center"
      ? "center"
      : "top";
  const horizontalFactor = horizontal === "right" ? 1 : horizontal === "center" ? 0.5 : 0;
  const verticalFactor = vertical === "bottom" ? 1 : vertical === "center" ? 0.5 : 0;
  const left = (value.x - value.width * horizontalFactor) / 100;
  const top = (value.y - value.height * verticalFactor) / 100;
  return {
    horizontal,
    vertical,
    x: (left + value.width / 100 * horizontalFactor) * 1,
    y: (top + value.height / 100 * verticalFactor) * 1,
  };
}

/** Read-only recognition: known generated placements follow the dialogue;
 * explicit author coordinates remain independent of the default anchor. */
function isDefaultQuickMenuPlacement(rect: NonNullable<QuickMenuPresentationInput["layout"]>["rect"]): boolean {
  if (!rect) return true;
  return QUICK_MENU_KNOWN_DEFAULT_FINGERPRINTS.some(fingerprint =>
    [fingerprint.rect, fingerprint.mobileRect].some(value =>
      value.anchor === rect.anchor && (["x", "y", "width", "height"] as const)
        .every(key => Math.abs(value[key] - rect[key]) < .0001)));
}

/**
 * Shared presentation contract consumed by the Runtime and editor adapters.
 * It owns authored-coordinate conversion, state-dependent root geometry,
 * stable hit metrics and the material values that must remain in parity.
 */
export function resolveQuickMenuPresentation(input: QuickMenuPresentationInput): QuickMenuPresentation {
  const frameWidth = safeNumber(input.authoredFrame.width, 1280);
  const frameHeight = safeNumber(input.authoredFrame.height, 720);
  const rect = input.layout?.rect;
  const style = input.layout?.style;
  const actionStyle = input.layout?.actionStyle;
  const anchor = quickMenuAnchor(rect, input.dialogRect);
  const placement = input.dialogRect && isDefaultQuickMenuPlacement(rect) ? "dialog-top-right" : "authored";
  const renderScale = safeScale(input.renderScale);
  const renderedFrameWidth = frameWidth * renderScale;
  const renderedFrameHeight = frameHeight * renderScale;
  const anchorX = anchor.x * renderedFrameWidth;
  const anchorY = anchor.y * renderedFrameHeight;
  let metrics = resolveQuickMenuSurfaceMetrics({
    variant: style?.quickMenuVariant ?? "C",
    direction: style?.quickMenuDirection ?? "auto",
    anchor: rect?.anchor,
    layoutWidth: rect?.width ?? 48,
    layoutHeight: rect?.height ?? 8,
    viewportWidth: frameWidth,
    viewportHeight: frameHeight,
    anchorY: anchor.y * 100,
    dialogueTop: input.dialogueTop,
    safeInsets: input.safeInsets,
    mobile: input.mobile,
    renderScale: input.renderScale,
  });
  // A C drawer is attached to one persistent toggle, not two independently
  // clamped state rectangles. Fit around that authored toggle before rendering.
  if (metrics.variant === "C") {
    const insets = input.safeInsets ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const minX = (insets.left + 8) * renderScale;
    const minY = (insets.top + 8) * renderScale;
    const maxX = renderedFrameWidth - (insets.right + 8) * renderScale;
    const dialogAnchored = placement === "dialog-top-right";
    const maxY = (Math.min(frameHeight - insets.bottom, input.dialogueTop ?? frameHeight * .706) - 8) * renderScale;
    const verticalFactor = anchor.vertical === "bottom" ? 1 : anchor.vertical === "center" ? .5 : 0;
    const horizontalFactor = anchor.horizontal === "right" ? 1 : anchor.horizontal === "center" ? .5 : 0;
    // Solve in base units: height, toggle and padding all depend on the
    // same scale. Iterative fits leave a residual anchor shift and produce
    // different answers when the editor canvas uses a smaller renderScale.
    const baseHeight = metrics.surfaceHeight / metrics.uniformScale;
    const baseToggle = metrics.toggleHitSize / metrics.uniformScale;
    const basePadding = metrics.surfacePadding / metrics.uniformScale;
    const upScale = Math.max(0, (anchorY - minY - (dialogAnchored ? 8 * renderScale : 0))
      / (baseHeight - (dialogAnchored ? 0 : baseToggle * (1 - verticalFactor)) - basePadding));
    const downScale = Math.max(0, (maxY - anchorY)
      / (baseHeight - baseToggle * verticalFactor - basePadding));
    const direction: "up" | "down" = dialogAnchored || upScale >= metrics.uniformScale || upScale >= downScale ? "up" : "down";
    const fittedScale = Math.min(metrics.uniformScale, direction === "up" ? upScale : downScale);
    if (fittedScale < metrics.uniformScale) {
      metrics = resolveQuickMenuSurfaceMetrics({
        variant: "C", direction, viewportWidth: frameWidth, viewportHeight: frameHeight,
        layoutWidth: rect?.width ?? 48, layoutHeight: rect?.height ?? 8,
        safeInsets: insets, dialogueTop: insets.top + 16 + baseHeight * fittedScale / renderScale,
        mobile: input.mobile, renderScale,
      });
    }
    metrics.direction = direction;
    const padding = metrics.surfacePadding;
    const size = metrics.toggleHitSize;
    const toggleLeft = anchorX - size * horizontalFactor;
    const toggleTop = dialogAnchored ? anchorY - 8 * renderScale - size : anchorY - size * verticalFactor;
    const expandedLeft = Math.max(minX, Math.min(maxX - metrics.surfaceWidth, toggleLeft + size + padding - metrics.surfaceWidth));
    // The anchor describes the toggle, not the padded drawer's outer edge.
    const expandedTop = Math.max(minY, Math.min(maxY + (dialogAnchored ? padding : 0) - metrics.surfaceHeight,
      direction === "up" ? toggleTop + size + padding - metrics.surfaceHeight : toggleTop - padding));
    const localX = metrics.surfaceWidth - size - padding;
    const localY = direction === "up" ? metrics.surfaceHeight - size - padding : padding;
    const expanded = input.state === "expanded";
    return {
      placement,
      anchor: { x: anchorX, y: anchorY, horizontal: anchor.horizontal, vertical: anchor.vertical },
      root: expanded ? { left: expandedLeft, top: expandedTop, width: metrics.surfaceWidth, height: metrics.surfaceHeight }
        : { left: expandedLeft + localX, top: expandedTop + localY, width: size, height: size },
      surface: { width: metrics.surfaceWidth, height: metrics.surfaceHeight, contentHeight: metrics.contentHeight },
      toggle: { width: size, height: size, left: expanded ? localX : 0, top: expanded ? localY : 0 },
      actions: metrics, uniformScale: metrics.uniformScale, scrollable: false,
      material: {
        surface: { borderRadius: (style?.borderRadius ?? 16) * metrics.uniformScale, borderWidth: (style?.borderWidth ?? 1) * metrics.uniformScale, backdropBlur: (style?.backdropBlur ?? 12) * metrics.uniformScale, opacity: style?.opacity ?? .66 },
        action: { borderRadius: (actionStyle?.borderRadius ?? 10) * metrics.uniformScale, borderWidth: (actionStyle?.borderWidth ?? 1) * metrics.uniformScale, backdropBlur: (actionStyle?.backdropBlur ?? 6) * metrics.uniformScale, opacity: actionStyle?.opacity ?? .72 },
      },
    };
  }
  const collapsedWidth = metrics.toggleHitSize;
  const collapsedHeight = metrics.toggleHitSize;
  const collapsedLeft = anchor.horizontal === "right"
    ? anchorX - collapsedWidth
    : anchor.horizontal === "center"
      ? anchorX - collapsedWidth / 2
      : anchorX;
  const collapsedTop = anchor.vertical === "bottom"
    ? anchorY - collapsedHeight
    : anchor.vertical === "center"
      ? anchorY - collapsedHeight / 2
      : anchorY;
  const expandedWidth = metrics.surfaceWidth;
  const expandedHeight = metrics.surfaceHeight;
  const rawExpandedLeft = anchor.horizontal === "right"
    ? anchorX - expandedWidth
    : anchor.horizontal === "center"
      ? anchorX - expandedWidth / 2
      : anchorX;
  const rawExpandedTop = metrics.direction === "down"
    ? anchorY
    : anchor.vertical === "bottom"
      ? anchorY - expandedHeight
      : anchorY - expandedHeight;
  const insets = input.safeInsets ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const safeLeft = (insets.left + 8) * renderScale;
  const safeTop = (insets.top + 8) * renderScale;
  const safeRight = renderedFrameWidth - (insets.right + 8) * renderScale;
  const safeBottom = Math.min(frameHeight - insets.bottom, input.dialogueTop ?? frameHeight * 0.706) * renderScale;
  const expandedLeft = Math.max(safeLeft, Math.min(safeRight - expandedWidth, rawExpandedLeft));
  const expandedTop = Math.max(safeTop, Math.min(safeBottom - expandedHeight - 8 * renderScale, rawExpandedTop));
  const root = input.state === "collapsed"
    ? {
      left: Math.max(insets.left * renderScale, Math.min(renderedFrameWidth - insets.right * renderScale - collapsedWidth, collapsedLeft)),
      top: Math.max(insets.top * renderScale, Math.min(renderedFrameHeight - insets.bottom * renderScale - collapsedHeight, collapsedTop)),
      width: collapsedWidth,
      height: collapsedHeight,
    }
    : {
      left: expandedLeft,
      top: expandedTop,
      width: expandedWidth,
      height: expandedHeight,
    };
  return {
    placement,
    anchor: {
      x: anchorX,
      y: anchorY,
      horizontal: anchor.horizontal,
      vertical: anchor.vertical,
    },
    root,
    surface: {
      width: expandedWidth,
      height: expandedHeight,
      contentHeight: metrics.contentHeight,
    },
    toggle: {
      width: metrics.toggleHitSize,
      height: metrics.toggleHitSize,
      left: input.state === "collapsed" ? 0 : Math.max(0, expandedWidth - metrics.toggleHitSize - metrics.surfacePadding),
      top: input.state === "collapsed" ? 0 : Math.max(0, expandedHeight - metrics.toggleHitSize - metrics.surfacePadding),
    },
    actions: metrics,
    uniformScale: metrics.uniformScale,
    scrollable: metrics.scrollable,
    material: {
      surface: {
        borderRadius: (style?.borderRadius ?? 16) * metrics.uniformScale,
        borderWidth: (style?.borderWidth ?? 1) * metrics.uniformScale,
        backdropBlur: (style?.backdropBlur ?? 12) * metrics.uniformScale,
        opacity: style?.opacity ?? 0.66,
      },
      action: {
        borderRadius: (actionStyle?.borderRadius ?? 10) * metrics.uniformScale,
        borderWidth: (actionStyle?.borderWidth ?? 1) * metrics.uniformScale,
        backdropBlur: (actionStyle?.backdropBlur ?? 6) * metrics.uniformScale,
        opacity: actionStyle?.opacity ?? 0.72,
      },
    },
  };
}
