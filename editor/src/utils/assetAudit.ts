import type { AssetRef, AssetType, PendingVisualAsset } from "../types/assets";
import type { DialogCommand, GameCommand, SpriteCommand } from "../types/commands";
import type { EditorNode } from "../types/nodes";
import type { SceneBeat } from "../types/scene";
import { assetTypeMatchesExpected } from "../../../shared/cartridge/assetTaxonomy";

export const DEFAULT_VISUAL_PLACEHOLDER_BACKGROUND_ID = "agentvn_placeholder_background";

interface AssetSuggestionLike {
  asset_type: string;
  description: string;
  suggested_asset_id: string;
  source_scene_id: string;
  source_scene_display_name?: string;
}

export interface SceneAssetAudit {
  node_id?: string;
  scene_id: string;
  scene_title: string;
  pending: PendingVisualAsset[];
  missing_background: PendingVisualAsset[];
  missing_sprite_characters: PendingVisualAsset[];
  missing_portrait_characters: PendingVisualAsset[];
  optional_audio_performance: PendingVisualAsset[];
}

export interface ProjectAssetAudit {
  scenes: SceneAssetAudit[];
  missing_background_scenes: SceneAssetAudit[];
  missing_sprite_characters: PendingVisualAsset[];
  missing_portrait_characters: PendingVisualAsset[];
  optional_audio_performance: PendingVisualAsset[];
  pending: PendingVisualAsset[];
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function placeholderSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="AgentVN visual placeholder background">
  <defs>
    <linearGradient id="base" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#162338"/>
      <stop offset="0.56" stop-color="#253b4c"/>
      <stop offset="1" stop-color="#12291f"/>
    </linearGradient>
    <pattern id="grid" width="96" height="96" patternUnits="userSpaceOnUse">
      <path d="M96 0H0v96" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="2"/>
      <circle cx="0" cy="0" r="3" fill="#ffffff" fill-opacity="0.16"/>
    </pattern>
  </defs>
  <rect width="1280" height="720" fill="url(#base)"/>
  <rect width="1280" height="720" fill="url(#grid)"/>
  <rect x="94" y="92" width="1092" height="536" rx="20" fill="#07111f" fill-opacity="0.38" stroke="#ffffff" stroke-opacity="0.34" stroke-dasharray="18 16" stroke-width="3"/>
  <text x="128" y="170" fill="#f5f7fb" font-family="Segoe UI, Arial, sans-serif" font-size="38" font-weight="700">画面占位资源</text>
  <text x="128" y="226" fill="#d8e3ef" font-family="Segoe UI, Arial, sans-serif" font-size="25">此场景仍需补充最终背景图。</text>
  <text x="128" y="552" fill="#aebdcc" font-family="Consolas, monospace" font-size="22">${escapeXml(DEFAULT_VISUAL_PLACEHOLDER_BACKGROUND_ID)}</text>
</svg>`;
}

function placeholderDataUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(placeholderSvg())}`;
}

export function createDefaultBackgroundPlaceholderAsset(): AssetRef {
  return {
    asset_id: DEFAULT_VISUAL_PLACEHOLDER_BACKGROUND_ID,
    asset_type: "background",
    metadata: {
      filename: "agentvn-visual-placeholder-background.svg",
      mime_type: "image/svg+xml",
      source: "bundled",
      placeholder: true,
      data_url: placeholderDataUrl(),
      project_path: `assets/background/${DEFAULT_VISUAL_PLACEHOLDER_BACKGROUND_ID}.svg`,
      license_note: "AgentVN default visual placeholder. Replace before final release.",
      tags: ["placeholder", "visual-placeholder", "missing-background"],
      created_at: new Date(0).toISOString(),
    },
  };
}

export function ensureDefaultBackgroundPlaceholderAsset(assets: AssetRef[]): AssetRef[] {
  if (assets.some((asset) => asset.asset_id === DEFAULT_VISUAL_PLACEHOLDER_BACKGROUND_ID)) return assets;
  return [createDefaultBackgroundPlaceholderAsset(), ...assets];
}

