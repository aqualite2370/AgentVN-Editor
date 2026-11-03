import { isStructuredCameraCommand } from "../camera/cameraMotion";
import type { RuntimeScript } from "./types";
import type { UISkinLayout } from "./uiSkin";
import { compareSemver } from "./compatibility";
import { RENPY_BUTTON_ROLE_PAGES, RENPY_MENU_FRAME_PROPERTIES, RENPY_NAVIGATION_PAGES } from "./renpyGui";
import { layoutPresentationTargets } from "./controlPresentation";

export const RENPY_LAYOUT_RUNTIME_VERSION = "0.8.0";
export const RENPY_MENU_PAGE_OVERRIDES_RUNTIME_VERSION = "0.9.0";
export const RENPY_HELP_LAYOUT_RUNTIME_VERSION = "0.10.0";
export const RENPY_SAVE_GRID_RUNTIME_VERSION = "0.11.0";
export const RENPY_BUTTON_FRAME_RUNTIME_VERSION = "0.12.0";
export const NVL_PRESENTATION_RUNTIME_VERSION = "0.13.0";
export const RENPY_BUTTON_ROLES_RUNTIME_VERSION = "0.14.0";
export const CUSTOM_COMPONENTS_RUNTIME_VERSION = "0.15.0";
export const NVL_PAGE_CLEAR_RUNTIME_VERSION = "0.16.0";
export const RENPY_MENU_FRAME_RUNTIME_VERSION = "0.16.1";
export const BUBBLE_PRESENTATION_RUNTIME_VERSION = "0.17.0";
export const DIALOG_PRESENTATION_CONFIG_RUNTIME_VERSION = "0.18.0";
export const DIALOGUE_MODE_LAYOUT_RUNTIME_VERSION = "0.19.0";
export const CONFIRMATION_LAYOUT_RUNTIME_VERSION = "0.20.0";
export const RENPY_SHARED_MENU_COMPONENTS_RUNTIME_VERSION = "0.21.0";
export const DIALOG_PORTRAIT_LAYOUT_RUNTIME_VERSION = "0.22.0";
export const PAGE_OPACITY_LAYERS_RUNTIME_VERSION = "0.23.0";
export const CONTROL_PRESENTATION_RUNTIME_VERSION = "0.24.0";
export const STORY_UI_HIDE_RUNTIME_VERSION = "0.25.0";
export const RENPY_TITLE_TEXT_RUNTIME_VERSION = "0.26.0";
export const GAME_VIEWPORT_RUNTIME_VERSION = "0.27.0";

