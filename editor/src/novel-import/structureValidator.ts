import type { AssetRef, AssetType } from "../types/assets";
import type { GameCommand } from "../types/commands";
import type {
  AdaptedScene,
  BranchSuggestion,
  CharacterCandidate,
  ConflictPoint,
  NovelImportValidationReport,
  SceneCandidate,
  SourceDocument,
} from "./types";
import { createSourceMapping, updateSourceMappingAfterEdit } from "./sourceMapping";
import { nextUniqueSceneId, remapSceneSelfTargets, sceneIdBase } from "./sceneIdUniqueness";
import { assetTypeDisplayLabel, assetTypeMatchesExpected, isImageLikeAssetType } from "../../../shared/cartridge/assetTaxonomy";

const validCommandTypes = new Set([
  "background",
  "hide_dialog",
  "show_image",
  "video",
  "narration",
  "dialog",
  "sprite",
  "choice",
  "state_update",
  "conditional_jump",
  "jump",
  "animation",
  "bgm",
  "sfx",
  "camera",
  "wait",
]);

export interface NovelBlueprintValidationInput {
  reportId: string;
  document: SourceDocument;
  sceneCandidate: SceneCandidate;
  adaptedScene: AdaptedScene;
  branchSuggestions: BranchSuggestion[];
  conflictPoints: ConflictPoint[];
  knownCharacters: CharacterCandidate[];
  usedSceneIds: Set<string>;
  projectAssets?: AssetRef[];
  allowBranchSuggestions: boolean;
  creatableSceneIds?: Iterable<string>;
  resolveSceneId?: (sourceSceneId: string, context?: { suggestion?: BranchSuggestion; conflict?: ConflictPoint }) => string | undefined;
}

export interface NovelBlueprintValidationResult {
  adaptedScene: AdaptedScene;
  branchSuggestions: BranchSuggestion[];
  conflictPoints: ConflictPoint[];
  report: NovelImportValidationReport;
  blocked: boolean;
}

