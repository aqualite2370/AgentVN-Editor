import { Copy, EyeOff, History, Layers, List, Lock, Move, Plus, Redo2, RotateCw, Save, SkipForward, Trash2, Timer, Undo2, UploadCloud } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  normalizeExternalUrl,
  validateExternalUrl,
  type ExternalUrlValidationCode,
} from "../../../../shared/cartridge/externalAction";
import {
  createDefaultCustomButtonContainer,
  createDefaultMask,
  editUILayoutComponentStyle,
  getDefaultUISkinLayout,
  isBuiltinTitleButton,
  normalizeUISkinLayoutForRuntime,
  resolveTitleButtonStyle,
  speakerContainerDisplayLabel,
  hasUILayoutOpacityLayers,
  supportsUILayoutOpacityLayers,
  resolveUILayoutBackgroundOpacity,
  migrateLegacyUISkinLayout,
  QUICK_MENU_BUTTON_DEFINITIONS,
  validateUISkinHealth,
  type UILayoutAnchor,
  type UILayoutActionKind,
  type UILayoutComponent,
  type UILayoutComponentStyle,
  type UILayoutRect,
  type UILayoutScreen,
  type UILayoutScreenId,
  type UISkinLayout,
} from "../../../../shared/cartridge/uiSkin";
import { resolveOpacitySurfaceStyles } from "../../../../GameCli_framework/src/uiSkin/UILayoutOpacitySurface";
import { useProjectStore } from "../../store/projectStore";
import { recordLayoutHelpSelection } from "../../assistant/layoutHelpContext";
import { collectRenpyFontCoverageText } from "../../renpy/fontCoverage";
import { createRenpyUILayout, resolveRuntimeUILayoutSettings, switchRuntimeUILayoutType, updateActiveRuntimeUILayout, type RuntimeLayoutType } from "../../../../shared/cartridge/uiLayoutProfiles";
import { RuntimeLayoutTypeControls } from "./RuntimeLayoutTypeControls";
import { GAME_ASPECT_RATIOS, fitGameViewport, resolveGameViewport, type GameAspectRatio, type GameViewportConfig } from "../../../../shared/cartridge/gameViewport";
import { RenpyTitleEditor } from "./RenpyTitleEditor";
import { compileControlPresentation, layoutPresentationTargets } from "../../../../shared/cartridge/controlPresentation";
import { ControlPresentationEditor } from "./ControlPresentationEditor";
import { RenpyControlAppearanceEditor } from "./RenpyControlAppearanceEditor";
import { useControlPresentationPreview } from "../../utils/controlPresentationPreview";
import { RenpyButtonRoleEditor } from "./RenpyButtonRoleEditor";
import { RenpyRuntimePreview } from "./RenpyRuntimePreview";
import { DialogueModeLayoutEditor } from "./DialogueModeLayoutEditor";
import { ConfirmationLayoutEditor } from "./ConfirmationLayoutEditor";
import { DialogPortraitLayoutEditor } from "./DialogPortraitLayoutEditor";
import { DIALOGUE_LAYOUT_MODES, type DialogueLayoutMode } from "../../../../shared/cartridge/dialogueModeLayout";
import { RENPY_NAVIGATION_PAGES, type RenpyNavigationPage } from "../../../../shared/cartridge/renpyGui";
import type { AssetRef } from "../../types/assets";
import type { SceneBeat } from "../../types/scene";
import type { PackageAppearanceSettings } from "../../types/project";
import { artworkFitOptions, backgroundFitOptions } from "../../utils/localizedOptions";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { findAvailableCustomButtonRect } from "../../utils/customButtonLayout";
import { repairRuntimeDialogueLayout, resolveRuntimeLayoutEditorScreen, restoreAllRuntimeLayoutPages, restoreRuntimeLayoutPage } from "../../utils/runtimeLayoutRestore";
import {
  createImportedUIImageAsset,
  readFileAsDataUrl,
  validateImportedUIImageFile,
} from "../../utils/projectAssets";
import {
  assetIdFromUILayoutReference,
  resolveUILayoutImagePreview,
  toUILayoutAssetReference,
} from "../../utils/uiLayoutAssetReference";
import { resolveQuickMenuPresentation } from "../../../../shared/cartridge/quickMenuMetrics";
import {
  QUICK_MENU_DEFAULT_ACTION_STYLE,
  QUICK_MENU_DEFAULT_SURFACE_STYLE,
} from "../../../../shared/cartridge/quickMenuDefaults";
import {
  SNAP_GRID_STEP_PERCENT,
  SNAP_RELEASE_THRESHOLD_PX,
  SNAP_SAFE_INSETS_PERCENT,
  SNAP_THRESHOLD_PX,
  snapLayoutRect,
} from "../../utils/runtimeLayoutSnapping.mjs";
import { backendClient } from "../../api/backendClient";
import { useEditorStore } from "../../store/editorStore";
import { AssetPicker } from "../common/AssetPicker";
import { RangeControl } from "../common/RangeControl";
import { RichSelect } from "../common/RichSelect";
import { GlassSelectionGroup } from "../common/GlassSelectionGroup";
import { OperationResultDialog } from "../common/OperationResultDialog";
import {
  beginRuntimeLayoutSave,
  createRuntimeLayoutSession,
  editRuntimeLayoutSession,
  failRuntimeLayoutSave,
  receiveRuntimeLayoutSnapshot,
  redoRuntimeLayoutSession,
  undoRuntimeLayoutSession,
} from "../../utils/runtimeLayoutSession.mjs";
import {
  clearRuntimeLayoutWorkspaceDraft,
  readRuntimeLayoutWorkspaceDraft,
  writeRuntimeLayoutWorkspaceDraft,
} from "../../utils/runtimeLayoutWorkspaceDraft.mjs";

type ZoomMode = "fit" | 0.5 | 0.75 | 1;
type PresetId = "default" | "renpy" | "subtitle";
type PresetScope = "current" | "all";

const renpyPlayerDefaultStyleByComponent = new Map(
  createRenpyUILayout().screens.find((screen) => screen.screen_id === "player")?.components
    .map((component) => [component.component_id, component.style ?? {}] as const) ?? [],
);

function stylesMatch(left: UILayoutComponentStyle | undefined, right: UILayoutComponentStyle | undefined) {
  const keys = new Set([
    ...Object.keys(left ?? {}),
    ...Object.keys(right ?? {}),
  ] as Array<keyof UILayoutComponentStyle>);
  return [...keys].every((key) => Object.is(left?.[key], right?.[key]));
}

interface CustomButtonImageImportState {
  componentId: string;
  status: "success" | "error";
  message: string;
  asset?: AssetRef;
}

export interface RuntimeLayoutDesignerSession {
  projectId?: string;
  layoutType?: RuntimeLayoutType;
  draft?: UISkinLayout;
  screenId?: UILayoutScreenId;
  screenIds?: Partial<Record<RuntimeLayoutType, UILayoutScreenId>>;
  zoomModes?: Partial<Record<RuntimeLayoutType, ZoomMode>>;
  renpyPreviewModes?: Partial<Record<RuntimeLayoutType, "desktop" | "mobile">>;
  quickMenuExpanded?: boolean;
  dialogueModes?: Partial<Record<RuntimeLayoutType, DialogueLayoutMode>>;
  confirmationPages?: Partial<Record<RuntimeLayoutType, boolean>>;
}

interface CustomButtonUrlTestState {
  componentId: string;
  status: "success" | "info" | "error";
  message: string;
  testedUrl: string;
}

type LayoutSaveState = "idle" | "saving" | "saved" | "error";

function LazyRuntimeLayoutFieldset({
  className = "runtime-layout-fieldset",
  defaultOpen = false,
  summary,
  children,
}: {
  className?: string;
  defaultOpen?: boolean;
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={className}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      {open ? children : null}
    </details>
  );
}
const externalUrlErrorMessages: Record<ExternalUrlValidationCode, string> = {
  external_url_required: "请输入完整的外部链接地址。",
  external_url_invalid: "请输入包含 http:// 或 https:// 的完整绝对地址。",
  external_url_unsupported_protocol: "仅允许使用 http:// 或 https://，不能使用 javascript:、data: 或 file:。",
};

const screenOrder: UILayoutScreenId[] = ["title", "player", "game_menu", "save_load", "preferences", "history", "gallery", "about"];

const screenLabels: Record<UILayoutScreenId, string> = {
  title: "标题主页",
  player: "播放页",
  game_menu: "游戏菜单",
  save_load: "存档/读档",
  preferences: "选项",
  history: "历史",
  gallery: "画廊",
  about: "关于",
  help: "帮助",
};

const componentLabels: Record<string, string> = {
  mask: "遮罩",
  stage_background: "舞台背景",
  main_menu_hero: "标题信息",
  main_menu_continue_button: "继续游戏按钮",
  main_menu_start_button: "开始按钮",
  main_menu_save_load_button: "存读档按钮",
  main_menu_gallery_button: "画廊按钮",
  main_menu_settings_button: "选项按钮",
  main_menu_about_button: "关于按钮",
  main_menu_custom_button_container: "自定义按钮容器",
  dialog_panel: "对话框",
  speaker_label: "姓名容器",
  dialog_text: "对话正文",
  continue_indicator: "继续提示",
  choice_list: "选项列表",
  quick_menu: "快捷菜单",
  quick_button: "快捷按钮",
  game_menu_nav: "菜单导航",
  menu_button: "菜单按钮",
  save_slot_grid: "存档槽",
  settings_group: "设置项",
  history_list: "历史列表",
  gallery_grid: "画廊网格",
  about_panel: "关于面板",
  help_panel: "帮助面板",
  import_panel: "导入面板",
};

const presetLabels: Record<PresetId, string> = {
  default: "默认视觉小说",
  renpy: "Ren'Py（进阶）风格",
  subtitle: "极简字幕",
};

const renpyPlayerRects: Record<string, UILayoutRect> = {
  dialog_panel: { x: 4.5, y: 66.5, width: 91, height: 28 },
  speaker_label: { x: 7, y: 68, width: 24, height: 6 },
  dialog_text: { x: 8, y: 75, width: 84, height: 14 },
  continue_indicator: { x: 86, y: 90, width: 8, height: 3 },
  choice_list: { x: 50, y: 44, width: 48, height: 32, anchor: "center" },
};

const subtitlePlayerRects: Record<string, UILayoutRect> = {
  dialog_panel: { x: 8, y: 78, width: 84, height: 15 },
  speaker_label: { x: 10, y: 74, width: 19, height: 5 },
  dialog_text: { x: 10, y: 81, width: 78, height: 10 },
  continue_indicator: { x: 84, y: 89.5, width: 8, height: 3 },
  choice_list: { x: 50, y: 43, width: 48, height: 32, anchor: "center" },
};

const playerPresetRects: Partial<Record<PresetId, Record<string, UILayoutRect>>> = {
  renpy: renpyPlayerRects,
  subtitle: subtitlePlayerRects,
};
const playerPresetComponentIds = new Set(Object.keys(renpyPlayerRects));

const alignmentLabels = {
  left: "左对齐", centerX: "水平居中", right: "右对齐",
  top: "顶端对齐", centerY: "垂直居中", bottom: "底端对齐",
  sameWidth: "等宽", sameHeight: "等高",
  distributeX: "水平等距", distributeY: "垂直等距",
} as const;

const snappingLabels = {
  "layout.snapGrid": "吸附网格", "layout.snapEdges": "吸附边缘",
  "layout.snapCenter": "吸附中心线", "layout.snapSafe": "吸附安全区",
} as const;

const anchorLabels: Array<{ value: "" | UILayoutAnchor; label: string }> = [
  { value: "", label: "默认：左上角" },
  { value: "top_left", label: "左上角" },
  { value: "top_center", label: "顶部居中" },
  { value: "top_right", label: "右上角" },
  { value: "center", label: "中心" },
  { value: "bottom_left", label: "左下角" },
  { value: "bottom_center", label: "底部居中" },
  { value: "bottom_right", label: "右下角" },
];

const fontWeightOptions = [
  { value: "", label: "默认" },
  { value: "300", label: "细体 300" },
  { value: "400", label: "常规 400" },
  { value: "500", label: "中等 500" },
  { value: "600", label: "半粗 600" },
  { value: "700", label: "粗体 700" },
  { value: "760", label: "强调 760" },
  { value: "900", label: "黑体 900" },
];

const defaultAboutFields = [
  { label: "版本", value: "" },
  { label: "作者", value: "" },
  { label: "引擎", value: "" },
];

const customButtonContainerPadding = 1;

function isCustomButtonContainer(component: UILayoutComponent): boolean {
  return component.component_type === "main_menu_custom_button_container";
}

function isArtworkImageComponent(component: UILayoutComponent): boolean {
  return ["dialog_panel", "choice_list", "choice_option", "quick_button", "main_menu_custom_button", "mask"].includes(component.component_type);
}

function isLayoutEditableComponent(component: UILayoutComponent): boolean {
  return component.component_type !== "choice_option";
}

function isStyleOnlyComponent(component: UILayoutComponent): boolean {
  return component.component_type === "quick_button" || component.component_type === "choice_option";
}

function isGeometryLocked(component: UILayoutComponent, components: UILayoutComponent[]): boolean {
  if (component.locked) return true;
  if (component.component_type === "main_menu_custom_button") {
    return Boolean(components.find(isCustomButtonContainer)?.locked);
  }
  // Moving a group must not move a locked child or split it off from siblings.
  return isCustomButtonContainer(component)
    && components.some((item) => item.component_type === "main_menu_custom_button" && item.locked);
}

function alignableComponents(components: UILayoutComponent[], ids: string[], action: string): UILayoutComponent[] {
  const sameSize = action === "sameWidth" || action === "sameHeight";
  const selected = ids.flatMap((id) => {
    const component = components.find((item) => item.component_id === id);
    return component && !isGeometryLocked(component, components) && component.component_type !== "quick_menu"
      && !isStyleOnlyComponent(component) && !(sameSize && isCustomButtonContainer(component))
      ? [component] : [];
  });
  return selected.some(isCustomButtonContainer)
    ? selected.filter((component) => component.component_type !== "main_menu_custom_button")
    : selected;
}

function minimumAlignmentTargets(action: string): number {
  return action === "distributeX" || action === "distributeY" ? 3
    : action === "sameWidth" || action === "sameHeight" ? 2 : 1;
}

function hasDistributionSpace(components: UILayoutComponent[], action: string): boolean {
  if (action !== "distributeX" && action !== "distributeY") return true;
  if (components.length < 3) return true;
  const axis = action === "distributeX" ? "x" : "y";
  const dimension = action === "distributeX" ? "width" : "height";
  const sorted = [...components].sort((left, right) => visualRect(getRect(left))[axis] - visualRect(getRect(right))[axis]);
  const first = visualRect(getRect(sorted[0]));
  const last = visualRect(getRect(sorted[sorted.length - 1]));
  const total = sorted.reduce((sum, component) => sum + getRect(component)[dimension], 0);
  return last[axis] + last[dimension] - first[axis] - total >= -0.01;
}

function isProportionalArtworkFit(value: unknown): value is "contain" | "cover" {
  return value === "contain" || value === "cover";
}

function normalizeArtworkImageFit(component: UILayoutComponent): UILayoutComponent {
  if (!isArtworkImageComponent(component) || !component.style?.backgroundImage || isProportionalArtworkFit(component.style.backgroundFit)) {
    return component;
  }
  return {
    ...component,
    style: {
      ...component.style,
      backgroundFit: "contain",
    },
  };
}

function roundLayoutValue(value: number): number {
  return Number(value.toFixed(2));
}

function ensureCustomButtonContainer(components: UILayoutComponent[]): UILayoutComponent[] {
  return components.some(isCustomButtonContainer)
    ? components
    : [...components, createDefaultCustomButtonContainer()];
}

function fitCustomButtonContainer(components: UILayoutComponent[]): UILayoutComponent[] {
  const container = components.find(isCustomButtonContainer);
  if (!container) return components;
  const buttons = components.filter((component) => component.component_type === "main_menu_custom_button");
  let nextRect: UILayoutRect;
  if (buttons.length === 0) {
    const currentRect = getRect(container);
    const defaultRect = getRect(createDefaultCustomButtonContainer());
    nextRect = {
      x: currentRect.x,
      y: currentRect.y,
      width: defaultRect.width,
      height: defaultRect.height,
    };
  } else {
    const rects = buttons.map((button) => getRect(button));
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    nextRect = {
      x: roundLayoutValue(Math.max(0, left - customButtonContainerPadding)),
      y: roundLayoutValue(Math.max(0, top - customButtonContainerPadding)),
      width: roundLayoutValue(Math.min(100, right + customButtonContainerPadding) - Math.max(0, left - customButtonContainerPadding)),
      height: roundLayoutValue(Math.min(100, bottom + customButtonContainerPadding) - Math.max(0, top - customButtonContainerPadding)),
    };
  }
  return components.map((component) => component.component_id === container.component_id
    ? setRect(component, nextRect)
    : component);
}

function syncCustomButtonContainer(components: UILayoutComponent[]): UILayoutComponent[] {
  const ensured = ensureCustomButtonContainer(components);
  return fitCustomButtonContainer(ensured);
}

function translateCustomButtonContainer(
  components: UILayoutComponent[],
  targetX: number,
  targetY: number,
): UILayoutComponent[] {
  const container = components.find(isCustomButtonContainer);
  if (!container || isGeometryLocked(container, components)) return components;
  const containerRect = getRect(container);
  const clampedX = Math.max(0, Math.min(100 - containerRect.width, targetX));
  const clampedY = Math.max(0, Math.min(100 - containerRect.height, targetY));
  const dx = clampedX - containerRect.x;
  const dy = clampedY - containerRect.y;
  const translated = components.map((component) => {
    if (!isCustomButtonContainer(component) && component.component_type !== "main_menu_custom_button") return component;
    const rect = getRect(component);
    return setRect(component, {
      ...rect,
      x: roundLayoutValue(rect.x + dx),
      y: roundLayoutValue(rect.y + dy),
    });
  });
  return fitCustomButtonContainer(translated);
}

function cloneSkin(skin?: UISkinLayout): UISkinLayout {
  const cloned = JSON.parse(JSON.stringify(migrateLegacyUISkinLayout(skin))) as UISkinLayout;
  return {
    ...cloned,
    screens: cloned.screens.map((screen) => {
      const components = screen.components.map(normalizeArtworkImageFit);
      return screen.screen_id === "title"
        ? { ...screen, components: syncCustomButtonContainer(components) }
        : { ...screen, components };
    }),
  };
}

function getScreen(skin: UISkinLayout, screenId: UILayoutScreenId): UILayoutScreen {
  return skin.screens.find((screen) => screen.screen_id === screenId) ?? skin.screens[0];
}

function getRect(component: UILayoutComponent): UILayoutRect {
  return component.rect ?? { x: 10, y: 10, width: 30, height: 20 };
}

function visualRect(rect: UILayoutRect): UILayoutRect {
  const horizontalFactor = rect.anchor === "top_center" || rect.anchor === "bottom_center" || rect.anchor === "center"
    ? 0.5
    : rect.anchor === "top_right" || rect.anchor === "bottom_right"
      ? 1
      : 0;
  const verticalFactor = rect.anchor === "bottom_left" || rect.anchor === "bottom_center" || rect.anchor === "bottom_right"
    ? 1
    : rect.anchor === "center"
      ? 0.5
      : 0;
  return {
    x: rect.x - rect.width * horizontalFactor,
    y: rect.y - rect.height * verticalFactor,
    width: rect.width,
    height: rect.height,
  };
}

function anchorFactor(anchor?: UILayoutAnchor): { x: number; y: number } {
  return {
    x: anchor === "top_center" || anchor === "bottom_center" || anchor === "center"
      ? 0.5
      : anchor === "top_right" || anchor === "bottom_right"
        ? 1
        : 0,
    y: anchor === "bottom_left" || anchor === "bottom_center" || anchor === "bottom_right"
      ? 1
      : anchor === "center"
        ? 0.5
        : 0,
  };
}

function clampAnchorPosition(rect: UILayoutRect, x: number, y: number): { x: number; y: number } {
  const factor = anchorFactor(rect.anchor);
  return {
    x: Math.max(rect.width * factor.x, Math.min(100 - rect.width * (1 - factor.x), x)),
    y: Math.max(rect.height * factor.y, Math.min(100 - rect.height * (1 - factor.y), y)),
  };
}