export function minimumRuntimeVersionForLayout(scriptVersion: string, layout?: UISkinLayout): string {
  if (layout?.gameViewport && compareSemver(scriptVersion, GAME_VIEWPORT_RUNTIME_VERSION) < 0)
    scriptVersion = GAME_VIEWPORT_RUNTIME_VERSION;
  if (layout?.screens.some(screen => screen.screen_id === "player" && screen.components.some(component =>
    component.component_id === "quick_hide_ui_button" && component.visible !== false))
    && compareSemver(scriptVersion, STORY_UI_HIDE_RUNTIME_VERSION) < 0)
    scriptVersion = STORY_UI_HIDE_RUNTIME_VERSION;
  if (layout && (layout.advancedPresentationEnabled && layoutPresentationTargets(layout).length > 0
    || layout.screens.some(screen => screen.components.some(component => component.stateStyles)))
    && compareSemver(scriptVersion, CONTROL_PRESENTATION_RUNTIME_VERSION) < 0)
    scriptVersion = CONTROL_PRESENTATION_RUNTIME_VERSION;
  if (layout?.screens.some(screen => screen.components.some(component =>
    component.style?.backgroundOpacity !== undefined || component.style?.contentOpacity !== undefined))
    && compareSemver(scriptVersion, PAGE_OPACITY_LAYERS_RUNTIME_VERSION) < 0)
    scriptVersion = PAGE_OPACITY_LAYERS_RUNTIME_VERSION;
  if (layout?.dialogPortrait && Object.keys(layout.dialogPortrait).length
    && compareSemver(scriptVersion, DIALOG_PORTRAIT_LAYOUT_RUNTIME_VERSION) < 0)
    scriptVersion = DIALOG_PORTRAIT_LAYOUT_RUNTIME_VERSION;
  if ((layout?.confirmationLayout && Object.keys(layout.confirmationLayout).length
    || layout?.renpy?.confirmation && Object.keys(layout.renpy.confirmation).length)
    && compareSemver(scriptVersion, CONFIRMATION_LAYOUT_RUNTIME_VERSION) < 0)
    scriptVersion = CONFIRMATION_LAYOUT_RUNTIME_VERSION;
  if (layout?.dialogueLayouts && Object.keys(layout.dialogueLayouts).length
    && compareSemver(scriptVersion, DIALOGUE_MODE_LAYOUT_RUNTIME_VERSION) < 0)
    scriptVersion = DIALOGUE_MODE_LAYOUT_RUNTIME_VERSION;
  if (layout?.layout_type !== "renpy") return scriptVersion;
  let required = RENPY_LAYOUT_RUNTIME_VERSION;
  const requireAtLeast = (version: string) => {
    if (compareSemver(required, version) < 0) required = version;
  };
  if (layout.renpyTitleText && Object.values(layout.renpyTitleText).some(item =>
    item && (item.visible !== undefined || item.text !== undefined)))
    requireAtLeast(RENPY_TITLE_TEXT_RUNTIME_VERSION);
  const hasHelpLayout = layout.screens.some((screen) => screen.screen_id === "help")
    || Object.keys(layout.renpy?.help ?? {}).length > 0;
  if (hasHelpLayout) requireAtLeast(RENPY_HELP_LAYOUT_RUNTIME_VERSION);
  const hasMenuOverrides = (["preferences", "save_load", "history", "about", "gallery"] as const)
    .some((page) => Object.keys(layout.renpy?.[page] ?? {}).length > 0);
  if (hasMenuOverrides) requireAtLeast(RENPY_MENU_PAGE_OVERRIDES_RUNTIME_VERSION);
  const hasSaveGrid = [layout.renpy?.shared, layout.renpy?.save_load]
    .some((style) => style?.saveColumns !== undefined || style?.saveGap !== undefined);
  if (hasSaveGrid) requireAtLeast(RENPY_SAVE_GRID_RUNTIME_VERSION);
  const hasButtonFrame = [layout.renpy?.shared, layout.renpy?.title]
    .some((style) => style?.buttonBorders !== undefined || style?.buttonTile !== undefined);
  if (hasButtonFrame) requireAtLeast(RENPY_BUTTON_FRAME_RUNTIME_VERSION);
  const hasButtonRoles = [layout.renpy?.shared, ...RENPY_BUTTON_ROLE_PAGES.map((page) => layout.renpy?.[page])]
    .some((style) => Boolean(style?.buttonRoles && Object.keys(style.buttonRoles).length > 0));
  if (hasButtonRoles) requireAtLeast(RENPY_BUTTON_ROLES_RUNTIME_VERSION);
  const hasMenuFrame = [layout.renpy?.shared,
    ...RENPY_NAVIGATION_PAGES.filter(page => page !== "title").map(page => layout.renpy?.[page])]
    .some(style => RENPY_MENU_FRAME_PROPERTIES.some(([key]) => style?.[key] !== undefined));
  if (hasMenuFrame) requireAtLeast(RENPY_MENU_FRAME_RUNTIME_VERSION);
  const hasCustomComponents = layout.screens.some((screen) =>
    screen.components.some((component) => component.component_type === "custom_component"));
  if (hasCustomComponents) requireAtLeast(CUSTOM_COMPONENTS_RUNTIME_VERSION);
  if (layout.screens.find(screen => screen.screen_id === "game_menu")?.components
    .some(component => component.component_type === "custom_component" || component.component_type === "mask")) {
    requireAtLeast(RENPY_SHARED_MENU_COMPONENTS_RUNTIME_VERSION);
  }
  return compareSemver(scriptVersion, required) < 0 ? required : scriptVersion;
}

