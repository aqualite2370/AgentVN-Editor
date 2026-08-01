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
  command_type: GameCommand["type"] | "loading_animation";
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

function commandLocation(node: EditorNode, command: GameCommand | { type: "loading_animation" }, commandIndex: number, field: string): string {
  const commandLabel = commandIndex >= 0 ? `第 ${commandIndex + 1} 条 ${command.type}.${field}` : `${command.type}.${field}`;
  return `场景「${nodeSceneTitle(node)}」 / 节点「${node.data.label || node.id}」 / ${commandLabel}`;
}

function reference(node: EditorNode, command: GameCommand | { type: "loading_animation" }, commandIndex: number, field: string, assetId: string | null | undefined, assetType: AssetType): EditorAssetReference[] {
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

function collectCommandAssetReferences(node: EditorNode, command: GameCommand, commandIndex: number): EditorAssetReference[] {
  if (command.type === "background") return reference(node, command, commandIndex, "background_id", command.background_id, "background");
  if (command.type === "show_image") return reference(node, command, commandIndex, "image_id", command.image_id, "ui");
  if (command.type === "video") return reference(node, command, commandIndex, "video_id", command.video_id, "video");
  if (command.type === "sprite") return reference(node, command, commandIndex, "sprite_id", command.sprite_id, "sprite");
  if (command.type === "narration") {
    return [
      ...reference(node, command, commandIndex, "font_asset_id", command.font_asset_id, "font"),
      ...reference(node, command, commandIndex, "dialog_style.background_asset_id", command.dialog_style?.background_asset_id, "ui"),
    ];
  }
  if (command.type === "bgm") return reference(node, command, commandIndex, "bgm_id", command.bgm_id, "bgm");
  if (command.type === "sfx") return reference(node, command, commandIndex, "sfx_id", command.sfx_id, "sfx");
  if (command.type === "dialog") {
    return [
      ...reference(node, command, commandIndex, "portrait", command.portrait, "portrait"),
      ...reference(node, command, commandIndex, "voice", command.voice, "voice"),
      ...reference(node, command, commandIndex, "font_asset_id", command.font_asset_id, "font"),
      ...reference(node, command, commandIndex, "dialog_style.background_asset_id", command.dialog_style?.background_asset_id, "ui"),
    ];
  }
  return [];
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
  }
  return references;
}