export function ensureSceneHasBackgroundPlaceholder(scene: SceneBeat): { scene: SceneBeat; inserted: boolean } {
  const hasBackground = scene.commands.some((command) => command.type === "background" && Boolean(command.background_id?.trim()));
  if (hasBackground) return { scene, inserted: false };
  return {
    scene: {
      ...scene,
      commands: [
        {
          type: "background",
          background_id: DEFAULT_VISUAL_PLACEHOLDER_BACKGROUND_ID,
          background_fit: "stretch",
          transition: "fade",
          transition_display_name: "画面占位资源",
        },
        ...scene.commands,
      ],
      tags: [...new Set([...scene.tags, "asset_review"])],
    },
    inserted: true,
  };
}

function sceneTitle(scene: SceneBeat): string {
  return scene.scene_display_name?.trim() || scene.title.trim() || scene.scene_id;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function safeAssetId(prefix: string, value: string): string {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  return `${prefix}_${ascii || hashText(value || prefix)}`;
}

function assetMap(assets: AssetRef[] = []): Map<string, AssetRef> {
  return new Map(assets.map((asset) => [asset.asset_id, asset]));
}

function isUsableAsset(asset: AssetRef | undefined, expectedType: AssetType): boolean {
  return Boolean(asset && assetTypeMatchesExpected(asset.asset_type, expectedType) && !asset.metadata.placeholder);
}

function makePending(
  scene: SceneBeat,
  input: Omit<PendingVisualAsset, "id" | "scene_id" | "scene_title">,
): PendingVisualAsset {
  const sceneLabel = sceneTitle(scene);
  const commandLabel = input.command_index !== undefined && input.command_index >= 0 && input.command_type
    ? "第 " + (input.command_index + 1) + " 条 " + input.command_type + (input.field ? "." + input.field : "")
    : input.field;
  const location = input.location ?? [
    "场景「" + sceneLabel + "」",
    input.node_label ? "节点/卡片「" + input.node_label + "」" : input.node_id ? "节点/卡片「" + input.node_id + "」" : undefined,
    commandLabel,
  ].filter(Boolean).join(" / ");
  const key = [
    input.node_id,
    scene.scene_id,
    input.kind,
    input.asset_id,
    input.character_id,
    input.command_type,
    input.command_index,
    input.field,
    input.label,
  ].filter((item) => item !== undefined && item !== "").join(":");
  return {
    ...input,
    id: `pending_${hashText(key)}`,
    scene_id: scene.scene_id,
    scene_title: sceneLabel,
    location,
  };
}

function commandCharacters(commands: GameCommand[]): string[] {
  const ids = new Set<string>();
  for (const command of commands) {
    if ((command.type === "dialog" || command.type === "sprite") && command.character_id.trim()) ids.add(command.character_id.trim());
  }
  return [...ids];
}

function firstCharacterCommand(commands: GameCommand[], characterId: string): { command: DialogCommand | SpriteCommand; index: number; field: string } | undefined {
  const index = commands.findIndex((command) => (
    (command.type === "dialog" || command.type === "sprite") && command.character_id.trim() === characterId
  ));
  const command = commands[index];
  if (!command || (command.type !== "dialog" && command.type !== "sprite")) return undefined;
  return { command, index, field: command.type === "dialog" ? "portrait" : "sprite_id" };
}

function hasScenePerformance(commands: GameCommand[]): boolean {
  return commands.some((command) =>
    command.type === "animation" ||
    command.type === "camera" ||
    (command.type === "sprite" && Boolean(command.animation?.trim())) ||
    (command.type === "background" && Boolean(command.transition?.trim())),
  );
}

export function buildPendingVisualAssetsForScene(
  scene: SceneBeat,
  options: {
    nodeId?: string;
    nodeLabel?: string;
    projectAssets?: AssetRef[];
    includeOptional?: boolean;
    assetSuggestions?: AssetSuggestionLike[];
  } = {},
): PendingVisualAsset[] {
  const assets = assetMap(options.projectAssets);
  const pending: PendingVisualAsset[] = [];
  const node_id = options.nodeId;
  const node_label = options.nodeLabel;
  const commands = scene.commands;
  const backgrounds = commands
    .map((command, index) => ({ command, index }))
    .filter((item): item is { command: Extract<GameCommand, { type: "background" }>; index: number } => item.command.type === "background");

  if (backgrounds.length === 0) {
    pending.push(makePending(scene, {
      node_id,
      node_label,
      kind: "background",
      asset_type: "background",
      asset_id: DEFAULT_VISUAL_PLACEHOLDER_BACKGROUND_ID,
      command_type: "background",
      command_index: -1,
      field: "background_id",
      label: "缺少场景背景",
      reason: "当前没有背景指令，AgentVN 将插入明确的占位背景图。",
      placeholder: true,
    }));
  } else {
    for (const { command, index } of backgrounds) {
      const assetId = command.background_id?.trim();
      if (!assetId || assetId === DEFAULT_VISUAL_PLACEHOLDER_BACKGROUND_ID || !isUsableAsset(assets.get(assetId), "background")) {
        pending.push(makePending(scene, {
          node_id,
          node_label,
          kind: "background",
          asset_type: "background",
          asset_id: assetId || DEFAULT_VISUAL_PLACEHOLDER_BACKGROUND_ID,
          command_type: command.type,
          command_index: index,
          field: "background_id",
          label: assetId === DEFAULT_VISUAL_PLACEHOLDER_BACKGROUND_ID ? "占位背景图" : "需要补充背景图",
          reason: assetId === DEFAULT_VISUAL_PLACEHOLDER_BACKGROUND_ID
            ? "当前场景还在使用默认占位图，请替换为最终背景图，例如 station_evening.png。"
            : "场景引用了背景图，但素材库中没有登记可发布的对应文件。",
          placeholder: assetId === DEFAULT_VISUAL_PLACEHOLDER_BACKGROUND_ID,
        }));
      }
    }
  }

  for (const characterId of commandCharacters(commands)) {
    const spriteCommands = commands
      .map((command, index) => ({ command, index }))
      .filter((item): item is { command: SpriteCommand; index: number } => item.command.type === "sprite" && item.command.character_id.trim() === characterId);
    if (spriteCommands.length === 0) {
      const anchor = firstCharacterCommand(commands, characterId);
      pending.push(makePending(scene, {
        node_id,
        node_label,
        kind: "sprite",
        asset_type: "sprite",
        asset_id: safeAssetId("sprite", characterId),
        character_id: characterId,
        command_type: anchor?.command.type,
        command_index: anchor?.index,
        field: anchor?.field,
        label: "需要补充角色图像",
        reason: "这个角色已经出现在场景里，但还没有可显示在舞台上的角色图像。",
      }));
    } else {
      for (const { command, index } of spriteCommands) {
        const assetId = command.sprite_id?.trim();
        if (!assetId || !isUsableAsset(assets.get(assetId), "sprite")) {
          pending.push(makePending(scene, {
            node_id,
            node_label,
            kind: "sprite",
            asset_type: "sprite",
            asset_id: assetId || safeAssetId("sprite", characterId),
            character_id: characterId,
            command_type: command.type,
            command_index: index,
            field: "sprite_id",
            label: "角色图像缺失",
            reason: "立绘事件引用的角色图像没有在素材库中登记为可发布素材。",
          }));
        }
      }
    }

    const dialogCommands = commands
      .map((command, index) => ({ command, index }))
      .filter((item): item is { command: DialogCommand; index: number } => item.command.type === "dialog" && item.command.character_id.trim() === characterId);
    if (dialogCommands.length > 0) {
      const portraitIds = [...new Set(dialogCommands.map(({ command }) => command.portrait?.trim()).filter((id): id is string => Boolean(id)))];
      if (portraitIds.length === 0) {
        const firstDialog = dialogCommands[0];
        pending.push(makePending(scene, {
          node_id,
          node_label,
          kind: "portrait",
          asset_type: "portrait",
          asset_id: safeAssetId("portrait", characterId),
          character_id: characterId,
          command_type: firstDialog.command.type,
          command_index: firstDialog.index,
          field: "portrait",
          label: "需要补充对白头像",
          reason: "这个角色有对白，但还没有指定用于对白框的角色头像。",
        }));
      } else {
        for (const { command, index } of dialogCommands) {
          const assetId = command.portrait?.trim();
          if (!assetId) continue;
          if (!isUsableAsset(assets.get(assetId), "portrait")) {
            pending.push(makePending(scene, {
              node_id,
              node_label,
              kind: "portrait",
              asset_type: "portrait",
              asset_id: assetId,
              character_id: characterId,
              command_type: command.type,
              command_index: index,
              field: "portrait",
              label: "对白头像缺失",
              reason: "对白引用的头像没有在素材库中登记为可发布素材。",
            }));
          }
        }
      }
    }
  }

  for (const suggestion of options.assetSuggestions ?? []) {
    if (suggestion.source_scene_id !== scene.scene_id) continue;
    if (suggestion.asset_type !== "background" && suggestion.asset_type !== "sprite" && suggestion.asset_type !== "portrait") continue;
    const type = suggestion.asset_type as "background" | "sprite" | "portrait";
    if (isUsableAsset(assets.get(suggestion.suggested_asset_id), type)) continue;
    pending.push(makePending(scene, {
      node_id,
      node_label,
      kind: type,
      asset_type: type,
      asset_id: suggestion.suggested_asset_id,
      label: suggestion.description || "建议补充画面素材",
      reason: "小说导入生成了素材建议，但还需要绑定最终文件。",
    }));
  }

  if (options.includeOptional) {
    if (!commands.some((command) => command.type === "bgm" && command.bgm_id)) {
      pending.push(makePending(scene, {
        node_id,
        node_label,
        kind: "audio",
        asset_type: "bgm",
        label: "可选：添加场景音乐",
        reason: "当前场景还没有背景音乐，可以添加 ambient_rain_loop.mp3 一类的音乐素材。",
        optional: true,
      }));
    }
    if (!commands.some((command) => command.type === "dialog" && command.voice)) {
      pending.push(makePending(scene, {
        node_id,
        node_label,
        kind: "audio",
        asset_type: "voice",
        label: "可选：添加对白语音",
        reason: "对白还没有绑定语音文件，例如 alice_line_001.ogg。",
        optional: true,
      }));
    }
    if (!commands.some((command) => command.type === "sfx")) {
      pending.push(makePending(scene, {
        node_id,
        node_label,
        kind: "audio",
        asset_type: "sfx",
        label: "可选：添加音效",
        reason: "当前场景还没有音效，可以添加 door_knock.wav 一类的效果音。",
        optional: true,
      }));
    }
    if (!hasScenePerformance(commands)) {
      pending.push(makePending(scene, {
        node_id,
        node_label,
        kind: "performance",
        asset_type: "other",
        label: "可选：添加演出效果",
        reason: "当前场景还没有镜头、转场或角色入场等演出效果。",
        optional: true,
      }));
    }
  }

  const unique = new Map<string, PendingVisualAsset>();
  for (const item of pending) unique.set(item.id, item);
  return [...unique.values()];
}

export function buildSceneAssetAudit(
  scene: SceneBeat,
  options: {
    nodeId?: string;
    nodeLabel?: string;
    projectAssets?: AssetRef[];
    includeOptional?: boolean;
    assetSuggestions?: AssetSuggestionLike[];
  } = {},
): SceneAssetAudit {
  const pending = buildPendingVisualAssetsForScene(scene, options);
  return {
    node_id: options.nodeId,
    scene_id: scene.scene_id,
    scene_title: sceneTitle(scene),
    pending,
    missing_background: pending.filter((item) => item.kind === "background" && !item.optional),
    missing_sprite_characters: pending.filter((item) => item.kind === "sprite" && !item.optional),
    missing_portrait_characters: pending.filter((item) => item.kind === "portrait" && !item.optional),
    optional_audio_performance: pending.filter((item) => item.optional),
  };
}

export function buildProjectAssetAudit(
  nodes: EditorNode[],
  projectAssets: AssetRef[] = [],
  options: { includeOptional?: boolean } = {},
): ProjectAssetAudit {
  const scenes = nodes
    .filter((node) => node.data.nodeKind === "scene" && node.data.scene)
    .map((node) => buildSceneAssetAudit(node.data.scene!, {
      nodeId: node.id,
      nodeLabel: node.data.label || node.id,
      projectAssets,
      includeOptional: options.includeOptional,
    }));
  const pending = scenes.flatMap((scene) => scene.pending);
  return {
    scenes,
    pending,
    missing_background_scenes: scenes.filter((scene) => scene.missing_background.length > 0),
    missing_sprite_characters: scenes.flatMap((scene) => scene.missing_sprite_characters),
    missing_portrait_characters: scenes.flatMap((scene) => scene.missing_portrait_characters),
    optional_audio_performance: scenes.flatMap((scene) => scene.optional_audio_performance),
  };
}
