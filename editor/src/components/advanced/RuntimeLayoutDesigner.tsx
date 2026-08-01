import { Copy, EyeOff, Layers, Lock, Monitor, Move, Plus, Redo2, RotateCw, Save, Smartphone, Trash2, Undo2, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  normalizeExternalUrl,
  validateExternalUrl,
  type ExternalUrlValidationCode,
} from "../../../../shared/cartridge/externalAction";
import {
  createDefaultCustomButtonContainer,
  getDefaultUISkinLayout,
  validateUISkinHealth,
  type UILayoutAnchor,
  type UILayoutActionKind,
  type UILayoutBreakpoint,
  type UILayoutComponent,
  type UILayoutComponentStyle,
  type UILayoutRect,
  type UILayoutScreen,
  type UILayoutScreenId,
  type UISkinLayout,
} from "../../../../shared/cartridge/uiSkin";
import { useProjectStore } from "../../store/projectStore";
import type { AssetRef } from "../../types/assets";
import type { PackageAppearanceSettings } from "../../types/project";
import { artworkFitOptions, backgroundFitOptions } from "../../utils/localizedOptions";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { findAvailableCustomButtonRect } from "../../utils/customButtonLayout";
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
import { AssetPicker } from "../common/AssetPicker";
import { RangeControl } from "../common/RangeControl";
import { RichSelect } from "../common/RichSelect";

type ZoomMode = "fit" | 0.5 | 0.75 | 1;
type PresetId = "default" | "renpy" | "mobile" | "subtitle";
type PresetScope = "current" | "all";
type PresetBreakpointScope = "both" | "desktop" | "mobile";

interface CustomButtonImageImportState {
  componentId: string;
  status: "success" | "error";
  message: string;
  asset?: AssetRef;
}

interface CustomButtonUrlTestState {
  componentId: string;
  status: "success" | "info" | "error";
  message: string;
  testedUrl: string;
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
  preferences: "设置",
  history: "历史",
  gallery: "画廊",
  about: "关于",
};

const componentLabels: Record<string, string> = {
  stage_background: "舞台背景",
  main_menu_hero: "标题信息",
  main_menu_continue_button: "继续游戏按钮",
  main_menu_start_button: "开始按钮",
  main_menu_save_load_button: "存读档按钮",
  main_menu_library_button: "卡带库按钮",
  main_menu_gallery_button: "画廊按钮",
  main_menu_settings_button: "设置按钮",
  main_menu_about_button: "关于按钮",
  main_menu_custom_button_container: "自定义按钮容器",
  dialog_panel: "对话框",
  speaker_label: "说话人名牌",
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
  import_panel: "导入面板",
};

const presetLabels: Record<PresetId, string> = {
  default: "默认视觉小说",
  renpy: "Ren'Py 风格",
  mobile: "手机横屏",
  subtitle: "极简字幕",
};

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
  return ["dialog_panel", "choice_list", "choice_option", "main_menu_custom_button"].includes(component.component_type);
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

function fitCustomButtonContainer(
  components: UILayoutComponent[],
  breakpoint: UILayoutBreakpoint,
): UILayoutComponent[] {
  const container = components.find(isCustomButtonContainer);
  if (!container) return components;
  const buttons = components.filter((component) => component.component_type === "main_menu_custom_button");
  let nextRect: UILayoutRect;
  if (buttons.length === 0) {
    const currentRect = getRect(container, breakpoint);
    const defaultRect = getRect(createDefaultCustomButtonContainer(), breakpoint);
    nextRect = {
      x: currentRect.x,
      y: currentRect.y,
      width: defaultRect.width,
      height: defaultRect.height,
    };
  } else {
    const rects = buttons.map((button) => getRect(button, breakpoint));
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
    ? setRect(component, breakpoint, nextRect)
    : component);
}

function syncCustomButtonContainer(components: UILayoutComponent[]): UILayoutComponent[] {
  const ensured = ensureCustomButtonContainer(components);
  return fitCustomButtonContainer(fitCustomButtonContainer(ensured, "desktop"), "mobile");
}

function translateCustomButtonContainer(
  components: UILayoutComponent[],
  breakpoint: UILayoutBreakpoint,
  targetX: number,
  targetY: number,
): UILayoutComponent[] {
  const container = components.find(isCustomButtonContainer);
  if (!container) return components;
  const containerRect = getRect(container, breakpoint);
  const clampedX = Math.max(0, Math.min(100 - containerRect.width, targetX));
  const clampedY = Math.max(0, Math.min(100 - containerRect.height, targetY));
  const dx = clampedX - containerRect.x;
  const dy = clampedY - containerRect.y;
  const translated = components.map((component) => {
    if (!isCustomButtonContainer(component) && component.component_type !== "main_menu_custom_button") return component;
    const rect = getRect(component, breakpoint);
    return setRect(component, breakpoint, {
      ...rect,
      x: roundLayoutValue(rect.x + dx),
      y: roundLayoutValue(rect.y + dy),
    });
  });
  return fitCustomButtonContainer(translated, breakpoint);
}

