import type { AssetManifestItem, AssetType, DialogVisualStyle, GameCommand, RuntimeScript } from "./types";

export interface AssetReference {
  asset_id: string;
  asset_type: AssetType;
  source: string;
}

function dialogStyleAssetReference(style: DialogVisualStyle | null | undefined, source: string): AssetReference[] {
  return style?.background_asset_id
    ? [{ asset_id: style.background_asset_id, asset_type: "ui", source }]
    : [];
}

export function collectAssetReferencesFromCommand(command: GameCommand, source = "command"): AssetReference[] {
  if (command.type === "background") return [{ asset_id: command.background_id, asset_type: "background", source }];
  if (command.type === "show_image") return [{ asset_id: command.image_id, asset_type: "ui", source }];
  if (command.type === "video") return [{ asset_id: command.video_id, asset_type: "video", source }];
  if (command.type === "sprite") return [{ asset_id: command.sprite_id, asset_type: "sprite", source }];
  if (command.type === "dialog") {
    return [
      command.portrait ? { asset_id: command.portrait, asset_type: "portrait" as const, source } : undefined,
      command.voice ? { asset_id: command.voice, asset_type: "voice" as const, source } : undefined,
      command.font_asset_id ? { asset_id: command.font_asset_id, asset_type: "font" as const, source } : undefined,
      ...dialogStyleAssetReference(command.dialog_style, `${source}.dialog_style`)
    ].filter(Boolean) as AssetReference[];
  }
  if (command.type === "narration") {
    return [
      command.font_asset_id ? { asset_id: command.font_asset_id, asset_type: "font" as const, source } : undefined,
      ...dialogStyleAssetReference(command.dialog_style, `${source}.dialog_style`),
    ].filter(Boolean) as AssetReference[];
  }
  if (command.type === "bgm" && command.bgm_id) return [{ asset_id: command.bgm_id, asset_type: "bgm", source }];
  if (command.type === "sfx") return [{ asset_id: command.sfx_id, asset_type: "sfx", source }];
  if (command.type === "animation") return [];
  return [];
}

export function collectAssetReferencesFromScene(scene: RuntimeScript["scenes"][number]): AssetReference[] {
  return scene.commands.flatMap((command, index) => collectAssetReferencesFromCommand(command, `${scene.scene_id}.commands.${index}`));
}

export function collectAssetReferencesFromScript(script: RuntimeScript): AssetReference[] {
  const unique = new Map<string, AssetReference>();
  const loadingAnimation = script.loading_animation;
  if (loadingAnimation?.kind === "video" && loadingAnimation.video_asset_id) {
    unique.set(loadingAnimation.video_asset_id, {
      asset_id: loadingAnimation.video_asset_id,
      asset_type: "video",
      source: "loading_animation.video_asset_id"
    });
  }
  if (loadingAnimation?.kind === "image_sequence") {
    for (const [index, assetId] of loadingAnimation.image_asset_ids.entries()) {
      if (!assetId) continue;
      unique.set(assetId, {
        asset_id: assetId,
        asset_type: "ui",
        source: `loading_animation.image_asset_ids.${index}`
      });
    }
  }
  for (const [index, character] of (script.characters ?? []).entries()) {
    for (const ref of dialogStyleAssetReference(character.dialog_style, `characters.${index}.dialog_style`)) {
      unique.set(ref.asset_id, ref);
    }
  }
  for (const scene of script.scenes) {
    for (const ref of collectAssetReferencesFromScene(scene)) unique.set(ref.asset_id, ref);
  }
  return [...unique.values()];
}

export function findMissingAssets(references: AssetReference[], manifestAssets: AssetManifestItem[]): AssetReference[] {
  const ids = new Set(manifestAssets.map((asset) => asset.asset_id));
  return references.filter((ref) => !ids.has(ref.asset_id));
}

export function inferMimeTypeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".otf")) return "font/otf";
  return "application/octet-stream";
}

export function inferAssetTypeFromCommand(command: GameCommand): AssetType {
  if (command.type === "background") return "background";
  if (command.type === "show_image") return "ui";
  if (command.type === "video") return "video";
  if (command.type === "sprite") return "sprite";
  if (command.type === "bgm") return "bgm";
  if (command.type === "sfx") return "sfx";
  if (command.type === "animation") return "other";
  if (command.type === "dialog") return command.voice ? "voice" : "portrait";
  return "other";
}

export function buildAssetManifest(references: AssetReference[]): AssetManifestItem[] {
  return references.map((ref) => ({
    asset_id: ref.asset_id,
    asset_type: ref.asset_type,
    path: `assets/${ref.asset_type}/${ref.asset_id}`,
    filename: ref.asset_id,
    mime_type: "application/octet-stream",
    preload: ref.asset_type === "background" || ref.asset_type === "sprite" || ref.asset_type === "font",
    tags: []
  }));
}
