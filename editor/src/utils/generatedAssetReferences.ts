import type { AssetRef, AssetType } from "../types/assets";
import type { GameCommand } from "../types/commands";
import type { SceneBeat } from "../types/scene";

const generationVisualAssetTypes = new Set<AssetType>(["background", "sprite", "portrait", "ui"]);

export interface GenerationAssetCatalogEntry {
  asset_id: string;
  asset_type: AssetType;
  display_name?: string;
  character_id?: string;
}

function isPlaceholderAsset(asset: AssetRef): boolean {
  const tags = asset.metadata.tags ?? [];
  return asset.metadata.placeholder === true || tags.includes("placeholder") || tags.includes("missing");
}

function isGenerationVisualAsset(asset: AssetRef): boolean {
  return generationVisualAssetTypes.has(asset.asset_type) || asset.metadata.mime_type?.startsWith("image/") === true;
}

export function buildGenerationAssetCatalog(assets: AssetRef[]): GenerationAssetCatalogEntry[] {
  return assets.flatMap((asset) => {
    const assetId = asset.asset_id.trim();
    if (!assetId || !isGenerationVisualAsset(asset) || isPlaceholderAsset(asset)) return [];
    const displayName = asset.metadata.display_name?.trim() || asset.metadata.filename?.trim();
    const characterId = asset.metadata.character_id?.trim();
    return [{
      asset_id: assetId,
      asset_type: asset.asset_type,
      ...(displayName ? { display_name: displayName } : {}),
      ...(characterId ? { character_id: characterId } : {}),
    }];
  });
}

export function buildGenerationAssetContextText(assets: AssetRef[]): string {
  return JSON.stringify({
    policy: {
      reference_only_listed_visual_assets: true,
      omit_unavailable_visual_commands: true,
      never_invent_asset_ids: true,
    },
    visual_assets: buildGenerationAssetCatalog(assets),
  });
}

export function buildGenerationAssetSummaryText(assets: AssetRef[]): string {
  const visualAssetIdsByType: Partial<Record<AssetType, string[]>> = {};
  for (const asset of buildGenerationAssetCatalog(assets)) {
    const ids = visualAssetIdsByType[asset.asset_type] ?? [];
    ids.push(asset.asset_id);
    visualAssetIdsByType[asset.asset_type] = ids;
  }
  return JSON.stringify({
    policy: {
      reference_only_listed_visual_assets: true,
      omit_unavailable_visual_commands: true,
      never_invent_asset_ids: true,
    },
    visual_asset_ids_by_type: visualAssetIdsByType,
  });
}

export interface RemovedGeneratedAssetReference {
  command_type: string;
  field: string;
  asset_id: string;
  action: "removed" | "cleared" | "converted_to_narration";
}

export function sanitizeGeneratedSceneAssetReferences(
  scene: SceneBeat,
  assets: AssetRef[],
): { scene: SceneBeat; removed: RemovedGeneratedAssetReference[] } {
  const assetTypesById = new Map<string, Set<AssetType>>();
  for (const asset of buildGenerationAssetCatalog(assets)) {
    const types = assetTypesById.get(asset.asset_id) ?? new Set<AssetType>();
    types.add(asset.asset_type);
    assetTypesById.set(asset.asset_id, types);
  }

  function hasCompatibleAsset(assetId: string, expected: "background" | "character" | "image"): boolean {
    const types = assetTypesById.get(assetId.trim());
    if (!types) return false;
    if (expected === "background") return types.has("background");
    if (expected === "character") return types.has("sprite") || types.has("portrait");
    return types.size > 0;
  }

  const removed: RemovedGeneratedAssetReference[] = [];
  let changed = false;
  const commands = scene.commands.flatMap<GameCommand>((command) => {
    if (command.type === "background" && !hasCompatibleAsset(command.background_id, "background")) {
      changed = true;
      removed.push({
        command_type: command.type,
        field: "background_id",
        asset_id: command.background_id,
        action: "removed",
      });
      return [];
    }

    if (command.type === "show_image" && !hasCompatibleAsset(command.image_id, "image")) {
      changed = true;
      const fallbackText = command.caption?.trim() || command.alt?.trim();
      removed.push({
        command_type: command.type,
        field: "image_id",
        asset_id: command.image_id,
        action: fallbackText ? "converted_to_narration" : "removed",
      });
      return fallbackText ? [{ type: "narration", text: fallbackText }] : [];
    }

    if (command.type === "sprite" && command.visible !== false && !hasCompatibleAsset(command.sprite_id, "character")) {
      changed = true;
      removed.push({
        command_type: command.type,
        field: "sprite_id",
        asset_id: command.sprite_id,
        action: "removed",
      });
      return [];
    }

    if (command.type === "dialog" && command.portrait?.trim() && !hasCompatibleAsset(command.portrait, "character")) {
      changed = true;
      removed.push({
        command_type: command.type,
        field: "portrait",
        asset_id: command.portrait,
        action: "cleared",
      });
      return [{ ...command, portrait: null }];
    }

    return [command];
  });

  return {
    scene: changed ? { ...scene, commands } : scene,
    removed,
  };
}
