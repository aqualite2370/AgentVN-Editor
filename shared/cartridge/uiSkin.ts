import type { BackgroundFit, CartridgeValidationResult, ValidationIssue } from "./types";
import { validateCustomComponentDefinition, type CustomComponentDefinition } from "./customComponent";
import { validateExternalUrl } from "./externalAction";
import { assetIdFromUILayoutReference, isUILayoutAssetReference } from "./uiAssetReference";
import { normalizeQuickMenuVariant } from "./quickMenuMetrics";
import type { QuickMenuVariant } from "./quickMenuMetrics";
import { renpyGUIErrors, type RenpyGUI } from "./renpyGui";
import type { DialogueModeLayouts } from "./dialogueModeLayout";
import type { ConfirmationLayout } from "./confirmationLayout";
import { dialogPortraitLayoutErrors, type DialogPortraitLayout } from "./dialogPortraitLayout";
import { compileControlPresentation, type ControlPresentationSource } from "./controlPresentation";
import { ensureRenpyQuickControls } from "./renpyQuickBar";
import { ensureRenpyTitleControls, renpyTitleTextErrors, type RenpyTitleText } from "./renpyTitleControls";
import { gameViewportErrors, type GameViewportConfig } from "./gameViewport";
import {
  QUICK_MENU_BUTTON_DEFINITIONS,
  QUICK_MENU_DEFAULT_ACTION_STYLE,
  QUICK_MENU_KNOWN_DEFAULT_FINGERPRINTS,
  QUICK_MENU_DEFAULT_MOBILE_RECT,
  QUICK_MENU_DEFAULT_RECT,
  QUICK_MENU_DEFAULT_SURFACE_STYLE,
} from "./quickMenuDefaults";

export { QUICK_MENU_BUTTON_DEFINITIONS } from "./quickMenuDefaults";

export const UI_LAYOUT_VERSION = "2.0.0";
export const DEFAULT_UI_LAYOUT_PATH = "ui/layout.json";
export const DEFAULT_TITLE_ACTION_MASK_COMPONENT_ID = "title_default_action_mask";

export type UILayoutScreenId =
  | "title"
  | "player"
  | "game_menu"
  | "save_load"
  | "preferences"
  | "history"
  | "gallery"
  | "about"
  | "help";

export type UILayoutComponentType =
  | "mask"
  | "stage_background"
  | "dialog_panel"
  | "speaker_label"
  | "dialog_text"
  | "continue_indicator"
  | "choice_list"
  | "choice_option"
  | "quick_menu"
  | "quick_button"
  | "main_menu_hero"
  | "main_menu_continue_button"
  | "main_menu_start_button"
  | "main_menu_save_load_button"
  | "main_menu_library_button"
  | "main_menu_gallery_button"
  | "main_menu_settings_button"
  | "main_menu_about_button"
  | "main_menu_exit_button"
  | "main_menu_custom_button_container"
  | "main_menu_custom_button"
  | "game_menu_nav"
  | "menu_button"
  | "save_slot_grid"
  | "settings_group"
  | "history_list"
  | "gallery_grid"
  | "about_panel"
  | "help_panel"
  | "import_panel"
  | "custom_component";

export type UILayoutBreakpoint = "desktop" | "mobile";
export type UILayoutQuickMenuDirection = "auto" | "up" | "down" | "left" | "right";
export type UILayoutAnchor =
  | "top_left"
  | "top_center"
  | "top_right"
  | "center"
  | "bottom_left"
  | "bottom_center"
  | "bottom_right";

export interface UILayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
  anchor?: UILayoutAnchor;
}

export interface UILayoutComponentStyle {
  maskMode?: "blur" | "solid" | "image";
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundFit?: BackgroundFit;
  color?: string;
  accentColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  opacity?: number;
  /** Page material only; independent of content, including background images. */
  backgroundOpacity?: number;
  /** Page foreground (text, controls and content images), never its material. */
  contentOpacity?: number;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontAssetId?: string;
  padding?: number;
  gap?: number;
  shadow?: "none" | "soft" | "strong";
  backdropBlur?: number;
  textAlign?: "left" | "center" | "right";
  columns?: number;
  quickMenuDirection?: UILayoutQuickMenuDirection;
  quickMenuVariant?: QuickMenuVariant;
}

/** Existing background-material defaults, not the CSS opacity of the entire
 * component. Authoring must not write these inherited values into a layout.
 * Legacy generic components also apply an explicit opacity to the element;
 * this resolver intentionally does not change that separate behavior.
 */
export function resolveUILayoutBackgroundOpacity(
  componentType: UILayoutComponentType,
  style?: UILayoutComponentStyle,
): number {
  if (style?.backgroundOpacity !== undefined) return style.backgroundOpacity;
  if (style?.opacity !== undefined) return style.opacity;
  if (componentType === "quick_menu") return 0.94;
  if (["mask", "choice_list", "choice_option", "quick_button",
    "main_menu_continue_button", "main_menu_start_button", "main_menu_save_load_button",
    "main_menu_gallery_button", "main_menu_settings_button", "main_menu_about_button",
    "main_menu_custom_button"].includes(componentType)) {
    return 1;
  }
  return 0.78;
}

/** Only these shipped renderers own independent page material/content layers.
 * Button states, masks and dialogue have separate existing contracts. */
export function supportsUILayoutOpacityLayers(type: UILayoutComponentType): boolean {
  return ["main_menu_hero", "settings_group", "save_slot_grid", "history_list",
    "gallery_grid", "about_panel", "help_panel"].includes(type);
}

export function hasUILayoutOpacityLayers(style?: UILayoutComponentStyle): boolean {
  return style?.backgroundOpacity !== undefined || style?.contentOpacity !== undefined;
}

export interface UILayoutMotion {
  durationMs?: number;
  easing?: "standard" | "soft" | "snappy";
}

export type UILayoutActionKind = "none" | "external_url";

export interface UILayoutAction {
  kind: UILayoutActionKind;
  url?: string;
  open_mode?: "system_browser";
}

export interface UILayoutComponent {
  component_id: string;
  component_type: UILayoutComponentType;
  label?: string;
  required?: boolean;
  locked?: boolean;
  visible?: boolean;
  zIndex?: number;
  rect?: UILayoutRect;
  /** @deprecated Legacy import-only field. Unified layouts never export it. */
  mobileRect?: UILayoutRect;
  style?: UILayoutComponentStyle;
  /** Local states inherit from this control's normal style, then shared roles. */
  stateStyles?: Partial<Record<"normal" | "hover" | "selected" | "disabled", UILayoutComponentStyle>>;
  /** Built-in title styling is opt-in through the client layout editor. */
  titleButtonStyleSource?: "layout";
  motion?: UILayoutMotion;
  action?: UILayoutAction;
  /** Safe, structured component AST; never executable HTML or script. */
  customComponent?: CustomComponentDefinition;
  /** Author-owned safe HTML/CSS, active only when the layout enables it. */
  presentation?: ControlPresentationSource;
}

/** Display aliases only; preserve an author's custom label and stored styles. */
export function speakerContainerDisplayLabel(component: Pick<UILayoutComponent, "label">): string {
  return component.label === undefined || ["说话人名牌", "人物名牌", "姓名容器"].includes(component.label)
    ? "姓名容器"
    : component.label;
}

export function isBuiltinTitleButton(component: Pick<UILayoutComponent, "component_type">): boolean {
  return ["main_menu_continue_button", "main_menu_start_button", "main_menu_save_load_button",
    "main_menu_gallery_button", "main_menu_settings_button", "main_menu_about_button"].includes(component.component_type);
}

export const DEFAULT_TITLE_TEXT_BUTTON_STYLE: Readonly<UILayoutComponentStyle> = {
  backgroundColor: "transparent", borderColor: "transparent", borderWidth: 0, borderRadius: 0,
  color: "#f6f8ff", fontSize: 18, fontWeight: 600, shadow: "none", backdropBlur: 0, padding: 0,
};

/** Resolve display only: legacy project/theme styles remain in the saved source. */
export function resolveTitleButtonStyle(component: UILayoutComponent): UILayoutComponentStyle | undefined {
  if (!isBuiltinTitleButton(component)) return component.style;
  return component.titleButtonStyleSource === "layout"
    ? { ...DEFAULT_TITLE_TEXT_BUTTON_STYLE, ...component.style }
    : { ...DEFAULT_TITLE_TEXT_BUTTON_STYLE };
}

/** All explicit style edits use the effective style, not a hidden legacy base. */
export function editUILayoutComponentStyle(component: UILayoutComponent, patch: Partial<UILayoutComponentStyle>): UILayoutComponent {
  return {
    ...component,
    ...(isBuiltinTitleButton(component) ? { titleButtonStyleSource: "layout" as const } : {}),
    style: Object.fromEntries(Object.entries({ ...resolveTitleButtonStyle(component), ...patch })
      .filter(([, value]) => value !== undefined)),
  };
}

export const SAFE_DIALOG_PLAYER_RECTS: Record<
  "dialog_panel" | "speaker_label" | "dialog_text" | "continue_indicator",
  { rect: UILayoutRect; mobileRect: UILayoutRect }
> = {
  dialog_panel: {
    rect: { x: 4.8, y: 70.6, width: 91.2, height: 23.6 },
    mobileRect: { x: 3.8, y: 62.8, width: 92.4, height: 30.0 },
  },
  speaker_label: {
    rect: { x: 5.7, y: 71.4, width: 13.6, height: 6.4 },
    mobileRect: { x: 5.8, y: 65.2, width: 17, height: 8 },
  },
  dialog_text: {
    rect: { x: 6.6, y: 78.4, width: 82.2, height: 13.8 },
    mobileRect: { x: 6.4, y: 73.2, width: 83.2, height: 16.8 },
  },
  continue_indicator: {
    rect: { x: 84.9, y: 89.0, width: 7.4, height: 4.0 },
    mobileRect: { x: 79.9, y: 88.0, width: 10.9, height: 5.2 },
  },
};

export interface UILayoutTokens {
  colorBackground?: string;
  colorSurface?: string;
  colorSurfaceStrong?: string;
  colorInk?: string;
  colorMuted?: string;
  colorAccent?: string;
  colorAccent2?: string;
  colorLine?: string;
  colorPanel?: string;
  colorPanelText?: string;
  colorControl?: string;
  colorControlHover?: string;
  colorControlActive?: string;
  colorControlText?: string;
  colorSliderTrack?: string;
  colorSliderActive?: string;
  colorSliderThumb?: string;
  colorDialog?: string;
  colorDialogText?: string;
  colorSpeakerPlate?: string;
  colorSpeakerText?: string;
  colorChoice?: string;
  colorChoiceText?: string;
  colorQuickMenu?: string;
  colorFocus?: string;
  colorDanger?: string;
  colorWarning?: string;
  colorSuccess?: string;
  fontAssetId?: string;
  radius?: number;
  motionScale?: number;
  fontScale?: number;
}

export interface UILayoutScreen {
  screen_id: UILayoutScreenId;
  label?: string;
  components: UILayoutComponent[];
}

export interface UISkinAsset {
  asset_id: string;
  path: string;
  mime_type?: string;
}

export interface UISkinLayout {
  /** Absent in legacy layouts: preserve the AgentVN renderer. */
  layout_type?: "agentvn" | "renpy";
  /** Absent in old projects: retain their 16:9 canvas. Stored per layout. */
  gameViewport?: GameViewportConfig;
  renpy?: RenpyGUI;
  /** Optional independent title/version wording, only rendered by Ren'Py. */
  renpyTitleText?: RenpyTitleText;
  advancedPresentationEnabled?: boolean;
  /** Optional visual overrides; narrative presentation remains a script concern. */
  dialogueLayouts?: DialogueModeLayouts;
  /** Absent in old projects: preserve their existing confirmation presentation. */
  confirmationLayout?: ConfirmationLayout;
  /** Optional nameplate-relative portrait geometry; old layouts stay automatic. */
  dialogPortrait?: DialogPortraitLayout;
  ui_layout_version: string;
  name: string;
  target_runtime: string;
  tokens: UILayoutTokens;
  screens: UILayoutScreen[];
  assets: UISkinAsset[];
}

export interface UISkinManifestRef {
  path: string;
  version: string;
  name?: string;
}

export interface UISkinHealthOptions {
  availableAssetPaths?: string[];
  availableAssetIds?: string[];
}

export const CUSTOM_BUTTON_CONTAINER_COMPONENT_ID = "title_custom_button_container";

export type QuickMenuButtonComponentId = typeof QUICK_MENU_BUTTON_DEFINITIONS[number]["component_id"];

export function createDefaultQuickMenuButtons(): UILayoutComponent[] {
  return QUICK_MENU_BUTTON_DEFINITIONS.map(({ component_id, label }) => ({
    component_id,
    component_type: "quick_button",
    label,
    required: false,
    locked: false,
    visible: true,
    style: { ...QUICK_MENU_DEFAULT_ACTION_STYLE },
  }));
}

