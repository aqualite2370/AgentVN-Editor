import type { UILayoutComponent, UISkinLayout } from "./uiSkin";

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
        },
      }))],
  }) };
}

/** Nine fixed actions, one row. Geometry is independent of AgentVN's drawer. */
export function resolveRenpyQuickBar(
  frame: { width: number; height: number },
  safeBounds: { x: number; y: number; width: number; height: number },
  button: { width: number; height: number } = { width: 62, height: 32 },
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
  const scale = Math.max(0.001, Math.min(viewportScale,
    (safeWidth - margin * 2) / baseWidth, (safeHeight - margin * 2) / baseHeight));
  return {
    scale,
    width: baseWidth * scale,
    height: baseHeight * scale,
    x: safeBounds.x / 100 * width + (safeWidth - baseWidth * scale) / 2,
    y: (safeBounds.y + safeBounds.height) / 100 * height - margin - baseHeight * scale,
    buttonWidth: baseButtonWidth * scale,
    fontSize: 14 * scale,
    gap: baseGap * scale,
  };
}
