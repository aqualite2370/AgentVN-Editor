/**
 * Single source of truth for authored quick-menu defaults.
 *
 * The placement values come from the latest read-only "隐忍的成长" project
 * backup. Runtime and editor adapters may scale the rendered surface, but
 * must not rewrite these authored coordinates unless the user drags it.
 */
export const QUICK_MENU_DEFAULT_RECT = {
  x: 93.30292735649188,
  y: 9.503216429473,
  width: 48,
  height: 8,
  anchor: "top_right",
} as const;

export const QUICK_MENU_DEFAULT_MOBILE_RECT = {
  x: 98,
  y: 5.127577039930555,
  width: 42.32408820258245,
  height: 11.927469135802468,
  anchor: "top_right",
} as const;

export const QUICK_MENU_DEFAULT_SURFACE_STYLE = {
  borderWidth: 1,
  borderRadius: 16,
  opacity: 0.66,
  padding: 6,
  gap: 6,
  quickMenuDirection: "auto",
  quickMenuVariant: "C",
  shadow: "soft",
  backdropBlur: 12,
} as const;

export const QUICK_MENU_DEFAULT_ACTION_STYLE = {
  borderWidth: 1,
  borderRadius: 10,
  opacity: 0.72,
  fontSize: 16,
  fontWeight: 800,
  shadow: "none",
  backdropBlur: 6,
} as const;

export const QUICK_MENU_BUTTON_DEFINITIONS = [
  { component_id: "quick_rollback_button", label: "回退按钮", displayLabel: "回退" },
  { component_id: "quick_auto_button", label: "自动播放按钮", displayLabel: "自动" },
  { component_id: "quick_skip_button", label: "快进按钮", displayLabel: "快进" },
  { component_id: "quick_save_load_button", label: "存档读档按钮", displayLabel: "存档" },
  { component_id: "quick_history_button", label: "历史记录按钮", displayLabel: "历史" },
  { component_id: "quick_hide_ui_button", label: "隐藏界面按钮", displayLabel: "隐藏" },
  { component_id: "quick_main_menu_button", label: "主菜单按钮", displayLabel: "菜单" },
] as const;

export const QUICK_MENU_DEFAULT_METRICS = {
  drawerColumns: 1,
  drawerRows: 8,
  // The drawer is intentionally more present than the old compact 260×438
  // treatment.  These are visual and hit-area baselines; quickMenuMetrics
  // still applies one uniform scale when the frame cannot fit all eight rows.
  desktopSurfaceWidth: 320,
  // Android keeps the same single-column eight-row composition, but the
  // wider mobile baseline prevents the drawer from looking like a narrow
  // strip after the height constraint scales it to the dialog-safe band.
  mobileSurfaceWidth: 420,
  actionHitSize: 56,
  desktopToggleHitSize: 56,
  mobileToggleHitSize: 56,
  actionGap: 8,
  surfacePadding: 8,
} as const;

export const QUICK_MENU_DEFAULT_MOTION = {
  surfaceDurationMs: 220,
  actionDurationMs: 180,
  actionDelayMs: 60,
  reducedMotionDurationMs: 80,
} as const;

const LEGACY_AGENTVN_SURFACE_STYLE = {
  backgroundColor: "#0d121f",
  color: "#f6f8ff",
  borderColor: "#d8e2ff",
  borderWidth: 1,
  borderRadius: 16,
  opacity: 0.72,
  padding: 4,
  gap: 3,
  quickMenuDirection: "up",
  quickMenuVariant: "C",
  shadow: "soft",
  backdropBlur: 16,
} as const;

const LEGACY_AGENTVN_ACTION_STYLE = {
  backgroundColor: "#192234",
  color: "#f6f8ff",
  borderColor: "transparent",
  borderWidth: 1,
  borderRadius: 8,
  opacity: 0.72,
  shadow: "soft",
} as const;

export const QUICK_MENU_KNOWN_DEFAULT_FINGERPRINTS = [
  {
    id: "agentvn-v1.1",
    rect: { x: 98, y: 2, width: 48, height: 8, anchor: "top_right" },
    mobileRect: { x: 98, y: 2, width: 58, height: 12, anchor: "top_right" },
    surfaceStyle: LEGACY_AGENTVN_SURFACE_STYLE,
    actionStyle: LEGACY_AGENTVN_ACTION_STYLE,
    quickMenuVisible: undefined,
    quickMenuLocked: undefined,
    quickMenuZIndex: 50,
    actionVisible: true,
    actionLocked: false,
  },
  {
    id: "agentvn-v1.2",
    rect: { x: 98, y: 2, width: 42, height: 9, anchor: "top_right" },
    mobileRect: { x: 98, y: 2, width: 50, height: 10, anchor: "top_right" },
    surfaceStyle: LEGACY_AGENTVN_SURFACE_STYLE,
    actionStyle: LEGACY_AGENTVN_ACTION_STYLE,
    quickMenuVisible: undefined,
    quickMenuLocked: undefined,
    quickMenuZIndex: 50,
    actionVisible: true,
    actionLocked: false,
  },
  {
    id: "agentvn-v1.3",
    rect: { x: 93, y: 73, width: 7, height: 7, anchor: "top_right" },
    mobileRect: { x: 93, y: 61, width: 9, height: 9, anchor: "top_right" },
    surfaceStyle: LEGACY_AGENTVN_SURFACE_STYLE,
    actionStyle: LEGACY_AGENTVN_ACTION_STYLE,
    quickMenuVisible: undefined,
    quickMenuLocked: undefined,
    quickMenuZIndex: 50,
    actionVisible: true,
    actionLocked: false,
  },
  {
    id: "hidden-growth-v1.2",
    rect: QUICK_MENU_DEFAULT_RECT,
    mobileRect: QUICK_MENU_DEFAULT_MOBILE_RECT,
    surfaceStyle: {
      backdropBlur: 16,
      backgroundColor: "#102b41",
      borderColor: "#285674",
      borderRadius: 13,
      color: "#e8f7ff",
      fontAssetId: "unifont_jp-17_0_05",
      shadow: "soft",
    },
    actionStyle: {
      backgroundColor: "#143650",
      borderColor: "#285674",
      borderRadius: 8,
      borderWidth: 1,
      color: "#e8f7ff",
      opacity: 0.72,
      shadow: "none",
    },
    quickMenuVisible: undefined,
    quickMenuLocked: undefined,
    quickMenuZIndex: 50,
    actionVisible: true,
    actionLocked: false,
  },
  {
    id: "hidden-growth-v1.3",
    rect: QUICK_MENU_DEFAULT_RECT,
    mobileRect: QUICK_MENU_DEFAULT_MOBILE_RECT,
    surfaceStyle: {
      backdropBlur: 16,
      backgroundColor: "#102b41",
      borderColor: "#285674",
      borderRadius: 13,
      color: "#e8f7ff",
      fontAssetId: "unifont_jp-17_0_05",
      quickMenuDirection: "auto",
      quickMenuVariant: "C",
      shadow: "soft",
    },
    actionStyle: {
      backgroundColor: "#143650",
      borderColor: "#285674",
      borderRadius: 8,
      borderWidth: 1,
      color: "#e8f7ff",
      opacity: 0.72,
      shadow: "none",
    },
    quickMenuVisible: undefined,
    quickMenuLocked: undefined,
    quickMenuZIndex: 50,
    actionVisible: true,
    actionLocked: false,
  },
] as const;