function applyCanvasAnchorPreset(rect: UILayoutRect, anchor?: UILayoutAnchor): UILayoutRect {
  const factor = anchorFactor(anchor);
  return {
    ...rect,
    x: factor.x * 100,
    y: factor.y * 100,
    anchor,
  };
}

function quickButtonPreviewRect(
  screen: UILayoutScreen,
  component: UILayoutComponent,
): UILayoutRect {
  const menu = screen.components.find((item) => item.component_type === "quick_menu");
  if (!menu) return { x: 10, y: 10, width: 4, height: 4 };
  const menuRect = visualRect(getRect(menu));
  const index = Math.max(0, QUICK_MENU_BUTTON_DEFINITIONS.findIndex((item) => item.component_id === component.component_id));
  const buttonCount = Math.max(1, QUICK_MENU_BUTTON_DEFINITIONS.length);
  const gap = Math.min(0.5, menuRect.width * 0.012);
  const horizontalPadding = Math.min(0.6, menuRect.width * 0.018);
  const verticalPadding = Math.min(0.6, menuRect.height * 0.14);
  const availableWidth = Math.max(1, menuRect.width - horizontalPadding * 2 - gap * Math.max(0, buttonCount - 1));
  const slotWidth = availableWidth / buttonCount;
  return {
    x: menuRect.x + horizontalPadding + index * (slotWidth + gap),
    y: menuRect.y + verticalPadding,
    width: slotWidth,
    height: Math.max(1, menuRect.height - verticalPadding * 2),
  };
}

function setRect(component: UILayoutComponent, rect: UILayoutRect): UILayoutComponent {
  return { ...component, rect };
}

function componentLabel(component: UILayoutComponent): string {
  if (component.component_type === "speaker_label") return speakerContainerDisplayLabel(component);
  return component.label ?? componentLabels[component.component_type] ?? component.component_type;
}

function rectToStyle(rect: UILayoutRect): CSSProperties {
  const transforms: Partial<Record<UILayoutAnchor, string>> = {
    top_center: "translateX(-50%)",
    top_right: "translateX(-100%)",
    center: "translate(-50%, -50%)",
    bottom_left: "translateY(-100%)",
    bottom_center: "translate(-50%, -100%)",
    bottom_right: "translate(-100%, -100%)",
  };
  return {
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
    transform: rect.anchor ? transforms[rect.anchor] : undefined,
  };
}

function cleanStyle(style: Partial<UILayoutComponentStyle>): UILayoutComponentStyle {
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined && value !== "")) as UILayoutComponentStyle;
}

function opaquePreviewColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (normalized.startsWith("#")) {
    const hex = normalized.slice(1);
    if (hex.length === 4) return `#${hex.slice(0, 3)}`;
    if (hex.length === 8) return `#${hex.slice(0, 6)}`;
    return normalized;
  }
  const rgba = normalized.match(/^rgba?\(\s*([^, /]+)(?:\s*,|\s)\s*([^, /]+)(?:\s*,|\s)\s*([^, /]+)(?:\s*[,/]\s*[^)]+)?\s*\)$/i);
  if (rgba) return `rgb(${rgba[1]} ${rgba[2]} ${rgba[3]})`;
  const hsla = normalized.match(/^hsla?\(\s*([^, /]+)(?:\s*,|\s)\s*([^, /]+)(?:\s*,|\s)\s*([^, /]+)(?:\s*[,/]\s*[^)]+)?\s*\)$/i);
  if (hsla) return `hsl(${hsla[1]} ${hsla[2]} ${hsla[3]})`;
  return normalized;
}

function componentStyle(component: UILayoutComponent, assetManifest: AssetRef[]): CSSProperties {
  const style = resolveTitleButtonStyle(component);
  if (component.component_type === "mask") {
    const mode = style?.maskMode ?? "blur";
    const backgroundImage = mode === "image" ? resolveUILayoutImagePreview(style?.backgroundImage, assetManifest).source : undefined;
    return {
      backgroundColor: backgroundImage ? "transparent" : style?.backgroundColor ?? "rgba(8, 13, 22, 0.62)",
      backgroundImage: backgroundImage ? `url("${backgroundImage}")` : undefined,
      backgroundSize: backgroundImage ? (style?.backgroundFit === "stretch" ? "100% 100%" : style?.backgroundFit ?? "cover") : undefined,
      backgroundRepeat: backgroundImage ? "no-repeat" : undefined,
      backgroundPosition: backgroundImage ? "center" : undefined,
      opacity: style?.opacity ?? 1,
      borderColor: style?.borderColor ?? "rgba(255, 255, 255, 0.18)",
      borderWidth: style?.borderWidth ?? 1,
      borderStyle: "solid",
      borderRadius: style?.borderRadius ?? 12,
      backdropFilter: mode === "blur" ? `blur(${style?.backdropBlur ?? 12}px)` : undefined,
      WebkitBackdropFilter: mode === "blur" ? `blur(${style?.backdropBlur ?? 12}px)` : undefined,
      boxShadow: style?.shadow === "none" ? "none" : "0 12px 30px rgba(0,0,0,0.24)",
      pointerEvents: "none",
    };
  }
  const backgroundFit = style?.backgroundFit ?? "stretch";
  const backgroundImage = resolveUILayoutImagePreview(style?.backgroundImage, assetManifest).source;
  const imageOwned = Boolean(backgroundImage) && isArtworkImageComponent(component);
  const fallbackBackground = component.component_type === "quick_button"
    ? "var(--preview-runtime-control, var(--field))"
    : "rgba(130, 182, 255, 0.18)";
  const fallbackColor = "var(--preview-runtime-control-text, var(--ink-strong))";
  const fallbackBorder = component.component_type === "quick_button"
    ? "var(--preview-runtime-line, var(--line))"
    : "color-mix(in srgb, var(--accent) 58%, var(--line))";
  const componentBackground = component.component_type === "quick_button"
    ? opaquePreviewColor(style?.backgroundColor) ?? fallbackBackground
    : style?.backgroundColor ?? fallbackBackground;
  const quickButtonAlpha = style?.opacity ?? QUICK_MENU_DEFAULT_ACTION_STYLE.opacity;
  const quickButtonBlur = style?.backdropBlur ?? QUICK_MENU_DEFAULT_ACTION_STYLE.backdropBlur;
  return {
    "--preview-quick-menu-action-background": componentBackground,
    "--preview-quick-menu-action-border": style?.borderColor ?? fallbackBorder,
    "--preview-quick-menu-action-alpha": component.component_type === "quick_button"
      ? `${Math.round(quickButtonAlpha * 10_000) / 100}%`
      : undefined,
    "--preview-quick-menu-action-blur": component.component_type === "quick_button" ? `${quickButtonBlur}px` : undefined,
    "--preview-quick-menu-action-radius": component.component_type === "quick_button"
      ? `${style?.borderRadius ?? QUICK_MENU_DEFAULT_ACTION_STYLE.borderRadius}px`
      : undefined,
    "--preview-quick-menu-action-border-width": component.component_type === "quick_button"
      ? `${style?.borderWidth ?? QUICK_MENU_DEFAULT_ACTION_STYLE.borderWidth}px`
      : undefined,
    backgroundColor: imageOwned
      ? "transparent"
      : component.component_type === "quick_button"
        ? `color-mix(in srgb, ${componentBackground} ${Math.round(quickButtonAlpha * 10_000) / 100}%, transparent)`
        : componentBackground,
    backgroundImage: backgroundImage ? `url("${backgroundImage}")` : undefined,
    backgroundSize: backgroundImage ? backgroundFit === "stretch" ? "100% 100%" : backgroundFit : undefined,
    backgroundRepeat: backgroundImage ? "no-repeat" : undefined,
    backgroundPosition: backgroundImage ? "center" : undefined,
    color: style?.color ?? fallbackColor,
    borderColor: imageOwned ? "transparent" : style?.borderColor ?? fallbackBorder,
    borderWidth: imageOwned ? 0 : style?.borderWidth ?? (component.component_type === "quick_button" ? 1 : undefined),
    borderRadius: style?.borderRadius ?? (component.component_type === "quick_button" ? 8 : undefined),
    padding: style?.padding,
    gap: style?.gap,
    opacity: component.component_type === "quick_button" ? 1
      : supportsUILayoutOpacityLayers(component.component_type) && hasUILayoutOpacityLayers(style)
        ? undefined : style?.opacity,
    ...(supportsUILayoutOpacityLayers(component.component_type) && hasUILayoutOpacityLayers(style) ? {
      "--ui-layout-background-opacity": style?.backgroundOpacity
        ?? (style?.backgroundColor ? resolveUILayoutBackgroundOpacity(component.component_type, style) : style?.opacity ?? 1),
      "--ui-layout-content-opacity": style?.contentOpacity ?? style?.opacity ?? 1,
    } : {}),
    fontSize: style?.fontSize,
    fontWeight: style?.fontWeight,
    fontStyle: style?.fontStyle,
    textAlign: style?.textAlign,
    boxShadow: imageOwned ? "none" : style?.shadow === "none" ? "none" : style?.shadow === "soft" ? "0 12px 30px rgba(0,0,0,0.24)" : undefined,
    backdropFilter: component.component_type === "quick_button" ? `blur(${quickButtonBlur}px)` : undefined,
    WebkitBackdropFilter: component.component_type === "quick_button" ? `blur(${quickButtonBlur}px)` : undefined,
  } as CSSProperties;
}

type PreviewPrecisionIconName =
  | "auto"
  | "close"
  | "expand"
  | "hide"
  | "history"
  | "menu"
  | "rollback"
  | "save"
  | "skip";

// Editor and Runtime have different React type versions; share the layer style
// projection, not React children across those package boundaries.
function PreviewOpacitySurface({ children, className, style, ...props }: import("react").HTMLAttributes<HTMLDivElement>) {
  const layers = resolveOpacitySurfaceStyles(style);
  if (!layers) return <div {...props} className={className} style={style}>{children}</div>;
  return <div {...props} className={`${className ?? ""} ui-opacity-surface`} style={layers.frame}>
    <div className="ui-opacity-background" aria-hidden="true" style={layers.background} />
    <div className="ui-opacity-content" style={layers.content}>{children}</div>
  </div>;
}

const quickButtonIconNames: Record<string, PreviewPrecisionIconName> = {
  quick_rollback_button: "rollback",
  quick_auto_button: "auto",
  quick_skip_button: "skip",
  quick_save_load_button: "save",
  quick_history_button: "history",
  quick_hide_ui_button: "hide",
  quick_main_menu_button: "menu",
};

const quickButtonDisplayLabels: Record<string, string> = {
  quick_rollback_button: "回退",
  quick_auto_button: "自动",
  quick_skip_button: "快进",
  quick_save_load_button: "存档",
  quick_history_button: "历史",
  quick_hide_ui_button: "隐藏",
  quick_main_menu_button: "菜单",
};

function PreviewPrecisionIcon({ name, size = 20 }: { name: PreviewPrecisionIconName; size?: number }) {
  const geometry = {
    auto: <><circle cx="12" cy="12.5" r="7.2" /><path d="M9.4 3.2h5.2M12 5.3v2.1M12 12.5l3.1-2" /><path className="precision-icon__accent" d="M17.2 7.5 19 5.8" /></>,
    close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
    expand: <><circle cx="6.5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="17.5" cy="12" r="1.3" fill="currentColor" stroke="none" /></>,
    hide: <><path d="M3.2 12s3.1-5 8.8-5 8.8 5 8.8 5-3.1 5-8.8 5-8.8-5-8.8-5Z" /><circle cx="12" cy="12" r="2.5" /><path className="precision-icon__accent" d="m4 4 16 16" /></>,
    history: <><path d="M5.2 8.4A7.5 7.5 0 1 1 4.7 15M5.2 4.8v3.7H1.5M12 8v4.4l3 1.8" /><circle className="precision-icon__accent" cx="12" cy="12" r="1" /></>,
    menu: <><path d="M8.5 6h11M8.5 12h11M8.5 18h11" /><circle cx="4.5" cy="6" r="1" /><circle className="precision-icon__accent" cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
    rollback: <><path d="M5.25 9.25A7.25 7.25 0 1 1 5.8 16" /><path d="m5.25 5.8-.1 3.55 3.55-.1" /><path className="precision-icon__accent" d="M12 8.2v4.1l2.8 1.7" /></>,
    save: <><path d="M5 3.8h11.7L20 7.1v13.1H4V4.8Z" /><path d="M8 3.8v5h8v-5M7.5 20.2v-7.1h9v7.1" /><path className="precision-icon__accent" d="M13.8 5.7v1.4" /></>,
    skip: <><path d="m5.4 6.4 6.1 5.6-6.1 5.6ZM11.7 6.4l6.1 5.6-6.1 5.6Z" /><path className="precision-icon__accent" d="M19.2 6.2v11.6" /></>,
  }[name];
  return (
    <svg
      aria-hidden="true"
      className="precision-icon"
      data-precision-icon={name}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.65" vectorEffect="non-scaling-stroke">
        {geometry}
      </g>
    </svg>
  );
}

function assetPreviewUrl(assetManifest: AssetRef[], assetId?: string): string | undefined {
  if (!assetId) return undefined;
  const asset = assetManifest.find((item) => item.asset_id === assetId);
  return asset?.metadata.data_url ?? asset?.metadata.blob_url ?? asset?.metadata.url;
}

function assetIdForUILayoutImageReference(assetManifest: AssetRef[], reference?: string): string {
  if (!reference) return "";
  const referencedAssetId = assetIdFromUILayoutReference(reference);
  if (referencedAssetId) return referencedAssetId;
  return assetManifest.find((asset) => [
    asset.metadata.data_url,
    asset.metadata.blob_url,
    asset.metadata.url,
    asset.metadata.project_path,
    asset.metadata.path,
    asset.metadata.filePath,
  ].includes(reference))?.asset_id ?? "";
}

function shellImageStyle(url: string | undefined, fit: unknown, dimming = 0): CSSProperties {
  if (!url) return {};
  const size = fit === "contain" || fit === "cover" ? fit : "100% 100%";
  return {
    backgroundImage: `linear-gradient(rgba(7, 9, 16, ${dimming}), rgba(7, 9, 16, ${Math.min(0.9, dimming * 1.2)})), url("${url}")`,
    backgroundSize: `100% 100%, ${size}`,
    backgroundRepeat: "no-repeat, no-repeat",
    backgroundPosition: "center, center",
  };
}

function sceneBackgroundStyle(scene: SceneBeat | undefined, assetManifest: AssetRef[]): CSSProperties {
  const backgroundCommand = [...(scene?.commands ?? [])]
    .reverse()
    .find((command) => command.type === "background" && Boolean(command.background_id?.trim()));
  const backgroundUrl = backgroundCommand?.type === "background"
    ? assetPreviewUrl(assetManifest, backgroundCommand.background_id)
    : undefined;
  if (!backgroundUrl) {
    return {
      backgroundImage:
        "linear-gradient(135deg, color-mix(in srgb, var(--panel-bg-strong) 86%, var(--accent) 14%), color-mix(in srgb, var(--bg) 88%, var(--accent-2) 12%))",
      backgroundColor: "var(--panel-bg-strong)",
    };
  }
  const fit = backgroundCommand?.type === "background" && backgroundCommand.background_fit === "contain"
    ? "contain"
    : "cover";
  return {
    backgroundColor: "var(--bg)",
    backgroundImage: `url("${backgroundUrl}")`,
    backgroundSize: fit,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center",
  };
}

function updateComponent(
  skin: UISkinLayout,
  screenId: UILayoutScreenId,
  componentId: string,
  updater: (component: UILayoutComponent) => UILayoutComponent,
): UISkinLayout {
  return {
    ...skin,
    screens: skin.screens.map((screen) => screen.screen_id !== screenId ? screen : {
      ...screen,
      components: screen.components.map((component) => component.component_id === componentId ? updater(component) : component),
    }),
  };
}

function updateScreenComponents(
  skin: UISkinLayout,
  screenId: UILayoutScreenId,
  updater: (components: UILayoutComponent[]) => UILayoutComponent[],
): UISkinLayout {
  return {
    ...skin,
    screens: skin.screens.map((screen) => screen.screen_id !== screenId ? screen : { ...screen, components: updater(screen.components) }),
  };
}

function createUniqueCustomButtonId(components: UILayoutComponent[]): string {
  const existingIds = new Set(components.map((component) => component.component_id));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const randomPart = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12)
      ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const candidate = `title_custom_button_${randomPart}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  throw new Error("Unable to generate a unique custom title button ID.");
}

function createUniqueMaskId(components: UILayoutComponent[]): string {
  const existingIds = new Set(components.map((component) => component.component_id));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `mask_${index}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  throw new Error("Unable to generate a unique mask ID.");
}

function createCustomTitleButton(components: UILayoutComponent[], tokens: UISkinLayout["tokens"]): UILayoutComponent {
  const defaults = getDefaultUISkinLayout().tokens;
  const container = components.find(isCustomButtonContainer) ?? createDefaultCustomButtonContainer();
  const highestLayer = components.reduce(
    (highest, component) => Math.max(highest, component.zIndex ?? 0),
    0,
  );
  return {
    component_id: createUniqueCustomButtonId(components),
    component_type: "main_menu_custom_button",
    label: "自定义按钮",
    visible: true,
    required: false,
    locked: false,
    zIndex: Math.min(1000, highestLayer + 1),
    rect: findAvailableCustomButtonRect(components, container, "desktop"),
    style: {
      backgroundColor: tokens?.colorControl ?? defaults.colorControl,
      color: tokens?.colorControlText ?? defaults.colorControlText,
      borderColor: tokens?.colorLine ?? defaults.colorLine,
      borderWidth: 1,
      borderRadius: 10,
      shadow: "soft",
      textAlign: "center",
    },
    action: { kind: "none" },
  };
}

