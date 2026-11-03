import type { GalleryManifest, RuntimeScript } from "./types";

export function buildGalleryManifestFromScript(script: Pick<RuntimeScript, "scenes">): GalleryManifest {
  return {
    gallery_version: "1.0.0",
    items: script.scenes.flatMap((scene) => scene.commands.flatMap((command, command_index) => (
      command.type === "gallery_anchor"
        ? [{
            item_id: command.anchor_id,
            anchor_id: command.anchor_id,
            title: command.title.trim(),
            description: command.description?.trim() || undefined,
            asset_id: command.asset_id.trim(),
            scene_id: scene.scene_id,
            command_index,
          }]
        : []
    ))),
  };
}
