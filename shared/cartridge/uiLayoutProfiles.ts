import { ensureRenpyHelpScreen, getDefaultUISkinLayout, migrateLegacyUISkinLayout, type UISkinLayout } from "./uiSkin";
import type { AssetManifestItem } from "./types";
import { assetIdFromUILayoutReference } from "./uiAssetReference";
import { minimumRuntimeVersionForLayout } from "./runtimeCapabilities";
import { compileControlPresentation, resolveLayoutPresentations } from "./controlPresentation";
import { referencedCustomComponentAssetIds } from "./customComponent";

export type RuntimeLayoutType = "agentvn" | "renpy";

/** Editor project data. Only the active layout is exported to a game cartridge. */
export interface RuntimeUILayoutProfiles {
  version: 1;
  activeType: RuntimeLayoutType;
  profiles: { agentvn: UISkinLayout; renpy?: UISkinLayout };
}

export interface RuntimeUILayoutSettings {
  runtimeUILayout?: UISkinLayout;
  runtimeUILayoutProfiles?: RuntimeUILayoutProfiles;
}

function isLayout(value: unknown): value is UISkinLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const layout = value as Partial<UISkinLayout>;
  return typeof layout.ui_layout_version === "string"
    && typeof layout.name === "string" && typeof layout.target_runtime === "string"
    && Boolean(layout.tokens && typeof layout.tokens === "object" && !Array.isArray(layout.tokens))
    && Array.isArray(layout.assets) && Array.isArray(layout.screens)
    && layout.screens.every((screen) => Boolean(screen && typeof screen.screen_id === "string"
      && Array.isArray(screen.components)));
}

export function resolveRuntimeUILayoutSettings(settings: RuntimeUILayoutSettings = {}): {
  runtimeUILayout: UISkinLayout;
  runtimeUILayoutProfiles: RuntimeUILayoutProfiles;
} {
  const existing = settings.runtimeUILayoutProfiles;
  const profiles: RuntimeUILayoutProfiles = existing
    ? structuredClone(existing)
    : {
      version: 1,
      activeType: "agentvn",
      profiles: { agentvn: migrateLegacyUISkinLayout(settings.runtimeUILayout ?? getDefaultUISkinLayout()) },
    };
  if (profiles.version !== 1 || !["agentvn", "renpy"].includes(profiles.activeType)
    || !isLayout(profiles.profiles?.agentvn)
    || (profiles.profiles.renpy !== undefined && !isLayout(profiles.profiles.renpy))
    || !isLayout(profiles.profiles[profiles.activeType])) {
    throw new Error("LAYOUT_PROFILES_INVALID: 布局类型或活动配置无效，原工程未被修改。");
  }
  let runtimeUILayout = structuredClone(profiles.profiles[profiles.activeType]!);
  // The collection selects the renderer, never a stale compatibility mirror or
  // a discriminator copied from the other profile. Do not rewrite inactive data.
  if (profiles.activeType === "renpy") {
    runtimeUILayout.layout_type = "renpy";
    runtimeUILayout = ensureRenpyHelpScreen(runtimeUILayout);
    runtimeUILayout.target_runtime = minimumRuntimeVersionForLayout(runtimeUILayout.target_runtime, runtimeUILayout);
  }
  else if (runtimeUILayout.layout_type === "renpy") delete runtimeUILayout.layout_type;
  runtimeUILayout.target_runtime = minimumRuntimeVersionForLayout(runtimeUILayout.target_runtime, runtimeUILayout);
  // Persist the same canonical active layout that the compatibility view uses.
  // Otherwise capability upgrades/help normalization only reach the mirror and
  // a later save or reopen changes the supposedly authoritative profile.
  // Keep both copies independent; inactive profiles and caller data stay intact.
  profiles.profiles[profiles.activeType] = structuredClone(runtimeUILayout);
  return {
    runtimeUILayoutProfiles: profiles,
    runtimeUILayout,
  };
}

export function updateActiveRuntimeUILayout(settings: RuntimeUILayoutSettings, layout: UISkinLayout) {
  const next = resolveRuntimeUILayoutSettings(settings);
  next.runtimeUILayoutProfiles.profiles[next.runtimeUILayoutProfiles.activeType] =
    structuredClone(migrateLegacyUISkinLayout(layout));
  return resolveRuntimeUILayoutSettings(next);
}

