import { createContext, useContext, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties } from "react";
import { resolveRenpyMenuFrame, resolveRenpyNavigation } from "../../../../shared/cartridge/renpyGui";
import { UILayoutMaskLayer, useRuntimeUILayout } from "../../uiSkin/uiSkinRuntime";
import { RuntimeCustomComponentLayer } from "../../uiSkin/RuntimeCustomComponentLayer";
import { useRenpyButtonRoleStyle } from "../../uiSkin/uiSkinRuntime";
import { useRuntimeStore } from "../../store/runtimeStore";
import { RenpyMenuNavigation, type RenpyMenuScreen } from "./RenpyMenuNavigation";
import "./renpy-menu.css";

export const RenpyMenuManagedContext = createContext(false);

/**
 * AgentVN keeps its authored page unchanged. Ren'Py gives the same functional
 * page content a separate navigation rail, so authored absolute rectangles
 * cannot overlap the navigation or shrink the available menu surface.
 */
export function RenpyMenuFrame({ activeScreen, presentedScreen = activeScreen, className = "", children,
  managedOutlet = false, contentBlocked = false, ...props }:
  ComponentPropsWithoutRef<"main"> & { activeScreen: RenpyMenuScreen; presentedScreen?: RenpyMenuScreen;
    managedOutlet?: boolean; contentBlocked?: boolean }) {
  const skin = useRuntimeUILayout();
  const managed = useContext(RenpyMenuManagedContext);
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 1280, height: 720 });
  const isRenpy = skin.layout_type === "renpy";
  const page = presentedScreen === "settings" ? "preferences" : presentedScreen;
  const navigation = resolveRenpyNavigation(skin.renpy, page);
  const frame = resolveRenpyMenuFrame(skin.renpy, page);
  const navigationRole = useRenpyButtonRoleStyle("page_navigation", page, "var(--renpy-menu-scale)");
  const aboutTitle = useRuntimeStore(state => state.currentGame?.manifest.shell?.about?.title?.trim());
  const title = presentedScreen === "settings" ? "设置" : presentedScreen === "save_load" ? "存档 / 读档"
    : presentedScreen === "history" ? "历史" : presentedScreen === "about" ? aboutTitle || "关于"
    : presentedScreen === "help" ? "帮助" : "画廊";
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !isRenpy || managed) return;
    const measure = () => {
      // The padding represents the actual native safe area.
      const css = getComputedStyle(node);
      const width = node.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const height = node.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
      setSize((old) => old.width === width && old.height === height ? old : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [isRenpy, managed]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !isRenpy || managed || !contentBlocked) return;
    const outlet = node.querySelector<HTMLElement>('[data-testid="renpy-menu-content"]');
    if (!outlet?.contains(document.activeElement)) return;
    // Loading disables only the shared content outlet. Escape can originate
    // from its paginator, so move focus to the live rail before the next paint.
    const target = node.querySelector<HTMLElement>(
      ".renpy-menu-navigation button[aria-current='page']:not(:disabled)",
    ) ?? node.querySelector<HTMLElement>(".renpy-menu-navigation button:not(:disabled)");
    if (target) target.focus({ preventScroll: true });
    else {
      node.tabIndex = -1;
      node.focus({ preventScroll: true });
    }
  }, [isRenpy, managed, contentBlocked, activeScreen]);
  if (!isRenpy) return <main className={className} {...props}>{children}</main>;
  if (managed) return <main {...props} className={`${className} renpy-menu-content`}>{children}</main>;

  const borders = skin.renpy?.shared?.buttonImages?.normal ? skin.renpy.shared.buttonBorders : undefined;
  const borderHeight = (borders?.top ?? 0) + (borders?.bottom ?? 0);
  const borderWidth = (borders?.left ?? 0) + (borders?.right ?? 0);
  const buttonWidth = navigationRole.enabled ? navigationRole.geometry.width : navigation.fontSize * 2 + 16 + borderWidth;
  const buttonHeight = navigationRole.enabled ? navigationRole.geometry.height : navigation.fontSize * 1.45 + 6 + borderHeight;
  const railWidth = Math.max(frame.menuNavigationWidth, navigation.x + buttonWidth + 12);
  // Reserve the separate return action at either safe-frame edge.
  const railHeight = 7 * buttonHeight + 6 * navigation.spacing;
  const availableHeight = Math.max(1, size.height - 16);
  const scale = Math.max(.01, Math.min(
    size.width / 1280, size.height / 720,
    size.width / (railWidth + frame.menuContentLeft + frame.menuContentRight + 480),
    availableHeight / (frame.menuTopPadding + frame.menuContentTop + frame.menuBottomPadding + 300),
    availableHeight / (railHeight + 2 * (buttonHeight + frame.menuBottomPadding + 12)),
    availableHeight / (railHeight + 2 * frame.menuTopPadding),
  ));
  const style = {
    "--renpy-menu-scale": scale,
    "--renpy-menu-rail": `${railWidth * scale}px`,
    "--renpy-nav-x": `${navigation.x * scale}px`,
    "--renpy-nav-font": `${navigation.fontSize * scale}px`,
    "--renpy-nav-gap": `${navigation.spacing * scale}px`,
    "--renpy-menu-top": `${frame.menuTopPadding * scale}px`,
    "--renpy-menu-bottom": `${frame.menuBottomPadding * scale}px`,
    "--renpy-content-left": `${frame.menuContentLeft * scale}px`,
    "--renpy-content-right": `${frame.menuContentRight * scale}px`,
    "--renpy-content-top": `${frame.menuContentTop * scale}px`,
    "--renpy-menu-title-x": `${frame.menuTitleX * scale}px`,
    "--renpy-menu-title-font": `${frame.menuTitleFontSize * scale}px`,
    "--renpy-ink": skin.tokens.colorInk ?? "#ffffff",
    "--renpy-idle": skin.tokens.colorMuted ?? "#888888",
    "--renpy-hover": skin.tokens.colorAccent ?? "#00b8c3",
    ...props.style,
  } as CSSProperties;
  return <main {...props} ref={ref} className="renpy-menu-frame" style={style}
    data-renpy-menu-frame="" data-renpy-menu-scale={scale}>
    <UILayoutMaskLayer screen="game_menu" />
    <RenpyMenuNavigation activeScreen={activeScreen} presentedScreen={presentedScreen} />
    <div className="renpy-menu-body" data-runtime-motion-surface={managedOutlet || undefined}>
      {presentedScreen !== "about" && <h2 className="renpy-menu-title" data-testid="renpy-menu-title">{title}</h2>}
      <div className={managedOutlet ? "renpy-menu-outlet" : `${className} renpy-menu-content`}
        data-testid="renpy-menu-content"
        ref={element => { if (element) element.inert = contentBlocked; }}
        aria-hidden={contentBlocked || undefined}>
        {children}
      </div>
    </div>
    <RuntimeCustomComponentLayer screen="game_menu" />
  </main>;
}