function cloneSkin(skin?: UISkinLayout): UISkinLayout {
  const cloned = JSON.parse(JSON.stringify(skin ?? getDefaultUISkinLayout())) as UISkinLayout;
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

function getRect(component: UILayoutComponent, breakpoint: UILayoutBreakpoint): UILayoutRect {
  return (breakpoint === "mobile" ? component.mobileRect ?? component.rect : component.rect) ?? { x: 10, y: 10, width: 30, height: 20 };
}

function setRect(component: UILayoutComponent, breakpoint: UILayoutBreakpoint, rect: UILayoutRect): UILayoutComponent {
  return breakpoint === "mobile" ? { ...component, mobileRect: rect } : { ...component, rect };
}

function componentLabel(component: UILayoutComponent): string {
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

function componentStyle(component: UILayoutComponent, assetManifest: AssetRef[]): CSSProperties {
  const style = component.style;
  const backgroundFit = style?.backgroundFit ?? "stretch";
  const backgroundImage = resolveUILayoutImagePreview(style?.backgroundImage, assetManifest).source;
  const imageOwned = Boolean(backgroundImage) && isArtworkImageComponent(component);
  return {
    background: imageOwned ? "transparent" : style?.backgroundColor ?? "rgba(130, 182, 255, 0.18)",
    backgroundImage: backgroundImage ? `url("${backgroundImage}")` : undefined,
    backgroundSize: backgroundImage ? backgroundFit === "stretch" ? "100% 100%" : backgroundFit : undefined,
    backgroundRepeat: backgroundImage ? "no-repeat" : undefined,
    backgroundPosition: backgroundImage ? "center" : undefined,
    color: style?.color ?? "var(--ink-strong)",
    borderColor: imageOwned ? "transparent" : style?.borderColor ?? "color-mix(in srgb, var(--accent) 58%, var(--line))",
    borderWidth: imageOwned ? 0 : style?.borderWidth,
    borderRadius: style?.borderRadius,
    padding: style?.padding,
    gap: style?.gap,
    opacity: style?.opacity,
    fontSize: style?.fontSize,
    fontWeight: style?.fontWeight,
    fontStyle: style?.fontStyle,
    textAlign: style?.textAlign,
    boxShadow: imageOwned ? "none" : style?.shadow === "none" ? "none" : style?.shadow === "soft" ? "0 12px 30px rgba(0,0,0,0.24)" : undefined,
  };
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

function createCustomTitleButton(components: UILayoutComponent[]): UILayoutComponent {
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
    mobileRect: findAvailableCustomButtonRect(components, container, "mobile"),
    style: {
      backgroundColor: "#192234",
      color: "#f6f8ff",
      borderColor: "#d8e2ff",
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
  breakpoint,
  assetManifest,
  packageAppearance,
}: {
  screenId: UILayoutScreenId;
  screen: UILayoutScreen;
  breakpoint: UILayoutBreakpoint;
  assetManifest: AssetRef[];
  packageAppearance: PackageAppearanceSettings;
}) {
  const titleBackground = assetPreviewUrl(assetManifest, packageAppearance.titleBackgroundAssetId);
  const settingsBackground = assetPreviewUrl(assetManifest, packageAppearance.settingsPanelBackgroundAssetId);
  const titleStyle = shellImageStyle(titleBackground, packageAppearance.titleBackgroundFit, packageAppearance.titleBackgroundDimming ?? 0.18);
  const settingsStyle = shellImageStyle(settingsBackground, packageAppearance.settingsPanelBackgroundFit, packageAppearance.settingsPanelBackgroundDimming ?? 0.24);
  const renderComponent = (component: UILayoutComponent, children?: ReactNode, extraStyle?: CSSProperties) => (
    <div
      key={component.component_id}
      className={`runtime-layout-page-part part-${component.component_type}`}
      data-preview-component-id={component.component_id}
      data-background-image-reference={component.style?.backgroundImage ?? ""}
      style={{ ...rectToStyle(getRect(component, breakpoint)), ...componentStyle(component, assetManifest), zIndex: component.zIndex ?? 1, ...extraStyle }}
    >
      {children}
    </div>
  );
  const cards = Array.from({ length: 8 }, (_, index) => <i key={index} />);
  return (
    <div className={`runtime-layout-expected-preview is-${screenId}`} aria-hidden="true">
      <div className="runtime-layout-page-surface" style={screenId === "title" ? titleStyle : undefined}>
        {screen.components.map((component) => {
          if (screenId === "preferences") {
            return renderComponent(component, <div className="preview-settings-card" style={component.component_type === "settings_group" ? settingsStyle : undefined}><span className="preview-tab-stack"><i /><i /><i /><i /></span><span className="preview-setting-rows"><i /><i /><i /></span></div>);
          }
          if (screenId === "player" && component.component_type === "dialog_text") return renderComponent(component, <><span className="preview-line wide" /><span className="preview-line" /></>);
          if (screenId === "player" && component.component_type === "choice_list") return renderComponent(component, <><span className="preview-choice" /><span className="preview-choice" /><span className="preview-choice" /></>);
          if (screenId === "player" && component.component_type === "quick_menu") return renderComponent(component, <><span className="preview-dot" /><span className="preview-dot" /><span className="preview-dot" /></>);
          if (screenId === "save_load") return renderComponent(component, <span className="preview-card-grid">{cards}</span>);
          if (screenId === "gallery") return renderComponent(component, <span className="preview-gallery-grid">{cards}</span>);
          if (screenId === "history") return renderComponent(component, <span className="preview-history-list"><i /><i /><i /><i /></span>);
          if (screenId === "about") return renderComponent(component, <span className="preview-about-card"><i /><i /><i /><i /></span>);
          if (screenId === "game_menu") return renderComponent(component, <span className="preview-menu-strip"><i /><i /><i /><i /></span>);
          if (component.component_type === "main_menu_hero") return renderComponent(component, <><span className="preview-line wide" /><span className="preview-line" /><span className="preview-line short" /></>);
          if (isCustomButtonContainer(component) || (component.component_type === "main_menu_custom_button" && component.style?.backgroundImage)) return renderComponent(component);
          return renderComponent(component, <span className="preview-button-mark" />);
        })}
      </div>
    </div>
  );
}

export function RuntimeLayoutDesigner() {
  const savedSkin = useProjectStore((state) => state.settings.runtimeUILayout);
  const setRuntimeUILayout = useProjectStore((state) => state.setRuntimeUILayout);
  const setPackageAppearance = useProjectStore((state) => state.setPackageAppearance);
  const setAssetManifest = useProjectStore((state) => state.setAssetManifest);
  const assetManifest = useProjectStore((state) => state.assetManifest);
  const packageAppearance = useProjectStore((state) => state.settings.packageAppearance);
  const aboutFields = packageAppearance.about?.fields ?? defaultAboutFields;
  const [draft, setDraft] = useState<UISkinLayout>(() => cloneSkin(savedSkin));
  const [history, setHistory] = useState<{ past: UISkinLayout[]; future: UISkinLayout[] }>({ past: [], future: [] });
  const [screenId, setScreenId] = useState<UILayoutScreenId>("player");
  const [breakpoint, setBreakpoint] = useState<UILayoutBreakpoint>("desktop");
  const [selectedId, setSelectedId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState<ZoomMode>("fit");
  const [showGrid, setShowGrid] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [showNames, setShowNames] = useState(true);
  const [snapGrid, setSnapGrid] = useState(true);
  const [snapEdges, setSnapEdges] = useState(true);
  const [snapCenter, setSnapCenter] = useState(true);
  const [snapSafe, setSnapSafe] = useState(true);
  const [preset, setPreset] = useState<PresetId>("default");
  const [presetScope, setPresetScope] = useState<PresetScope>("current");
  const [presetBreakpointScope, setPresetBreakpointScope] = useState<PresetBreakpointScope>("both");
  const [showHealthDetails, setShowHealthDetails] = useState(false);
  const [customButtonImageImport, setCustomButtonImageImport] = useState<CustomButtonImageImportState | undefined>();
  const [customButtonUrlTest, setCustomButtonUrlTest] = useState<CustomButtonUrlTestState | undefined>();
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const customButtonImageInputRef = useRef<HTMLInputElement | null>(null);
  const lastSavedSkinRef = useRef(savedSkin);
  const saved = useMemo(() => cloneSkin(savedSkin), [savedSkin]);
  const screen = getScreen(draft, screenId);
  const selected = screen.components.find((component) => component.component_id === selectedId) ?? screen.components[0];
  const selectedRect = selected ? getRect(selected, breakpoint) : undefined;
  const selectedLocked = Boolean(selected?.locked);
  const activeIds = selectedIds.length > 0 ? selectedIds : selected ? [selected.component_id] : [];
  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const selectedIsCustomButton = selected?.component_type === "main_menu_custom_button";
  const selectedIsCustomButtonContainer = Boolean(selected && isCustomButtonContainer(selected));
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
  const layoutHealth = useMemo(() => validateUISkinHealth(draft, {
    availableAssetPaths: assetManifest
      .map((asset) => asset.metadata.path)
      .filter((path): path is string => Boolean(path)),
    availableAssetIds: assetManifest.map((asset) => asset.asset_id),
  }), [assetManifest, draft]);
  const layoutHealthIssues = [...layoutHealth.errors, ...layoutHealth.warnings].filter((item) => (
    item.path?.startsWith(`ui.${screenId}.`) || item.path?.startsWith("ui.tokens.")
  ));
  const layoutHealthErrorCount = layoutHealthIssues.filter((item) => item.severity === "error").length;
  const layoutHealthWarningCount = layoutHealthIssues.filter((item) => item.severity === "warning").length;
  const layoutHealthState = layoutHealthErrorCount > 0
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
  const zoomStyle: CSSProperties = zoom === "fit" ? {} : { width: `${760 * zoom}px` };
  const selectedPixelRect = selectedRect && stageSize.width > 0 ? {
    x: Math.round(stageSize.width * selectedRect.x / 100),
    y: Math.round(stageSize.height * selectedRect.y / 100),
    width: Math.round(stageSize.width * selectedRect.width / 100),
    height: Math.round(stageSize.height * selectedRect.height / 100),
  } : undefined;
  const setStageNode = useCallback((node: HTMLDivElement | null) => {
    stageRef.current = node;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
    setStageSize((current) => current.width === next.width && current.height === next.height ? current : next);
  }, []);
  const fontAssetOptions = useMemo(() => assetManifest
    .filter((asset) => asset.asset_type === "font")
    .map((asset) => ({ value: asset.asset_id, label: asset.metadata.display_name ?? asset.metadata.filename ?? asset.asset_id })),
    [assetManifest]);

  useEffect(() => {
    if (lastSavedSkinRef.current === savedSkin) return;
    const previousSaved = cloneSkin(lastSavedSkinRef.current);
    const currentDraft = draft;
    lastSavedSkinRef.current = savedSkin;
    const next = cloneSkin(savedSkin);
    const currentWasDirty = JSON.stringify(currentDraft) !== JSON.stringify(previousSaved);
    const incomingMatchesDraft = JSON.stringify(currentDraft) === JSON.stringify(next);
    const incomingEqualsPrevious = JSON.stringify(next) === JSON.stringify(previousSaved);
    if (currentWasDirty && incomingEqualsPrevious && !incomingMatchesDraft) return;
    setDraft(next);
    setHistory({ past: [], future: [] });
    const nextScreen = getScreen(next, screenId);
    setSelectedId((current) => (
      nextScreen.components.some((component) => component.component_id === current)
        ? current
        : nextScreen.components[0]?.component_id ?? ""
    ));
    setSelectedIds((current) => {
      const available = new Set(nextScreen.components.map((component) => component.component_id));
      const retained = current.filter((id) => available.has(id));
      if (retained.length > 0) return retained;
      return nextScreen.components[0] ? [nextScreen.components[0].component_id] : [];
    });
  }, [savedSkin]);

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
    setDraft((current) => {
      if (JSON.stringify(current) === JSON.stringify(next)) return current;
      setHistory((state) => ({ past: [...state.past.slice(-30), cloneSkin(current)], future: [] }));
      return next;
    });
  }

  function commitUpdater(updater: (current: UISkinLayout) => UISkinLayout) {
    commit(updater(draft));
  }

  function selectScreen(next: UILayoutScreenId) {
    const nextScreen = getScreen(draft, next);
    const nextId = nextScreen.components[0]?.component_id ?? "";
    setScreenId(next);
    setSelectedId(nextId);
    setSelectedIds(nextId ? [nextId] : []);
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
    const component = createCustomTitleButton(ensuredComponents);
    commitUpdater((current) => updateScreenComponents(
      current,
      "title",
      (components) => syncCustomButtonContainer([...ensureCustomButtonContainer(components), component]),
    ));
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

  function updateSelectedComponent(updater: (component: UILayoutComponent) => UILayoutComponent) {
    if (!selected) return;
    commitUpdater((current) => updateComponent(current, screenId, selected.component_id, updater));
  }

  function setSelectedRect(rect: UILayoutRect) {
    if (!selected) return;
    if (selectedIsCustomButtonContainer) {
      commitUpdater((current) => updateScreenComponents(
        current,
        screenId,
        (components) => translateCustomButtonContainer(components, breakpoint, rect.x, rect.y),
      ));
      return;
    }
    if (selectedIsCustomButton) {
      commitUpdater((current) => updateScreenComponents(
        current,
        screenId,
        (components) => fitCustomButtonContainer(
          components.map((component) => component.component_id === selected.component_id
            ? setRect(component, breakpoint, rect)
            : component),
          breakpoint,
        ),
      ));
      return;
    }
    updateSelectedComponent((component) => setRect(component, breakpoint, rect));
  }

  function setSelectedStyle(style: Partial<UILayoutComponentStyle>) {
    updateSelectedComponent((component) => ({ ...component, style: cleanStyle({ ...(component.style ?? {}), ...style }) }));
  }

  function setSelectedBackgroundImage(assetId: string) {
    updateSelectedComponent((component) => {
      const backgroundImage = assetId ? toUILayoutAssetReference(assetId) : undefined;
      const currentFit = component.style?.backgroundFit;
      const backgroundFit = backgroundImage && isArtworkImageComponent(component)
        ? isProportionalArtworkFit(currentFit) ? currentFit : "contain"
        : currentFit;
      return {
        ...component,
        style: cleanStyle({
          ...(component.style ?? {}),
          backgroundImage,
          backgroundFit,
        }),
      };
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

  function copySelectedRectTo(scope: "desktop" | "mobile" | "both") {
    if (!selected || !selectedRect) return;
    const rect = { ...selectedRect };
    if (selectedIsCustomButtonContainer) {
      commitUpdater((current) => updateScreenComponents(current, screenId, (components) => {
        let next = components;
        if (scope === "desktop" || scope === "both") {
          next = translateCustomButtonContainer(next, "desktop", rect.x, rect.y);
        }
        if (scope === "mobile" || scope === "both") {
          next = translateCustomButtonContainer(next, "mobile", rect.x, rect.y);
        }
        return next;
      }));
      return;
    }
    commitUpdater((current) => updateScreenComponents(current, screenId, (components) => {
      const next = components.map((component) => component.component_id === selected.component_id
        ? {
            ...component,
            rect: scope === "desktop" || scope === "both" ? rect : component.rect,
            mobileRect: scope === "mobile" || scope === "both" ? rect : component.mobileRect,
          }
        : component);
      if (!selectedIsCustomButton) return next;
      let fitted = next;
      if (scope === "desktop" || scope === "both") fitted = fitCustomButtonContainer(fitted, "desktop");
      if (scope === "mobile" || scope === "both") fitted = fitCustomButtonContainer(fitted, "mobile");
      return fitted;
    }));
  }

  function updateSelectedComponentRectField(field: keyof Pick<UILayoutRect, "x" | "y" | "width" | "height">, value: number) {
    if (!selectedRect) return;
    setSelectedRect({ ...selectedRect, [field]: value });
  }

  function startDrag(component: UILayoutComponent, event: ReactPointerEvent<HTMLButtonElement>) {
    if (component.locked) return;
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const rect = getRect(component, breakpoint);
    const startX = event.clientX;
    const startY = event.clientY;
    selectComponent(component.component_id, event.ctrlKey || event.metaKey);
    const onMove = (moveEvent: PointerEvent) => {
      const dx = ((moveEvent.clientX - startX) / bounds.width) * 100;
      const dy = ((moveEvent.clientY - startY) / bounds.height) * 100;
      const targetX = Math.max(0, Math.min(100, rect.x + dx));
      const targetY = Math.max(0, Math.min(100, rect.y + dy));
      setDraft((current) => updateScreenComponents(current, screenId, (components) => {
        if (isCustomButtonContainer(component)) {
          return translateCustomButtonContainer(components, breakpoint, targetX, targetY);
        }
        const next = components.map((item) => item.component_id === component.component_id
          ? setRect(item, breakpoint, { ...rect, x: targetX, y: targetY })
          : item);
        return component.component_type === "main_menu_custom_button"
          ? fitCustomButtonContainer(next, breakpoint)
          : next;
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startResize(component: UILayoutComponent, event: ReactPointerEvent<HTMLSpanElement>) {
    event.stopPropagation();
    if (component.locked || isCustomButtonContainer(component)) return;
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const rect = getRect(component, breakpoint);
    const onMove = (moveEvent: PointerEvent) => {
      const pointerX = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      const pointerY = ((moveEvent.clientY - bounds.top) / bounds.height) * 100;
      setDraft((current) => updateScreenComponents(current, screenId, (components) => {
        const next = components.map((item) => item.component_id === component.component_id
          ? setRect(item, breakpoint, {
              ...rect,
              width: Math.max(2, pointerX - rect.x),
              height: Math.max(2, pointerY - rect.y),
            })
          : item);
        return component.component_type === "main_menu_custom_button"
          ? fitCustomButtonContainer(next, breakpoint)
          : next;
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function align(action: string) {
    if (activeIds.length === 0) return;
    commitUpdater((current) => updateScreenComponents(current, screenId, (components) => components.map((component) => {
      if (!activeIds.includes(component.component_id) || component.locked) return component;
      const rect = getRect(component, breakpoint);
      if (action === "left") return setRect(component, breakpoint, { ...rect, x: 5 });
      if (action === "right") return setRect(component, breakpoint, { ...rect, x: Math.max(0, 95 - rect.width) });
      if (action === "top") return setRect(component, breakpoint, { ...rect, y: 5 });
      if (action === "bottom") return setRect(component, breakpoint, { ...rect, y: Math.max(0, 95 - rect.height) });
      if (action === "centerX") return setRect(component, breakpoint, { ...rect, x: 50 - rect.width / 2 });
      if (action === "centerY") return setRect(component, breakpoint, { ...rect, y: 50 - rect.height / 2 });
      return component;
    })));
  }

  function applyPreset() {
    const presetSkin = cloneSkin(getDefaultUISkinLayout());
    const targets = presetScope === "all" ? screenOrder : [screenId];
    commitUpdater((current) => ({
      ...current,
      screens: current.screens.map((screen) => {
        if (!targets.includes(screen.screen_id)) return screen;
        const presetScreen = getScreen(presetSkin, screen.screen_id);
        return {
          ...screen,
          components: screen.components.map((component) => {
            const presetComponent = presetScreen.components.find((item) => item.component_id === component.component_id || item.component_type === component.component_type);
            if (!presetComponent) return component;
            return {
              ...component,
              rect: presetBreakpointScope === "mobile" ? component.rect : presetComponent.rect ?? component.rect,
              mobileRect: presetBreakpointScope === "desktop" ? component.mobileRect : presetComponent.mobileRect ?? presetComponent.rect ?? component.mobileRect,
              style: { ...(component.style ?? {}), ...(presetComponent.style ?? {}) },
            };
          }),
        };
      }),
      name: presetLabels[preset],
    }));
  }

  function saveLayout() {
    setRuntimeUILayout(draft);
  }

  function undo() {
    setHistory((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      setDraft(cloneSkin(previous));
      return { past: state.past.slice(0, -1), future: [cloneSkin(draft), ...state.future] };
    });
  }

  function redo() {
    setHistory((state) => {
      const next = state.future[0];
      if (!next) return state;
      setDraft(cloneSkin(next));
      return { past: [...state.past, cloneSkin(draft)], future: state.future.slice(1) };
    });
  }

  return (
    <section className="runtime-layout-designer">
      <header className="runtime-layout-header">
        <div>
          <h3>客户端布局</h3>
          <p>中间舞台使用每个页面的轻量期望渲染代码，不触发完整 GameCLI 预览。</p>
        </div>
        <div className="row-actions">
          <button type="button" data-help-key="layout.undo" onClick={undo} disabled={history.past.length === 0}><Undo2 size={16} /> 撤销</button>
          <button type="button" data-help-key="layout.redo" onClick={redo} disabled={history.future.length === 0}><Redo2 size={16} /> 重做</button>
          <button type="button" data-help-key="layout.desktop" className={breakpoint === "desktop" ? "is-active" : ""} onClick={() => setBreakpoint("desktop")}><Monitor size={16} /> 桌面</button>
          <button type="button" data-help-key="layout.mobile" className={breakpoint === "mobile" ? "is-active" : ""} onClick={() => setBreakpoint("mobile")}><Smartphone size={16} /> 手机横屏</button>
          {(["fit", 0.5, 0.75, 1] as ZoomMode[]).map((item) => (
            <button key={String(item)} type="button" data-help-key="layout.zoom" className={zoom === item ? "is-active" : ""} onClick={() => setZoom(item)}>{item === "fit" ? "适应" : `${Number(item) * 100}%`}</button>
          ))}
          <button
            type="button"
            data-help-key="layout.save"
            className={isDirty ? "is-primary" : ""}
            disabled={hasBlankCustomButtonLabel || hasInvalidCustomButtonAction}
            title={
              hasBlankCustomButtonLabel
                ? "请先填写所有自定义按钮的文字"
                : hasInvalidCustomButtonAction
                  ? "请先修正所有自定义按钮的外部链接"
                  : undefined
            }
            onClick={saveLayout}
          >
            <Save size={16} /> 保存布局
          </button>
        </div>
      </header>

      <div className="runtime-layout-toolbar">
        <details className="runtime-layout-menu"><summary>对齐</summary><div className="runtime-layout-menu-grid">{["left", "centerX", "right", "top", "centerY", "bottom", "sameWidth", "sameHeight", "distributeX", "distributeY"].map((item) => <button key={item} type="button" data-help-key="layout.align" onClick={() => align(item)}>{item}</button>)}</div></details>
        <details className="runtime-layout-menu"><summary>吸附</summary><div className="runtime-layout-menu-stack">{[["layout.snapGrid", snapGrid, setSnapGrid], ["layout.snapEdges", snapEdges, setSnapEdges], ["layout.snapCenter", snapCenter, setSnapCenter], ["layout.snapSafe", snapSafe, setSnapSafe]].map(([key, value, setter]) => <label key={String(key)}><input type="checkbox" checked={Boolean(value)} data-help-key={String(key)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} /> {String(key)}</label>)}</div></details>
        <details className="runtime-layout-menu"><summary>视图</summary><div className="runtime-layout-menu-stack"><label><input type="checkbox" checked={showGrid} data-help-key="layout.showGrid" onChange={(event) => setShowGrid(event.target.checked)} /> 显示网格</label><label><input type="checkbox" checked={showSafeArea} data-help-key="layout.showSafeArea" onChange={(event) => setShowSafeArea(event.target.checked)} /> 显示安全区</label><label><input type="checkbox" checked={showNames} data-help-key="layout.showNames" onChange={(event) => setShowNames(event.target.checked)} /> 显示名称</label></div></details>
        <details className="runtime-layout-menu wide"><summary>预设</summary><div className="runtime-layout-menu-stack"><RichSelect value={preset} ariaLabel="布局预设" helpKey="layout.preset" variant="compact" options={Object.entries(presetLabels).map(([value, label]) => ({ value, label }))} onChange={(value) => setPreset(value as PresetId)} /><RichSelect value={presetScope} ariaLabel="预设页面范围" helpKey="layout.preset" variant="compact" options={[{ value: "current", label: "当前页面" }, { value: "all", label: "全部页面" }]} onChange={(value) => setPresetScope(value as PresetScope)} /><RichSelect value={presetBreakpointScope} ariaLabel="预设断点范围" helpKey="layout.preset" variant="compact" options={[{ value: "both", label: "桌面和手机" }, { value: "desktop", label: "仅桌面" }, { value: "mobile", label: "仅手机" }]} onChange={(value) => setPresetBreakpointScope(value as PresetBreakpointScope)} /><button type="button" data-help-key="layout.applyPreset" onClick={applyPreset}>应用预设</button><button type="button" data-help-key="layout.repairDialog" onClick={applyPreset}><RotateCw size={15} /> 修复对白布局</button><button type="button" data-help-key="layout.restoreCurrent" onClick={applyPreset}><RotateCw size={15} /> 恢复当前页面</button><button type="button" data-help-key="layout.restoreAll" onClick={() => commit(getDefaultUISkinLayout())}><RotateCw size={15} /> 恢复全部默认</button></div></details>
      </div>

      <div className="runtime-layout-grid">
        <aside className="runtime-layout-sidebar">
          <strong>页面</strong>
          {screenOrder.map((id) => <button type="button" key={id} className={id === screenId ? "is-active" : ""} data-help-key="layout.screen" onClick={() => selectScreen(id)}>{screenLabels[id]}</button>)}
          <div className="runtime-layout-component-heading">
            <strong className="runtime-layout-side-heading"><Layers size={15} /> 组件</strong>
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
          <div className="runtime-layout-component-list">
            {screen.components.map((component) => <label key={component.component_id} className={component.component_id === selected?.component_id ? "is-active" : ""} data-component-id={component.component_id}><input type="checkbox" checked={selectedIds.includes(component.component_id)} data-help-key="layout.component" data-component-id={component.component_id} onChange={() => selectComponent(component.component_id, true)} /><button type="button" data-help-key="layout.component" data-component-id={component.component_id} onClick={() => selectComponent(component.component_id)}><span>{componentLabel(component)}</span><small>层级 {component.zIndex ?? 0}</small></button></label>)}
          </div>
        </aside>

        <div className="runtime-layout-center">
          <div className={`runtime-layout-stage-wrap ${breakpoint}${showGrid ? "" : " no-grid"}${showSafeArea ? "" : " no-safe"}${showNames ? "" : " no-names"}`}>
            <div className="runtime-layout-stage" ref={setStageNode} style={zoomStyle}>
              <RuntimeLayoutExpectedPreview screenId={screenId} screen={screen} breakpoint={breakpoint} assetManifest={assetManifest} packageAppearance={packageAppearance} />
              <div className="runtime-layout-safe-zone" />
              {screen.components.map((component) => {
                const rect = getRect(component, breakpoint);
                return (
                  <button key={component.component_id} type="button" className={`runtime-layout-block${selectedIds.includes(component.component_id) ? " is-selected" : ""}${component.locked ? " is-locked" : ""}${component.visible === false ? " is-hidden" : ""}${isCustomButtonContainer(component) ? " is-custom-button-container" : ""}`} style={{ ...rectToStyle(rect), ...componentStyle(component, assetManifest), zIndex: component.zIndex }} data-help-key="layout.component" data-component-id={component.component_id} data-component-type={component.component_type} data-auto-size={isCustomButtonContainer(component) ? "true" : undefined} data-action-kind={component.action?.kind ?? ""} data-action-url={component.action?.kind === "external_url" ? component.action.url ?? "" : ""} data-background-image-reference={component.style?.backgroundImage ?? ""} onPointerDown={(event) => startDrag(component, event)}>
                    <Move size={14} /><span className="runtime-layout-block-label">{componentLabel(component)}</span>{component.locked && <Lock size={13} />}{component.visible === false && <EyeOff size={13} />}{!component.locked && !isCustomButtonContainer(component) && selectedIds.includes(component.component_id) && <span className="runtime-layout-resize-handle" onPointerDown={(event) => startResize(component, event)} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="runtime-layout-inspector">
          {selected && selectedRect ? <>
            <header><strong>{componentLabel(selected)}</strong><small>布局组件</small></header>
            <details className="runtime-layout-fieldset" open>
              <summary>位置与尺寸</summary>
              {(["x", "y", "width", "height"] as const).map((field) => {
                const autoSizedField = selectedIsCustomButtonContainer && (field === "width" || field === "height");
                return <label key={field}>{field}<div className="runtime-layout-input-pair"><RangeControl disabled={selectedLocked || autoSizedField} ariaLabel={`${field} slider`} value={selectedRect[field]} min={field === "width" || field === "height" ? 2 : 0} max={100} step={1} helpKey="layout.rect" onChange={(value) => updateSelectedComponentRectField(field, value)} /><input disabled={selectedLocked || autoSizedField} type="number" value={selectedRect[field]} min={field === "width" || field === "height" ? 2 : 0} max={100} data-help-key="layout.rect" onChange={(event) => updateSelectedComponentRectField(field, Number(event.target.value))} /></div></label>;
              })}
              {selectedIsCustomButtonContainer && (
                <div className="runtime-layout-auto-size-note" role="note">
                  <strong>自动撑大容器</strong>
                  <span>拖动容器或编辑 x / y 可整体移动按钮；宽度和高度会根据内部按钮自动计算。</span>
                </div>
              )}
              <label>锚点<RichSelect disabled={selectedLocked || selectedIsCustomButtonContainer} ariaLabel="布局锚点" value={selectedRect.anchor ?? ""} options={anchorLabels} helpKey="layout.anchor" onChange={(anchor) => setSelectedRect({ ...selectedRect, anchor: anchor ? anchor as UILayoutAnchor : undefined })} /></label>
              <div className="runtime-layout-pixel-readout" data-help-key="layout.pixelPreview"><strong>当前画布像素</strong><span>{selectedPixelRect ? `x ${selectedPixelRect.x}px / y ${selectedPixelRect.y}px / ${selectedPixelRect.width} x ${selectedPixelRect.height}px` : "等待画布测量"}</span></div>
              <div className="runtime-layout-copy-row"><button type="button" disabled={selectedLocked} data-help-key="layout.copyBreakpoint" onClick={() => copySelectedRectTo("desktop")}>应用到桌面</button><button type="button" disabled={selectedLocked} data-help-key="layout.copyBreakpoint" onClick={() => copySelectedRectTo("mobile")}>应用到手机</button><button type="button" disabled={selectedLocked} data-help-key="layout.copyBreakpoint" onClick={() => copySelectedRectTo("both")}>同步两端</button></div>
            </details>
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
            {!selectedIsCustomButtonContainer && <details className="runtime-layout-fieldset">
              <summary>外观</summary>
              {(["backgroundColor", "color", "borderColor"] as const).map((field) => <label key={field}>{field}<div className="runtime-layout-color-row"><input disabled={selectedLocked} type="color" value={(selected.style?.[field] as string | undefined) ?? "#0d121f"} data-help-key="layout.color" onChange={(event) => setSelectedStyle({ [field]: event.target.value })} /><input disabled={selectedLocked} value={(selected.style?.[field] as string | undefined) ?? ""} data-help-key="layout.color" onChange={(event) => setSelectedStyle({ [field]: event.target.value || undefined })} /></div></label>)}
              {(["borderWidth", "borderRadius", "opacity", "padding", "gap", "backdropBlur", "fontSize"] as const).map((field, index) => <label key={field}>{field}<div className="runtime-layout-input-pair"><RangeControl disabled={selectedLocked} ariaLabel={`${field} slider`} min={field === "opacity" ? 0.1 : 0} max={field === "fontSize" ? 40 : 48} step={field === "opacity" ? 0.05 : 1} value={Number(selected.style?.[field] ?? (field === "opacity" ? 1 : 0))} helpKey="layout.styleNumber" onChange={(value) => setSelectedStyle({ [field]: value })} /><input disabled={selectedLocked} type="number" data-help-key="layout.styleNumber" min={0} max={100} step={field === "opacity" ? 0.05 : 1} value={Number(selected.style?.[field] ?? (field === "opacity" ? 1 : 0))} onChange={(event) => setSelectedStyle({ [field]: Number(event.target.value) })} /></div>{index === -1 ? null : null}</label>)}
              <label>阴影<RichSelect disabled={selectedLocked} ariaLabel="阴影样式" value={selected.style?.shadow ?? ""} helpKey="layout.shadow" options={[{ value: "", label: "默认" }, { value: "none", label: "无" }, { value: "soft", label: "柔和" }, { value: "strong", label: "强" }]} onChange={(shadow) => setSelectedStyle({ shadow: shadow ? shadow as UILayoutComponentStyle["shadow"] : undefined })} /></label>
            </details>}
            {!selectedIsCustomButtonContainer && <details className="runtime-layout-fieldset">
              <summary>文本</summary>
              {!selectedIsCustomButton && <label>显示名称<input disabled={selectedLocked} value={selected.label ?? ""} data-help-key="layout.label" onChange={(event) => updateSelectedComponent((component) => ({ ...component, label: event.target.value }))} /></label>}
              <label>字体<RichSelect disabled={selectedLocked} ariaLabel="字体资源" value={selected.style?.fontAssetId ?? ""} helpKey="layout.fontAsset" options={[{ value: "", label: "默认" }, ...fontAssetOptions]} onChange={(fontAssetId) => setSelectedStyle({ fontAssetId: fontAssetId || undefined })} /></label>
              <label>字重<RichSelect disabled={selectedLocked} ariaLabel="字体粗细" value={selected.style?.fontWeight ? String(selected.style.fontWeight) : ""} helpKey="layout.fontWeight" options={fontWeightOptions} onChange={(fontWeight) => setSelectedStyle({ fontWeight: fontWeight ? Number(fontWeight) : undefined })} /></label>
              <label>文本对齐<RichSelect disabled={selectedLocked} ariaLabel="文本对齐方式" value={selected.style?.textAlign ?? ""} helpKey="layout.textAlign" options={[{ value: "", label: "默认" }, { value: "left", label: "左" }, { value: "center", label: "居中" }, { value: "right", label: "右" }]} onChange={(textAlign) => setSelectedStyle({ textAlign: textAlign ? textAlign as UILayoutComponentStyle["textAlign"] : undefined })} /></label>
            </details>}
            {!selectedIsCustomButton && !selectedIsCustomButtonContainer && <details key={`background-${selected.component_id}`} className="runtime-layout-fieldset" open={isArtworkImageComponent(selected) ? true : undefined}>
              <summary>背景图</summary>
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
            </details>}
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
      <section className={`runtime-layout-status ${layoutHealthState === "ok" ? "ok" : `is-${layoutHealthState}`}`}>
        <button
          type="button"
          data-help-key="layout.healthDetails"
          data-testid="runtime-layout-health-status"
          data-health-state={layoutHealthState}
          onClick={() => setShowHealthDetails((value) => !value)}
        >
          UI 体检：{layoutHealthErrorCount > 0
            ? `${layoutHealthErrorCount} 个错误`
            : layoutHealthWarningCount > 0
              ? `${layoutHealthWarningCount} 个警告`
              : "通过"}
        </button>
        {showHealthDetails && (
          layoutHealthIssues.length === 0 ? (
            <p>布局会随保存进入 ui/layout.json；中间舞台只做轻量预览，不执行完整客户端。</p>
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
