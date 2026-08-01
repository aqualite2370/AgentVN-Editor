import type { AssetLibraryAssetLocation, AssetLibrarySettings } from "../types/project";
import { sanitizeAssetId } from "./projectAssets";

export type AssetDropMode = "move" | "link";

export interface AssetDragPayload {
  assetIds: string[];
  sourceFolderId: string | null;
}

export interface AssetDropResult {
  library: AssetLibrarySettings;
  changedAssetIds: string[];
  skippedAssetIds: string[];
}

export function physicalPointToCssPoint(
  x: number,
  y: number,
  scaleFactor: number,
): { x: number; y: number } {
  const safeScaleFactor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: x / safeScaleFactor,
    y: y / safeScaleFactor,
  };
}

export function assetLibraryLocation(
  library: AssetLibrarySettings,
  assetId: string,
): AssetLibraryAssetLocation {
  return library.assetLocations[assetId] ?? { primaryFolderId: null, linkedFolderIds: [] };
}

function sameLocation(left: AssetLibraryAssetLocation, right: AssetLibraryAssetLocation): boolean {
  return left.primaryFolderId === right.primaryFolderId
    && left.linkedFolderIds.length === right.linkedFolderIds.length
    && left.linkedFolderIds.every((folderId, index) => folderId === right.linkedFolderIds[index]);
}

function storeLocation(
  locations: AssetLibrarySettings["assetLocations"],
  assetId: string,
  location: AssetLibraryAssetLocation,
) {
  if (!location.primaryFolderId && location.linkedFolderIds.length === 0) {
    delete locations[assetId];
    return;
  }
  locations[assetId] = location;
}

export function applyAssetLibraryDrop(
  library: AssetLibrarySettings,
  payload: AssetDragPayload,
  targetFolderId: string | null,
  mode: AssetDropMode,
): AssetDropResult {
  const folderIds = new Set(library.folders.map((folder) => folder.folder_id));
  const uniqueAssetIds = Array.from(new Set(payload.assetIds.filter(Boolean)));
  const changedAssetIds: string[] = [];
  const skippedAssetIds: string[] = [];

  if ((targetFolderId && !folderIds.has(targetFolderId)) || (mode === "link" && !targetFolderId)) {
    return { library, changedAssetIds, skippedAssetIds: uniqueAssetIds };
  }

  const assetLocations = { ...library.assetLocations };
  for (const assetId of uniqueAssetIds) {
    const current = assetLibraryLocation(library, assetId);
    let next: AssetLibraryAssetLocation;

    if (mode === "link") {
      if (
        current.primaryFolderId === targetFolderId
        || current.linkedFolderIds.includes(targetFolderId as string)
      ) {
        skippedAssetIds.push(assetId);
        continue;
      }
      next = {
        primaryFolderId: current.primaryFolderId,
        linkedFolderIds: [...current.linkedFolderIds, targetFolderId as string],
      };
    } else {
      next = {
        primaryFolderId: targetFolderId,
        linkedFolderIds: current.linkedFolderIds.filter(
          (folderId) => folderId !== targetFolderId && folderId !== payload.sourceFolderId,
        ),
      };
    }

    if (sameLocation(current, next)) {
      skippedAssetIds.push(assetId);
      continue;
    }
    storeLocation(assetLocations, assetId, next);
    changedAssetIds.push(assetId);
  }

  if (changedAssetIds.length === 0) {
    return { library, changedAssetIds, skippedAssetIds };
  }
  return {
    library: { ...library, assetLocations },
    changedAssetIds,
    skippedAssetIds,
  };
}

export function putImportedAssetsInFolder(
  library: AssetLibrarySettings,
  entries: Array<{ assetId: string; folderId: string | null }>,
): AssetLibrarySettings {
  const assetLocations = { ...library.assetLocations };
  for (const { assetId, folderId } of entries) {
    const current = assetLibraryLocation(library, assetId);
    storeLocation(assetLocations, assetId, {
      primaryFolderId: folderId,
      linkedFolderIds: current.linkedFolderIds.filter((linkedFolderId) => linkedFolderId !== folderId),
    });
  }
  return { ...library, assetLocations };
}

export function uniqueLibraryAssetId(base: string, usedIds: Set<string>): string {
  const root = sanitizeAssetId(base);
  let candidate = root;
  let index = 2;
  while (usedIds.has(candidate)) {
    candidate = sanitizeAssetId(`${root}_${index}`);
    index += 1;
  }
  usedIds.add(candidate);
  return candidate;
}
