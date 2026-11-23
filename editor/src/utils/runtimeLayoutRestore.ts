import {
  getDefaultUISkinLayout,
  type UILayoutComponent,
  type UILayoutScreenId,
  type UISkinLayout,
} from "../../../shared/cartridge/uiSkin";
import type { RuntimeLayoutType } from "../../../shared/cartridge/uiLayoutProfiles";

/** Restore editor selection without rewriting the project's legacy screen data. */
export function resolveRuntimeLayoutEditorScreen(
  type: RuntimeLayoutType,
  requested?: UILayoutScreenId,
): UILayoutScreenId {
  if (type === "agentvn" && requested === "game_menu") return "player";
  return requested ?? (type === "renpy" ? "title" : "player");
}

function hasRestorableGeometry(component: UILayoutComponent): boolean {
  return !component.locked
    && !["quick_menu", "quick_button", "choice_option", "main_menu_custom_button_container"]
      .includes(component.component_type);
}

function restorePageGeometry(layout: UISkinLayout, screenId: UILayoutScreenId, componentIds?: ReadonlySet<string>): UISkinLayout {
  const defaults = getDefaultUISkinLayout().screens.find((screen) => screen.screen_id === screenId);
  if (!defaults) return layout;
  const byId = new Map(defaults.components.map((component) => [component.component_id, component]));
  return {
    ...layout,
    screens: layout.screens.map((screen) => screen.screen_id !== screenId ? screen : {
      ...screen,
      components: screen.components.map((component) => {
        const original = byId.get(component.component_id);
        if ((componentIds && !componentIds.has(component.component_id))
          || !hasRestorableGeometry(component) || !original?.rect
          || original.component_type !== component.component_type) return component;
        return { ...component, rect: { ...original.rect } };
      }),
    }),
  };
}

/** Restore only built-in geometry on one page; never replace user content or styling. */
export function restoreRuntimeLayoutPage(layout: UISkinLayout, screenId: UILayoutScreenId): UISkinLayout {
  return restorePageGeometry(layout, screenId);
}

/** Restore all existing pages without replacing authored components or theme data. */
export function restoreAllRuntimeLayoutPages(layout: UISkinLayout): UISkinLayout {
  return layout.screens.reduce((current, screen) => restorePageGeometry(current, screen.screen_id), layout);
}

const dialogueComponentIds = new Set(["dialog_panel", "speaker_label", "dialog_text", "continue_indicator"]);

/** Repair dialogue independently of the designer's current page and preset selection. */
export function repairRuntimeDialogueLayout(layout: UISkinLayout): UISkinLayout {
  return restorePageGeometry(layout, "player", dialogueComponentIds);
}
