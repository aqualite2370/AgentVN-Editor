import type { RuntimeScreen } from "../store/runtimeStore";

interface RuntimeSystemBackState {
  screen: RuntimeScreen;
  returnScreen?: RuntimeScreen;
  pendingScreenNavigation?: { toScreen: RuntimeScreen };
  isUiHidden?: boolean;
}

interface RuntimeSystemBackActions {
  openMenu: () => void;
  closeMenu: () => void;
  openExitConfirmation: () => void;
  restoreUi?: () => void;
}

const childScreens = new Set<RuntimeScreen>([
  "save_load",
  "history",
  "settings",
  "gallery",
  "about",
  "help",
]);

/** Pending navigation is the latest user intent even before its visual swap. */
export function routeRuntimeSystemBack(
  state: RuntimeSystemBackState,
  actions: RuntimeSystemBackActions,
): void {
  const screen = state.pendingScreenNavigation?.toScreen ?? state.screen;
  if (screen === "playing") {
    if (state.isUiHidden) { actions.restoreUi?.(); return; }
    actions.openMenu();
    return;
  }

  if (screen === "main_menu") {
    actions.closeMenu();
    return;
  }

  if (childScreens.has(screen)) {
    actions.closeMenu();
    return;
  }

  if (screen === "title_menu" || screen === "library") {
    actions.openExitConfirmation();
  }
}
