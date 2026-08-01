import type { BackgroundFit, CartridgeValidationResult, ValidationIssue } from "./types";
import { validateExternalUrl } from "./externalAction";
import { assetIdFromUILayoutReference, isUILayoutAssetReference } from "./uiAssetReference";

export const UI_LAYOUT_VERSION = "1.0.0";
export const DEFAULT_UI_LAYOUT_PATH = "ui/layout.json";

export type UILayoutScreenId =
  | "title"
  | "player"
  | "game_menu"
  | "save_load"
  | "preferences"
  | "history"
  | "gallery"
  | "about";

export type UILayoutComponentType =
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
  | "main_menu_custom_button_container"
  | "main_menu_custom_button"
  | "game_menu_nav"
  | "menu_button"
  | "save_slot_grid"
  | "settings_group"
  | "history_list"
  | "gallery_grid"
  | "about_panel"
  | "import_panel";

export type UILayoutBreakpoint = "desktop" | "mobile";
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
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundFit?: BackgroundFit;
  color?: string;
  accentColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  opacity?: number;
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
  mobileRect?: UILayoutRect;
  style?: UILayoutComponentStyle;
  motion?: UILayoutMotion;
  action?: UILayoutAction;
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
    rect: { x: 5.7, y: 72.2, width: 10.8, height: 4.8 },
    mobileRect: { x: 5.8, y: 65.8, width: 15.4, height: 6.6 },
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