export const LEGACY_RUNTIME_VERSION = "0.2.0";
export const STRUCTURED_CAMERA_RUNTIME_VERSION = "0.3.0";
export const CAMERA_SEQUENCE_RUNTIME_VERSION = "0.4.0";
export const OPENING_AUDIO_RUNTIME_VERSION = "0.5.0";
export const CENTERED_NARRATION_RUNTIME_VERSION = "0.5.0";
export const ROLLBACK_CONTROL_RUNTIME_VERSION = "0.6.0";
export const GALLERY_ANCHOR_RUNTIME_VERSION = "0.7.0";
export const LEGACY_SCRIPT_SCHEMA_VERSION = "1.1.0";
export const STRUCTURED_CAMERA_SCRIPT_SCHEMA_VERSION = "1.2.0";
export const CAMERA_SEQUENCE_SCRIPT_SCHEMA_VERSION = "1.3.0";
export const OPENING_AUDIO_SCRIPT_SCHEMA_VERSION = "1.4.0";
export const CENTERED_NARRATION_SCRIPT_SCHEMA_VERSION = "1.4.0";
export const ROLLBACK_CONTROL_SCRIPT_SCHEMA_VERSION = "1.5.0";
export const GALLERY_ANCHOR_SCRIPT_SCHEMA_VERSION = "1.6.0";
export const NVL_PRESENTATION_SCRIPT_SCHEMA_VERSION = "1.7.0";
export const NVL_PAGE_CLEAR_SCRIPT_SCHEMA_VERSION = "1.8.0";
export const BUBBLE_PRESENTATION_SCRIPT_SCHEMA_VERSION = "1.9.0";
export const DIALOG_PRESENTATION_CONFIG_SCRIPT_SCHEMA_VERSION = "1.10.0";

type PresentationScript = Pick<RuntimeScript, "scenes">
  & Partial<Pick<RuntimeScript, "default_dialog_presentation" | "characters">>;

export function scriptUsesPresentationConfig(script: PresentationScript): boolean {
  return script.default_dialog_presentation !== undefined
    || Boolean(script.characters?.some(character => character.dialog_presentation !== undefined))
    || script.scenes.some(scene => scene.commands.some(command =>
      (command.type === "dialog" || command.type === "narration")
        && command.bubble_position !== undefined));
}

export function scriptUsesStructuredCamera(script: Pick<RuntimeScript, "scenes">): boolean {
  return script.scenes.some((scene) =>
    scene.commands.some((command) => command.type === "camera" && isStructuredCameraCommand(command))
  );
}

export function scriptUsesCameraSequence(script: Pick<RuntimeScript, "scenes">): boolean {
  return script.scenes.some((scene) =>
    scene.commands.some((command) =>
      command.type === "camera"
      && isStructuredCameraCommand(command)
      && command.motion.kind === "sequence"
    )
  );
}

export function scriptUsesOpeningAudio(script: Pick<RuntimeScript, "scenes"> & { opening_audio?: RuntimeScript["opening_audio"] }): boolean {
  return Array.isArray(script.opening_audio) && script.opening_audio.length > 0;
}

export function scriptUsesCenteredNarration(script: Pick<RuntimeScript, "scenes">): boolean {
  return script.scenes.some((scene) =>
    scene.commands.some((command) => command.type === "narration" && command.narration_style === "centered")
  );
}

export function scriptUsesNvlPresentation(script: Pick<RuntimeScript, "scenes">): boolean {
  return script.scenes.some((scene) =>
    scene.commands.some((command) =>
      (command.type === "dialog" || command.type === "narration")
      && command.presentation_mode === "nvl"
    )
  );
}

export function scriptUsesNvlPageClear(script: Pick<RuntimeScript, "scenes">): boolean {
  return script.scenes.some((scene) =>
    scene.commands.some((command) =>
      (command.type === "dialog" || command.type === "narration")
      && command.presentation_mode === "nvl"
      && command.clear_nvl_page_before === true
    )
  );
}