export function createDefaultMask(componentId = "mask_1", label = "遮罩"): UILayoutComponent {
  return {
    component_id: componentId,
    component_type: "mask",
    label,
    required: false,
    locked: false,
    visible: true,
    zIndex: 1,
    rect: { x: 8, y: 20, width: 34, height: 60 },
    mobileRect: { x: 8, y: 16, width: 84, height: 68 },
    style: {
      maskMode: "blur",
      backgroundColor: "rgba(8, 13, 22, 0.62)",
      opacity: 0.85,
      backdropBlur: 20,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: "rgba(255, 255, 255, 0.18)",
      shadow: "soft",
    },
  };
}

export function createDefaultTitleActionMask(): UILayoutComponent {
  return {
    ...createDefaultMask(DEFAULT_TITLE_ACTION_MASK_COMPONENT_ID, "默认按钮遮罩"),
    zIndex: 20,
    rect: { x: 77, y: 27, width: 20, height: 57 },
    mobileRect: { x: 71, y: 27, width: 27, height: 57 },
  };
}

export function createDefaultCustomButtonContainer(): UILayoutComponent {
  return {
    component_id: CUSTOM_BUTTON_CONTAINER_COMPONENT_ID,
    component_type: "main_menu_custom_button_container",
    label: "自定义按钮容器",
    required: false,
    locked: false,
    visible: true,
    zIndex: 18,
    rect: { x: 5, y: 87, width: 22, height: 9 },
    mobileRect: { x: 5, y: 89, width: 29, height: 8 },
    style: {
      backgroundColor: "rgba(130, 182, 255, 0.06)",
      borderColor: "rgba(130, 182, 255, 0.58)",
      borderWidth: 1,
      borderRadius: 10,
      shadow: "none",
    },
  };
}

const allowedScreens: UILayoutScreenId[] = ["title", "player", "game_menu", "save_load", "preferences", "history", "gallery", "about", "help"];
const allowedComponentTypes: UILayoutComponentType[] = [
  "mask",
  "stage_background",
  "dialog_panel",
  "speaker_label",
  "dialog_text",
  "continue_indicator",
  "choice_list",
  "choice_option",
  "quick_menu",
  "quick_button",
  "main_menu_hero",
  "main_menu_continue_button",
  "main_menu_start_button",
  "main_menu_save_load_button",
  "main_menu_library_button",
  "main_menu_gallery_button",
  "main_menu_settings_button",
  "main_menu_about_button",
  "main_menu_exit_button",
  "main_menu_custom_button_container",
  "main_menu_custom_button",
  "game_menu_nav",
  "menu_button",
  "save_slot_grid",
  "settings_group",
  "history_list",
  "gallery_grid",
  "about_panel",
  "help_panel",
  "import_panel",
  "custom_component",
];
const requiredByScreen: Partial<Record<UILayoutScreenId, UILayoutComponentType[]>> = {
  title: [
    "main_menu_continue_button",
    "main_menu_start_button",
    "main_menu_save_load_button",
    "main_menu_gallery_button",
    "main_menu_settings_button",
    "main_menu_about_button",
  ],
  player: ["dialog_panel", "choice_list", "quick_menu"],
  save_load: ["save_slot_grid"],
  preferences: ["settings_group"],
  history: ["history_list"],
  gallery: ["gallery_grid"],
  about: ["about_panel"],
  help: ["help_panel"],
};

const legacyMainMenuActionsType = "main_menu_actions";
const titleActionComponentTypes = requiredByScreen.title ?? [];
const legacyTitleActionComponentTypes: UILayoutComponentType[] = [
  "main_menu_continue_button",
  "main_menu_start_button",
  "main_menu_save_load_button",
  "main_menu_library_button",
  "main_menu_gallery_button",
  "main_menu_settings_button",
  "main_menu_about_button",
];
const titleButtonFontSize = 18;

const defaultTitleButtonLabels: Partial<Record<UILayoutComponentType, string>> = {
  main_menu_continue_button: "继续游戏",
  main_menu_start_button: "开始游戏",
  main_menu_save_load_button: "存档",
  main_menu_gallery_button: "画廊",
  main_menu_settings_button: "设置",
  main_menu_about_button: "关于",
};

const legacyDefaultTitleButtonLabels: Partial<Record<UILayoutComponentType, readonly string[]>> = {
  main_menu_continue_button: ["继续游戏按钮"],
  main_menu_start_button: ["开始/重新开始按钮"],
  main_menu_save_load_button: ["存档/读档按钮"],
  main_menu_gallery_button: ["画廊按钮"],
  main_menu_settings_button: ["选项按钮", "选项"],
  main_menu_about_button: ["关于按钮"],
};

/**
 * Resolves the player-facing copy for a fixed title action.
 *
 * Layout labels historically doubled as editor-only identifiers (for example
 * “选项按钮”). Those legacy defaults, and the current generated defaults,
 * must not leak into the player UI. Any other non-empty label is an explicit
 * author override and wins over the runtime fallback.
 */
export function resolveTitleButtonLabel(
  componentType: UILayoutComponentType,
  authoredLabel: string | undefined,
  fallback: string,
): string {
  const label = authoredLabel?.trim();
  if (!label) return fallback;
  const defaultLabel = defaultTitleButtonLabels[componentType];
  if (label === defaultLabel) return fallback;
  if (legacyDefaultTitleButtonLabels[componentType]?.includes(label)) return fallback;
  return label;
}

const legacyDefaultTitleActionRects: Partial<Record<UILayoutComponentType, UILayoutRect>> = {
  main_menu_continue_button: { x: 78, y: 28, width: 18, height: 7 },
  main_menu_start_button: { x: 78, y: 36, width: 18, height: 7 },
  main_menu_save_load_button: { x: 78, y: 44, width: 18, height: 7 },
  main_menu_library_button: { x: 78, y: 52, width: 18, height: 7 },
  main_menu_gallery_button: { x: 78, y: 60, width: 18, height: 7 },
  main_menu_settings_button: { x: 78, y: 68, width: 18, height: 7 },
  main_menu_about_button: { x: 78, y: 76, width: 18, height: 7 },
};

const currentDefaultTitleActionRects: Partial<Record<UILayoutComponentType, UILayoutRect>> = {
  main_menu_continue_button: { x: 78, y: 28, width: 18, height: 7 },
  main_menu_start_button: { x: 78, y: 36, width: 18, height: 7 },
  main_menu_save_load_button: { x: 78, y: 44, width: 18, height: 7 },
  main_menu_gallery_button: { x: 78, y: 52, width: 18, height: 7 },
  main_menu_settings_button: { x: 78, y: 60, width: 18, height: 7 },
  main_menu_about_button: { x: 78, y: 68, width: 18, height: 7 },
};

const currentDefaultTitleActionMobileRects: Partial<Record<UILayoutComponentType, UILayoutRect>> = {
  main_menu_continue_button: { x: 72, y: 28, width: 25, height: 7 },
  main_menu_start_button: { x: 72, y: 36, width: 25, height: 7 },
  main_menu_save_load_button: { x: 72, y: 44, width: 25, height: 7 },
  main_menu_gallery_button: { x: 72, y: 52, width: 25, height: 7 },
  main_menu_settings_button: { x: 72, y: 60, width: 25, height: 7 },
  main_menu_about_button: { x: 72, y: 68, width: 25, height: 7 },
};

const v11DefaultTitleActionRects: Partial<Record<UILayoutComponentType, UILayoutRect>> = {
  main_menu_continue_button: { x: 78, y: 28, width: 18, height: 7 },
  main_menu_start_button: { x: 78, y: 36, width: 18, height: 7 },
  main_menu_save_load_button: { x: 78, y: 44, width: 18, height: 7 },
  main_menu_gallery_button: { x: 78, y: 52, width: 18, height: 7 },
  main_menu_settings_button: { x: 78, y: 60, width: 18, height: 7 },
  main_menu_about_button: { x: 78, y: 68, width: 18, height: 7 },
};

const v11DefaultTitleActionMobileRects: Partial<Record<UILayoutComponentType, UILayoutRect>> = {
  main_menu_continue_button: { x: 74, y: 28, width: 22, height: 7 },
  main_menu_start_button: { x: 74, y: 36, width: 22, height: 7 },
  main_menu_save_load_button: { x: 74, y: 44, width: 22, height: 7 },
  main_menu_gallery_button: { x: 74, y: 52, width: 22, height: 7 },
  main_menu_settings_button: { x: 74, y: 60, width: 22, height: 7 },
  main_menu_about_button: { x: 74, y: 68, width: 22, height: 7 },
};

