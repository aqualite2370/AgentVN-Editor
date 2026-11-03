import type { AssetType } from "../../../shared/cartridge/types";
import type { GameCommand } from "../types/commands";
import type { EditorNode } from "../types/nodes";

export interface EditorAssetReference {
  asset_id: string;
  asset_type: AssetType;
  source: string;
  scene_id: string;
  scene_title: string;
  node_id: string;
  node_label: string;
  command_type: GameCommand["type"] | "loading_animation" | "loading_audio";
  command_index: number;
  field: string;
  location: string;
}

function syntheticSceneId(node: EditorNode): string {
  return `${node.data.nodeKind}_${node.id}`;
}

function nodeSceneId(node: EditorNode): string {
  return node.data.scene?.scene_id ?? syntheticSceneId(node);
}

function nodeSceneTitle(node: EditorNode): string {
  return node.data.scene?.scene_display_name?.trim()
    || node.data.scene?.title?.trim()
    || node.data.label
    || nodeSceneId(node);
}

function commandLocation(node: EditorNode, command: GameCommand | { type: "loading_animation" | "loading_audio" }, commandIndex: number, field: string): string {
  const commandLabel = commandIndex >= 0 ? `第 ${commandIndex + 1} 条 ${command.type}.${field}` : `${command.type}.${field}`;
  return `场景「${nodeSceneTitle(node)}」 / 节点「${node.data.label || node.id}」 / ${commandLabel}`;
}

function reference(node: EditorNode, command: GameCommand | { type: "loading_animation" | "loading_audio" }, commandIndex: number, field: string, assetId: string | null | undefined, assetType: AssetType): EditorAssetReference[] {
  if (!assetId) return [];
  const location = commandLocation(node, command, commandIndex, field);
  return [{
    asset_id: assetId,
    asset_type: assetType,
    source: location,
    scene_id: nodeSceneId(node),
    scene_title: nodeSceneTitle(node),
    node_id: node.id,
    node_label: node.data.label || node.id,
    command_type: command.type,
    command_index: commandIndex,
    field,
    location,
  }];
}

export function collectCommandAssetFields(command: GameCommand): Array<{
  asset_id: string; asset_type: AssetType; field: string; allowedTypes?: AssetType[];
}> {
  // Preserve empty IDs for required fields so the inspector can explain an unconfigured command.
  const field = (name: string, id: string | null | undefined, type: AssetType) => ({ field: name, asset_id: id?.trim() ?? "", asset_type: type });
  if (command.type === "background") return [field("background_id", command.background_id, "background")];
  if (command.type === "show_image") return [{ ...field("image_id", command.image_id, "ui"), allowedTypes: ["background", "sprite", "portrait", "ui"] }];
  if (command.type === "video") return [field("video_id", command.video_id, "video")];
  if (command.type === "sprite") return command.visible === false ? [] : [field("sprite_id", command.sprite_id, "sprite")];
  if (command.type === "bgm") return command.action === "stop" ? [] : [field("bgm_id", command.bgm_id, "bgm")];
  if (command.type === "sfx") return [field("sfx_id", command.sfx_id, "sfx")];
  if (command.type === "gallery_anchor") return [{ ...field("asset_id", command.asset_id, "ui"), allowedTypes: ["background", "sprite", "portrait", "ui"] }];
  if (command.type === "dialog" || command.type === "narration") {
    return [
      ...(command.type === "dialog" ? [field("portrait", command.portrait, "portrait"), field("voice", command.voice, "voice")] : []),
      field("font_asset_id", command.font_asset_id, "font"),
      field("dialog_style.background_asset_id", command.dialog_style?.background_asset_id, "ui"),
    ].filter(item => Boolean(item.asset_id));
  }
  return [];
}

function collectCommandAssetReferences(node: EditorNode, command: GameCommand, commandIndex: number): EditorAssetReference[] {
  return collectCommandAssetFields(command).flatMap(item =>
    reference(node, command, commandIndex, item.field, item.asset_id, item.asset_type));
}

export function collectEditorAssetReferences(nodes: EditorNode[]): EditorAssetReference[] {
  const references: EditorAssetReference[] = [];
  for (const node of nodes) {
    if (node.data.scene) {
      node.data.scene.commands.forEach((command, index) => references.push(...collectCommandAssetReferences(node, command, index)));
    }
    if (node.data.animation) references.push(...collectCommandAssetReferences(node, node.data.animation, 0));
    const loadingAnimation = node.data.loadingAnimation;
    if (node.data.nodeKind === "start" && loadingAnimation?.kind === "video") {
      references.push(...reference(node, { type: "loading_animation" }, -1, "video_asset_id", loadingAnimation.video_asset_id, "video"));
    }
    if (node.data.nodeKind === "start" && loadingAnimation?.kind === "image_sequence") {
      loadingAnimation.image_asset_ids.forEach((assetId, index) => {
        references.push(...reference(node, { type: "loading_animation" }, -1, `image_asset_ids.${index}`, assetId, "ui"));
      });
    }
    if (node.data.nodeKind === "start") {
      node.data.openingAudio?.forEach((track, index) => {
        references.push(...reference(node, { type: "loading_audio" }, -1, `opening_audio.${index}.asset_id`, track.asset_id, track.asset_type));
      });
    }
  }
  return references;
}