export function scriptUsesBubblePresentation(script: Pick<RuntimeScript, "scenes">): boolean {
  return script.scenes.some((scene) =>
    scene.commands.some((command) =>
      (command.type === "dialog" || command.type === "narration")
      && command.presentation_mode === "bubble"
    )
  );
}

export function scriptUsesRollbackControl(script: Pick<RuntimeScript, "scenes"> & { rollback?: RuntimeScript["rollback"] }): boolean {
  return Boolean(script.rollback)
    || script.scenes.some((scene) => scene.commands.some((command) => command.type === "rollback"));
}

export function scriptUsesGalleryAnchor(script: Pick<RuntimeScript, "scenes">): boolean {
  return script.scenes.some((scene) => scene.commands.some((command) => command.type === "gallery_anchor"));
}

export function minimumRuntimeVersionForScript(script: PresentationScript & { opening_audio?: RuntimeScript["opening_audio"]; rollback?: RuntimeScript["rollback"] }): string {
  if (scriptUsesPresentationConfig(script)) return DIALOG_PRESENTATION_CONFIG_RUNTIME_VERSION;
  if (scriptUsesBubblePresentation(script)) return BUBBLE_PRESENTATION_RUNTIME_VERSION;
  if (scriptUsesNvlPageClear(script)) return NVL_PAGE_CLEAR_RUNTIME_VERSION;
  if (scriptUsesNvlPresentation(script)) return NVL_PRESENTATION_RUNTIME_VERSION;
  if (scriptUsesGalleryAnchor(script)) return GALLERY_ANCHOR_RUNTIME_VERSION;
  if (scriptUsesRollbackControl(script)) return ROLLBACK_CONTROL_RUNTIME_VERSION;
  if (scriptUsesOpeningAudio(script)) return OPENING_AUDIO_RUNTIME_VERSION;
  if (scriptUsesCenteredNarration(script)) return CENTERED_NARRATION_RUNTIME_VERSION;
  if (scriptUsesCameraSequence(script)) return CAMERA_SEQUENCE_RUNTIME_VERSION;
  return scriptUsesStructuredCamera(script)
    ? STRUCTURED_CAMERA_RUNTIME_VERSION
    : LEGACY_RUNTIME_VERSION;
}

export function runtimeScriptSchemaVersion(script: PresentationScript & { opening_audio?: RuntimeScript["opening_audio"]; rollback?: RuntimeScript["rollback"] }): string {
  if (scriptUsesPresentationConfig(script)) return DIALOG_PRESENTATION_CONFIG_SCRIPT_SCHEMA_VERSION;
  if (scriptUsesBubblePresentation(script)) return BUBBLE_PRESENTATION_SCRIPT_SCHEMA_VERSION;
  if (scriptUsesNvlPageClear(script)) return NVL_PAGE_CLEAR_SCRIPT_SCHEMA_VERSION;
  if (scriptUsesNvlPresentation(script)) return NVL_PRESENTATION_SCRIPT_SCHEMA_VERSION;
  if (scriptUsesGalleryAnchor(script)) return GALLERY_ANCHOR_SCRIPT_SCHEMA_VERSION;
  if (scriptUsesRollbackControl(script)) return ROLLBACK_CONTROL_SCRIPT_SCHEMA_VERSION;
  if (scriptUsesOpeningAudio(script)) return OPENING_AUDIO_SCRIPT_SCHEMA_VERSION;
  if (scriptUsesCenteredNarration(script)) return CENTERED_NARRATION_SCRIPT_SCHEMA_VERSION;
  if (scriptUsesCameraSequence(script)) return CAMERA_SEQUENCE_SCRIPT_SCHEMA_VERSION;
  return scriptUsesStructuredCamera(script)
    ? STRUCTURED_CAMERA_SCRIPT_SCHEMA_VERSION
    : LEGACY_SCRIPT_SCHEMA_VERSION;
}