function compareNumericVersions(left: unknown, right: string): number | undefined {
  if (typeof left !== "string") return -1;
  const parse = (value: string): number[] | undefined => {
    const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map(Number) : undefined;
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  if (!leftParts || !rightParts) return undefined;
  for (let index = 0; index < rightParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function rectMatches(left: UILayoutRect | undefined, right: UILayoutRect | undefined): boolean {
  if (!left || !right) return false;
  return ["x", "y", "width", "height"].every((key) => (
    Math.abs(left[key as keyof Pick<UILayoutRect, "x" | "y" | "width" | "height">] - right[key as keyof Pick<UILayoutRect, "x" | "y" | "width" | "height">]) <= 0.01
  ));
}

function serializableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(serializableValue).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${serializableValue(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function quickMenuStyleMatchesFingerprint(
  actual: UILayoutComponentStyle | undefined,
  expected: Partial<UILayoutComponentStyle>,
  defaults: Partial<UILayoutComponentStyle> = {},
): boolean {
  const actualStyle = actual ?? {};
  const expectedKeys = new Set(Object.keys(expected));
  for (const key of expectedKeys) {
    const expectedValue = expected[key as keyof UILayoutComponentStyle];
    const actualValue = actualStyle[key as keyof UILayoutComponentStyle]
      ?? defaults[key as keyof UILayoutComponentStyle];
    if (serializableValue(actualValue) !== serializableValue(expectedValue)) return false;
  }
  // Unknown user-authored style keys are treated as customization. This keeps
  // migration conservative while allowing legacy fingerprints to omit fields
  // introduced in a later layout version (for example quickMenuVariant).
  for (const key of Object.keys(actualStyle)) {
    if (expectedKeys.has(key)) continue;
    if ((key === "quickMenuVariant" || key === "quickMenuDirection")
      && (key === "quickMenuVariant" ? actualStyle[key] === "C" : actualStyle[key] === "auto")) continue;
    return false;
  }
  return true;
}

function quickMenuClusterMatchesKnownDefault(screen: UILayoutScreen): boolean {
  const quickMenu = screen.components.find((component) => component.component_type === "quick_menu");
  const quickButtons = screen.components.filter((component) => component.component_type === "quick_button");
  if (!quickMenu || quickButtons.length !== QUICK_MENU_BUTTON_DEFINITIONS.length) return false;
  return QUICK_MENU_KNOWN_DEFAULT_FINGERPRINTS.some((fingerprint) => {
    if (!rectMatches(quickMenu.rect, fingerprint.rect) || !rectMatches(quickMenu.mobileRect, fingerprint.mobileRect)) return false;
    if (!quickMenuStyleMatchesFingerprint(
      quickMenu.style,
      fingerprint.surfaceStyle,
      { quickMenuVariant: "C", quickMenuDirection: "auto" },
    )) return false;
    if (quickMenu.visible !== fingerprint.quickMenuVisible
      || quickMenu.locked !== fingerprint.quickMenuLocked
      || quickMenu.zIndex !== fingerprint.quickMenuZIndex) return false;
    return QUICK_MENU_BUTTON_DEFINITIONS.every(({ component_id }) => {
      const button = quickButtons.find((component) => component.component_id === component_id);
      return Boolean(button)
        && quickMenuStyleMatchesFingerprint(button?.style, fingerprint.actionStyle)
        && button?.visible === fingerprint.actionVisible
        && button?.locked === fingerprint.actionLocked;
    });
  });
}

function titleUsesLegacyDefaultActionLayout(screen: UILayoutScreen): boolean {
  return legacyTitleActionComponentTypes.every((componentType) => {
    const matches = screen.components.filter((component) => component.component_type === componentType);
    if (matches.length !== 1) return false;
    const component = matches[0];
    const expected = legacyDefaultTitleActionRects[componentType];
    return rectMatches(component.rect, expected) && rectMatches(component.mobileRect, expected);
  });
}

function titleUsesV11DefaultActionLayout(screen: UILayoutScreen): boolean {
  return Object.keys(v11DefaultTitleActionRects).every((componentType) => {
    const typedComponentType = componentType as UILayoutComponentType;
    const matches = screen.components.filter((component) => component.component_type === typedComponentType);
    if (matches.length !== 1) return false;
    const component = matches[0];
    return rectMatches(component.rect, v11DefaultTitleActionRects[typedComponentType])
      && rectMatches(component.mobileRect, v11DefaultTitleActionMobileRects[typedComponentType]);
  });
}

function migrateTitleActionsForVersion(screen: UILayoutScreen, _sourceVersion: unknown): UILayoutScreen {
  const useNewDefaultGeometry = titleUsesLegacyDefaultActionLayout(screen)
    || titleUsesV11DefaultActionLayout(screen);
  const components = screen.components.flatMap((component) => {
    if (component.component_type === "main_menu_library_button") return [];
    if (component.component_type === "main_menu_exit_button") return [];
    if (component.component_id === DEFAULT_TITLE_ACTION_MASK_COMPONENT_ID && useNewDefaultGeometry) {
      const defaultMask = createDefaultTitleActionMask();
      return [{
        ...component,
        rect: { ...defaultMask.rect! },
        mobileRect: { ...defaultMask.mobileRect! },
      }];
    }
    if (!titleActionComponentTypes.includes(component.component_type)) return [component];
    const nextRect = useNewDefaultGeometry ? currentDefaultTitleActionRects[component.component_type] : undefined;
    const nextMobileRect = useNewDefaultGeometry ? currentDefaultTitleActionMobileRects[component.component_type] : undefined;
    return [{
      ...component,
      ...(nextRect ? { rect: { ...nextRect }, mobileRect: { ...(nextMobileRect ?? nextRect) } } : {}),
      style: { ...(component.style ?? {}), fontSize: titleButtonFontSize },
      ...(useNewDefaultGeometry ? {
        zIndex: 20 + titleActionComponentTypes.indexOf(component.component_type),
      } : {}),
    }];
  });

  return {
    ...screen,
    // Defaults belong to new/reset layouts only. Absence in a saved layout
    // is authoritative, including layouts where the user deleted the mask.
    components,
  };
}

const v11DefaultQuickMenuRect: UILayoutRect = {
  x: 98,
  y: 2,
  width: 48,
  height: 8,
  anchor: "top_right",
};

const v11DefaultQuickMenuMobileRect: UILayoutRect = {
  x: 98,
  y: 2,
  width: 58,
  height: 12,
  anchor: "top_right",
};

const v12DefaultQuickMenuRect: UILayoutRect = {
  x: 98,
  y: 2,
  width: 42,
  height: 9,
  anchor: "top_right",
};

const v12DefaultQuickMenuMobileRect: UILayoutRect = {
  x: 98,
  y: 2,
  width: 50,
  height: 10,
  anchor: "top_right",
};

const currentDefaultQuickMenuRect: UILayoutRect = {
  ...QUICK_MENU_DEFAULT_RECT,
};

const currentDefaultQuickMenuMobileRect: UILayoutRect = {
  ...QUICK_MENU_DEFAULT_MOBILE_RECT,
};

function migratePlayerLayoutForVersion(screen: UILayoutScreen, migrateDeprecatedComponents: boolean,
  layoutType?: UISkinLayout["layout_type"]): UILayoutScreen {
  if (screen.screen_id !== "player") return screen;
  const quickMenu = screen.components.find((component) => component.component_type === "quick_menu");
  const replaceKnownDefaultQuickMenuCluster = migrateDeprecatedComponents
    && quickMenuClusterMatchesKnownDefault(screen);
  const preserveCustomQuickMenuCluster = migrateDeprecatedComponents
    && Boolean(quickMenu)
    && !replaceKnownDefaultQuickMenuCluster;
  const speakerLabel = screen.components.find((component) => component.component_type === "speaker_label");
  const usesRecognizedDefaultSpeakerGeometry = (
    rectMatches(speakerLabel?.rect, { x: 8, y: 71, width: 20, height: 5.5 })
    && rectMatches(speakerLabel?.mobileRect, { x: 6, y: 63, width: 24, height: 7 })
  );
  const usesCurrentDefaultQuickMenuGeometry = migrateDeprecatedComponents
    && (
      (
        rectMatches(quickMenu?.rect, v11DefaultQuickMenuRect)
        && rectMatches(quickMenu?.mobileRect, v11DefaultQuickMenuMobileRect)
      )
      || (
        rectMatches(quickMenu?.rect, v12DefaultQuickMenuRect)
        && rectMatches(quickMenu?.mobileRect, v12DefaultQuickMenuMobileRect)
      )
      || (
        rectMatches(quickMenu?.rect, currentDefaultQuickMenuRect)
        && rectMatches(quickMenu?.mobileRect, currentDefaultQuickMenuMobileRect)
      )
    );
  return {
    ...screen,
    components: screen.components.flatMap((component) => {
      if (migrateDeprecatedComponents && component.component_id === "quick_settings_button") {
        // AgentVN removed this legacy action; Ren'Py still has a native settings
        // action. Preserve its authored source before legacy cluster replacement.
        return layoutType === "renpy" ? [component] : [];
      }
      const mobileRect = component.mobileRect;
      let nextComponent = component;
      if (replaceKnownDefaultQuickMenuCluster && component.component_type === "quick_menu") {
        nextComponent = {
          ...component,
          label: "快捷菜单",
          required: true,
          rect: { ...currentDefaultQuickMenuRect },
          mobileRect: { ...currentDefaultQuickMenuMobileRect },
          style: { ...QUICK_MENU_DEFAULT_SURFACE_STYLE },
          zIndex: 50,
        };
      } else if (replaceKnownDefaultQuickMenuCluster && component.component_type === "quick_button") {
        nextComponent = {
          ...component,
          required: false,
          locked: false,
          visible: true,
          style: { ...QUICK_MENU_DEFAULT_ACTION_STYLE },
        };
      } else if (!preserveCustomQuickMenuCluster && usesCurrentDefaultQuickMenuGeometry && component.component_type === "quick_menu") {
        nextComponent = {
          ...component,
          rect: { ...currentDefaultQuickMenuRect },
          mobileRect: { ...currentDefaultQuickMenuMobileRect },
          style: {
            ...(component.style ?? {}),
            padding: 4,
            gap: 3,
            quickMenuDirection: component.style?.quickMenuDirection ?? "up",
            quickMenuVariant: normalizeQuickMenuVariant(component.style?.quickMenuVariant),
          },
        };
      }
      if (component.component_type === "quick_menu"
        && !nextComponent.style?.quickMenuDirection) {
        nextComponent = {
          ...nextComponent,
          style: {
            ...(nextComponent.style ?? {}),
            // Missing direction is a legacy omission, not a user override.
            // Keep custom geometry/material intact while making the C drawer's
            // historical upward default explicit for deterministic runtime
            // resolution.
            quickMenuDirection: "up",
            quickMenuVariant: normalizeQuickMenuVariant(nextComponent.style?.quickMenuVariant),
          },
        };
      }
      if (component.component_type === "quick_menu"
        && !preserveCustomQuickMenuCluster
        && !nextComponent.style?.quickMenuVariant) {
        nextComponent = {
          ...nextComponent,
          style: { ...(nextComponent.style ?? {}), quickMenuVariant: "C" },
        };
      }
      if (component.component_type === "speaker_label" && usesRecognizedDefaultSpeakerGeometry) {
        nextComponent = {
          ...nextComponent,
          rect: { ...SAFE_DIALOG_PLAYER_RECTS.speaker_label.rect },
          mobileRect: { ...SAFE_DIALOG_PLAYER_RECTS.speaker_label.mobileRect },
        };
      }
      const nextMobileRect = nextComponent.mobileRect;
      if (!nextMobileRect) return [nextComponent];
      if (component.component_type === "quick_menu"
        && !preserveCustomQuickMenuCluster
        && nextMobileRect.anchor === "top_right"
        && nextMobileRect.x < 75
        && usesCurrentDefaultQuickMenuGeometry) {
        return [{ ...nextComponent, mobileRect: { ...currentDefaultQuickMenuMobileRect } }];
      }
      if (component.component_type === "choice_list"
        && nextMobileRect.anchor === "center"
        && Math.abs(nextMobileRect.x - 50) > 5) {
        return [{ ...nextComponent, mobileRect: { ...nextMobileRect, x: 50 } }];
      }
      return [nextComponent];
    }),
  };
}

function roundLayoutValue(value: number): number {
  return Number(value.toFixed(2));
}

function getRectBounds(rects: Array<UILayoutRect | undefined>): UILayoutRect | undefined {
  const validRects = rects.filter((rect): rect is UILayoutRect => Boolean(rect));
  if (validRects.length === 0) return undefined;
  const left = Math.min(...validRects.map((rect) => rect.x));
  const top = Math.min(...validRects.map((rect) => rect.y));
  const right = Math.max(...validRects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...validRects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function remapRectToContainer(source: UILayoutRect, sourceBounds: UILayoutRect, container: UILayoutRect): UILayoutRect {
  const widthScale = sourceBounds.width > 0 ? container.width / sourceBounds.width : 1;
  const heightScale = sourceBounds.height > 0 ? container.height / sourceBounds.height : 1;
  const mapped = {
    x: roundLayoutValue(container.x + (source.x - sourceBounds.x) * widthScale),
    y: roundLayoutValue(container.y + (source.y - sourceBounds.y) * heightScale),
    width: roundLayoutValue(source.width * widthScale),
    height: roundLayoutValue(source.height * heightScale),
  };
  return source.anchor ? { ...mapped, anchor: source.anchor } : mapped;
}

function inheritLegacyActionStyle(
  base: UILayoutComponentStyle | undefined,
  legacy: UILayoutComponentStyle | undefined,
): UILayoutComponentStyle | undefined {
  if (!legacy) return base;
  const inherited: UILayoutComponentStyle = {
    borderColor: legacy.borderColor,
    borderWidth: legacy.borderWidth,
    borderRadius: legacy.borderRadius,
    color: legacy.color,
    opacity: legacy.opacity,
    fontSize: legacy.fontSize,
    fontWeight: legacy.fontWeight,
    fontStyle: legacy.fontStyle,
    shadow: legacy.shadow,
  };
  const definedInherited = Object.fromEntries(
    Object.entries(inherited).filter(([, value]) => value !== undefined),
  ) as UILayoutComponentStyle;
  return Object.keys(definedInherited).length > 0 ? { ...(base ?? {}), ...definedInherited } : base;
}

export function migrateLegacyUISkinLayout(layout?: UISkinLayout): UISkinLayout {
  if (!layout) return getDefaultUISkinLayout();
  const versionComparison = compareNumericVersions(layout.ui_layout_version, UI_LAYOUT_VERSION);
  if (versionComparison === 1) return layout;
  const shouldMigrateTitleLayout = versionComparison === -1;
  let migratedLayout = layout;
  const titleScreen = migratedLayout.screens?.find((screen) => screen.screen_id === "title");
  const legacyIndex = titleScreen?.components.findIndex(
    (component) => String(component.component_type) === legacyMainMenuActionsType,
  ) ?? -1;
  if (shouldMigrateTitleLayout && titleScreen && legacyIndex >= 0) {
    const legacyComponent = titleScreen.components[legacyIndex];
    const defaultTitleScreen = getDefaultUISkinLayout().screens.find((screen) => screen.screen_id === "title");
    const defaultActions = defaultTitleScreen?.components.filter(
      (component) => titleActionComponentTypes.includes(component.component_type),
    ) ?? [];
    const desktopBounds = getRectBounds(defaultActions.map((component) => component.rect));
    const mobileBounds = getRectBounds(defaultActions.map((component) => component.mobileRect ?? component.rect));
    const existingTypes = new Set(
      titleScreen.components
        .filter((_, index) => index !== legacyIndex)
        .map((component) => component.component_type),
    );
    const migratedActions = defaultActions
      .filter((component) => !existingTypes.has(component.component_type))
      .map((component, index) => ({
        ...component,
        rect: component.rect && desktopBounds && legacyComponent.rect
          ? remapRectToContainer(component.rect, desktopBounds, legacyComponent.rect)
          : component.rect,
        mobileRect: (component.mobileRect ?? component.rect) && mobileBounds && (legacyComponent.mobileRect ?? legacyComponent.rect)
          ? remapRectToContainer(
            component.mobileRect ?? component.rect!,
            mobileBounds,
            legacyComponent.mobileRect ?? legacyComponent.rect!,
          )
          : component.mobileRect,
        style: inheritLegacyActionStyle(component.style, legacyComponent.style),
        motion: legacyComponent.motion ?? component.motion,
        locked: legacyComponent.locked ?? component.locked,
        visible: legacyComponent.visible ?? component.visible,
        zIndex: legacyComponent.zIndex !== undefined ? legacyComponent.zIndex + index : component.zIndex,
      }));

    migratedLayout = {
      ...migratedLayout,
      screens: migratedLayout.screens.map((screen) => screen.screen_id !== "title" ? screen : {
        ...screen,
        components: screen.components.flatMap((component, index) => (
          index === legacyIndex
            ? migratedActions
            : String(component.component_type) === legacyMainMenuActionsType
              ? []
              : [component]
        )),
      }),
    };
  }

  if (shouldMigrateTitleLayout) {
    migratedLayout = {
      ...migratedLayout,
      ui_layout_version: UI_LAYOUT_VERSION,
      screens: migratedLayout.screens.map((screen) => {
        if (screen.screen_id !== "title") return screen;
        const migratedTitle = migrateTitleActionsForVersion(screen, layout.ui_layout_version);
        return {
          ...migratedTitle,
          components: migratedTitle.components.filter(
            (component) => migratedLayout.layout_type === "renpy" || component.component_type !== "main_menu_exit_button",
          ),
        };
      }),
    };
  }

  if (versionComparison === -1 || versionComparison === 0) {
    migratedLayout = {
      ...migratedLayout,
      screens: migratedLayout.screens.map((screen) => {
        const nextScreen = screen.screen_id === "title"
          ? {
            ...screen,
            components: screen.components.filter((component) => migratedLayout.layout_type === "renpy"
              || component.component_type !== "main_menu_exit_button"),
          }
          : screen;
        return migratePlayerLayoutForVersion(nextScreen, versionComparison === -1, migratedLayout.layout_type);
      }),
    };
  }

  const playerScreen = migratedLayout.screens?.find((screen) => screen.screen_id === "player");
  if (!playerScreen) return finalizeUnifiedLayout(migratedLayout);
  const existingIds = new Set(playerScreen.components.map((component) => component.component_id));
  const missingQuickButtons = createDefaultQuickMenuButtons().filter(
    (component) => !existingIds.has(component.component_id),
  );
  if (missingQuickButtons.length === 0) return finalizeUnifiedLayout(migratedLayout);
  return finalizeUnifiedLayout({
    ...migratedLayout,
    screens: migratedLayout.screens.map((screen) => screen.screen_id !== "player" ? screen : {
      ...screen,
      components: [...screen.components, ...missingQuickButtons],
    }),
  });
}

/**
 * Collapse the legacy two-breakpoint schema into the single PC-authored
 * layout. This is intentionally applied at every project/runtime/export
 * boundary so old projects remain importable while newly saved cartridges
 * never contain `mobileRect`.
 */
function finalizeUnifiedLayout(layout: UISkinLayout): UISkinLayout {
  return {
    ...layout,
    ui_layout_version: UI_LAYOUT_VERSION,
    screens: (layout.screens ?? []).map((screen) => ({
      ...screen,
      // Group metadata is authored data, not a runtime-painted rectangle.
      // Preserve it across save/export; renderers decide which components paint.
      components: (screen.components ?? []).map((component) => {
          const { mobileRect, ...withoutMobileRect } = component;
          const rect = component.rect ?? mobileRect;
          return rect ? { ...withoutMobileRect, rect } : withoutMobileRect;
        }),
    })),
  };
}

export interface UISkinRuntimeNormalization {
  layout: UISkinLayout;
  warnings: string[];
}

const runtimeColorFallbacks: Record<string, string> = {
  backgroundColor: "#192234",
  color: "#f6f8ff",
  accentColor: "#82b6ff",
  borderColor: "#d8e2ff",
};

function isSafeRuntimeColor(value: unknown): value is string {
  return value === "transparent" || validateColor(value);
}

function normalizeRuntimeStyle(
  style: unknown,
  tokens: UILayoutTokens,
  path: string,
  warnings: string[],
): UILayoutComponentStyle | undefined {
  if (!isPlainRecord(style)) return style === undefined ? undefined : {};
  const next = { ...style } as Record<string, unknown>;
  const tokenFallbacks: Record<string, string | undefined> = {
    backgroundColor: tokens.colorSurfaceStrong ?? runtimeColorFallbacks.backgroundColor,
    color: tokens.colorInk ?? runtimeColorFallbacks.color,
    accentColor: tokens.colorAccent ?? runtimeColorFallbacks.accentColor,
    borderColor: tokens.colorLine ?? runtimeColorFallbacks.borderColor,
  };
  for (const field of ["backgroundColor", "color", "accentColor", "borderColor"]) {
    if (next[field] === undefined) continue;
    if (isSafeRuntimeColor(next[field])) continue;
    const fallback = tokenFallbacks[field] ?? runtimeColorFallbacks[field];
    warnings.push(`${path}.${field} 已从历史 CSS 表达式回退为 ${fallback}`);
    next[field] = fallback;
  }
  if (next.backgroundImage !== undefined && !validateBackgroundImageReference(next.backgroundImage)) {
    warnings.push(`${path}.backgroundImage 已清除：素材引用不是卡带内安全路径`);
    delete next.backgroundImage;
    delete next.backgroundFit;
  }
  if (typeof next.borderRadius === "number" && Number.isFinite(next.borderRadius)) {
    const clamped = Math.max(0, Math.min(96, next.borderRadius));
    if (clamped !== next.borderRadius) {
      warnings.push(`${path}.borderRadius 已限制到 0-96 范围。`);
      next.borderRadius = clamped;
    }
  }
  if (typeof next.backdropBlur === "number" && Number.isFinite(next.backdropBlur)) {
    const clamped = Math.max(0, Math.min(48, next.backdropBlur));
    if (clamped !== next.backdropBlur) {
      warnings.push(`${path}.backdropBlur 已限制到 0-48 范围。`);
      next.backdropBlur = clamped;
    }
  }
  return next as UILayoutComponentStyle;
}

function normalizeRuntimeTokens(
  tokens: unknown,
  warnings: string[],
): UILayoutTokens {
  const defaults = getDefaultUISkinLayout().tokens;
  if (!isPlainRecord(tokens)) return { ...defaults };
  const next = { ...tokens } as Record<string, unknown>;
  for (const field of uiSkinColorTokenFields) {
    if (next[field] === undefined) continue;
    if (isSafeRuntimeColor(next[field])) continue;
    const fallback = defaults[field] as string | undefined;
    if (!fallback) continue;
    warnings.push(`ui.tokens.${field} 已从历史 CSS 表达式回退为 ${fallback}`);
    next[field] = fallback;
  }
  return next as UILayoutTokens;
}

/**
 * Adds the independent help page to legacy Ren'Py layouts at read boundaries.
 * Keeps every authored page/value intact and never mutates the supplied layout.
 */
export function ensureRenpyHelpScreen(layout: UISkinLayout): UISkinLayout {
  layout = ensureRenpyTitleControls(ensureRenpyQuickControls(layout));
  if (layout.layout_type !== "renpy" || layout.screens.some((screen) => screen.screen_id === "help")) {
    return layout;
  }
  return {
    ...layout,
    screens: [...layout.screens, {
      screen_id: "help",
      components: [{
        component_id: "help_panel",
        component_type: "help_panel",
        label: "帮助面板",
        required: true,
        rect: { x: 5, y: 18, width: 90, height: 68 },
      }],
    }],
  };
}

/**
 * Normalizes legacy UI skin values at runtime boundaries without mutating
 * the project/store object. This keeps old projects previewable while
 * preserving valid user-authored colors and image references.
 */
export function normalizeUISkinLayoutForRuntime(layout?: UISkinLayout): UISkinRuntimeNormalization {
  const migrated = migrateLegacyUISkinLayout(layout);
  const warnings: string[] = [];
  const cloned = ensureRenpyHelpScreen(JSON.parse(JSON.stringify(migrated)) as UISkinLayout);
  cloned.tokens = normalizeRuntimeTokens(cloned.tokens, warnings);
  cloned.screens = (cloned.screens ?? []).map((screen, screenIndex) => ({
    ...screen,
    components: (screen.components ?? []).map((component, componentIndex) => ({
      ...component,
      style: normalizeRuntimeStyle(
        resolveTitleButtonStyle(component),
        cloned.tokens,
        `ui.screens.${screenIndex}.components.${componentIndex}.style`,
        warnings,
      ),
    })),
  }));
  return { layout: cloned, warnings };
}

export const uiSkinColorTokenFields = [
  "colorBackground",
  "colorSurface",
  "colorSurfaceStrong",
  "colorInk",
  "colorMuted",
  "colorAccent",
  "colorAccent2",
  "colorLine",
  "colorPanel",
  "colorPanelText",
  "colorControl",
  "colorControlHover",
  "colorControlActive",
  "colorControlText",
  "colorSliderTrack",
  "colorSliderActive",
  "colorSliderThumb",
  "colorDialog",
  "colorDialogText",
  "colorSpeakerPlate",
  "colorSpeakerText",
  "colorChoice",
  "colorChoiceText",
  "colorQuickMenu",
  "colorFocus",
  "colorDanger",
  "colorWarning",
  "colorSuccess",
] as const satisfies readonly (keyof UILayoutTokens)[];

export const uiSkinNumberTokenFields = ["radius", "motionScale", "fontScale"] as const satisfies readonly (keyof UILayoutTokens)[];

function issue(code: string, message: string, severity: "error" | "warning" = "error", path?: string): ValidationIssue {
  return { code, message, severity, path };
}

function splitIssues(issues: ValidationIssue[]): CartridgeValidationResult {
  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity === "warning");
  return { ok: errors.length === 0, errors, warnings };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateColor(value: unknown): boolean {
  return value === "transparent"
    || (typeof value === "string" && (/^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\([\d\s.,%]+\)$/.test(value)));
}

function validateAssetPath(path: string): boolean {
  if (path.includes("../") || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return false;
  return path.startsWith("ui/assets/") || path.startsWith("assets/");
}

function validateBackgroundImageReference(value: unknown): value is string {
  return typeof value === "string" && (isUILayoutAssetReference(value) || validateAssetPath(value));
}

function validateRect(rect: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isPlainRecord(rect)) {
    issues.push(issue("ui_rect", `界面组件位置格式错误（rect）：${path} 必须是对象。原因：布局文件中的组件坐标结构不正确。影响：GameCLI 无法确定该控件在屏幕上的位置。解决方案：请回到客户端布局设计器重新保存布局，或把 rect 修正为包含 x、y、width、height 的对象。`, "error", path));
    return;
  }
  for (const field of ["x", "y", "width", "height"]) {
    const value = rect[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(issue("ui_rect", `界面组件坐标不是有效数字（${field}）：${path}.${field} 必须是有限数字。原因：布局坐标被写成了空值、文本或无限值。影响：GameCLI 无法正确摆放该控件。解决方案：请在布局设计器中重新调整该控件位置和尺寸。`, "error", `${path}.${field}`));
    }
  }
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (x < -20 || x > 120 || y < -20 || y > 120 || width <= 0 || width > 120 || height <= 0 || height > 120) {
    issues.push(issue("ui_rect_bounds", `界面组件超出安全范围（rect）：${path} 的位置或尺寸超出可编辑范围。原因：控件被拖得太远、太大或宽高为 0。影响：玩家端可能看不到该控件，或控件遮挡其他区域。解决方案：请在布局设计器中把控件移回画布，并设置合理宽高。`, "error", path));
  }
  if (rect.anchor && !["top_left", "top_center", "top_right", "center", "bottom_left", "bottom_center", "bottom_right"].includes(String(rect.anchor))) {
    issues.push(issue("ui_anchor", `界面锚点不支持（anchor）：${String(rect.anchor)} 不是有效锚点。原因：布局文件使用了 GameCLI 不认识的对齐方式。影响：控件在不同屏幕尺寸下可能错位。解决方案：请在布局设计器中重新选择锚点，或使用 top_left、center、bottom_right 等受支持值。`, "error", `${path}.anchor`));
  }
}

function validateStyle(style: unknown, path: string, issues: ValidationIssue[], allowPageOpacityLayers = false): void {
  if (!isPlainRecord(style)) {
    issues.push(issue("ui_style", `界面样式格式错误（style）：${path} 必须是对象。原因：布局文件中的样式结构不正确。影响：GameCLI 无法读取颜色、透明度、字体等设置。解决方案：请回到布局设计器重新保存，或把 style 修正为对象。`, "error", path));
    return;
  }
  if (hasUILayoutOpacityLayers(style) && !allowPageOpacityLayers) {
    issues.push(issue("ui_opacity_layers", "背景与内容透明度仅用于支持分层的页面区域；按钮、对白、确认框和遮罩使用各自的外观设置。", "error", path));
  }
  const allowed = new Set([
    "maskMode",
    "backgroundColor",
    "backgroundImage",
    "backgroundFit",
    "color",
    "accentColor",
    "borderColor",
    "borderWidth",
    "borderRadius",
    "opacity",
    "backgroundOpacity",
    "contentOpacity",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontAssetId",
    "padding",
    "gap",
    "shadow",
    "backdropBlur",
    "textAlign",
    "columns",
    "quickMenuDirection",
    "quickMenuVariant",
  ]);
  for (const [key, value] of Object.entries(style)) {
    if (!allowed.has(key)) {
      issues.push(issue("ui_style_field", `界面样式字段不支持（${key}）：GameCLI 不认识 ${path}.${key}。原因：布局文件包含了未开放的样式字段。影响：该样式不会被安全加载。解决方案：请删除该字段，或在布局设计器里使用支持的样式项。`, "error", `${path}.${key}`));
      continue;
    }
    if (["backgroundColor", "color", "accentColor", "borderColor"].includes(key) && !validateColor(value)) {
      issues.push(issue("ui_color", `颜色值不安全或格式错误（${key}）：${path}.${key} 需要 #RRGGBB、#RGB 或 rgba(...)。原因：颜色字段不是可识别的安全颜色。影响：GameCLI 无法稳定渲染该控件颜色。解决方案：请在布局设计器中重新选择颜色。`, "error", `${path}.${key}`));
    }
    if (key === "maskMode" && !["blur", "solid", "image"].includes(String(value))) {
      issues.push(issue("ui_mask_mode", `遮罩模式不支持（maskMode）：${String(value)}。`, "error", `${path}.${key}`));
    }
    if (key === "backgroundImage" && !validateBackgroundImageReference(value)) {
      issues.push(issue("ui_background_image", `背景图素材路径无效（backgroundImage）：${String(value)} 必须引用卡带内 ui/assets/ 或 assets/ 下的素材。原因：布局引用了未打包或不安全的素材路径。影响：玩家端无法显示该背景图。解决方案：请把图片导入素材库或 UI 素材，再在布局设计器中重新选择。`, "error", `${path}.${key}`));
    }
    if (key === "backgroundFit" && !["stretch", "contain", "cover"].includes(String(value))) {
      issues.push(issue("ui_background_fit", `背景图显示模式不支持（backgroundFit）：${String(value)} 不是有效选项。原因：GameCLI 只支持 stretch、contain 或 cover。影响：玩家端无法确定背景图如何铺放。解决方案：请在布局设计器中重新选择背景显示模式。`, "error", `${path}.${key}`));
    }
    if (["borderWidth", "borderRadius", "opacity", "backgroundOpacity", "contentOpacity", "fontSize", "fontWeight", "padding", "gap", "backdropBlur", "columns"].includes(key)) {
      if (typeof value !== "number" || !Number.isFinite(value)) issues.push(issue("ui_style_number", `界面样式数值无效（${key}）：${path}.${key} 必须是有限数字。原因：样式参数被写成了空值、文本或无限值。影响：GameCLI 无法正确渲染该控件。解决方案：请在布局设计器中重新输入该数值。`, "error", `${path}.${key}`));
      if (["backgroundOpacity", "contentOpacity"].includes(key) && typeof value === "number"
        && Number.isFinite(value) && (value < 0 || value > 1)) {
        issues.push(issue("ui_opacity_range", `${path}.${key} 必须在 0 到 1 之间。`, "error", `${path}.${key}`));
      }
      if (key === "borderRadius" && typeof value === "number" && Number.isFinite(value) && (value < 0 || value > 96)) {
        issues.push(issue("ui_border_radius", `圆角值超出范围：${path}.${key} 必须在 0 到 96 之间。`, "error", `${path}.${key}`));
      }
      if (key === "backdropBlur" && typeof value === "number" && Number.isFinite(value) && (value < 0 || value > 48)) {
        issues.push(issue("ui_backdrop_blur", `背景模糊值超出范围：${path}.${key} 必须在 0 到 48 之间。`, "error", `${path}.${key}`));
      }
    }
    if (key === "shadow" && !["none", "soft", "strong"].includes(String(value))) {
      issues.push(issue("ui_shadow", `阴影样式不支持（shadow）：${String(value)} 不是有效选项。原因：GameCLI 只支持 none、soft、strong。影响：控件阴影无法按预期显示。解决方案：请在布局设计器中重新选择阴影强度。`, "error", `${path}.${key}`));
    }
    if (key === "fontStyle" && !["normal", "italic"].includes(String(value))) {
      issues.push(issue("ui_font_style", `字体样式不支持（fontStyle）：${String(value)} 不是有效选项。原因：GameCLI 只支持 normal 或 italic。影响：该控件文字样式无法安全渲染。解决方案：请在主题编辑器中重新选择字体样式。`, "error", `${path}.${key}`));
    }
    if (key === "fontAssetId" && typeof value !== "string") {
      issues.push(issue("ui_font_asset", `Font asset id is invalid: ${path}.${key} must be a string.`, "error", `${path}.${key}`));
    }
    if (key === "textAlign" && !["left", "center", "right"].includes(String(value))) {
      issues.push(issue("ui_text_align", `文本对齐方式不支持（textAlign）：${String(value)} 不是有效选项。原因：GameCLI 只支持 left、center、right。影响：文字排版可能错位。解决方案：请在布局设计器中重新选择文字对齐方式。`, "error", `${path}.${key}`));
    }
    if (key === "quickMenuDirection" && !["auto", "up", "down", "left", "right"].includes(String(value))) {
      issues.push(issue("ui_quick_menu_direction", `快捷菜单方向不支持（quickMenuDirection）：${String(value)} 不是有效选项。原因：运行端只支持 auto、up、down、left、right。影响：快捷菜单可能无法展开。解决方案：请在布局设计器中重新选择快捷菜单方向。`, "error", `${path}.${key}`));
    }
    if (key === "quickMenuVariant" && !["A", "C"].includes(String(value))) {
      issues.push(issue("ui_quick_menu_variant", `快捷菜单方案不支持（quickMenuVariant）：${String(value)} 不是有效选项。原因：运行端只支持 A（列表样式）和 C（抽屉样式）。影响：快捷菜单将回退为抽屉样式。解决方案：请在布局设计器中重新选择快捷菜单方案。`, "error", `${path}.${key}`));
    }
  }
}

function validateTokens(tokens: unknown, path: string, issues: ValidationIssue[]): void {
  if (tokens === undefined) return;
  if (!isPlainRecord(tokens)) {
    issues.push(issue("ui_tokens", `主题 token 格式错误：${path} 必须是对象。原因：ui/layout.json 的 tokens 结构不正确。影响：GameCLI 无法读取主题颜色。解决方案：请回到客户端主题或客户端布局重新保存。`, "error", path));
    return;
  }
  const allowed = new Set<keyof UILayoutTokens>([
    ...uiSkinColorTokenFields,
    ...uiSkinNumberTokenFields,
    "fontAssetId",
  ]);
  for (const [key, value] of Object.entries(tokens)) {
    if (!allowed.has(key as keyof UILayoutTokens)) {
      issues.push(issue("ui_token_field", `主题 token 字段不支持（${key}）：GameCLI 不认识 ${path}.${key}。原因：主题文件包含未开放的 token 字段。影响：该字段不会被安全加载。解决方案：请删除该字段，或用当前版本主题编辑器重新保存。`, "error", `${path}.${key}`));
      continue;
    }
    if ((uiSkinColorTokenFields as readonly string[]).includes(key) && value !== undefined && !validateColor(value)) {
      issues.push(issue("ui_token_color", `主题颜色值无效（${key}）：${path}.${key} 需要 #RRGGBB、RGB 或 rgba(...)。原因：主题颜色不是安全颜色格式。影响：GameCLI 无法稳定渲染该主题。解决方案：请在客户端主题中重新选择颜色。`, "error", `${path}.${key}`));
    }
    if ((uiSkinNumberTokenFields as readonly string[]).includes(key)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push(issue("ui_token_number", `主题数值无效（${key}）：${path}.${key} 必须是有限数字。原因：主题数值被写成空值、文本或无限值。影响：GameCLI 无法应用字号、圆角或动效比例。解决方案：请在客户端主题中重新输入数值。`, "error", `${path}.${key}`));
        continue;
      }
      if (key === "radius" && (value < 0 || value > 48)) {
        issues.push(issue("ui_token_radius", `主题圆角超出范围：${path}.${key} 必须在 0 到 48 之间。`, "error", `${path}.${key}`));
      }
      if (key === "motionScale" && (value < 0 || value > 2)) {
        issues.push(issue("ui_token_motion", `主题动效比例超出范围：${path}.${key} 必须在 0 到 2 之间。`, "error", `${path}.${key}`));
      }
      if (key === "fontScale" && (value < 0.75 || value > 1.45)) {
        issues.push(issue("ui_token_font_scale", `主题字体比例超出范围：${path}.${key} 必须在 0.75 到 1.45 之间。`, "error", `${path}.${key}`));
      }
    }
    if (key === "fontAssetId" && value !== undefined && typeof value !== "string") {
      issues.push(issue("ui_token_font", `主题字体资源编号无效：${path}.${key} 必须是字符串。`, "error", `${path}.${key}`));
    }
  }
}

function validateForbiddenPayload(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isPlainRecord(value) && !Array.isArray(value)) return;
  // Only this declared, separately parsed source field may carry markup.
  // Arbitrary html/css elsewhere in a cartridge remain forbidden.
  if (/^ui\.screens\.\d+\.components\.\d+\.presentation$/.test(path)) return;
  if (/^ui\.(?:confirmationLayout\.(?:panel|title|text)|dialogueLayouts\.(?:nvl|bubble)\.(?:panel|speaker|text))Presentation$/.test(path)) return;
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
  for (const [key, child] of entries) {
    const nextPath = `${path}.${key}`;
    const lowerKey = key.toLowerCase();
    const isDeclaredActionUrl = lowerKey === "url" && path.endsWith(".action");
    if (["script", "javascript", "css", "html", "innerhtml", "onload", "onclick"].includes(lowerKey)) {
      issues.push(issue("ui_unsafe_field", `界面布局包含不安全字段（${key}）：原因：卡带 UI 不能携带脚本、HTML 或事件处理字段。影响：GameCLI 会拒绝加载以保护用户环境。解决方案：请删除该字段，并通过布局设计器重新保存。`, "error", nextPath));
    }
    if (!isDeclaredActionUrl && typeof child === "string" && (/https?:\/\//i.test(child) || /javascript:/i.test(child) || /<\s*style/i.test(child) || /<\s*script/i.test(child))) {
      issues.push(issue("ui_unsafe_value", `界面布局包含不安全字符串（${key}）：原因：卡带 UI 不允许外链、javascript:、style 或 script 内容。影响：GameCLI 会拒绝加载以保护用户环境。解决方案：请改用卡带内素材路径，并删除脚本或网页片段。`, "error", nextPath));
    }
    validateForbiddenPayload(child, nextPath, issues);
  }
}

function validateAction(action: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isPlainRecord(action)) {
    issues.push(issue("ui_action", "UI component action must be an object.", "error", path));
    return;
  }

  if (action.kind !== "none" && action.kind !== "external_url") {
    issues.push(
      issue(
        "ui_action_kind",
        "UI component action kind must be none or external_url.",
        "error",
        `${path}.kind`,
      ),
    );
    return;
  }

  if (action.kind === "none") return;

  const urlResult = validateExternalUrl(action.url);
  if (!urlResult.ok) {
    issues.push(issue(urlResult.code, urlResult.message, "error", `${path}.url`));
  }
  if (action.open_mode !== undefined && action.open_mode !== "system_browser") {
    issues.push(
      issue(
        "ui_action_open_mode",
        "External URL actions only support the system_browser open mode.",
        "error",
        `${path}.open_mode`,
      ),
    );
  }
}

export function validateUISkinLayout(layout: unknown): CartridgeValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(layout)) return splitIssues([issue("ui_layout", "客户端布局格式错误（ui）：布局根节点必须是对象。原因：ui/layout.json 结构损坏。影响：GameCLI 无法读取玩家界面布局。解决方案：请在布局设计器中恢复默认布局或重新保存。", "error", "ui")]);
  validateForbiddenPayload(layout, "ui", issues);
  for (const field of gameViewportErrors(layout.gameViewport))
    issues.push(issue("ui_viewport", "画面比例无效，请选择16:9、16:10或4:3。", "error", `ui.gameViewport.${field}`));
  if (layout.renpyTitleText !== undefined) {
    for (const field of renpyTitleTextErrors(layout.renpyTitleText))
      issues.push(issue("ui_renpy_title_text", "主页文字设置无效，请检查显隐开关、文字类型与长度。", "error",
        `ui.renpyTitleText${field ? `.${field}` : ""}`));
  }
  if (layout.advancedPresentationEnabled !== undefined && typeof layout.advancedPresentationEnabled !== "boolean")
    issues.push(issue("ui_presentation_enabled", "进阶开关必须是布尔值。", "error", "ui.advancedPresentationEnabled"));
  if (layout.dialogPortrait !== undefined) {
    for (const field of dialogPortraitLayoutErrors(layout.dialogPortrait))
      issues.push(issue("ui_dialog_portrait", "头像布局参数无效，请检查偏移及尺寸范围。", "error",
        `ui.dialogPortrait${field ? `.${field}` : ""}`));
  }
  if (layout.confirmationLayout !== undefined) {
    const config = layout.confirmationLayout;
    if (!isPlainRecord(config)) {
      issues.push(issue("ui_confirmation_layout", "确认提示布局必须是对象。", "error", "ui.confirmationLayout"));
    } else {
      for (const key of Object.keys(config)) {
        if (!["rect", "panelStyle", "titleStyle", "textStyle", "panelPresentation", "titlePresentation", "textPresentation"].includes(key))
          issues.push(issue("ui_confirmation_layout_field", "不支持的确认提示布局字段。", "error", `ui.confirmationLayout.${key}`));
      }
      if (config.rect !== undefined) validateRect(config.rect, "ui.confirmationLayout.rect", issues);
      for (const key of ["panelStyle", "titleStyle", "textStyle"]) {
        if (config[key] !== undefined) validateStyle(config[key], `ui.confirmationLayout.${key}`, issues);
      }
      for (const key of ["panelPresentation", "titlePresentation", "textPresentation"])
        if (config[key] !== undefined) for (const message of compileControlPresentation(config[key]).issues)
          issues.push(issue("ui_control_presentation", message, "error", `ui.confirmationLayout.${key}`));
    }
  }
  if (layout.dialogueLayouts !== undefined) {
    if (!isPlainRecord(layout.dialogueLayouts)) {
      issues.push(issue("ui_dialogue_layout", "对白模式布局必须是对象。", "error", "ui.dialogueLayouts"));
    } else for (const [mode, value] of Object.entries(layout.dialogueLayouts)) {
      const path = `ui.dialogueLayouts.${mode}`;
      if (!["nvl", "bubble"].includes(mode) || !isPlainRecord(value)) {
        issues.push(issue("ui_dialogue_layout", "对白模式或布局格式不受支持。", "error", path));
        continue;
      }
      for (const key of Object.keys(value)) {
        if (!["rect", "panelStyle", "textStyle", "speakerStyle", "panelPresentation", "textPresentation", "speakerPresentation"].includes(key))
          issues.push(issue("ui_dialogue_layout_field", "不支持的对白模式布局字段。", "error", `${path}.${key}`));
      }
      if (value.rect !== undefined) validateRect(value.rect, `${path}.rect`, issues);
      for (const key of ["panelStyle", "textStyle", "speakerStyle"]) {
        if (value[key] !== undefined) validateStyle(value[key], `${path}.${key}`, issues);
      }
      for (const key of ["panelPresentation", "textPresentation", "speakerPresentation"])
        if (value[key] !== undefined) for (const message of compileControlPresentation(value[key]).issues)
          issues.push(issue("ui_control_presentation", message, "error", `${path}.${key}`));
    }
  }
  for (const path of renpyGUIErrors(layout.renpy)) {
    issues.push(issue("ui_renpy_gui", "Ren’Py 导航参数无效，请在专用编辑页修正后保存。", "error", `ui.${path}`));
  }
  if (layout.layout_type !== undefined && layout.layout_type !== "agentvn" && layout.layout_type !== "renpy") {
    issues.push(issue("ui_layout_type", "不支持的客户端布局类型，请更新编辑器与 GameCLI。", "error", "ui.layout_type"));
  }
  if (layout.ui_layout_version !== UI_LAYOUT_VERSION) {
    issues.push(issue("ui_layout_version", `客户端布局版本不支持（ui_layout_version）：当前为 ${String(layout.ui_layout_version)}，需要 ${UI_LAYOUT_VERSION}。原因：布局来自其他版本。影响：GameCLI 可能无法正确渲染界面。解决方案：请用当前版本 AgentVN 打开布局设计器并重新保存。`, "error", "ui.ui_layout_version"));
  }
  if (typeof layout.name !== "string" || !layout.name.trim()) issues.push(issue("ui_name", "客户端布局名称缺失（name）：原因：ui/layout.json 没有布局名称。影响：布局管理和诊断信息无法识别该方案。解决方案：请在布局设计器中填写名称并保存。", "error", "ui.name"));
  if (typeof layout.target_runtime !== "string" || !layout.target_runtime.trim()) issues.push(issue("ui_runtime", "目标 GameCLI 版本缺失（target_runtime）：原因：布局没有声明适配的运行端版本。影响：GameCLI 无法判断兼容性。解决方案：请用当前版本布局设计器重新保存。", "error", "ui.target_runtime"));
  if (!Array.isArray(layout.screens)) issues.push(issue("ui_screens", "界面页面列表格式错误（screens）：原因：screens 必须是数组。影响：GameCLI 无法读取标题页、播放页、存档页等布局。解决方案：请恢复默认布局或重新保存。", "error", "ui.screens"));
  if (!Array.isArray(layout.assets)) issues.push(issue("ui_assets", "UI 素材列表格式错误（assets）：原因：assets 必须是数组。影响：GameCLI 无法校验布局引用的图片素材。解决方案：请重新导入 UI 素材并保存布局。", "error", "ui.assets"));

  validateTokens(layout.tokens, "ui.tokens", issues);

  for (const [assetIndex, asset] of (Array.isArray(layout.assets) ? layout.assets : []).entries()) {
    const assetPath = `ui.assets.${assetIndex}`;
    if (!isPlainRecord(asset)) {
      issues.push(issue("ui_asset", `UI 素材条目格式错误（assets）：${assetPath} 必须是对象。原因：素材清单结构损坏。影响：布局引用的素材无法被打包或加载。解决方案：请重新导入该 UI 素材。`, "error", assetPath));
      continue;
    }
    if (typeof asset.asset_id !== "string" || !asset.asset_id.trim()) issues.push(issue("ui_asset_id", `UI 素材编号缺失（asset_id）：${assetPath} 没有唯一编号。原因：素材清单不完整。影响：布局无法引用该素材。解决方案：请重新导入素材或重新保存布局。`, "error", `${assetPath}.asset_id`));
    if (typeof asset.path !== "string" || !validateAssetPath(asset.path)) issues.push(issue("ui_asset_path", `UI 素材路径无效（path）：${String(asset.path)} 必须位于 ui/assets/ 或 assets/。原因：布局引用了卡带外路径或不安全路径。影响：GameCLI 会拒绝加载该素材。解决方案：请把素材导入 AgentVN 素材库后重新选择。`, "error", `${assetPath}.path`));
  }

  const screens = Array.isArray(layout.screens) ? layout.screens : [];
  for (const [screenIndex, screen] of screens.entries()) {
    const screenPath = `ui.screens.${screenIndex}`;
    if (!isPlainRecord(screen)) {
      issues.push(issue("ui_screen", `界面页面格式错误（screens）：${screenPath} 必须是对象。原因：布局页面结构损坏。影响：GameCLI 无法读取该页面控件。解决方案：请恢复默认布局或重新保存。`, "error", screenPath));
      continue;
    }
    const screenId = screen.screen_id as UILayoutScreenId;
    if (!allowedScreens.includes(screenId)) issues.push(issue("ui_screen_id", `界面页面类型不支持（screen_id）：${String(screen.screen_id)}。原因：GameCLI 不认识该页面类型。影响：该页面不会被正确加载。解决方案：请使用布局设计器提供的页面类型，例如 title、player、save_load。`, "error", `${screenPath}.screen_id`));
    if (!Array.isArray(screen.components)) {
      issues.push(issue("ui_components", `页面控件列表格式错误（components）：${screenPath}.components 必须是数组。原因：该页面控件结构损坏。影响：GameCLI 无法读取页面控件。解决方案：请重新保存布局或恢复该页面默认布局。`, "error", `${screenPath}.components`));
      continue;
    }
    const componentTypes = new Set<UILayoutComponentType>();
    for (const [componentIndex, component] of screen.components.entries()) {
      const componentPath = `${screenPath}.components.${componentIndex}`;
      if (!isPlainRecord(component)) {
        issues.push(issue("ui_component", `界面控件格式错误（component）：${componentPath} 必须是对象。原因：控件结构损坏。影响：GameCLI 无法渲染该控件。解决方案：请在布局设计器中删除并重新添加该控件。`, "error", componentPath));
        continue;
      }
      if (typeof component.component_id !== "string" || !component.component_id.trim()) {
        issues.push(issue("ui_component_id", `界面控件编号缺失（component_id）：${componentPath} 没有唯一编号。原因：控件清单不完整。影响：布局保存和玩家端渲染无法稳定定位该控件。解决方案：请在布局设计器中重新保存，或删除后重新添加控件。`, "error", `${componentPath}.component_id`));
      }
      const componentType = component.component_type as UILayoutComponentType;
      if (!allowedComponentTypes.includes(componentType)) issues.push(issue("ui_component_type", `界面控件类型不支持（component_type）：${String(component.component_type)}。原因：GameCLI 不认识该控件类型。影响：该控件无法渲染。解决方案：请使用布局设计器提供的控件类型，或删除这个未知控件。`, "error", `${componentPath}.component_type`));
      else componentTypes.add(componentType);
      if (component.rect !== undefined) validateRect(component.rect, `${componentPath}.rect`, issues);
      if (component.mobileRect !== undefined) {
        issues.push(issue(
          "ui_layout_legacy_mobile_rect",
          "布局仍包含已废弃的 mobileRect 字段；移动端现在等比复用 PC authored rect。请重新导入并保存布局完成迁移。",
          "error",
          `${componentPath}.mobileRect`,
        ));
      }
      if (component.style !== undefined) validateStyle(component.style, `${componentPath}.style`, issues,
        supportsUILayoutOpacityLayers(componentType));
      if (component.stateStyles !== undefined) {
        if (!isPlainRecord(component.stateStyles))
          issues.push(issue("ui_control_states", "控件状态样式必须为对象。", "error", `${componentPath}.stateStyles`));
        else for (const [state, style] of Object.entries(component.stateStyles)) {
          if (!["normal", "hover", "selected", "disabled"].includes(state))
            issues.push(issue("ui_control_state", "不支持的控件状态。", "error", `${componentPath}.stateStyles.${state}`));
          else validateStyle(style, `${componentPath}.stateStyles.${state}`, issues, supportsUILayoutOpacityLayers(componentType));
        }
      }
      if (component.action !== undefined) validateAction(component.action, `${componentPath}.action`, issues);
      if (component.presentation !== undefined) {
        for (const message of compileControlPresentation(component.presentation).issues)
          issues.push(issue("ui_control_presentation", message, "error", `${componentPath}.presentation`));
      }
      if (componentType === "custom_component") {
        const customIssues = validateCustomComponentDefinition(component.customComponent);
        for (const message of customIssues) {
          issues.push(issue("ui_custom_component", message, "error", `${componentPath}.customComponent`));
        }
      } else if (component.customComponent !== undefined) {
        issues.push(issue("ui_custom_component_unexpected", "只有自定义组件控件可以包含结构化组件内容。", "error", `${componentPath}.customComponent`));
      }
      if (component.zIndex !== undefined && (typeof component.zIndex !== "number" || component.zIndex < 0 || component.zIndex > 1000)) {
        issues.push(issue("ui_zindex", `界面层级超出范围（zIndex）：${componentPath}.zIndex 必须在 0 到 1000 之间。原因：控件层级值异常。影响：控件可能遮挡错误或无法点击。解决方案：请在布局设计器中调整层级。`, "error", `${componentPath}.zIndex`));
      }
    }
    for (const required of requiredByScreen[screenId] ?? []) {
      if (!componentTypes.has(required)) issues.push(issue("ui_required_component", `必要界面控件缺失（${required}）：页面 ${screenId} 必须包含该控件。原因：核心控件被删除。影响：玩家可能无法开始游戏、阅读对白、选择分支或打开设置。解决方案：请在布局设计器中恢复默认布局，或重新添加 ${required} 控件。`, "error", `${screenPath}.components`));
    }
  }

  return splitIssues(issues);
}

function getScreen(layout: UISkinLayout, screenId: UILayoutScreenId): UILayoutScreen | undefined {
  return layout.screens.find((screen) => screen.screen_id === screenId);
}

function getComponent(layout: UISkinLayout, screenId: UILayoutScreenId, componentType: UILayoutComponentType): UILayoutComponent | undefined {
  return getScreen(layout, screenId)?.components.find((component) => component.component_type === componentType);
}

function getEffectiveRect(component: UILayoutComponent | undefined, breakpoint: UILayoutBreakpoint): UILayoutRect | undefined {
  if (!component) return undefined;
  return breakpoint === "mobile" ? component.mobileRect ?? component.rect : component.rect;
}

const styleTemplateComponentTypes = new Set<UILayoutComponentType>([
  "choice_option",
  "quick_button",
]);

function componentRequiresLayoutRect(component: UILayoutComponent): boolean {
  return !styleTemplateComponentTypes.has(component.component_type);
}

function rectIsOffCanvas(rect?: UILayoutRect): boolean {
  if (!rect) return true;
  return rect.x + rect.width <= 0 || rect.y + rect.height <= 0 || rect.x >= 100 || rect.y >= 100;
}

function rectOverlapRatio(a?: UILayoutRect, b?: UILayoutRect): number {
  if (!a || !b) return 0;
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  const overlap = (right - left) * (bottom - top);
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 ? overlap / smaller : 0;
}

function luminance(color?: string): number | undefined {
  if (!color || !color.startsWith("#")) return undefined;
  const hex = color.slice(1);
  const full = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return undefined;
  const value = Number.parseInt(full, 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground?: string, background?: string): number | undefined {
  const fg = luminance(foreground);
  const bg = luminance(background);
  if (fg === undefined || bg === undefined) return undefined;
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

export function validateUISkinHealth(layout: UISkinLayout, options: UISkinHealthOptions = {}): CartridgeValidationResult {
  const issues: ValidationIssue[] = [];
  const assetPaths = new Set([...(options.availableAssetPaths ?? []), ...layout.assets.map((asset) => asset.path)]);
  const assetIds = new Set([...(options.availableAssetIds ?? []), ...layout.assets.map((asset) => asset.asset_id)]);
  for (const screen of layout.screens) {
    for (const component of screen.components) {
      if (component.component_type !== "custom_component" || !component.customComponent) continue;
      const visit = (node: CustomComponentDefinition["root"]) => {
        if (node.assetId && !assetIds.has(node.assetId)) {
          issues.push(issue(
            "ui_missing_custom_component_asset",
            `自定义组件“${component.label ?? component.component_id}”引用的图片素材不存在：${node.assetId}。请从个人组件库重新添加组件依赖，或恢复对应工程素材。`,
            "error",
            `ui.screens.${screen.screen_id}.${component.component_id}.customComponent`,
          ));
        }
        node.children.forEach(visit);
      };
      visit(component.customComponent.root);
    }
  }
  for (const [scope, pageStyle] of Object.entries(layout.renpy ?? {})) {
    for (const [state, reference] of Object.entries(pageStyle?.buttonImages ?? {})) {
      const assetId = assetIdFromUILayoutReference(reference);
      const missing = assetId
        ? !assetIds.has(assetId)
        : !assetPaths.has(reference);
      if (missing) {
        issues.push(issue(
          "ui_missing_renpy_button_state_asset",
          `Ren’Py 按钮${state}状态图片不存在：${reference} 未出现在工程素材清单中，运行时会回退到默认按钮材质。`,
          "warning",
          `ui.renpy.${scope}.buttonImages.${state}`,
        ));
      }
    }
  }
  const tokenContrastPairs: Array<[string, string | undefined, string | undefined]> = [
    ["panel", layout.tokens.colorPanelText ?? layout.tokens.colorInk, layout.tokens.colorPanel ?? layout.tokens.colorSurface],
    ["control", layout.tokens.colorControlText ?? layout.tokens.colorInk, layout.tokens.colorControl ?? layout.tokens.colorSurfaceStrong],
    ["dialog", layout.tokens.colorDialogText ?? layout.tokens.colorInk, layout.tokens.colorDialog ?? layout.tokens.colorSurface],
    ["speaker", layout.tokens.colorSpeakerText ?? layout.tokens.colorInk, layout.tokens.colorSpeakerPlate ?? layout.tokens.colorSurfaceStrong],
    ["choice", layout.tokens.colorChoiceText ?? "#ffffff", layout.tokens.colorChoice ?? layout.tokens.colorAccent],
  ];
  for (const [name, foreground, background] of tokenContrastPairs) {
    const contrast = contrastRatio(foreground, background);
    if (contrast !== undefined && contrast < 3) {
      issues.push(issue("ui_theme_low_contrast", `主题配色对比偏低（${name}）：文字色和背景色太接近。原因：当前主题 token 可读性不足。影响：GameCLI 中对应控件可能难以阅读。解决方案：请在客户端主题中提高文字与背景的明暗差。`, "warning", `ui.tokens.${name}`));
    }
  }

  for (const screen of layout.screens) {
    for (const component of screen.components) {
      const label = component.label || component.component_id;
      if (component.required && component.visible === false) {
        issues.push(issue("ui_required_hidden", `必要界面控件被隐藏（visible）：${label} 是玩家流程必需控件。原因：布局把它设置为不可见。影响：玩家可能无法开始游戏、阅读对白、选择分支或打开设置。解决方案：请在布局设计器中把该控件设为可见，或恢复默认布局。`, "error", `ui.${screen.screen_id}.${component.component_id}`));
      }
      for (const breakpoint of ["desktop", "mobile"] as const) {
        const rect = getEffectiveRect(component, breakpoint);
        if (!rect) {
          if (component.component_type === "mask" && breakpoint === "desktop") {
            issues.push(issue("ui_mask_missing_rect", `遮罩缺少有效桌面布局矩形：${label}。`, "error", `ui.${screen.screen_id}.${component.component_id}.rect`));
          } else if (component.required && componentRequiresLayoutRect(component)) {
            issues.push(issue("ui_component_missing_rect", `Required UI component is missing a layout rect: ${label} (${breakpoint}).`, "error", `ui.${screen.screen_id}.${component.component_id}`));
          }
          continue;
        }
        if (rectIsOffCanvas(rect)) {
          const severity = component.required ? "error" : "warning";
          issues.push(issue("ui_component_offscreen", `界面控件超出画布（${breakpoint}）：${label} 不在可见区域内。原因：控件位置或尺寸设置不合理。影响：玩家可能看不到或点不到该控件。解决方案：请在布局设计器中切换到对应断点，把控件移回画布。`, severity, `ui.${screen.screen_id}.${component.component_id}`));
        }
        if (breakpoint === "mobile" && rect && component.required) {
          const outsideSafeArea = rect.x < 2 || rect.y < 2 || rect.x + rect.width > 98 || rect.y + rect.height > 98;
          if (outsideSafeArea) {
            issues.push(issue("ui_mobile_safe_area", `移动端安全区过窄（mobileRect）：${label} 太靠近屏幕边缘。原因：移动端控件位置没有避开边缘区域。影响：手机上可能被系统手势区或圆角遮挡。解决方案：请在布局设计器移动端预设中把控件向内移动。`, "warning", `ui.${screen.screen_id}.${component.component_id}`));
          }
        }
      }
      const backgroundImage = component.style?.backgroundImage;
      if (component.component_type === "mask" && component.style?.maskMode === "image" && !backgroundImage) {
        issues.push(issue("ui_mask_image_missing", `图片遮罩未设置背景图：${label} 将回退为半透明纯色。`, "warning", `ui.${screen.screen_id}.${component.component_id}.style.backgroundImage`));
      }
      const backgroundAssetId = assetIdFromUILayoutReference(backgroundImage);
      const backgroundAssetMissing = backgroundImage
        ? backgroundAssetId
          ? !assetIds.has(backgroundAssetId)
          : !assetPaths.has(backgroundImage)
        : false;
      if (backgroundImage && backgroundAssetMissing) {
        issues.push(issue("ui_missing_background_asset", `UI 背景图素材不存在（backgroundImage）：${backgroundImage} 没有出现在素材清单中。原因：布局引用了未打包的图片。影响：玩家端该控件背景可能显示为空。解决方案：请把图片导入 UI 素材库，或在布局设计器中重新选择已存在素材。`, "warning", `ui.${screen.screen_id}.${component.component_id}.style.backgroundImage`));
      }
      const contrast = contrastRatio(component.style?.color ?? layout.tokens.colorInk, component.style?.backgroundColor ?? layout.tokens.colorSurface);
      if (contrast !== undefined && contrast < 3) {
        issues.push(issue("ui_low_contrast", `文字对比度偏低（color/backgroundColor）：${label} 的文字和背景颜色太接近。原因：当前配色可读性不足。影响：玩家可能难以阅读按钮或对白文字。解决方案：请在布局设计器中提高文字颜色和背景颜色的明暗差。`, "warning", `ui.${screen.screen_id}.${component.component_id}.style`));
      }
    }
  }

  for (const screen of layout.screens) {
    const masks = screen.components.filter((component) => component.component_type === "mask" && component.visible !== false);
    const interactive = screen.components.filter((component) => component.component_type !== "mask" && component.visible !== false && component.component_type !== "stage_background");
    for (const mask of masks) {
      const maskLayer = mask.zIndex ?? 0;
      const minimumInteractiveLayer = interactive.reduce((minimum, component) => Math.min(minimum, component.zIndex ?? 20), Infinity);
      if (minimumInteractiveLayer !== Infinity && maskLayer >= minimumInteractiveLayer) {
        issues.push(issue(
          "ui_mask_zindex",
          `遮罩层级已高于或等于交互控件：${mask.label || mask.component_id} 将在运行时自动下调。`,
          "warning",
          `ui.${screen.screen_id}.${mask.component_id}.zIndex`,
        ));
      }
    }
  }

  const titleCustomButtons = getScreen(layout, "title")?.components.filter(
    (component) => component.component_type === "main_menu_custom_button" && component.visible !== false,
  ) ?? [];
  const visibleFixedTitleActions = getScreen(layout, "title")?.components.filter(
    (component) => titleActionComponentTypes.includes(component.component_type) && component.visible !== false,
  ) ?? [];
  for (const breakpoint of ["desktop", "mobile"] as const) {
    for (let leftIndex = 0; leftIndex < titleCustomButtons.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < titleCustomButtons.length; rightIndex += 1) {
        const left = titleCustomButtons[leftIndex];
        const right = titleCustomButtons[rightIndex];
        const overlap = rectOverlapRatio(
          getEffectiveRect(left, breakpoint),
          getEffectiveRect(right, breakpoint),
        );
        if (overlap < 0.35) continue;
        const leftLabel = left.label || left.component_id;
        const rightLabel = right.label || right.component_id;
        issues.push(issue(
          "ui_custom_button_overlap",
          `标题自定义按钮明显重叠（${breakpoint}）：${leftLabel} 与 ${rightLabel} 的可点击区域互相覆盖。原因：按钮数量、位置或尺寸超出当前标题布局容量。影响：玩家可能难以点击或辨认被遮挡的按钮。解决方案：请在布局设计器中切换到对应断点，移动按钮、缩小尺寸或调整容器排布。`,
          "warning",
          `ui.title.${left.component_id}/ui.title.${right.component_id}`,
        ));
      }
    }
    for (const customButton of titleCustomButtons) {
      for (const fixedAction of visibleFixedTitleActions) {
        const overlap = rectOverlapRatio(
          getEffectiveRect(customButton, breakpoint),
          getEffectiveRect(fixedAction, breakpoint),
        );
        if (overlap < 0.35) continue;
        const customLabel = customButton.label || customButton.component_id;
        const fixedLabel = fixedAction.label || fixedAction.component_id;
        issues.push(issue(
          "ui_custom_button_overlap",
          `标题自定义按钮遮挡内置操作（${breakpoint}）：${customLabel} 与 ${fixedLabel} 的可点击区域明显重叠。原因：自定义按钮容器或按钮位置进入了内置标题操作区域。影响：玩家可能无法辨认或点击其中一个按钮。解决方案：请在布局设计器中切换到对应断点，移动自定义按钮容器或单独调整按钮位置。`,
          "warning",
          `ui.title.${customButton.component_id}/ui.title.${fixedAction.component_id}`,
        ));
      }
    }
  }

  const dialog = getComponent(layout, "player", "dialog_panel");
  const dialogText = getComponent(layout, "player", "dialog_text");
  const speakerLabel = getComponent(layout, "player", "speaker_label");
  const continueIndicator = getComponent(layout, "player", "continue_indicator");
  const choices = getComponent(layout, "player", "choice_list");
  const quickMenu = getComponent(layout, "player", "quick_menu");
  for (const breakpoint of ["desktop", "mobile"] as const) {
    const dialogRect = getEffectiveRect(dialog, breakpoint);
    const dialogTextRect = getEffectiveRect(dialogText, breakpoint);
    const speakerRect = getEffectiveRect(speakerLabel, breakpoint);
    const continueRect = getEffectiveRect(continueIndicator, breakpoint);
    const choiceRect = getEffectiveRect(choices, breakpoint);
    const quickRect = getEffectiveRect(quickMenu, breakpoint);
    if (dialogRect && dialogRect.height < (breakpoint === "mobile" ? 22 : 18)) {
      issues.push(issue("ui_dialog_too_short", `对白框高度偏小（dialog_panel）：${breakpoint} 下对白框高度不足。原因：布局压缩了对白区域。影响：长对白可能显示拥挤或被截断。解决方案：请在布局设计器中增大对白框高度。`, "warning", "ui.player.dialog_panel"));
    }
    if (dialogTextRect && dialogTextRect.height < (breakpoint === "mobile" ? 16 : 14)) {
      issues.push(issue("ui_dialog_text_too_short", `\u5bf9\u8bdd\u6b63\u6587\u533a\u57df\u9ad8\u5ea6\u504f\u5c0f\uff08dialog_text\uff09\uff1a${breakpoint} \u4e0b\u957f\u5bf9\u767d\u53ef\u80fd\u9700\u8981\u5206\u9875\u6216\u88ab\u88c1\u5207\u3002\u8fd0\u884c\u7aef\u4f1a\u4e25\u683c\u6309\u7f16\u8f91\u5668\u5bfc\u51fa\u7ed3\u679c\u6e32\u67d3\uff0c\u8bf7\u56de\u7f16\u8f91\u5668\u589e\u5927\u6b63\u6587\u533a\u57df\u6216\u6062\u590d\u9ed8\u8ba4\u5e03\u5c40\u3002`, "warning", "ui.player.dialog_text"));
    }
    if (typeof dialogText?.style?.fontSize === "number" && dialogText.style.fontSize > (breakpoint === "mobile" ? 28 : 30)) {
      issues.push(issue("ui_dialog_text_font_too_large", `\u5bf9\u8bdd\u6b63\u6587\u533a\u57df\u5b57\u53f7\u504f\u5927\uff08dialog_text\uff09\uff1a${breakpoint} \u4e0b fontSize=${dialogText.style.fontSize} \u53ef\u80fd\u6324\u5360\u6b63\u6587\u7a7a\u95f4\u3002\u8fd0\u884c\u7aef\u5c06\u4e25\u683c\u6309\u5e03\u5c40\u663e\u793a\uff1b\u8bf7\u5728\u5e03\u5c40\u8bbe\u8ba1\u5668\u4e2d\u964d\u4f4e\u5b57\u53f7\u3002`, "warning", "ui.player.dialog_text.style.fontSize"));
    }
    if (typeof dialogText?.style?.padding === "number" && dialogText.style.padding > 12) {
      issues.push(issue("ui_dialog_text_padding_too_large", `\u5bf9\u8bdd\u6b63\u6587\u533a\u57df\u5185\u8fb9\u8ddd\u504f\u5927\uff08dialog_text\uff09\uff1apadding=${dialogText.style.padding} \u4f1a\u538b\u7f29\u53ef\u8bfb\u6587\u5b57\u533a\u57df\u3002\u8fd0\u884c\u7aef\u4f1a\u4e25\u683c\u6309\u7f16\u8f91\u5668\u5bfc\u51fa\u7ed3\u679c\u6e32\u67d3\uff0c\u8bf7\u51cf\u5c0f\u6b63\u6587 padding\u3002`, "warning", "ui.player.dialog_text.style.padding"));
    }
    if (typeof dialog?.style?.padding === "number" && dialog.style.padding > 24) {
      issues.push(issue("ui_dialog_panel_padding_too_large", `\u5bf9\u767d\u6846\u5185\u8fb9\u8ddd\u504f\u5927\uff08dialog_panel\uff09\uff1apadding=${dialog.style.padding} \u4f1a\u5728\u9884\u89c8\u7a97\u53e3\u4e2d\u538b\u7f29\u6b63\u6587\u3002\u8fd0\u884c\u7aef\u5c06\u4e25\u683c\u6309\u5e03\u5c40\u663e\u793a\uff1b\u8bf7\u51cf\u5c0f\u5bf9\u767d\u6846 padding \u6216\u589e\u5927\u5bf9\u767d\u6846\u9ad8\u5ea6\u3002`, "warning", "ui.player.dialog_panel.style.padding"));
    }
    if (dialogTextRect && dialogRect && rectOverlapRatio(dialogTextRect, dialogRect) < 0.35) {
      issues.push(issue("ui_dialog_text_outside_panel", `\u5bf9\u8bdd\u6b63\u6587\u533a\u57df\u672a\u4e0e\u5bf9\u8bdd\u6846\u5145\u5206\u91cd\u53e0\uff08dialog_text\uff09\uff1a${breakpoint} \u4e0b\u6587\u5b57\u53ef\u80fd\u504f\u79bb\u5bf9\u767d\u6846\u3002\u8fd0\u884c\u7aef\u4f1a\u4e25\u683c\u6309\u7f16\u8f91\u5668\u5bfc\u51fa\u7ed3\u679c\u6e32\u67d3\uff0c\u8bf7\u56de\u7f16\u8f91\u5668\u8c03\u6574\u6b63\u6587\u533a\u57df\u4f4d\u7f6e\u3002`, "warning", "ui.player.dialog_text"));
    }
    if (speakerRect && dialogRect && rectOverlapRatio(speakerRect, dialogRect) < 0.12) {
      issues.push(issue("ui_speaker_label_outside_panel", `姓名容器与对话框距离过远（speaker_label）：${breakpoint} 下可能不可见或遮挡其他控件。请回编辑器调整姓名容器位置。`, "warning", "ui.player.speaker_label"));
    }
    if (speakerRect && dialogTextRect && rectOverlapRatio(speakerRect, dialogTextRect) > 0.02) {
      issues.push(issue("ui_dialog_speaker_overlap", `姓名容器与正文区域重叠（speaker_label / dialog_text）：${breakpoint} 下这两个区域在编辑器里已经互相压住了。运行端会严格按编辑器导出结果渲染，所以请回编辑器把它们分开。`, "warning", "ui.player.speaker_label/ui.player.dialog_text"));
    }
    if (continueRect && continueRect.height < 4) {
      issues.push(issue("ui_continue_indicator_too_short", `继续提示区域高度偏小（continue_indicator）：${breakpoint} 下提示文字可能被裁切。`, "warning", "ui.player.continue_indicator"));
    }
    if (rectOverlapRatio(dialogRect, choiceRect) > 0.45) {
      issues.push(issue("ui_dialog_choice_overlap", `选项列表与对白框重叠（choice_list）：${breakpoint} 下选项区域覆盖了对白框。原因：两个控件位置太近或尺寸过大。影响：玩家阅读对白或选择分支时会被遮挡。解决方案：请在布局设计器中移动选项列表，或缩小其中一个控件。`, "warning", "ui.player.choice_list"));
    }
    if (breakpoint === "mobile" && quickRect && (quickRect.height < 8 || quickRect.width < 42)) {
      issues.push(issue("ui_touch_target", "快捷菜单触控区域偏小（quick_menu）：移动端快捷菜单宽高不足。原因：控件尺寸太小。影响：玩家在手机上可能难以点到菜单。解决方案：请在布局设计器移动端预设中增大快捷菜单尺寸。", "warning", "ui.player.quick_menu"));
    }
  }

  return splitIssues(issues);
}

export function getDefaultUISkinLayout(): UISkinLayout {
  return finalizeUnifiedLayout({
    ui_layout_version: UI_LAYOUT_VERSION,
    name: "AgentVN Default Runtime Skin",
    target_runtime: "0.1.0",
    tokens: {
      colorBackground: "#060812",
      colorSurface: "#0d121f",
      colorSurfaceStrong: "#192234",
      colorInk: "#f6f8ff",
      colorMuted: "#aeb9cc",
      colorAccent: "#82b6ff",
      colorAccent2: "#f2a0c4",
      colorLine: "#d8e2ff",
      colorPanel: "#0d121f",
      colorPanelText: "#f6f8ff",
      colorControl: "#192234",
      colorControlHover: "#24324d",
      colorControlActive: "#82b6ff",
      colorControlText: "#f6f8ff",
      colorSliderTrack: "#214a55",
      colorSliderActive: "#6edee4",
      colorSliderThumb: "#eaffff",
      colorDialog: "#060a14",
      colorDialogText: "#f6f8ff",
      colorSpeakerPlate: "#202735",
      colorSpeakerText: "#c4ccd6",
      colorChoice: "#82b6ff",
      colorChoiceText: "#07111f",
      colorQuickMenu: "#0d121f",
      colorFocus: "#82b6ff",
      colorDanger: "#ff7d8a",
      colorWarning: "#f3b45f",
      colorSuccess: "#75d58c",
      radius: 10,
      motionScale: 1,
      fontScale: 1,
    },
    assets: [],
    screens: [
      {
        screen_id: "title",
        label: "Title",
        components: [
          { component_id: "title_hero", component_type: "main_menu_hero", required: true, rect: { x: 6, y: 26, width: 58, height: 42 }, mobileRect: { x: 7, y: 12, width: 86, height: 34 } },
          createDefaultCustomButtonContainer(),
          createDefaultTitleActionMask(),
          { component_id: "title_continue_button", component_type: "main_menu_continue_button", label: "继续游戏", required: true, rect: { x: 78, y: 28, width: 18, height: 7 }, mobileRect: { x: 72, y: 28, width: 25, height: 7 }, style: { ...DEFAULT_TITLE_TEXT_BUTTON_STYLE }, zIndex: 20 },
          { component_id: "title_start_button", component_type: "main_menu_start_button", label: "开始游戏", required: true, rect: { x: 78, y: 36, width: 18, height: 7 }, mobileRect: { x: 72, y: 36, width: 25, height: 7 }, style: { ...DEFAULT_TITLE_TEXT_BUTTON_STYLE }, zIndex: 21 },
          { component_id: "title_save_load_button", component_type: "main_menu_save_load_button", label: "存档", required: true, rect: { x: 78, y: 44, width: 18, height: 7 }, mobileRect: { x: 72, y: 44, width: 25, height: 7 }, style: { ...DEFAULT_TITLE_TEXT_BUTTON_STYLE }, zIndex: 22 },
          { component_id: "title_gallery_button", component_type: "main_menu_gallery_button", label: "画廊", required: true, rect: { x: 78, y: 52, width: 18, height: 7 }, mobileRect: { x: 72, y: 52, width: 25, height: 7 }, style: { ...DEFAULT_TITLE_TEXT_BUTTON_STYLE }, zIndex: 23 },
          { component_id: "title_settings_button", component_type: "main_menu_settings_button", label: "设置", required: true, rect: { x: 78, y: 60, width: 18, height: 7 }, mobileRect: { x: 72, y: 60, width: 25, height: 7 }, style: { ...DEFAULT_TITLE_TEXT_BUTTON_STYLE }, zIndex: 24 },
          { component_id: "title_about_button", component_type: "main_menu_about_button", label: "关于", required: true, rect: { x: 78, y: 68, width: 18, height: 7 }, mobileRect: { x: 72, y: 68, width: 25, height: 7 }, style: { ...DEFAULT_TITLE_TEXT_BUTTON_STYLE }, zIndex: 25 },
        ],
      },
      {
        screen_id: "player",
        label: "播放页",
        components: [
          {
            component_id: "stage_background",
            component_type: "stage_background",
            label: "舞台背景",
            locked: true,
            rect: { x: 0, y: 0, width: 100, height: 100 },
            mobileRect: { x: 0, y: 0, width: 100, height: 100 },
            style: { backgroundColor: "#060812", shadow: "none" },
            zIndex: 0,
          },
          {
            component_id: "dialog_panel",
            component_type: "dialog_panel",
            label: "对话框",
            required: true,
            rect: { x: 6, y: 76, width: 88, height: 18 },
            mobileRect: { x: 4, y: 68, width: 92, height: 24 },
            style: { backgroundColor: "#060a14", borderRadius: 16, padding: 10, backdropBlur: 16, shadow: "strong" },
            zIndex: 30,
          },
          {
            component_id: "speaker_label",
            component_type: "speaker_label",
            label: "姓名容器",
            rect: { ...SAFE_DIALOG_PLAYER_RECTS.speaker_label.rect },
            mobileRect: { ...SAFE_DIALOG_PLAYER_RECTS.speaker_label.mobileRect },
            style: { backgroundColor: "#202735", color: "#c4ccd6", borderColor: "#465164", borderWidth: 1, borderRadius: 6, padding: 7, fontSize: 18, fontWeight: 760, shadow: "soft" },
            zIndex: 34,
          },
          {
            component_id: "dialog_text",
            component_type: "dialog_text",
            label: "对白正文",
            rect: { x: 8, y: 80, width: 84, height: 9.5 },
            mobileRect: { x: 7, y: 74, width: 86, height: 12 },
            style: { color: "#f6f8ff", fontSize: 24, fontWeight: 500, textAlign: "left" },
            zIndex: 35,
          },
          {
            component_id: "continue_indicator",
            component_type: "continue_indicator",
            label: "继续提示",
            rect: { x: 85, y: 90.5, width: 8, height: 3 },
            mobileRect: { x: 82, y: 88.5, width: 11, height: 4 },
            style: { color: "#f6f8ff", fontSize: 12, textAlign: "right", opacity: 0.84 },
            zIndex: 36,
          },
          {
            component_id: "choice_option",
            component_type: "choice_option",
            label: "选项按钮",
            required: true,
            style: {
              backgroundColor: "#82b6ff",
              color: "#07111f",
              borderColor: "#d8e2ff",
              borderWidth: 1,
              borderRadius: 10,
              opacity: 1,
              padding: 12,
              fontSize: 20,
              fontWeight: 700,
              textAlign: "center",
              shadow: "soft",
            },
            zIndex: 41,
          },
          { component_id: "choice_list", component_type: "choice_list", label: "选项列表", required: true, rect: { x: 50, y: 44, width: 34, height: 32, anchor: "center" }, mobileRect: { x: 50, y: 40, width: 58, height: 34, anchor: "center" }, zIndex: 40 },
          { component_id: "quick_menu", component_type: "quick_menu", label: "快捷菜单", required: true, rect: { ...currentDefaultQuickMenuRect }, mobileRect: { ...currentDefaultQuickMenuMobileRect }, style: { ...QUICK_MENU_DEFAULT_SURFACE_STYLE }, zIndex: 50 },
          ...createDefaultQuickMenuButtons(),
        ],
      },
      { screen_id: "game_menu", components: [{ component_id: "game_menu_nav", component_type: "game_menu_nav", required: true, rect: { x: 5, y: 12, width: 90, height: 12 } }] },
      { screen_id: "save_load", components: [{ component_id: "save_grid", component_type: "save_slot_grid", required: true, rect: { x: 4, y: 20, width: 92, height: 74 }, style: { columns: 3, gap: 14 } }] },
      { screen_id: "preferences", components: [{ component_id: "settings_group", component_type: "settings_group", required: true, rect: { x: 5, y: 18, width: 62, height: 70 }, mobileRect: { x: 5, y: 16, width: 90, height: 76 } }] },
      { screen_id: "history", components: [{ component_id: "history_list", component_type: "history_list", required: true, rect: { x: 5, y: 18, width: 90, height: 72 } }] },
      { screen_id: "gallery", components: [{ component_id: "gallery_grid", component_type: "gallery_grid", required: true, rect: { x: 5, y: 18, width: 90, height: 72 }, style: { columns: 4, gap: 14 } }] },
      { screen_id: "about", components: [{ component_id: "about_panel", component_type: "about_panel", required: true, rect: { x: 5, y: 18, width: 58, height: 48 }, mobileRect: { x: 5, y: 18, width: 90, height: 58 } }] },
    ],
  });
}