function RuntimeLayoutExpectedPreview({
  screenId,
  screen,
  assetManifest,
  packageAppearance,
  themeTokens,
  scene,
  quickMenuExpanded,
  stageSize,
  editorViewport,
  viewport,
  onQuickMenuToggle,
}: {
  screenId: UILayoutScreenId;
  screen: UILayoutScreen;
  assetManifest: AssetRef[];
  packageAppearance: PackageAppearanceSettings;
  themeTokens?: UISkinLayout["tokens"];
  scene?: SceneBeat;
  quickMenuExpanded: boolean;
  stageSize: { width: number; height: number };
  editorViewport: { width: number; height: number };
  viewport?: GameViewportConfig;
  onQuickMenuToggle?: () => void;
}) {
  const titleBackground = assetPreviewUrl(assetManifest, packageAppearance.titleBackgroundAssetId);
  const settingsBackground = assetPreviewUrl(assetManifest, packageAppearance.settingsPanelBackgroundAssetId);
  const titleStyle = shellImageStyle(titleBackground, packageAppearance.titleBackgroundFit, packageAppearance.titleBackgroundDimming ?? 0.18);
  const settingsStyle = shellImageStyle(settingsBackground, packageAppearance.settingsPanelBackgroundFit, packageAppearance.settingsPanelBackgroundDimming ?? 0.24);
  const playerSceneStyle = sceneBackgroundStyle(scene, assetManifest);
  const previewQuickMenuBackground = themeTokens?.colorQuickMenu ?? themeTokens?.colorSurface ?? "#686d72";
  const previewControlBackground = themeTokens?.colorControl ?? themeTokens?.colorSurfaceStrong ?? "#74797e";
  const previewControlText = themeTokens?.colorControlText ?? themeTokens?.colorInk ?? "#f5f5f5";
  const previewLine = themeTokens?.colorLine ?? "#92999e";
  const quickButtons = QUICK_MENU_BUTTON_DEFINITIONS.map(({ component_id }) => (
    screen.components.find((component) => component.component_id === component_id)
      ?? { component_id, component_type: "quick_button" as const, style: { ...QUICK_MENU_DEFAULT_ACTION_STYLE } }
  ));
  const quickMenuToggleButton = quickButtons[quickButtons.length - 1];
  const quickMenu = screen.components.find((component) => component.component_type === "quick_menu");
  const dialogPanel = screen.components.find((component) => component.component_type === "dialog_panel");
  // The editor canvas is a scaled representation of the same authored 16:9
  // frame used by GameCLI. Resolve metrics against that logical frame first,
  // then apply exactly one stage/frame render scale. Solving directly against
  // the small canvas makes the drawer look too large at some editor sizes
  // because its reduced height is mistaken for the runtime safe area.
  // Resolve against the same logical frame the runtime uses for the current
  // preview viewport, then apply the stage scale once. This keeps normalized
  // proportions identical on wide, short and embedded editor canvases.
  const editorViewportWidth = editorViewport.width;
  const editorViewportHeight = editorViewport.height;
  const authoredFrame = fitGameViewport({ width: editorViewportWidth, height: editorViewportHeight }, resolveGameViewport(viewport));
  const previewStageWidth = stageSize.width > 0 ? stageSize.width : authoredFrame.width * 0.75;
  const previewStageHeight = stageSize.height > 0 ? stageSize.height : authoredFrame.height * 0.75;
  const previewFrameScale = Math.min(
    previewStageWidth / authoredFrame.width,
    previewStageHeight / authoredFrame.height,
  );
  const quickMenuPresentation = resolveQuickMenuPresentation({
    layout: {
      rect: quickMenu ? getRect(quickMenu) : undefined,
      style: {
        ...quickMenu?.style,
        quickMenuVariant: "C",
        quickMenuDirection: "up",
      },
      actionStyle: quickMenuToggleButton?.style,
    },
    dialogRect: dialogPanel ? getRect(dialogPanel) : undefined,
    authoredFrame,
    dialogueTop: (dialogPanel ? getRect(dialogPanel).y : 70.6) / 100 * authoredFrame.height,
    viewport: { width: authoredFrame.width, height: authoredFrame.height },
    state: quickMenuExpanded ? "expanded" : "collapsed",
    // The editor uses the desktop-authored rect at every breakpoint, while
    // narrow preview windows must still use handheld touch/width metrics.
    mobile: editorViewportWidth < 900,
    // The resolver's safe-area fit is defined in the logical authored frame.
    // Rendering the preview into the stage is a separate, single scale.
    renderScale: previewFrameScale,
  });
  const quickMenuMetrics = quickMenuPresentation.actions;
  // The shared metrics already include the single uniform scale for this
  // authored frame. Do not apply a second stage/anchor scale here: that was
  // the source of preview/runtime position and proportion drift.
  const quickMenuPreviewScale = quickMenuMetrics.uniformScale;
  const quickMenuPreviewSize = (value: number) => value * quickMenuPreviewScale;
  const quickMenuPreviewSurfaceWidth = quickMenuPresentation.root.width;
  const quickMenuPreviewSurfaceHeight = quickMenuPresentation.root.height;
  const previewZIndex = (component: UILayoutComponent): number => {
    if (screenId === "title") {
      // The title surface has three intentional layers: hero content,
      // decorative masks, then interactive actions. A mask must cover the
      // title text as designed without intercepting the buttons above it.
      if (component.component_type === "main_menu_hero") return 10;
      if (component.component_type === "mask") return Math.min(Math.max(component.zIndex ?? 20, 20), 29);
      if (component.component_type === "main_menu_continue_button"
        || component.component_type === "main_menu_start_button"
        || component.component_type === "main_menu_save_load_button"
        || component.component_type === "main_menu_gallery_button"
        || component.component_type === "main_menu_settings_button"
        || component.component_type === "main_menu_about_button"
        || component.component_type === "main_menu_custom_button") {
        return Math.max(component.zIndex ?? 30, 30);
      }
    }
    return component.zIndex ?? 1;
  };
  const renderComponent = (component: UILayoutComponent, children?: ReactNode, extraStyle?: CSSProperties) => (
    <PreviewOpacitySurface
      key={component.component_id}
      className={`runtime-layout-page-part part-${component.component_type}${isBuiltinTitleButton(component) ? " is-title-text-button" : ""}`}
      data-preview-component-id={component.component_id}
      data-background-image-reference={component.style?.backgroundImage ?? ""}
      data-preview-authored-x={component.component_type === "quick_menu" ? getRect(component).x : undefined}
      data-preview-authored-y={component.component_type === "quick_menu" ? getRect(component).y : undefined}
      data-preview-authored-width={component.component_type === "quick_menu" ? getRect(component).width : undefined}
      data-preview-authored-height={component.component_type === "quick_menu" ? getRect(component).height : undefined}
      data-preview-authored-anchor={component.component_type === "quick_menu" ? getRect(component).anchor ?? "" : undefined}
        style={{
        ...(screenId === "player" && component.component_type === "quick_menu"
          ? {
              left: `${quickMenuPresentation.root.left}px`,
              top: `${quickMenuPresentation.root.top}px`,
              width: `${quickMenuPresentation.root.width}px`,
              height: `${quickMenuPresentation.root.height}px`,
            }
          : rectToStyle(getRect(component))),
        ...componentStyle(component, assetManifest),
        ...(isBuiltinTitleButton(component) ? {
          fontSize: (resolveTitleButtonStyle(component)?.fontSize ?? 18)
            * Math.min(1.55, Math.max(1, Math.min(authoredFrame.width / 1280, authoredFrame.height / 720)))
            * previewFrameScale,
        } : {}),
        ...(screenId === "player" && component.component_type === "quick_menu"
          ? {
              width: `${quickMenuPresentation.root.width}px`,
              height: `${quickMenuPresentation.root.height}px`,
              pointerEvents: "auto",
              overflow: "visible",
            }
          : {}),
        zIndex: component.component_type === "quick_menu"
          ? 100
          : component.component_type === "mask"
            ? Math.min(previewZIndex(component), 40)
            : previewZIndex(component),
        ...(component.component_type === "quick_menu" ? { pointerEvents: "auto" } : {}),
        ...extraStyle,
      }}
    >
      {children}
    </PreviewOpacitySurface>
  );
  const cards = Array.from({ length: 8 }, (_, index) => <i key={index} />);
  return (
    <div
      className={`runtime-layout-expected-preview is-${screenId}`}
      aria-hidden="true"
      data-preview-quick-menu-variant={screenId === "player" ? "C" : undefined}
      data-preview-quick-menu-state={screenId === "player" ? (quickMenuExpanded ? "expanded" : "collapsed") : undefined}
      data-preview-quick-menu-direction={screenId === "player" ? quickMenuMetrics.direction : undefined}
      data-preview-quick-menu-icon={screenId === "player" ? (quickMenuExpanded ? "close" : "expand") : undefined}
      data-preview-quick-menu-compact={screenId === "player" ? (quickMenuMetrics.compact ? "true" : "false") : undefined}
      data-preview-quick-menu-columns={screenId === "player" ? quickMenuMetrics.columns : undefined}
      data-preview-quick-menu-rows={screenId === "player" ? quickMenuMetrics.rows : undefined}
      data-preview-quick-menu-uniform-scale={screenId === "player" ? quickMenuMetrics.uniformScale : undefined}
    >
      <div className="runtime-layout-page-surface" style={screenId === "title" ? titleStyle : screenId === "player" ? sceneBackgroundStyle(scene, assetManifest) : undefined}>
        {screen.components.filter((component) => isLayoutEditableComponent(component) && !isStyleOnlyComponent(component) && !isCustomButtonContainer(component)).map((component) => {
          if (screenId === "preferences") {
            return renderComponent(component, <div className="preview-settings-card" style={component.component_type === "settings_group" ? settingsStyle : undefined}><span className="preview-tab-stack"><i /><i /><i /><i /></span><span className="preview-setting-rows"><i /><i /><i /></span></div>);
          }
          if (screenId === "player" && component.component_type === "dialog_text") return renderComponent(component, <><span className="preview-line wide" /><span className="preview-line" /></>);
          if (screenId === "player" && component.component_type === "choice_list") return renderComponent(component, <><span className="preview-choice" /><span className="preview-choice" /><span className="preview-choice" /></>);
          if (screenId === "player" && component.component_type === "quick_menu") {
            return renderComponent(component, (
              <div
                className="preview-quick-menu-preview preview-quick-menu-preview-c"
                data-preview-quick-button-count={quickButtons.length}
                data-preview-quick-menu-variant="C"
                data-preview-quick-menu-state={quickMenuExpanded ? "expanded" : "collapsed"}
                 data-preview-quick-menu-direction={quickMenuMetrics.direction}
                data-preview-quick-menu-icon={quickMenuExpanded ? "close" : "expand"}
                data-preview-quick-menu-compact={quickMenuMetrics.compact ? "true" : "false"}
                data-preview-quick-menu-columns={quickMenuMetrics.columns}
                data-preview-quick-menu-rows={quickMenuMetrics.rows}
                data-preview-quick-menu-uniform-scale={quickMenuMetrics.uniformScale}
                data-preview-quick-menu-toggle-cell-column={quickMenuMetrics.toggleCell.column}
                data-preview-quick-menu-toggle-cell-row={quickMenuMetrics.toggleCell.row}
                data-preview-quick-menu-surface-width={quickMenuMetrics.surfaceWidth}
                data-preview-quick-menu-surface-height={quickMenuMetrics.surfaceHeight}
                 data-preview-quick-menu-content-height={quickMenuMetrics.contentHeight}
                 data-preview-quick-menu-authored-frame-width={authoredFrame.width}
                 data-preview-quick-menu-authored-frame-height={authoredFrame.height}
                 data-preview-quick-menu-render-scale={previewFrameScale}
                 data-preview-quick-menu-scrollable={quickMenuPresentation.scrollable ? "true" : "false"}
                  style={{
                  // C is the full quick-menu container surface. A keeps its
                  // direction-specific rail geometry from CSS (especially the
                  // expanded vertical rail on short screens); forcing width,
                  // height and inset inline made A and C collapse to the same
                  // rectangle in the real designer preview.
                  width: `${quickMenuPreviewSurfaceWidth}px`,
                  height: `${quickMenuPreviewSurfaceHeight}px`,
                   left: `${quickMenuPresentation.root.left}px`,
                   right: "auto",
                   top: `${quickMenuPresentation.root.top}px`,
                   bottom: "auto",
                  "--preview-quick-menu-columns": quickMenuMetrics.columns,
                  "--preview-quick-menu-rows": quickMenuMetrics.rows,
                  "--preview-quick-menu-uniform-scale": quickMenuMetrics.uniformScale,
                  "--preview-quick-menu-action-visual-width": `${quickMenuMetrics.actionVisualWidth}px`,
                  "--preview-quick-menu-action-visual-height": `${quickMenuMetrics.actionVisualHeight}px`,
                  "--preview-quick-menu-surface-width": `${quickMenuPreviewSurfaceWidth}px`,
                  "--preview-quick-menu-surface-height": `${quickMenuPreviewSurfaceHeight}px`,
                   "--preview-quick-menu-toggle-visual-width": `${quickMenuMetrics.toggleVisualWidth}px`,
                   "--preview-quick-menu-toggle-visual-height": `${quickMenuMetrics.toggleVisualHeight}px`,
                   "--preview-quick-menu-toggle-expand-icon-size": `${quickMenuPreviewSize(33)}px`,
                   "--preview-quick-menu-toggle-close-icon-size": `${quickMenuPreviewSize(22)}px`,
                   "--preview-quick-menu-toggle-hit-size": `${quickMenuMetrics.toggleHitSize}px`,
                   "--preview-quick-menu-action-hit-size": `${quickMenuMetrics.actionHitSize}px`,
                   "--preview-quick-menu-cell-width": `${quickMenuMetrics.cellWidth}px`,
                   "--preview-quick-menu-cell-height": `${quickMenuMetrics.cellHeight}px`,
                   "--preview-quick-menu-toggle-cell-column": quickMenuMetrics.toggleCell.column,
                   "--preview-quick-menu-toggle-cell-row": quickMenuMetrics.toggleCell.row,
                   "--preview-quick-menu-expanded-width": `${quickMenuMetrics.expandedBounds.width}px`,
                   "--preview-quick-menu-expanded-height": `${quickMenuMetrics.expandedBounds.height}px`,
                   "--preview-quick-menu-content-height": `${quickMenuMetrics.contentHeight}px`,
                   "--preview-quick-menu-a-icon-size": `${quickMenuPreviewSize(22)}px`,
                   "--preview-quick-menu-gap": `${quickMenuMetrics.actionGap}px`,
                   "--preview-quick-menu-padding": `${quickMenuMetrics.surfacePadding}px`,
                   "--preview-quick-menu-toggle-gap": `${quickMenuMetrics.toggleGap}px`,
                  "--preview-quick-menu-c-leading-track": `${quickMenuPreviewSize(32)}px`,
                  "--preview-quick-menu-c-icon-track": `${quickMenuPreviewSize(46)}px`,
                  "--preview-quick-menu-c-icon-size": `${quickMenuPreviewSize(27)}px`,
                  "--preview-quick-menu-surface-radius": `${quickMenuPreviewSize(quickMenu?.style?.borderRadius ?? QUICK_MENU_DEFAULT_SURFACE_STYLE.borderRadius)}px`,
                  "--preview-quick-menu-surface-background": opaquePreviewColor(quickMenu?.style?.backgroundColor) ?? "var(--preview-runtime-quick-menu, var(--field))",
                  "--preview-quick-menu-surface-glass-background": `color-mix(in srgb, ${opaquePreviewColor(quickMenu?.style?.backgroundColor) ?? "var(--preview-runtime-quick-menu, var(--field))"} ${Math.round((quickMenu?.style?.opacity ?? QUICK_MENU_DEFAULT_SURFACE_STYLE.opacity) * 10_000) / 100}%, transparent)`,
                  "--preview-quick-menu-surface-border": quickMenu?.style?.borderColor ?? "var(--preview-runtime-line, var(--line))",
                  "--preview-quick-menu-surface-border-width": `${quickMenuPreviewSize(quickMenu?.style?.borderWidth ?? QUICK_MENU_DEFAULT_SURFACE_STYLE.borderWidth)}px`,
                  "--preview-quick-menu-surface-alpha": `${Math.round((quickMenu?.style?.opacity ?? QUICK_MENU_DEFAULT_SURFACE_STYLE.opacity) * 10_000) / 100}%`,
                  "--preview-quick-menu-surface-blur": `${quickMenuPreviewSize(quickMenu?.style?.backdropBlur ?? QUICK_MENU_DEFAULT_SURFACE_STYLE.backdropBlur)}px`,
                  "--preview-quick-menu-action-background": opaquePreviewColor(quickMenuToggleButton?.style?.backgroundColor) ?? "var(--preview-runtime-control, var(--field))",
                  "--preview-quick-menu-action-border": quickMenuToggleButton?.style?.borderColor ?? "var(--preview-runtime-line, var(--line))",
                  "--preview-quick-menu-action-alpha": `${Math.round((quickMenuToggleButton?.style?.opacity ?? QUICK_MENU_DEFAULT_ACTION_STYLE.opacity) * 10_000) / 100}%`,
                  "--preview-quick-menu-action-blur": `${quickMenuPreviewSize(quickMenuToggleButton?.style?.backdropBlur ?? QUICK_MENU_DEFAULT_ACTION_STYLE.backdropBlur)}px`,
                  "--preview-quick-menu-action-radius": `${quickMenuPreviewSize(quickMenuToggleButton?.style?.borderRadius ?? QUICK_MENU_DEFAULT_ACTION_STYLE.borderRadius)}px`,
                  "--preview-quick-menu-action-border-width": `${quickMenuPreviewSize(quickMenuToggleButton?.style?.borderWidth ?? QUICK_MENU_DEFAULT_ACTION_STYLE.borderWidth)}px`,
                  "--preview-quick-menu-action-color": quickMenuToggleButton?.style?.color ?? "var(--preview-runtime-control-text, var(--ink-strong))",
                  "--preview-runtime-quick-menu": previewQuickMenuBackground,
                  "--preview-runtime-control": previewControlBackground,
                  "--preview-runtime-control-text": previewControlText,
                  "--preview-runtime-line": previewLine,
                } as CSSProperties}
              >
                <div className="preview-quick-menu-toggle-layer">
                <button data-help-key="editor.control"
                  type="button"
                  className="preview-quick-menu-toggle"
                  data-preview-quick-menu-icon={quickMenuExpanded ? "close" : "expand"}
                  aria-label={quickMenuExpanded ? "收缩快捷菜单预览" : "展开快捷菜单预览"}
                  aria-expanded={quickMenuExpanded}
                  data-testid="preview-quick-menu-toggle"
                  onClick={onQuickMenuToggle}
                >
                  <span className={quickMenuExpanded ? "preview-quick-menu-toggle-icon preview-quick-menu-toggle-icon-expand" : "preview-quick-menu-toggle-icon preview-quick-menu-toggle-icon-expand is-visible"} aria-hidden="true">
                    <PreviewPrecisionIcon name="expand" size={33} />
                  </span>
                  <span className={quickMenuExpanded ? "preview-quick-menu-toggle-icon preview-quick-menu-toggle-icon-close is-visible" : "preview-quick-menu-toggle-icon preview-quick-menu-toggle-icon-close"} aria-hidden="true">
                    <PreviewPrecisionIcon name="close" size={20} />
                  </span>
                </button>
                </div>
                <div className="preview-quick-menu-surface" data-preview-quick-menu-surface="true">
                  <div
                    className="preview-quick-menu-action-layer"
                    style={{
                      opacity: quickMenuExpanded ? 1 : 0,
                      visibility: quickMenuExpanded ? "visible" : "hidden",
                      pointerEvents: quickMenuExpanded ? "auto" : "none",
                    }}
                  >
                    <div className="preview-quick-menu-buttons">
                      {quickButtons.map((button) => {
                        const iconName = quickButtonIconNames[button.component_id] ?? "menu";
                        const buttonImageOwned = Boolean(resolveUILayoutImagePreview(button.style?.backgroundImage, assetManifest).source);
                        return (
                          <button data-help-key="editor.control"
                            key={button.component_id}
                            type="button"
                            className={`preview-quick-menu-button${buttonImageOwned ? " is-image-owned" : ""}`}
                            data-preview-component-id={button.component_id}
                            data-preview-component-type="quick_button"
                            data-preview-frame-mode={buttonImageOwned ? "image_owned" : "default_frame"}
                            data-precision-icon={iconName}
                            aria-label={componentLabel(button)}
                            title={componentLabel(button)}
                            style={{
                              ...componentStyle(button, assetManifest),
                              "--preview-quick-menu-action-alpha": `${Math.round((button.style?.opacity ?? QUICK_MENU_DEFAULT_ACTION_STYLE.opacity) * 10_000) / 100}%`,
                              "--preview-quick-menu-action-blur": `${quickMenuPreviewSize(button.style?.backdropBlur ?? QUICK_MENU_DEFAULT_ACTION_STYLE.backdropBlur)}px`,
                              "--preview-quick-menu-action-radius": `${quickMenuPreviewSize(button.style?.borderRadius ?? QUICK_MENU_DEFAULT_ACTION_STYLE.borderRadius)}px`,
                              "--preview-quick-menu-action-border-width": `${quickMenuPreviewSize(button.style?.borderWidth ?? QUICK_MENU_DEFAULT_ACTION_STYLE.borderWidth)}px`,
                            } as CSSProperties}
                          >
                            <PreviewPrecisionIcon name={iconName} size={18} />
                            <span className="preview-quick-menu-button-label">{quickButtonDisplayLabels[button.component_id] ?? componentLabel(button)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ));
          }
          if (screenId === "player" && component.component_type === "stage_background") {
            return renderComponent(component, undefined, playerSceneStyle);
          }
          if (screenId === "save_load") return renderComponent(component, <span className="preview-card-grid">{cards}</span>);
          if (screenId === "gallery") return renderComponent(component, <span className="preview-gallery-grid">{cards}</span>);
          if (screenId === "history") return renderComponent(component, <span className="preview-history-list"><i /><i /><i /><i /></span>);
          if (screenId === "about") return renderComponent(component, <span className="preview-about-card"><i /><i /><i /><i /></span>);
          if (screenId === "game_menu") return renderComponent(component, <span className="preview-menu-strip"><i /><i /><i /><i /></span>);
          if (component.component_type === "main_menu_hero") {
            const heroStyle = { ...rectToStyle(getRect(component)), ...componentStyle(component, assetManifest) };
            const layers = resolveOpacitySurfaceStyles(heroStyle);
                const contentStyle: CSSProperties = {
                  ...heroStyle,
                  zIndex: 10,
              ...(heroStyle.backgroundImage || heroStyle.backgroundColor || heroStyle.background ? {
                backgroundColor: "transparent",
                backgroundImage: "none",
                backgroundSize: undefined,
                backgroundRepeat: undefined,
                backgroundPosition: undefined,
              } : {}),
            };
            return (
              <Fragment key={component.component_id}>
                <div
                  className="runtime-layout-page-part part-main_menu_hero-background"
                  data-preview-component-id={`${component.component_id}-background`}
                  style={{ ...heroStyle, ...(layers ? { opacity: layers.background.opacity } : {}),
                    zIndex: 1, pointerEvents: "none" }}
                />
                <div
                  className="runtime-layout-page-part part-main_menu_hero"
                  data-preview-component-id={component.component_id}
                  style={{ ...contentStyle, ...(layers ? { opacity: layers.content.opacity } : {}) }}
                >
                  <span className="preview-line wide" /><span className="preview-line" /><span className="preview-line short" />
                </div>
              </Fragment>
            );
          }
          if (isCustomButtonContainer(component) || (component.component_type === "main_menu_custom_button" && component.style?.backgroundImage)) return renderComponent(component);
          return renderComponent(component, <span className="preview-button-content">{componentLabel(component)}</span>);
        })}
      </div>
    </div>
  );
}

export function RuntimeLayoutDesigner({ sessionRef }: { sessionRef?: MutableRefObject<RuntimeLayoutDesignerSession> }) {
  const savedSkin = useProjectStore((state) => state.settings.runtimeUILayout);
  const projectId = useProjectStore((state) => state.projectId);
  const projectTitle = useProjectStore((state) => state.title);
  const projectAuthor = useProjectStore((state) => state.author);
  const characterDisplayNamesById = useProjectStore((state) => state.settings.characterDisplayNames);
  const characterDisplayNames = Object.values(characterDisplayNamesById);
  const layoutType = useProjectStore((state) => state.settings.runtimeUILayoutProfiles?.activeType ?? "agentvn");
  const workspaceDraft = readRuntimeLayoutWorkspaceDraft(projectId, layoutType, cloneSkin);
  const restoredDraft = workspaceDraft ?? (
    sessionRef?.current.projectId === projectId && sessionRef.current.layoutType === layoutType
      ? sessionRef.current.draft
      : undefined
  );
  const setRuntimeUILayout = useProjectStore((state) => state.setRuntimeUILayout);
  const setPackageAppearance = useProjectStore((state) => state.setPackageAppearance);
  const setAssetManifest = useProjectStore((state) => state.setAssetManifest);
  const assetManifest = useProjectStore((state) => state.assetManifest);
  const projectNodes = useEditorStore((state) => state.nodes);
  const selectedScene = useEditorStore((state) => state.nodes.find((node) => node.id === state.selectedNodeId)?.data.scene);
  const fontCoverageText = collectRenpyFontCoverageText(
    projectTitle, projectAuthor, characterDisplayNames, projectNodes,
  );
  const packageAppearance = useProjectStore((state) => state.settings.packageAppearance);
  const aboutFields = packageAppearance.about?.fields ?? defaultAboutFields;
  const [draft, setDraft] = useState<UISkinLayout>(() => cloneSkin(restoredDraft ?? savedSkin));
  const presentationPreview = useControlPresentationPreview(draft, projectId);
  const hasInvalidPresentation = layoutPresentationTargets(draft).some(target =>
    !compileControlPresentation(target.source).ok);
  const [history, setHistory] = useState<{ past: UISkinLayout[]; future: UISkinLayout[] }>({ past: [], future: [] });
  const layoutSessionRef = useRef((() => {
    const saved = createRuntimeLayoutSession(cloneSkin(savedSkin), projectId,
      cloneSkin, (left, right) => JSON.stringify(left) === JSON.stringify(right));
    return restoredDraft
      ? editRuntimeLayoutSession(saved, () => cloneSkin(restoredDraft))
      : saved;
  })());
  const [screenIds, setScreenIds] = useState<Partial<Record<RuntimeLayoutType, UILayoutScreenId>>>(() => {
    const saved = sessionRef?.current;
    if (saved?.screenIds) return saved.screenIds;
    return saved?.screenId ? { [saved.layoutType ?? "agentvn"]: saved.screenId } : {};
  });
  const screenId = resolveRuntimeLayoutEditorScreen(layoutType, screenIds[layoutType]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoomModes, setZoomModes] = useState<Partial<Record<RuntimeLayoutType, ZoomMode>>>(
    () => sessionRef?.current.zoomModes ?? {},
  );
  const [renpyPreviewModes, setRenpyPreviewModes] = useState<Partial<Record<RuntimeLayoutType, "desktop" | "mobile">>>(
    () => sessionRef?.current.renpyPreviewModes ?? {},
  );
  const zoom = zoomModes[layoutType] ?? "fit";
  const [showGrid, setShowGrid] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [showNames, setShowNames] = useState(true);
  const [snapGrid, setSnapGrid] = useState(true);
  const [snapEdges, setSnapEdges] = useState(true);
  const [snapCenter, setSnapCenter] = useState(true);
  const [snapSafe, setSnapSafe] = useState(true);
  const [snapGuides, setSnapGuides] = useState<Array<{ axis: "x" | "y"; kind: string; sourceId: string; linePx: number }>>([]);
  const [preset, setPreset] = useState<PresetId>("default");
  const [presetScope, setPresetScope] = useState<PresetScope>("current");
  const canApplyPreset = presetScope === "all" || screenId === "player";
  const [restoreAllConfirmation, setRestoreAllConfirmation] = useState<{ projectId: string } | null>(null);
  const restoreAllButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setRestoreAllConfirmation(null), [projectId]);
  const [showHealthDetails, setShowHealthDetails] = useState(false);
  const quickMenuPreviewVariant = "C" as const;
  const [quickMenuPreviewExpanded, setQuickMenuPreviewExpanded] = useState(() => sessionRef?.current.quickMenuExpanded ?? false);
  const [renpyPlayerRuntimePreview, setRenpyPlayerRuntimePreview] = useState(false);
  const [dialogueModes, setDialogueModes] = useState<Partial<Record<RuntimeLayoutType, DialogueLayoutMode>>>(
    () => sessionRef?.current.dialogueModes ?? {},
  );
  const dialogueMode = dialogueModes[layoutType] ?? "dialog";
  const designerRef = useRef<HTMLElement>(null);
  const revealRequested = useRef(false);
  const revealPanel = useRef<HTMLElement | null>(null);
  const [revealSequence, setRevealSequence] = useState(0);
  const cancelCodeReveal = useCallback(() => {
    const panel = revealPanel.current;
    if (panel?.isConnected) panel.scrollTo({ top: panel.scrollTop, behavior: "instant" });
    revealPanel.current = null;
  }, []);
  useLayoutEffect(() => {
    if (!revealRequested.current) return;
    revealRequested.current = false;
    if (layoutType !== "renpy" || !draft.advancedPresentationEnabled) return;
    // Only explicit enable requests reveal. Saving, typing, and a stored enabled
    // preference never refocus or scroll an unrelated page/control.
    const code = designerRef.current?.querySelector<HTMLElement>(".runtime-layout-inspector .renpy-control-code");
    const panel = code?.closest<HTMLElement>(".runtime-layout-inspector");
    const heading = code?.querySelector<HTMLElement>("h4");
    if (!code || !panel || !heading || code.closest("[inert]")) return;
    heading.focus({ preventScroll: true });
    const distance = code.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    panel.scrollTo({ top: Math.max(0, panel.scrollTop + distance - 12), behavior: "smooth" });
    revealPanel.current = panel;
    return cancelCodeReveal;
  }, [revealSequence, projectId, screenId, dialogueMode, layoutType, draft.advancedPresentationEnabled, cancelCodeReveal]);
  useEffect(() => cancelCodeReveal, [cancelCodeReveal, projectId, screenId, dialogueMode, layoutType]);
  const [confirmationPages, setConfirmationPages] = useState<Partial<Record<RuntimeLayoutType, boolean>>>(
    () => sessionRef?.current.confirmationPages ?? {},
  );
  const confirmationEditorActive = confirmationPages[layoutType] ?? false;
  const modeEditorActive = screenId === "player" && dialogueMode !== "dialog";
  const selectDialogueMode = (mode: DialogueLayoutMode) =>
    setDialogueModes(current => ({ ...current, [layoutType]: mode }));
  const [customButtonImageImport, setCustomButtonImageImport] = useState<CustomButtonImageImportState | undefined>();
  const [customButtonUrlTest, setCustomButtonUrlTest] = useState<CustomButtonUrlTestState | undefined>();
  const [layoutSaveState, setLayoutSaveState] = useState<LayoutSaveState>("idle");
  const [typeSwitching, setTypeSwitching] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [editorViewport, setEditorViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 720 : window.innerHeight,
  }));
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stageResizeObserverRef = useRef<ResizeObserver | null>(null);
  const stageSizeReadyRef = useRef(false);
  const pointerSessionCleanupRef = useRef<(() => void) | null>(null);
  const activeSnapRef = useRef<{ x?: unknown; y?: unknown }>({});
  const customButtonImageInputRef = useRef<HTMLInputElement | null>(null);
  const lastSavedSkinRef = useRef(savedSkin);
  const lastLayoutTypeRef = useRef(layoutType);
  const applySessionState = useCallback((next: ReturnType<typeof createRuntimeLayoutSession<UISkinLayout>>) => {
    layoutSessionRef.current = next;
    setDraft(next.draft);
    setHistory(next.history);
  }, []);
  const screen = getScreen(draft, screenId);
  const layoutComponents = screen.components.filter(component => (isLayoutEditableComponent(component)
    || (layoutType === "renpy" && component.component_type === "choice_option"))
    && !(layoutType === "renpy" && component.component_id === "quick_main_menu_button"));
  const selectedSource = layoutComponents.find((component) => component.component_id === selectedId) ?? layoutComponents[0];
  const selected = selectedSource ? { ...selectedSource, style: resolveTitleButtonStyle(selectedSource) } : undefined;
  const selectedIsStyleOnly = Boolean(selected && isStyleOnlyComponent(selected));
  const selectedRect = selected && !selectedIsStyleOnly ? getRect(selected) : undefined;
  const selectedIsFixedQuickMenu = selected?.component_type === "quick_menu";
  const activeIds = selectedIds.length > 0 ? selectedIds : selected ? [selected.component_id] : [];
  const isDirty = layoutSessionRef.current.dirty;
  const renpyStructuredPage = layoutType === "renpy" && (RENPY_NAVIGATION_PAGES as readonly string[]).includes(screenId);
  useEffect(() => {
    if (!renpyStructuredPage) recordLayoutHelpSelection(projectId, {
      layoutType, screenId, componentId: selected?.component_id,
      advanced: Boolean(draft.advancedPresentationEnabled),
    });
  }, [projectId, layoutType, screenId, selected?.component_id, draft.advancedPresentationEnabled, renpyStructuredPage]);
  const selectedIsCustomButton = selected?.component_type === "main_menu_custom_button";
  const selectedIsCustomButtonContainer = Boolean(selected && isCustomButtonContainer(selected));
  const selectedIsMask = selected?.component_type === "mask";
  const selectedRenpyPlayerDefaultStyle = layoutType === "renpy" && screenId === "player" && selected
    ? renpyPlayerDefaultStyleByComponent.get(selected.component_id)
    : undefined;
  const canRestoreRenpyPlayerDefaultStyle = Boolean(selectedRenpyPlayerDefaultStyle
    && !selectedIsCustomButton && !selectedIsCustomButtonContainer && !selectedIsMask
    && !selectedIsStyleOnly && !selectedIsFixedQuickMenu);
  const renpyPlayerStyleIsDefault = canRestoreRenpyPlayerDefaultStyle
    && stylesMatch(selected?.style, selectedRenpyPlayerDefaultStyle);
  const customButtonContainerLocked = Boolean(screen.components.find(isCustomButtonContainer)?.locked);
  const selectedLocked = Boolean(selected?.locked || (selectedIsCustomButton && customButtonContainerLocked));
  const selectedGeometryLocked = Boolean(selected && isGeometryLocked(selected, screen.components));
  const selectedBackgroundImageAssetId = assetIdForUILayoutImageReference(assetManifest, selected?.style?.backgroundImage);
  const selectedCustomButtonImageAssetId = selectedIsCustomButton
    ? selectedBackgroundImageAssetId
    : "";
  const selectedCustomButtonLabelIsBlank = selectedIsCustomButton && !(selected.label ?? "").trim();
  const selectedExternalUrlValidation = selected?.action?.kind === "external_url"
    ? validateExternalUrl(selected.action.url)
    : undefined;
  const selectedExternalUrlError = selectedExternalUrlValidation && !selectedExternalUrlValidation.ok
    ? externalUrlErrorMessages[selectedExternalUrlValidation.code]
    : undefined;
  const [layoutHealthSnapshot, setLayoutHealthSnapshot] = useState<{
    draft: UISkinLayout;
    assetManifest: AssetRef[];
    result: ReturnType<typeof validateUISkinHealth>;
  }>();
  const initialHealthValidationRef = useRef(true);
  useEffect(() => {
    let cancelled = false;
    let idleHandle: number | undefined;
    let deferHandle: number | undefined;
    let timeoutHandle: number | undefined;
    const validate = () => {
      idleHandle = undefined;
      timeoutHandle = undefined;
      if (cancelled) return;
      const result = validateUISkinHealth(draft, {
        availableAssetPaths: assetManifest
          .map((asset) => asset.metadata.path)
          .filter((path): path is string => Boolean(path)),
        availableAssetIds: assetManifest.map((asset) => asset.asset_id),
      });
      if (!cancelled) setLayoutHealthSnapshot({ draft, assetManifest, result });
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const isInitialValidation = initialHealthValidationRef.current;
    initialHealthValidationRef.current = false;
    const scheduleValidation = () => {
      if (cancelled) return;
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(validate, {
          // The first health scan is diagnostic and must not compete with
          // mounting the 4K layout canvas or its first interaction frame.
          timeout: isInitialValidation ? 600 : 240,
        });
      } else {
        timeoutHandle = window.setTimeout(validate, isInitialValidation ? 120 : 0);
      }
    };
    if (isInitialValidation) {
      // Let the page transition and the first stable canvas frame settle
      // before doing the synchronous layout/asset scan.
      deferHandle = window.setTimeout(scheduleValidation, 1200);
    } else {
      scheduleValidation();
    }
    return () => {
      cancelled = true;
      if (deferHandle !== undefined) window.clearTimeout(deferHandle);
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
  }, [assetManifest, draft]);
  const layoutHealth = layoutHealthSnapshot?.draft === draft
    && layoutHealthSnapshot.assetManifest === assetManifest
    ? layoutHealthSnapshot.result
    : undefined;
  const layoutHealthIssues = layoutHealth
    ? [...layoutHealth.errors, ...layoutHealth.warnings].filter((item) => (
      item.path?.startsWith(`ui.${screenId}.`) || item.path?.startsWith("ui.tokens.")
    ))
    : [];
  const layoutHealthErrorCount = layoutHealthIssues.filter((item) => item.severity === "error").length;
  const layoutHealthWarningCount = layoutHealthIssues.filter((item) => item.severity === "warning").length;
  const layoutHealthState = !layoutHealth
    ? "pending"
    : layoutHealthErrorCount > 0
      ? "error"
      : layoutHealthWarningCount > 0
        ? "warning"
        : "ok";
  const hasBlankCustomButtonLabel = draft.screens.some((item) => item.components.some(
    (component) => component.component_type === "main_menu_custom_button" && !(component.label ?? "").trim(),
  ));
  const hasInvalidCustomButtonAction = draft.screens.some((item) => item.components.some(
    (component) => component.component_type === "main_menu_custom_button"
      && component.action?.kind === "external_url"
      && !validateExternalUrl(component.action.url).ok,
  ));
  const viewportDesign = resolveGameViewport(draft.gameViewport);
  const zoomStyle: CSSProperties = {
    aspectRatio: String(viewportDesign.ratio),
    "--runtime-layout-aspect": String(viewportDesign.ratio),
    ...(zoom === "fit" ? { width: "min(100%, calc(100cqh * var(--runtime-layout-aspect)))" } : { width: `${760 * zoom}px` }),
  } as CSSProperties;
  const selectedVisualRect = selectedRect ? visualRect(selectedRect) : undefined;
  const selectedPixelRect = selectedVisualRect && stageSize.width > 0 ? {
    x: Math.round(stageSize.width * selectedVisualRect.x / 100),
    y: Math.round(stageSize.height * selectedVisualRect.y / 100),
    width: Math.round(stageSize.width * selectedVisualRect.width / 100),
    height: Math.round(stageSize.height * selectedVisualRect.height / 100),
  } : undefined;
  const setStageNode = useCallback((node: HTMLDivElement | null) => {
    stageResizeObserverRef.current?.disconnect();
    stageResizeObserverRef.current = null;
    stageRef.current = node;
    stageSizeReadyRef.current = false;
    if (!node) return;
    const commitSize = (width: number, height: number) => {
      if (stageRef.current !== node || !width || !height) return;
      const next = { width, height };
      stageSizeReadyRef.current = true;
      setStageSize((current) => (
        Math.abs(current.width - next.width) < 0.01 && Math.abs(current.height - next.height) < 0.01
          ? current
          : next
      ));
    };
    if (typeof ResizeObserver !== "undefined") {
      // Let the browser finish layout once and publish the content box.
      // A synchronous border-box read here flushes the entire new workbench
      // in the React commit, then the observer immediately measures it again.
      const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        commitSize(entry.contentRect.width, entry.contentRect.height);
      });
      observer.observe(node);
      stageResizeObserverRef.current = observer;
      // The destination workbench can already have its final grid track
      // during the React commit while ResizeObserver delivery is still
      // queued. Seed the preview from that current layout box so a morph
      // never renders one frame with the previous tab's authored scale.
      commitSize(node.clientWidth, node.clientHeight);
    } else {
      const initialRect = node.getBoundingClientRect();
      commitSize(initialRect.width, initialRect.height);
    }
  }, []);

  useEffect(() => {
    const updateViewport = () => {
      setEditorViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);
    const viewportObserver = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(updateViewport);
    viewportObserver?.observe(document.documentElement);
    return () => {
      window.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      viewportObserver?.disconnect();
    };
  }, []);
  const fontAssetOptions = useMemo(() => assetManifest
    .filter((asset) => asset.asset_type === "font")
    .map((asset) => ({ value: asset.asset_id, label: asset.metadata.display_name ?? asset.metadata.filename ?? asset.asset_id })),
    [assetManifest]);

  useEffect(() => {
    return () => {
      stageResizeObserverRef.current?.disconnect();
      pointerSessionCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!sessionRef) return;
    sessionRef.current = {
      projectId,
      layoutType,
      draft: cloneSkin(draft),
      screenId,
      screenIds: { ...screenIds },
      zoomModes: { ...zoomModes },
      renpyPreviewModes: { ...renpyPreviewModes },
      quickMenuExpanded: quickMenuPreviewExpanded,
      dialogueModes: { ...dialogueModes },
      confirmationPages: { ...confirmationPages },
    };
  }, [sessionRef, projectId, layoutType, draft, screenId, screenIds, zoomModes, renpyPreviewModes, quickMenuPreviewExpanded, dialogueModes, confirmationPages]);

  useEffect(() => {
    if (layoutSessionRef.current.projectKey !== projectId || lastLayoutTypeRef.current !== layoutType) return;
    if (layoutSessionRef.current.dirty) {
      writeRuntimeLayoutWorkspaceDraft(projectId, layoutType, draft, cloneSkin);
    } else {
      clearRuntimeLayoutWorkspaceDraft(projectId, layoutType);
    }
  }, [projectId, layoutType, draft, isDirty]);

  useEffect(() => {
    if (layoutSessionRef.current.projectKey !== projectId || lastLayoutTypeRef.current !== layoutType) {
      if (layoutSessionRef.current.projectKey !== projectId) setDialogueModes({});
      if (layoutSessionRef.current.projectKey !== projectId) setConfirmationPages({});
      const cachedDraft = readRuntimeLayoutWorkspaceDraft(projectId, layoutType, cloneSkin);
      const next = createRuntimeLayoutSession(cloneSkin(savedSkin), projectId, cloneSkin, (left, right) => JSON.stringify(left) === JSON.stringify(right));
      lastSavedSkinRef.current = savedSkin;
      lastLayoutTypeRef.current = layoutType;
      applySessionState(cachedDraft
        ? editRuntimeLayoutSession(next, () => cachedDraft)
        : next);
      setSelectedId("");
      setSelectedIds([]);
      setLayoutSaveState("idle");
      return;
    }
    if (lastSavedSkinRef.current === savedSkin) return;
    lastSavedSkinRef.current = savedSkin;
    // The save path already accepted this canonical snapshot into the
    // session. The store update that follows must not be treated as a new
    // external snapshot, otherwise the session layer would clear the
    // undo/redo timeline a second time.
    if (layoutSessionRef.current.equals(cloneSkin(savedSkin), layoutSessionRef.current.savedSnapshot)) return;
    const result = receiveRuntimeLayoutSnapshot(
      layoutSessionRef.current,
      cloneSkin(savedSkin),
      { projectKey: projectId },
    );
    if (!result.accepted) return;
    applySessionState(result.session);
    const next = result.session.draft;
    const nextScreen = getScreen(next, screenId);
    const nextLayoutComponents = nextScreen.components.filter(isLayoutEditableComponent);
    setSelectedId((current) => (
      nextLayoutComponents.some((component) => component.component_id === current)
        ? current
        : nextLayoutComponents[0]?.component_id ?? ""
    ));
    setSelectedIds((current) => {
      const available = new Set(nextLayoutComponents.map((component) => component.component_id));
      const retained = current.filter((id) => available.has(id));
      if (retained.length > 0) return retained;
      return nextLayoutComponents[0] ? [nextLayoutComponents[0].component_id] : [];
    });
  }, [applySessionState, projectId, layoutType, savedSkin, screenId]);

  useEffect(() => {
    if (isDirty && layoutSaveState === "saved") {
      setLayoutSaveState("idle");
    }
  }, [isDirty, layoutSaveState]);

  function updatePackageAppearance(partial: Partial<PackageAppearanceSettings>) {
    setPackageAppearance({ ...packageAppearance, ...partial });
  }

  function updateAboutCopy(partial: NonNullable<PackageAppearanceSettings["about"]>) {
    updatePackageAppearance({ about: { ...(packageAppearance.about ?? {}), ...partial } });
  }

  function updateAboutField(index: number, field: { label?: string; value?: string }) {
    const fields = [...aboutFields];
    fields[index] = { ...fields[index], ...field };
    updateAboutCopy({ fields });
  }

  function addAboutField() {
    updateAboutCopy({ fields: [...aboutFields, { label: "", value: "" }] });
  }

  function removeAboutField(index: number) {
    updateAboutCopy({ fields: aboutFields.filter((_, fieldIndex) => fieldIndex !== index) });
  }

  function commit(next: UISkinLayout) {
    applySessionState(editRuntimeLayoutSession(layoutSessionRef.current, () => next));
  }

  function commitUpdater(updater: (current: UISkinLayout) => UISkinLayout) {
    commit(updater(draft));
  }

  function selectScreen(next: UILayoutScreenId) {
    setConfirmationPages(current => ({ ...current, [layoutType]: false }));
    const nextScreen = getScreen(draft, next);
    const nextId = nextScreen.components.find(isLayoutEditableComponent)?.component_id ?? "";
    setScreenIds((current) => ({ ...current, [layoutType]: next }));
    setSelectedId(nextId);
    setSelectedIds(nextId ? [nextId] : []);
    if (next !== "player") setRenpyPlayerRuntimePreview(false);
  }

  function selectComponent(componentId: string, additive = false) {
    setSelectedId(componentId);
    setSelectedIds((current) => {
      if (!additive) return [componentId];
      return current.includes(componentId) ? current.filter((id) => id !== componentId) : [...current, componentId];
    });
  }

  function addCustomTitleButton() {
    if (screenId !== "title") return;
    const ensuredComponents = ensureCustomButtonContainer(screen.components);
    // Persist portable runtime colors, never editor-only CSS expressions.
    const component = createCustomTitleButton(ensuredComponents, normalizeUISkinLayoutForRuntime(draft).layout.tokens);
    commitUpdater((current) => updateScreenComponents(
      current,
      "title",
      (components) => syncCustomButtonContainer([...ensureCustomButtonContainer(components), component]),
    ));
    setSelectedId(component.component_id);
    setSelectedIds([component.component_id]);
  }

  function addMask() {
    const component = createDefaultMask(createUniqueMaskId(screen.components), `遮罩 ${screen.components.filter((item) => item.component_type === "mask").length + 1}`);
    commitUpdater((current) => updateScreenComponents(current, screenId, (components) => [component, ...components]));
    setSelectedId(component.component_id);
    setSelectedIds([component.component_id]);
  }

  function setSelectedCustomActionKind(kind: UILayoutActionKind) {
    if (!selected || !selectedIsCustomButton) return;
    setCustomButtonUrlTest((current) => current?.componentId === selected.component_id ? undefined : current);
    updateSelectedComponent((component) => ({
      ...component,
      action: kind === "external_url"
        ? {
            kind,
            url: component.action?.kind === "external_url" ? component.action.url : undefined,
            open_mode: "system_browser",
          }
        : { kind: "none" },
    }));
  }

  function setSelectedCustomExternalUrl(value: string) {
    if (!selected || selected.action?.kind !== "external_url") return;
    const normalizedUrl = normalizeExternalUrl(value);
    setCustomButtonUrlTest((current) => current?.componentId === selected.component_id ? undefined : current);
    updateSelectedComponent((component) => ({
      ...component,
      action: {
        kind: "external_url",
        url: normalizedUrl,
        open_mode: "system_browser",
      },
    }));
  }

  function normalizeSelectedCustomExternalUrl() {
    if (!selected || selected.action?.kind !== "external_url") return;
    const validation = validateExternalUrl(selected.action.url);
    if (validation.ok && validation.normalizedUrl !== selected.action.url) {
      setSelectedCustomExternalUrl(validation.normalizedUrl);
    }
  }

  async function testSelectedCustomExternalUrl() {
    if (!selected || selected.action?.kind !== "external_url") return;
    const validation = validateExternalUrl(selected.action.url);
    if (!validation.ok) return;
    const testedUrl = validation.normalizedUrl;
    if (!navigator.clipboard?.writeText) {
      setCustomButtonUrlTest({
        componentId: selected.component_id,
        status: "info",
        message: "链接已通过安全校验；当前环境不支持自动复制，请手动复制后在浏览器中测试。",
        testedUrl,
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(testedUrl);
      setCustomButtonUrlTest({
        componentId: selected.component_id,
        status: "success",
        message: "安全链接已复制，可粘贴到浏览器地址栏测试。",
        testedUrl,
      });
    } catch (error) {
      reportFrontendError("editor.runtime-layout", error, {
        operation: "copy-custom-button-url",
        componentId: selected.component_id,
      });
      setCustomButtonUrlTest({
        componentId: selected.component_id,
        status: "error",
        message: "链接已通过安全校验，但当前环境无法写入剪贴板；请手动复制地址。",
        testedUrl,
      });
    }
  }

  function deleteSelectedCustomButton() {
    if (!selected || !selectedIsCustomButton) return;
    const selectedIndex = screen.components.findIndex(
      (component) => component.component_id === selected.component_id,
    );
    const remaining = screen.components.filter(
      (component) => component.component_id !== selected.component_id,
    );
    const nextSelected = remaining[Math.min(Math.max(selectedIndex, 0), remaining.length - 1)];
    commitUpdater((current) => updateScreenComponents(
      current,
      screenId,
      (components) => syncCustomButtonContainer(components.filter(
        (component) => component.component_id !== selected.component_id,
      )),
    ));
    setSelectedId(nextSelected?.component_id ?? "");
    setSelectedIds(nextSelected ? [nextSelected.component_id] : []);
  }

  function deleteSelectedMask() {
    if (!selected || !selectedIsMask) return;
    const selectedIndex = screen.components.findIndex((component) => component.component_id === selected.component_id);
    const remaining = screen.components.filter((component) => component.component_id !== selected.component_id);
    const nextSelected = remaining[Math.min(Math.max(selectedIndex, 0), Math.max(remaining.length - 1, 0))];
    commitUpdater((current) => updateScreenComponents(current, screenId, (components) => components.filter((component) => component.component_id !== selected.component_id)));
    setSelectedId(nextSelected?.component_id ?? "");
    setSelectedIds(nextSelected ? [nextSelected.component_id] : []);
  }

  function updateSelectedComponent(updater: (component: UILayoutComponent) => UILayoutComponent) {
    if (!selected) return;
    commitUpdater((current) => updateComponent(current, screenId, selected.component_id, updater));
  }

  function setSelectedRect(rect: UILayoutRect) {
    if (!selected || selectedGeometryLocked) return;
    if (selectedIsCustomButtonContainer) {
      commitUpdater((current) => updateScreenComponents(
        current,
        screenId,
        (components) => translateCustomButtonContainer(components, rect.x, rect.y),
      ));
      return;
    }
    if (selectedIsCustomButton) {
      commitUpdater((current) => updateScreenComponents(
        current,
        screenId,
        (components) => fitCustomButtonContainer(
          components.map((component) => component.component_id === selected.component_id
            ? setRect(component, rect)
            : component),
        ),
      ));
      return;
    }
    updateSelectedComponent((component) => setRect(component, rect));
  }

  function setSelectedStyle(style: Partial<UILayoutComponentStyle>) {
    updateSelectedComponent((component) => layoutType === "renpy" ? {
      ...component,
      ...(isBuiltinTitleButton(component) ? { titleButtonStyleSource: "layout" as const } : {}),
      style: cleanStyle({ ...component.style, ...style }),
    } : editUILayoutComponentStyle(component, style));
  }

  function restoreSelectedRenpyPlayerDefaultStyle() {
    if (!selected || !canRestoreRenpyPlayerDefaultStyle || !selectedRenpyPlayerDefaultStyle) return;
    updateSelectedComponent((component) => ({
      ...component,
      style: Object.keys(selectedRenpyPlayerDefaultStyle).length
        ? structuredClone(selectedRenpyPlayerDefaultStyle)
        : undefined,
    }));
  }

  function setSelectedBackgroundImage(assetId: string) {
    updateSelectedComponent((component) => {
      const backgroundImage = assetId ? toUILayoutAssetReference(assetId) : undefined;
      const currentFit = component.style?.backgroundFit;
      const backgroundFit = backgroundImage && isArtworkImageComponent(component)
        ? isProportionalArtworkFit(currentFit) ? currentFit : "contain"
        : currentFit;
      return editUILayoutComponentStyle(component, { backgroundImage, backgroundFit });
    });
  }

  async function importCustomButtonImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selected || !selectedIsCustomButton || selectedLocked) return;
    const componentId = selected.component_id;
    const validation = validateImportedUIImageFile(file);
    if (!validation.ok) {
      setCustomButtonImageImport({
        componentId,
        status: "error",
        message: validation.message,
      });
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const latestAssets = useProjectStore.getState().assetManifest;
      const asset = createImportedUIImageAsset(
        file,
        dataUrl,
        new Set(latestAssets.map((item) => item.asset_id)),
      );
      setAssetManifest([asset, ...latestAssets]);
      commitUpdater((current) => updateComponent(current, "title", componentId, (component) => ({
        ...component,
         style: cleanStyle({
           ...(component.style ?? {}),
           backgroundImage: toUILayoutAssetReference(asset.asset_id),
           backgroundFit: isProportionalArtworkFit(component.style?.backgroundFit)
             && Boolean(component.style?.backgroundImage)
             ? component.style?.backgroundFit
             : "contain",
         }),
      })));
      setCustomButtonImageImport({
        componentId,
        status: "success",
        message: `已导入并绑定 ${asset.metadata.filename ?? asset.asset_id}。`,
        asset,
      });
    } catch (error) {
      reportFrontendError("editor.layout", error, { operation: "import-button-image", componentId });
      setCustomButtonImageImport({
        componentId,
        status: "error",
        message: error instanceof Error ? error.message : "导入图片失败。",
      });
    }
  }

  function updateSelectedComponentRectField(field: keyof Pick<UILayoutRect, "x" | "y" | "width" | "height">, value: number) {
    if (!selectedRect) return;
    setSelectedRect({ ...selectedRect, [field]: value });
  }

  function beginPointerSession(
    target: HTMLElement,
    pointerId: number,
    onMove: (event: PointerEvent, updateDraft: (updater: (current: UISkinLayout) => UISkinLayout) => void) => void,
  ) {
    pointerSessionCleanupRef.current?.();
    const gestureStart = layoutSessionRef.current;
    let closed = false;

    function updateDraft(updater: (current: UISkinLayout) => UISkinLayout) {
      const current = layoutSessionRef.current;
      if (current.projectKey !== gestureStart.projectKey) {
        cleanup();
        return;
      }
      // Every move is relative to the pointer-down snapshot. Keep one undo
      // entry per gesture, while retaining any in-flight save metadata.
      applySessionState(editRuntimeLayoutSession({
        ...current,
        draft: gestureStart.draft,
        history: gestureStart.history,
      }, updater));
    }

    function cleanup() {
      if (closed) return;
      closed = true;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      window.removeEventListener("blur", cleanup);
      target.removeEventListener("lostpointercapture", handleLostCapture);
      if (pointerSessionCleanupRef.current === cleanup) {
        pointerSessionCleanupRef.current = null;
      }
      activeSnapRef.current = {};
      setSnapGuides([]);
      try {
        if (target.hasPointerCapture?.(pointerId)) {
          target.releasePointerCapture?.(pointerId);
        }
      } catch {
        // error-log-ignore: The browser may have already released capture after pointerup/pointercancel.
      }
    }

    function handleMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      onMove(moveEvent, updateDraft);
    }

    function handleEnd(endEvent: PointerEvent) {
      if (endEvent.pointerId !== pointerId) return;
      cleanup();
    }

    function handleLostCapture(lostEvent: PointerEvent) {
      if (lostEvent.pointerId !== pointerId) return;
      cleanup();
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    window.addEventListener("blur", cleanup);
    target.addEventListener("lostpointercapture", handleLostCapture);
    pointerSessionCleanupRef.current = cleanup;

    try {
      target.setPointerCapture?.(pointerId);
    } catch {
      // error-log-ignore: Window listeners still provide a complete mouse fallback when capture is unavailable.
    }
  }

  function startDrag(component: UILayoutComponent, event: ReactPointerEvent<HTMLButtonElement>) {
    selectComponent(component.component_id, event.ctrlKey || event.metaKey);
    if (isGeometryLocked(component, screen.components)) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = getRect(component);
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    const movingGroupId = isCustomButtonContainer(component)
      || component.component_type === "main_menu_custom_button" ? "title-custom" : undefined;
    const peers = screen.components
      .filter((item) => !isStyleOnlyComponent(item) && item.component_type !== "quick_menu")
      .map((item) => ({
        id: item.component_id,
        rect: getRect(item),
        visible: item.visible !== false,
        locked: Boolean(item.locked),
        groupId: isCustomButtonContainer(item) || item.component_type === "main_menu_custom_button" ? "title-custom" : undefined,
      }));
    activeSnapRef.current = {};
    beginPointerSession(target, pointerId, (moveEvent, updateDraft) => {
      const bounds = stage.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const dx = ((moveEvent.clientX - startX) / bounds.width) * 100;
      const dy = ((moveEvent.clientY - startY) / bounds.height) * 100;
      const desired = clampAnchorPosition(rect, rect.x + dx, rect.y + dy);
      const snapped = snapLayoutRect({ ...rect, x: desired.x, y: desired.y }, {
        frame: { width: bounds.width, height: bounds.height },
        toggles: { grid: snapGrid, edges: snapEdges, center: snapCenter, safe: snapSafe },
        frameSafeInsets: SNAP_SAFE_INSETS_PERCENT,
        gridStepPercent: SNAP_GRID_STEP_PERCENT,
        thresholdPx: SNAP_THRESHOLD_PX,
        releaseThresholdPx: SNAP_RELEASE_THRESHOLD_PX,
        activeSnap: activeSnapRef.current,
        peers,
        movingId: component.component_id,
        movingGroupId,
      });
      activeSnapRef.current = snapped.activeSnap;
      setSnapGuides(snapped.guides);
      const target = clampAnchorPosition(rect, snapped.rect.x, snapped.rect.y);
      updateDraft((current) => updateScreenComponents(current, screenId, (components) => {
        if (isCustomButtonContainer(component)) {
          return translateCustomButtonContainer(components, target.x, target.y);
        }
        const next = components.map((item) => item.component_id === component.component_id
          ? setRect(item, { ...rect, x: target.x, y: target.y })
          : item);
        return component.component_type === "main_menu_custom_button"
          ? fitCustomButtonContainer(next)
          : next;
      }));
    });
  }

  function startResize(component: UILayoutComponent, event: ReactPointerEvent<HTMLSpanElement>) {
    event.stopPropagation();
    if (isGeometryLocked(component, screen.components) || isCustomButtonContainer(component)) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = getRect(component);
    const visual = visualRect(rect);
    const factor = anchorFactor(rect.anchor);
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    const peers = screen.components
      .filter((item) => !isStyleOnlyComponent(item) && item.component_type !== "quick_menu")
      .map((item) => ({
        id: item.component_id,
        rect: getRect(item),
        visible: item.visible !== false,
        locked: Boolean(item.locked),
        groupId: isCustomButtonContainer(item) || item.component_type === "main_menu_custom_button" ? "title-custom" : undefined,
      }));
    activeSnapRef.current = {};
    beginPointerSession(target, pointerId, (moveEvent, updateDraft) => {
      const bounds = stage.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const pointerX = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      const pointerY = ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
      const width = Math.max(2, Math.min(100 - visual.x, pointerX - visual.x));
      const height = Math.max(2, Math.min(100 - visual.y, pointerY - visual.y));
      const desired = {
        ...rect,
        x: roundLayoutValue(visual.x + width * factor.x),
        y: roundLayoutValue(visual.y + height * factor.y),
        width: roundLayoutValue(width),
        height: roundLayoutValue(height),
      };
      const snapped = snapLayoutRect(desired, {
        frame: { width: bounds.width, height: bounds.height },
        toggles: { grid: snapGrid, edges: snapEdges, center: snapCenter, safe: snapSafe },
        frameSafeInsets: SNAP_SAFE_INSETS_PERCENT,
        gridStepPercent: SNAP_GRID_STEP_PERCENT,
        thresholdPx: SNAP_THRESHOLD_PX,
        releaseThresholdPx: SNAP_RELEASE_THRESHOLD_PX,
        activeSnap: activeSnapRef.current,
        peers,
        movingId: component.component_id,
        movingGroupId: undefined,
        mode: "resize",
      });
      activeSnapRef.current = snapped.activeSnap;
      setSnapGuides(snapped.guides);
      updateDraft((current) => updateScreenComponents(current, screenId, (components) => {
        const next = components.map((item) => item.component_id === component.component_id
          ? setRect(item, snapped.rect)
          : item);
        return component.component_type === "main_menu_custom_button"
          ? fitCustomButtonContainer(next)
          : next;
      }));
    });
  }

  function align(action: string) {
    const targets = alignableComponents(screen.components, activeIds, action);
    if (targets.length < minimumAlignmentTargets(action) || !hasDistributionSpace(targets, action)) return;
    commitUpdater((current) => updateScreenComponents(current, screenId, (components) => {
      // A selected group is one geometry object; its children move with it.
      const targets = alignableComponents(components, activeIds, action);
      if (targets.length < minimumAlignmentTargets(action) || !hasDistributionSpace(targets, action)) return components;
      const group = targets.find(isCustomButtonContainer);
      const rects = new Map<string, UILayoutRect>();
      if (action === "sameWidth" || action === "sameHeight") {
        const dimension = action === "sameWidth" ? "width" : "height";
        const size = getRect(targets[0])[dimension];
        for (const component of targets) {
          const rect = { ...getRect(component), [dimension]: size };
          rects.set(component.component_id, { ...rect, ...clampAnchorPosition(rect, rect.x, rect.y) });
        }
      } else if (action === "distributeX" || action === "distributeY") {
        const axis = action === "distributeX" ? "x" : "y";
        const dimension = action === "distributeX" ? "width" : "height";
        const sorted = [...targets].sort((a, b) => visualRect(getRect(a))[axis] - visualRect(getRect(b))[axis]);
        const first = visualRect(getRect(sorted[0]));
        const last = visualRect(getRect(sorted[sorted.length - 1]));
        const total = sorted.reduce((sum, component) => sum + getRect(component)[dimension], 0);
        const gap = (last[axis] + last[dimension] - first[axis] - total) / (sorted.length - 1);
        let position = first[axis];
        for (const component of sorted) {
          const rect = getRect(component);
          rects.set(component.component_id, {
            ...rect, [axis]: roundLayoutValue(position + rect[dimension] * anchorFactor(rect.anchor)[axis]),
          });
          position += rect[dimension] + gap;
        }
      } else {
        for (const component of targets) {
          const rect = getRect(component);
          const factor = anchorFactor(rect.anchor);
          let next = rect;
          if (action === "left") next = { ...rect, x: roundLayoutValue(5 + rect.width * factor.x) };
          if (action === "right") next = { ...rect, x: roundLayoutValue(95 - rect.width * (1 - factor.x)) };
          if (action === "top") next = { ...rect, y: roundLayoutValue(5 + rect.height * factor.y) };
          if (action === "bottom") next = { ...rect, y: roundLayoutValue(95 - rect.height * (1 - factor.y)) };
          if (action === "centerX") next = { ...rect, x: roundLayoutValue(50 + rect.width * (factor.x - 0.5)) };
          if (action === "centerY") next = { ...rect, y: roundLayoutValue(50 + rect.height * (factor.y - 0.5)) };
          rects.set(component.component_id, next);
        }
      }
      const groupRect = group && rects.get(group.component_id);
      const moved = groupRect ? translateCustomButtonContainer(components, groupRect.x, groupRect.y) : components;
      const next = moved.map((component) => {
        const rect = rects.get(component.component_id);
        return rect && !isCustomButtonContainer(component) ? setRect(component, rect) : component;
      });
      return targets.some((component) => component.component_type === "main_menu_custom_button")
        ? fitCustomButtonContainer(next) : next;
    }));
  }

  function applyPreset() {
    if (!canApplyPreset) return;
    const presetSkin = cloneSkin(getDefaultUISkinLayout());
    commitUpdater((current) => ({
      ...current,
      screens: current.screens.map((screen) => {
        if (screen.screen_id !== "player") return screen;
        const presetScreen = getScreen(presetSkin, screen.screen_id);
        return {
          ...screen,
          components: screen.components.map((component) => {
            if (component.locked || !playerPresetComponentIds.has(component.component_id)) return component;
            const presetComponent = presetScreen.components.find((item) =>
              item.component_id === component.component_id && item.component_type === component.component_type);
            if (!presetComponent?.rect) return component;
            return {
              ...component,
              rect: { ...(playerPresetRects[preset]?.[component.component_id] ?? presetComponent.rect) },
            };
          }),
        };
      }),
      name: presetLabels[preset],
    }));
  }

  function restoreCurrentPage() {
    commitUpdater((current) => restoreRuntimeLayoutPage(current, screenId));
  }

  function repairDialogue() {
    commitUpdater(repairRuntimeDialogueLayout);
  }

  async function saveLayout() {
    if (layoutSaveState === "saving" || hasInvalidPresentation) return;
    const saveStarted = beginRuntimeLayoutSave(layoutSessionRef.current);
    applySessionState(saveStarted.session);
    const runtimeUILayout = migrateLegacyUISkinLayout(cloneSkin(saveStarted.request.draft));
    const projectState = useProjectStore.getState();
    const editorState = useEditorStore.getState();
    setLayoutSaveState("saving");
    try {
      await backendClient.saveProjectState({
        project_graph: {
          nodes: editorState.nodes,
          edges: editorState.edges,
          viewport: editorState.viewport,
          memoryMode: editorState.memoryMode,
        },
        project_metadata: {
          projectId: projectState.projectId,
          title: projectState.title,
          author: projectState.author,
          createdAt: projectState.createdAt,
          updatedAt: new Date().toISOString(),
          assetManifest: projectState.assetManifest,
          settings: {
            ...projectState.settings,
            ...updateActiveRuntimeUILayout(projectState.settings, runtimeUILayout),
          },
        },
      }, { onPersisted: (persistedState) => {
        if (useProjectStore.getState().projectId !== saveStarted.request.projectKey) return;
        const persistedSettings = persistedState.project_metadata?.settings;
        const persistedLayout = persistedSettings
          ? resolveRuntimeUILayoutSettings(persistedSettings).runtimeUILayout
          : runtimeUILayout;
        const canonicalLayout = persistedLayout && typeof persistedLayout === "object"
          ? migrateLegacyUISkinLayout(persistedLayout as UISkinLayout)
          : runtimeUILayout;
        const received = receiveRuntimeLayoutSnapshot(
          layoutSessionRef.current,
          canonicalLayout,
          {
            projectKey: saveStarted.request.projectKey,
            requestId: saveStarted.request.requestId,
            version: saveStarted.request.version,
          },
        );
        if (!received.accepted) {
          setLayoutSaveState("idle");
          return;
        }
        if (!received.session.dirty) {
          clearRuntimeLayoutWorkspaceDraft(projectId, layoutType);
        }
        applySessionState(received.session);
        setRuntimeUILayout(canonicalLayout);
        setLayoutSaveState("saved");
      } });
    } catch (error) {
      const isCurrentProject = useProjectStore.getState().projectId === saveStarted.request.projectKey;
      if (!isCurrentProject) return;
      layoutSessionRef.current = failRuntimeLayoutSave(layoutSessionRef.current, saveStarted.request.requestId);
      reportFrontendError("editor.project", error, {
        operation: "save-runtime-layout",
        projectId: projectState.projectId,
      });
      setLayoutSaveState("error");
    }
  }

  function undo() {
    applySessionState(undoRuntimeLayoutSession(layoutSessionRef.current));
  }

  function redo() {
    applySessionState(redoRuntimeLayoutSession(layoutSessionRef.current));
  }

  async function switchLayoutType(type: RuntimeLayoutType, saveDraft: boolean) {
    if (typeSwitching || layoutSaveState === "saving") return;
    const project = useProjectStore.getState();
    const editor = useEditorStore.getState();
    const startingType = project.settings.runtimeUILayoutProfiles?.activeType ?? "agentvn";
    const source = saveDraft
      ? updateActiveRuntimeUILayout(project.settings, layoutSessionRef.current.draft)
      : resolveRuntimeUILayoutSettings(project.settings);
    const next = switchRuntimeUILayoutType(source, type);
    setTypeSwitching(true);
    try {
      await backendClient.saveProjectState({
        project_graph: { nodes: editor.nodes, edges: editor.edges, viewport: editor.viewport, memoryMode: editor.memoryMode },
        project_metadata: {
          projectId: project.projectId, title: project.title, author: project.author,
          createdAt: project.createdAt, updatedAt: new Date().toISOString(), assetManifest: project.assetManifest,
          settings: { ...project.settings, ...next },
        },
      }, { onPersisted: (persistedState) => {
        const current = useProjectStore.getState();
        if (current.projectId !== project.projectId
          || (current.settings.runtimeUILayoutProfiles?.activeType ?? "agentvn") !== startingType) return;
        const accepted = resolveRuntimeUILayoutSettings(persistedState.project_metadata.settings ?? next);
        if (accepted.runtimeUILayoutProfiles.activeType !== type) {
          throw new Error("LAYOUT_SWITCH_NOT_PERSISTED: 后端未确认目标布局，原布局与草稿保持不变。");
        }
        clearRuntimeLayoutWorkspaceDraft(project.projectId, startingType);
        current.setRuntimeUILayoutProfiles(accepted.runtimeUILayoutProfiles);
        applySessionState(createRuntimeLayoutSession(cloneSkin(accepted.runtimeUILayout), projectId,
          cloneSkin, (left, right) => JSON.stringify(left) === JSON.stringify(right)));
        setRenpyPlayerRuntimePreview(false);
        setLayoutSaveState("saved");
      } });
    } finally {
      setTypeSwitching(false);
    }
  }

  return (
    <section
      ref={designerRef}
      className="runtime-layout-designer"
      onPointerDownCapture={cancelCodeReveal}
      onWheelCapture={cancelCodeReveal}
      onKeyDownCapture={cancelCodeReveal}
      inert={typeSwitching}
      data-layout-type={layoutType}
      data-game-aspect-ratio={viewportDesign.aspectRatio}
      data-active-screen={screenId}
      data-active-dialogue-mode={screenId === "player" ? dialogueMode : undefined}
      data-renpy-editor={renpyStructuredPage ? screenId : undefined}
      aria-busy={typeSwitching}
      data-advanced-tab-ready={renpyStructuredPage || modeEditorActive || (stageSize.width > 0 && stageSize.height > 0) ? "true" : "false"}
    >
      <header className="runtime-layout-header">
        <div>
          <h3>游戏客户端</h3>
        </div>
        <div className="row-actions">
          <RuntimeLayoutTypeControls key={projectId} activeType={layoutType} dirty={isDirty}
            disabled={layoutSaveState === "saving" || typeSwitching}
            canSave={!hasBlankCustomButtonLabel && !hasInvalidCustomButtonAction && !hasInvalidPresentation}
            advancedEnabled={Boolean(draft.advancedPresentationEnabled)}
            onAdvancedChange={enabled => {
              cancelCodeReveal();
              revealRequested.current = enabled;
              setRevealSequence(value => value + 1);
              commitUpdater(current => ({ ...current, advancedPresentationEnabled: enabled }));
            }}
            onSwitch={switchLayoutType} />
          <RichSelect<GameAspectRatio> value={viewportDesign.aspectRatio}
            ariaLabel="画面比例" variant="compact"
            helpTitle="游戏画面比例" helpText="窗口和设备保留此比例，空余区域留边；控件位置相对于游戏画面。"
            disabled={layoutSaveState === "saving" || typeSwitching}
            options={GAME_ASPECT_RATIOS.map(value => ({ value, label: value }))}
            onChange={aspectRatio => commitUpdater(current => ({ ...current, gameViewport: { aspectRatio } }))} />
          <button type="button" data-help-key="layout.undo" onClick={undo} disabled={history.past.length === 0}><Undo2 size={16} /> 撤销</button>
          <button type="button" data-help-key="layout.redo" onClick={redo} disabled={history.future.length === 0}><Redo2 size={16} /> 重做</button>
          <GlassSelectionGroup className={`runtime-layout-zoom-switch${renpyStructuredPage ? " is-placeholder" : ""}`}
            selectedKey={String(zoom)} ariaLabel="画布缩放">
            {(["fit", 0.5, 0.75, 1] as ZoomMode[]).map((item) => (
              <button key={String(item)} type="button" data-help-key="layout.zoom"
                className={zoom === item ? "is-active" : ""} data-glass-selected={zoom === item}
                tabIndex={renpyStructuredPage ? -1 : undefined} aria-hidden={renpyStructuredPage || undefined}
                disabled={renpyStructuredPage}
                onClick={() => setZoomModes((current) => ({ ...current, [layoutType]: item }))}>
                {item === "fit" ? "适应" : `${Number(item) * 100}%`}
              </button>
            ))}
          </GlassSelectionGroup>
          <button
            type="button"
            data-help-key="layout.save"
            data-save-state={layoutSaveState}
            className={isDirty ? "is-primary" : ""}
            disabled={hasBlankCustomButtonLabel || hasInvalidCustomButtonAction || hasInvalidPresentation || layoutSaveState === "saving" || typeSwitching}
            aria-busy={layoutSaveState === "saving"}
            title={
              hasBlankCustomButtonLabel
                ? "请先填写所有自定义按钮的文字"
                : hasInvalidCustomButtonAction
                  ? "请先修正所有自定义按钮的外部链接"
                  : undefined
            }
            onClick={() => void saveLayout()}
          >
            <Save size={16} /> {layoutSaveState === "saving"
              ? "正在保存"
              : layoutSaveState === "error"
                ? "重试保存"
                : "保存布局"}
          </button>
          <span
            className={`runtime-layout-save-feedback is-${layoutSaveState}${layoutSaveState === "idle" ? " is-placeholder" : ""}`}
            role={layoutSaveState === "idle" ? undefined : layoutSaveState === "error" ? "alert" : "status"}
            aria-live={layoutSaveState === "idle" ? undefined : "polite"}
            aria-hidden={layoutSaveState === "idle" || undefined}
          >
            {layoutSaveState === "saving"
              ? "正在写入工程"
              : layoutSaveState === "saved"
                ? "布局已保存"
                : layoutSaveState === "error"
                  ? "保存失败，请重试"
                  : "\u00a0"}
          </span>
        </div>
      </header>

      {!renpyStructuredPage && <div className="runtime-layout-toolbar" inert={modeEditorActive}
        aria-disabled={modeEditorActive || undefined}>
        <details className="runtime-layout-menu"><summary>对齐</summary><div className="runtime-layout-menu-grid">{(Object.keys(alignmentLabels) as Array<keyof typeof alignmentLabels>).map((item) => {
          const required = minimumAlignmentTargets(item);
          const targets = alignableComponents(screen.components, activeIds, item);
          const insufficientSpace = !hasDistributionSpace(targets, item);
          const unavailable = targets.length < required || insufficientSpace;
          const reason = insufficientSpace ? "选中组件之间空间不足，无法生成非负间距"
            : required === 3 ? "请选中至少三个可调整组件"
            : required === 2 ? "请选中至少两个可调整组件" : "请选中可调整组件";
          return <button key={item} type="button" data-help-key="layout.align" disabled={unavailable} title={unavailable ? reason : undefined} onClick={() => align(item)}>{alignmentLabels[item]}</button>;
        })}<p className="runtime-layout-menu-note" role="note">{alignableComponents(screen.components, activeIds, "left").length === 0
          ? "请先选中可调整组件；系统固定或锁定组件不可对齐。"
          : "单项可对齐；等宽/等高需选 2 项，等距需选 3 项。"}</p></div></details>
        <details className="runtime-layout-menu"><summary>吸附</summary><div className="runtime-layout-menu-stack">{([["layout.snapGrid", snapGrid, setSnapGrid], ["layout.snapEdges", snapEdges, setSnapEdges], ["layout.snapCenter", snapCenter, setSnapCenter], ["layout.snapSafe", snapSafe, setSnapSafe]] as const).map(([key, value, setter]) => <label key={key}><input type="checkbox" checked={value} data-help-key={key} onChange={(event) => setter(event.target.checked)} /> {snappingLabels[key]}</label>)}</div></details>
        <details className="runtime-layout-menu"><summary>视图</summary><div className="runtime-layout-menu-stack"><label><input type="checkbox" checked={showGrid} data-help-key="layout.showGrid" onChange={(event) => setShowGrid(event.target.checked)} /> 显示网格</label><label><input type="checkbox" checked={showSafeArea} data-help-key="layout.showSafeArea" onChange={(event) => setShowSafeArea(event.target.checked)} /> 显示安全区</label><label><input type="checkbox" checked={showNames} data-help-key="layout.showNames" onChange={(event) => setShowNames(event.target.checked)} /> 显示名称</label></div></details>
        <details className="runtime-layout-menu wide">
          <summary>预设</summary>
          <div className="runtime-layout-menu-stack">
            <RichSelect value={preset} ariaLabel="布局预设" helpKey="layout.preset" variant="compact" options={Object.entries(presetLabels).map(([value, label]) => ({ value, label }))} onChange={(value) => setPreset(value as PresetId)} />
            <RichSelect value={presetScope} ariaLabel="预设页面范围" helpKey="layout.preset" variant="compact" options={[{ value: "current", label: "当前页面" }, { value: "all", label: "全部页面" }]} onChange={(value) => setPresetScope(value as PresetScope)} />
            <p className="runtime-layout-menu-note" role="note">{canApplyPreset
              ? "预设仅支持播放页几何；其他页面、主题及用户素材保持不变。"
              : `预设仅支持播放页；当前是${screenLabels[screenId]}，请切换到播放页或选择全部页面。`}</p>
            <button type="button" data-help-key="layout.applyPreset" disabled={!canApplyPreset} onClick={applyPreset}>应用预设</button>
            <button type="button" data-help-key="layout.repairDialog" onClick={repairDialogue}><RotateCw size={15} /> 修复对白布局</button>
            <button type="button" data-help-key="layout.restoreCurrent" onClick={restoreCurrentPage}><RotateCw size={15} /> 恢复当前页面</button>
            <button type="button" ref={restoreAllButtonRef} data-help-key="layout.restoreAll" onClick={() => setRestoreAllConfirmation({ projectId })}><RotateCw size={15} /> 恢复所有页面布局</button>
          </div>
        </details>
      </div>}

      <OperationResultDialog
        open={restoreAllConfirmation?.projectId === projectId}
        tone="warning"
        label="布局范围确认"
        title="恢复所有页面的内置布局？"
        message="将恢复所有页面中未锁定内置组件的位置、尺寸和锚点，不受当前页面或预设范围影响。保留自定义组件、遮罩、文字、动作、主题、材质与素材，固定快捷菜单不变。可一步撤销；点击“保存布局”后才写入工程。"
        icon={<RotateCw size={20} />}
        confirmLabel="取消"
        suppressHoverHelp
        closeAriaLabel="取消恢复布局"
        returnFocusRef={restoreAllButtonRef}
        onDismiss={() => setRestoreAllConfirmation(null)}
        contextAction={{
          label: "确认恢复所有页面",
          onClick: () => {
            if (restoreAllConfirmation?.projectId !== projectId) return;
            commitUpdater(restoreAllRuntimeLayoutPages);
            setRestoreAllConfirmation(null);
            restoreAllButtonRef.current?.focus();
          },
        }}
      />

      {confirmationEditorActive ? <ConfirmationLayoutEditor draft={draft} previewDraft={presentationPreview} assets={assetManifest}
        onAssets={setAssetManifest}
        mobile={(renpyPreviewModes[layoutType] ?? "desktop") === "mobile"}
        onChange={next => commitUpdater(() => next)} onPages={() => selectScreen("title")} />
        : renpyStructuredPage ? <RenpyTitleEditor draft={draft} previewDraft={presentationPreview} title={projectTitle}
        fontCoverageText={fontCoverageText}
        page={screenId as RenpyNavigationPage} onPage={selectScreen}
        previewMode={renpyPreviewModes.renpy ?? "desktop"}
        onPreviewMode={(mode) => setRenpyPreviewModes((current) => ({ ...current, renpy: mode }))}
        backgroundFit={packageAppearance.titleBackgroundFit ?? "stretch"}
        backgroundDimming={packageAppearance.titleBackgroundDimming ?? 0.18}
        backgroundUrl={resolveUILayoutImagePreview(
          packageAppearance.titleBackgroundAssetId ? `asset:${packageAppearance.titleBackgroundAssetId}` : undefined,
          assetManifest,
        ).source}
        onChange={(next) => commitUpdater(() => next)}
        onAssets={(nextAssets) => useProjectStore.getState().setAssetManifest(nextAssets)}
        assets={assetManifest}
        onApplyGuiImport={(nextLayout, nextAssets) => {
          commitUpdater(() => nextLayout);
          useProjectStore.getState().setAssetManifest(nextAssets);
        }}
        onConfirmation={() => setConfirmationPages(current => ({ ...current, [layoutType]: true }))}
        onOtherPages={() => selectScreen("player")} /> : modeEditorActive
          ? <DialogueModeLayoutEditor key={`${projectId}:${layoutType}:${dialogueMode}`} draft={draft} previewDraft={presentationPreview}
            onAssets={setAssetManifest} mode={dialogueMode}
            onMode={selectDialogueMode} onChange={next => commitUpdater(() => next)}
            onOrdinaryPage={() => selectScreen("title")}
            mobile={(renpyPreviewModes[layoutType] ?? "desktop") === "mobile"} assets={assetManifest} />
          : <div className="runtime-layout-grid">
        <GlassSelectionGroup as="aside" className="runtime-layout-sidebar" selectedKey={screenId}>
          <strong>页面</strong>
          {screenId === "player" && <RichSelect ariaLabel="对白布局模式" value={dialogueMode}
            options={[...DIALOGUE_LAYOUT_MODES]}
            onChange={value => selectDialogueMode(value as DialogueLayoutMode)} />}
          <div className="runtime-layout-screen-list">
            {screenOrder.filter(id => layoutType === "renpy" || id !== "game_menu")
              .map((id) => <button type="button" key={id} className={id === screenId ? "is-active" : ""} data-glass-selected={id === screenId} data-help-key="layout.screen" onClick={() => selectScreen(id)}>{screenLabels[id]}</button>)}
          </div>
          <button type="button" onClick={() => setConfirmationPages(current => ({ ...current, [layoutType]: true }))}>
            确认提示
          </button>
          <div className="runtime-layout-component-heading">
            <strong className="runtime-layout-side-heading"><Layers size={15} /> 组件</strong>
            <div className="runtime-layout-add-component-actions">
              <button
                type="button"
                className="runtime-layout-add-component"
                data-help-key="layout.addMask"
                aria-label="添加遮罩"
                onClick={addMask}
              >
                <Plus size={15} />
                <span>添加遮罩</span>
              </button>
              {screenId === "title" && (
                <button
                  type="button"
                  className="runtime-layout-add-component"
                  data-help-key="layout.addCustomButton"
                  aria-label="添加自定义标题按钮"
                  onClick={addCustomTitleButton}
                >
                  <Plus size={15} />
                  <span>添加按钮</span>
                </button>
              )}
            </div>
          </div>
          <div className="runtime-layout-component-list">
            {layoutComponents.map((component) => <label key={component.component_id} className={component.component_id === selected?.component_id ? "is-active" : ""} data-component-id={component.component_id} data-style-only={isStyleOnlyComponent(component) ? "true" : undefined}><input type="checkbox" disabled={isStyleOnlyComponent(component)} checked={selectedIds.includes(component.component_id)} data-help-key="layout.component" data-component-id={component.component_id} onChange={() => selectComponent(component.component_id, true)} /><button type="button" data-help-key="layout.component" data-component-id={component.component_id} onClick={(event) => selectComponent(component.component_id, event.ctrlKey || event.metaKey)}><span>{componentLabel(component)}</span><small>{isStyleOnlyComponent(component) ? "按钮样式" : `层级 ${component.zIndex ?? 0}`}</small></button></label>)}
          </div>
        </GlassSelectionGroup>

        <div className="runtime-layout-center">
          {screenId === "player" && (
            <div className="runtime-quick-menu-preview-controls" data-testid="runtime-quick-menu-preview-controls">
              <span>快捷菜单预览（固定位置与尺寸）</span>
              <button type="button"
                data-testid="renpy-player-runtime-preview-toggle"
                aria-pressed={renpyPlayerRuntimePreview}
                onClick={() => setRenpyPlayerRuntimePreview((value) => !value)}>
                {layoutType === "renpy" ? renpyPlayerRuntimePreview ? "返回控件编辑" : "体验实际交互"
                  : renpyPlayerRuntimePreview ? "返回布局画布" : "实际 Runtime 预览"}
              </button>
              <div className="runtime-quick-menu-preview-control-group" aria-label="预览状态" data-preview-quick-menu-state-controls>
                <button data-help-key="editor.control"
                  type="button"
                  className={!quickMenuPreviewExpanded ? "is-active" : ""}
                  aria-pressed={!quickMenuPreviewExpanded}
                  data-preview-quick-menu-state="collapsed"
                  onClick={() => setQuickMenuPreviewExpanded(false)}
                >
                  收缩
                </button>
                <button data-help-key="editor.control"
                  type="button"
                  className={quickMenuPreviewExpanded ? "is-active" : ""}
                  aria-pressed={quickMenuPreviewExpanded}
                  data-preview-quick-menu-state="expanded"
                  onClick={() => setQuickMenuPreviewExpanded(true)}
                >
                  展开
                </button>
              </div>
            </div>
          )}
          {screenId === "player" && (layoutType === "renpy" || renpyPlayerRuntimePreview)
            ? <RenpyRuntimePreview draft={presentationPreview} page="player"
              choicePreview={selected?.component_type === "choice_option" || selected?.component_type === "choice_list"}
              onSelectControl={layoutType === "renpy" && !renpyPlayerRuntimePreview ? id => selectComponent(id, false) : undefined}
              mobile={(renpyPreviewModes.renpy ?? "desktop") === "mobile"} fitToStage />
            : <div className={`runtime-layout-stage-wrap${showGrid ? "" : " no-grid"}${showSafeArea ? "" : " no-safe"}${showNames ? "" : " no-names"}`}>
            <div className="runtime-layout-stage" ref={setStageNode} style={zoomStyle}>
              <RuntimeLayoutExpectedPreview
                screenId={screenId}
                screen={screen}
                assetManifest={assetManifest}
                packageAppearance={packageAppearance}
                themeTokens={draft.tokens}
                viewport={draft.gameViewport}
                scene={selectedScene}
                quickMenuExpanded={quickMenuPreviewExpanded}
                stageSize={stageSize}
                editorViewport={editorViewport}
                onQuickMenuToggle={() => setQuickMenuPreviewExpanded((current) => !current)}
              />
              <div className="runtime-layout-safe-zone" />
              {snapGuides.map((guide, index) => (
                <div
                  key={`${guide.axis}-${guide.kind}-${guide.sourceId}-${index}`}
                  className={`runtime-layout-snap-guide is-${guide.axis} is-${guide.kind}`}
                  data-snap-guide-axis={guide.axis}
                  data-snap-guide-kind={guide.kind}
                  data-snap-guide-source={guide.sourceId}
                  style={guide.axis === "x"
                    ? { left: `${stageSize.width ? guide.linePx / stageSize.width * 100 : 0}%` }
                    : { top: `${stageSize.height ? guide.linePx / stageSize.height * 100 : 0}%` }}
                />
              ))}
              {layoutComponents.map((component) => {
                const styleOnly = isStyleOnlyComponent(component);
                const maskComponent = component.component_type === "mask";
                const quickMenuComponent = component.component_type === "quick_menu";
                const rect = styleOnly ? quickButtonPreviewRect(screen, component) : getRect(component);
                const previewOwnsInteraction = screenId === "player" && (styleOnly || quickMenuComponent);
                const overlayStyle: CSSProperties = previewOwnsInteraction || styleOnly || quickMenuComponent
                  ? {
                      ...rectToStyle(rect),
                      backgroundColor: "transparent",
                      backgroundImage: "none",
                      border: 0,
                      boxShadow: "none",
                      color: "transparent",
                      opacity: 1,
                      zIndex: previewOwnsInteraction ? 0 : 52,
                      pointerEvents: "none",
                    }
                  : {
                      ...rectToStyle(rect),
                      ...componentStyle(component, assetManifest),
                      zIndex: selectedIds.includes(component.component_id)
                        ? 60
                        : maskComponent && screenId === "title"
                          ? Math.min(Math.max(component.zIndex ?? 20, 20), 29)
                          : maskComponent
                            ? Math.min(component.zIndex ?? 1, 40)
                            : component.zIndex,
                      pointerEvents: maskComponent ? "auto" : undefined,
                    };
                return (
                  <button key={component.component_id} type="button" className={`runtime-layout-block${selectedIds.includes(component.component_id) ? " is-selected" : ""}${component.locked ? " is-locked" : ""}${component.visible === false ? " is-hidden" : ""}${isCustomButtonContainer(component) ? " is-custom-button-container" : ""}${styleOnly ? " is-style-only" : ""}${maskComponent ? " is-mask" : ""}`} style={overlayStyle} data-help-key="layout.component" data-component-id={component.component_id} data-component-type={component.component_type} data-auto-size={isCustomButtonContainer(component) ? "true" : undefined} data-action-kind={component.action?.kind ?? ""} data-action-url={component.action?.kind === "external_url" ? component.action.url ?? "" : ""} data-background-image-reference={component.style?.backgroundImage ?? ""} onClick={(event) => {
                    // Pointer selection already happened on pointerdown. Only
                    // keyboard activation and non-draggable blocks select here.
                    if (event.detail === 0 || styleOnly || previewOwnsInteraction) {
                      selectComponent(component.component_id, event.ctrlKey || event.metaKey);
                    }
                  }} onPointerDown={styleOnly || previewOwnsInteraction ? undefined : (event) => startDrag(component, event)}>
                    {!styleOnly && !quickMenuComponent && <Move size={14} />} {!styleOnly && !quickMenuComponent && <span className="runtime-layout-block-label">{componentLabel(component)}</span>}{isGeometryLocked(component, screen.components) && !styleOnly && !quickMenuComponent && <Lock size={13} />}{component.visible === false && <EyeOff size={13} />}{!styleOnly && !quickMenuComponent && !isGeometryLocked(component, screen.components) && !isCustomButtonContainer(component) && selectedIds.includes(component.component_id) && <span className="runtime-layout-resize-handle" onPointerDown={(event) => startResize(component, event)} />}
                  </button>
                );
              })}
            </div>
          </div>
          }
        </div>

        <aside className="runtime-layout-inspector">
          {screenId === "player" && <details><summary>头像位置</summary><DialogPortraitLayoutEditor draft={draft}
            onChange={next => commitUpdater(() => next)} /></details>}
          {layoutType === "renpy" && screenId === "player" && <details><summary>共享快捷栏样式</summary><RenpyButtonRoleEditor draft={draft}
            page="player" onChange={(next) => commitUpdater(() => next)} /></details>}
          {selected ? <>
            <header><strong>{componentLabel(selected)}</strong><small>{selectedIsStyleOnly ? "快捷按钮样式" : "布局组件"}</small></header>
            {layoutType === "renpy" && <RenpyControlAppearanceEditor key={`${screenId}:${selected.component_id}`}
              component={selected} assets={assetManifest} advancedEnabled={draft.advancedPresentationEnabled}
              onStyle={setSelectedStyle}
              onStateStyle={(state, patch) => updateSelectedComponent(component => ({
                ...component, stateStyles: { ...component.stateStyles, [state]: cleanStyle({ ...component.stateStyles?.[state], ...patch }) },
              }))}
              onImport={(asset, patch) => {
                setAssetManifest([asset, ...useProjectStore.getState().assetManifest]);
                setSelectedStyle(patch);
              }} />}
            {layoutType === "renpy" && draft.advancedPresentationEnabled && <ControlPresentationEditor
              component={selected} onChange={presentation => updateSelectedComponent(component => ({ ...component, presentation }))} />}
            {selectedRect && <details className="runtime-layout-fieldset" open={layoutType !== "renpy"}>
              <summary>位置与尺寸</summary>
              {(["x", "y", "width", "height"] as const).map((field) => {
                const autoSizedField = selectedIsCustomButtonContainer && (field === "width" || field === "height");
                return <label key={field}>{field}<div className="runtime-layout-input-pair"><RangeControl disabled={selectedGeometryLocked || autoSizedField || selectedIsFixedQuickMenu} ariaLabel={`${field} slider`} value={selectedRect[field]} min={field === "width" || field === "height" ? 2 : 0} max={100} step={1} helpKey="layout.rect" onChange={(value) => updateSelectedComponentRectField(field, value)} /><input disabled={selectedGeometryLocked || autoSizedField || selectedIsFixedQuickMenu} type="number" value={selectedRect[field]} min={field === "width" || field === "height" ? 2 : 0} max={100} data-help-key="layout.rect" onChange={(event) => updateSelectedComponentRectField(field, Number(event.target.value))} /></div></label>;
              })}
              {selectedIsCustomButtonContainer && (
                <div className="runtime-layout-auto-size-note" role="note">
                  <strong>自动撑大容器</strong>
                  <span>拖动容器或编辑 x / y 可整体移动按钮；宽度和高度会根据内部按钮自动计算。</span>
                </div>
              )}
              <label>锚点<RichSelect disabled={selectedGeometryLocked || selectedIsCustomButtonContainer || selectedIsFixedQuickMenu} ariaLabel="布局锚点" value={selectedRect.anchor ?? ""} options={anchorLabels} helpKey="layout.anchor" onChange={(anchor) => setSelectedRect(applyCanvasAnchorPreset(selectedRect, anchor ? anchor as UILayoutAnchor : undefined))} /></label>
              <div className="runtime-layout-pixel-readout" data-help-key="layout.pixelPreview"><strong>当前画布像素</strong><span>{selectedPixelRect ? `x ${selectedPixelRect.x}px / y ${selectedPixelRect.y}px / ${selectedPixelRect.width} x ${selectedPixelRect.height}px` : "等待画布测量"}</span></div>
            </details>}
            {selectedIsStyleOnly && (
              <div className="runtime-layout-auto-size-note" role="note" data-testid="quick-button-style-note">
                <strong>快捷按钮样式</strong>
                <span>这里可以调整按钮颜色、圆角、透明度和图案，按钮位置会随快捷菜单一起变化。</span>
              </div>
            )}
            {selectedIsFixedQuickMenu && (
              <div className="runtime-layout-auto-size-note" role="note" data-testid="quick-menu-fixed-note">
                <strong>快捷菜单为系统固定组件</strong>
                <span>位置、尺寸、锚点和展开方向由游戏客户端统一管理；此处仅可编辑材质。</span>
              </div>
            )}
            {!selected.required && !selectedIsCustomButton && !selectedIsCustomButtonContainer
              && !selectedIsMask && !selectedIsStyleOnly && !selectedIsFixedQuickMenu && (
              <label className="runtime-layout-custom-toggle">
                <input
                  type="checkbox"
                  data-testid="runtime-layout-component-visible"
                  checked={selected.visible !== false}
                  disabled={selectedLocked}
                  onChange={(event) => updateSelectedComponent((component) => ({
                    ...component,
                    visible: event.currentTarget.checked,
                  }))}
                />
                <span>
                  <strong>在玩家端显示</strong>
                  <small>关闭后区域仍保留在设计器中，玩家端不显示。</small>
                </span>
              </label>
            )}
            {selectedIsMask && (
              <details className="runtime-layout-fieldset runtime-layout-mask-fieldset" open>
                <summary>遮罩外观</summary>
                <label>
                  遮罩模式
                  <RichSelect
                    disabled={selectedLocked}
                    ariaLabel="遮罩模式"
                    value={selected.style?.maskMode ?? "blur"}
                    helpKey="layout.mask.mode"
                    options={[
                      { value: "blur", label: "高斯模糊" },
                      { value: "solid", label: "纯色不透明" },
                      { value: "image", label: "背景图" },
                    ]}
                    onChange={(maskMode) => setSelectedStyle({
                      maskMode: maskMode as UILayoutComponentStyle["maskMode"],
                      backdropBlur: maskMode === "blur" ? (selected.style?.backdropBlur ?? 12) : 0,
                    })}
                  />
                </label>
                <label>
                  背景颜色
                  <div className="runtime-layout-color-row">
                    <input data-help-key="editor.control" disabled={selectedLocked} type="color" value={selected.style?.backgroundColor?.startsWith("#") ? selected.style.backgroundColor : "#0d121f"} onChange={(event) => setSelectedStyle({ backgroundColor: event.target.value })} />
                    <input data-help-key="editor.control" disabled={selectedLocked} value={selected.style?.backgroundColor ?? ""} onChange={(event) => setSelectedStyle({ backgroundColor: event.target.value || undefined })} />
                  </div>
                </label>
                {(selected.style?.maskMode ?? "blur") === "blur" && (
                  <label>
                    背景模糊
                    <div className="runtime-layout-input-pair">
                      <RangeControl disabled={selectedLocked} ariaLabel="背景模糊" min={0} max={48} step={1} value={Number(selected.style?.backdropBlur ?? 12)} helpKey="layout.mask.blur" onChange={(value) => setSelectedStyle({ backdropBlur: value })} />
                      <input data-help-key="editor.control" disabled={selectedLocked} type="number" min={0} max={48} value={Number(selected.style?.backdropBlur ?? 12)} onChange={(event) => setSelectedStyle({ backdropBlur: Math.max(0, Math.min(48, Number(event.target.value))) })} />
                    </div>
                  </label>
                )}
                <label>
                  不透明度
                  <div className="runtime-layout-input-pair">
                    <RangeControl disabled={selectedLocked} ariaLabel="遮罩不透明度" min={0.1} max={1} step={0.05} value={Number(selected.style?.opacity ?? 1)} helpKey="layout.mask.opacity" onChange={(value) => setSelectedStyle({ opacity: value })} />
                    <input data-help-key="editor.control" disabled={selectedLocked} type="number" min={0.1} max={1} step={0.05} value={Number(selected.style?.opacity ?? 1)} onChange={(event) => setSelectedStyle({ opacity: Math.max(0.1, Math.min(1, Number(event.target.value))) })} />
                  </div>
                </label>
                {(selected.style?.maskMode ?? "blur") === "image" && (
                  <>
                    <AssetPicker
                      label="遮罩背景图"
                      field="style.backgroundImage"
                      value={selectedBackgroundImageAssetId}
                      allowedTypes={["ui", "background"]}
                      helpKey="layout.mask.image"
                      emptyLabel="暂无可用遮罩背景图"
                      placeholder="不使用背景图"
                      variant="inline"
                      disabled={selectedLocked}
                      className="runtime-layout-mask-image"
                      onChange={setSelectedBackgroundImage}
                    />
                    <label>
                      背景图适配
                      <RichSelect
                        disabled={selectedLocked}
                        ariaLabel="遮罩背景图适配"
                        value={selected.style?.backgroundFit ?? "cover"}
                        options={backgroundFitOptions}
                        helpKey="layout.mask.imageFit"
                        onChange={(backgroundFit) => setSelectedStyle({ backgroundFit })}
                      />
                    </label>
                  </>
                )}
                <label>
                  圆角
                  <div className="runtime-layout-input-pair">
                    <RangeControl disabled={selectedLocked} ariaLabel="遮罩圆角" min={0} max={96} step={1} value={Number(selected.style?.borderRadius ?? 12)} helpKey="layout.mask.radius" onChange={(value) => setSelectedStyle({ borderRadius: value })} />
                    <input data-help-key="editor.control" disabled={selectedLocked} type="number" min={0} max={96} value={Number(selected.style?.borderRadius ?? 12)} onChange={(event) => setSelectedStyle({ borderRadius: Math.max(0, Math.min(96, Number(event.target.value))) })} />
                  </div>
                </label>
                <label>
                  边框颜色
                  <div className="runtime-layout-color-row">
                    <input data-help-key="editor.control" disabled={selectedLocked} type="color" value={selected.style?.borderColor?.startsWith("#") ? selected.style.borderColor : "#ffffff"} onChange={(event) => setSelectedStyle({ borderColor: event.target.value })} />
                    <input data-help-key="editor.control" disabled={selectedLocked} value={selected.style?.borderColor ?? ""} onChange={(event) => setSelectedStyle({ borderColor: event.target.value || undefined })} />
                  </div>
                </label>
                <label>
                  边框宽度
                  <div className="runtime-layout-input-pair">
                    <RangeControl disabled={selectedLocked} ariaLabel="遮罩边框宽度" min={0} max={8} step={1} value={Number(selected.style?.borderWidth ?? 1)} helpKey="layout.mask.borderWidth" onChange={(value) => setSelectedStyle({ borderWidth: value })} />
                    <input data-help-key="editor.control" disabled={selectedLocked} type="number" min={0} max={8} value={Number(selected.style?.borderWidth ?? 1)} onChange={(event) => setSelectedStyle({ borderWidth: Math.max(0, Math.min(8, Number(event.target.value))) })} />
                  </div>
                </label>
                <label>
                  阴影
                  <RichSelect
                    disabled={selectedLocked}
                    ariaLabel="遮罩阴影"
                    value={selected.style?.shadow ?? "soft"}
                    options={[{ value: "none", label: "无" }, { value: "soft", label: "柔和" }, { value: "strong", label: "强烈" }]}
                    helpKey="layout.mask.shadow"
                    onChange={(shadow) => setSelectedStyle({ shadow: shadow as UILayoutComponentStyle["shadow"] })}
                  />
                </label>
                <label className="runtime-layout-custom-toggle">
                  <input data-help-key="editor.control" type="checkbox" disabled={selectedLocked} checked={selected.visible !== false} onChange={(event) => updateSelectedComponent((component) => ({ ...component, visible: event.target.checked }))} />
                  <span><strong>显示遮罩</strong><small>关闭后只在设计器中保留，不会出现在客户端。</small></span>
                </label>
                <div className="runtime-layout-danger-zone">
                  <span><strong>删除遮罩</strong><small>仅删除当前遮罩，不影响其他页面或交互控件。</small></span>
                  <button type="button" className="runtime-layout-delete-button" data-help-key="layout.mask.delete" onClick={deleteSelectedMask}><Trash2 size={15} /> 删除</button>
                </div>
              </details>
            )}
            {selectedIsCustomButton && (
              <details className="runtime-layout-fieldset runtime-layout-custom-button-fieldset" open>
                <summary>自定义按钮</summary>
                <label>
                  按钮文字
                  <input
                    disabled={selectedLocked}
                    value={selected.label ?? ""}
                    data-help-key="layout.customButton.label"
                    aria-invalid={selectedCustomButtonLabelIsBlank}
                    aria-describedby={selectedCustomButtonLabelIsBlank ? "custom-button-label-error" : undefined}
                    onChange={(event) => updateSelectedComponent((component) => ({
                      ...component,
                      label: event.target.value,
                    }))}
                  />
                </label>
                {selectedCustomButtonLabelIsBlank && (
                  <p
                    id="custom-button-label-error"
                    className="runtime-layout-field-error"
                    data-testid="custom-button-label-error"
                    role="alert"
                  >
                    按钮文字不能为空；填写后才能保存布局。
                  </p>
                )}
                <label className="runtime-layout-custom-toggle">
                  <input
                    type="checkbox"
                    checked={selected.visible !== false}
                    data-help-key="layout.customButton.visible"
                    onChange={(event) => updateSelectedComponent((component) => ({
                      ...component,
                      visible: event.target.checked,
                    }))}
                  />
                  <span>
                    <strong>在玩家端显示</strong>
                    <small>关闭后仍保留在设计器中，并以半透明隐藏态标记。</small>
                  </span>
                </label>
                <label>
                  按钮行为
                  <RichSelect
                    ariaLabel="自定义按钮行为"
                    value={selected.action?.kind ?? "none"}
                    helpKey="layout.customButton.actionKind"
                    options={[
                      { value: "none", label: "无操作" },
                      { value: "external_url", label: "打开外部链接" },
                    ]}
                    onChange={(kind) => setSelectedCustomActionKind(kind as UILayoutActionKind)}
                  />
                </label>
                {selected.action?.kind === "external_url" && (
                  <div className="runtime-layout-external-url-editor">
                    <label>
                      外部链接
                      <input
                        disabled={selectedLocked}
                        value={selected.action.url ?? ""}
                        placeholder="https://example.com"
                        inputMode="url"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        data-help-key="layout.customButton.externalUrl"
                        aria-invalid={Boolean(selectedExternalUrlError)}
                        aria-describedby={selectedExternalUrlError ? "custom-button-url-error" : undefined}
                        onChange={(event) => setSelectedCustomExternalUrl(event.target.value)}
                        onBlur={normalizeSelectedCustomExternalUrl}
                      />
                    </label>
                    {selectedExternalUrlError && (
                      <p
                        id="custom-button-url-error"
                        className="runtime-layout-field-error"
                        data-testid="custom-button-url-error"
                        role="alert"
                      >
                        {selectedExternalUrlError}
                      </p>
                    )}
                    <div className="runtime-layout-external-url-actions">
                      <button
                        type="button"
                        disabled={selectedLocked || !selectedExternalUrlValidation?.ok}
                        data-help-key="layout.customButton.testExternalUrl"
                        onClick={() => void testSelectedCustomExternalUrl()}
                      >
                        <Copy size={14} />
                        安全复制测试链接
                      </button>
                      <small>仅校验并复制 http:// 或 https:// 地址，不直接执行未知协议。</small>
                    </div>
                    {customButtonUrlTest?.componentId === selected.component_id && (
                      <p
                        className={`runtime-layout-url-test-status is-${customButtonUrlTest.status}`}
                        data-testid="custom-button-url-test-status"
                        data-tested-url={customButtonUrlTest.testedUrl}
                        role={customButtonUrlTest.status === "error" ? "alert" : "status"}
                      >
                        {customButtonUrlTest.message}
                      </p>
                    )}
                  </div>
                )}
                <div className="runtime-layout-custom-button-image-editor">
                  <AssetPicker
                    label="按钮图片"
                    field="style.backgroundImage"
                    value={selectedCustomButtonImageAssetId}
                    allowedTypes={["ui", "background", "sprite"]}
                    helpKey="layout.customButton.image"
                    emptyLabel="暂无可用按钮图片"
                    placeholder="尚未选择按钮图片"
                    variant="inline"
                    disabled={selectedLocked}
                    className="runtime-layout-custom-button-image"
                    onChange={setSelectedBackgroundImage}
                  />
                  <input
                    ref={customButtonImageInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    data-help-key="layout.customButton.imageImport.input"
                    onChange={(event) => void importCustomButtonImage(event)}
                  />
                  <button
                    type="button"
                    className="runtime-layout-custom-button-image-import"
                    disabled={selectedLocked}
                    data-help-key="layout.customButton.imageImport"
                    onClick={() => customButtonImageInputRef.current?.click()}
                  >
                    <UploadCloud size={15} />
                    从本地导入图片
                  </button>
                  {customButtonImageImport?.componentId === selected.component_id && (
                    <p
                      className={`runtime-layout-image-import-status is-${customButtonImageImport.status}`}
                      data-testid="custom-button-image-import-status"
                      data-status={customButtonImageImport.status}
                      data-asset-id={customButtonImageImport.asset?.asset_id ?? ""}
                      data-asset-type={customButtonImageImport.asset?.asset_type ?? ""}
                      data-filename={customButtonImageImport.asset?.metadata.filename ?? ""}
                      data-mime-type={customButtonImageImport.asset?.metadata.mime_type ?? ""}
                      data-project-path={customButtonImageImport.asset?.metadata.project_path ?? ""}
                      data-has-data-url={Boolean(customButtonImageImport.asset?.metadata.data_url)}
                      role={customButtonImageImport.status === "error" ? "alert" : "status"}
                    >
                      {customButtonImageImport.message}
                    </p>
                  )}
                </div>
                <label>
                  图片显示模式
                  <RichSelect
                    disabled={selectedLocked}
                    ariaLabel="按钮图片显示模式"
                    value={selected.style?.backgroundFit ?? "stretch"}
                    helpKey="layout.customButton.imageFit"
                    options={artworkFitOptions}
                    onChange={(backgroundFit) => setSelectedStyle({ backgroundFit })}
                  />
                </label>
                <div className="runtime-layout-danger-zone">
                  <span>
                    <strong>删除按钮</strong>
                    <small>仅删除当前自定义按钮，固定标题按钮不会受影响。</small>
                  </span>
                  <button
                    type="button"
                    className="runtime-layout-delete-button"
                    data-help-key="layout.customButton.delete"
                    onClick={deleteSelectedCustomButton}
                  >
                    <Trash2 size={15} />
                    删除
                  </button>
                </div>
              </details>
            )}
            {layoutType !== "renpy" && !selectedIsCustomButtonContainer && !selectedIsMask && <LazyRuntimeLayoutFieldset key={`appearance-${selected.component_id}`} summary="外观">
              {canRestoreRenpyPlayerDefaultStyle && (
                <div className="runtime-layout-style-origin">
                  <span>样式来源：<strong data-testid="runtime-layout-component-style-source">
                    {renpyPlayerStyleIsDefault ? "继承 Ren'Py 默认样式" : "自定义覆盖"}
                  </strong></span>
                  <button
                    type="button"
                    aria-label="恢复内置默认样式"
                    disabled={selectedLocked || renpyPlayerStyleIsDefault}
                    onClick={restoreSelectedRenpyPlayerDefaultStyle}
                  >
                    <RotateCw size={13} /> 恢复内置默认样式
                  </button>
                </div>
              )}
              {isBuiltinTitleButton(selected) && <p className="inline-note">标题按钮默认纯文字，优先于项目设置与主题。此处明确设置的外观保存后优先；移动或缩放按钮不会启用旧样式。</p>}
              {(["backgroundColor", "color", "borderColor"] as const).map((field) => <label key={field}>{field}<div className="runtime-layout-color-row"><input disabled={selectedLocked} type="color" value={(selected.style?.[field] as string | undefined) ?? "#0d121f"} data-help-key="layout.color" onChange={(event) => setSelectedStyle({ [field]: event.target.value })} /><input disabled={selectedLocked} value={(selected.style?.[field] as string | undefined) ?? ""} data-help-key="layout.color" onChange={(event) => setSelectedStyle({ [field]: event.target.value || undefined })} /></div></label>)}
              {supportsUILayoutOpacityLayers(selected.component_type) && ([
                ["backgroundOpacity", "页面背景不透明度"], ["contentOpacity", "页面内容不透明度"],
              ] as const).map(([field, label]) => <label key={field}>{label}
                <div className="runtime-layout-input-pair">
                  <RangeControl disabled={selectedLocked} ariaLabel={`${label}滑块`} min={0} max={1} step={0.05}
                    value={selected.style?.[field] ?? (field === "backgroundOpacity"
                      ? resolveUILayoutBackgroundOpacity(selected.component_type, selected.style) : selected.style?.opacity ?? 1)}
                    onChange={value => setSelectedStyle({ [field]: value })} />
                  <input disabled={selectedLocked} type="number" aria-label={label} min={0} max={1} step={0.05}
                    value={selected.style?.[field] ?? (field === "backgroundOpacity"
                      ? resolveUILayoutBackgroundOpacity(selected.component_type, selected.style) : selected.style?.opacity ?? 1)}
                    onChange={event => { const value = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(value)) setSelectedStyle({ [field]: Math.max(0, Math.min(1, value)) }); }} />
                </div>
                <button type="button" disabled={selectedLocked || selected.style?.[field] === undefined}
                  aria-label={`${label}恢复继承`} onClick={() => setSelectedStyle({ [field]: undefined })}>恢复继承</button>
              </label>)}
              {(selectedIsStyleOnly ? ["borderWidth", "borderRadius", "opacity"] as const : ["borderWidth", "borderRadius", "opacity", "padding", "gap", "backdropBlur", "fontSize"] as const).filter(field => field !== "opacity" || !supportsUILayoutOpacityLayers(selected.component_type)).map((field, index) => <label key={field}>{field}<div className="runtime-layout-input-pair"><RangeControl disabled={selectedLocked} ariaLabel={`${field} slider`} min={field === "opacity" ? 0.1 : 0} max={field === "fontSize" ? 40 : 48} step={field === "opacity" ? 0.05 : 1} value={Number(selected.style?.[field] ?? (field === "opacity" ? 1 : 0))} helpKey="layout.styleNumber" onChange={(value) => setSelectedStyle({ [field]: value })} /><input disabled={selectedLocked} type="number" data-help-key="layout.styleNumber" min={0} max={100} step={field === "opacity" ? 0.05 : 1} value={Number(selected.style?.[field] ?? (field === "opacity" ? 1 : 0))} onChange={(event) => setSelectedStyle({ [field]: Number(event.target.value) })} /></div>{index === -1 ? null : null}</label>)}
              {!selectedIsStyleOnly && <label>阴影<RichSelect disabled={selectedLocked} ariaLabel="阴影样式" value={selected.style?.shadow ?? ""} helpKey="layout.shadow" options={[{ value: "", label: "默认" }, { value: "none", label: "无" }, { value: "soft", label: "柔和" }, { value: "strong", label: "强" }]} onChange={(shadow) => setSelectedStyle({ shadow: shadow ? shadow as UILayoutComponentStyle["shadow"] : undefined })} /></label>}
            </LazyRuntimeLayoutFieldset>}
            {!selectedIsCustomButtonContainer && !selectedIsStyleOnly && <LazyRuntimeLayoutFieldset key={`text-${selected.component_id}`} summary="文本">
              {!selectedIsCustomButton && <label>显示名称<input disabled={selectedLocked} value={selected.label ?? ""} data-help-key="layout.label" onChange={(event) => updateSelectedComponent((component) => ({ ...component, label: event.target.value }))} /></label>}
              <label>字体<RichSelect disabled={selectedLocked} ariaLabel="字体资源" value={selected.style?.fontAssetId ?? ""} helpKey="layout.fontAsset" options={[{ value: "", label: "默认" }, ...fontAssetOptions]} onChange={(fontAssetId) => setSelectedStyle({ fontAssetId: fontAssetId || undefined })} /></label>
              <label>字重<RichSelect disabled={selectedLocked} ariaLabel="字体粗细" value={selected.style?.fontWeight ? String(selected.style.fontWeight) : ""} helpKey="layout.fontWeight" options={fontWeightOptions} onChange={(fontWeight) => setSelectedStyle({ fontWeight: fontWeight ? Number(fontWeight) : undefined })} /></label>
              <label>文本对齐<RichSelect disabled={selectedLocked} ariaLabel="文本对齐方式" value={selected.style?.textAlign ?? ""} helpKey="layout.textAlign" options={[{ value: "", label: "默认" }, { value: "left", label: "左" }, { value: "center", label: "居中" }, { value: "right", label: "右" }]} onChange={(textAlign) => setSelectedStyle({ textAlign: textAlign ? textAlign as UILayoutComponentStyle["textAlign"] : undefined })} /></label>
            </LazyRuntimeLayoutFieldset>}
            {layoutType !== "renpy" && !selectedIsCustomButton && !selectedIsCustomButtonContainer && !selectedIsMask && <LazyRuntimeLayoutFieldset key={`background-${selected.component_id}`} summary="背景图" defaultOpen={isArtworkImageComponent(selected)}>
              <AssetPicker
                label="背景图资源"
                field="style.backgroundImage"
                value={selectedBackgroundImageAssetId}
                allowedTypes={["background", "ui", "sprite"]}
                helpKey="layout.backgroundImage"
                emptyLabel="暂无可用背景图素材"
                placeholder="不使用背景图"
                variant="inline"
                disabled={selectedLocked}
                className="runtime-layout-component-background-image"
                onChange={setSelectedBackgroundImage}
              />
              {selectedIsStyleOnly && selected.style?.backgroundImage && (
                <div className="runtime-layout-auto-size-note" role="note" data-testid="quick-button-image-owned-note">
                  <strong>按钮图案已启用</strong>
                  <span>已选择图案后，按钮会优先使用图案显示；清除图案即可恢复颜色样式。</span>
                </div>
              )}
              <label>
                {isArtworkImageComponent(selected) ? "素材适配方式" : "显示模式"}
                <RichSelect
                  disabled={selectedLocked}
                  ariaLabel={isArtworkImageComponent(selected) ? "素材裁切或缩放方式" : "背景图显示模式"}
                  value={selected.style?.backgroundFit ?? (isArtworkImageComponent(selected) ? "contain" : "stretch")}
                  helpKey="layout.backgroundFit"
                  options={isArtworkImageComponent(selected) ? artworkFitOptions : backgroundFitOptions}
                  onChange={(backgroundFit) => setSelectedStyle({ backgroundFit })}
                />
              </label>
            </LazyRuntimeLayoutFieldset>}
            {screenId === "preferences" && (
              <details className="runtime-layout-fieldset" open>
                <summary>设置页背景</summary>
                <AssetPicker
                  label="设置页背景图"
                  field="package.settingsPanelBackgroundAssetId"
                  value={packageAppearance.settingsPanelBackgroundAssetId ?? ""}
                  allowedTypes={["background", "ui"]}
                  helpKey="settings.runtimeVisual.settingsPanel"
                  emptyLabel="暂无可用设置页背景"
                  variant="inline"
                  onChange={(settingsPanelBackgroundAssetId) => updatePackageAppearance({ settingsPanelBackgroundAssetId: settingsPanelBackgroundAssetId || undefined })}
                />
                <label>
                  显示模式
                  <RichSelect
                    ariaLabel="设置页背景显示模式"
                    value={packageAppearance.settingsPanelBackgroundFit ?? "stretch"}
                    helpKey="settings.runtimeVisual.settingsPanelFit"
                    options={backgroundFitOptions}
                    onChange={(settingsPanelBackgroundFit) => updatePackageAppearance({ settingsPanelBackgroundFit })}
                  />
                </label>
                <label>
                  压暗
                  <div className="runtime-layout-input-pair">
                    <RangeControl
                      ariaLabel="设置页背景压暗"
                      min={0}
                      max={0.9}
                      step={0.01}
                      value={packageAppearance.settingsPanelBackgroundDimming ?? 0.24}
                      helpKey="settings.runtimeVisual.settingsPanelDimming"
                      onChange={(settingsPanelBackgroundDimming) => updatePackageAppearance({ settingsPanelBackgroundDimming })}
                    />
                    <output>{Math.round((packageAppearance.settingsPanelBackgroundDimming ?? 0.24) * 100)}%</output>
                  </div>
                </label>
              </details>
            )}
            {screenId === "about" && (
              <details className="runtime-layout-fieldset runtime-layout-about-copy" open>
                <summary>关于面板文案</summary>
                <label>面板标题<input value={packageAppearance.about?.title ?? ""} data-help-key="settings.about.title" onChange={(event) => updateAboutCopy({ title: event.target.value })} /></label>
                <label>顶部小标题<input value={packageAppearance.about?.kicker ?? ""} data-help-key="settings.about.kicker" onChange={(event) => updateAboutCopy({ kicker: event.target.value })} /></label>
                <label>主标题<input value={packageAppearance.about?.heading ?? ""} data-help-key="settings.about.heading" onChange={(event) => updateAboutCopy({ heading: event.target.value })} /></label>
                <label>简介<textarea value={packageAppearance.about?.description ?? ""} data-help-key="settings.about.description" onChange={(event) => updateAboutCopy({ description: event.target.value })} /></label>
                <label>底部说明<textarea value={packageAppearance.about?.note ?? ""} data-help-key="settings.about.note" onChange={(event) => updateAboutCopy({ note: event.target.value })} /></label>
                <div className="runtime-about-field-editor">
                  <header>
                    <strong>字段列表</strong>
                    <button type="button" data-help-key="settings.about.addField" onClick={addAboutField}>添加字段</button>
                  </header>
                  {aboutFields.length === 0 && <p className="runtime-about-fields-empty">暂无字段</p>}
                  {aboutFields.map((field, index) => (
                    <div key={index} className="runtime-about-field-row">
                      <input aria-label={`关于字段 ${index + 1} 标签`} value={field.label ?? ""} placeholder="标签" data-help-key="settings.about.fieldLabel" onChange={(event) => updateAboutField(index, { label: event.target.value })} />
                      <input aria-label={`关于字段 ${index + 1} 内容`} value={field.value ?? ""} placeholder="内容" data-help-key="settings.about.fieldValue" onChange={(event) => updateAboutField(index, { value: event.target.value })} />
                      <button type="button" data-help-key="settings.about.removeField" onClick={() => removeAboutField(index)}>移除</button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </> : <p>请选择一个组件。</p>}
        </aside>
      </div>
      }
      <section className={`runtime-layout-status ${layoutHealthState === "ok" ? "ok" : `is-${layoutHealthState}`}`}>
        <button
          type="button"
          data-help-key="layout.healthDetails"
          data-testid="runtime-layout-health-status"
          data-health-state={layoutHealthState}
          onClick={() => setShowHealthDetails((value) => !value)}
        >
          UI 体检：{layoutHealthState === "pending"
            ? "正在检查"
            : layoutHealthErrorCount > 0
              ? `${layoutHealthErrorCount} 个错误`
              : layoutHealthWarningCount > 0
                ? `${layoutHealthWarningCount} 个警告`
                : "通过"}
        </button>
        {showHealthDetails && (
          layoutHealthState === "pending" ? (
            <p>正在检查当前布局…</p>
          ) : layoutHealthIssues.length === 0 ? (
            <p>未发现布局问题。</p>
          ) : (
            <ul>
              {layoutHealthIssues.map((item, index) => (
                <li
                  key={`${item.code}_${item.path ?? ""}_${index}`}
                  className={item.severity === "error" ? "is-error" : "is-warning"}
                  data-issue-code={item.code}
                  data-issue-path={item.path ?? ""}
                >
                  {item.severity === "error" ? "错误" : "警告"}：{item.message}
                </li>
              ))}
            </ul>
          )
        )}
      </section>
    </section>
  );
}