function cleanId(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function remapBranchSources(suggestions: BranchSuggestion[], fromSceneId: string, toSceneId: string): BranchSuggestion[] {
  if (!fromSceneId || fromSceneId === toSceneId) return suggestions;
  return suggestions.map((suggestion) =>
    suggestion.source_scene_id === fromSceneId ? { ...suggestion, source_scene_id: toSceneId } : suggestion
  );
}

function remapConflictSources(conflicts: ConflictPoint[], fromSceneId: string, toSceneId: string): ConflictPoint[] {
  if (!fromSceneId || fromSceneId === toSceneId) return conflicts;
  return conflicts.map((conflict) =>
    conflict.source_scene_id === fromSceneId ? { ...conflict, source_scene_id: toSceneId } : conflict
  );
}

function normalizedKey(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeAlias(value?: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function localSceneAliases(input: NovelBlueprintValidationInput, adapted: AdaptedScene, originalSceneId: string): Set<string> {
  const aliases = new Set<string>();
  for (const value of [
    input.sceneCandidate.scene_candidate_id,
    input.sceneCandidate.title,
    input.sceneCandidate.display_name,
    originalSceneId,
    adapted.scene_beat.scene_id,
    adapted.scene_beat.title,
    adapted.scene_beat.scene_display_name,
  ]) {
    const alias = normalizeAlias(value);
    if (alias) aliases.add(alias);
  }
  return aliases;
}

function characterKeys(characters: CharacterCandidate[], sceneCharacters: string[]): Set<string> {
  const keys = new Set<string>();
  for (const character of characters) {
    for (const value of [character.character_id, character.name, ...character.aliases]) {
      const key = normalizedKey(value);
      if (key) keys.add(key);
    }
  }
  for (const value of sceneCharacters) {
    const key = normalizedKey(value);
    if (key) keys.add(key);
  }
  return keys;
}

function isTraceableExcerpt(document: SourceDocument, start: number, end: number, excerpt: string): boolean {
  const source = document.normalized_text.slice(start, end);
  const probe = excerpt.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!probe) return false;
  return source.replace(/\s+/g, " ").includes(probe);
}

function hasValidRange(document: SourceDocument, start: number, end: number): boolean {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start && end <= document.normalized_text.length;
}

function assetById(projectAssets: AssetRef[] = []): Map<string, AssetRef> {
  return new Map(projectAssets.map((asset) => [asset.asset_id, asset]));
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function cloneArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? [...value] : [];
}

function cloneSourceMapping(mapping: Partial<AdaptedScene["source_mapping"]> | undefined): AdaptedScene["source_mapping"] {
  return {
    document_id: typeof mapping?.document_id === "string" ? mapping.document_id : "",
    start_offset: typeof mapping?.start_offset === "number" ? mapping.start_offset : Number.NaN,
    end_offset: typeof mapping?.end_offset === "number" ? mapping.end_offset : Number.NaN,
    source_excerpt: typeof mapping?.source_excerpt === "string" ? mapping.source_excerpt : "",
    adapted_command_ids: cloneArray(mapping?.adapted_command_ids),
  };
}

function validateCharacterReference(input: {
  value: string | undefined | null;
  keys: Set<string>;
  label: string;
  errors: string[];
  passed: string[];
}): void {
  const value = cleanId(input.value);
  if (!value) {
    input.errors.push(`${input.label} 缺少 character_id，无法确认角色引用。`);
    return;
  }
  if (input.keys.size > 0 && !input.keys.has(normalizedKey(value))) {
    input.errors.push(`${input.label} 引用了未确认角色 "${value}"。请先在大纲角色表中确认该角色，或让模型使用已有角色 ID/姓名。`);
    return;
  }
  pushUnique(input.passed, "角色引用合法");
}

function validateAssetReference(input: {
  assetId: string | undefined | null;
  expectedType: AssetType;
  path: string;
  assetTypes: Map<string, AssetRef>;
  hasProjectAssets: boolean;
  optional?: boolean;
  imageLike?: boolean;
  errors: string[];
  warnings: string[];
  passed: string[];
}): void {
  const assetId = cleanId(input.assetId);
  if (!assetId) {
    if (input.optional) return;
    input.errors.push(`${input.path} 缺少素材 ID，无法确认 ${input.expectedType} 引用。`);
    return;
  }
  const asset = input.assetTypes.get(assetId);
  const actualType = asset?.asset_type;
  const typeMatches = actualType
    ? input.imageLike
      ? isImageLikeAssetType(actualType) || asset?.metadata.mime_type?.startsWith("image/") === true
      : assetTypeMatchesExpected(actualType, input.expectedType)
    : true;
  if (actualType && !typeMatches) {
    input.errors.push(`${input.path} 引用了素材 "${assetId}"，但素材库类型是${assetTypeDisplayLabel(actualType)}，这里需要${assetTypeDisplayLabel(input.expectedType)}。`);
    return;
  }
  if (!actualType && input.hasProjectAssets) {
    input.warnings.push(`${input.path} 引用了素材 "${assetId}"，当前素材库未找到；导出前请补齐素材或改成已存在的 asset_id。`);
  }
  pushUnique(input.passed, "素材类型引用合法");
}

function validateCommandReferences(input: {
  commands: GameCommand[];
  sceneId: string;
  characterKeys: Set<string>;
  assetTypes: Map<string, AssetRef>;
  hasProjectAssets: boolean;
  passed: string[];
  warnings: string[];
  errors: string[];
}): void {
  input.commands.forEach((command, index) => {
    const commandType = (command as { type?: unknown }).type;
    const path = `${input.sceneId}.commands.${index}`;
    if (typeof commandType !== "string" || !validCommandTypes.has(commandType)) {
      input.errors.push(`${path} 使用了不支持的命令类型 "${String(commandType)}"。`);
      return;
    }

    if (command.type === "dialog") {
      validateCharacterReference({ value: command.character_id, keys: input.characterKeys, label: `${path}.dialog`, errors: input.errors, passed: input.passed });
      validateAssetReference({ assetId: command.portrait, expectedType: "portrait", path: `${path}.portrait`, assetTypes: input.assetTypes, hasProjectAssets: input.hasProjectAssets, optional: true, errors: input.errors, warnings: input.warnings, passed: input.passed });
      validateAssetReference({ assetId: command.voice, expectedType: "voice", path: `${path}.voice`, assetTypes: input.assetTypes, hasProjectAssets: input.hasProjectAssets, optional: true, errors: input.errors, warnings: input.warnings, passed: input.passed });
      return;
    }

    if (command.type === "sprite") {
      validateCharacterReference({ value: command.character_id, keys: input.characterKeys, label: `${path}.sprite`, errors: input.errors, passed: input.passed });
      validateAssetReference({ assetId: command.sprite_id, expectedType: "sprite", path: `${path}.sprite_id`, assetTypes: input.assetTypes, hasProjectAssets: input.hasProjectAssets, errors: input.errors, warnings: input.warnings, passed: input.passed });
      return;
    }

    if (command.type === "background") {
      validateAssetReference({ assetId: command.background_id, expectedType: "background", path: `${path}.background_id`, assetTypes: input.assetTypes, hasProjectAssets: input.hasProjectAssets, errors: input.errors, warnings: input.warnings, passed: input.passed });
      return;
    }

    if (command.type === "show_image") {
      validateAssetReference({ assetId: command.image_id, expectedType: "ui", imageLike: true, path: `${path}.image_id`, assetTypes: input.assetTypes, hasProjectAssets: input.hasProjectAssets, errors: input.errors, warnings: input.warnings, passed: input.passed });
      return;
    }

    if (command.type === "video") {
      validateAssetReference({ assetId: command.video_id, expectedType: "video", path: `${path}.video_id`, assetTypes: input.assetTypes, hasProjectAssets: input.hasProjectAssets, errors: input.errors, warnings: input.warnings, passed: input.passed });
      return;
    }

    if (command.type === "bgm") {
      validateAssetReference({ assetId: command.bgm_id, expectedType: "bgm", path: `${path}.bgm_id`, assetTypes: input.assetTypes, hasProjectAssets: input.hasProjectAssets, optional: true, errors: input.errors, warnings: input.warnings, passed: input.passed });
      return;
    }

    if (command.type === "sfx") {
      validateAssetReference({ assetId: command.sfx_id, expectedType: "sfx", path: `${path}.sfx_id`, assetTypes: input.assetTypes, hasProjectAssets: input.hasProjectAssets, errors: input.errors, warnings: input.warnings, passed: input.passed });
      return;
    }

    if (command.type === "animation") return;
  });
}

function sanitizeChoiceCommands(input: {
  commands: GameCommand[];
  sceneId: string;
  validTargets: Set<string>;
  warnings: string[];
  fixes: string[];
  passed: string[];
}): GameCommand[] {
  const nextCommands: GameCommand[] = [];
  input.commands.forEach((command, commandIndex) => {
    if (command.type !== "choice") {
      nextCommands.push(command);
      return;
    }
    if (command.choices.length === 0) {
      input.warnings.push(`${input.sceneId}.commands.${commandIndex} 是空 choice 命令，已从小说导入场景中移除。`);
      return;
    }

    const choices = command.choices.flatMap((choice, choiceIndex) => {
      const target = cleanId(choice.target_scene_id);
      const choiceLabel = choice.choice_display_name?.trim() || choice.text || choice.choice_id || `choice_${choiceIndex + 1}`;
      if (!target || !input.validTargets.has(target)) {
        input.warnings.push(`选项 "${choiceLabel}" 指向无效 target_scene_id "${target || "(空)"}"，已从小说导入场景中移除；可选分支会在主线完成后单独物化。`);
        return [];
      }
      if (!cleanId(choice.choice_id)) {
        const repairedChoiceId = `choice_${commandIndex + 1}_${choiceIndex + 1}`;
        input.fixes.push(`选项 "${choiceLabel}" 缺少 choice_id，已自动修复为 "${repairedChoiceId}"。`);
        return [{ ...choice, choice_id: repairedChoiceId }];
      }
      pushUnique(input.passed, "choice target 存在或可创建");
      return [choice];
    });

    if (choices.length === 0) {
      input.warnings.push(`${input.sceneId}.commands.${commandIndex} 没有可用选项，已从小说导入场景中移除。`);
      return;
    }
    nextCommands.push({ ...command, choices });
  });
  return nextCommands;
}

export function validateNovelBlueprintWrite(input: NovelBlueprintValidationInput): NovelBlueprintValidationResult {
  const passed: string[] = [];
  const fixes: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  let adapted: AdaptedScene = {
    ...input.adaptedScene,
    scene_beat: {
      ...input.adaptedScene.scene_beat,
      commands: cloneArray(input.adaptedScene.scene_beat.commands),
      tags: cloneArray(input.adaptedScene.scene_beat.tags),
    },
    source_mapping: cloneSourceMapping((input.adaptedScene as Partial<AdaptedScene>).source_mapping),
    warnings: cloneArray(input.adaptedScene.warnings),
  };
  let branchSuggestions = input.allowBranchSuggestions ? cloneArray(input.branchSuggestions).map((suggestion) => ({ ...suggestion })) : [];
  let conflictPoints = cloneArray(input.conflictPoints).map((conflict) => ({ ...conflict, branch_suggestion_ids: cloneArray(conflict.branch_suggestion_ids) }));

  const originalSceneId = cleanId(adapted.scene_beat.scene_id);
  const fallbackSceneId = `novel_scene_${sceneIdBase(input.sceneCandidate.scene_candidate_id, "scene")}`;
  const repairedSceneId = nextUniqueSceneId(originalSceneId, input.usedSceneIds, fallbackSceneId);
  if (repairedSceneId !== originalSceneId) {
    adapted = {
      ...adapted,
      scene_beat: {
        ...adapted.scene_beat,
        scene_id: repairedSceneId,
        commands: remapSceneSelfTargets(adapted.scene_beat.commands, originalSceneId, repairedSceneId),
      },
    };
    branchSuggestions = remapBranchSources(branchSuggestions, originalSceneId, repairedSceneId);
    conflictPoints = remapConflictSources(conflictPoints, originalSceneId, repairedSceneId);
    fixes.push(`scene_id 已从 "${originalSceneId || "(空)"}" 自动修复为 "${repairedSceneId}"，并同步重映射本场景内的 choice target。`);
  } else {
    passed.push("scene_id 唯一");
  }

  const candidateRangeValid = hasValidRange(input.document, input.sceneCandidate.start_offset, input.sceneCandidate.end_offset);
  const mapping = adapted.source_mapping;
  const mappingTraceable =
    mapping.document_id === input.document.document_id &&
    hasValidRange(input.document, mapping.start_offset, mapping.end_offset) &&
    isTraceableExcerpt(input.document, mapping.start_offset, mapping.end_offset, mapping.source_excerpt);

  if (!adapted.source_scene_candidate_id || adapted.source_scene_candidate_id !== input.sceneCandidate.scene_candidate_id) {
    adapted = { ...adapted, source_scene_candidate_id: input.sceneCandidate.scene_candidate_id };
    fixes.push(`source_scene_candidate_id 已重映射为当前场景候选 "${input.sceneCandidate.scene_candidate_id}"。`);
  }

  if (mappingTraceable) {
    passed.push("source mapping 可追溯");
  } else if (candidateRangeValid) {
    adapted = {
      ...adapted,
      source_mapping: createSourceMapping(input.document, input.sceneCandidate.start_offset, input.sceneCandidate.end_offset, adapted.scene_beat),
    };
    fixes.push(`source mapping 已按原文 offset ${input.sceneCandidate.start_offset}-${input.sceneCandidate.end_offset} 重建。`);
  } else {
    errors.push(`source mapping 无法追溯：场景候选 offset ${input.sceneCandidate.start_offset}-${input.sceneCandidate.end_offset} 超出文档范围。`);
  }

  adapted = { ...adapted, source_mapping: updateSourceMappingAfterEdit(adapted.source_mapping, adapted.scene_beat) };

  const validTargets = new Set([...input.usedSceneIds, ...Array.from(input.creatableSceneIds ?? [])]);
  adapted = {
    ...adapted,
    scene_beat: {
      ...adapted.scene_beat,
      commands: sanitizeChoiceCommands({
        commands: adapted.scene_beat.commands,
        sceneId: adapted.scene_beat.scene_id,
        validTargets,
        warnings,
        fixes,
        passed,
      }),
    },
  };

  const branchValidSources = new Set([adapted.scene_beat.scene_id, ...input.usedSceneIds]);
  const aliasesForCurrentScene = localSceneAliases(input, adapted, originalSceneId);
  branchSuggestions = branchSuggestions.flatMap((suggestion) => {
    let next = { ...suggestion };
    const sourceAlias = normalizeAlias(next.source_scene_id);
    if (aliasesForCurrentScene.has(sourceAlias)) {
      next = { ...next, source_scene_id: adapted.scene_beat.scene_id };
      fixes.push(`branch suggestion "${next.suggestion_id}" 的 source_scene_id 已重映射为 "${adapted.scene_beat.scene_id}"。`);
    } else {
      const resolved = input.resolveSceneId?.(next.source_scene_id, { suggestion: next });
      if (resolved && resolved !== next.source_scene_id) {
        fixes.push(`branch suggestion "${next.suggestion_id}" 的 source_scene_id 已从 "${next.source_scene_id}" 解析为 "${resolved}"。`);
        next = { ...next, source_scene_id: resolved };
      }
    }
    if (next.enabled_by_default) {
      next = { ...next, enabled_by_default: false };
      fixes.push(`branch suggestion "${next.suggestion_id}" 已强制设为 disabled by default。`);
    }
    if (!branchValidSources.has(next.source_scene_id)) {
      warnings.push(`branch suggestion "${next.suggestion_id}" 指向无效 source_scene_id "${next.source_scene_id}"，已跳过该联想节点，不阻断主线导入。`);
      return [];
    }
    pushUnique(passed, "branch suggestion source_scene_id 有效");
    return [next];
  });

  conflictPoints = conflictPoints.map((conflict) => {
    const sourceAlias = normalizeAlias(conflict.source_scene_id);
    if (aliasesForCurrentScene.has(sourceAlias)) {
      fixes.push(`conflict point "${conflict.conflict_id}" 的 source_scene_id 已重映射为 "${adapted.scene_beat.scene_id}"。`);
      return { ...conflict, source_scene_id: adapted.scene_beat.scene_id };
    }
    const resolved = input.resolveSceneId?.(conflict.source_scene_id, { conflict });
    if (resolved && resolved !== conflict.source_scene_id) {
      fixes.push(`conflict point "${conflict.conflict_id}" 的 source_scene_id 已从 "${conflict.source_scene_id}" 解析为 "${resolved}"。`);
      return { ...conflict, source_scene_id: resolved };
    }
    return conflict;
  });

  validateCommandReferences({
    commands: adapted.scene_beat.commands,
    sceneId: adapted.scene_beat.scene_id,
    characterKeys: characterKeys(input.knownCharacters, input.sceneCandidate.characters),
    assetTypes: assetById(input.projectAssets),
    hasProjectAssets: Boolean(input.projectAssets?.length),
    passed,
    warnings,
    errors,
  });

  const status = errors.length > 0 ? "blocked" : fixes.length > 0 || warnings.length > 0 ? "fixed" : "passed";
  if (fixes.length > 0 || warnings.length > 0) {
    adapted = {
      ...adapted,
      needs_review: true,
      warnings: [...adapted.warnings, ...fixes, ...warnings],
    };
  }

  return {
    adaptedScene: adapted,
    branchSuggestions,
    conflictPoints,
    blocked: status === "blocked",
    report: {
      id: input.reportId,
      phase: "blueprint",
      status,
      title: adapted.scene_beat.title || input.sceneCandidate.title || adapted.scene_beat.scene_id,
      sceneId: adapted.scene_beat.scene_id,
      sourceSceneCandidateId: input.sceneCandidate.scene_candidate_id,
      checkedAt: new Date().toISOString(),
      passed,
      fixes,
      warnings,
      errors,
    },
  };
}
