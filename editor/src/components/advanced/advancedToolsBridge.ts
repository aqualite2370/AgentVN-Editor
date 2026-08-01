export type AdvancedToolsTab = "settings" | "layout" | "theme" | "novel" | "assets" | "library" | "animation" | "preview" | "providers" | "history";

export interface AdvancedToolsRequest {
  id: string;
  tab: AdvancedToolsTab;
  title?: string;
  message?: string;
  assetStudioContext?: AssetStudioOpenContext & {
    onApplyAsset?: (asset: GeneratedAssetRecord) => void;
  };
}

export const advancedToolsEventName = "agentvn:open-advanced-tools";

export function requestAdvancedTools(request: Omit<AdvancedToolsRequest, "id">): void {
  window.dispatchEvent(
    new CustomEvent<AdvancedToolsRequest>(advancedToolsEventName, {
      detail: {
        ...request,
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      },
    })
  );
}
import type { AssetStudioOpenContext } from "../../asset-studio/types";
import type { GeneratedAssetRecord } from "../../providers/types";
