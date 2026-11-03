import type { CSSProperties, ReactNode } from "react";
import type {
  CustomComponentDefinition,
  CustomComponentNode,
} from "../../../shared/cartridge/customComponent";
import {
  referencedCustomComponentAssetIds,
  validateCustomComponentDefinition,
} from "../../../shared/cartridge/customComponent";
import type { UILayoutScreenId } from "../../../shared/cartridge/uiSkin";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import { toRuntimeAssetUrl } from "../utils/runtimeAssetUrl";
import { useRuntimeStore } from "../store/runtimeStore";
import { useRuntimeUILayout, useUILayoutComponents } from "./uiSkinRuntime";
import { PresentedControl } from "./PresentedControl";

const EMPTY_ASSET_URLS: Record<string, string> = {};

function createBindings(
  title: string,
  author: string,
  sceneTitle: string,
  speaker: string,
  primaryAsset?: { display_name?: string; filename?: string },
): Record<string, string> {
  const filename = primaryAsset?.filename ?? "";
  const displayName = primaryAsset?.display_name ?? filename;
  return {
    "project.title": title,
    "project.author": author,
    "asset.display_name": displayName,
    "asset.filename": filename,
    "runtime.scene_title": sceneTitle,
    "runtime.speaker": speaker,
  };
}

function scopeClass(componentId: string): string {
  return `agentvn-component-${componentId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function scopedStyles(definition: CustomComponentDefinition, scope: string): string {
  return Object.entries(definition.styles).map(([selector, declarations]) => {
    const match = /^\.([a-z]+)(.*)$/i.exec(selector);
    if (!match) return "";
    const scopedSelector = match[1] === "root"
      ? `.${scope}.root${match[2]}`
      : `.${scope} .${match[1]}${match[2]}`;
    const body = Object.entries(declarations).map(([property, value]) => `${property}:${value}`).join(";");
    return `${scopedSelector}{${body}}`;
  }).join("\n");
}

function renderNode(
  node: CustomComponentNode,
  scope: string,
  bindings: Record<string, string>,
  assetUrls: Record<string, string>,
  runAction: (action: NonNullable<CustomComponentNode["action"]>) => void,
  key: string,
  isRoot = false,
): ReactNode {
  if (node.tag === "img") {
    const source = node.assetId ? toRuntimeAssetUrl(assetUrls[node.assetId]) : undefined;
    return <img
      key={key}
      className={[isRoot ? scope : "", node.className].filter(Boolean).join(" ") || undefined}
      aria-label={node.ariaLabel}
      alt={node.ariaLabel ?? ""}
      src={source}
      data-asset-id={node.assetId}
      data-asset-missing={!source || undefined}
    />;
  }
  const Tag = node.tag;
  const className = [isRoot ? scope : "", node.className].filter(Boolean).join(" ") || undefined;
  const content = node.binding ? bindings[node.binding] ?? ""
      : node.text !== undefined ? node.text
      : node.children.map((child, index) => renderNode(
          child, scope, bindings, assetUrls, runAction, `${key}.${index}`,
        ));
  const props = {
    key,
    className,
    "aria-label": node.ariaLabel ?? (node.binding ? bindings[node.binding] : node.text),
    ...(node.binding ? { "data-binding": node.binding } : {}),
    ...(node.tag === "button" ? { type: "button" as const, onClick: () => node.action && runAction(node.action) } : {}),
  };
  return <Tag {...props}>{content}</Tag>;
}

export function RuntimeCustomComponentLayer({ screen }: { screen: UILayoutScreenId }) {
  const skin = useRuntimeUILayout();
  const components = useUILayoutComponents(screen, "custom_component");
  const title = useRuntimeStore((state) => state.currentGame?.title ?? "");
  const author = useRuntimeStore((state) => state.currentGame?.author ?? "");
  const assetUrls = useRuntimeStore((state) => state.currentGame?.assetUrls ?? EMPTY_ASSET_URLS);
  const sceneTitle = useRuntimeStore((state) => {
    const sceneId = state.engineState.currentSceneId;
    return state.currentGame?.script.scenes.find((scene) => scene.scene_id === sceneId)?.title ?? "";
  });
  const speaker = useRuntimeStore((state) => state.engineState.dialog?.speaker ?? "");
  const screenState = useRuntimeStore((state) => state.screen);

  if (components.length === 0) return null;
  return <div className="runtime-custom-component-layer" data-testid="runtime-custom-component-layer"
    data-ui-component-scope={screen} data-no-advance="true">
    {components.map(({ component, style }) => {
      const definition = component.customComponent;
      if (!definition || validateCustomComponentDefinition(definition).length > 0) return null;
      const scope = scopeClass(component.component_id);
      const primaryAssetId = referencedCustomComponentAssetIds(definition)[0];
      const primaryAsset = primaryAssetId
        ? useRuntimeStore.getState().currentGame?.manifest.assets.find(
          (asset) => asset.asset_id === primaryAssetId,
        )
        : undefined;
      const bindings = createBindings(title, author, sceneTitle, speaker, primaryAsset);
      const runAction = (action: NonNullable<CustomComponentNode["action"]>) => {
        const state = useRuntimeStore.getState();
        switch (action) {
          case "start_game": void state.startNewGame(); break;
          case "open_save_load": void state.openSaveLoad(); break;
          case "open_preferences": state.openSettings(); break;
          case "open_history": state.openHistory(); break;
          case "open_gallery": state.openGallery(); break;
          case "open_about": state.openAbout(); break;
          case "open_help": state.openHelp(); break;
          case "close_menu": state.closeMenu(); break;
          case "rollback": state.rollback(); break;
          case "toggle_auto": state.toggleAuto(); break;
          case "toggle_skip": state.toggleSkip(); break;
          case "quick_save":
            void state.quickSave().catch((error) =>
              reportFrontendError("runtime.custom-component-action", error, { action }));
            break;
          case "quick_load": state.requestQuickLoad(); break;
        }
      };
      const frameStyle: CSSProperties = {
        ...style,
        zIndex: Math.max(31, Math.min(999, component.zIndex ?? 80)),
        pointerEvents: component.visible === false ? "none" : undefined,
      };
      return <PresentedControl key={component.component_id} layout={skin} component={component}
        assetUrls={assetUrls} applyBaseStyle={false}>
      <div
        className="runtime-custom-component"
        style={frameStyle}
        hidden={component.visible === false}
        data-testid="runtime-custom-component"
        data-component-id={component.component_id}
        data-primary-asset-id={primaryAssetId}
        data-primary-asset-filename={primaryAsset?.filename}
        data-primary-asset-display-name={primaryAsset?.display_name}
        data-runtime-screen={screenState}
      >
        <style>{scopedStyles(definition, scope)}</style>
        {renderNode(definition.root, scope, bindings, assetUrls, runAction, component.component_id, true)}
      </div>
      </PresentedControl>;
    })}
  </div>;
}