/** Title/dialog defaults; remaining Ren'Py pages are delivered incrementally. */
export function createRenpyUILayout(): UISkinLayout {
  const layout = getDefaultUISkinLayout();
  layout.layout_type = "renpy";
  layout.target_runtime = minimumRuntimeVersionForLayout(layout.target_runtime, layout);
  layout.name = "Ren’Py 默认布局";
  // Keep the built-in profile on the same restrained hierarchy as the
  // official template: white content, gray idle states, and cyan emphasis.
  // Page-specific or imported GUI values remain explicit overrides.
  layout.tokens.colorSurface = "#1c1c1c";
  layout.tokens.colorSurfaceStrong = "#2a2a2a";
  layout.tokens.colorAccent = "#00b8c3";
  layout.tokens.colorAccent2 = "#00b8c3";
  layout.tokens.colorMuted = "#888888";
  layout.tokens.colorInk = "#ffffff";
  layout.tokens.colorBackground = "#111111";
  layout.tokens.colorLine = "#555555";
  layout.tokens.colorPanel = "#1c1c1c";
  layout.tokens.colorPanelText = "#ffffff";
  layout.tokens.colorControl = "#1c1c1c";
  layout.tokens.colorControlHover = "#2a2a2a";
  layout.tokens.colorControlActive = "#00b8c3";
  layout.tokens.colorControlText = "#ffffff";
  layout.tokens.colorSliderTrack = "#004e49";
  layout.tokens.colorSliderActive = "#006e75";
  layout.tokens.colorSliderThumb = "#ffffff";
  layout.tokens.colorDialog = "#111111";
  layout.tokens.colorDialogText = "#ffffff";
  layout.tokens.colorSpeakerPlate = "#1c1c1c";
  layout.tokens.colorSpeakerText = "#ffffff";
  layout.tokens.colorChoice = "#00b8c3";
  layout.tokens.colorChoiceText = "#ffffff";
  layout.tokens.colorQuickMenu = "#111111";
  layout.tokens.colorFocus = "#00b8c3";
  const title = layout.screens.find((screen) => screen.screen_id === "title")!;
  title.components = title.components.filter((component) => component.component_type !== "mask");
  const customButtonContainer = title.components.find(
    (component) => component.component_type === "main_menu_custom_button_container",
  );
  if (customButtonContainer) {
    customButtonContainer.style = {
      ...customButtonContainer.style,
      backgroundColor: "rgba(0, 184, 195, 0.06)",
      borderColor: "rgba(0, 184, 195, 0.58)",
    };
  }
  const player = layout.screens.find((screen) => screen.screen_id === "player")!;
  const rects = {
    dialog_panel: { x: 0, y: 72, width: 100, height: 28 },
    speaker_label: { x: 12, y: 73, width: 24, height: 5 },
    dialog_text: { x: 12, y: 80, width: 76, height: 13 },
    continue_indicator: { x: 86, y: 91, width: 3, height: 3 },
  };
  for (const component of player.components) {
    const rect = rects[component.component_id as keyof typeof rects];
    if (rect) component.rect = { ...rect };
    if (component.component_type === "dialog_panel") {
      component.style = {
        ...component.style,
        backgroundColor: "#111111",
        borderRadius: 0,
        borderWidth: 0,
        padding: 0,
        backdropBlur: 0,
        shadow: "none",
      };
    } else if (component.component_type === "speaker_label") {
      const speakerStyle = { ...(component.style ?? {}) };
      delete speakerStyle.borderColor;
      delete speakerStyle.borderWidth;
      component.style = {
        ...speakerStyle,
        backgroundColor: "#1c1c1c",
        color: "#ffffff",
        borderRadius: 0,
        shadow: "none",
      };
    } else if (component.component_type === "dialog_text") {
      component.style = {
        ...component.style,
        color: "#ffffff",
      };
    } else if (component.component_type === "choice_option") {
      component.style = {
        ...component.style,
        backgroundColor: "transparent",
        color: "#ffffff",
        borderColor: "transparent",
        borderWidth: 0,
        borderRadius: 0,
        shadow: "none",
      };
    } else if (component.component_type === "stage_background") {
      component.style = { ...component.style, backgroundColor: "#111111" };
    } else if (component.component_type === "continue_indicator") {
      component.style = { ...component.style, color: "#ffffff" };
    } else if (component.component_type === "quick_menu") {
      component.style = {
        ...component.style,
        backgroundColor: "#111111",
        color: "#ffffff",
        borderColor: "#555555",
      };
    } else if (component.component_type === "quick_button") {
      // This is a new preset, not a migration of an authored layout. The
      // AgentVN drawer's local typography must not override the Ren'Py row's
      // shared role or differ from the native controls added at runtime.
      component.style = {
        backgroundColor: "transparent",
        color: "#888888",
        borderColor: "transparent",
        borderWidth: 0,
        borderRadius: 0,
        opacity: 1,
        backdropBlur: 0,
      };
    }
  }
  const withHelp = ensureRenpyHelpScreen(layout);
  withHelp.target_runtime = minimumRuntimeVersionForLayout(withHelp.target_runtime, withHelp);
  return withHelp;
}

