import type { UILayoutComponent, UILayoutRect, UISkinLayout } from "./uiSkin";

export const RENPY_QUICK_CONTROLS = [
  ["quick_rollback_button", "回退"], ["quick_history_button", "历史"],
  ["quick_skip_button", "快进"], ["quick_auto_button", "自动"],
  ["quick_save_load_button", "存档"], ["quick_save_button", "快存"],
  ["quick_load_button", "快读"], ["quick_settings_button", "设置"],
  ["quick_hide_ui_button", "隐藏"],
] as const;

/** Add missing native controls without replacing existing customizations. */
export function ensureRenpyQuickControls(layout: UISkinLayout): UISkinLayout {
  if (layout.layout_type !== "renpy") return layout;
  return { ...layout, screens: layout.screens.map(screen => screen.screen_id !== "player" ? screen : {
    ...screen, components: [...screen.components, ...RENPY_QUICK_CONTROLS
      .filter(([id]) => !screen.components.some(component => component.component_id === id))
      .map(([component_id, label]): UILayoutComponent => ({
        component_id, label, component_type: "quick_button", style: {
          backgroundColor: "transparent", color: "#888888", borderColor: "transparent",
          borderWidth: 0, borderRadius: 0, opacity: 1, backdropBlur: 0,
          ...structuredClone(screen.components.find(component => component.component_id === "quick_save_load_button")?.style ?? {}),
        },
        stateStyles: structuredClone(screen.components.find(component => component.component_id === "quick_save_load_button")?.stateStyles),
      }))],
  }) };
}

/** Nine fixed actions, one row. Geometry is independent of AgentVN's drawer. */
export function resolveRenpyQuickBar(
  frame: { width: number; height: number },
  safeBounds: { x: number; y: number; width: number; height: number },
  button: { width: number; height: number } = { width: 62, height: 32 },
  authoredRect?: UILayoutRect,
) {
  const width = Math.max(1, frame.width);
  const height = Math.max(1, frame.height);
  const viewportScale = Math.min(width / 1280, height / 720);
  const safeWidth = Math.max(1, safeBounds.width / 100 * width);
  const safeHeight = Math.max(1, safeBounds.height / 100 * height);
  const baseButtonWidth = Math.max(1, button.width);
  const baseButtonHeight = Math.max(1, button.height);
  const baseGap = 6;
  const baseWidth = RENPY_QUICK_CONTROLS.length * baseButtonWidth + (RENPY_QUICK_CONTROLS.length - 1) * baseGap;
  const baseHeight = baseButtonHeight;
  const margin = Math.min(8 * viewportScale, safeWidth / 16, safeHeight / 16);
  let scale = Math.max(0.001, Math.min(viewportScale,
    (safeWidth - margin * 2) / baseWidth, (safeHeight - margin * 2) / baseHeight));
  if (authoredRect) {
    // Width/height bound one uniformly scaled row, never nine stretched slots.
    scale = Math.max(0.001, Math.min(
      authoredRect.width / 100 * width / baseWidth,
      authoredRect.height / 100 * height / baseHeight,
      (safeWidth - margin * 2) / baseWidth,
      (safeHeight - margin * 2) / baseHeight,
    ));
  }
  const rowWidth = baseWidth * scale, rowHeight = baseHeight * scale;
  const anchor = authoredRect?.anchor;
  const anchorX = anchor === "center" || anchor === "top_center" || anchor === "bottom_center"
    ? 0.5 : anchor === "top_right" || anchor === "bottom_right" ? 1 : 0;
  const anchorY = anchor === "center" ? 0.5
    : anchor === "bottom_left" || anchor === "bottom_center" || anchor === "bottom_right" ? 1 : 0;
  const safeLeft = safeBounds.x / 100 * width, safeTop = safeBounds.y / 100 * height;
  const clamp = (value: number, start: number, size: number, rowSize: number) =>
    Math.max(start + margin, Math.min(start + size - margin - rowSize, value));
  return {
    scale,
    width: rowWidth,
    height: rowHeight,
    x: authoredRect
      ? clamp(authoredRect.x / 100 * width - rowWidth * anchorX, safeLeft, safeWidth, rowWidth)
      : safeLeft + (safeWidth - rowWidth) / 2,
    y: authoredRect
      ? clamp(authoredRect.y / 100 * height - rowHeight * anchorY, safeTop, safeHeight, rowHeight)
      : (safeBounds.y + safeBounds.height) / 100 * height - margin - rowHeight,
    buttonWidth: baseButtonWidth * scale,
    fontSize: 14 * scale,
    gap: baseGap * scale,
  };
}

/** Opt-in starts at the existing desktop dock, rather than the legacy drawer rect. */
export function defaultRenpyQuickBarRect(
  frame: { width: number; height: number },
  button?: { width: number; height: number },
): UILayoutRect {
  const bar = resolveRenpyQuickBar(frame, { x: 0, y: 0, width: 100, height: 100 }, button);
  return { x: bar.x / frame.width * 100, y: bar.y / frame.height * 100,
    width: bar.width / frame.width * 100, height: bar.height / frame.height * 100, anchor: "top_left" };
}

/** A custom upper toolbar is not a bottom dock and must not collapse reading. */
export function resolveRenpyQuickBarReadingBounds(
  frame: { width: number; height: number },
  safe: { x: number; y: number; width: number; height: number },
  bar: ReturnType<typeof resolveRenpyQuickBar>,
  text: UILayoutRect = { x: 5, y: 80, width: 90, height: 12 },
  custom = false,
) {
  const textTop = text.y / 100 * frame.height;
  const horizontalOverlap = bar.x < (text.x + text.width) / 100 * frame.width
    && bar.x + bar.width > text.x / 100 * frame.width;
  const reserveDialogDock = !custom || horizontalOverlap && bar.y > textTop;
  const dialogMaxHeight = Math.max(1, reserveDialogDock
    ? bar.y - textTop - 8 * bar.scale
    : text.height / 100 * frame.height);
  // NVL's normal reading envelope occupies the lower 70%, above a 7% gap.
  const reserveNvlDock = !custom || bar.y + bar.height > frame.height * 0.23
    && bar.y > safe.y / 100 * frame.height + frame.height * 0.07;
  const nvlBottomOffset = Math.max(frame.height * 0.07,
    reserveNvlDock ? frame.height - bar.y + 8 * bar.scale : 0);
  return { dialogMaxHeight, nvlBottomOffset,
    nvlMaxHeight: Math.max(1, Math.min(frame.height * 0.7,
      frame.height - nvlBottomOffset - safe.y / 100 * frame.height)) };
}
