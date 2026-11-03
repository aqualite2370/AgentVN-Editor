import type { RuntimeScreen } from "../../store/runtimeStore";
import type { CSSProperties } from "react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useRenpyButtonRoleStyle, useRenpyButtonStateStyle, useRuntimeUILayout, useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import type { RenpyNavigationPage } from "../../../../shared/cartridge/renpyGui";
import "./renpy-menu.css";
import { PresentedControl } from "../../uiSkin/PresentedControl";

export type RenpyMenuScreen = Extract<RuntimeScreen, "save_load" | "history" | "settings" | "gallery" | "about" | "help">;

const actions: Array<{ screen: RenpyMenuScreen; label: string; testId: string }> = [
  { screen: "save_load", label: "存档", testId: "renpy-menu-save-load" },
  { screen: "history", label: "历史", testId: "renpy-menu-history" },
  { screen: "settings", label: "设置", testId: "renpy-menu-settings" },
  { screen: "about", label: "关于", testId: "renpy-menu-about" },
  { screen: "help", label: "帮助", testId: "renpy-menu-help" },
  { screen: "gallery", label: "画廊", testId: "renpy-menu-gallery" },
];

/**
 * The auxiliary pages retain their existing behavior but share the Ren'Py
 * page navigator. It deliberately invokes the public Runtime store actions.
 */
export function RenpyMenuNavigation({ activeScreen, presentedScreen = activeScreen }:
  { activeScreen: RenpyMenuScreen; presentedScreen?: RenpyMenuScreen }) {
  const skin = useRuntimeUILayout();
  const buttonStateStyle = useRenpyButtonStateStyle(undefined, undefined, "var(--renpy-menu-scale)");
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const launchTransition = useRuntimeStore((state) => state.launchTransition);
  const openSaveLoad = useRuntimeStore((state) => state.openSaveLoad);
  const openHistory = useRuntimeStore((state) => state.openHistory);
  const openSettings = useRuntimeStore((state) => state.openSettings);
  const openGallery = useRuntimeStore((state) => state.openGallery);
  const openAbout = useRuntimeStore((state) => state.openAbout);
  const openHelp = useRuntimeStore((state) => state.openHelp);
  const openExitConfirmation = useRuntimeStore((state) => state.openExitConfirmation);
  const closeMenu = useRuntimeStore((state) => state.closeMenu);
  const page = presentedScreen === "settings" ? "preferences" : presentedScreen;
  const navigationScreen = skin.screens.find(screen => screen.screen_id === page)?.components
    .some(component => component.component_type === "game_menu_nav") ? page : "game_menu";
  const navigationLayout = useUILayoutStyle(navigationScreen, "game_menu_nav");
  const navigationStyle = { ...navigationLayout.style };
  // The structured menu frame owns the rail geometry. Consume the same
  // authored material/font/assets as other controls without restoring the
  // legacy free-layout rectangle over that rail.
  for (const property of ["position", "left", "top", "right", "bottom", "width", "height", "transform", "zIndex"] as const)
    delete navigationStyle[property];

  if (skin.layout_type !== "renpy") return null;
  const usesNineSlice = Boolean(skin.renpy?.shared?.buttonBorders && skin.renpy.shared.buttonImages?.normal);

  const disabled = !currentGame || launchTransition !== "idle";
  const navigate: Record<RenpyMenuScreen, () => void> = {
    save_load: () => { if (activeScreen !== "save_load") void openSaveLoad(); },
    history: () => { if (activeScreen !== "history") openHistory(); },
    settings: () => { if (activeScreen !== "settings") openSettings(); },
    gallery: () => { if (activeScreen !== "gallery") openGallery(); },
    about: () => { if (activeScreen !== "about") openAbout(); },
    help: () => { if (activeScreen !== "help") openHelp(); },
  };

  return (
    <>
    <PresentedControl layout={skin} component={navigationLayout.component}
      assetUrls={currentGame?.assetUrls} applyBaseStyle={false}>
    <nav className="renpy-menu-navigation" aria-label="进阶页面导航" data-testid="renpy-menu-navigation"
      style={navigationStyle}>
      {actions
        .filter((action) => action.screen !== "gallery" || Boolean(currentGame?.gallery.length))
        .map((action) => (
          <RenpyNavigationButton
            key={action.screen}
            action={action}
            page={page}
            buttonStateStyle={buttonStateStyle}
            usesNineSlice={usesNineSlice}
            aria-current={activeScreen === action.screen ? "page" : undefined}
            disabled={disabled}
            onClick={navigate[action.screen]}
          />
        ))}
      <RenpyNavigationButton action={{ screen: activeScreen, label: "退出", testId: "renpy-menu-exit" }}
        page={page} buttonStateStyle={buttonStateStyle}
        usesNineSlice={usesNineSlice}
        disabled={launchTransition !== "idle"} onClick={openExitConfirmation} />
    </nav>
    </PresentedControl>
    <div className="renpy-menu-return" data-return-placement={presentedScreen === "settings" ? "bottom" : "top"}>
      <RenpyNavigationButton action={{ screen: activeScreen, label: "返回", testId: "renpy-menu-return" }}
        page={page} buttonStateStyle={buttonStateStyle}
        usesNineSlice={usesNineSlice}
        disabled={launchTransition !== "idle"} onClick={closeMenu} />
    </div>
    </>
  );
}

function RenpyNavigationButton({
  action, page, buttonStateStyle, usesNineSlice, disabled, onClick,
  ...stateProps
}: {
  action: { screen: RenpyMenuScreen; label: string; testId: string };
  page: Exclude<RenpyNavigationPage, "title">;
  buttonStateStyle: CSSProperties;
  usesNineSlice: boolean;
  disabled: boolean;
  onClick: () => void;
  "aria-current"?: "page";
}) {
  const role = useRenpyButtonRoleStyle("page_navigation", page, "var(--renpy-menu-scale)");
  return <button type="button"
    className={`renpy-menu-navigation-action${role.enabled ? " renpy-role-custom-control" : ""}`}
    data-testid={action.testId}
    data-renpy-button-frame={usesNineSlice ? "nine-slice" : undefined}
    data-renpy-role-custom={role.enabled ? "true" : undefined}
    data-renpy-role-styled={role.styled ? "true" : undefined}
    data-renpy-role-bordered={role.bordered ? "true" : undefined}
    data-renpy-role-opacity={role.opacityConfigured ? "true" : undefined}
    data-renpy-role-state={disabled ? "disabled" : stateProps["aria-current"] ? "selected" : "normal"}
    aria-current={stateProps["aria-current"]} disabled={disabled}
    style={role.enabled ? { ...buttonStateStyle, ...role.style } : buttonStateStyle}
    onClick={onClick}>{action.label}</button>;
}