export function switchRuntimeUILayoutType(settings: RuntimeUILayoutSettings, type: RuntimeLayoutType) {
  if (type !== "agentvn" && type !== "renpy") throw new Error("LAYOUT_TYPE_INVALID: 不支持的布局类型。");
  const next = resolveRuntimeUILayoutSettings(settings);
  if (type === "renpy" && !next.runtimeUILayoutProfiles.profiles.renpy) {
    next.runtimeUILayoutProfiles.profiles.renpy = createRenpyUILayout();
  }
  next.runtimeUILayoutProfiles.activeType = type;
  return resolveRuntimeUILayoutSettings(next);
}

/** References used by the active layout or authored per-choice styles. Declarations
 * in layout.assets are explicit dependencies, not the project's entire library. */
export function collectUILayoutAssetIds(
  value: unknown,
  assets: AssetManifestItem[],
): Set<string> {
  const byPath = new Map(assets.map((asset) => [asset.path, asset.asset_id]));
  const ids = new Set<string>();
  function visit(value: unknown, key = "") {
    if (typeof value === "string") {
      const ref = assetIdFromUILayoutReference(value);
      if (ref) ids.add(ref);
      // Runtime fontFamilyForAsset and the font packer both accept trimmed IDs.
      // Match their lookup without rewriting the authored layout/style.
      if (key === "fontAssetId" && value.trim()) ids.add(value.trim());
      if ((key === "assetId" || key === "asset_id") && value) ids.add(value);
      if (byPath.has(value)) ids.add(byPath.get(value)!);
    } else if (Array.isArray(value)) value.forEach((item) => visit(item));
    else if (value && typeof value === "object") {
      if (key === "presentation" || ["panelPresentation", "titlePresentation", "textPresentation", "speakerPresentation"].includes(key)) {
        const result = compileControlPresentation(value);
        if (result.definition) for (const id of referencedCustomComponentAssetIds(result.definition)) ids.add(id);
      }
      Object.entries(value).forEach(([field, item]) => visit(item, field));
    }
  }
  visit(value);
  return ids;
}

/** Game-export allowlist. Never apply this to a portable project: its library and
 * both layouts must remain complete. Legacy single-layout and no-layout exports
 * use the same selection; absence of profiles must not disable dependency pruning. */
export function filterRuntimeLayoutAssets(
  layout: UISkinLayout | undefined,
  assets: AssetManifestItem[],
  protectedAssetIds: Iterable<string>,
): AssetManifestItem[] {
  const active = collectUILayoutAssetIds(layout ? resolveLayoutPresentations(layout) : undefined, assets);
  for (const id of protectedAssetIds) active.add(id);
  return assets.filter((asset) => active.has(asset.asset_id));
}

/** Compatibility entry point; game exports now exclude unrelated library files too. */
export function filterInactiveRuntimeLayoutAssets(
  collection: RuntimeUILayoutProfiles | undefined,
  assets: AssetManifestItem[],
  protectedAssetIds: Iterable<string>,
): AssetManifestItem[] {
  const layout = collection
    ? resolveRuntimeUILayoutSettings({ runtimeUILayoutProfiles: collection }).runtimeUILayout : undefined;
  return filterRuntimeLayoutAssets(layout, assets, protectedAssetIds);
}
