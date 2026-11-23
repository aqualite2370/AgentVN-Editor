import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { UISkinLayout } from "../../../../shared/cartridge/uiSkin";
import { isBuiltinTitleButton, resolveTitleButtonLabel } from "../../../../shared/cartridge/uiSkin";
import type { BackgroundFit } from "../../../../shared/cartridge/types";
import { placeRenpyTitleNavigation, renpyTitleObstacles, resolveRenpyTitleActionLabel, resolveRenpyTitleText } from "../../../../shared/cartridge/renpyTitleControls";
import {
  resolveRenpyNavigation,
  RENPY_TEMPLATE_VERSION,
} from "../../../../shared/cartridge/renpyGui";
import { useRenpyButtonRoleStyle, useRenpyButtonStateStyle } from "../../uiSkin/uiSkinRuntime";
import { PresentedControl } from "../../uiSkin/PresentedControl";
import "../../styles/renpy-button-roles.css";
import "./renpy-title.css";

export interface RenpyTitleAction {
  id: string;
  label: string;
  disabled?: boolean;
  componentId?: string;
  onClick: () => void;
}

/** The editor and the running game render this same component. No editor store. */
export function RenpyTitleView({ skin, title, version, actions, background, backgroundFit, backgroundDimming = 0, fontFamily, buttonAssetUrls, logicalViewport, contentOpacity, onSelectControl }: {
  skin: UISkinLayout;
  title: string;
  version?: string;
  actions: RenpyTitleAction[];
  background?: ReactNode;
  backgroundFit?: BackgroundFit;
  backgroundDimming?: number;
  fontFamily?: string;
  buttonAssetUrls?: Record<string, string | undefined>;
  /** Editor fit stages scale the entire logical canvas separately. Runtime
   * callers omit this and continue measuring their actual rendering frame. */
  logicalViewport?: { width: number; height: number };
  contentOpacity?: number;
  onSelectControl?: (componentId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const [navigationPlacement, setNavigationPlacement] = useState<{ x: number; y: number; clear: boolean }>();
  const [measuredScale, setScale] = useState(1);
  const logicalWidth = logicalViewport?.width, logicalHeight = logicalViewport?.height;
  const scale = logicalWidth !== undefined && logicalHeight !== undefined
    ? Math.max(0.01, Math.min(logicalWidth / 1280, logicalHeight / 720)) : measuredScale;
  const nav = resolveRenpyNavigation(skin.renpy);
  const buttonStateStyle = useRenpyButtonStateStyle(skin, buttonAssetUrls, scale);
  const titleButtonRole = useRenpyButtonRoleStyle("title_action", "title", scale, skin);
  const usesNineSlice = Boolean(skin.renpy?.shared?.buttonBorders && skin.renpy.shared.buttonImages?.normal);
  const components = skin.screens.find(screen => screen.screen_id === "title")?.components ?? [];
  const heading = resolveRenpyTitleText(skin.renpyTitleText, title, version);
  const componentIds: Record<string, string> = {
    "continue-game": "title_continue_button", "start-new-game": "title_start_button",
    "open-save-load": "title_save_load_button", "open-gallery": "title_gallery_button",
    "open-settings": "title_settings_button", "open-about": "title_about_button",
    "open-exit-confirmation": "title_exit_button", "open-help": "title_help_button",
  };
  useLayoutEffect(() => {
    if (logicalWidth !== undefined && logicalHeight !== undefined) return;
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const r = node.getBoundingClientRect();
      setScale(Math.max(0.01, Math.min(r.width / 1280, r.height / 720)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [logicalWidth, logicalHeight]);
  useLayoutEffect(() => {
    const node = ref.current, navigation = navigationRef.current;
    if (!node || !navigation) return;
    const measure = () => {
      // offset/client metrics stay in frame coordinates even when the editor
      // scales its whole preview stage. getBoundingClientRect would double-scale.
      const width = node.clientWidth, height = node.clientHeight;
      const preferred = { x: nav.x * scale, y: (height - navigation.offsetHeight) / 2,
        width: navigation.offsetWidth, height: navigation.offsetHeight };
      const result = placeRenpyTitleNavigation(preferred, renpyTitleObstacles(components, width, height),
        width, height, 8 * scale);
      const next = { x: result.rect.x, y: result.rect.y, clear: result.clear };
      setNavigationPlacement(old => old && old.x === next.x && old.y === next.y && old.clear === next.clear ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node); observer.observe(navigation);
    return () => observer.disconnect();
  }, [components, nav.x, scale]);
  const style = {
    "--renpy-scale": scale,
    "--renpy-nav-x": `${nav.x * scale}px`,
    "--renpy-nav-font": `${nav.fontSize * scale}px`,
    "--renpy-nav-gap": `${nav.spacing * scale}px`,
    "--renpy-idle": skin.tokens.colorMuted ?? "#888888",
    "--renpy-hover": skin.tokens.colorAccent ?? "#00b8c3",
    "--renpy-ink": skin.tokens.colorInk ?? "#ffffff",
    "--renpy-background-fit": backgroundFit === "stretch" ? "fill" : backgroundFit ?? "cover",
    "--renpy-background-dimming": Math.min(1, Math.max(0, backgroundDimming)),
    backgroundColor: skin.tokens.colorBackground ?? "#111111",
    fontFamily: fontFamily ?? '"Microsoft YaHei", "Noto Sans CJK SC", "PingFang SC", system-ui, sans-serif',
    ...buttonStateStyle,
  } as CSSProperties;
  return (
    <div ref={ref} className="renpy-title-view" data-testid="renpy-title-view"
      onClickCapture={onSelectControl ? event => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-ui-component-id]") : null;
        onSelectControl(target?.dataset.uiComponentId ?? "title_hero");
        event.preventDefault(); event.stopPropagation();
      } : undefined}
      data-renpy-template={RENPY_TEMPLATE_VERSION} data-renpy-scale={scale} style={style}>
      <div className="renpy-title-background" aria-hidden="true">{background}</div>
      <nav ref={navigationRef} className="renpy-title-navigation" aria-label="主菜单操作" data-testid="main-menu-actions"
        data-title-navigation-clear={navigationPlacement?.clear}
        style={{ opacity: contentOpacity, ...(navigationPlacement ? {
          left: navigationPlacement.x, top: navigationPlacement.y, transform: "none",
        } : {}) }}>
        {actions.map((action) => {
          const component = components.find(item => item.component_id === (action.componentId ?? componentIds[action.id] ?? action.id));
          return <PresentedControl key={action.id} layout={skin} component={component} scale={scale}
            assetUrls={buttonAssetUrls} applyBaseStyle={Boolean(component
              && (!isBuiltinTitleButton(component) || component.titleButtonStyleSource === "layout"))}>
          <button type="button"
          data-testid={action.id} data-renpy-button-frame={usesNineSlice ? "nine-slice" : undefined}
          className={`renpy-title-action${titleButtonRole.enabled ? " renpy-role-custom-control" : ""}`}
          data-renpy-role-custom={titleButtonRole.enabled ? "true" : undefined}
          data-renpy-role-styled={titleButtonRole.styled ? "true" : undefined}
          data-renpy-role-bordered={titleButtonRole.bordered ? "true" : undefined}
          data-renpy-role-opacity={titleButtonRole.opacityConfigured ? "true" : undefined}
          data-renpy-role-state={action.disabled ? "disabled" : "normal"}
          style={titleButtonRole.enabled ? { ...titleButtonRole.style,
            ...buttonStateStyle } : buttonStateStyle}
          disabled={action.disabled} onClick={action.onClick}>{component && isBuiltinTitleButton(component)
            ? resolveTitleButtonLabel(component.component_type, component.label, action.label)
            : resolveRenpyTitleActionLabel(component, action.label)}</button>
          </PresentedControl>;
        })}
      </nav>
      <PresentedControl layout={skin} component={components.find(item => item.component_type === "main_menu_hero")}
        assetUrls={buttonAssetUrls} scale={scale} applyBaseStyle={false}>
      <div className="renpy-title-heading" style={{ opacity: contentOpacity }}>
        {heading.title && <h1>{heading.title}</h1>}
        {heading.version && <p>{heading.version}</p>}
      </div>
      </PresentedControl>
    </div>
  );
}