const allowedScreens: UILayoutScreenId[] = ["title", "player", "game_menu", "save_load", "preferences", "history", "gallery", "about"];
const allowedComponentTypes: UILayoutComponentType[] = [
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
  "main_menu_custom_button_container",
  "main_menu_custom_button",
  "game_menu_nav",
  "menu_button",
  "save_slot_grid",
  "settings_group",
  "history_list",
  "gallery_grid",
  "about_panel",
  "import_panel",
];
const requiredByScreen: Partial<Record<UILayoutScreenId, UILayoutComponentType[]>> = {
  title: [
    "main_menu_continue_button",
    "main_menu_start_button",
    "main_menu_save_load_button",
    "main_menu_library_button",
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
};

const legacyMainMenuActionsType = "main_menu_actions";
const titleActionComponentTypes = requiredByScreen.title ?? [];

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
  const titleScreen = layout.screens?.find((screen) => screen.screen_id === "title");
  const legacyIndex = titleScreen?.components.findIndex(
    (component) => String(component.component_type) === legacyMainMenuActionsType,
  ) ?? -1;
  if (!titleScreen || legacyIndex < 0) return layout;

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

  return {
    ...layout,
    screens: layout.screens.map((screen) => screen.screen_id !== "title" ? screen : {
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
  return typeof value === "string" && (/^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\([\d\s.,%]+\)$/.test(value));
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

function validateStyle(style: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isPlainRecord(style)) {
    issues.push(issue("ui_style", `界面样式格式错误（style）：${path} 必须是对象。原因：布局文件中的样式结构不正确。影响：GameCLI 无法读取颜色、透明度、字体等设置。解决方案：请回到布局设计器重新保存，或把 style 修正为对象。`, "error", path));
    return;
  }
  const allowed = new Set([
    "backgroundColor",
    "backgroundImage",
    "backgroundFit",
    "color",
    "accentColor",
    "borderColor",
    "borderWidth",
    "borderRadius",
    "opacity",
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
  ]);
  for (const [key, value] of Object.entries(style)) {
    if (!allowed.has(key)) {
      issues.push(issue("ui_style_field", `界面样式字段不支持（${key}）：GameCLI 不认识 ${path}.${key}。原因：布局文件包含了未开放的样式字段。影响：该样式不会被安全加载。解决方案：请删除该字段，或在布局设计器里使用支持的样式项。`, "error", `${path}.${key}`));
      continue;
    }
    if (["backgroundColor", "color", "accentColor", "borderColor"].includes(key) && !validateColor(value)) {
      issues.push(issue("ui_color", `颜色值不安全或格式错误（${key}）：${path}.${key} 需要 #RRGGBB、#RGB 或 rgba(...)。原因：颜色字段不是可识别的安全颜色。影响：GameCLI 无法稳定渲染该控件颜色。解决方案：请在布局设计器中重新选择颜色。`, "error", `${path}.${key}`));
    }
    if (key === "backgroundImage" && !validateBackgroundImageReference(value)) {
      issues.push(issue("ui_background_image", `背景图素材路径无效（backgroundImage）：${String(value)} 必须引用卡带内 ui/assets/ 或 assets/ 下的素材。原因：布局引用了未打包或不安全的素材路径。影响：玩家端无法显示该背景图。解决方案：请把图片导入素材库或 UI 素材，再在布局设计器中重新选择。`, "error", `${path}.${key}`));
    }
    if (key === "backgroundFit" && !["stretch", "contain", "cover"].includes(String(value))) {
      issues.push(issue("ui_background_fit", `背景图显示模式不支持（backgroundFit）：${String(value)} 不是有效选项。原因：GameCLI 只支持 stretch、contain 或 cover。影响：玩家端无法确定背景图如何铺放。解决方案：请在布局设计器中重新选择背景显示模式。`, "error", `${path}.${key}`));
    }
    if (["borderWidth", "borderRadius", "opacity", "fontSize", "fontWeight", "padding", "gap", "backdropBlur", "columns"].includes(key)) {
      if (typeof value !== "number" || !Number.isFinite(value)) issues.push(issue("ui_style_number", `界面样式数值无效（${key}）：${path}.${key} 必须是有限数字。原因：样式参数被写成了空值、文本或无限值。影响：GameCLI 无法正确渲染该控件。解决方案：请在布局设计器中重新输入该数值。`, "error", `${path}.${key}`));
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
      if (component.mobileRect !== undefined) validateRect(component.mobileRect, `${componentPath}.mobileRect`, issues);
      if (component.style !== undefined) validateStyle(component.style, `${componentPath}.style`, issues);
      if (component.action !== undefined) validateAction(component.action, `${componentPath}.action`, issues);
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
          if (component.required) {
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
      issues.push(issue("ui_speaker_label_outside_panel", `\u8bf4\u8bdd\u4eba\u540d\u724c\u4e0e\u5bf9\u8bdd\u6846\u8ddd\u79bb\u8fc7\u8fdc\uff08speaker_label\uff09\uff1a${breakpoint} \u4e0b\u53ef\u80fd\u4e0d\u53ef\u89c1\u6216\u906e\u6321\u5176\u4ed6\u63a7\u4ef6\u3002\u8bf7\u56de\u7f16\u8f91\u5668\u8c03\u6574\u8bf4\u8bdd\u4eba\u540d\u724c\u4f4d\u7f6e\u3002`, "warning", "ui.player.speaker_label"));
    }
    if (speakerRect && dialogTextRect && rectOverlapRatio(speakerRect, dialogTextRect) > 0.02) {
      issues.push(issue("ui_dialog_speaker_overlap", `\u5bf9\u8bdd\u4eba\u540d\u724c\u4e0e\u6b63\u6587\u533a\u57df\u91cd\u53e0\uff08speaker_label / dialog_text\uff09\uff1a${breakpoint} \u4e0b\u8fd9\u4e24\u4e2a\u533a\u57df\u5728\u7f16\u8f91\u5668\u91cc\u5df2\u7ecf\u4e92\u76f8\u538b\u4f4f\u4e86\u3002\u8fd0\u884c\u7aef\u4f1a\u4e25\u683c\u6309\u7f16\u8f91\u5668\u5bfc\u51fa\u7ed3\u679c\u6e32\u67d3\uff0c\u6240\u4ee5\u8bf7\u56de\u7f16\u8f91\u5668\u628a\u5b83\u4eec\u5206\u5f00\u3002`, "warning", "ui.player.speaker_label/ui.player.dialog_text"));
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
  return {
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
      colorSpeakerPlate: "#192234",
      colorSpeakerText: "#cde1ff",
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
          { component_id: "title_continue_button", component_type: "main_menu_continue_button", label: "继续游戏按钮", required: true, rect: { x: 78, y: 28, width: 18, height: 7 }, mobileRect: { x: 78, y: 28, width: 18, height: 7 }, style: { backgroundColor: "#82b6ff", color: "#07111f", borderRadius: 10, fontWeight: 760, shadow: "soft" }, zIndex: 20 },
          { component_id: "title_start_button", component_type: "main_menu_start_button", label: "开始/重新开始按钮", required: true, rect: { x: 78, y: 36, width: 18, height: 7 }, mobileRect: { x: 78, y: 36, width: 18, height: 7 }, style: { backgroundColor: "#82b6ff", color: "#07111f", borderRadius: 10, fontWeight: 760, shadow: "soft" }, zIndex: 21 },
          { component_id: "title_save_load_button", component_type: "main_menu_save_load_button", label: "存档/读档按钮", required: true, rect: { x: 78, y: 44, width: 18, height: 7 }, mobileRect: { x: 78, y: 44, width: 18, height: 7 }, style: { backgroundColor: "#192234", color: "#f6f8ff", borderColor: "#d8e2ff", borderRadius: 10 }, zIndex: 22 },
          { component_id: "title_library_button", component_type: "main_menu_library_button", label: "卡带库按钮", required: true, rect: { x: 78, y: 52, width: 18, height: 7 }, mobileRect: { x: 78, y: 52, width: 18, height: 7 }, style: { backgroundColor: "#192234", color: "#f6f8ff", borderColor: "#d8e2ff", borderRadius: 10 }, zIndex: 23 },
          { component_id: "title_gallery_button", component_type: "main_menu_gallery_button", label: "画廊按钮", required: true, rect: { x: 78, y: 60, width: 18, height: 7 }, mobileRect: { x: 78, y: 60, width: 18, height: 7 }, style: { backgroundColor: "#192234", color: "#f6f8ff", borderColor: "#d8e2ff", borderRadius: 10 }, zIndex: 24 },
          { component_id: "title_settings_button", component_type: "main_menu_settings_button", label: "设置按钮", required: true, rect: { x: 78, y: 68, width: 18, height: 7 }, mobileRect: { x: 78, y: 68, width: 18, height: 7 }, style: { backgroundColor: "#192234", color: "#f6f8ff", borderColor: "#d8e2ff", borderRadius: 10 }, zIndex: 25 },
          { component_id: "title_about_button", component_type: "main_menu_about_button", label: "关于按钮", required: true, rect: { x: 78, y: 76, width: 18, height: 7 }, mobileRect: { x: 78, y: 76, width: 18, height: 7 }, style: { backgroundColor: "#192234", color: "#f6f8ff", borderColor: "#d8e2ff", borderRadius: 10 }, zIndex: 26 },
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
            label: "说话人名牌",
            rect: { x: 8, y: 71, width: 20, height: 5.5 },
            mobileRect: { x: 6, y: 63, width: 24, height: 7 },
            style: { backgroundColor: "#192234", color: "#cde1ff", borderRadius: 999, padding: 7, fontSize: 18, fontWeight: 760, shadow: "soft" },
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
          { component_id: "choice_list", component_type: "choice_list", label: "选项列表", required: true, rect: { x: 50, y: 44, width: 34, height: 32, anchor: "center" }, mobileRect: { x: 50, y: 40, width: 58, height: 34, anchor: "center" }, zIndex: 40 },
          { component_id: "quick_menu", component_type: "quick_menu", label: "快捷菜单", required: true, rect: { x: 98, y: 2, width: 48, height: 8, anchor: "top_right" }, mobileRect: { x: 98, y: 2, width: 58, height: 12, anchor: "top_right" }, zIndex: 50 },
        ],
      },
      { screen_id: "game_menu", components: [{ component_id: "game_menu_nav", component_type: "game_menu_nav", required: true, rect: { x: 5, y: 12, width: 90, height: 12 } }] },
      { screen_id: "save_load", components: [{ component_id: "save_grid", component_type: "save_slot_grid", required: true, rect: { x: 4, y: 20, width: 92, height: 74 }, style: { columns: 3, gap: 14 } }] },
      { screen_id: "preferences", components: [{ component_id: "settings_group", component_type: "settings_group", required: true, rect: { x: 5, y: 18, width: 62, height: 70 }, mobileRect: { x: 5, y: 16, width: 90, height: 76 } }] },
      { screen_id: "history", components: [{ component_id: "history_list", component_type: "history_list", required: true, rect: { x: 5, y: 18, width: 90, height: 72 } }] },
      { screen_id: "gallery", components: [{ component_id: "gallery_grid", component_type: "gallery_grid", required: true, rect: { x: 5, y: 18, width: 90, height: 72 }, style: { columns: 4, gap: 14 } }] },
      { screen_id: "about", components: [{ component_id: "about_panel", component_type: "about_panel", required: true, rect: { x: 5, y: 18, width: 58, height: 48 }, mobileRect: { x: 5, y: 18, width: 90, height: 58 } }] },
    ],
  };
}
